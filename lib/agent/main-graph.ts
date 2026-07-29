import { END, START, StateGraph } from "@langchain/langgraph";
import { AGENT_RUN_TIMEOUT_MS } from "@/lib/agent/limits";
import { memoryGateNode } from "@/lib/agent/nodes/memory-gate";
import { MailMindState, type MailMindStateType } from "@/lib/agent/state";
import {
  callModel,
  finalize,
  loadPersonaMemory,
  routeAfterModel,
  runTools,
} from "@/lib/agent/subgraphs/email";
import {
  applyFeedback,
  loadPersona,
  savePersona,
} from "@/lib/agent/subgraphs/feedback";
import { getMailMindMemoryStore } from "@/lib/memory/store";

function routeByEvent(state: MailMindStateType) {
  switch (state.eventType) {
    case "chat":
    case "new_email":
      return "email_load_persona_memory";
    case "feedback":
      return "feedback_load_persona";
    default:
      return END;
  }
}

let compiledMainGraph: ReturnType<typeof buildMainGraph> | null = null;

function buildMainGraph() {
  // Flat email/feedback nodes (not nested compiles) — nested graphs duplicate
  // LangChainTracer end handlers when LANGSMITH_TRACING is on.
  // Persona is standalone (lib/agent/agents/persona.ts). memory_gate first.
  return new StateGraph(MailMindState)
    .addNode("memory_gate", memoryGateNode)
    .addNode("email_load_persona_memory", loadPersonaMemory)
    .addNode("email_call_model", callModel)
    .addNode("email_run_tools", runTools)
    .addNode("email_finalize", finalize)
    .addNode("feedback_load_persona", loadPersona)
    .addNode("feedback_apply", applyFeedback)
    .addNode("feedback_save", savePersona)
    .addEdge(START, "memory_gate")
    .addConditionalEdges("memory_gate", routeByEvent, {
      email_load_persona_memory: "email_load_persona_memory",
      feedback_load_persona: "feedback_load_persona",
      [END]: END,
    })
    .addEdge("email_load_persona_memory", "email_call_model")
    .addConditionalEdges("email_call_model", routeAfterModel, {
      run_tools: "email_run_tools",
      finalize: "email_finalize",
    })
    .addEdge("email_run_tools", "email_call_model")
    .addEdge("email_finalize", END)
    .addEdge("feedback_load_persona", "feedback_apply")
    .addEdge("feedback_apply", "feedback_save")
    .addEdge("feedback_save", END)
    .compile({ store: getMailMindMemoryStore() });
}

export function getMainGraph() {
  if (!compiledMainGraph) {
    compiledMainGraph = buildMainGraph();
  }
  return compiledMainGraph;
}

export async function invokeMainGraph(input: Partial<MailMindStateType>) {
  const graph = getMainGraph();

  return graph.invoke(input, {
    recursionLimit: 40,
    signal: AbortSignal.timeout(AGENT_RUN_TIMEOUT_MS),
    runName: `MailMind:${input.eventType ?? "unknown"}`,
    metadata: {
      userId: input.userId,
      eventType: input.eventType,
      chatThreadId: input.chatThreadId,
    },
    tags: ["mailmind", "main-graph", String(input.eventType ?? "unknown")],
  });
}
