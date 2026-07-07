import { NextResponse } from "next/server";
import { runMailMindAgent, type ChatHistoryItem } from "@/lib/agent/graph";
import {
  addChatMessage,
  ensureChatThread,
  getChatThreadMessages,
} from "@/lib/chat/threads";
import { getValidGmailAccessToken } from "@/lib/gmail/connection";
import { createClient } from "@/lib/supabase/server";

type ChatRequestBody = {
  message?: string;
  threadId?: string | null;
  history?: ChatHistoryItem[];
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ChatRequestBody;

  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = body.message?.trim();

  if (!message) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  try {
    const thread = await ensureChatThread(user.id, body.threadId, message);
    const history =
      body.threadId != null
        ? (await getChatThreadMessages(user.id, thread.id)).map((item) => ({
            role: item.role,
            content: item.content,
          }))
        : Array.isArray(body.history)
          ? body.history
          : [];

    await addChatMessage(thread.id, "user", message);

    const { accessToken, googleEmail } = await getValidGmailAccessToken(user.id);
    const reply = await runMailMindAgent({
      message,
      history,
      accessToken,
      gmailEmail: googleEmail,
    });

    await addChatMessage(thread.id, "assistant", reply);

    return NextResponse.json({
      reply,
      threadId: thread.id,
      threadTitle: thread.title,
    });
  } catch (error) {
    const rawMessage =
      error instanceof Error ? error.message : "Agent request failed";
    const errorMessage = rawMessage.includes("insufficient authentication scopes")
      ? "Gmail is missing inbox or draft permissions. Click Reconnect Gmail on the dashboard, approve Gmail access, then try again."
      : rawMessage;

    return NextResponse.json({ error: errorMessage }, { status: 400 });
  }
}
