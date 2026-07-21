import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import type { DraftPreview } from "@/lib/drafts/preview";
import type { AgentMemoryDocument } from "@/lib/memory/types";
import type { PersonaProfile } from "@/lib/persona/types";

export type AgentEventType =
  | "gmail_connected"
  | "chat"
  | "feedback"
  | "new_email";

export type SentMailSampleState = {
  id: string;
  subject: string;
  to: string;
  date: string;
  body: string;
};

export const MailMindState = Annotation.Root({
  eventType: Annotation<AgentEventType>,
  userId: Annotation<string>,
  accessToken: Annotation<string>,
  gmailEmail: Annotation<string | null | undefined>,
  chatThreadId: Annotation<string | null | undefined>,
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  sentSamples: Annotation<SentMailSampleState[]>({
    reducer: (_left, right) => right ?? [],
    default: () => [],
  }),
  persona: Annotation<PersonaProfile | Record<string, unknown> | null>({
    reducer: (_left, right) => right ?? null,
    default: () => null,
  }),
  /** User standing instructions (do/dont/facts). Separate from writing persona. */
  agentMemory: Annotation<AgentMemoryDocument | null>({
    reducer: (_left, right) => right ?? null,
    default: () => null,
  }),
  /** In-memory draft for feedback / propose (not a DB row). */
  reviewDraft: Annotation<DraftPreview | null | undefined>({
    reducer: (_left, right) => right ?? null,
    default: () => null,
  }),
  feedbackText: Annotation<string | null | undefined>,
  gmailDraftId: Annotation<string | null | undefined>,
  /** Set by memory_gate when a durable preference/fact was just saved. */
  memoryUpdateSummary: Annotation<string | null | undefined>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  reply: Annotation<string>({
    reducer: (_left, right) => right ?? "",
    default: () => "",
  }),
  resultMeta: Annotation<Record<string, unknown>>({
    reducer: (left, right) => ({ ...(left ?? {}), ...(right ?? {}) }),
    default: () => ({}),
  }),
});

export type MailMindStateType = typeof MailMindState.State;
