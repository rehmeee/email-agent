import type { AgentMemoryDocument } from "@/lib/memory/types";

const TIMEZONE_FACT =
  /(?:timezone|time\s*zone)\s*[:=]?\s*([A-Za-z_]+\/[A-Za-z_]+)/i;
const IANA_IN_FACT = /\b([A-Za-z_]+\/[A-Za-z_]+)\b/;

/**
 * Prefer an explicit timezone fact in user memory, then USER_TIMEZONE env, else UTC.
 */
export function resolveAgentTimeZone(
  memory?: AgentMemoryDocument | null
): string {
  for (const fact of memory?.facts ?? []) {
    const labeled = fact.match(TIMEZONE_FACT);
    if (labeled?.[1] && isValidTimeZone(labeled[1])) return labeled[1];
    const embedded = fact.match(IANA_IN_FACT);
    if (embedded?.[1] && isValidTimeZone(embedded[1])) return embedded[1];
  }

  const fromEnv = process.env.USER_TIMEZONE?.trim();
  if (fromEnv && isValidTimeZone(fromEnv)) return fromEnv;

  return "UTC";
}

function isValidTimeZone(timeZone: string) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * Human-readable "now" block for system prompts so the model can resolve
 * relative times (today, tomorrow, at 7, next Monday).
 */
export function formatAgentNow(options?: {
  memory?: AgentMemoryDocument | null;
  now?: Date;
}): string {
  const now = options?.now ?? new Date();
  const timeZone = resolveAgentTimeZone(options?.memory);

  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
  }).format(now);

  const datePart = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(now);

  const timePart = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(now);

  const offset =
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
    })
      .formatToParts(now)
      .find((part) => part.type === "timeZoneName")?.value ?? "";

  return `Current local time: ${weekday}, ${datePart}, ${timePart} (${timeZone}${offset ? `, ${offset}` : ""}).
Use this as "now" for relative times like today, tomorrow, at 7, next Monday.
When calling calendar tools, convert times to ISO 8601 with timezone offset for ${timeZone}.
Do not assume a different today. If timezone is UTC and the user has not set one in memory, do not invent a city — ask if ambiguity matters.`;
}
