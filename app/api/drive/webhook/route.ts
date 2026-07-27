import { after, NextResponse } from "next/server";
import {
  decodeDrivePubSubMessage,
  parseDriveChannelNotification,
} from "@/lib/drive/events";
import { processDriveChannelPush } from "@/lib/drive/watch";

export async function POST(request: Request) {
  const channel = parseDriveChannelNotification(request);
  if (channel) {
    after(async () => {
      try {
        await processDriveChannelPush(channel);
      } catch (error) {
        console.error("[Drive Push] Background sync failed", error);
      }
    });

    return NextResponse.json({
      ok: true,
      source: "drive_channel",
      resourceState: channel.resourceState,
      channelId: channel.channelId,
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: true, ignored: "empty body" });
  }

  try {
    const notification = decodeDrivePubSubMessage(body);

    after(async () => {
      console.log("[Drive Push] Pub/Sub event received", {
        eventType: notification.eventType,
        fileId: notification.fileId,
        messageId: notification.messageId,
        subscription: notification.subscriptionName,
        data: notification.data,
      });
    });

    return NextResponse.json({
      ok: true,
      source: "pubsub",
      eventType: notification.eventType,
      fileId: notification.fileId,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid Pub/Sub payload";
    console.error("[Drive Push] Webhook ignored", message);
    return NextResponse.json({ ok: true, ignored: message });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "/api/drive/webhook",
    note: "Drive changes.watch / files.watch push endpoint. POST only.",
  });
}
