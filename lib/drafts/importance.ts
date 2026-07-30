import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { createLlm } from "@/lib/agent/llm";

const schema = z.object({
  important_to_send: z.boolean(),
  reason: z.string().min(1),
  confidence: z.enum(["high", "low"]),
});

/**
 * Whether an inbox-created draft should be watched for an unsent nudge.
 * Chat drafts always watch — this is inbox-only.
 */
export async function isInboxDraftImportantToSend(input: {
  to: string;
  subject: string;
  body: string;
  triageReason?: string;
}): Promise<boolean> {
  const sample = [
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    `Triage: ${input.triageReason ?? ""}`,
    `Body:`,
    input.body.slice(0, 1500),
  ].join("\n");

  const system = `You decide if this draft is important enough that MailMind should remind the user in ~2 days if they never send it.

Return ONLY JSON:
{"important_to_send":true|false,"reason":"short","confidence":"high"|"low"}

true for consequential work/client/boss replies, decisions, deadlines, complaints, money/legal.
false for casual thanks, simple confirmations, low-stakes FYI.
If unsure, important_to_send false with confidence low.`;

  try {
    const llm = createLlm().withStructuredOutput(schema, { method: "jsonMode" });
    const parsed = await llm.invoke([
      new SystemMessage(system),
      new HumanMessage(sample),
    ]);
    return parsed.important_to_send && parsed.confidence === "high";
  } catch {
    return false;
  }
}
