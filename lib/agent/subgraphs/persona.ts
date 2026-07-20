import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { END, START, StateGraph } from "@langchain/langgraph";
import { createLlm } from "@/lib/agent/llm";
import { MailMindState, type MailMindStateType } from "@/lib/agent/state";
import { fetchSentMessagesForPersona } from "@/lib/gmail/api";
import {
  markPersonaFailed,
  savePersonaProfile,
  setPersonaBuilding,
} from "@/lib/persona/db";
import {
  emptyPersonaProfile,
  normalizePersonaProfile,
  personaProfileSchema,
} from "@/lib/persona/types";

const MIN_SENT_SAMPLES = 5;

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

async function fetchSent(state: MailMindStateType) {
  await setPersonaBuilding(state.userId);

  try {
    const samples = await fetchSentMessagesForPersona(state.accessToken, {
      maxMessages: 40,
      maxBodyChars: 1000,
      concurrency: 3,
    });

    return { sentSamples: samples };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch Sent mail";
    await markPersonaFailed(state.userId, message);
    throw error;
  }
}

async function buildProfile(state: MailMindStateType) {
  const samples = state.sentSamples ?? [];

  if (samples.length < MIN_SENT_SAMPLES) {
    // Do not mark persona "ready" with an empty/placeholder profile.
    throw new Error(
      `Not enough sent emails to build persona (got ${samples.length}, need at least ${MIN_SENT_SAMPLES}).`
    );
  }

  const sampleBlock = samples
    .slice(0, 40)
    .map(
      (sample, index) =>
        `--- Sample ${index + 1} ---\nTo: ${sample.to}\nSubject: ${sample.subject}\nDate: ${sample.date}\n${sample.body}`
    )
    .join("\n\n");

  // 1) Try structured output (best case). If OpenRouter rejects it,
  // 2) Fallback to plain JSON-only + parse with Zod.
  try {
    const llm = createLlm().withStructuredOutput(personaProfileSchema, {
      method: "jsonMode",
    });

    const profile = await llm.invoke([
      new SystemMessage(
        `You extract an email writing persona from the user's Sent mailbox.
Infer only from the samples. Do not invent a biography.
If signals are thin, choose conservative neutral defaults.
Set feedbackSummary.do and feedbackSummary.dont to empty arrays on first create
(those are filled later from draft rejection feedback).
Return structured persona fields only.`
      ),
      new HumanMessage(
        `Analyze these sent emails and produce the writer's persona profile:\n\n${sampleBlock}`
      ),
    ]);

    return {
      persona: normalizePersonaProfile(profile),
      resultMeta: { personaSourceSampleCount: samples.length },
    };
  } catch {
    // Structured output can fail with provider 400 on some schemas/models.
    // Fallback keeps persona generation resilient.
  }

  try {
    const llm = createLlm();
    const response = await llm.invoke([
      new SystemMessage(
        `You are generating a MailMind persona profile.
Return ONLY valid JSON (no markdown, no commentary) matching exactly this shape:
{
  "tone": string,
  "formality": "casual"|"neutral"|"formal",
  "avgLength": "short"|"medium"|"long",
  "greetingStyle": string,
  "signOff": string,
  "commonPhrases": string[],
  "avoid": string[],
  "voiceNotes": string,
  "exampleSnippets": string[],
  "feedbackSummary": { "do": string[], "dont": string[] }
}
Rules:
- Infer only from the provided samples.
- Set feedbackSummary.do and feedbackSummary.dont to [] on first create.`
      ),
      new HumanMessage(
        `Analyze these sent emails and output the persona JSON:\n\n${sampleBlock}`
      ),
    ]);

    const text = typeof response.content === "string" ? response.content : "";
    const json = extractJsonObject(text);
    const parsed = personaProfileSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(
        `Persona JSON did not match schema: ${parsed.error.message}`
      );
    }

    return {
      persona: normalizePersonaProfile(parsed.data),
      resultMeta: { personaSourceSampleCount: samples.length },
    };
  } catch (error) {
    const message = errorMessage(error);
    await markPersonaFailed(state.userId, message);
    throw error;
  }
}

async function savePersona(state: MailMindStateType) {
  const profile = normalizePersonaProfile(
    state.persona ?? emptyPersonaProfile()
  );
  const sampleCount =
    typeof state.resultMeta?.personaSourceSampleCount === "number"
      ? state.resultMeta.personaSourceSampleCount
      : (state.sentSamples?.length ?? 0);

  try {
    await savePersonaProfile({
      userId: state.userId,
      profile,
      sourceSampleCount: sampleCount,
      status: "ready",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save persona";
    await markPersonaFailed(state.userId, message);
    throw error;
  }

  return {
    reply: `Persona ready from ${sampleCount} sent emails. MailMind will draft in your voice.`,
    resultMeta: { personaStatus: "ready" },
  };
}

export function createPersonaSubgraph() {
  return new StateGraph(MailMindState)
    .addNode("fetch_sent", fetchSent)
    .addNode("build_profile", buildProfile)
    .addNode("save_persona", savePersona)
    .addEdge(START, "fetch_sent")
    .addEdge("fetch_sent", "build_profile")
    .addEdge("build_profile", "save_persona")
    .addEdge("save_persona", END)
    .compile();
}
