import {
  getGmailMessage,
  getGmailThread,
  type GmailThreadMessage,
} from "@/lib/gmail/api";

export const RECENT_MESSAGE_LIMIT = 8;
export const MAX_BODY_CHARS = 1200;

function truncateBody(body: string, maxChars = MAX_BODY_CHARS) {
  const trimmed = body.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars).trim()}…`;
}

/**
 * Last min(8, length) messages for the prompt. Short threads use all messages.
 */
export function selectRecentThreadMessages(
  messages: GmailThreadMessage[],
  limit = RECENT_MESSAGE_LIMIT
) {
  if (messages.length === 0) return [];
  return messages.slice(-Math.max(1, limit));
}

export function formatThreadForPrompt(
  messages: GmailThreadMessage[],
  latestMessageId?: string | null
) {
  const recent = selectRecentThreadMessages(messages);
  if (recent.length === 0) {
    return "No thread messages available.";
  }

  const blocks = recent.map((message, index) => {
    const isLatest = latestMessageId
      ? message.id === latestMessageId
      : index === recent.length - 1;
    const role = message.isSent ? "YOU (sent)" : "THEM";
    const marker = isLatest ? " [LATEST — reply to this]" : "";

    return [
      `--- Message ${index + 1} (${role})${marker} ---`,
      `id: ${message.id}`,
      `threadId: ${message.threadId}`,
      `From: ${message.from}`,
      `To: ${message.to}`,
      `Date: ${message.date}`,
      `Subject: ${message.subject}`,
      `Message-ID: ${message.messageIdHeader || "(none)"}`,
      `Body:`,
      truncateBody(message.body),
    ].join("\n");
  });

  const latest = recent.find((m) => m.id === latestMessageId) ?? recent.at(-1);

  return [
    `Thread has ${messages.length} message(s); showing the last ${recent.length}.`,
    latest
      ? `Reply using threadId=${latest.threadId}, inReplyTo=${latest.messageIdHeader || "(omit if empty)"}, to=${latest.replyToEmail}.`
      : "",
    "",
    ...blocks,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Load thread context for drafting. Falls back to a single message if thread fetch fails.
 */
export async function loadThreadContextForReply(
  accessToken: string,
  messageId: string
): Promise<{
  threadContext: string;
  threadId: string | null;
  latestMessageId: string;
  messageCount: number;
  source: "thread" | "single_message";
}> {
  const latest = await getGmailMessage(accessToken, messageId, "full");

  try {
    const threadMessages = await getGmailThread(accessToken, latest.threadId);
    const threadContext = formatThreadForPrompt(threadMessages, messageId);

    return {
      threadContext,
      threadId: latest.threadId,
      latestMessageId: messageId,
      messageCount: threadMessages.length,
      source: "thread",
    };
  } catch (error) {
    console.warn("[Gmail Thread] Falling back to single message", {
      messageId,
      threadId: latest.threadId,
      error: error instanceof Error ? error.message : String(error),
    });

    const single: GmailThreadMessage = {
      id: latest.id,
      threadId: latest.threadId,
      subject: latest.subject,
      from: latest.from,
      to: latest.to,
      date: latest.date,
      snippet: latest.snippet,
      body: latest.body,
      messageIdHeader: latest.messageIdHeader,
      replyToEmail: latest.replyToEmail,
      labelIds: [],
      isSent: false,
    };

    return {
      threadContext: formatThreadForPrompt([single], messageId),
      threadId: latest.threadId,
      latestMessageId: messageId,
      messageCount: 1,
      source: "single_message",
    };
  }
}
