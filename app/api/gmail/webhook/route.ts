import { after, NextResponse } from "next/server";
import {
  decodeGmailPubSubMessage,
  processGmailPushNotification,
} from "@/lib/gmail/sync";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const notification = decodeGmailPubSubMessage(body);

    after(async () => {
      try {
        await processGmailPushNotification(notification);
      } catch (error) {
        console.error("[Gmail Push] Background sync failed", error);
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid Pub/Sub payload";
    console.error("[Gmail Push] Webhook rejected", message);
    // Ack invalid payloads so Pub/Sub does not retry forever.
    return NextResponse.json({ ok: true, ignored: message });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "/api/gmail/webhook",
    note: "Gmail Pub/Sub push endpoint. POST only.",
  });
}
