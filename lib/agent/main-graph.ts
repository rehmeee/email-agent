import { END, START, StateGraph } from "@langchain/langgraph";
import { memoryGateNode } from "@/lib/agent/nodes/memory-gate";
import { MailMindState, type MailMindStateType } from "@/lib/agent/state";
import { createEmailSubgraph } from "@/lib/agent/subgraphs/email";
import { createFeedbackSubgraph } from "@/lib/agent/subgraphs/feedback";
import { getMailMindMemoryStore } from "@/lib/memory/store";

function routeByEvent(state: MailMindStateType) {
  switch (state.eventType) {
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
  const emailAgent = createEmailSubgraph();
  const feedbackAgent = createFeedbackSubgraph();

  // Persona is a standalone agent (lib/agent/agents/persona.ts) — not routed here.
  // memory_gate runs before email/feedback so preference updates are saved first.
  return new StateGraph(MailMindState)
    .addNode("memory_gate", memoryGateNode)
    .addNode("email_agent", emailAgent)
    .addNode("feedback_agent", feedbackAgent)
    .addEdge(START, "memory_gate")
    .addConditionalEdges("memory_gate", routeByEvent, {
      email_agent: "email_agent",
      feedback_agent: "feedback_agent",
      [END]: END,
    })
    .addEdge("email_agent", END)
    .addEdge("feedback_agent", END)
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
    runName: `MailMind:${input.eventType ?? "unknown"}`,
    metadata: {
      userId: input.userId,
      eventType: input.eventType,
      chatThreadId: input.chatThreadId,
    },
    tags: ["mailmind", "main-graph", String(input.eventType ?? "unknown")],
  });
}
