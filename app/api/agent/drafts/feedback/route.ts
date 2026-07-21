import { NextResponse } from "next/server";
import { runMailMindAgent } from "@/lib/agent/graph";
import { addChatMessage, updateChatMessageMetadata } from "@/lib/chat/threads";
import {
  buildDraftReviewReply,
  formatDraftPreviewBlock,
  type DraftPreview,
} from "@/lib/drafts/preview";
import { getValidGmailAccessToken } from "@/lib/gmail/connection";
import { createClient } from "@/lib/supabase/server";

type FeedbackBody = {
  messageId?: string;
  threadId?: string | null;
  feedback?: string;
  draft?: DraftPreview;
};

function isValidDraft(draft: DraftPreview | undefined): draft is DraftPreview {
  return Boolean(draft?.to?.trim() && draft?.subject?.trim() && draft?.body?.trim());
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: FeedbackBody;
  try {
    body = (await request.json()) as FeedbackBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const feedback = body.feedback?.trim();
  if (!feedback) {
    return NextResponse.json(
      { error: "Feedback is required" },
      { status: 400 }
    );
  }
  if (!isValidDraft(body.draft)) {
    return NextResponse.json(
      { error: "Draft to/subject/body are required" },
      { status: 400 }
    );
  }

  try {
    const { accessToken, googleEmail } = await getValidGmailAccessToken(user.id);

    if (body.messageId) {
      await updateChatMessageMetadata(user.id, body.messageId, {
        draft: body.draft,
        draftStatus: "revised",
      });
    }

    await runMailMindAgent({
      eventType: "feedback",
      userId: user.id,
      accessToken,
      gmailEmail: googleEmail,
      reviewDraft: body.draft,
      feedbackText: feedback,
      chatThreadId: body.threadId,
      traceContext: {
        userId: user.id,
        chatThreadId: body.threadId ?? undefined,
        environment: process.env.NODE_ENV ?? "development",
        tags: ["draft-feedback"],
      },
    });

    let proposedDraft: DraftPreview | null = null;
    let redraftError: string | null = null;

    try {
      const redraftMessage = `Rewrite an improved email draft using the user's feedback and updated writing persona. Call propose_draft exactly once with the improved email (keep the same recipient and thread ids when possible).

Previous draft:
To: ${body.draft.to}
Subject: ${body.draft.subject}
Body:
${body.draft.body.slice(0, 2500)}

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
        chatThreadId: body.threadId,
        traceContext: {
          userId: user.id,
          chatThreadId: body.threadId ?? undefined,
          environment: process.env.NODE_ENV ?? "development",
          tags: ["draft-feedback", "redraft"],
        },
      });

      proposedDraft = redraftResult.proposedDraft ?? null;
    } catch (error) {
      redraftError = errorMessage(error);
    }

    const reply = proposedDraft
      ? buildDraftReviewReply({ afterFeedback: true })
      : redraftError
        ? "Got it — I'll keep this in mind. I couldn't generate a new draft right now. Please ask me to try again in a moment."
        : buildDraftReviewReply({ afterFeedback: true });

    const storedReply = proposedDraft
      ? `${reply}\n\n${formatDraftPreviewBlock(proposedDraft)}`
      : reply;

    let assistantMessageId: string | null = null;
    if (body.threadId) {
      await addChatMessage(body.threadId, "user", `Draft feedback: ${feedback}`);
      const assistantMessage = await addChatMessage(
        body.threadId,
        "assistant",
        storedReply,
        proposedDraft
          ? { draft: proposedDraft, draftStatus: "pending" }
          : null
      );
      assistantMessageId = assistantMessage.id;
    }

    return NextResponse.json({
      reply,
      draft: proposedDraft,
      messageId: assistantMessageId,
      draftStatus: proposedDraft ? "pending" : null,
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
