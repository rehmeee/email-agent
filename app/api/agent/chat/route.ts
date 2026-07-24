import { createGmailDraftViaMcp } from "@/lib/agent/mcp-draft";
import { saveMailMindDraft } from "@/lib/drafts/db";
import { resolvePendingDraftIntent } from "@/lib/drafts/intent";
import {
  buildDraftReviewReply,
  formatDraftPreviewBlock,
  type DraftPreview,
} from "@/lib/drafts/preview";
import { getValidGmailAccessToken } from "@/lib/gmail/connection";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { runMailMindAgent, type ChatHistoryItem } from "@/lib/agent/graph";
import {
  addChatMessage,
  ensureChatThread,
  findLatestPendingDraftMessage,
  getChatThreadMessages,
  updateChatMessageMetadata,
} from "@/lib/chat/threads";
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

    const pendingMessage = await findLatestPendingDraftMessage(
      user.id,
      thread.id
    );
    const pendingDraft = pendingMessage?.metadata?.draft ?? null;
    const pendingIntent = pendingDraft
      ? await resolvePendingDraftIntent(message)
      : null;

    // Natural language accept → create Gmail draft from last pending draft (MCP).
    if (pendingDraft && pendingIntent === "accept") {
      if (!googleEmail) {
        throw new Error("Connected Gmail address is required to create a draft");
      }

      const created = await createGmailDraftViaMcp({
        accessToken,
        gmailEmail: googleEmail,
        draft: pendingDraft,
      });

      await saveMailMindDraft({
        userId: user.id,
        gmailDraftId: created.draftId,
        source: "chat",
        draft: pendingDraft,
      });

      await updateChatMessageMetadata(user.id, pendingMessage!.id, {
        draft: pendingDraft,
        draftStatus: "accepted",
        gmailDraftId: created.draftId,
      });

      const reply = "Draft saved to Gmail → Drafts. It was not sent.";
      await addChatMessage(thread.id, "assistant", reply);

      return NextResponse.json({
        reply,
        threadId: thread.id,
        threadTitle: thread.title,
        draft: null,
        messageId: null,
        draftStatus: "accepted",
        gmailDraftCreated: true,
        memorySaved: false,
      });
    }

    // Explicit change requests → feedback + redraft (no thumbs down required).
    if (pendingDraft && pendingIntent === "revise") {
      await updateChatMessageMetadata(user.id, pendingMessage!.id, {
        draft: pendingDraft,
        draftStatus: "revised",
      });

      await runMailMindAgent({
        eventType: "feedback",
        userId: user.id,
        accessToken,
        gmailEmail: googleEmail,
        reviewDraft: pendingDraft,
        feedbackText: message,
        chatThreadId: thread.id,
        traceContext: {
          userId: user.id,
          chatThreadId: thread.id,
          environment: process.env.NODE_ENV ?? "development",
          tags: ["draft-feedback", "chat-nl"],
        },
      });

      const redraftMessage = `Rewrite an improved email draft using the user's feedback and updated writing persona. Call propose_draft exactly once with the improved email (keep the same recipient and thread ids when possible).

Previous draft:
To: ${pendingDraft.to}
Subject: ${pendingDraft.subject}
Body:
${pendingDraft.body.slice(0, 2500)}

User feedback:
${message}

Do not explain what you changed. Only call propose_draft.`;

      const redraftResult = await runMailMindAgent({
        eventType: "chat",
        message: redraftMessage,
        history: [],
        accessToken,
        gmailEmail: googleEmail,
        userId: user.id,
        chatThreadId: thread.id,
        traceContext: {
          userId: user.id,
          chatThreadId: thread.id,
          environment: process.env.NODE_ENV ?? "development",
          tags: ["draft-feedback", "redraft", "chat-nl"],
        },
      });

      const proposedDraft = redraftResult.proposedDraft ?? null;
      const reply = proposedDraft
        ? buildDraftReviewReply({ afterFeedback: true })
        : "Got it — I'll keep this in mind. Ask me to draft again if you want another version.";
      const storedReply = proposedDraft
        ? `${reply}\n\n${formatDraftPreviewBlock(proposedDraft)}`
        : reply;

      const assistantMessage = await addChatMessage(
        thread.id,
        "assistant",
        storedReply,
        proposedDraft
          ? { draft: proposedDraft, draftStatus: "pending" }
          : null
      );

      return NextResponse.json({
        reply,
        threadId: thread.id,
        threadTitle: thread.title,
        draft: proposedDraft,
        messageId: assistantMessage.id,
        draftStatus: proposedDraft ? "pending" : null,
        memorySaved: false,
      });
    }

    // pendingIntent === "other" (or no pending draft): normal chat.
    // If a draft is still pending, remind the model not to re-propose it.
    const agentMessage =
      pendingDraft && pendingIntent === "other"
        ? `${message}

[Context: A draft is still pending user review (To: ${pendingDraft.to}, Subject: ${pendingDraft.subject}). Do NOT call propose_draft again for that same email unless the user clearly asks for a new/different draft or changes. Answer their new request instead.]`
        : message;

    const result = await runMailMindAgent({
      eventType: "chat",
      message: agentMessage,
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
    let proposedDraft: DraftPreview | null = result.proposedDraft ?? null;

    if (proposedDraft) {
      reply = buildDraftReviewReply();
    }

    const storedReply = proposedDraft
      ? `${reply}\n\n${formatDraftPreviewBlock(proposedDraft)}`
      : reply;

    const assistantMessage = await addChatMessage(
      thread.id,
      "assistant",
      storedReply,
      proposedDraft
        ? { draft: proposedDraft, draftStatus: "pending" }
        : null
    );

    return NextResponse.json({
      reply,
      threadId: thread.id,
      threadTitle: thread.title,
      draft: proposedDraft,
      messageId: assistantMessage.id,
      draftStatus: proposedDraft ? "pending" : null,
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
