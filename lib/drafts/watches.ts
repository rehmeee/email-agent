import { createAdminClient } from "@/lib/supabase/admin";
import {
  DRAFT_WATCH_DAYS,
  DRAFT_WATCH_MAX_PER_USER,
  DRAFT_WATCH_WINDOW_HOURS,
} from "@/lib/notifications/constants";

export type DraftWatchSource = "chat" | "inbox_important";

export type DraftWatchRecord = {
  id: string;
  userId: string;
  mailmindDraftId: string;
  gmailDraftId: string;
  source: DraftWatchSource;
  subject: string;
  windowOpen: string;
  windowEnd: string;
  createdAt: string;
};

type DraftWatchRow = {
  id: string;
  user_id: string;
  mailmind_draft_id: string;
  gmail_draft_id: string;
  source: DraftWatchSource;
  subject: string;
  window_open: string;
  window_end: string;
  created_at: string;
};

function mapRow(row: DraftWatchRow): DraftWatchRecord {
  return {
    id: row.id,
    userId: row.user_id,
    mailmindDraftId: row.mailmind_draft_id,
    gmailDraftId: row.gmail_draft_id,
    source: row.source,
    subject: row.subject,
    windowOpen: row.window_open,
    windowEnd: row.window_end,
    createdAt: row.created_at,
  };
}

function isMissingTableError(message: string) {
  return (
    message.includes("draft_watches") &&
    (message.includes("schema cache") ||
      message.includes("does not exist") ||
      message.includes("Could not find"))
  );
}

export function computeDraftWatchWindows(createdAt = new Date()) {
  const open = new Date(
    createdAt.getTime() +
      DRAFT_WATCH_DAYS * 24 * 60 * 60 * 1000 -
      DRAFT_WATCH_WINDOW_HOURS * 60 * 60 * 1000
  );
  const end = new Date(
    createdAt.getTime() +
      DRAFT_WATCH_DAYS * 24 * 60 * 60 * 1000 +
      DRAFT_WATCH_WINDOW_HOURS * 60 * 60 * 1000
  );
  return {
    windowOpen: open.toISOString(),
    windowEnd: end.toISOString(),
  };
}

export async function scheduleDraftWatch(input: {
  userId: string;
  mailmindDraftId: string;
  gmailDraftId: string;
  source: DraftWatchSource;
  subject: string;
  createdAt?: Date;
}): Promise<DraftWatchRecord | null> {
  const admin = createAdminClient();

  const { count, error: countError } = await admin
    .from("draft_watches")
    .select("id", { count: "exact", head: true })
    .eq("user_id", input.userId);

  if (countError && !isMissingTableError(countError.message)) {
    throw new Error(`Failed to count draft watches: ${countError.message}`);
  }

  if ((count ?? 0) >= DRAFT_WATCH_MAX_PER_USER) {
    if (input.source === "inbox_important") {
      console.log("[draft_watches] cap reached, skip inbox watch", {
        userId: input.userId,
      });
      return null;
    }
    // Chat: drop oldest to make room
    const { data: oldest } = await admin
      .from("draft_watches")
      .select("id")
      .eq("user_id", input.userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (oldest?.id) {
      await admin.from("draft_watches").delete().eq("id", oldest.id);
    }
  }

  const windows = computeDraftWatchWindows(input.createdAt ?? new Date());
  const { data, error } = await admin
    .from("draft_watches")
    .upsert(
      {
        user_id: input.userId,
        mailmind_draft_id: input.mailmindDraftId,
        gmail_draft_id: input.gmailDraftId,
        source: input.source,
        subject: input.subject.slice(0, 300),
        window_open: windows.windowOpen,
        window_end: windows.windowEnd,
      },
      { onConflict: "user_id,mailmind_draft_id" }
    )
    .select("*")
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error.message)) {
      console.warn(
        "[draft_watches] table missing — run supabase/migrations/012_proactive_notifications.sql"
      );
      return null;
    }
    throw new Error(`Failed to schedule draft watch: ${error.message}`);
  }

  return data ? mapRow(data as DraftWatchRow) : null;
}

export async function deleteDraftWatch(id: string) {
  const admin = createAdminClient();
  const { error } = await admin.from("draft_watches").delete().eq("id", id);
  if (error && !isMissingTableError(error.message)) {
    throw new Error(`Failed to delete draft watch: ${error.message}`);
  }
}

export async function listDueDraftWatches(limit = 80): Promise<DraftWatchRecord[]> {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data, error } = await admin
    .from("draft_watches")
    .select("*")
    .lte("window_open", now)
    .order("window_open", { ascending: true })
    .limit(limit);

  if (error) {
    if (isMissingTableError(error.message)) return [];
    throw new Error(`Failed to list due draft watches: ${error.message}`);
  }

  return (data as DraftWatchRow[] | null)?.map(mapRow) ?? [];
}

export async function deleteExpiredDraftWatches(): Promise<number> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("draft_watches")
    .delete()
    .lt("window_end", now)
    .select("id");

  if (error) {
    if (isMissingTableError(error.message)) return 0;
    throw new Error(`Failed to delete expired draft watches: ${error.message}`);
  }
  return data?.length ?? 0;
}
