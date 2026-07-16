import { z } from "zod";

/** Rolling writing guidance from draft rejects — merged in place, not an append-only list. */
export const feedbackSummarySchema = z.object({
  do: z
    .array(z.string())
    .describe("What to do when writing emails like this user"),
  dont: z
    .array(z.string())
    .describe("What to avoid when writing emails like this user"),
});

export type FeedbackSummary = z.infer<typeof feedbackSummarySchema>;

export const personaProfileSchema = z.object({
  tone: z.string().describe("Overall tone of the writer's emails"),
  formality: z.enum(["casual", "neutral", "formal"]),
  avgLength: z.enum(["short", "medium", "long"]),
  greetingStyle: z.string().describe("How they usually open emails"),
  signOff: z.string().describe("How they usually close emails"),
  commonPhrases: z.array(z.string()).describe("Phrases they commonly use"),
  avoid: z.array(z.string()).describe("Things they avoid or rarely use"),
  voiceNotes: z
    .string()
    .describe("2-4 sentences summarizing how they write"),
  exampleSnippets: z
    .array(z.string())
    .describe("2-3 short snippets reflecting their style"),
  feedbackSummary: feedbackSummarySchema.describe(
    "Living summary of draft-rejection feedback (do/dont for writing). Update by merging, never append unlimited history."
  ),
});

export type PersonaProfile = z.infer<typeof personaProfileSchema>;

export type PersonaStatus = "building" | "ready" | "failed";

export type PersonaRecord = {
  userId: string;
  profile: PersonaProfile | Record<string, unknown>;
  sourceSampleCount: number;
  status: PersonaStatus;
  errorMessage: string | null;
  updatedAt: string;
};

export const emptyFeedbackSummary = (): FeedbackSummary => ({
  do: [],
  dont: [],
});

export const emptyPersonaProfile = (): PersonaProfile => ({
  tone: "clear and professional",
  formality: "neutral",
  avgLength: "medium",
  greetingStyle: "Hi,",
  signOff: "Best,",
  commonPhrases: [],
  avoid: [],
  voiceNotes: "Not enough sample emails to infer a strong voice yet.",
  exampleSnippets: [],
  feedbackSummary: emptyFeedbackSummary(),
});

/** Fill defaults for older persona rows missing feedbackSummary. */
export function normalizePersonaProfile(
  raw: PersonaProfile | Record<string, unknown> | null | undefined
): PersonaProfile {
  const base = emptyPersonaProfile();
  if (!raw || typeof raw !== "object") return base;

  const feedbackRaw =
    "feedbackSummary" in raw && raw.feedbackSummary && typeof raw.feedbackSummary === "object"
      ? (raw.feedbackSummary as Record<string, unknown>)
      : {};

  const merged = {
    ...base,
    ...raw,
    feedbackSummary: {
      do: Array.isArray(feedbackRaw.do)
        ? feedbackRaw.do.filter((item) => typeof item === "string")
        : [],
      dont: Array.isArray(feedbackRaw.dont)
        ? feedbackRaw.dont.filter((item) => typeof item === "string")
        : [],
    },
  };

  const parsed = personaProfileSchema.safeParse(merged);
  return parsed.success ? parsed.data : base;
}

export function formatPersonaForPrompt(
  profile: PersonaProfile | Record<string, unknown> | null | undefined
) {
  const normalized = normalizePersonaProfile(profile);
  const { feedbackSummary, ...rest } = normalized;

  const feedbackBlock =
    feedbackSummary.do.length || feedbackSummary.dont.length
      ? {
          writingDo: feedbackSummary.do,
          writingDont: feedbackSummary.dont,
        }
      : { writingDo: [], writingDont: [] };

  return JSON.stringify(
    {
      ...rest,
      feedbackSummary: feedbackBlock,
      note: "Follow feedbackSummary writingDo/writingDont closely when drafting.",
    },
    null,
    2
  );
}
