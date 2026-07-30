import { NextResponse } from "next/server";
import { listNotificationsForUser } from "@/lib/notifications/db";
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
    const { notifications, unreadCount } = await listNotificationsForUser(
      user.id
    );
    return NextResponse.json({
      notifications: notifications.map((item) => ({
        id: item.id,
        type: item.type,
        title: item.title,
        body: item.body,
        payload: item.payload,
        readAt: item.readAt,
        createdAt: item.createdAt,
        expiresAt: item.expiresAt,
      })),
      unreadCount,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load notifications";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
