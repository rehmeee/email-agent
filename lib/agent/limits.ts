/** Refresh Google access token if less than this much TTL remains. */
export const AGENT_TOKEN_MIN_TTL_MS = 5 * 60 * 1000;

/** Hard cap for a single tool invoke (MCP or local). */
export const TOOL_CALL_TIMEOUT_MS = 60_000;

/** Hard cap for the entire main-graph agent run (LangSmith must close). */
export const AGENT_RUN_TIMEOUT_MS = 5 * 60 * 1000;

/** After this many consecutive tool-error rounds, call the model without tools. */
export const MAX_CONSECUTIVE_TOOL_ERROR_ROUNDS = 2;
