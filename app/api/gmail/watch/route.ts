import { NextResponse } from "next/server";
import { getGmailConnectionStatus } from "@/lib/gmail/connection";
import { registerGmailWatchForUser } from "@/lib/gmail/watch";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const status = await getGmailConnectionStatus(user.id);
    if (!status.connected) {
      return NextResponse.json(
        { error: "Connect Gmail before registering inbox watch." },
        { status: 400 }
      );
    }

    const watch = await registerGmailWatchForUser(user.id);

    return NextResponse.json({
      ok: true,
      historyId: watch.historyId,
      watchExpiration: watch.expiration.toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to register Gmail watch";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
