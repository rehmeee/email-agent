import {
  AIMessage,
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
import type { DraftPreview } from "@/lib/drafts/preview";
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

  return {
    persona: normalizePersonaProfile(
      personaRecord?.profile ?? emptyPersonaProfile()
    ),
    agentMemory: memoryLoad.memory,
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
- Upstream triage already decided this email NEEDS a reply. Do not re-triage or skip.
- The user message includes a Gmail message id. Call read_email for that id first.
- Then call create_draft with a helpful reply using correct threadId, inReplyTo, and references from read_email.
- create_draft writes into Gmail → Drafts immediately (do not wait for approval).
- Do not invent facts. Follow user memory for names/preferences; follow persona for voice only.
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
- After propose_draft, ask if the draft is OK or needs changes (thumbs up / thumbs down or reply in chat).
- Never claim you sent an email.
- Follow user memory for names/preferences; follow persona only for how the email prose sounds.
- If the user only updated a preference and asks for nothing else, confirm the update; do not invent email work.`;
}

function toolsForEvent(
  state: MailMindStateType,
  handlers: {
    onProposed?: (draft: DraftPreview) => void;
    onCreated?: (id: string) => void;
  }
) {
  if (state.eventType === "new_email") {
    return [
      ...createGmailReadTools(state.accessToken),
      createGmailDraftTool(state.accessToken, {
        onCreated: handlers.onCreated,
      }),
    ];
  }

  return [
    ...createGmailReadTools(state.accessToken),
    createProposeDraftTool({
      onProposed: handlers.onProposed,
    }),
  ];
}

async function callModel(state: MailMindStateType) {
  const isNewEmail = state.eventType === "new_email";
  let reviewDraft = state.reviewDraft ?? null;
  let createdGmailDraftId = state.gmailDraftId ?? null;

  const tools = toolsForEvent(state, {
    onProposed: (draft) => {
      reviewDraft = draft;
    },
    onCreated: (id) => {
      createdGmailDraftId = id;
    },
  });

  const llm = createLlm().bindTools(tools);
  const system = isNewEmail
    ? buildNewEmailSystemPrompt(state)
    : buildChatSystemPrompt(state);

  const response = await llm.invoke([
    new SystemMessage(system),
    ...state.messages,
  ]);

  return {
    messages: [response],
    reviewDraft,
    gmailDraftId: createdGmailDraftId,
  };
}

async function runTools(state: MailMindStateType) {
  const last = state.messages.at(-1);
  if (!last) return {};

  let reviewDraft = state.reviewDraft ?? null;
  let createdGmailDraftId = state.gmailDraftId ?? null;

  const tools = toolsForEvent(state, {
    onProposed: (draft) => {
      reviewDraft = draft;
    },
    onCreated: (id) => {
      createdGmailDraftId = id;
    },
  });

  const toolMessages = await runToolCalls(last, tools);
  return {
    messages: toolMessages,
    reviewDraft,
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
    reviewDraft: state.reviewDraft ?? null,
    resultMeta: {
      proposedDraft: state.reviewDraft ?? null,
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
