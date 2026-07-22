import {
  AIMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { END, START, StateGraph } from "@langchain/langgraph";
import { createLlm } from "@/lib/agent/llm";
import { getWorkspaceMcpTools } from "@/lib/agent/mcp";
import { MailMindState, type MailMindStateType } from "@/lib/agent/state";
import { createProposeDraftTool } from "@/lib/agent/tools/gmail";
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
- The user message includes a Gmail message id and usually a conversation thread transcript (last up to 8 messages, including your prior sent replies).
- Prefer the provided thread context. Only call get_gmail_message_content if something critical is missing.
- Reply to the LATEST inbound ask. Do not rehash points you already answered in earlier sent messages unless the sender asks again.
- If the email is about scheduling a meeting/call/availability, call get_events before proposing times. Do not invent free/busy. Do NOT call create_event — only propose times in the draft.
- When drafting needs background info (contacts, proposals, prior notes), use search_drive_files then get_drive_file_content or read_sheet_values. Read at most 1–2 files and summarize — never paste raw file contents into the draft.
- Call draft_gmail_message with correct thread_id, in_reply_to, and references from the latest inbound message in the thread.
- draft_gmail_message writes into Gmail → Drafts immediately (do not wait for approval).
- Do not invent facts. Follow user memory for names/preferences; follow persona for voice only.
- Never claim you sent an email — draft_gmail_message only saves a draft.`;
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
- Use search_gmail_messages, get_gmail_message_content, and get_gmail_thread_content to inspect mail. Do not invent emails.
- Before drafting a reply in an existing conversation, call get_gmail_thread_content so you see prior messages (including your sent replies).
- Use get_events (and list_calendars if needed) when the user asks about availability, schedule, or what's on their calendar. Do not invent free/busy or events.
- When the user asks to schedule a meeting, call get_events to check the slot, then create_event on their calendar. Only add attendees when the user explicitly asked to invite them (Google emails invites immediately). Then call propose_draft for the confirmation email.
- When drafting needs background info from Drive/Docs/Sheets, use search_drive_files then get_drive_file_content or read_sheet_values. Read at most 1–2 files and summarize — never paste raw file contents into drafts.
- When the user wants a draft/reply, call propose_draft. Do NOT call draft_gmail_message or send mail yourself.
- After propose_draft, ask if the draft is OK or needs changes (thumbs up / thumbs down or reply in chat).
- Never claim you sent an email.
- Follow user memory for names/preferences; follow persona only for how the email prose sounds.
- If the user only updated a preference and asks for nothing else, confirm the update; do not invent email work.`;
}

async function toolsForEvent(
  state: MailMindStateType,
  handlers: {
    onProposed?: (draft: DraftPreview) => void;
  }
): Promise<StructuredToolInterface[]> {
  if (state.eventType === "new_email") {
    return getWorkspaceMcpTools(state.accessToken, "inbox");
  }

  const mcpTools = await getWorkspaceMcpTools(state.accessToken, "chat");
  return [
    ...mcpTools,
    createProposeDraftTool({
      onProposed: handlers.onProposed,
    }),
  ];
}

function draftCreatedFromToolMessages(messages: BaseMessage[]) {
  for (const message of messages) {
    const name =
      "name" in message && typeof message.name === "string"
        ? message.name
        : "";
    if (name !== "draft_gmail_message") continue;

    const content =
      typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content);
    // MCP draft tools typically echo a draft id in the result text.
    if (/draft/i.test(content) && !/error/i.test(content)) {
      const idMatch = content.match(
        /(?:draft[_ ]?id|id)["'\s:=]+([a-zA-Z0-9_-]+)/i
      );
      return idMatch?.[1] ?? "created";
    }
  }
  return null;
}

async function callModel(state: MailMindStateType) {
  const isNewEmail = state.eventType === "new_email";
  let reviewDraft = state.reviewDraft ?? null;

  const tools = await toolsForEvent(state, {
    onProposed: (draft) => {
      reviewDraft = draft;
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
  };
}

async function runTools(state: MailMindStateType) {
  const last = state.messages.at(-1);
  if (!last) return {};

  let reviewDraft = state.reviewDraft ?? null;

  const tools = await toolsForEvent(state, {
    onProposed: (draft) => {
      reviewDraft = draft;
    },
  });

  const toolMessages = await runToolCalls(last, tools);
  const createdDraftId =
    state.eventType === "new_email"
      ? draftCreatedFromToolMessages(toolMessages) ?? state.gmailDraftId
      : state.gmailDraftId;

  return {
    messages: toolMessages,
    reviewDraft,
    gmailDraftId: createdDraftId ?? null,
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
