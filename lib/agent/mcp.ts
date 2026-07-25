import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import {
  DynamicStructuredTool,
  type StructuredToolInterface,
} from "@langchain/core/tools";
import { TOOL_CALL_TIMEOUT_MS } from "@/lib/agent/limits";

/**
 * Tools the chat agent may call. `manage_event` is chat-only for booking:
 * the user explicitly asked for the meeting, so no approval step is needed.
 * MCP v1.22+ exposes create/update/delete via manage_event (action=create|…).
 */
const CHAT_TOOL_ALLOWLIST = [
  "search_gmail_messages",
  "get_gmail_message_content",
  "get_gmail_thread_content",
  "search_contacts",
  "list_calendars",
  "get_events",
  "manage_event",
  "query_freebusy",
  "search_drive_files",
  "get_drive_file_content",
  "get_drive_file_download_url",
  "read_sheet_values",
];

/**
 * Tools the ambient inbox agent may call. Never `manage_event` (the agent
 * must only propose times in drafts), plus `draft_gmail_message` for
 * creating threaded reply drafts without an approval step.
 */
const INBOX_TOOL_ALLOWLIST = [
  ...CHAT_TOOL_ALLOWLIST.filter((name) => name !== "manage_event"),
  "draft_gmail_message",
];

/** Persona bootstrap: Sent-mail search + batch content only. */
const PERSONA_TOOL_ALLOWLIST = [
  "search_gmail_messages",
  "get_gmail_messages_content_batch",
  "get_gmail_message_content",
];

/** Injected by MCP OAuth 2.1 — must never appear in tool args. */
const MCP_INJECTED_ARG_KEYS = new Set(["user_google_email", "service"]);

/** Drive API operators — free-text queries must not be re-wrapped if present. */
const DRIVE_STRUCTURED_QUERY_RE =
  /\b(name|fullText)\s*(contains|=|!=)|\bmimeType\s*(=|!=)|\bin\s+parents\b|\btrashed\s*=|\bstarred\s*=|\bsharedWithMe\s*=|\b(modifiedTime|createdTime|viewedByMeTime)\s*[<>=]/i;

const DRIVE_MIME_BY_FILE_TYPE: Record<string, string[]> = {
  document: [
    "application/vnd.google-apps.document",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  doc: [
    "application/vnd.google-apps.document",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  docs: [
    "application/vnd.google-apps.document",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  pdf: ["application/pdf"],
  spreadsheet: [
    "application/vnd.google-apps.spreadsheet",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv",
  ],
  sheet: [
    "application/vnd.google-apps.spreadsheet",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv",
  ],
  sheets: [
    "application/vnd.google-apps.spreadsheet",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv",
  ],
  presentation: [
    "application/vnd.google-apps.presentation",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-powerpoint",
  ],
  slides: [
    "application/vnd.google-apps.presentation",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-powerpoint",
  ],
};

export type McpAgentKind = "chat" | "inbox" | "persona";

function getWorkspaceMcpUrl() {
  const url = process.env.WORKSPACE_MCP_URL;
  if (!url) {
    throw new Error(
      "WORKSPACE_MCP_URL is not set. Point it at the google_workspace_mcp server, e.g. http://localhost:8000/mcp"
    );
  }
  return url;
}

function allowlistFor(agent: McpAgentKind) {
  switch (agent) {
    case "chat":
      return CHAT_TOOL_ALLOWLIST;
    case "inbox":
      return INBOX_TOOL_ALLOWLIST;
    case "persona":
      return PERSONA_TOOL_ALLOWLIST;
  }
}

/**
 * Strip OAuth-injected keys and nulls. OAuth 2.1 schemas omit
 * user_google_email/service and often set additionalProperties:false, so
 * LangChain rejects those keys before the MCP call runs.
 */
export function sanitizeMcpToolArgs(
  args: Record<string, unknown>
): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (MCP_INJECTED_ARG_KEYS.has(key)) continue;
    if (value === null || value === undefined) continue;
    cleaned[key] = value;
  }
  return cleaned;
}

function escapeDriveQueryLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function isStructuredDriveQuery(query: string): boolean {
  return DRIVE_STRUCTURED_QUERY_RE.test(query);
}

function resolveDriveMimeTypes(fileType: string): string[] | null {
  const trimmed = fileType.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("application/") || trimmed.startsWith("text/")) {
    return [trimmed];
  }
  const mapped = DRIVE_MIME_BY_FILE_TYPE[trimmed.toLowerCase()];
  return mapped ? [...mapped] : null;
}

function mimeTypeOrClause(mimes: string[]): string {
  if (mimes.length === 1) {
    return `mimeType = '${escapeDriveQueryLiteral(mimes[0])}'`;
  }
  return `(${mimes
    .map((mime) => `mimeType = '${escapeDriveQueryLiteral(mime)}'`)
    .join(" or ")})`;
}

function extractFileTypeMimes(
  args: Record<string, unknown>
): string[] | null {
  const fileTypeRaw =
    typeof args.file_type === "string"
      ? args.file_type
      : typeof args.fileType === "string"
        ? args.fileType
        : undefined;
  return fileTypeRaw ? resolveDriveMimeTypes(fileTypeRaw) : null;
}

export type DriveSearchMatch = "name" | "fullText";

/**
 * Build a Drive API `q` for free-text: name-only or fullText-only, plus optional mime filter.
 */
export function buildDriveSearchQuery(
  plainQuery: string,
  mimes: string[] | null,
  match: DriveSearchMatch
): string {
  const escaped = escapeDriveQueryLiteral(plainQuery.trim());
  const field = match === "name" ? "name" : "fullText";
  const driveQuery = `${field} contains '${escaped}'`;
  if (!mimes?.length) return driveQuery;
  return `${driveQuery} and ${mimeTypeOrClause(mimes)}`;
}

/**
 * True when a search_drive_files MCP payload has no usable file hits.
 */
export function isEmptyDriveSearchResult(raw: string): boolean {
  const text = raw.trim();
  if (!text) return true;

  const lower = text.toLowerCase();
  if (
    /\b(no files?( found)?|0 files?|nothing found|no results?|empty)\b/i.test(
      lower
    ) &&
    !/\b[a-zA-Z0-9_-]{10,}\b/.test(text)
  ) {
    return true;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) return parsed.length === 0;
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      if (Array.isArray(obj.files)) return obj.files.length === 0;
      if (Array.isArray(obj.results)) return obj.results.length === 0;
      if (Array.isArray(obj.items)) return obj.items.length === 0;
      if (obj.count === 0 || obj.total === 0) return true;
    }
  } catch {
    // non-JSON below
  }

  if (/\b(?:id|file[_ ]?id)["'\s:=]+[a-zA-Z0-9_-]{10,}/i.test(text)) {
    return false;
  }
  if (/\b1[a-zA-Z0-9_-]{20,}\b/.test(text)) {
    return false;
  }

  if (/\b(no |none|not found|couldn't find|could not find)\b/i.test(lower)) {
    return true;
  }

  return false;
}

/**
 * Rewrite free-text search_drive_files args into a Drive API q.
 * Free-text defaults to `name` match; pass `fullText` for content fallback.
 * Structured queries pass through (optionally with mime from file_type).
 */
export function normalizeDriveSearchArgs(
  args: Record<string, unknown>,
  match: DriveSearchMatch = "name"
): Record<string, unknown> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) return args;

  const mimes = extractFileTypeMimes(args);

  if (isStructuredDriveQuery(query)) {
    if (!mimes || /\bmimeType\b/i.test(query)) {
      const next = { ...args };
      delete next.file_type;
      delete next.fileType;
      return next;
    }
    const next = { ...args };
    next.query = `(${query}) and ${mimeTypeOrClause(mimes)}`;
    delete next.file_type;
    delete next.fileType;
    return next;
  }

  const next: Record<string, unknown> = {
    ...args,
    query: buildDriveSearchQuery(query, mimes, match),
  };
  delete next.file_type;
  delete next.fileType;
  return next;
}

function isJsonSchemaObject(
  schema: unknown
): schema is Record<string, unknown> {
  return (
    typeof schema === "object" &&
    schema !== null &&
    !("parse" in schema) &&
    ("type" in schema || "properties" in schema)
  );
}

function resultToString(result: unknown): string {
  return typeof result === "string" ? result : JSON.stringify(result);
}

/**
 * Wrap an MCP tool so LLMs may still pass injected args / nulls without
 * failing client-side schema validation; we strip them before invoke.
 * search_drive_files: name contains first, then fullText if empty.
 */
function wrapMcpToolForOauth21(
  tool: StructuredToolInterface
): StructuredToolInterface {
  if (!(tool instanceof DynamicStructuredTool)) {
    return tool;
  }

  const originalSchema = tool.schema;
  const looseSchema = isJsonSchemaObject(originalSchema)
    ? { ...originalSchema, additionalProperties: true }
    : originalSchema;

  return new DynamicStructuredTool({
    name: tool.name,
    description: tool.description,
    schema: looseSchema,
    metadata: tool.metadata,
    func: async (args, _runManager, config) => {
      const sanitized = sanitizeMcpToolArgs(
        (args ?? {}) as Record<string, unknown>
      );

      if (tool.name !== "search_drive_files") {
        const result = await tool.invoke(sanitized, config);
        return resultToString(result);
      }

      const query =
        typeof sanitized.query === "string" ? sanitized.query.trim() : "";

      // Structured Drive q: single call (no name→content fallback).
      if (query && isStructuredDriveQuery(query)) {
        const structured = normalizeDriveSearchArgs(sanitized, "name");
        const result = await tool.invoke(structured, config);
        return resultToString(result);
      }

      const nameArgs = normalizeDriveSearchArgs(sanitized, "name");
      const nameResult = resultToString(await tool.invoke(nameArgs, config));
      if (!isEmptyDriveSearchResult(nameResult)) {
        return nameResult;
      }

      const textArgs = normalizeDriveSearchArgs(sanitized, "fullText");
      const textResult = resultToString(await tool.invoke(textArgs, config));
      if (isEmptyDriveSearchResult(textResult)) {
        return textResult;
      }

      return `[drive_search: fullText fallback after empty name match]\n${textResult}`;
    },
  });
}

/**
 * Load Google Workspace tools from the shared MCP server for one agent run.
 *
 * The server runs in external OAuth 2.1 provider mode: it stores no tokens
 * and expects the user's Google access token as a Bearer header on every
 * request. Callers must pass a fresh token from getValidGmailAccessToken
 * (refresh when TTL < 5 minutes). A new client is created per call so
 * tokens are never shared across users.
 */
export async function getWorkspaceMcpTools(
  accessToken: string,
  agent: McpAgentKind
): Promise<StructuredToolInterface[]> {
  const client = new MultiServerMCPClient({
    // Stateless HTTP: each tool call opens a fresh MCP session.
    useStandardContentBlocks: false,
    mcpServers: {
      workspace: {
        transport: "http",
        url: getWorkspaceMcpUrl(),
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        defaultToolTimeout: TOOL_CALL_TIMEOUT_MS,
      },
    },
  });

  const allowlist = allowlistFor(agent);
  const tools = await client.getTools();
  return tools
    .filter((tool) => allowlist.includes(tool.name))
    .map(wrapMcpToolForOauth21) as StructuredToolInterface[];
}

export async function invokeMcpTool(
  tools: StructuredToolInterface[],
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const tool = tools.find((item) => item.name === name);
  if (!tool) {
    throw new Error(`MCP tool not available: ${name}`);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      tool.invoke(sanitizeMcpToolArgs(args)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `timed out after ${Math.round(TOOL_CALL_TIMEOUT_MS / 1000)}s`
            )
          );
        }, TOOL_CALL_TIMEOUT_MS);
      }),
    ]);
    return typeof result === "string" ? result : JSON.stringify(result);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
