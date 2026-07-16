import { NextResponse } from "next/server";
import { deleteChatThread, getChatThreadMessages } from "@/lib/chat/threads";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { threadId } = await params;

  try {
    const messages = await getChatThreadMessages(user.id, threadId);
    return NextResponse.json({
      messages: messages.map(({ role, content }) => ({ role, content })),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load chat messages";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { threadId } = await params;

  try {
    await deleteChatThread(user.id, threadId);
    return NextResponse.json({ ok: true, threadId });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete chat";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
