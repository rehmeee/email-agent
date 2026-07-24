import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { createLlm } from "@/lib/agent/llm";
import {
  classifyPendingDraftIntentHeuristic,
  type PendingDraftIntent,
} from "@/lib/drafts/preview";

const intentSchema = z.object({
  intent: z.enum(["accept", "revise", "other"]),
  reason: z.string().min(1).max(200),
});

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
    const llm = createLlm().withStructuredOutput(intentSchema, {
      name: "pending_draft_intent",
    });

    const result = await llm.invoke([
      new SystemMessage(`You classify a user chat message while MailMind has a pending email draft awaiting review (thumbs up / thumbs down).

Pick exactly one intent:
- accept: they approve the draft, or want it saved/created in Gmail Drafts (e.g. "ok perfect", "looks good", "make the draft", "save it", "the mail is good", "go ahead"). Typos and casual phrasing still count as accept if the meaning is approval.
- revise: they want the draft changed (tone, length, wording, recipient, content).
- other: a new/unrelated request (calendar, search mail, different person, general question) — not approving or editing this pending draft.

When unsure between accept and revise, prefer revise only if they clearly ask for a change; otherwise prefer accept for short positive replies.`),
      new HumanMessage(message.trim().slice(0, 500)),
    ]);

    return result.intent;
  } catch {
    // If the classifier fails, avoid auto-redrafting on ambiguity.
    return "other";
  }
}
