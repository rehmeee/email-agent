import {
  AIMessage,
  HumanMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { invokeMainGraph } from "@/lib/agent/main-graph";
import { buildApproveMessages } from "@/lib/agent/subgraphs/email";
import {
  type ChatHistoryItem,
  type MailMindAgentInput,
  type MailMindAgentResult,
  wrapWithLangSmithTrace,
} from "@/lib/agent/tracing";
import { getPendingDraft } from "@/lib/drafts/db";

export type { ChatHistoryItem, MailMindAgentResult } from "@/lib/agent/tracing";

function toLangChainMessages(history: ChatHistoryItem[]): BaseMessage[] {
  return history.map((item) =>
    item.role === "user"
      ? new HumanMessage(item.content)
      : new AIMessage(item.content)
  );
}

async function runMailMindAgentImpl(
  input: MailMindAgentInput
): Promise<MailMindAgentResult> {
  const eventType = input.eventType ?? "chat";

  if (eventType === "gmail_connected") {
    const result = await invokeMainGraph({
      eventType,
      userId: input.userId,
      accessToken: input.accessToken,
      gmailEmail: input.gmailEmail,
      messages: [],
    });

    return {
      reply: result.reply || "Persona generation finished.",
      personaStatus:
        typeof result.resultMeta?.personaStatus === "string"
          ? result.resultMeta.personaStatus
          : "ready",
    };
  }

  if (eventType === "feedback") {
    if (!input.pendingDraftId) {
      throw new Error("pendingDraftId is required for feedback");
    }

    const pendingDraft = await getPendingDraft(
      input.userId,
      input.pendingDraftId
    );
    if (!pendingDraft) {
      throw new Error("Pending draft not found");
    }

    const result = await invokeMainGraph({
      eventType,
      userId: input.userId,
      accessToken: input.accessToken,
      gmailEmail: input.gmailEmail,
      pendingDraftId: input.pendingDraftId,
      pendingDraft,
      feedbackText: input.feedbackText,
      messages: [],
    });

    return {
      reply: result.reply || "Feedback saved.",
    };
  }

  if (eventType === "approve") {
    if (!input.pendingDraftId) {
      throw new Error("pendingDraftId is required for approve");
    }

    const pendingDraft = await getPendingDraft(
      input.userId,
      input.pendingDraftId
    );
    if (!pendingDraft) {
      throw new Error("Pending draft not found");
    }
    if (pendingDraft.status !== "pending") {
      throw new Error(`Draft is already ${pendingDraft.status}`);
    }

    const result = await invokeMainGraph({
      eventType,
      userId: input.userId,
      accessToken: input.accessToken,
      gmailEmail: input.gmailEmail,
      chatThreadId: input.chatThreadId ?? pendingDraft.threadId,
      pendingDraftId: input.pendingDraftId,
      pendingDraft,
      messages: buildApproveMessages(input.pendingDraftId),
    });

    return {
      reply: result.reply || "Draft saved to Gmail.",
      pendingDraftId: input.pendingDraftId,
      gmailDraftCreated: Boolean(result.gmailDraftId),
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

  return {
    reply: result.reply || "I could not generate a response.",
    pendingDraftId:
      typeof result.resultMeta?.pendingDraftId === "string"
        ? result.resultMeta.pendingDraftId
        : result.pendingDraftId ?? null,
    memorySaved: Boolean(result.resultMeta?.memorySaved),
  };
}

export const runMailMindAgent = wrapWithLangSmithTrace(runMailMindAgentImpl);
