import { END, START, StateGraph } from "@langchain/langgraph";
import { memoryGateNode } from "@/lib/agent/nodes/memory-gate";
import { MailMindState, type MailMindStateType } from "@/lib/agent/state";
import { createEmailSubgraph } from "@/lib/agent/subgraphs/email";
import { createFeedbackSubgraph } from "@/lib/agent/subgraphs/feedback";
import { createPersonaSubgraph } from "@/lib/agent/subgraphs/persona";
import { getMailMindMemoryStore } from "@/lib/memory/store";

function routeByEvent(state: MailMindStateType) {
  switch (state.eventType) {
    case "gmail_connected":
      return "persona_agent";
    case "chat":
    case "new_email":
      return "email_agent";
    case "feedback":
      return "feedback_agent";
    default:
      return END;
  }
}

let compiledMainGraph: ReturnType<typeof buildMainGraph> | null = null;

function buildMainGraph() {
  const personaAgent = createPersonaSubgraph();
  const emailAgent = createEmailSubgraph();
  const feedbackAgent = createFeedbackSubgraph();

  // Node names must not match state channel keys (e.g. `persona`).
  // memory_gate runs before every subgraph so preference updates are saved
  // before Email loads persona + memory.
  return new StateGraph(MailMindState)
    .addNode("memory_gate", memoryGateNode)
    .addNode("persona_agent", personaAgent)
    .addNode("email_agent", emailAgent)
    .addNode("feedback_agent", feedbackAgent)
    .addEdge(START, "memory_gate")
    .addConditionalEdges("memory_gate", routeByEvent, {
      persona_agent: "persona_agent",
      email_agent: "email_agent",
      feedback_agent: "feedback_agent",
      [END]: END,
    })
    .addEdge("persona_agent", END)
    .addEdge("email_agent", END)
    .addEdge("feedback_agent", END)
    // InMemoryStore caches user memory in-process; Supabase stays source of truth.
    .compile({ store: getMailMindMemoryStore() });
}

export function getMainGraph() {
  if (!compiledMainGraph) {
    compiledMainGraph = buildMainGraph();
  }
  return compiledMainGraph;
}

export async function invokeMainGraph(input: Partial<MailMindStateType>) {
  // Drop cached graph in dev when this module reloads so node changes apply.
  const graph = getMainGraph();

  return graph.invoke(input, {
    recursionLimit: 40,
    runName: `MailMind:${input.eventType ?? "unknown"}`,
    metadata: {
      userId: input.userId,
      eventType: input.eventType,
      chatThreadId: input.chatThreadId,
    },
    tags: ["mailmind", "main-graph", String(input.eventType ?? "unknown")],
  });
}
