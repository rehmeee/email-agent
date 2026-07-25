import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { createLlm } from "@/lib/agent/llm";
import {
  type AgentTraceContext,
  isLangSmithTracingEnabled,
} from "@/lib/agent/tracing";
import {
  DriveFileNotFoundError,
  exportFormatHintForMime,
  getDriveFileMeta,
  getDriveFileTextExcerpt,
  type DriveFileMeta,
} from "@/lib/drive/meta";
import {
  getDriveFileSummary,
  markDriveFileSummaryDeleted,
  upsertDriveFileSummary,
  type DriveSummaryReason,
} from "@/lib/drive/summaries";
import { traceable } from "langsmith/traceable";

export type DriveEventKind = "updated" | "trashed" | "deleted";

const DriveSummarizeState = Annotation.Root({
  userId: Annotation<string>,
  accessToken: Annotation<string>,
  fileId: Annotation<string>,
  reason: Annotation<DriveSummaryReason>,
  event: Annotation<DriveEventKind | null>({
    reducer: (_left, right) => right ?? null,
    default: () => null,
  }),
  meta: Annotation<DriveFileMeta | null>({
    reducer: (_left, right) => right ?? null,
    default: () => null,
  }),
  contentExcerpt: Annotation<string>({
    reducer: (_left, right) => right ?? "",
    default: () => "",
  }),
  summary: Annotation<string>({
    reducer: (_left, right) => right ?? "",
    default: () => "",
  }),
  cached: Annotation<boolean>({
    reducer: (_left, right) => right ?? false,
    default: () => false,
  }),
  skipped: Annotation<boolean>({
    reducer: (_left, right) => right ?? false,
    default: () => false,
  }),
  error: Annotation<string | null>({
    reducer: (_left, right) => right ?? null,
    default: () => null,
  }),
  resultMeta: Annotation<Record<string, unknown>>({
    reducer: (left, right) => ({ ...(left ?? {}), ...(right ?? {}) }),
    default: () => ({}),
  }),
});

type DriveSummarizeStateType = typeof DriveSummarizeState.State;

function sameModifiedTime(
  a: string | null | undefined,
  b: string | null | undefined
) {
  if (!a || !b) return false;
  return new Date(a).getTime() === new Date(b).getTime();
}

async function loadFile(state: DriveSummarizeStateType) {
  if (state.event === "trashed" || state.event === "deleted") {
    await markDriveFileSummaryDeleted(state.userId, state.fileId);
    return {
      skipped: true,
      cached: false,
      summary: "",
      resultMeta: { deleted: true, event: state.event },
    };
  }

  try {
    const meta = await getDriveFileMeta({
      accessToken: state.accessToken,
      fileId: state.fileId,
    });

    if (meta.trashed) {
      await markDriveFileSummaryDeleted(state.userId, state.fileId);
      return {
        meta,
        skipped: true,
        resultMeta: { deleted: true, event: "trashed" },
      };
    }

    const existing = await getDriveFileSummary(state.userId, state.fileId);
    const forceRefresh = state.reason === "drive_event";

    if (
      existing &&
      !forceRefresh &&
      sameModifiedTime(existing.modifiedTime, meta.modifiedTime)
    ) {
      return {
        meta,
        summary: existing.summary,
        cached: true,
        skipped: true,
        resultMeta: {
          exportFormatHint: existing.exportFormatHint,
          reused: true,
        },
      };
    }

    const contentExcerpt = await getDriveFileTextExcerpt({
      accessToken: state.accessToken,
      fileId: state.fileId,
      mimeType: meta.mimeType,
    });

    return {
      meta,
      contentExcerpt,
      cached: false,
      skipped: false,
    };
  } catch (error) {
    if (error instanceof DriveFileNotFoundError) {
      await markDriveFileSummaryDeleted(state.userId, state.fileId);
      return {
        skipped: true,
        error: error.message,
        resultMeta: { deleted: true, notFound: true },
      };
    }
    return {
      skipped: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function summarize(state: DriveSummarizeStateType) {
  if (state.skipped || state.error || !state.meta) {
    return {};
  }

  const meta = state.meta;
  const llm = createLlm();

  const response = await llm.invoke([
    new SystemMessage(
      `You summarize Google Drive files for an email assistant.
Write 2–4 short sentences: what the file is, who/what it relates to, and useful keywords.
Use the Drive description when present. Do not invent facts not supported by name, description, or content.
If content is empty, rely on name + description only and say when detail is limited.
Reply with plain text only — no markdown headings or JSON.`
    ),
    new HumanMessage(
      `File name: ${meta.name}
Mime type: ${meta.mimeType}
Drive description: ${meta.description || "(none)"}

Content excerpt:
${state.contentExcerpt || "(no text content available)"}`
    ),
  ]);

  const text =
    typeof response.content === "string"
      ? response.content.trim()
      : Array.isArray(response.content)
        ? response.content
            .map((part) =>
              typeof part === "string"
                ? part
                : "text" in part && typeof part.text === "string"
                  ? part.text
                  : ""
            )
            .join("\n")
            .trim()
        : "";

  const summary =
    text ||
    [
      meta.name,
      meta.description ? `Description: ${meta.description}` : null,
      "Limited detail available from Drive metadata.",
    ]
      .filter(Boolean)
      .join(". ");

  return { summary };
}

async function save(state: DriveSummarizeStateType) {
  if (state.error && !state.meta) {
    return { resultMeta: { error: state.error } };
  }

  if (state.skipped && state.cached && state.meta) {
    return {
      resultMeta: {
        fileId: state.meta.fileId,
        name: state.meta.name,
        mimeType: state.meta.mimeType,
        description: state.meta.description,
        summary: state.summary,
        exportFormatHint:
          typeof state.resultMeta.exportFormatHint === "string"
            ? state.resultMeta.exportFormatHint
            : exportFormatHintForMime(state.meta.mimeType),
        cached: true,
      },
    };
  }

  if (state.skipped || !state.meta || !state.summary) {
    return {
      resultMeta: {
        ...(state.resultMeta ?? {}),
        error: state.error ?? undefined,
      },
    };
  }

  const exportFormatHint = exportFormatHintForMime(state.meta.mimeType);
  const saved = await upsertDriveFileSummary({
    userId: state.userId,
    fileId: state.meta.fileId,
    name: state.meta.name,
    mimeType: state.meta.mimeType,
    description: state.meta.description,
    summary: state.summary,
    modifiedTime: state.meta.modifiedTime,
    sizeBytes: state.meta.sizeBytes,
    exportFormatHint,
    lastReason: state.reason,
    status: "active",
  });

  return {
    resultMeta: {
      fileId: state.meta.fileId,
      name: state.meta.name,
      mimeType: state.meta.mimeType,
      description: state.meta.description,
      summary: state.summary,
      exportFormatHint,
      cached: false,
      persisted: Boolean(saved),
    },
  };
}

function createDriveSummarizeGraph() {
  return new StateGraph(DriveSummarizeState)
    .addNode("load_file", loadFile)
    .addNode("summarize", summarize)
    .addNode("save", save)
    .addEdge(START, "load_file")
    .addEdge("load_file", "summarize")
    .addEdge("summarize", "save")
    .addEdge("save", END)
    .compile();
}

let compiledDriveSummarizeGraph: ReturnType<
  typeof createDriveSummarizeGraph
> | null = null;

function getDriveSummarizeGraph() {
  if (!compiledDriveSummarizeGraph) {
    compiledDriveSummarizeGraph = createDriveSummarizeGraph();
  }
  return compiledDriveSummarizeGraph;
}

export type RunDriveSummarizeAgentInput = {
  userId: string;
  accessToken: string;
  fileId: string;
  reason?: DriveSummaryReason;
  event?: DriveEventKind;
  traceContext?: AgentTraceContext;
};

export type RunDriveSummarizeAgentResult = {
  fileId: string;
  name: string;
  mimeType: string;
  description: string;
  summary: string;
  exportFormatHint: string | null;
  cached: boolean;
  deleted?: boolean;
  error?: string;
};

async function runDriveSummarizeAgentImpl(
  input: RunDriveSummarizeAgentInput
): Promise<RunDriveSummarizeAgentResult> {
  const reason = input.reason ?? "chat_miss";
  const result = await getDriveSummarizeGraph().invoke(
    {
      userId: input.userId,
      accessToken: input.accessToken,
      fileId: input.fileId.trim(),
      reason,
      event: input.event ?? null,
      meta: null,
      contentExcerpt: "",
      summary: "",
      cached: false,
      skipped: false,
      error: null,
      resultMeta: {},
    },
    {
      recursionLimit: 8,
      runName: "MailMind:drive-summarize",
      metadata: {
        userId: input.userId,
        fileId: input.fileId,
        reason,
        event: input.event ?? null,
      },
      tags: [
        "mailmind",
        "drive-summarize",
        reason,
        ...(input.traceContext?.tags ?? []),
      ],
    }
  );

  const meta = result.resultMeta ?? {};
  if (meta.deleted) {
    return {
      fileId: input.fileId,
      name: "",
      mimeType: "",
      description: "",
      summary: "",
      exportFormatHint: null,
      cached: false,
      deleted: true,
      error:
        typeof result.error === "string"
          ? result.error
          : typeof meta.error === "string"
            ? meta.error
            : undefined,
    };
  }

  if (typeof meta.error === "string" && !meta.summary) {
    return {
      fileId: input.fileId,
      name: "",
      mimeType: "",
      description: "",
      summary: "",
      exportFormatHint: null,
      cached: false,
      error: meta.error,
    };
  }

  return {
    fileId:
      typeof meta.fileId === "string" ? meta.fileId : input.fileId,
    name: typeof meta.name === "string" ? meta.name : "",
    mimeType: typeof meta.mimeType === "string" ? meta.mimeType : "",
    description: typeof meta.description === "string" ? meta.description : "",
    summary: typeof meta.summary === "string" ? meta.summary : result.summary,
    exportFormatHint:
      typeof meta.exportFormatHint === "string" ? meta.exportFormatHint : null,
    cached: Boolean(meta.cached ?? result.cached),
    error: typeof result.error === "string" ? result.error : undefined,
  };
}

export const runDriveSummarizeAgent = isLangSmithTracingEnabled()
  ? traceable(runDriveSummarizeAgentImpl, {
      name: "runDriveSummarizeAgent",
      run_type: "chain",
      processInputs: (inputs) => {
        const input =
          typeof inputs === "object" && inputs !== null && "input" in inputs
            ? (inputs.input as RunDriveSummarizeAgentInput)
            : (inputs as RunDriveSummarizeAgentInput);
        return {
          userId: input.userId,
          fileId: input.fileId,
          reason: input.reason ?? "chat_miss",
          event: input.event ?? null,
          accessToken: "[REDACTED]",
          traceContext: input.traceContext,
        };
      },
    })
  : runDriveSummarizeAgentImpl;
