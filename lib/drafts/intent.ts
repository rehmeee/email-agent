import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { createLlm } from "@/lib/agent/llm";
import {
  classifyPendingDraftIntentHeuristic,
  isClearReviseMessage,
  isDraftPraiseMessage,
  type PendingDraftIntent,
} from "@/lib/drafts/preview";

const intentSchema = z.object({
  intent: z.enum(["accept", "revise", "other"]),
  reason: z.string().min(1).max(200),
});

const feedbackIntentSchema = z.object({
  intent: z.enum(["praise", "revise", "other"]),
  reason: z.string().min(1).max(200),
});

export type DraftFeedbackIntent = "praise" | "revise" | "other";

function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1]?.trim() ?? text.trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in model response");
  }
  return JSON.parse(raw.slice(start, end + 1)) as unknown;
}

/**
 * DeepSeek often rejects OpenAI-style response_format / json_schema.
 * Prefer plain JSON in the prompt (thinking off), with optional jsonMode try.
 */
async function classifyWithJson<T>(input: {
  schema: z.ZodType<T>;
  system: string;
  human: string;
}): Promise<T> {
  const system = `${input.system}

Return ONLY JSON matching the schema. No markdown.`;

  try {
    const llm = createLlm({ thinking: false }).withStructuredOutput(
      input.schema,
      { method: "jsonMode" }
    );
    const raw = await llm.invoke([
      new SystemMessage(system),
      new HumanMessage(input.human),
    ]);
    return input.schema.parse(raw);
  } catch {
    // Fall through — many DeepSeek models reject response_format entirely.
  }

  const llm = createLlm({ thinking: false });
  const response = await llm.invoke([
    new SystemMessage(system),
    new HumanMessage(input.human),
  ]);
  const text = typeof response.content === "string" ? response.content : "";
  return input.schema.parse(extractJsonObject(text));
}

/**
 * Decide what to do with the user's chat message while a draft is pending review.
 * Fast heuristics first; small LLM call only when ambiguous.
 */
export async function resolvePendingDraftIntent(
  message: string
): Promise<PendingDraftIntent> {
  const heuristic = classifyPendingDraftIntentHeuristic(message);
  if (heuristic !== "ambiguous") {
    return heuristic;
  }

  try {
    const result = await classifyWithJson({
      schema: intentSchema,
      system: `You classify a user chat message while MailMind has a pending email draft awaiting review (thumbs up / thumbs down).

Pick exactly one intent:
- accept: they approve the draft, or want it saved/created in Gmail Drafts (e.g. "ok perfect", "looks good", "make the draft", "save it", "the mail is good", "go ahead"). Typos and casual phrasing still count as accept if the meaning is approval.
- revise: they want the draft changed (tone, length, wording, recipient, content, attachments).
- other: a new/unrelated request (calendar, search mail, different person, general question) — not approving or editing this pending draft.

When unsure between accept and revise, prefer revise only if they clearly ask for a change; otherwise prefer accept for short positive replies.

Schema: {"intent":"accept"|"revise"|"other","reason":"short"}`,
      human: message.trim().slice(0, 500),
    });
    return result.intent;
  } catch {
    // If the classifier fails, avoid auto-redrafting on ambiguity.
    return "other";
  }
}

/**
 * Classify Drafts-panel / thumbs-down feedback text.
 * Praise = compliment to learn from (no rewrite). Revise = change the draft.
 */
export async function resolveDraftFeedbackIntent(
  message: string
): Promise<DraftFeedbackIntent> {
  const text = message.trim();
  if (!text) return "other";

  if (isClearReviseMessage(text)) return "revise";
  if (isDraftPraiseMessage(text)) return "praise";

  try {
    const result = await classifyWithJson({
      schema: feedbackIntentSchema,
      system: `You classify user feedback on an email draft MailMind already wrote.

Pick exactly one intent:
- praise: compliment / positive reinforcement (e.g. "perfect", "love it", "good job", "thanks", "this is great") — they are NOT asking to rewrite.
- revise: they want the draft changed (tone, length, wording, recipient, attachments, content) — including attach/add a Drive file.
- other: unclear or unrelated — not clearly praise or a change request.

When unsure between praise and revise, prefer praise for short positive replies; prefer revise only if they clearly ask for a change.

Schema: {"intent":"praise"|"revise"|"other","reason":"short"}`,
      human: text.slice(0, 500),
    });
    return result.intent;
  } catch {
    // Avoid accidental rewrites when classification fails.
    return "other";
  }
}
