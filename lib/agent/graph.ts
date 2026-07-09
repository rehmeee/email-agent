import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { createLlm } from "@/lib/agent/llm";
import { createGmailTools } from "@/lib/agent/tools/gmail";
import {
  type ChatHistoryItem,
  type MailMindAgentInput,
  wrapWithLangSmithTrace,
} from "@/lib/agent/tracing";

export type { ChatHistoryItem } from "@/lib/agent/tracing";

const SYSTEM_PROMPT = `You are MailMind, an AI email assistant.

You can inspect the user's Gmail inbox and create draft emails using tools.

When asked about emails:
1. Use search_emails or list_emails to find relevant messages
2. Use read_email when the user needs full details, a summary, or context for a reply
3. Reply clearly with subject, sender, date, and a helpful summary

When asked to draft or write an email:
1. If replying to an existing message, call read_email first to get threadId, replyToEmail, subject, and messageIdHeader
2. Call create_draft with to, subject, body, and for replies also threadId and inReplyTo (use messageIdHeader from read_email)
3. Use subject "Re: <original subject>" for replies unless the user specifies otherwise
4. Tell the user the draft was saved in Gmail → Drafts and was NOT sent

Rules:
- Do not invent emails. Only describe messages returned by tools.
- If no emails match, say so clearly.
- Never claim you sent an email. create_draft only saves a draft.
- Do not call create_draft without a clear recipient and body.`;

function toLangChainMessages(history: ChatHistoryItem[]): BaseMessage[] {
  return history.map((item) =>
    item.role === "user"
      ? new HumanMessage(item.content)
      : new AIMessage(item.content)
  );
}

function extractReply(messages: BaseMessage[]) {
  const last = messages.at(-1);

  if (!last) {
    return "I could not generate a response.";
  }

  if (typeof last.content === "string") {
    return last.content;
  }

  if (Array.isArray(last.content)) {
    return last.content
      .map((part) => {
        if (typeof part === "string") return part;
        if ("text" in part && typeof part.text === "string") return part.text;
        return "";
      })
      .join("\n")
      .trim();
  }

  return String(last.content);
}

async function runMailMindAgentImpl(input: MailMindAgentInput) {
  const llm = createLlm();
  const tools = createGmailTools(input.accessToken);
  const agent = createReactAgent({
    llm,
    tools,
    name: "MailMind",
  });

  const systemText = input.gmailEmail
    ? `${SYSTEM_PROMPT}\n\nConnected Gmail account: ${input.gmailEmail}`
    : SYSTEM_PROMPT;

  const messages: BaseMessage[] = [
    new SystemMessage(systemText),
    ...toLangChainMessages(input.history ?? []),
    new HumanMessage(input.message),
  ];

  const traceTags = ["mailmind", ...(input.traceContext?.tags ?? [])];

  const result = await agent.invoke(
    { messages },
    {
      runName: "MailMind Agent",
      metadata: {
        gmailEmail: input.gmailEmail ?? "unknown",
        historyLength: input.history?.length ?? 0,
        userId: input.traceContext?.userId,
        chatThreadId: input.traceContext?.chatThreadId,
        environment: input.traceContext?.environment,
      },
      tags: traceTags,
    }
  );

  return extractReply(result.messages);
}

export const runMailMindAgent = wrapWithLangSmithTrace(runMailMindAgentImpl);
