import { runDriveSummarizeAgent } from "@/lib/agent/agents/drive-summarize";
import { getValidGmailAccessToken } from "@/lib/gmail/connection";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getDriveFileSummary,
  markDriveFileSummaryDeleted,
} from "@/lib/drive/summaries";
import type { DriveChangeItem } from "@/lib/drive/watch";

/** Quiet window before a pending Drive change is processed. */
export const DRIVE_PENDING_QUIET_MS = 30 * 60 * 1000;

/** Stale claim recovery so a crashed drain can retry. */
const STALE_CLAIM_MS = 15 * 60 * 1000;

const DRAIN_BATCH_LIMIT = 20;

const TRACKED_MIME_TYPES = new Set([
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.spreadsheet",
  "application/pdf",
]);

type PendingRow = {
  user_id: string;
  file_id: string;
  last_event_at: string;
  removed: boolean;
  trashed: boolean;
  mime_type: string | null;
  name: string | null;
  event_count: number;
  processing_at: string | null;
};

function isMissingPendingTableError(message: string) {
  return (
    message.includes("drive_change_pending") &&
    (message.includes("does not exist") ||
      message.includes("Could not find the table") ||
      message.includes("schema cache"))
  );
}

export function isTrackedDriveMime(mimeType: string | null | undefined) {
  if (!mimeType) return false;
  return TRACKED_MIME_TYPES.has(mimeType.trim());
}

/**
 * Upsert a coalesced pending row for a Drive change (no LLM).
 * Skips non-Doc/Sheet/PDF unless the file is already in summaries.
 */
export async function upsertDriveChangePending(
  userId: string,
  change: DriveChangeItem
): Promise<boolean> {
  const fileId = change.fileId.trim();
  if (!fileId) return false;

  const mimeOk = isTrackedDriveMime(change.mimeType);
  if (!mimeOk && !change.removed && !change.trashed) {
    return false;
  }

  if (!mimeOk) {
    const existing = await getDriveFileSummary(userId, fileId);
    if (!existing) return false;
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data: prior } = await admin
    .from("drive_change_pending")
    .select("event_count, removed, trashed, mime_type, name")
    .eq("user_id", userId)
    .eq("file_id", fileId)
    .maybeSingle();

  const priorRow = prior as
    | {
        event_count: number;
        removed: boolean;
        trashed: boolean;
        mime_type: string | null;
        name: string | null;
      }
    | null;

  const row = {
    user_id: userId,
    file_id: fileId,
    last_event_at: now,
    removed: Boolean(priorRow?.removed) || change.removed,
    trashed: Boolean(priorRow?.trashed) || change.trashed,
    mime_type: change.mimeType ?? priorRow?.mime_type ?? null,
    name: change.name ?? priorRow?.name ?? null,
    event_count: (priorRow?.event_count ?? 0) + 1,
    processing_at: null,
  };

  const { error } = await admin
    .from("drive_change_pending")
    .upsert(row, { onConflict: "user_id,file_id" });

  if (error) {
    if (isMissingPendingTableError(error.message)) {
      console.warn(
        "[drive_change_pending] table missing — run supabase/migrations/011_drive_change_pending.sql"
      );
      return false;
    }
    throw new Error(`Failed to upsert drive_change_pending: ${error.message}`);
  }

  return true;
}

export async function clearDriveChangePending(
  userId: string,
  fileId: string
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("drive_change_pending")
    .delete()
    .eq("user_id", userId)
    .eq("file_id", fileId.trim());

  if (error) {
    if (isMissingPendingTableError(error.message)) return;
    console.warn(
      `[drive_change_pending] failed to clear ${fileId}:`,
      error.message
    );
  }
}

async function claimPendingRow(row: PendingRow): Promise<PendingRow | null> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const quietBefore = new Date(Date.now() - DRIVE_PENDING_QUIET_MS).toISOString();
  const staleLockBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();

  const { data, error } = await admin
    .from("drive_change_pending")
    .update({ processing_at: now })
    .eq("user_id", row.user_id)
    .eq("file_id", row.file_id)
    .lte("last_event_at", quietBefore)
    .or(`processing_at.is.null,processing_at.lt.${staleLockBefore}`)
    .select("*")
    .maybeSingle();

  if (error) {
    if (isMissingPendingTableError(error.message)) return null;
    console.warn(
      `[drive_change_pending] claim failed ${row.file_id}:`,
      error.message
    );
    return null;
  }

  return data ? (data as PendingRow) : null;
}

async function deletePendingRow(userId: string, fileId: string) {
  const admin = createAdminClient();
  await admin
    .from("drive_change_pending")
    .delete()
    .eq("user_id", userId)
    .eq("file_id", fileId);
}

async function releaseClaim(userId: string, fileId: string) {
  const admin = createAdminClient();
  await admin
    .from("drive_change_pending")
    .update({ processing_at: null })
    .eq("user_id", userId)
    .eq("file_id", fileId);
}

async function processClaimedRow(row: PendingRow): Promise<"deleted" | "summarized" | "skipped"> {
  if (row.removed || row.trashed) {
    await markDriveFileSummaryDeleted(row.user_id, row.file_id);
    await deletePendingRow(row.user_id, row.file_id);
    console.log("[Drive Pending] Marked deleted (no LLM)", {
      userId: row.user_id,
      fileId: row.file_id,
      name: row.name,
      eventCount: row.event_count,
    });
    return "deleted";
  }

  const mimeOk = isTrackedDriveMime(row.mime_type);
  const existing = await getDriveFileSummary(row.user_id, row.file_id);
  if (!mimeOk && !existing) {
    await deletePendingRow(row.user_id, row.file_id);
    return "skipped";
  }

  const { accessToken } = await getValidGmailAccessToken(row.user_id, {
    skipScopeCheck: true,
  });

  const result = await runDriveSummarizeAgent({
    userId: row.user_id,
    accessToken,
    fileId: row.file_id,
    reason: "drive_event",
    event: row.removed ? "deleted" : row.trashed ? "trashed" : "updated",
  });

  if (result.deleted) {
    await markDriveFileSummaryDeleted(row.user_id, row.file_id);
    await deletePendingRow(row.user_id, row.file_id);
    return "deleted";
  }

  if (result.error && !result.summary) {
    throw new Error(result.error);
  }

  await deletePendingRow(row.user_id, row.file_id);
  console.log("[Drive Pending] Summarized after quiet window", {
    userId: row.user_id,
    fileId: row.file_id,
    name: result.name || row.name,
    eventCount: row.event_count,
  });
  return "summarized";
}

export async function drainQuietDriveChangePending(): Promise<{
  checked: number;
  claimed: number;
  deleted: number;
  summarized: number;
  skipped: number;
  failed: Array<{ userId: string; fileId: string; error: string }>;
}> {
  const admin = createAdminClient();
  const quietBefore = new Date(Date.now() - DRIVE_PENDING_QUIET_MS).toISOString();
  const staleLockBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();

  const { data, error } = await admin
    .from("drive_change_pending")
    .select("*")
    .lte("last_event_at", quietBefore)
    .or(`processing_at.is.null,processing_at.lt.${staleLockBefore}`)
    .order("last_event_at", { ascending: true })
    .limit(DRAIN_BATCH_LIMIT);

  if (error) {
    if (isMissingPendingTableError(error.message)) {
      console.warn(
        "[drive_change_pending] table missing — run supabase/migrations/011_drive_change_pending.sql"
      );
      return {
        checked: 0,
        claimed: 0,
        deleted: 0,
        summarized: 0,
        skipped: 0,
        failed: [],
      };
    }
    throw new Error(`Failed to list drive_change_pending: ${error.message}`);
  }

  const candidates = (data ?? []) as PendingRow[];
  let claimed = 0;
  let deleted = 0;
  let summarized = 0;
  let skipped = 0;
  const failed: Array<{ userId: string; fileId: string; error: string }> = [];

  for (const candidate of candidates) {
    const locked = await claimPendingRow(candidate);
    if (!locked) continue;
    claimed += 1;

    try {
      const outcome = await processClaimedRow(locked);
      if (outcome === "deleted") deleted += 1;
      else if (outcome === "summarized") summarized += 1;
      else skipped += 1;
    } catch (err) {
      await releaseClaim(locked.user_id, locked.file_id);
      failed.push({
        userId: locked.user_id,
        fileId: locked.file_id,
        error: err instanceof Error ? err.message : "Drain failed",
      });
    }
  }

  return {
    checked: candidates.length,
    claimed,
    deleted,
    summarized,
    skipped,
    failed,
  };
}
