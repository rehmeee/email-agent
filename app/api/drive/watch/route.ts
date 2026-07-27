import { NextResponse } from "next/server";
import { registerDriveFileWatchForUser } from "@/lib/drive/events";
import { registerDriveChangesWatchForUser } from "@/lib/drive/watch";
import { getGmailConnectionStatus } from "@/lib/gmail/connection";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const fileId =
    body &&
    typeof body === "object" &&
    "fileId" in body &&
    typeof (body as { fileId?: unknown }).fileId === "string"
      ? (body as { fileId: string }).fileId.trim()
      : "";

  try {
    const status = await getGmailConnectionStatus(user.id);
    if (!status.connected) {
      return NextResponse.json(
        { error: "Connect Google before registering Drive watch." },
        { status: 400 }
      );
    }

    // Optional debug: watch a single file. Default: user-level changes.watch.
    if (fileId) {
      const watch = await registerDriveFileWatchForUser(user.id, fileId);
      return NextResponse.json({
        ok: true,
        mode: "file",
        fileId: watch.fileId,
        channelId: watch.channelId,
        resourceId: watch.resourceId,
        expiration: watch.expiration,
        webhookUrl: watch.webhookUrl,
      });
    }

    const watch = await registerDriveChangesWatchForUser(user.id);
    return NextResponse.json({
      ok: true,
      mode: "changes",
      channelId: watch.channelId,
      resourceId: watch.resourceId,
      expiration: watch.expiration,
      pageToken: watch.pageToken,
      webhookUrl: watch.webhookUrl,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to register Drive watch";
    console.error("[Drive Watch] Failed", { fileId: fileId || null, message });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
