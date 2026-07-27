import { NextResponse } from "next/server";
import { createGmailDraftViaMcp } from "@/lib/agent/mcp-draft";
import { runMailMindAgent } from "@/lib/agent/graph";
import { resolveDraftFeedbackIntent } from "@/lib/drafts/intent";
import {
  draftPreviewFromRecord,
  getMailMindDraftForUser,
  supersedeMailMindDraft,
} from "@/lib/drafts/db";
import {
  feedbackNeedsDriveTools,
  type DraftPreview,
} from "@/lib/drafts/preview";
import {
  buildRedraftPrompt,
  DRAFT_PRAISE_REPLY,
} from "@/lib/drafts/redraft";
import type { AgentToolMode } from "@/lib/agent/state";
import { getValidGmailAccessToken } from "@/lib/gmail/connection";
import { createClient } from "@/lib/supabase/server";

type Body = {
  draftId?: string;
  feedback?: string;
};

function isValidDraft(draft: DraftPreview): boolean {
  return Boolean(draft.to?.trim() && draft.subject?.trim() && draft.body?.trim());
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const feedback = body.feedback?.trim();
  const draftId = body.draftId?.trim();
  if (!feedback) {
    return NextResponse.json({ error: "Feedback is required" }, { status: 400 });
  }
  if (!draftId) {
    return NextResponse.json({ error: "draftId is required" }, { status: 400 });
  }

  try {
    const existing = await getMailMindDraftForUser(user.id, draftId);
    if (!existing || existing.status !== "active") {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    const reviewDraft = draftPreviewFromRecord(existing);
    if (!isValidDraft(reviewDraft)) {
      return NextResponse.json(
        { error: "Stored draft is incomplete" },
        { status: 400 }
      );
    }

    const { accessToken, googleEmail } = await getValidGmailAccessToken(user.id);
    if (!googleEmail) {
      throw new Error("Connected Gmail address is required");
    }

    const intent = await resolveDraftFeedbackIntent(feedback);

    // Praise / compliment: teach persona only — do not rewrite or touch Gmail.
    if (intent === "praise" || intent === "other") {
      if (intent === "praise") {
        await runMailMindAgent({
          eventType: "feedback",
          userId: user.id,
          accessToken,
          gmailEmail: googleEmail,
          reviewDraft,
          feedbackText: feedback,
          traceContext: {
            userId: user.id,
            environment: process.env.NODE_ENV ?? "development",
            tags: ["draft-feedback", "drafts-panel", "praise"],
          },
        });
      }

      return NextResponse.json({
        reply:
          intent === "praise"
            ? DRAFT_PRAISE_REPLY
            : "Got it. Say what to change if you want a rewrite, or leave the draft as-is.",
        draft: reviewDraft,
        gmailDraftId: existing.gmailDraftId,
        id: existing.id,
        intent,
        personaUpdated: intent === "praise",
        redrafted: false,
      });
    }

    await runMailMindAgent({
      eventType: "feedback",
      userId: user.id,
      accessToken,
      gmailEmail: googleEmail,
      reviewDraft,
      feedbackText: feedback,
      traceContext: {
        userId: user.id,
        environment: process.env.NODE_ENV ?? "development",
        tags: ["draft-feedback", "drafts-panel"],
      },
    });

    const redraftToolMode: AgentToolMode = feedbackNeedsDriveTools(feedback)
      ? "redraft_with_drive"
      : "propose_draft_only";

    const redraftResult = await runMailMindAgent({
      eventType: "chat",
      message: buildRedraftPrompt({
        draft: reviewDraft,
        feedback,
        withDrive: redraftToolMode === "redraft_with_drive",
      }),
      history: [],
      accessToken,
      gmailEmail: googleEmail,
      userId: user.id,
      toolMode: redraftToolMode,
      reviewDraft,
      traceContext: {
        userId: user.id,
        environment: process.env.NODE_ENV ?? "development",
        tags: ["draft-feedback", "redraft", "drafts-panel"],
      },
    });

    const proposed = redraftResult.proposedDraft;
    if (!proposed || !isValidDraft(proposed)) {
      return NextResponse.json(
        {
          error:
            redraftResult.reply ||
            "Could not generate an improved draft. Persona was updated — try again.",
          personaUpdated: true,
        },
        { status: 400 }
      );
    }

    // Preserve threading / attachments from the original MailMind draft when redraft omits them.
    const nextDraft: DraftPreview = {
      ...proposed,
      gmailThreadId: proposed.gmailThreadId ?? existing.gmailThreadId ?? undefined,
      inReplyTo: proposed.inReplyTo ?? existing.inReplyTo ?? undefined,
      references: proposed.references ?? existing.references ?? undefined,
      attachments:
        proposed.attachments ??
        draftPreviewFromRecord(existing).attachments,
    };

    const created = await createGmailDraftViaMcp({
      accessToken,
      userId: user.id,
      gmailEmail: googleEmail,
      draft: nextDraft,
    });

    const saved = await supersedeMailMindDraft({
      userId: user.id,
      previous: existing,
      newGmailDraftId: created.draftId,
      draft: nextDraft,
    });

    return NextResponse.json({
      reply: "Updated your writing persona and replaced the Gmail draft.",
      draft: nextDraft,
      gmailDraftId: created.draftId,
      id: saved?.id ?? null,
      previousGmailDraftId: existing.gmailDraftId,
      intent: "revise",
      redrafted: true,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to revise draft";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
