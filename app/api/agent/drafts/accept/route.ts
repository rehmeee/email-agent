import { NextResponse } from "next/server";
import {
  addChatMessage,
  updateChatMessageMetadata,
} from "@/lib/chat/threads";
import type { DraftPreview } from "@/lib/drafts/preview";
import { createGmailDraft } from "@/lib/gmail/api";
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
    const { accessToken } = await getValidGmailAccessToken(user.id);
    const created = await createGmailDraft(accessToken, {
      to: body.draft.to,
      subject: body.draft.subject,
      body: body.draft.body,
      threadId: body.draft.gmailThreadId,
      inReplyTo: body.draft.inReplyTo,
      references: body.draft.references,
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
