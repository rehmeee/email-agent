import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { StructuredToolInterface } from "@langchain/core/tools";

/**
 * Tools the chat agent may call. `create_event` is chat-only: the user
 * explicitly asked for the meeting, so no approval step is needed.
 */
const CHAT_TOOL_ALLOWLIST = [
  "search_gmail_messages",
  "get_gmail_message_content",
  "get_gmail_thread_content",
  "list_calendars",
  "get_events",
  "create_event",
  "search_drive_files",
  "get_drive_file_content",
  "read_sheet_values",
];

/**
 * Tools the ambient inbox agent may call. Never `create_event` (the agent
 * must only propose times in drafts), plus `draft_gmail_message` for
 * creating threaded reply drafts without an approval step.
 */
const INBOX_TOOL_ALLOWLIST = [
  ...CHAT_TOOL_ALLOWLIST.filter((name) => name !== "create_event"),
  "draft_gmail_message",
];

/** Persona bootstrap: Sent-mail search + batch content only. */
const PERSONA_TOOL_ALLOWLIST = [
  "search_gmail_messages",
  "get_gmail_messages_content_batch",
  "get_gmail_message_content",
];

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
  return tools.filter((tool) =>
    allowlist.includes(tool.name)
  ) as StructuredToolInterface[];
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
  const result = await tool.invoke(args);
  return typeof result === "string" ? result : JSON.stringify(result);
}
