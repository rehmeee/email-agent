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

async function fetchSent(state: MailMindStateType) {
  await setPersonaBuilding(state.userId);

  const samples = await fetchSentMessagesForPersona(state.accessToken, {
    maxMessages: 40,
    maxBodyChars: 1000,
    concurrency: 3,
  });

  return { sentSamples: samples };
}

async function buildProfile(state: MailMindStateType) {
  const samples = state.sentSamples ?? [];

  if (samples.length === 0) {
    const profile = emptyPersonaProfile();
    return {
      persona: profile,
      resultMeta: {
        personaSourceSampleCount: 0,
        personaNote: "No sent emails found; used a default neutral profile.",
      },
    };
  }

  const llm = createLlm().withStructuredOutput(personaProfileSchema, {
    method: "jsonMode",
  });
  const sampleBlock = samples
    .slice(0, 40)
    .map(
      (sample, index) =>
        `--- Sample ${index + 1} ---\nTo: ${sample.to}\nSubject: ${sample.subject}\nDate: ${sample.date}\n${sample.body}`
    )
    .join("\n\n");

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
    reply:
      sampleCount === 0
        ? "Persona ready with a default profile (no sent emails found yet). You can refresh after you send a few emails."
        : `Persona ready from ${sampleCount} sent emails. MailMind will draft in your voice.`,
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
