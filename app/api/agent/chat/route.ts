import { NextResponse } from "next/server";
import { runMailMindAgent, type ChatHistoryItem } from "@/lib/agent/graph";
import {
  addChatMessage,
  ensureChatThread,
  getChatThreadMessages,
} from "@/lib/chat/threads";
import { getPendingDraft } from "@/lib/drafts/db";
import {
  buildDraftReviewReply,
  formatDraftPreviewBlock,
  type PendingDraftPreview,
} from "@/lib/drafts/preview";
import { getValidGmailAccessToken } from "@/lib/gmail/connection";
import { createClient } from "@/lib/supabase/server";

type ChatRequestBody = {
  message?: string;
  threadId?: string | null;
  history?: ChatHistoryItem[];
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ChatRequestBody;

  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = body.message?.trim();

  if (!message) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  try {
    const thread = await ensureChatThread(user.id, body.threadId, message);
    const history =
      body.threadId != null
        ? (await getChatThreadMessages(user.id, thread.id)).map((item) => ({
            role: item.role,
            content: item.content,
          }))
        : Array.isArray(body.history)
          ? body.history
          : [];

    await addChatMessage(thread.id, "user", message);

    const { accessToken, googleEmail } = await getValidGmailAccessToken(user.id);
    const result = await runMailMindAgent({
      eventType: "chat",
      message,
      history,
      accessToken,
      gmailEmail: googleEmail,
      userId: user.id,
      chatThreadId: thread.id,
      traceContext: {
        userId: user.id,
        chatThreadId: thread.id,
        environment: process.env.NODE_ENV ?? "development",
        tags: ["gmail-agent", "chat"],
      },
    });

    let reply = result.reply;
    let pendingDraftPreview: PendingDraftPreview | null = null;

    if (result.pendingDraftId) {
      const draft = await getPendingDraft(user.id, result.pendingDraftId);
      if (draft) {
        pendingDraftPreview = {
          to: draft.toAddrs,
          subject: draft.subject,
          body: draft.body,
        };
        reply = buildDraftReviewReply();
      }
    }

    const storedReply = pendingDraftPreview
      ? `${reply}\n\n${formatDraftPreviewBlock(pendingDraftPreview)}`
      : reply;

    await addChatMessage(thread.id, "assistant", storedReply);

    return NextResponse.json({
      reply,
      threadId: thread.id,
      threadTitle: thread.title,
      pendingDraftId: result.pendingDraftId ?? null,
      pendingDraft: pendingDraftPreview,
      memorySaved: result.memorySaved ?? false,
    });
  } catch (error) {
    const rawMessage =
      error instanceof Error ? error.message : "Agent request failed";
    const errorMessage = rawMessage.includes("insufficient authentication scopes")
      ? "Gmail is missing inbox or draft permissions. Click Reconnect Gmail on the dashboard, approve Gmail access, then try again."
      : rawMessage;

    return NextResponse.json({ error: errorMessage }, { status: 400 });
  }
}
