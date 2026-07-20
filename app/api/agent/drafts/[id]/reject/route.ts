import { NextResponse } from "next/server";
import { runMailMindAgent } from "@/lib/agent/graph";
import { addChatMessage } from "@/lib/chat/threads";
import { getPendingDraft, markPendingDraftRejected } from "@/lib/drafts/db";
import {
  buildDraftReviewReply,
  formatDraftPreviewBlock,
  type PendingDraftPreview,
} from "@/lib/drafts/preview";
import { getValidGmailAccessToken } from "@/lib/gmail/connection";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type RejectBody = {
  feedback?: string;
};

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function POST(request: Request, context: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  let body: RejectBody;
  try {
    body = (await request.json()) as RejectBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const feedback = body.feedback?.trim();
  if (!feedback) {
    return NextResponse.json(
      { error: "Feedback is required when rejecting a draft" },
      { status: 400 }
    );
  }

  try {
    const pending = await getPendingDraft(user.id, id);
    if (!pending) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }
    if (pending.status !== "pending") {
      return NextResponse.json(
        { error: `Draft is already ${pending.status}` },
        { status: 400 }
      );
    }

    await markPendingDraftRejected(user.id, id, feedback);

    const { accessToken, googleEmail } = await getValidGmailAccessToken(user.id);

    // 1) Update writing persona from feedback (private; not shown to user)
    await runMailMindAgent({
      eventType: "feedback",
      userId: user.id,
      accessToken,
      gmailEmail: googleEmail,
      pendingDraftId: id,
      feedbackText: feedback,
      chatThreadId: pending.threadId,
      traceContext: {
        userId: user.id,
        chatThreadId: pending.threadId ?? undefined,
        environment: process.env.NODE_ENV ?? "development",
        tags: ["draft-reject", "feedback"],
      },
    });

    // 2) Propose improved draft
    let nextPendingDraftId: string | null = null;
    let pendingDraftPreview: PendingDraftPreview | null = null;
    let redraftError: string | null = null;

    try {
      const redraftMessage = `Rewrite an improved email draft using the user's feedback and updated writing persona. Call propose_draft exactly once with the improved email (keep the same recipient and thread ids when possible).

Rejected draft:
To: ${pending.toAddrs}
Subject: ${pending.subject}
Body:
${pending.body.slice(0, 2500)}

User feedback:
${feedback}

Do not explain what you changed. Only call propose_draft.`;

      const redraftResult = await runMailMindAgent({
        eventType: "chat",
        message: redraftMessage,
        history: [],
        accessToken,
        gmailEmail: googleEmail,
        userId: user.id,
        chatThreadId: pending.threadId,
        traceContext: {
          userId: user.id,
          chatThreadId: pending.threadId ?? undefined,
          environment: process.env.NODE_ENV ?? "development",
          tags: ["draft-reject", "redraft"],
        },
      });

      nextPendingDraftId = redraftResult.pendingDraftId ?? null;

      if (nextPendingDraftId) {
        const newDraft = await getPendingDraft(user.id, nextPendingDraftId);
        if (newDraft) {
          pendingDraftPreview = {
            to: newDraft.toAddrs,
            subject: newDraft.subject,
            body: newDraft.body,
          };
        }
      }
    } catch (error) {
      redraftError = errorMessage(error);
    }

    const reply = pendingDraftPreview
      ? buildDraftReviewReply({ afterFeedback: true })
      : redraftError
        ? "Got it — I'll keep this in mind. I couldn't generate a new draft right now. Please ask me to try again in a moment."
        : buildDraftReviewReply({ afterFeedback: true });

    const storedReply = pendingDraftPreview
      ? `${reply}\n\n${formatDraftPreviewBlock(pendingDraftPreview)}`
      : reply;

    if (pending.threadId) {
      await addChatMessage(
        pending.threadId,
        "user",
        `Reject feedback: ${feedback}`
      );
      await addChatMessage(pending.threadId, "assistant", storedReply);
    }

    return NextResponse.json({
      reply,
      pendingDraftId: nextPendingDraftId,
      pendingDraft: pendingDraftPreview,
      rejectedDraftId: id,
      redraftError,
    });
  } catch (error) {
    const message = errorMessage(error);
    return NextResponse.json(
      {
        error: message.includes("Provider returned error")
          ? "The AI provider failed while processing feedback. Please try again in a few seconds."
          : message,
      },
      { status: 400 }
    );
  }
}
