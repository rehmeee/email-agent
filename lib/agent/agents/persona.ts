import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { createLlm } from "@/lib/agent/llm";
import { getWorkspaceMcpTools, invokeMcpTool } from "@/lib/agent/mcp";
import {
  type AgentTraceContext,
  isLangSmithTracingEnabled,
} from "@/lib/agent/tracing";
import {
  markPersonaFailed,
  savePersonaProfile,
  setPersonaBuilding,
} from "@/lib/persona/db";
import {
  emptyPersonaProfile,
  normalizePersonaProfile,
  personaProfileSchema,
  type PersonaProfile,
} from "@/lib/persona/types";
import { traceable } from "langsmith/traceable";

const MIN_SENT_SAMPLES = 5;
const MAX_SENT_SAMPLES = 40;
const MAX_BODY_CHARS = 1000;

export type SentMailSample = {
  id: string;
  subject: string;
  to: string;
  date: string;
  body: string;
};

const PersonaAgentState = Annotation.Root({
  userId: Annotation<string>,
  accessToken: Annotation<string>,
  gmailEmail: Annotation<string | null | undefined>,
  sentSamples: Annotation<SentMailSample[]>({
    reducer: (_left, right) => right ?? [],
    default: () => [],
  }),
  persona: Annotation<PersonaProfile | null>({
    reducer: (_left, right) => right ?? null,
    default: () => null,
  }),
  reply: Annotation<string>({
    reducer: (_left, right) => right ?? "",
    default: () => "",
  }),
  resultMeta: Annotation<Record<string, unknown>>({
    reducer: (left, right) => ({ ...(left ?? {}), ...(right ?? {}) }),
    default: () => ({}),
  }),
});

type PersonaAgentStateType = typeof PersonaAgentState.State;

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

function extractMessageIds(searchResult: string): string[] {
  const ids = new Set<string>();

  try {
    const parsed = JSON.parse(searchResult) as unknown;
    const collect = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        for (const item of value) collect(item);
        return;
      }
      const obj = value as Record<string, unknown>;
      if (typeof obj.id === "string" && obj.id.length > 5) {
        ids.add(obj.id);
      }
      if (typeof obj.message_id === "string" && !obj.message_id.includes("@")) {
        ids.add(obj.message_id);
      }
      for (const nested of Object.values(obj)) collect(nested);
    };
    collect(parsed);
  } catch {
    // fall through to regex
  }

  for (const match of searchResult.matchAll(
    /\b(?:message[_ ]?id|id)["'\s:=]+([a-zA-Z0-9_-]{6,})\b/gi
  )) {
    ids.add(match[1]);
  }

  // Gmail API ids are typically alphanumeric
  for (const match of searchResult.matchAll(/\b([a-fA-F0-9]{10,})\b/g)) {
    ids.add(match[1]);
  }

  return [...ids].slice(0, MAX_SENT_SAMPLES);
}

function parseBatchMessages(
  batchResult: string,
  fallbackIds: string[]
): SentMailSample[] {
  const samples: SentMailSample[] = [];

  // Prefer splitting on common MCP batch separators
  const chunks = batchResult
    .split(/\n(?=---\s*Message|Message ID:|📧|### Message)/i)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  const blocks = chunks.length > 1 ? chunks : [batchResult];

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const idMatch =
      block.match(/Message ID:\s*([a-zA-Z0-9_-]+)/i) ||
      block.match(/\bid["'\s:=]+([a-zA-Z0-9_-]{6,})/i);
    const subjectMatch = block.match(/Subject:\s*(.+)/i);
    const toMatch =
      block.match(/^To:\s*(.+)$/im) || block.match(/\bTo:\s*(.+)/i);
    const dateMatch = block.match(/Date:\s*(.+)/i);
    const bodyMatch =
      block.match(/---\s*BODY\s*---\s*([\s\S]*?)(?=---|\n📎|$)/i) ||
      block.match(/Body:\s*([\s\S]+)/i);

    let body = (bodyMatch?.[1] ?? block).trim();
    if (body.length > MAX_BODY_CHARS) {
      body = `${body.slice(0, MAX_BODY_CHARS)}…`;
    }

    samples.push({
      id: idMatch?.[1] ?? fallbackIds[index] ?? `sample-${index + 1}`,
      subject: subjectMatch?.[1]?.trim() || "(No subject)",
      to: toMatch?.[1]?.trim() || "",
      date: dateMatch?.[1]?.trim() || "",
      body,
    });
  }

  return samples.filter((sample) => sample.body.length > 20).slice(0, MAX_SENT_SAMPLES);
}

async function fetchSentViaMcp(state: PersonaAgentStateType) {
  await setPersonaBuilding(state.userId);

  try {
    const tools = await getWorkspaceMcpTools(state.accessToken, "persona");
    const email = state.gmailEmail?.trim();
    const baseArgs = email ? { user_google_email: email } : {};

    const searchResult = await invokeMcpTool(tools, "search_gmail_messages", {
      ...baseArgs,
      query: "in:sent",
      page_size: MAX_SENT_SAMPLES,
    });

    const messageIds = extractMessageIds(searchResult);
    if (messageIds.length === 0) {
      return {
        sentSamples: [] as SentMailSample[],
        resultMeta: { personaSourceSampleCount: 0 },
      };
    }

    let batchResult: string;
    const batchTool = tools.find(
      (tool) => tool.name === "get_gmail_messages_content_batch"
    );

    if (batchTool) {
      batchResult = await invokeMcpTool(
        tools,
        "get_gmail_messages_content_batch",
        {
          ...baseArgs,
          message_ids: messageIds,
        }
      );
    } else {
      const parts: string[] = [];
      for (const messageId of messageIds.slice(0, 15)) {
        const content = await invokeMcpTool(tools, "get_gmail_message_content", {
          ...baseArgs,
          message_id: messageId,
        });
        parts.push(`Message ID: ${messageId}\n${content}`);
      }
      batchResult = parts.join("\n\n---\n\n");
    }

    const samples = parseBatchMessages(batchResult, messageIds);
    return {
      sentSamples: samples,
      resultMeta: { personaSourceSampleCount: samples.length },
    };
  } catch (error) {
    await markPersonaFailed(state.userId, errorMessage(error));
    throw error;
  }
}

async function buildProfile(state: PersonaAgentStateType) {
  const samples = state.sentSamples ?? [];

  if (samples.length < MIN_SENT_SAMPLES) {
    return {
      persona: emptyPersonaProfile(),
      resultMeta: {
        personaSourceSampleCount: samples.length,
        personaDefaulted: true,
      },
    };
  }

  const sampleBlock = samples
    .slice(0, MAX_SENT_SAMPLES)
    .map(
      (sample, index) =>
        `--- Sample ${index + 1} ---\nTo: ${sample.to}\nSubject: ${sample.subject}\nDate: ${sample.date}\n${sample.body}`
    )
    .join("\n\n");

  const systemShape = `You extract an email writing persona from the user's Sent mailbox.
Infer only from the samples. Do not invent a biography.
If signals are thin, choose conservative neutral defaults.
Set learned_rules.do and learned_rules.dont to empty arrays on first create
(those are filled later from draft rejection feedback).
Return ONLY valid JSON matching exactly this shape:
{
  "profile_version": 1,
  "greeting": { "default": string, "common_openers": string[] },
  "signoff": { "default": string, "common_closers": string[], "signature": string },
  "tone": {
    "formality": "casual"|"neutral"|"formal",
    "descriptors": string[],
    "uses_humor": boolean,
    "voice_notes": string
  },
  "structure": {
    "avg_length": "short"|"medium"|"long",
    "uses_bullet_points": boolean,
    "paragraph_style": string
  },
  "phrasing": { "common_phrases": string[], "avoided_phrases": string[] },
  "few_shot_examples": [ { "context": string, "body": string } ],
  "learned_rules": { "do": string[], "dont": string[] }
}
Caps: common_openers/closers/phrases/avoided/descriptors max 5;
few_shot_examples max 2 (body <= 500 chars); learned_rules empty on first create.
signature may be "" if none.`;

  try {
    const llm = createLlm().withStructuredOutput(personaProfileSchema, {
      method: "jsonMode",
    });

    const profile = await llm.invoke([
      new SystemMessage(systemShape),
      new HumanMessage(
        `Analyze these sent emails and produce the writer's persona profile:\n\n${sampleBlock}`
      ),
    ]);

    return {
      persona: normalizePersonaProfile({
        ...profile,
        learned_rules: { do: [], dont: [] },
      }),
      resultMeta: {
        personaSourceSampleCount: samples.length,
        personaDefaulted: false,
      },
    };
  } catch {
    // Structured output can fail with provider 400 — fall back to JSON parse.
  }

  try {
    const llm = createLlm();
    const response = await llm.invoke([
      new SystemMessage(systemShape),
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
      persona: normalizePersonaProfile({
        ...parsed.data,
        learned_rules: { do: [], dont: [] },
      }),
      resultMeta: {
        personaSourceSampleCount: samples.length,
        personaDefaulted: false,
      },
    };
  } catch (error) {
    await markPersonaFailed(state.userId, errorMessage(error));
    throw error;
  }
}

async function savePersona(state: PersonaAgentStateType) {
  const profile = normalizePersonaProfile(
    state.persona ?? emptyPersonaProfile()
  );
  const sampleCount =
    typeof state.resultMeta?.personaSourceSampleCount === "number"
      ? state.resultMeta.personaSourceSampleCount
      : (state.sentSamples?.length ?? 0);
  const defaulted = Boolean(state.resultMeta?.personaDefaulted);

  try {
    await savePersonaProfile({
      userId: state.userId,
      profile,
      sourceSampleCount: sampleCount,
      status: "ready",
    });
  } catch (error) {
    await markPersonaFailed(state.userId, errorMessage(error));
    throw error;
  }

  const reply = defaulted
    ? `We couldn't learn your writing style from Sent mail yet (need at least ${MIN_SENT_SAMPLES} sent emails; found ${sampleCount}). Using a neutral default voice for now — it will improve when you give draft feedback.`
    : `Persona ready from ${sampleCount} sent emails. MailMind will draft in your voice.`;

  return {
    reply,
    resultMeta: {
      personaStatus: "ready",
      personaDefaulted: defaulted,
      personaSourceSampleCount: sampleCount,
    },
  };
}

function createPersonaGraph() {
  return new StateGraph(PersonaAgentState)
    .addNode("fetch_sent", fetchSentViaMcp)
    .addNode("build_profile", buildProfile)
    .addNode("save_persona", savePersona)
    .addEdge(START, "fetch_sent")
    .addEdge("fetch_sent", "build_profile")
    .addEdge("build_profile", "save_persona")
    .addEdge("save_persona", END)
    .compile();
}

let compiledPersonaGraph: ReturnType<typeof createPersonaGraph> | null = null;

function getPersonaGraph() {
  if (!compiledPersonaGraph) {
    compiledPersonaGraph = createPersonaGraph();
  }
  return compiledPersonaGraph;
}

export type RunPersonaAgentInput = {
  userId: string;
  accessToken: string;
  gmailEmail?: string | null;
  traceContext?: AgentTraceContext;
};

export type RunPersonaAgentResult = {
  reply: string;
  personaStatus: string;
  personaDefaulted: boolean;
  sourceSampleCount: number;
};

async function runPersonaAgentImpl(
  input: RunPersonaAgentInput
): Promise<RunPersonaAgentResult> {
  const result = await getPersonaGraph().invoke(
    {
      userId: input.userId,
      accessToken: input.accessToken,
      gmailEmail: input.gmailEmail,
      sentSamples: [],
      persona: null,
      reply: "",
      resultMeta: {},
    },
    {
      recursionLimit: 10,
      runName: "MailMind:persona",
      metadata: {
        userId: input.userId,
        gmailEmail: input.gmailEmail ?? null,
      },
      tags: ["mailmind", "persona", ...(input.traceContext?.tags ?? [])],
    }
  );

  return {
    reply: result.reply || "Persona generation finished.",
    personaStatus:
      typeof result.resultMeta?.personaStatus === "string"
        ? result.resultMeta.personaStatus
        : "ready",
    personaDefaulted: Boolean(result.resultMeta?.personaDefaulted),
    sourceSampleCount:
      typeof result.resultMeta?.personaSourceSampleCount === "number"
        ? result.resultMeta.personaSourceSampleCount
        : 0,
  };
}

export const runPersonaAgent = isLangSmithTracingEnabled()
  ? traceable(runPersonaAgentImpl, {
      name: "runPersonaAgent",
      run_type: "chain",
      processInputs: (inputs) => {
        const input =
          typeof inputs === "object" && inputs !== null && "input" in inputs
            ? (inputs.input as RunPersonaAgentInput)
            : (inputs as RunPersonaAgentInput);
        return {
          userId: input.userId,
          gmailEmail: input.gmailEmail ?? null,
          accessToken: "[REDACTED]",
          traceContext: input.traceContext,
        };
      },
    })
  : runPersonaAgentImpl;
