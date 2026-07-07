import { NextResponse } from "next/server";
import { listGmailDrafts } from "@/lib/gmail/api";
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
    const { accessToken } = await getValidGmailAccessToken(user.id);
    const drafts = await listGmailDrafts(accessToken, 20);
    return NextResponse.json({ drafts });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load Gmail drafts";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
