import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  normalizeDraftAttachments,
  type DraftPreview,
} from "@/lib/drafts/preview";
import {
  createGmailDraft,
  getGmailMessage,
  getGmailThread,
  listGmailMessages,
  sanitizeGmailThreadId,
  searchGmailMessages,
} from "@/lib/gmail/api";
import {
  formatThreadForPrompt,
  loadThreadContextForReply,
} from "@/lib/gmail/thread-context";

export function createGmailReadTools(accessToken: string) {
  const listEmails = tool(
    async ({ maxResults }) => {
      const emails = await listGmailMessages(accessToken, maxResults ?? 5);
      return JSON.stringify(emails, null, 2);
    },
    {
      name: "list_emails",
      description:
        "List recent emails from the user's Gmail inbox. Returns id, subject, from, date, and snippet.",
      schema: z.object({
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("How many recent emails to fetch. Defaults to 5."),
      }),
    }
  );

  const searchEmails = tool(
    async ({ query, maxResults }) => {
      const emails = await searchGmailMessages(accessToken, query, maxResults ?? 10);
      return JSON.stringify(emails, null, 2);
    },
    {
      name: "search_emails",
      description:
        "Search Gmail using Gmail query syntax. Examples: is:unread, from:boss@company.com, subject:invoice, newer_than:1d",
      schema: z.object({
        query: z
          .string()
          .min(1)
          .describe("Gmail search query, e.g. is:unread or from:john@example.com"),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("Maximum number of matching emails to return. Defaults to 10."),
      }),
    }
  );

  const readEmail = tool(
    async ({ messageId }) => {
      const email = await getGmailMessage(accessToken, messageId, "full");
      return JSON.stringify(email, null, 2);
    },
    {
      name: "read_email",
      description:
        "Read the full content of a single email by message id. Returns body, threadId, replyToEmail, and messageIdHeader for drafting replies.",
      schema: z.object({
        messageId: z.string().min(1).describe("Gmail message id"),
      }),
    }
  );

  const readThread = tool(
    async ({ messageId, threadId }) => {
      const id = messageId?.trim();
      const tid = sanitizeGmailThreadId(threadId);

      if (!id && !tid) {
        return JSON.stringify({
          error: "Provide messageId or threadId",
        });
      }

      if (id) {
        const loaded = await loadThreadContextForReply(accessToken, id);
        return JSON.stringify(
          {
            source: loaded.source,
            threadId: loaded.threadId,
            messageCount: loaded.messageCount,
            latestMessageId: loaded.latestMessageId,
            threadContext: loaded.threadContext,
          },
          null,
          2
        );
      }

      const messages = await getGmailThread(accessToken, tid!);
      return JSON.stringify(
        {
          source: "thread",
          threadId: tid,
          messageCount: messages.length,
          latestMessageId: messages.at(-1)?.id ?? null,
          threadContext: formatThreadForPrompt(messages, messages.at(-1)?.id),
        },
        null,
        2
      );
    },
    {
      name: "read_thread",
      description:
        "Load a Gmail conversation thread (last up to 8 messages, including your sent replies). Prefer messageId from an email in the thread. Use before drafting when you need prior context.",
      schema: z.object({
        messageId: z
          .string()
          .optional()
          .describe("Any Gmail message id in the thread"),
        threadId: z
          .string()
          .optional()
          .describe("Gmail thread id if already known"),
      }),
    }
  );

  return [listEmails, searchEmails, readEmail, readThread];
}

export function createProposeDraftTool(input: {
  onProposed?: (draft: DraftPreview) => void;
}) {
  return tool(
    async ({
      to,
      subject,
      body,
      threadId,
      inReplyTo,
      references,
      attachments,
    }) => {
      const draft: DraftPreview = {
        to,
        subject,
        body,
        gmailThreadId: sanitizeGmailThreadId(threadId),
        inReplyTo: inReplyTo?.trim() || undefined,
        references: references?.trim() || undefined,
        attachments: normalizeDraftAttachments(attachments),
      };

      input.onProposed?.(draft);

      return JSON.stringify(
        {
          success: true,
          draft,
          note: "Draft proposed for user review. It is NOT in Gmail yet. Wait for thumbs up / chat OK, or feedback for changes.",
        },
        null,
        2
      );
    },
    {
      name: "propose_draft",
      description:
        "Propose a draft email for the user to review in chat. Does NOT create a Gmail draft. Use this whenever the user wants you to write/draft an email or reply. Include attachments only with real Drive file ids from search_drive_files — never invent file ids or names.",
      schema: z.object({
        to: z.string().min(1).describe("Recipient email address"),
        subject: z.string().min(1).describe("Email subject line"),
        body: z.string().min(1).describe("Plain text body of the draft"),
        // LLMs often send null for unused optionals; .optional() alone rejects null.
        threadId: z
          .string()
          .nullish()
          .describe(
            "Gmail thread id from read_email when replying. Omit for a new email. Never invent or use chat thread UUIDs."
          ),
        inReplyTo: z
          .string()
          .nullish()
          .describe("Message-ID header from the email being replied to"),
        references: z
          .string()
          .nullish()
          .describe("References header; defaults to inReplyTo when omitted"),
        attachments: z
          .array(
            z.object({
              driveFileId: z
                .string()
                .min(1)
                .describe(
                  "Google Drive file id from search_drive_files — never invent"
                ),
              name: z
                .string()
                .min(1)
                .describe("Exact filename from Drive search results"),
              mimeType: z.string().nullish().describe("MIME type if known"),
              exportFormat: z
                .string()
                .nullish()
                .describe(
                  "Export format for Google Docs/Sheets/Slides (e.g. pdf, xlsx)"
                ),
            })
          )
          .nullish()
          .describe(
            "Optional Drive files to attach (max 3). Only when the draft clearly needs a document. Ids/names must come from search_drive_files."
          ),
      }),
    }
  );
}

export function createGmailDraftTool(
  accessToken: string,
  options?: { onCreated?: (gmailDraftId: string) => void }
) {
  return tool(
    async ({ to, subject, body, threadId, inReplyTo, references }) => {
      const draft = await createGmailDraft(accessToken, {
        to,
        subject,
        body,
        threadId,
        inReplyTo,
        references,
      });

      options?.onCreated?.(draft.draftId);

      return JSON.stringify(
        {
          success: true,
          draftId: draft.draftId,
          messageId: draft.messageId,
          threadId: draft.threadId,
          note: "Draft saved in Gmail. It has NOT been sent. The user can review it in Gmail → Drafts.",
        },
        null,
        2
      );
    },
    {
      name: "create_draft",
      description:
        "Create a draft email in the user's Gmail account. Does not send the email. Only use after the user has approved a proposed draft, or in autonomous inbox mode.",
      schema: z.object({
        to: z.string().min(1).describe("Recipient email address"),
        subject: z.string().min(1).describe("Email subject line"),
        body: z.string().min(1).describe("Plain text body of the draft"),
        threadId: z
          .string()
          .nullish()
          .describe(
            "Gmail thread id from read_email when replying. Omit for a new email. Never invent or use chat thread UUIDs."
          ),
        inReplyTo: z
          .string()
          .nullish()
          .describe("Message-ID header from the email being replied to"),
        references: z
          .string()
          .nullish()
          .describe("References header; defaults to inReplyTo when omitted"),
      }),
    }
  );
}

/** @deprecated Prefer createGmailReadTools + createGmailDraftTool */
export function createGmailTools(accessToken: string) {
  return [
    ...createGmailReadTools(accessToken),
    createGmailDraftTool(accessToken),
  ];
}
