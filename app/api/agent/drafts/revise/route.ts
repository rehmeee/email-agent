import { NextResponse } from "next/server";
import { createGmailDraftViaMcp } from "@/lib/agent/mcp-draft";
import { runMailMindAgent } from "@/lib/agent/graph";
import {
  draftPreviewFromRecord,
  getMailMindDraftForUser,
  supersedeMailMindDraft,
} from "@/lib/drafts/db";
import type { DraftPreview } from "@/lib/drafts/preview";
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

    const redraftMessage = `Rewrite an improved email draft using the user's feedback and updated writing persona. Call propose_draft exactly once with the improved email (keep the same recipient and thread ids when possible).

Previous draft:
To: ${reviewDraft.to}
Subject: ${reviewDraft.subject}
Body:
${reviewDraft.body.slice(0, 2500)}

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
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to revise draft";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
