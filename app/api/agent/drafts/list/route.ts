import { NextResponse } from "next/server";
import {
  draftPreviewFromRecord,
  listActiveMailMindDrafts,
} from "@/lib/drafts/db";
import { getValidGmailAccessToken } from "@/lib/gmail/connection";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Ensure Gmail is connected (and token refreshable) before listing.
    await getValidGmailAccessToken(user.id);

    const records = await listActiveMailMindDrafts(user.id);
    const drafts = records.map((record) => ({
      id: record.id,
      gmailDraftId: record.gmailDraftId,
      source: record.source,
      sourceMessageId: record.sourceMessageId,
      to: record.to,
      subject: record.subject,
      body: record.body,
      gmailThreadId: record.gmailThreadId,
      inReplyTo: record.inReplyTo,
      references: record.references,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      draft: draftPreviewFromRecord(record),
    }));

    return NextResponse.json({ drafts });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load MailMind drafts";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
