import {
  AIMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { END, START, StateGraph } from "@langchain/langgraph";
import { createLlm } from "@/lib/agent/llm";
import { getWorkspaceMcpTools } from "@/lib/agent/mcp";
import { parseMcpDraftId } from "@/lib/agent/mcp-draft";
import { formatAgentNow } from "@/lib/agent/now";
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

const SHARED_REASONING = `Think like a proactive human assistant on EVERY task (email, calendar, search, Drive, prefs — not only meetings):

1. Reason first — What is the real goal? What do you already know? What is missing or ambiguous?
2. Inventory slots — mark each needed detail as known / recoverable via tools+memory / must-ask.
3. Gather before asking — if a careful human would check mail, calendar, contacts, or Drive first, do that. Prefer evidence over questions.
4. Ask when blocked — if a critical detail still cannot be recovered and guessing would do the wrong thing, ask one short focused question (or a tiny checklist). Do not interrogate.
5. Act — only then give a confident answer or call write tools. State defaults/assumptions briefly when you proceed with them (e.g. "I'll use 30 minutes unless you want longer").

Hard rules:
- Never invent free/busy, email addresses, file contents, commitments, or "I checked…" claims.
- Never call write tools (manage_event, propose_draft, draft_gmail_message) in the same turn as a blocking clarify — reply in text and wait.
- If tools return nothing useful or fail: degrade — admit the gap, ask briefly, or work only from known facts. Prefer an honest thin reply over a confident wrong one.
- When the ask is already complete and clear, act without unnecessary questions.`;

function buildNewEmailSystemPrompt(state: MailMindStateType) {
  return `You are MailMind running in background inbox mode (no human approval step).

${formatAgentNow({ memory: state.agentMemory })}

Connected Gmail: ${state.gmailEmail ?? "unknown"}

Writing persona — use when drafting emails (voice/style only):
${formatPersonaForPrompt(state.persona)}

User memory — standing do / don't / facts (working hours, timezone, names; not writing style):
${formatMemoryForPrompt(state.agentMemory)}

${SHARED_REASONING}

Inbox note: you cannot wait on the user mid-turn. Use thread + calendar + Drive evidence proactively; if something critical is missing, draft an honest reply that asks the sender (not the MailMind user) or states what could not be confirmed — never invent.

Rules:
- Upstream triage already decided this email NEEDS a reply. Do not re-triage or skip.
- The user message includes a Gmail message id and usually a conversation thread transcript (last up to 8 messages, including your prior sent replies).
- Prefer the provided thread context. Only call get_gmail_message_content if something critical is missing.
- Reply to the LATEST inbound ask. Do not rehash points you already answered in earlier sent messages unless the sender asks again.
- Scheduling: call get_events for the asked slot AND a nearby same-day window before proposing times. If busy, offer 2–3 real free alternatives (respect working hours in user memory). Do NOT call manage_event — only propose times in the draft. If calendar is empty or the tool fails, say availability could not be confirmed — never invent slots.
- When drafting needs background info (contacts, proposals, prior notes), use search_drive_files then get_drive_file_content or read_sheet_values. Read at most 1–2 files and summarize — never paste raw file contents into the draft. If nothing found, do not invent.
- Call draft_gmail_message with correct thread_id, in_reply_to, and references from the latest inbound message in the thread. Do NOT pass user_google_email — auth is already via the connected Gmail token.
- draft_gmail_message writes into Gmail → Drafts immediately (do not wait for approval).
- Follow user memory for names/preferences; follow persona for voice only.
- Never claim you sent an email — draft_gmail_message only saves a draft.`;
}

function buildChatSystemPrompt(state: MailMindStateType) {
  const memoryUpdate = state.memoryUpdateSummary
    ? `\nJust updated user memory from this message:\n${state.memoryUpdateSummary}\nAcknowledge briefly if the user only changed a preference.\n`
    : "";

  return `You are MailMind, the user's personal email agent — proactive, not a naive tool-caller.

${formatAgentNow({ memory: state.agentMemory })}

Connected Gmail: ${state.gmailEmail ?? "unknown"}

Writing persona — use when drafting emails (voice/style only):
${formatPersonaForPrompt(state.persona)}

User memory — standing do / don't / facts (working hours, timezone, names; not writing style):
${formatMemoryForPrompt(state.agentMemory)}
${memoryUpdate}
${SHARED_REASONING}

How you work (every request):
- Prefer useful prep (lookup, disambiguate, recover context, state a plan) over waiting passively.
- When the user is vague: try tools/memory first; ask only for what is still blocking.
- When the user is complete and clear: act without needless questions.
- After gathering, briefly say what you found or decided when that reduces surprise — then act or ask.

Rules:
- Use search_gmail_messages, get_gmail_message_content, and get_gmail_thread_content to inspect mail. Do not invent emails.
- Before drafting a reply in an existing conversation, call get_gmail_thread_content so you see prior messages (including your sent replies).
- Lookup asks (e.g. "what did we last discuss with X?") → search mail/threads and answer from evidence; do not invent.

Reading / listing mail (human defaults):
- When the user says "mails", "emails", "latest mail", "my mailbox", "what's in my inbox", or similar without specifying direction → they mean **incoming** mail. Search with \`in:inbox\` (optionally \`newer_than:…\` / \`is:unread\` if they said recent/unread). Never default to \`in:sent\`.
- Use \`in:sent\` / outgoing only when they explicitly ask for sent mail, "what I sent", "emails I wrote", or similar.
- If both inbox and sent could reasonably apply and the ask is still ambiguous after a moment of reasoning, ask once: inbox or sent? — do not silently pick sent.
- When summarizing results, prefer From / subject / date for inbox; for sent, prefer To / subject / date. Say which mailbox you searched.

Recipient resolution (when the user names a person to email/message, e.g. "send a message to Saira Fatima", "write to Sheryar" — not a full email address):
- Goal: help the user pick a **person (name + email)**, not old Gmail threads. Apply the reason → gather → ask → act loop.
- Prefer search_contacts for the name. If contacts fail or return nothing, search_gmail_messages, then extract **unique From/To email addresses** tied to that name (dedupe by email).
- NEVER show Gmail message links, thread links, or "Message 1 / Message 2" as choices for who to email — those are useless for picking a recipient.
- Format choices like:
  1. Saira Fatima — saira@example.com
  2. Saira Fatima — saira.f@company.com
  (optional short hint: "recent email Mar 2026" — never a mail.google.com link)
- 0 people/emails found → say you could not find them in Contacts or recent mail. Offer: (a) paste the email address, or (b) continue and propose_draft with To left for them to fill / use a placeholder only if they explicitly say draft without an address.
- 1 clear match → briefly confirm "I'll draft to Name <email>" then continue (MailMind drafts only — never send).
- 2+ matches → list name + email options and WAIT for the user to pick before drafting.
- "Send a message" means **draft** via propose_draft, not send mail.

Calendar / booking (same proactive habit — meetings are not a special mode):
- Use get_events (and list_calendars / query_freebusy if needed) for availability. Never invent free/busy.
- Before manage_event create, resolve gaps like a human would:
  1. Named attendees → search_contacts / Gmail first; never invent emails. 2+ people → WAIT. 0 matches → ask for email.
  2. Ambiguous time ("7 or 8", "sometime tomorrow", two options) → do not book both or guess. Check free/busy, then ask which slot — or offer 2–3 real free alternatives. Wait for one confirmed time.
  3. Missing subject/agenda → search recent mail/threads with that person. If a clear topic exists, propose it as the title and say so. If nothing useful, ask for the subject before creating.
  4. Missing duration → default sensibly (e.g. 30 minutes), state the default, and proceed unless the ask is sensitive.
- When one confirmed time + summary (known or explicitly defaulted) and the slot is free (or the user confirmed it): call manage_event with action="create", summary, start_time, end_time (RFC3339 / ISO with timezone), timezone, and attendees when inviting someone. Do NOT pass user_google_email.
- Optionally add_google_meet=true when a video call is useful or requested.
- If they also asked for an email, then propose_draft a confirmation to the attendees (after booking is clear).
- Only call manage_event (create/update/delete) when the user explicitly asked to change the calendar. Google may email invites immediately when attendees are added.
- To update or cancel an existing event, use manage_event with action="update" or action="delete" and the event_id from get_events.
- If calendar tools fail or return nothing useful, degrade — do not claim the meeting is booked.

Drive:
- When the task needs background from Drive/Docs/Sheets, search_drive_files then get_drive_file_content or read_sheet_values before claiming nothing exists. At most 1–2 files; summarize into the task. If nothing found, say so — do not invent.

Drafting (same habit):
- When the user wants a draft/reply: resolve recipient first; if purpose/subject/body is empty, recover from recent threads with that person. If still empty, ask what to say — do not propose_draft with invented content.
- When recipient + purpose are clear (or recovered), call propose_draft. Do NOT call draft_gmail_message or send mail yourself.
- After propose_draft, ask if the draft is OK or needs changes. The user can thumbs up, or reply in chat (e.g. "looks good", "ok perfect", "make the draft") to save it — do not call propose_draft again for the same approval.
- Never claim you sent an email.
- Follow user memory for names/preferences; follow persona only for how the email prose sounds.
- If the user only updated a preference and asks for nothing else, confirm the update; do not invent email work.
- Encourage lasting prefs like timezone and working hours into memory when the user states them.`;
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
    if (/error/i.test(content) && !/draft/i.test(content)) continue;

    const parsed = parseMcpDraftId(content);
    if (parsed) return parsed;
  }
  return null;
}

function extractDraftPreviewFromAiToolCall(
  message: BaseMessage | undefined
): DraftPreview | null {
  if (!message || !("tool_calls" in message) || !Array.isArray(message.tool_calls)) {
    return null;
  }

  for (const call of message.tool_calls) {
    if (call.name !== "draft_gmail_message") continue;
    const args = (call.args ?? {}) as Record<string, unknown>;
    const to = typeof args.to === "string" ? args.to.trim() : "";
    const subject = typeof args.subject === "string" ? args.subject.trim() : "";
    const body = typeof args.body === "string" ? args.body.trim() : "";
    if (!to || !subject || !body) continue;

    return {
      to,
      subject,
      body,
      gmailThreadId:
        typeof args.thread_id === "string" ? args.thread_id : undefined,
      inReplyTo:
        typeof args.in_reply_to === "string" ? args.in_reply_to : undefined,
      references:
        typeof args.references === "string" ? args.references : undefined,
    };
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
  const inboxDraftPreview = extractDraftPreviewFromAiToolCall(last);

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
    reviewDraft:
      state.eventType === "new_email" && inboxDraftPreview
        ? inboxDraftPreview
        : reviewDraft,
    gmailDraftId: createdDraftId ?? null,
    resultMeta:
      state.eventType === "new_email" && inboxDraftPreview
        ? { inboxDraftPreview }
        : {},
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
      reviewDraft: state.reviewDraft ?? null,
      resultMeta: {
        gmailDraftCreated: Boolean(state.gmailDraftId),
        gmailDraftId: state.gmailDraftId ?? null,
        inboxDraftPreview: state.reviewDraft ?? null,
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
