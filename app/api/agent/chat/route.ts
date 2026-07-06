import { NextResponse } from "next/server";
import { runMailMindAgent, type ChatHistoryItem } from "@/lib/agent/graph";
import { getValidGmailAccessToken } from "@/lib/gmail/connection";
import { createClient } from "@/lib/supabase/server";

type ChatRequestBody = {
  message?: string;
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

  const history = Array.isArray(body.history) ? body.history : [];

  try {
    const { accessToken, googleEmail } = await getValidGmailAccessToken(user.id);
    const reply = await runMailMindAgent({
      message,
      history,
      accessToken,
      gmailEmail: googleEmail,
    });

    return NextResponse.json({ reply });
  } catch (error) {
    const rawMessage =
      error instanceof Error ? error.message : "Agent request failed";
    const errorMessage = rawMessage.includes("insufficient authentication scopes")
      ? "Gmail is missing inbox permissions. Click Reconnect Gmail on the dashboard, approve Gmail access, then try again."
      : rawMessage;

    return NextResponse.json({ error: errorMessage }, { status: 400 });
  }
}
