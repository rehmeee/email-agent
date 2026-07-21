import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { createLlm } from "@/lib/agent/llm";
import { getGmailMessage } from "@/lib/gmail/api";

export type TriageDecision = "needs_reply" | "skip";
export type TriageStage = "hard" | "llm";

export type TriageResult = {
  decision: TriageDecision;
  reason: string;
  stage: TriageStage;
  confidence: "high" | "low";
};

export type TriageEmailInput = {
  id: string;
  subject: string;
  from: string;
  snippet: string;
  body: string;
  replyToEmail: string;
};

const triageSchema = z.object({
  decision: z.enum(["needs_reply", "skip"]),
  reason: z.string().min(1),
  confidence: z.enum(["high", "low"]),
});

const NOREPLY_LOCAL_PART =
  /^(noreply|no-reply|donotreply|do-not-reply|mailer-daemon|notifications?|newsletter|bounce|auto|automail|postmaster)([+._-]|$)/i;

const HARD_SKIP_SUBJECT =
  /\b(otp|one[-\s]?time\s+pass(?:word|code)?|verification\s+code|security\s+code|2fa|two[-\s]?factor|password\s+reset|reset\s+your\s+password|confirm\s+your\s+(email|account)|magic\s+link|login\s+code|your\s+code\s+is)\b/i;

const HARD_SKIP_BODY =
  /\b(your\s+(verification|security|login|one[-\s]?time)\s+code\s+is|otp\s*[:=]|verification\s+code\s*[:=]|do\s+not\s+share\s+this\s+code|this\s+code\s+expires|enter\s+this\s+code)\b/i;

function extractEmailLocalAndDomain(from: string) {
  const addressMatch = from.match(/<([^>]+)>/)?.[1] ?? from;
  const normalized = addressMatch.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0) {
    return { local: normalized, domain: "", address: normalized };
  }
  return {
    local: normalized.slice(0, at),
    domain: normalized.slice(at + 1),
    address: normalized,
  };
}

export function hardSkipTriage(email: TriageEmailInput): TriageResult | null {
  const { local, address } = extractEmailLocalAndDomain(
    email.replyToEmail || email.from
  );

  if (NOREPLY_LOCAL_PART.test(local) || NOREPLY_LOCAL_PART.test(address)) {
    return {
      decision: "skip",
      reason: `Automated/no-reply sender (${address || email.from})`,
      stage: "hard",
      confidence: "high",
    };
  }

  const subject = email.subject || "";
  const body = `${email.snippet}\n${email.body}`.slice(0, 4000);

  if (HARD_SKIP_SUBJECT.test(subject) || HARD_SKIP_BODY.test(body)) {
    return {
      decision: "skip",
      reason: "Looks like OTP, verification, or password-reset mail",
      stage: "hard",
      confidence: "high",
    };
  }

  return null;
}

function extractJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1]?.trim() ?? text.trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in triage response");
  }
  return JSON.parse(raw.slice(start, end + 1)) as unknown;
}

async function classifyWithLlm(email: TriageEmailInput): Promise<TriageResult> {
  const sample = [
    `From: ${email.from}`,
    `Subject: ${email.subject}`,
    `Body:`,
    email.body.slice(0, 2500) || email.snippet,
  ].join("\n");

  const system = `You classify whether an inbox email needs a human reply draft.

Return ONLY JSON:
{"decision":"needs_reply"|"skip","reason":"short reason","confidence":"high"|"low"}

needs_reply ONLY when the sender asks for help, information, a decision, scheduling, confirmation of work, or an answer that is not already fully provided in the email.

skip when the email mainly PROVIDES information: OTP/verification codes, receipts, shipping updates, newsletters, marketing, automated alerts, FYI-only notes, calendar accepts with no ask, password resets, login codes.

If unsure, choose skip with confidence "low". Prefer missing a draft over drafting junk.`;

  try {
    const llm = createLlm().withStructuredOutput(triageSchema, {
      method: "jsonMode",
    });
    const parsed = await llm.invoke([
      new SystemMessage(system),
      new HumanMessage(`Classify this email:\n\n${sample}`),
    ]);

    return {
      decision: parsed.decision,
      reason: parsed.reason,
      confidence: parsed.confidence,
      stage: "llm",
    };
  } catch {
    // Fall through to plain JSON parse.
  }

  const llm = createLlm();
  const response = await llm.invoke([
    new SystemMessage(system),
    new HumanMessage(`Classify this email:\n\n${sample}`),
  ]);
  const text = typeof response.content === "string" ? response.content : "";
  const parsed = triageSchema.parse(extractJsonObject(text));

  return {
    decision: parsed.decision,
    reason: parsed.reason,
    confidence: parsed.confidence,
    stage: "llm",
  };
}

/**
 * Hard rules first, then LLM classify.
 * Low-confidence needs_reply is treated as skip (safer default).
 */
export async function triageInboxEmail(
  email: TriageEmailInput
): Promise<TriageResult> {
  const hard = hardSkipTriage(email);
  if (hard) return hard;

  const llmResult = await classifyWithLlm(email);

  if (llmResult.decision === "needs_reply" && llmResult.confidence === "low") {
    return {
      decision: "skip",
      reason: `Low confidence reply need: ${llmResult.reason}`,
      stage: "llm",
      confidence: "low",
    };
  }

  return llmResult;
}

export async function fetchAndTriageGmailMessage(
  accessToken: string,
  messageId: string
) {
  const email = await getGmailMessage(accessToken, messageId, "full");
  const triage = await triageInboxEmail({
    id: email.id,
    subject: email.subject,
    from: email.from,
    snippet: email.snippet,
    body: email.body,
    replyToEmail: email.replyToEmail,
  });

  console.log("[Gmail Triage]", {
    messageId: email.id,
    decision: triage.decision,
    reason: triage.reason,
    stage: triage.stage,
    confidence: triage.confidence,
  });

  return { email, triage };
}
