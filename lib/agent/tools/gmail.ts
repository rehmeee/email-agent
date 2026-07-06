import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  createGmailDraft,
  getGmailMessage,
  listGmailMessages,
  searchGmailMessages,
} from "@/lib/gmail/api";

export function createGmailTools(accessToken: string) {
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

  const createDraft = tool(
    async ({ to, subject, body, threadId, inReplyTo, references }) => {
      const draft = await createGmailDraft(accessToken, {
        to,
        subject,
        body,
        threadId,
        inReplyTo,
        references,
      });

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
        "Create a draft email in the user's Gmail account. Does not send the email. For replies, call read_email first and pass threadId and inReplyTo (messageIdHeader).",
      schema: z.object({
        to: z.string().min(1).describe("Recipient email address"),
        subject: z.string().min(1).describe("Email subject line"),
        body: z.string().min(1).describe("Plain text body of the draft"),
        threadId: z
          .string()
          .optional()
          .describe("Gmail thread id when replying to an existing email"),
        inReplyTo: z
          .string()
          .optional()
          .describe("Message-ID header from the email being replied to"),
        references: z
          .string()
          .optional()
          .describe("References header; defaults to inReplyTo when omitted"),
      }),
    }
  );

  return [listEmails, searchEmails, readEmail, createDraft];
}
