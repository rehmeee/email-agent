import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import { createLlm } from "@/lib/agent/llm";
import { MailMindState, type MailMindStateType } from "@/lib/agent/state";
import { getPersonaProfile, updatePersonaProfile } from "@/lib/persona/db";
import {
  emptyPersonaProfile,
  normalizePersonaProfile,
  type FeedbackSummary,
  type PersonaProfile,
} from "@/lib/persona/types";

const feedbackMergeSchema = z.object({
  feedbackSummary: z.object({
    do: z.array(z.string()),
    dont: z.array(z.string()),
  }),
  tone: z.string().nullable().optional(),
  formality: z.enum(["casual", "neutral", "formal"]).nullable().optional(),
  avgLength: z.enum(["short", "medium", "long"]).nullable().optional(),
  greetingStyle: z.string().nullable().optional(),
  signOff: z.string().nullable().optional(),
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

function fallbackSummaryFromFeedback(
  current: FeedbackSummary,
  feedback: string
): FeedbackSummary {
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
  const system = `You update writing-persona feedback from a rejected email draft.
Return ONLY JSON with this shape:
{
  "feedbackSummary": { "do": string[], "dont": string[] },
  "tone": string | null,
  "formality": "casual" | "neutral" | "formal" | null,
  "avgLength": "short" | "medium" | "long" | null,
  "greetingStyle": string | null,
  "signOff": string | null,
  "changeNote": string
}

Rules:
- Merge previous feedbackSummary with the new feedback into a short living summary.
- Max 8 items per do/dont list. Replace conflicting older lines.
- Only set tone/formality/avgLength/greetingStyle/signOff when feedback clearly implies a change; otherwise null.
- changeNote: one short sentence for the user.`;

  const human = `Current feedbackSummary:
${JSON.stringify(currentPersona.feedbackSummary, null, 2)}

Current style fields:
${JSON.stringify(
  {
    tone: currentPersona.tone,
    formality: currentPersona.formality,
    avgLength: currentPersona.avgLength,
    greetingStyle: currentPersona.greetingStyle,
    signOff: currentPersona.signOff,
  },
  null,
  2
)}

Rejected draft subject: ${draft?.subject ?? "(unknown)"}
Rejected draft body (truncated):
${(draft?.body ?? "").slice(0, 1200)}

User feedback:
${feedback}`;

  // Prefer plain completion + JSON parse — more reliable on OpenRouter than
  // nested withStructuredOutput (which often returns "Provider returned error").
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
      ...(merged.tone ? { tone: merged.tone } : {}),
      ...(merged.formality ? { formality: merged.formality } : {}),
      ...(merged.avgLength ? { avgLength: merged.avgLength } : {}),
      ...(merged.greetingStyle ? { greetingStyle: merged.greetingStyle } : {}),
      ...(merged.signOff ? { signOff: merged.signOff } : {}),
      feedbackSummary: {
        do: uniqueLines(merged.feedbackSummary.do),
        dont: uniqueLines(merged.feedbackSummary.dont),
      },
      avoid: uniqueLines([
        ...currentPersona.avoid,
        ...merged.feedbackSummary.dont.slice(0, 3),
      ]),
    });
  } catch (error) {
    // Never fail the reject UX on provider/schema issues — merge safely.
    const summary = fallbackSummaryFromFeedback(
      currentPersona.feedbackSummary,
      feedback
    );
    nextPersona = normalizePersonaProfile({
      ...currentPersona,
      feedbackSummary: summary,
      avoid: uniqueLines([...currentPersona.avoid, ...summary.dont.slice(0, 2)]),
    });
  }

  return {
    persona: nextPersona,
    reply: "I’ll keep this in mind for next time.",
    resultMeta: {
      personaFeedbackSummary: "Feedback merged into private writing guidance.",
      feedbackSummary: nextPersona.feedbackSummary,
    },
  };
}

async function savePersona(state: MailMindStateType) {
  const profile = normalizePersonaProfile(
    state.persona ?? emptyPersonaProfile()
  );
  await updatePersonaProfile(state.userId, profile);

  return {
    reply:
      state.reply || "I’ll keep this in mind for next time.",
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
