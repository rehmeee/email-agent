import { NextResponse } from "next/server";
import { listChatThreads } from "@/lib/chat/threads";
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
    const threads = await listChatThreads(user.id);
    return NextResponse.json({ threads });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load chat threads";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
