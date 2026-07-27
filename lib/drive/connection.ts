import { createAdminClient } from "@/lib/supabase/admin";

function isMissingDriveWatchColumnError(message: string) {
  return (
    message.includes("drive_page_token") ||
    message.includes("drive_channel_id") ||
    message.includes("drive_resource_id") ||
    message.includes("drive_watch_expiration") ||
    (message.includes("gmail_connections") &&
      (message.includes("schema cache") ||
        message.includes("does not exist") ||
        message.includes("Could not find")))
  );
}

export type DriveWatchConnection = {
  userId: string;
  googleEmail: string | null;
  drivePageToken: string | null;
  driveChannelId: string | null;
  driveResourceId: string | null;
  driveWatchExpiration: string | null;
};

function mapRow(row: {
  user_id: string;
  google_email: string | null;
  drive_page_token?: string | null;
  drive_channel_id?: string | null;
  drive_resource_id?: string | null;
  drive_watch_expiration?: string | null;
}): DriveWatchConnection {
  return {
    userId: row.user_id,
    googleEmail: row.google_email,
    drivePageToken: row.drive_page_token ?? null,
    driveChannelId: row.drive_channel_id ?? null,
    driveResourceId: row.drive_resource_id ?? null,
    driveWatchExpiration: row.drive_watch_expiration ?? null,
  };
}

export async function getDriveWatchConnectionByUserId(
  userId: string
): Promise<DriveWatchConnection | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("gmail_connections")
    .select(
      "user_id, google_email, drive_page_token, drive_channel_id, drive_resource_id, drive_watch_expiration"
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (isMissingDriveWatchColumnError(error.message)) {
      throw new Error(
        "Database setup required. Run supabase/migrations/010_drive_watch.sql."
      );
    }
    throw new Error(`Failed to read Drive watch state: ${error.message}`);
  }

  if (!data) return null;
  return mapRow(data);
}

export async function getDriveWatchConnectionByChannelId(
  channelId: string
): Promise<DriveWatchConnection | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("gmail_connections")
    .select(
      "user_id, google_email, drive_page_token, drive_channel_id, drive_resource_id, drive_watch_expiration"
    )
    .eq("drive_channel_id", channelId)
    .maybeSingle();

  if (error) {
    if (isMissingDriveWatchColumnError(error.message)) {
      throw new Error(
        "Database setup required. Run supabase/migrations/010_drive_watch.sql."
      );
    }
    throw new Error(`Failed to lookup Drive channel: ${error.message}`);
  }

  if (!data) return null;
  return mapRow(data);
}

export async function updateDriveWatchState(
  userId: string,
  input: {
    drivePageToken?: string | null;
    driveChannelId?: string | null;
    driveResourceId?: string | null;
    driveWatchExpiration?: string | null;
  }
) {
  const admin = createAdminClient();
  const patch: Record<string, string | null> = {};

  if ("drivePageToken" in input) {
    patch.drive_page_token = input.drivePageToken ?? null;
  }
  if ("driveChannelId" in input) {
    patch.drive_channel_id = input.driveChannelId ?? null;
  }
  if ("driveResourceId" in input) {
    patch.drive_resource_id = input.driveResourceId ?? null;
  }
  if ("driveWatchExpiration" in input) {
    patch.drive_watch_expiration = input.driveWatchExpiration ?? null;
  }

  if (Object.keys(patch).length === 0) return;

  const { error } = await admin
    .from("gmail_connections")
    .update(patch)
    .eq("user_id", userId);

  if (error) {
    if (isMissingDriveWatchColumnError(error.message)) {
      throw new Error(
        "Database setup required. Run supabase/migrations/010_drive_watch.sql."
      );
    }
    throw new Error(`Failed to update Drive watch state: ${error.message}`);
  }
}

/** Renew when expiration is null or within `withinMs` (default 12h). */
export async function listDriveConnectionsNeedingWatchRenewal(
  withinMs = 12 * 60 * 60 * 1000
) {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() + withinMs).toISOString();

  const { data, error } = await admin
    .from("gmail_connections")
    .select("user_id, drive_watch_expiration")
    .or(
      `drive_watch_expiration.is.null,drive_watch_expiration.lt.${cutoff}`
    );

  if (error) {
    if (isMissingDriveWatchColumnError(error.message)) return [];
    throw new Error(`Failed to list Drive watch renewals: ${error.message}`);
  }

  return (data ?? []).map((row) => row.user_id as string);
}
