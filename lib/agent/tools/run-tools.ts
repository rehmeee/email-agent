import type { BaseMessage } from "@langchain/core/messages";
import { ToolMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";

export async function runToolCalls(
  message: BaseMessage,
  tools: StructuredToolInterface[]
): Promise<ToolMessage[]> {
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
        });
      }

      try {
        const rawArgs = toolCall.args;
        const result = await tool.invoke(rawArgs);
        return new ToolMessage({
          content: typeof result === "string" ? result : JSON.stringify(result),
          tool_call_id: id,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Tool execution failed";
        return new ToolMessage({
          content: `Tool error: ${errorMessage}`,
          tool_call_id: id,
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
