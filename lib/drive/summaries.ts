import { createAdminClient } from "@/lib/supabase/admin";

export type DriveSummaryReason = "chat_miss" | "drive_event";
export type DriveSummaryStatus = "active" | "deleted";

export type DriveFileSummaryRecord = {
  userId: string;
  fileId: string;
  name: string;
  mimeType: string;
  description: string;
  summary: string;
  modifiedTime: string | null;
  sizeBytes: number | null;
  exportFormatHint: string | null;
  draftUseCount: number;
  status: DriveSummaryStatus;
  lastReason: DriveSummaryReason;
  createdAt: string;
  updatedAt: string;
};

type DriveSummaryRow = {
  user_id: string;
  file_id: string;
  name: string;
  mime_type: string;
  description: string;
  summary: string;
  modified_time: string | null;
  size_bytes: number | null;
  export_format_hint: string | null;
  draft_use_count: number;
  status: DriveSummaryStatus;
  last_reason: DriveSummaryReason;
  created_at: string;
  updated_at: string;
};

function isMissingTableError(message: string) {
  return (
    message.includes("drive_file_summaries") &&
    (message.includes("schema cache") ||
      message.includes("does not exist") ||
      message.includes("Could not find"))
  );
}

function mapRow(row: DriveSummaryRow): DriveFileSummaryRecord {
  return {
    userId: row.user_id,
    fileId: row.file_id,
    name: row.name,
    mimeType: row.mime_type,
    description: row.description ?? "",
    summary: row.summary,
    modifiedTime: row.modified_time,
    sizeBytes: row.size_bytes,
    exportFormatHint: row.export_format_hint,
    draftUseCount: row.draft_use_count ?? 0,
    status: row.status,
    lastReason: row.last_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getDriveFileSummary(
  userId: string,
  fileId: string
): Promise<DriveFileSummaryRecord | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("drive_file_summaries")
    .select("*")
    .eq("user_id", userId)
    .eq("file_id", fileId)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error.message)) return null;
    throw new Error(`Failed to load drive file summary: ${error.message}`);
  }

  if (!data) return null;
  const record = mapRow(data as DriveSummaryRow);
  return record.status === "active" ? record : null;
}

export async function upsertDriveFileSummary(input: {
  userId: string;
  fileId: string;
  name: string;
  mimeType: string;
  description: string;
  summary: string;
  modifiedTime?: string | null;
  sizeBytes?: number | null;
  exportFormatHint?: string | null;
  status?: DriveSummaryStatus;
  lastReason: DriveSummaryReason;
  /** When true, leave draft_use_count unchanged (default). */
  preserveUseCount?: boolean;
}): Promise<DriveFileSummaryRecord | null> {
  const admin = createAdminClient();

  const existing = await getDriveFileSummaryIncludingDeleted(
    input.userId,
    input.fileId
  );

  const row = {
    user_id: input.userId,
    file_id: input.fileId,
    name: input.name,
    mime_type: input.mimeType,
    description: input.description,
    summary: input.summary,
    modified_time: input.modifiedTime ?? null,
    size_bytes: input.sizeBytes ?? null,
    export_format_hint: input.exportFormatHint ?? null,
    status: input.status ?? "active",
    last_reason: input.lastReason,
    draft_use_count:
      input.preserveUseCount !== false && existing
        ? existing.draftUseCount
        : existing?.draftUseCount ?? 0,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await admin
    .from("drive_file_summaries")
    .upsert(row, { onConflict: "user_id,file_id" })
    .select("*")
    .single();

  if (error) {
    if (isMissingTableError(error.message)) {
      console.warn(
        "[drive_file_summaries] table missing — run supabase/migrations/009_drive_file_summaries.sql"
      );
      return null;
    }
    throw new Error(`Failed to upsert drive file summary: ${error.message}`);
  }

  return mapRow(data as DriveSummaryRow);
}

async function getDriveFileSummaryIncludingDeleted(
  userId: string,
  fileId: string
): Promise<DriveFileSummaryRecord | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("drive_file_summaries")
    .select("*")
    .eq("user_id", userId)
    .eq("file_id", fileId)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error.message)) return null;
    throw new Error(`Failed to load drive file summary: ${error.message}`);
  }

  return data ? mapRow(data as DriveSummaryRow) : null;
}

export async function markDriveFileSummaryDeleted(
  userId: string,
  fileId: string
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("drive_file_summaries")
    .update({
      status: "deleted",
      last_reason: "drive_event",
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("file_id", fileId);

  if (error) {
    if (isMissingTableError(error.message)) return;
    throw new Error(
      `Failed to mark drive file summary deleted: ${error.message}`
    );
  }
}

/**
 * Increment draft_use_count for each active indexed file attached to a draft.
 */
export async function incrementDriveFileDraftUseCounts(
  userId: string,
  fileIds: string[]
): Promise<void> {
  const unique = [
    ...new Set(fileIds.map((id) => id.trim()).filter(Boolean)),
  ];
  if (unique.length === 0) return;

  const admin = createAdminClient();

  for (const fileId of unique) {
    const existing = await getDriveFileSummary(userId, fileId);
    if (!existing) continue;

    const { error } = await admin
      .from("drive_file_summaries")
      .update({
        draft_use_count: existing.draftUseCount + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("file_id", fileId)
      .eq("status", "active");

    if (error) {
      if (isMissingTableError(error.message)) return;
      console.warn(
        `[drive_file_summaries] failed to increment use count for ${fileId}:`,
        error.message
      );
    }
  }
}
