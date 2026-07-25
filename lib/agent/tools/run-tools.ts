import type { BaseMessage } from "@langchain/core/messages";
import { ToolMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { TOOL_CALL_TIMEOUT_MS } from "@/lib/agent/limits";

function formatToolError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "Tool execution failed";

  if (/timed out/i.test(message)) {
    return `Tool error [timeout]: ${message}. Tell the user this action failed and they can retry.`;
  }

  if (
    /401|invalid_token|unauthorized|auth|scope|reconnect|expired/i.test(
      message
    )
  ) {
    return `Tool error [auth]: ${message}. Ask the user to reconnect Google / try again.`;
  }

  return `Tool error [unavailable]: ${message}. Tell the user this failed and they can retry.`;
}

async function invokeWithTimeout(
  tool: StructuredToolInterface,
  args: unknown,
  timeoutMs: number
): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      tool.invoke(args),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`)
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function isToolErrorContent(content: unknown): boolean {
  const text =
    typeof content === "string"
      ? content
      : content == null
        ? ""
        : JSON.stringify(content);
  return /^Tool error(?:\s*\[|$)/i.test(text.trim());
}

export async function runToolCalls(
  message: BaseMessage,
  tools: StructuredToolInterface[],
  options?: { timeoutMs?: number }
): Promise<ToolMessage[]> {
  const timeoutMs = options?.timeoutMs ?? TOOL_CALL_TIMEOUT_MS;
  const toolCalls =
    "tool_calls" in message && Array.isArray(message.tool_calls)
      ? message.tool_calls
      : [];

  if (toolCalls.length === 0) {
    return [];
  }

  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  return Promise.all(
    toolCalls.map(async (toolCall) => {
      const name = toolCall.name;
      const id = toolCall.id ?? name;
      const tool = byName.get(name);

      if (!tool) {
        return new ToolMessage({
          content: `Unknown tool: ${name}`,
          tool_call_id: id,
          name,
        });
      }

      try {
        const result = await invokeWithTimeout(tool, toolCall.args, timeoutMs);
        return new ToolMessage({
          content: typeof result === "string" ? result : JSON.stringify(result),
          tool_call_id: id,
          name,
        });
      } catch (error) {
        return new ToolMessage({
          content: formatToolError(error),
          tool_call_id: id,
          name,
        });
      }
    })
  );
}

export function hasToolCalls(message: BaseMessage) {
  return (
    "tool_calls" in message &&
    Array.isArray(message.tool_calls) &&
    message.tool_calls.length > 0
  );
}
