import { z } from "zod";

const MAX_LIST = 5;
const MAX_RULES = 8;
const MAX_FEW_SHOTS = 2;
const MAX_BODY = 500;
const MAX_CONTEXT = 120;
const MAX_SIGNATURE = 400;

function cappedStringArray(max: number) {
  return z.array(z.string()).transform((items) =>
    items
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, max)
  );
}

export const learnedRulesSchema = z.object({
  do: cappedStringArray(MAX_RULES).describe(
    "What to do when writing emails like this user"
  ),
  dont: cappedStringArray(MAX_RULES).describe(
    "What to avoid when writing emails like this user"
  ),
});

export type LearnedRules = z.infer<typeof learnedRulesSchema>;

/** @deprecated Use LearnedRules — kept as alias for older call sites. */
export type FeedbackSummary = LearnedRules;
/** @deprecated Use learnedRulesSchema */
export const feedbackSummarySchema = learnedRulesSchema;

export const fewShotExampleSchema = z.object({
  context: z
    .string()
    .max(MAX_CONTEXT)
    .describe("Short label for when this style applies"),
  body: z
    .string()
    .max(MAX_BODY)
    .describe("Short example email body in the user's voice"),
});

export type FewShotExample = z.infer<typeof fewShotExampleSchema>;

export const personaProfileSchema = z.object({
  profile_version: z.literal(1),

  greeting: z.object({
    default: z.string().describe("Default opener, e.g. Hi,"),
    common_openers: cappedStringArray(MAX_LIST),
  }),

  signoff: z.object({
    default: z.string().describe("Default closer, e.g. Best,"),
    common_closers: cappedStringArray(MAX_LIST),
    signature: z
      .string()
      .max(MAX_SIGNATURE)
      .describe("Optional signature block; empty if none"),
  }),

  tone: z.object({
    formality: z.enum(["casual", "neutral", "formal"]),
    descriptors: cappedStringArray(MAX_LIST),
    uses_humor: z.boolean(),
    voice_notes: z
      .string()
      .describe("2-4 sentences summarizing how they write"),
  }),

  structure: z.object({
    avg_length: z.enum(["short", "medium", "long"]),
    uses_bullet_points: z.boolean(),
    paragraph_style: z
      .string()
      .describe("e.g. short_paragraphs, single_block, mixed"),
  }),

  phrasing: z.object({
    common_phrases: cappedStringArray(MAX_LIST),
    avoided_phrases: cappedStringArray(MAX_LIST),
  }),

  few_shot_examples: z.array(fewShotExampleSchema).max(MAX_FEW_SHOTS),

  learned_rules: learnedRulesSchema.describe(
    "Living do/dont from draft rejection feedback. Merge in place; max 8 each."
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

export const emptyLearnedRules = (): LearnedRules => ({
  do: [],
  dont: [],
});

/** @deprecated Use emptyLearnedRules */
export const emptyFeedbackSummary = emptyLearnedRules;

export const emptyPersonaProfile = (): PersonaProfile => ({
  profile_version: 1,
  greeting: {
    default: "Hi,",
    common_openers: [],
  },
  signoff: {
    default: "Best,",
    common_closers: [],
    signature: "",
  },
  tone: {
    formality: "neutral",
    descriptors: [],
    uses_humor: false,
    voice_notes:
      "Clear and professional. Neutral length. Not enough Sent mail to infer a stronger voice yet.",
  },
  structure: {
    avg_length: "medium",
    uses_bullet_points: false,
    paragraph_style: "short_paragraphs",
  },
  phrasing: {
    common_phrases: [],
    avoided_phrases: [],
  },
  few_shot_examples: [],
  learned_rules: emptyLearnedRules(),
});

function asStringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max);
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

/**
 * Migrate legacy flat persona rows + fill defaults for the hierarchical schema.
 */
export function normalizePersonaProfile(
  raw: PersonaProfile | Record<string, unknown> | null | undefined
): PersonaProfile {
  const base = emptyPersonaProfile();
  if (!raw || typeof raw !== "object") return base;

  const r = raw as Record<string, unknown>;

  // Already hierarchical (v1)
  if ("greeting" in r || "learned_rules" in r || "profile_version" in r) {
    const greeting =
      r.greeting && typeof r.greeting === "object"
        ? (r.greeting as Record<string, unknown>)
        : {};
    const signoff =
      r.signoff && typeof r.signoff === "object"
        ? (r.signoff as Record<string, unknown>)
        : {};
    const tone =
      r.tone && typeof r.tone === "object"
        ? (r.tone as Record<string, unknown>)
        : {};
    const structure =
      r.structure && typeof r.structure === "object"
        ? (r.structure as Record<string, unknown>)
        : {};
    const phrasing =
      r.phrasing && typeof r.phrasing === "object"
        ? (r.phrasing as Record<string, unknown>)
        : {};
    const learned =
      r.learned_rules && typeof r.learned_rules === "object"
        ? (r.learned_rules as Record<string, unknown>)
        : r.feedbackSummary && typeof r.feedbackSummary === "object"
          ? (r.feedbackSummary as Record<string, unknown>)
          : {};

    const fewShotsRaw = Array.isArray(r.few_shot_examples)
      ? r.few_shot_examples
      : [];
    const few_shot_examples = fewShotsRaw
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .slice(0, MAX_FEW_SHOTS)
      .map((item) => ({
        context: asString(item.context, "Example").slice(0, MAX_CONTEXT),
        body: asString(item.body, "").slice(0, MAX_BODY),
      }))
      .filter((item) => item.body);

    const formalityRaw = asString(tone.formality, base.tone.formality);
    const formality = (["casual", "neutral", "formal"] as const).includes(
      formalityRaw as "casual" | "neutral" | "formal"
    )
      ? (formalityRaw as "casual" | "neutral" | "formal")
      : base.tone.formality;

    const lengthRaw = asString(structure.avg_length, base.structure.avg_length);
    const avg_length = (["short", "medium", "long"] as const).includes(
      lengthRaw as "short" | "medium" | "long"
    )
      ? (lengthRaw as "short" | "medium" | "long")
      : base.structure.avg_length;

    const candidate = {
      profile_version: 1 as const,
      greeting: {
        default: asString(greeting.default, base.greeting.default),
        common_openers: asStringArray(greeting.common_openers, MAX_LIST),
      },
      signoff: {
        default: asString(signoff.default, base.signoff.default),
        common_closers: asStringArray(signoff.common_closers, MAX_LIST),
        signature: asString(signoff.signature, "").slice(0, MAX_SIGNATURE),
      },
      tone: {
        formality,
        descriptors: asStringArray(tone.descriptors, MAX_LIST),
        uses_humor: asBool(tone.uses_humor, false),
        voice_notes: asString(tone.voice_notes, base.tone.voice_notes),
      },
      structure: {
        avg_length,
        uses_bullet_points: asBool(structure.uses_bullet_points, false),
        paragraph_style: asString(
          structure.paragraph_style,
          base.structure.paragraph_style
        ),
      },
      phrasing: {
        common_phrases: asStringArray(phrasing.common_phrases, MAX_LIST),
        avoided_phrases: asStringArray(phrasing.avoided_phrases, MAX_LIST),
      },
      few_shot_examples,
      learned_rules: {
        do: asStringArray(learned.do, MAX_RULES),
        dont: asStringArray(learned.dont, MAX_RULES),
      },
    };

    const parsed = personaProfileSchema.safeParse(candidate);
    return parsed.success ? parsed.data : base;
  }

  // Legacy flat schema → hierarchical
  const feedbackRaw =
    r.feedbackSummary && typeof r.feedbackSummary === "object"
      ? (r.feedbackSummary as Record<string, unknown>)
      : {};

  const formalityRaw = asString(r.formality, "neutral");
  const formality = (["casual", "neutral", "formal"] as const).includes(
    formalityRaw as "casual" | "neutral" | "formal"
  )
    ? (formalityRaw as "casual" | "neutral" | "formal")
    : "neutral";

  const lengthRaw = asString(r.avgLength, "medium");
  const avg_length = (["short", "medium", "long"] as const).includes(
    lengthRaw as "short" | "medium" | "long"
  )
    ? (lengthRaw as "short" | "medium" | "long")
    : "medium";

  const snippets = asStringArray(r.exampleSnippets, MAX_FEW_SHOTS);
  const avoid = asStringArray(r.avoid, MAX_LIST);

  const candidate = {
    profile_version: 1 as const,
    greeting: {
      default: asString(r.greetingStyle, base.greeting.default),
      common_openers: [],
    },
    signoff: {
      default: asString(r.signOff, base.signoff.default),
      common_closers: [],
      signature: "",
    },
    tone: {
      formality,
      descriptors: [],
      uses_humor: false,
      voice_notes: asString(r.voiceNotes, base.tone.voice_notes),
    },
    structure: {
      avg_length,
      uses_bullet_points: false,
      paragraph_style: "short_paragraphs",
    },
    phrasing: {
      common_phrases: asStringArray(r.commonPhrases, MAX_LIST),
      avoided_phrases: avoid,
    },
    few_shot_examples: snippets.map((body) => ({
      context: "Sent mail sample",
      body: body.slice(0, MAX_BODY),
    })),
    learned_rules: {
      do: asStringArray(feedbackRaw.do, MAX_RULES),
      dont: asStringArray(
        Array.isArray(feedbackRaw.dont) && feedbackRaw.dont.length > 0
          ? feedbackRaw.dont
          : avoid,
        MAX_RULES
      ),
    },
  };

  const parsed = personaProfileSchema.safeParse(candidate);
  return parsed.success ? parsed.data : base;
}

/** Prompt-facing projection: rules first, few-shots last. */
export function formatPersonaForPrompt(
  profile: PersonaProfile | Record<string, unknown> | null | undefined
) {
  const p = normalizePersonaProfile(profile);

  return JSON.stringify(
    {
      learned_rules: {
        writingDo: p.learned_rules.do,
        writingDont: p.learned_rules.dont,
      },
      greeting: {
        default: p.greeting.default,
        common_openers: p.greeting.common_openers,
      },
      signoff: {
        default: p.signoff.default,
        common_closers: p.signoff.common_closers,
        signature: p.signoff.signature || undefined,
      },
      tone: p.tone,
      structure: p.structure,
      phrasing: p.phrasing,
      few_shot_examples: p.few_shot_examples,
      note: "Follow learned_rules writingDo/writingDont closely when drafting. Match greeting/signoff defaults unless the thread implies otherwise.",
    },
    null,
    2
  );
}
