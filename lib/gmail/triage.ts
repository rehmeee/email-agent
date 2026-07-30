import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { createLlm } from "@/lib/agent/llm";
import { getGmailMessage } from "@/lib/gmail/api";

export type TriageDecision = "needs_reply" | "skip";
export type TriageStage = "hard" | "llm";

export type TriageMeeting = {
  start: string;
  summary: string | null;
};

export type TriageResult = {
  decision: TriageDecision;
  reason: string;
  stage: TriageStage;
  confidence: "high" | "low";
  notifyNow: boolean;
  meeting: TriageMeeting | null;
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
  notify_now: z.boolean(),
  is_meeting: z.boolean(),
  meeting_start: z.string().nullable().optional(),
});

const NOREPLY_LOCAL_PART =
  /^(noreply|no-reply|donotreply|do-not-reply|mailer-daemon|notifications?|newsletter|bounce|auto|automail|postmaster)([+._-]|$)/i;

const HARD_SKIP_SUBJECT =
  /\b(otp|one[-\s]?time\s+pass(?:word|code)?|verification\s+code|security\s+code|2fa|two[-\s]?factor|password\s+reset|reset\s+your\s+password|confirm\s+your\s+(email|account)|magic\s+link|login\s+code|your\s+code\s+is)\b/i;

const HARD_SKIP_BODY =
  /\b(your\s+(verification|security|login|one[-\s]?time)\s+code\s+is|otp\s*[:=]|verification\s+code\s*[:=]|do\s+not\s+share\s+this\s+code|this\s+code\s+expires|enter\s+this\s+code)\b/i;

const HARD_URGENT =
  /\b(urgent|asap|action\s+required|time[-\s]?sensitive|immediate(ly)?|eod|end of day|production\s+(is\s+)?down|sev[-\s]?[12]|p[012]\b)\b/i;

const HARD_MONEY_LEGAL_SECURITY =
  /\b(payment\s+failed|invoice\s+due|past\s+due|legal\s+notice|contract\s+(review|signature|sign)|account\s+suspended|security\s+alert|unauthorized\s+(login|access)|wire\s+transfer)\b/i;

const MEETING_INVITE =
  /\b(invitation|invite|calendar|meeting|zoom|google\s+meet|teams\s+meeting|join\s+(the\s+)?(call|meeting)|you('re| are)\s+invited)\b/i;

const ISO_LIKE =
  /\b(20\d{2}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\b/;

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

function tryParseMeetingStart(text: string): string | null {
  const match = text.match(ISO_LIKE);
  if (!match?.[1]) return null;
  const ms = Date.parse(match[1]);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

export function hardSkipTriage(email: TriageEmailInput): TriageResult | null {
  const { local, address } = extractEmailLocalAndDomain(
    email.replyToEmail || email.from
  );

  if (NOREPLY_LOCAL_PART.test(local) || NOREPLY_LOCAL_PART.test(address)) {
    // Calendar invites often come from calendar-notification noreply — allow meeting path below.
    const blob = `${email.subject}\n${email.snippet}\n${email.body}`.slice(
      0,
      4000
    );
    if (!MEETING_INVITE.test(blob)) {
      return {
        decision: "skip",
        reason: `Automated/no-reply sender (${address || email.from})`,
        stage: "hard",
        confidence: "high",
        notifyNow: false,
        meeting: null,
      };
    }
  }

  const subject = email.subject || "";
  const body = `${email.snippet}\n${email.body}`.slice(0, 4000);

  if (HARD_SKIP_SUBJECT.test(subject) || HARD_SKIP_BODY.test(body)) {
    return {
      decision: "skip",
      reason: "Looks like OTP, verification, or password-reset mail",
      stage: "hard",
      confidence: "high",
      notifyNow: false,
      meeting: null,
    };
  }

  return null;
}

function hardYesSignals(email: TriageEmailInput): TriageResult | null {
  const blob = `${email.subject}\n${email.snippet}\n${email.body}`.slice(0, 4000);
  const isMeeting = MEETING_INVITE.test(blob);
  const meetingStart = isMeeting ? tryParseMeetingStart(blob) : null;

  if (isMeeting && meetingStart) {
    return {
      decision: "skip",
      reason: "Calendar/meeting invite detected",
      stage: "hard",
      confidence: "high",
      // Meeting path owns reminders; immediate notify only if also urgent.
      notifyNow: HARD_URGENT.test(blob),
      meeting: {
        start: meetingStart,
        summary: email.subject || null,
      },
    };
  }

  if (HARD_URGENT.test(blob) || HARD_MONEY_LEGAL_SECURITY.test(blob)) {
    return {
      decision: "needs_reply",
      reason: HARD_URGENT.test(blob)
        ? "Hard-match urgent language"
        : "Hard-match money/legal/security signal",
      stage: "hard",
      confidence: "high",
      notifyNow: true,
      meeting: isMeeting && meetingStart
        ? { start: meetingStart, summary: email.subject || null }
        : null,
    };
  }

  if (isMeeting) {
    return {
      decision: "skip",
      reason: "Meeting-related mail without a clear start time",
      stage: "hard",
      confidence: "low",
      notifyNow: false,
      meeting: null,
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

function mapLlmResult(
  parsed: z.infer<typeof triageSchema>,
  stage: TriageStage = "llm"
): TriageResult {
  let meeting: TriageMeeting | null = null;
  if (parsed.is_meeting && parsed.meeting_start) {
    const ms = Date.parse(parsed.meeting_start);
    if (Number.isFinite(ms)) {
      meeting = {
        start: new Date(ms).toISOString(),
        summary: null,
      };
    }
  }

  // Prefer meeting watch over immediate notify for plain invites.
  const finalNotify =
    parsed.confidence === "high" &&
    parsed.notify_now &&
    !(meeting && /invite|invitation|calendar/i.test(parsed.reason));

  return {
    decision: parsed.decision,
    reason: parsed.reason,
    stage,
    confidence: parsed.confidence,
    notifyNow: finalNotify,
    meeting,
  };
}

async function classifyWithLlm(email: TriageEmailInput): Promise<TriageResult> {
  const sample = [
    `From: ${email.from}`,
    `Subject: ${email.subject}`,
    `Body:`,
    email.body.slice(0, 2500) || email.snippet,
  ].join("\n");

  const system = `You classify inbox email for MailMind.

Return ONLY JSON:
{"decision":"needs_reply"|"skip","notify_now":true|false,"is_meeting":true|false,"meeting_start":"ISO-8601 or null","reason":"short reason","confidence":"high"|"low"}

decision needs_reply ONLY when the sender asks for help, information, a decision, scheduling confirmation, or an answer not already fully provided.

notify_now true ONLY when the user would reasonably want an immediate heads-up: direct consequential ask, escalation/outage/complaint, near deadline, money/legal/security that is not an OTP. Prefer false for newsletters, marketing, receipts, shipping, routine automated alerts, low-stakes FYI.

is_meeting true for calendar invites / meeting emails. meeting_start is the event start in ISO-8601 when known, else null.

If unsure, choose skip / notify_now false with confidence "low". Prefer missing a notify over spam.`;

  try {
    const llm = createLlm().withStructuredOutput(triageSchema, {
      method: "jsonMode",
    });
    const parsed = await llm.invoke([
      new SystemMessage(system),
      new HumanMessage(`Classify this email:\n\n${sample}`),
    ]);

    return mapLlmResult(parsed);
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
  return mapLlmResult(parsed);
}

/**
 * Hard rules first, then LLM classify.
 * Low-confidence needs_reply is treated as skip (safer default).
 * notify_now only sticks with high confidence.
 */
export async function triageInboxEmail(
  email: TriageEmailInput
): Promise<TriageResult> {
  const hardSkip = hardSkipTriage(email);
  if (hardSkip) return hardSkip;

  const hardYes = hardYesSignals(email);
  // Hard meeting with start: return immediately. Hard urgent: return.
  // Soft meeting without start: fall through to LLM.
  if (hardYes && (hardYes.meeting || hardYes.notifyNow)) {
    return hardYes;
  }

  const llmResult = await classifyWithLlm(email);

  if (llmResult.decision === "needs_reply" && llmResult.confidence === "low") {
    return {
      ...llmResult,
      decision: "skip",
      reason: `Low confidence reply need: ${llmResult.reason}`,
      notifyNow: false,
    };
  }

  if (llmResult.notifyNow && llmResult.confidence === "low") {
    return { ...llmResult, notifyNow: false };
  }

  // If hard meeting lacked start but LLM found one, keep meeting.
  if (!llmResult.meeting && hardYes?.meeting) {
    return { ...llmResult, meeting: hardYes.meeting };
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
    notifyNow: triage.notifyNow,
    meeting: triage.meeting?.start ?? null,
    reason: triage.reason,
    stage: triage.stage,
    confidence: triage.confidence,
  });

  return { email, triage };
}
