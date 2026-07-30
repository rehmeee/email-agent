import { NextResponse } from "next/server";
import { cronUnauthorized, isCronAuthorized } from "@/lib/cron-auth";
import { deleteExpiredNotifications } from "@/lib/notifications/db";

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return cronUnauthorized();

  try {
    const deleted = await deleteExpiredNotifications({ limit: 500 });
    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Notification cleanup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return GET(request);
}
