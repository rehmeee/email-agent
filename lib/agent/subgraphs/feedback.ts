import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import { createLlm } from "@/lib/agent/llm";
import { formatAgentNow } from "@/lib/agent/now";
import { MailMindState, type MailMindStateType } from "@/lib/agent/state";
import { getPersonaProfile, updatePersonaProfile } from "@/lib/persona/db";
import {
  emptyPersonaProfile,
  normalizePersonaProfile,
  type LearnedRules,
  type PersonaProfile,
} from "@/lib/persona/types";

const feedbackMergeSchema = z.object({
  learned_rules: z.object({
    do: z.array(z.string()),
    dont: z.array(z.string()),
  }),
  greeting_default: z.string().nullable().optional(),
  signoff_default: z.string().nullable().optional(),
  formality: z.enum(["casual", "neutral", "formal"]).nullable().optional(),
  avg_length: z.enum(["short", "medium", "long"]).nullable().optional(),
  voice_notes: z.string().nullable().optional(),
  changeNote: z.string(),
});

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function extractJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1]?.trim() ?? text.trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in model response");
  }
  return JSON.parse(raw.slice(start, end + 1)) as unknown;
}

function uniqueLines(lines: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const cleaned = line.trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out.slice(0, 8);
}

function fallbackRulesFromFeedback(
  current: LearnedRules,
  feedback: string
): LearnedRules {
  const lower = feedback.toLowerCase();
  const doLines = [...current.do];
  const dontLines = [...current.dont];

  if (
    lower.includes("don't") ||
    lower.includes("dont") ||
    lower.includes("avoid") ||
    lower.includes("too ") ||
    lower.includes("never")
  ) {
    dontLines.unshift(feedback.trim().slice(0, 160));
  } else {
    doLines.unshift(feedback.trim().slice(0, 160));
  }

  return {
    do: uniqueLines(doLines),
    dont: uniqueLines(dontLines),
  };
}

async function mergeFeedbackWithLlm(
  currentPersona: PersonaProfile,
  feedback: string,
  draft: { subject?: string; body?: string } | null | undefined
) {
  const system = `You update writing-persona learned_rules from a rejected email draft.
${formatAgentNow()}

Return ONLY JSON with this shape:
{
  "learned_rules": { "do": string[], "dont": string[] },
  "greeting_default": string | null,
  "signoff_default": string | null,
  "formality": "casual" | "neutral" | "formal" | null,
  "avg_length": "short" | "medium" | "long" | null,
  "voice_notes": string | null,
  "changeNote": string
}

Rules:
- Merge previous learned_rules with the new feedback into a short living summary.
- Max 8 items per do/dont list. Replace conflicting older lines.
- Only set greeting_default/signoff_default/formality/avg_length/voice_notes when feedback clearly implies a change; otherwise null.
- changeNote: one short sentence for the user.`;

  const human = `Current learned_rules:
${JSON.stringify(currentPersona.learned_rules, null, 2)}

Current style fields:
${JSON.stringify(
  {
    greeting: currentPersona.greeting.default,
    signoff: currentPersona.signoff.default,
    formality: currentPersona.tone.formality,
    avg_length: currentPersona.structure.avg_length,
    voice_notes: currentPersona.tone.voice_notes,
  },
  null,
  2
)}

Rejected draft subject: ${draft?.subject ?? "(unknown)"}
Rejected draft body (truncated):
${(draft?.body ?? "").slice(0, 1200)}

User feedback:
${feedback}`;

  const llm = createLlm();
  const response = await llm.invoke([
    new SystemMessage(system),
    new HumanMessage(human),
  ]);

  const text =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

  return feedbackMergeSchema.parse(extractJsonObject(text));
}

async function loadPersona(state: MailMindStateType) {
  const record = await getPersonaProfile(state.userId);
  return {
    persona: normalizePersonaProfile(record?.profile),
  };
}

async function applyFeedback(state: MailMindStateType) {
  const feedback = state.feedbackText?.trim();
  if (!feedback) {
    throw new Error("Feedback text is required");
  }

  const draft = state.reviewDraft;
  const currentPersona = normalizePersonaProfile(
    (state.persona as PersonaProfile | null) ?? emptyPersonaProfile()
  );

  let nextPersona = currentPersona;

  try {
    const merged = await mergeFeedbackWithLlm(
      currentPersona,
      feedback,
      draft
    );

    nextPersona = normalizePersonaProfile({
      ...currentPersona,
      greeting: {
        ...currentPersona.greeting,
        ...(merged.greeting_default
          ? { default: merged.greeting_default }
          : {}),
      },
      signoff: {
        ...currentPersona.signoff,
        ...(merged.signoff_default ? { default: merged.signoff_default } : {}),
      },
      tone: {
        ...currentPersona.tone,
        ...(merged.formality ? { formality: merged.formality } : {}),
        ...(merged.voice_notes ? { voice_notes: merged.voice_notes } : {}),
      },
      structure: {
        ...currentPersona.structure,
        ...(merged.avg_length ? { avg_length: merged.avg_length } : {}),
      },
      learned_rules: {
        do: uniqueLines(merged.learned_rules.do),
        dont: uniqueLines(merged.learned_rules.dont),
      },
      phrasing: {
        ...currentPersona.phrasing,
        avoided_phrases: uniqueLines([
          ...currentPersona.phrasing.avoided_phrases,
          ...merged.learned_rules.dont.slice(0, 3),
        ]).slice(0, 5),
      },
    });
  } catch (error) {
    void errorMessage(error);
    const rules = fallbackRulesFromFeedback(
      currentPersona.learned_rules,
      feedback
    );
    nextPersona = normalizePersonaProfile({
      ...currentPersona,
      learned_rules: rules,
      phrasing: {
        ...currentPersona.phrasing,
        avoided_phrases: uniqueLines([
          ...currentPersona.phrasing.avoided_phrases,
          ...rules.dont.slice(0, 2),
        ]).slice(0, 5),
      },
    });
  }

  return {
    persona: nextPersona,
    reply: "I’ll keep this in mind for next time.",
    resultMeta: {
      personaFeedbackSummary: "Feedback merged into private writing guidance.",
      learned_rules: nextPersona.learned_rules,
    },
  };
}

async function savePersona(state: MailMindStateType) {
  const profile = normalizePersonaProfile(
    state.persona ?? emptyPersonaProfile()
  );
  await updatePersonaProfile(state.userId, profile);

  return {
    reply: state.reply || "I’ll keep this in mind for next time.",
    resultMeta: { feedbackSaved: true, personaUpdated: true },
  };
}

export function createFeedbackSubgraph() {
  return new StateGraph(MailMindState)
    .addNode("load_persona", loadPersona)
    .addNode("apply_feedback", applyFeedback)
    .addNode("save_persona", savePersona)
    .addEdge(START, "load_persona")
    .addEdge("load_persona", "apply_feedback")
    .addEdge("apply_feedback", "save_persona")
    .addEdge("save_persona", END)
    .compile();
}
