import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { createLlm } from "@/lib/agent/llm";
import { createGmailTools } from "@/lib/agent/tools/gmail";

export type ChatHistoryItem = {
  role: "user" | "assistant";
  content: string;
};

const SYSTEM_PROMPT = `You are MailMind, an AI email assistant.

You can inspect the user's Gmail inbox using tools. When asked about emails:
1. Use search_emails or list_emails to find relevant messages
2. Use read_email when the user needs full details or a summary of a specific message
3. Reply clearly with subject, sender, date, and a helpful summary

Do not invent emails. Only describe messages returned by tools.
If no emails match, say so clearly.
When drafting replies, say you will prepare a draft in a future version — do not claim you sent mail.`;

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

export async function runMailMindAgent(input: {
  message: string;
  history?: ChatHistoryItem[];
  accessToken: string;
  gmailEmail?: string | null;
}) {
  const llm = createLlm();
  const tools = createGmailTools(input.accessToken);
  const agent = createReactAgent({ llm, tools });

  const systemText = input.gmailEmail
    ? `${SYSTEM_PROMPT}\n\nConnected Gmail account: ${input.gmailEmail}`
    : SYSTEM_PROMPT;

  const messages: BaseMessage[] = [
    new SystemMessage(systemText),
    ...toLangChainMessages(input.history ?? []),
    new HumanMessage(input.message),
  ];

  const result = await agent.invoke({ messages });

  return extractReply(result.messages);
}
