import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { END, START, StateGraph } from "@langchain/langgraph";
import { createLlm } from "@/lib/agent/llm";
import { MailMindState, type MailMindStateType } from "@/lib/agent/state";
import {
  createGmailDraftTool,
  createGmailReadTools,
  createProposeDraftTool,
} from "@/lib/agent/tools/gmail";
import { hasToolCalls, runToolCalls } from "@/lib/agent/tools/run-tools";
import { getPendingDraft, markPendingDraftApproved } from "@/lib/drafts/db";
import { formatMemoryForPrompt } from "@/lib/memory/db";
import { getAgentMemoryCached } from "@/lib/memory/store";
import { getPersonaProfile } from "@/lib/persona/db";
import {
  emptyPersonaProfile,
  formatPersonaForPrompt,
  normalizePersonaProfile,
} from "@/lib/persona/types";

function extractReplyText(messages: BaseMessage[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!(message instanceof AIMessage) && message._getType() !== "ai") {
      continue;
    }
    if (hasToolCalls(message)) continue;

    if (typeof message.content === "string" && message.content.trim()) {
      return message.content.trim();
    }

    if (Array.isArray(message.content)) {
      const text = message.content
        .map((part) => {
          if (typeof part === "string") return part;
          if ("text" in part && typeof part.text === "string") return part.text;
          return "";
        })
        .join("\n")
        .trim();
      if (text) return text;
    }
  }

  return "Done.";
}

async function loadPersonaMemory(state: MailMindStateType) {
  const [personaRecord, memoryLoad] = await Promise.all([
    getPersonaProfile(state.userId),
    state.agentMemory
      ? Promise.resolve({ memory: state.agentMemory, source: "state" as const })
      : getAgentMemoryCached(state.userId),
  ]);

  let pendingDraft = state.pendingDraft ?? null;
  if (state.eventType === "approve" && state.pendingDraftId && !pendingDraft) {
    pendingDraft = await getPendingDraft(state.userId, state.pendingDraftId);
  }

  return {
    persona: normalizePersonaProfile(
      personaRecord?.profile ?? emptyPersonaProfile()
    ),
    agentMemory: memoryLoad.memory,
    pendingDraft,
    resultMeta: {
      memorySource: "source" in memoryLoad ? memoryLoad.source : "state",
    },
  };
}

function buildChatSystemPrompt(state: MailMindStateType) {
  const memoryUpdate = state.memoryUpdateSummary
    ? `\nJust updated user memory from this message:\n${state.memoryUpdateSummary}\nAcknowledge briefly if the user only changed a preference.\n`
    : "";

  return `You are MailMind, the user's personal email agent.

Connected Gmail: ${state.gmailEmail ?? "unknown"}

Writing persona — use when drafting emails (voice/style only):
${formatPersonaForPrompt(state.persona)}

User memory — standing do / don't / facts (not writing style):
${formatMemoryForPrompt(state.agentMemory)}
${memoryUpdate}
Rules:
- Use list_emails, search_emails, and read_email to inspect mail. Do not invent emails.
- When the user wants a draft/reply, call propose_draft. Do NOT create a Gmail draft yourself.
- After propose_draft, tell the user the draft is ready for Approve / Reject in the chat UI.
- Never claim you sent an email.
- Follow user memory for names/preferences; follow persona only for how the email prose sounds.
- If the user only updated a preference and asks for nothing else, confirm the update; do not invent email work.`;
}

function buildApproveSystemPrompt(state: MailMindStateType) {
  const draft = state.pendingDraft;
  return `You are MailMind finalizing an approved email draft.

The user approved this pending draft. You MUST call create_draft exactly once with these fields:
- to: ${draft?.toAddrs ?? ""}
- subject: ${draft?.subject ?? ""}
- body: exactly the approved body below
- threadId: ${draft?.gmailThreadId ?? "(omit if empty)"}
- inReplyTo: ${draft?.inReplyTo ?? "(omit if empty)"}
- references: ${draft?.referencesHeader ?? "(omit if empty)"}

Approved body:
${draft?.body ?? ""}

After create_draft succeeds, briefly confirm the draft is in Gmail → Drafts and was not sent.`;
}

async function callModel(state: MailMindStateType) {
  const isApprove = state.eventType === "approve";
  let proposedDraftId = state.pendingDraftId ?? null;
  let createdGmailDraftId = state.gmailDraftId ?? null;

  const tools = isApprove
    ? [
        createGmailDraftTool(state.accessToken, {
          onCreated: (id) => {
            createdGmailDraftId = id;
          },
        }),
      ]
    : [
        ...createGmailReadTools(state.accessToken),
        createProposeDraftTool({
          userId: state.userId,
          chatThreadId: state.chatThreadId,
          onProposed: (id) => {
            proposedDraftId = id;
          },
        }),
      ];

  const llm = createLlm().bindTools(tools);
  const system = isApprove
    ? buildApproveSystemPrompt(state)
    : buildChatSystemPrompt(state);

  const response = await llm.invoke([
    new SystemMessage(system),
    ...state.messages,
  ]);

  return {
    messages: [response],
    pendingDraftId: proposedDraftId,
    gmailDraftId: createdGmailDraftId,
  };
}

async function runTools(state: MailMindStateType) {
  const last = state.messages.at(-1);
  if (!last) return {};

  const isApprove = state.eventType === "approve";
  let proposedDraftId = state.pendingDraftId ?? null;
  let createdGmailDraftId = state.gmailDraftId ?? null;

  const tools = isApprove
    ? [
        createGmailDraftTool(state.accessToken, {
          onCreated: (id) => {
            createdGmailDraftId = id;
          },
        }),
      ]
    : [
        ...createGmailReadTools(state.accessToken),
        createProposeDraftTool({
          userId: state.userId,
          chatThreadId: state.chatThreadId,
          onProposed: (id) => {
            proposedDraftId = id;
          },
        }),
      ];

  const toolMessages = await runToolCalls(last, tools);
  return {
    messages: toolMessages,
    pendingDraftId: proposedDraftId,
    gmailDraftId: createdGmailDraftId,
  };
}

function routeAfterModel(state: MailMindStateType) {
  const last = state.messages.at(-1);
  if (last && hasToolCalls(last)) {
    return "run_tools";
  }
  return "finalize";
}

async function finalize(state: MailMindStateType) {
  if (state.eventType === "approve") {
    if (state.pendingDraftId && state.gmailDraftId) {
      await markPendingDraftApproved(
        state.userId,
        state.pendingDraftId,
        state.gmailDraftId
      );
    }

    return {
      reply: extractReplyText(state.messages),
      resultMeta: {
        gmailDraftCreated: Boolean(state.gmailDraftId),
        pendingDraftId: state.pendingDraftId ?? null,
      },
    };
  }

  return {
    reply: extractReplyText(state.messages),
    resultMeta: {
      pendingDraftId: state.pendingDraftId ?? null,
    },
  };
}

export function createEmailSubgraph() {
  const graph = new StateGraph(MailMindState)
    .addNode("load_persona_memory", loadPersonaMemory)
    .addNode("call_model", callModel)
    .addNode("run_tools", runTools)
    .addNode("finalize", finalize)
    .addEdge(START, "load_persona_memory")
    .addEdge("load_persona_memory", "call_model")
    .addConditionalEdges("call_model", routeAfterModel, {
      run_tools: "run_tools",
      finalize: "finalize",
    })
    .addEdge("run_tools", "call_model")
    .addEdge("finalize", END);

  return graph.compile();
}

export function buildApproveMessages(pendingDraftId: string): BaseMessage[] {
  return [
    new HumanMessage(
      `The pending draft ${pendingDraftId} was approved. Call create_draft now with the approved fields from the system prompt.`
    ),
  ];
}
