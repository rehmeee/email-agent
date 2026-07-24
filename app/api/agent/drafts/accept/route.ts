import { NextResponse } from "next/server";
import { createGmailDraftViaMcp } from "@/lib/agent/mcp-draft";
import {
  addChatMessage,
  updateChatMessageMetadata,
} from "@/lib/chat/threads";
import { saveMailMindDraft } from "@/lib/drafts/db";
import type { DraftPreview } from "@/lib/drafts/preview";
import { getValidGmailAccessToken } from "@/lib/gmail/connection";
import { createClient } from "@/lib/supabase/server";

type AcceptBody = {
  messageId?: string;
  threadId?: string | null;
  draft?: DraftPreview;
};

function isValidDraft(draft: DraftPreview | undefined): draft is DraftPreview {
  return Boolean(draft?.to?.trim() && draft?.subject?.trim() && draft?.body?.trim());
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: AcceptBody;
  try {
    body = (await request.json()) as AcceptBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isValidDraft(body.draft)) {
    return NextResponse.json(
      { error: "Draft to/subject/body are required" },
      { status: 400 }
    );
  }

  try {
    const { accessToken, googleEmail } = await getValidGmailAccessToken(user.id);
    if (!googleEmail) {
      throw new Error("Connected Gmail address is required to create a draft");
    }

    const created = await createGmailDraftViaMcp({
      accessToken,
      gmailEmail: googleEmail,
      draft: body.draft,
    });

    await saveMailMindDraft({
      userId: user.id,
      gmailDraftId: created.draftId,
      source: "chat",
      draft: body.draft,
    });

    if (body.messageId) {
      await updateChatMessageMetadata(user.id, body.messageId, {
        draft: body.draft,
        draftStatus: "accepted",
        gmailDraftId: created.draftId,
      });
    }

    const reply = "Draft saved to Gmail → Drafts. It was not sent.";
    if (body.threadId) {
      await addChatMessage(body.threadId, "assistant", reply);
    }

    return NextResponse.json({
      reply,
      gmailDraftId: created.draftId,
      gmailDraftCreated: true,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create Gmail draft";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
