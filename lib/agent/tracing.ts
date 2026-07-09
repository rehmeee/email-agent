import { traceable } from "langsmith/traceable";

export type ChatHistoryItem = {
  role: "user" | "assistant";
  content: string;
};

export type AgentTraceContext = {
  userId?: string;
  chatThreadId?: string;
  environment?: string;
  tags?: string[];
};

export type MailMindAgentInput = {
  message: string;
  history?: ChatHistoryItem[];
  accessToken: string;
  gmailEmail?: string | null;
  traceContext?: AgentTraceContext;
};

export function isLangSmithTracingEnabled() {
  return (
    process.env.LANGSMITH_TRACING === "true" ||
    process.env.LANGCHAIN_TRACING_V2 === "true"
  );
}

export function getLangSmithProject() {
  return (
    process.env.LANGSMITH_PROJECT ??
    process.env.LANGCHAIN_PROJECT ??
    "mailmind-default"
  );
}

export function redactAgentInput(input: MailMindAgentInput) {
  return {
    message: input.message,
    historyLength: input.history?.length ?? 0,
    gmailEmail: input.gmailEmail ?? null,
    traceContext: input.traceContext,
    accessToken: "[REDACTED]",
  };
}

export function wrapWithLangSmithTrace(fn: (input: MailMindAgentInput) => Promise<string>) {
  if (!isLangSmithTracingEnabled()) {
    return fn;
  }

  return traceable(fn, {
    name: "runMailMindAgent",
    run_type: "chain",
    processInputs: (inputs) => {
      const input =
        typeof inputs === "object" && inputs !== null && "input" in inputs
          ? (inputs.input as MailMindAgentInput)
          : (inputs as MailMindAgentInput);

      return redactAgentInput(input);
    },
  });
}
