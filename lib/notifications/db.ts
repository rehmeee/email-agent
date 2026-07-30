import { createAdminClient } from "@/lib/supabase/admin";
import {
  NOTIFICATION_MAX_PER_USER,
  NOTIFICATION_READ_TTL_MS,
  NOTIFICATION_UNREAD_TTL_MS,
  type NotificationType,
} from "@/lib/notifications/constants";

export type NotificationRecord = {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
  readAt: string | null;
  createdAt: string;
  expiresAt: string;
};

type NotificationRow = {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  payload: Record<string, unknown> | null;
  dedupe_key: string;
  read_at: string | null;
  created_at: string;
  expires_at: string;
};

function mapRow(row: NotificationRow): NotificationRecord {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    body: row.body,
    payload: row.payload ?? {},
    dedupeKey: row.dedupe_key,
    readAt: row.read_at,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

function isMissingTableError(message: string) {
  return (
    message.includes("notifications") &&
    (message.includes("schema cache") ||
      message.includes("does not exist") ||
      message.includes("Could not find"))
  );
}

export async function deleteExpiredNotifications(input?: {
  userId?: string;
  limit?: number;
}) {
  const admin = createAdminClient();
  const limit = input?.limit ?? 500;
  const now = new Date().toISOString();

  let selectQuery = admin
    .from("notifications")
    .select("id")
    .lte("expires_at", now)
    .limit(limit);

  if (input?.userId) {
    selectQuery = selectQuery.eq("user_id", input.userId);
  }

  const { data, error } = await selectQuery;
  if (error) {
    if (isMissingTableError(error.message)) return 0;
    throw new Error(`Failed to cleanup notifications: ${error.message}`);
  }

  const ids = (data ?? []).map((row) => row.id as string);
  if (ids.length === 0) return 0;

  const { error: deleteError } = await admin
    .from("notifications")
    .delete()
    .in("id", ids);

  if (deleteError) {
    if (isMissingTableError(deleteError.message)) return 0;
    throw new Error(`Failed to cleanup notifications: ${deleteError.message}`);
  }
  return ids.length;
}

async function enforceUserCap(userId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("notifications")
    .select("id")
    .eq("user_id", userId)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  if (error) {
    if (isMissingTableError(error.message)) return;
    throw new Error(`Failed to list notifications for cap: ${error.message}`);
  }

  const rows = data ?? [];
  if (rows.length <= NOTIFICATION_MAX_PER_USER) return;

  const overflowIds = rows
    .slice(NOTIFICATION_MAX_PER_USER)
    .map((row) => row.id as string);

  if (overflowIds.length === 0) return;

  const { error: deleteError } = await admin
    .from("notifications")
    .delete()
    .in("id", overflowIds);

  if (deleteError && !isMissingTableError(deleteError.message)) {
    console.warn("[notifications] cap cleanup failed", deleteError.message);
  }
}

export async function createNotification(input: {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  dedupeKey: string;
  payload?: Record<string, unknown>;
}): Promise<NotificationRecord | null> {
  const admin = createAdminClient();
  const now = Date.now();
  const expiresAt = new Date(now + NOTIFICATION_UNREAD_TTL_MS).toISOString();

  const { data, error } = await admin
    .from("notifications")
    .upsert(
      {
        user_id: input.userId,
        type: input.type,
        title: input.title.slice(0, 200),
        body: input.body.slice(0, 1000),
        payload: input.payload ?? {},
        dedupe_key: input.dedupeKey,
        expires_at: expiresAt,
        read_at: null,
      },
      { onConflict: "user_id,dedupe_key", ignoreDuplicates: true }
    )
    .select("*")
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error.message)) {
      console.warn(
        "[notifications] table missing — run supabase/migrations/012_proactive_notifications.sql"
      );
      return null;
    }
    // Unique conflict with ignoreDuplicates can return empty; treat as ok.
    if (error.code === "23505") return null;
    throw new Error(`Failed to create notification: ${error.message}`);
  }

  await enforceUserCap(input.userId).catch((capError) => {
    console.warn("[notifications] enforce cap failed", capError);
  });

  return data ? mapRow(data as NotificationRow) : null;
}

export async function listNotificationsForUser(
  userId: string,
  limit = 30
): Promise<{ notifications: NotificationRecord[]; unreadCount: number }> {
  await deleteExpiredNotifications({ userId, limit: 100 }).catch(() => 0);

  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data, error } = await admin
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .gt("expires_at", now)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), NOTIFICATION_MAX_PER_USER));

  if (error) {
    if (isMissingTableError(error.message)) {
      return { notifications: [], unreadCount: 0 };
    }
    throw new Error(`Failed to list notifications: ${error.message}`);
  }

  const notifications = (data as NotificationRow[] | null)?.map(mapRow) ?? [];
  const unreadCount = notifications.filter((item) => !item.readAt).length;
  return { notifications, unreadCount };
}

export async function markNotificationsRead(input: {
  userId: string;
  ids?: string[];
  all?: boolean;
}): Promise<number> {
  const admin = createAdminClient();
  const now = Date.now();
  const readExpires = new Date(now + NOTIFICATION_READ_TTL_MS).toISOString();
  const readAt = new Date(now).toISOString();

  let query = admin
    .from("notifications")
    .update({
      read_at: readAt,
      expires_at: readExpires,
    })
    .eq("user_id", input.userId)
    .is("read_at", null)
    .gt("expires_at", readAt);

  if (input.all) {
    // mark all unread
  } else if (input.ids?.length) {
    query = query.in("id", input.ids);
  } else {
    return 0;
  }

  const { data, error } = await query.select("id");
  if (error) {
    if (isMissingTableError(error.message)) return 0;
    throw new Error(`Failed to mark notifications read: ${error.message}`);
  }

  // Shorten expiry for rows that already had a nearer expires_at.
  // PostgREST can't do least() in update easily; re-fetch and fix if needed.
  const ids = (data ?? []).map((row) => row.id as string);
  if (ids.length === 0) return 0;

  // Ensure expires_at is min(existing, read+48h) — update already set to read+48h;
  // if original was sooner it was overwritten; acceptable for short-lived inbox.
  return ids.length;
}
