import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { AGENT_TOKEN_MIN_TTL_MS } from "@/lib/agent/limits";
import { createLlm } from "@/lib/agent/llm";
import { getWorkspaceMcpTools, invokeMcpTool } from "@/lib/agent/mcp";
import {
  type AgentTraceContext,
  isLangSmithTracingEnabled,
} from "@/lib/agent/tracing";
import { getValidGmailAccessToken } from "@/lib/gmail/connection";
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
/** Gmail batch content fetches stay small so each tool call finishes under TOOL_CALL_TIMEOUT_MS. */
const BATCH_CHUNK_SIZE = 10;

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

/**
 * Unwrap MCP content-block JSON so we parse the human-readable search text,
 * not nested metadata that can contain unrelated ids.
 */
function mcpResultText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return raw;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return raw;
    }
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.text === "string" && obj.text.trim()) {
      return obj.text;
    }
    const structured = obj.structuredContent;
    if (structured && typeof structured === "object" && !Array.isArray(structured)) {
      const result = (structured as Record<string, unknown>).result;
      if (typeof result === "string" && result.trim()) {
        return result;
      }
    }
  } catch {
    // keep raw
  }
  return raw;
}

/**
 * Sent search text lists both Message ID and Thread ID. Only Message IDs are
 * valid for get_gmail_messages_content_batch — Thread IDs must never be mixed in.
 */
function extractMessageIds(searchResult: string): string[] {
  const text = mcpResultText(searchResult);
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(/\bMessage ID:\s*([a-zA-Z0-9_-]+)/gi)) {
    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= MAX_SENT_SAMPLES) break;
  }

  return ids;
}

function isSoftFetchError(error: unknown): boolean {
  const message = errorMessage(error);
  return /timed out|timeout|unavailable|ECONNRESET|ETIMEDOUT|fetch failed|network/i.test(
    message
  );
}

function chunkIds<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function parseBatchMessages(
  batchResult: string,
  fallbackIds: string[]
): SentMailSample[] {
  const samples: SentMailSample[] = [];
  const text = mcpResultText(batchResult);

  // MCP batch format: one block per "Message ID:" line (not RFC Message-ID headers).
  const chunks = text
    .split(/\n(?=Message ID:)/i)
    .map((chunk) => chunk.trim())
    .filter((chunk) => /\bMessage ID:\s*[a-zA-Z0-9_-]+/i.test(chunk));

  const blocks = chunks.length > 0 ? chunks : [text];

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const idMatch = block.match(/\bMessage ID:\s*([a-zA-Z0-9_-]+)/i);
    const subjectMatch = block.match(/^Subject:\s*(.+)$/im);
    const toMatch = block.match(/^To:\s*(.+)$/im);
    const dateMatch = block.match(/^Date:\s*(.+)$/im);
    const bodyMatch =
      block.match(/---\s*BODY\s*---\s*([\s\S]*?)(?=\n---\s*\n|\n📎|$)/i) ||
      block.match(/^Body:\s*([\s\S]+)/im);

    let body = (bodyMatch?.[1] ?? "").trim();
    if (!body) continue;
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

  return samples.filter((sample) => sample.body.length > 5).slice(0, MAX_SENT_SAMPLES);
}

async function fetchSentViaMcp(state: PersonaAgentStateType) {
  await setPersonaBuilding(state.userId);

  try {
    const { accessToken } = await getValidGmailAccessToken(state.userId, {
      minTtlMs: AGENT_TOKEN_MIN_TTL_MS,
      skipScopeCheck: true,
    });
    const tools = await getWorkspaceMcpTools(accessToken, "persona");

    // Sent mailbox only — never inbox / all mail.
    // OAuth 2.1 injects the user from the Bearer token — do not pass
    // user_google_email (stripped from MCP tool schemas).
    let searchResult: string;
    try {
      searchResult = await invokeMcpTool(tools, "search_gmail_messages", {
        query: "in:sent",
        page_size: MAX_SENT_SAMPLES,
      });
    } catch (error) {
      if (isSoftFetchError(error)) {
        return {
          sentSamples: [] as SentMailSample[],
          resultMeta: {
            personaSourceSampleCount: 0,
            personaFetchPartial: true,
            personaFetchError: errorMessage(error),
          },
        };
      }
      throw error;
    }

    const messageIds = extractMessageIds(searchResult);
    if (messageIds.length === 0) {
      return {
        sentSamples: [] as SentMailSample[],
        resultMeta: { personaSourceSampleCount: 0 },
      };
    }

    const batchParts: string[] = [];
    const fetchedIds: string[] = [];
    let partial = false;
    let fetchError: string | undefined;
    const batchTool = tools.find(
      (tool) => tool.name === "get_gmail_messages_content_batch"
    );

    if (batchTool) {
      for (const chunk of chunkIds(messageIds, BATCH_CHUNK_SIZE)) {
        try {
          const chunkResult = await invokeMcpTool(
            tools,
            "get_gmail_messages_content_batch",
            { message_ids: chunk }
          );
          batchParts.push(mcpResultText(chunkResult));
          fetchedIds.push(...chunk);
        } catch (error) {
          partial = true;
          fetchError = errorMessage(error);
          if (!isSoftFetchError(error) && batchParts.length === 0) {
            throw error;
          }
          break;
        }
      }
    } else {
      for (const messageId of messageIds) {
        try {
          const content = await invokeMcpTool(tools, "get_gmail_message_content", {
            message_id: messageId,
          });
          batchParts.push(
            `Message ID: ${messageId}\n${mcpResultText(content)}`
          );
          fetchedIds.push(messageId);
        } catch (error) {
          partial = true;
          fetchError = errorMessage(error);
          if (!isSoftFetchError(error) && batchParts.length === 0) {
            throw error;
          }
          break;
        }
      }
    }

    const batchResult = batchParts.join("\n\n---\n\n");
    const samples =
      batchResult.length > 0
        ? parseBatchMessages(batchResult, fetchedIds)
        : [];

    return {
      sentSamples: samples,
      resultMeta: {
        personaSourceSampleCount: samples.length,
        ...(partial ? { personaFetchPartial: true } : {}),
        ...(fetchError ? { personaFetchError: fetchError } : {}),
      },
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
