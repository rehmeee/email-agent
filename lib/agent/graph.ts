import {
  AIMessage,
  HumanMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { invokeMainGraph } from "@/lib/agent/main-graph";
import {
  type ChatHistoryItem,
  type MailMindAgentInput,
  type MailMindAgentResult,
  wrapWithLangSmithTrace,
} from "@/lib/agent/tracing";
import type { DraftPreview } from "@/lib/drafts/preview";
import { normalizeDraftAttachments } from "@/lib/drafts/preview";

export type { ChatHistoryItem, MailMindAgentResult } from "@/lib/agent/tracing";

function toLangChainMessages(history: ChatHistoryItem[]): BaseMessage[] {
  return history.map((item) =>
    item.role === "user"
      ? new HumanMessage(item.content)
      : new AIMessage(item.content)
  );
}

function asDraftPreview(value: unknown): DraftPreview | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as Partial<DraftPreview>;
  if (!draft.to || !draft.subject || !draft.body) return null;
  return {
    to: draft.to,
    subject: draft.subject,
    body: draft.body,
    gmailThreadId: draft.gmailThreadId,
    inReplyTo: draft.inReplyTo,
    references: draft.references,
    attachments: normalizeDraftAttachments(draft.attachments),
  };
}

async function runMailMindAgentImpl(
  input: MailMindAgentInput
): Promise<MailMindAgentResult> {
  const eventType = input.eventType ?? "chat";

  if (eventType === "gmail_connected") {
    throw new Error(
      "Persona bootstrap must use runPersonaAgent via /api/agent/persona/bootstrap"
    );
  }

  if (eventType === "feedback") {
    if (!input.feedbackText?.trim()) {
      throw new Error("feedbackText is required for feedback");
    }
    if (!input.reviewDraft) {
      throw new Error("reviewDraft is required for feedback");
    }

    const result = await invokeMainGraph({
      eventType,
      userId: input.userId,
      accessToken: input.accessToken,
      gmailEmail: input.gmailEmail,
      reviewDraft: input.reviewDraft,
      feedbackText: input.feedbackText,
      messages: [],
    });

    return {
      reply: result.reply || "Feedback saved.",
    };
  }

  if (eventType === "new_email") {
    if (!input.gmailMessageId) {
      throw new Error("gmailMessageId is required for new_email");
    }

    const triageNote = input.triageReason
      ? ` Triage already decided this needs a reply: ${input.triageReason}.`
      : "";

    const threadBlock = input.threadContext?.trim()
      ? `\n\nConversation thread context (includes prior replies; reply to the LATEST inbound message):\n${input.threadContext.trim()}`
      : "";

    const result = await invokeMainGraph({
      eventType,
      userId: input.userId,
      accessToken: input.accessToken,
      gmailEmail: input.gmailEmail,
      messages: [
        new HumanMessage(
          `New inbox message id: ${input.gmailMessageId}.${triageNote}${threadBlock}

Use the thread context above (call get_gmail_message_content only if you need more detail). Call draft_gmail_message with a helpful reply that fits the conversation. Use the latest message's thread_id, in_reply_to (Message-ID), and references. No approval step. Do not skip.`
        ),
      ],
    });

    return {
      reply: result.reply || "Draft complete.",
      gmailDraftCreated: Boolean(
        result.resultMeta?.gmailDraftCreated || result.gmailDraftId
      ),
      gmailDraftId:
        (typeof result.resultMeta?.gmailDraftId === "string"
          ? result.resultMeta.gmailDraftId
          : null) ??
        (typeof result.gmailDraftId === "string" ? result.gmailDraftId : null),
      inboxDraftPreview:
        asDraftPreview(result.reviewDraft) ??
        asDraftPreview(result.resultMeta?.inboxDraftPreview),
    };
  }

  const message = input.message?.trim();
  if (!message) {
    throw new Error("Message is required");
  }

  const result = await invokeMainGraph({
    eventType: "chat",
    userId: input.userId,
    accessToken: input.accessToken,
    gmailEmail: input.gmailEmail,
    chatThreadId: input.chatThreadId,
    messages: [
      ...toLangChainMessages(input.history ?? []),
      new HumanMessage(message),
    ],
  });

  const proposedDraft =
    asDraftPreview(result.reviewDraft) ??
    asDraftPreview(result.resultMeta?.proposedDraft);

  return {
    reply: result.reply || "I could not generate a response.",
    proposedDraft,
    memorySaved: Boolean(result.resultMeta?.memorySaved),
  };
}

export const runMailMindAgent = wrapWithLangSmithTrace(runMailMindAgentImpl);
