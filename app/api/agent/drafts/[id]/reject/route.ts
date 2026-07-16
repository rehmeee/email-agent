import { NextResponse } from "next/server";
import { runMailMindAgent } from "@/lib/agent/graph";
import { addChatMessage } from "@/lib/chat/threads";
import { getPendingDraft, markPendingDraftRejected } from "@/lib/drafts/db";
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

    // 1) Update writing persona from feedback (resilient; should not 400 on provider blips)
    const feedbackResult = await runMailMindAgent({
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

    // 2) Propose improved draft — if provider fails, still return persona update
    let redraftReply = "";
    let nextPendingDraftId: string | null = null;
    let redraftError: string | null = null;

    try {
      const redraftMessage = `Rewrite an improved email draft using the user's feedback and updated writing persona. Call propose_draft once with the improved email (keep the same recipient and thread ids when possible).

Rejected draft:
To: ${pending.toAddrs}
Subject: ${pending.subject}
Body:
${pending.body.slice(0, 2500)}

User feedback:
${feedback}

After proposing, briefly explain what you changed.`;

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

      redraftReply = redraftResult.reply;
      nextPendingDraftId = redraftResult.pendingDraftId ?? null;
    } catch (error) {
      redraftError = errorMessage(error);
      redraftReply =
        "I saved your feedback to the writing persona, but could not generate a new draft yet. Please ask me to rewrite the draft again in a moment.";
    }

    const reply = [feedbackResult.reply, redraftReply]
      .filter(Boolean)
      .join("\n\n");

    if (pending.threadId) {
      await addChatMessage(
        pending.threadId,
        "user",
        `Reject feedback: ${feedback}`
      );
      await addChatMessage(pending.threadId, "assistant", reply);
    }

    return NextResponse.json({
      reply,
      pendingDraftId: nextPendingDraftId,
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
