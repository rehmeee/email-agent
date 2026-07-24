import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import {
  DynamicStructuredTool,
  type StructuredToolInterface,
} from "@langchain/core/tools";

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

/**
 * Wrap an MCP tool so LLMs may still pass injected args / nulls without
 * failing client-side schema validation; we strip them before invoke.
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
      // Re-validate against the original strict schema after sanitizing.
      const result = await tool.invoke(sanitized, config);
      return typeof result === "string" ? result : JSON.stringify(result);
    },
  });
}

/**
 * Load Google Workspace tools from the shared MCP server for one agent run.
 *
 * The server runs in external OAuth 2.1 provider mode: it stores no tokens
 * and expects the user's Google access token as a Bearer header on every
 * request. Callers must pass a fresh token from getValidGmailAccessToken.
 * A new client is created per run so tokens are never shared across users.
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
  const result = await tool.invoke(sanitizeMcpToolArgs(args));
  return typeof result === "string" ? result : JSON.stringify(result);
}
