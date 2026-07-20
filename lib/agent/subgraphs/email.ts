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

function buildNewEmailSystemPrompt(state: MailMindStateType) {
  return `You are MailMind running in background inbox mode (no human approval step).

Connected Gmail: ${state.gmailEmail ?? "unknown"}

Writing persona — use when drafting emails (voice/style only):
${formatPersonaForPrompt(state.persona)}

User memory — standing do / don't / facts (not writing style):
${formatMemoryForPrompt(state.agentMemory)}

Rules:
- The user message includes a Gmail message id. Call read_email for that id first.
- Decide whether the email deserves a human reply. Skip newsletters, automated alerts, no-reply senders, receipts, and marketing unless user memory says otherwise.
- If a reply is warranted, call create_draft with correct threadId, inReplyTo, and references from read_email. This writes a draft into Gmail → Drafts immediately (do not wait for approval).
- If no reply is warranted, respond with one short line starting with "Skipped:" and the reason. Do not call create_draft.
- Do not invent email content. Do not ask the user questions. Act autonomously.
- Never claim you sent an email — create_draft only saves a draft.`;
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

function toolsForEvent(
  state: MailMindStateType,
  handlers: {
    onProposed?: (id: string) => void;
    onCreated?: (id: string) => void;
  }
) {
  if (state.eventType === "approve") {
    return [
      createGmailDraftTool(state.accessToken, {
        onCreated: handlers.onCreated,
      }),
    ];
  }

  // Background push: write Gmail drafts directly (no Approve/Reject gate).
  if (state.eventType === "new_email") {
    return [
      ...createGmailReadTools(state.accessToken),
      createGmailDraftTool(state.accessToken, {
        onCreated: handlers.onCreated,
      }),
    ];
  }

  // Chat: propose for UI review first.
  return [
    ...createGmailReadTools(state.accessToken),
    createProposeDraftTool({
      userId: state.userId,
      chatThreadId: state.chatThreadId,
      onProposed: handlers.onProposed,
    }),
  ];
}

async function callModel(state: MailMindStateType) {
  const isApprove = state.eventType === "approve";
  const isNewEmail = state.eventType === "new_email";
  let proposedDraftId = state.pendingDraftId ?? null;
  let createdGmailDraftId = state.gmailDraftId ?? null;

  const tools = toolsForEvent(state, {
    onProposed: (id) => {
      proposedDraftId = id;
    },
    onCreated: (id) => {
      createdGmailDraftId = id;
    },
  });

  const llm = createLlm().bindTools(tools);
  const system = isApprove
    ? buildApproveSystemPrompt(state)
    : isNewEmail
      ? buildNewEmailSystemPrompt(state)
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

  let proposedDraftId = state.pendingDraftId ?? null;
  let createdGmailDraftId = state.gmailDraftId ?? null;

  const tools = toolsForEvent(state, {
    onProposed: (id) => {
      proposedDraftId = id;
    },
    onCreated: (id) => {
      createdGmailDraftId = id;
    },
  });

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

  if (state.eventType === "new_email") {
    return {
      reply: extractReplyText(state.messages),
      resultMeta: {
        gmailDraftCreated: Boolean(state.gmailDraftId),
        gmailDraftId: state.gmailDraftId ?? null,
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
