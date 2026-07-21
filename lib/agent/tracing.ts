import { traceable } from "langsmith/traceable";
import type { AgentEventType } from "@/lib/agent/state";
import type { DraftPreview } from "@/lib/drafts/preview";

export type ChatHistoryItem = {
  role: "user" | "assistant";
  content: string;
};

export type AgentTraceContext = {
  userId?: string;
  chatThreadId?: string;
  environment?: string;
  tags?: string[];
};

export type MailMindAgentResult = {
  reply: string;
  proposedDraft?: DraftPreview | null;
  gmailDraftCreated?: boolean;
  personaStatus?: string | null;
  memorySaved?: boolean;
};

export type MailMindAgentInput = {
  eventType?: AgentEventType;
  message?: string;
  history?: ChatHistoryItem[];
  accessToken: string;
  gmailEmail?: string | null;
  userId: string;
  chatThreadId?: string | null;
  feedbackText?: string | null;
  reviewDraft?: DraftPreview | null;
  gmailMessageId?: string | null;
  /** Why triage decided needs_reply (Pub/Sub path only). */
  triageReason?: string | null;
  traceContext?: AgentTraceContext;
};

export function isLangSmithTracingEnabled() {
  return (
    process.env.LANGSMITH_TRACING === "true" ||
    process.env.LANGCHAIN_TRACING_V2 === "true"
  );
}

export function getLangSmithProject() {
  return (
    process.env.LANGSMITH_PROJECT ??
    process.env.LANGCHAIN_PROJECT ??
    "mailmind-default"
  );
}

export function redactAgentInput(input: MailMindAgentInput) {
  return {
    eventType: input.eventType ?? "chat",
    message: input.message,
    historyLength: input.history?.length ?? 0,
    gmailEmail: input.gmailEmail ?? null,
    userId: input.userId,
    chatThreadId: input.chatThreadId ?? null,
    feedbackText: input.feedbackText ?? null,
    hasReviewDraft: Boolean(input.reviewDraft),
    gmailMessageId: input.gmailMessageId ?? null,
    triageReason: input.triageReason ?? null,
    traceContext: input.traceContext,
    accessToken: "[REDACTED]",
  };
}

export function wrapWithLangSmithTrace(
  fn: (input: MailMindAgentInput) => Promise<MailMindAgentResult>
) {
  if (!isLangSmithTracingEnabled()) {
    return fn;
  }

  return traceable(fn, {
    name: "runMailMindAgent",
    run_type: "chain",
    processInputs: (inputs) => {
      const input =
        typeof inputs === "object" && inputs !== null && "input" in inputs
          ? (inputs.input as MailMindAgentInput)
          : (inputs as MailMindAgentInput);

      return redactAgentInput(input);
    },
  });
}
