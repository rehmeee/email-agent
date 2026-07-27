import { NextResponse } from "next/server";
import { runMailMindAgent } from "@/lib/agent/graph";
import { addChatMessage, updateChatMessageMetadata } from "@/lib/chat/threads";
import { resolveDraftFeedbackIntent } from "@/lib/drafts/intent";
import {
  buildDraftReviewReply,
  feedbackNeedsDriveTools,
  formatDraftPreviewBlock,
  type DraftPreview,
} from "@/lib/drafts/preview";
import {
  buildRedraftPrompt,
  DRAFT_PRAISE_REPLY,
} from "@/lib/drafts/redraft";
import type { AgentToolMode } from "@/lib/agent/state";
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
    const intent = await resolveDraftFeedbackIntent(feedback);

    // Praise: learn only — keep draft pending for thumbs-up.
    if (intent === "praise") {
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
          tags: ["draft-feedback", "praise"],
        },
      });

      const reply = `${DRAFT_PRAISE_REPLY} Thumbs up when you want it saved to Gmail → Drafts.`;

      let assistantMessageId: string | null = null;
      if (body.threadId) {
        await addChatMessage(body.threadId, "user", `Draft feedback: ${feedback}`);
        const assistantMessage = await addChatMessage(
          body.threadId,
          "assistant",
          reply,
          body.draft
            ? { draft: body.draft, draftStatus: "pending" }
            : null
        );
        assistantMessageId = assistantMessage.id;
      }

      return NextResponse.json({
        reply,
        draft: body.draft,
        messageId: assistantMessageId,
        draftStatus: "pending",
        intent: "praise",
        redrafted: false,
      });
    }

    if (intent === "other") {
      const reply =
        "Got it. Tell me what to change if you want a rewrite, or thumbs up to save this draft to Gmail.";
      let assistantMessageId: string | null = null;
      if (body.threadId) {
        await addChatMessage(body.threadId, "user", `Draft feedback: ${feedback}`);
        const assistantMessage = await addChatMessage(
          body.threadId,
          "assistant",
          reply,
          body.draft
            ? { draft: body.draft, draftStatus: "pending" }
            : null
        );
        assistantMessageId = assistantMessage.id;
      }
      return NextResponse.json({
        reply,
        draft: body.draft,
        messageId: assistantMessageId,
        draftStatus: "pending",
        intent: "other",
        redrafted: false,
      });
    }

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
      const redraftToolMode: AgentToolMode = feedbackNeedsDriveTools(feedback)
        ? "redraft_with_drive"
        : "propose_draft_only";

      const redraftResult = await runMailMindAgent({
        eventType: "chat",
        message: buildRedraftPrompt({
          draft: body.draft,
          feedback,
          withDrive: redraftToolMode === "redraft_with_drive",
        }),
        history: [],
        accessToken,
        gmailEmail: googleEmail,
        userId: user.id,
        chatThreadId: body.threadId,
        toolMode: redraftToolMode,
        reviewDraft: body.draft,
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
      intent: "revise",
      redrafted: Boolean(proposedDraft),
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
