import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  fetchGmailProfile,
  getValidGmailAccessToken,
  listRecentGmailMessages,
} from "@/lib/gmail/connection";

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
    const [profile, messages] = await Promise.all([
      fetchGmailProfile(accessToken),
      listRecentGmailMessages(accessToken, 5),
    ]);

    return NextResponse.json({
      connected: true,
      email: profile.emailAddress,
      messagesTotal: profile.messagesTotal,
      threadsTotal: profile.threadsTotal,
      recentMessageCount: messages.messages?.length ?? 0,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Gmail connection failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
