import { NextResponse } from "next/server";
import { runMailMindAgent } from "@/lib/agent/graph";
import { getPendingDraft } from "@/lib/drafts/db";
import { getValidGmailAccessToken } from "@/lib/gmail/connection";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    const pending = await getPendingDraft(user.id, id);
    if (!pending) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    const { accessToken, googleEmail } = await getValidGmailAccessToken(user.id);
    const result = await runMailMindAgent({
      eventType: "approve",
      userId: user.id,
      accessToken,
      gmailEmail: googleEmail,
      pendingDraftId: id,
      chatThreadId: pending.threadId,
      traceContext: {
        userId: user.id,
        chatThreadId: pending.threadId ?? undefined,
        environment: process.env.NODE_ENV ?? "development",
        tags: ["draft-approve"],
      },
    });

    return NextResponse.json({
      reply: result.reply,
      pendingDraftId: id,
      gmailDraftCreated: result.gmailDraftCreated ?? true,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to approve draft";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
