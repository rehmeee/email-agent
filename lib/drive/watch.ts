import { randomUUID } from "crypto";
import {
  getDriveWatchConnectionByChannelId,
  getDriveWatchConnectionByUserId,
  updateDriveWatchState,
} from "@/lib/drive/connection";
import {
  getDriveWebhookUrl,
  parseDriveChannelNotification,
  stopDriveChannel,
  type DriveChannelNotification,
} from "@/lib/drive/events";
import { upsertDriveChangePending } from "@/lib/drive/pending";
import { getValidGmailAccessToken } from "@/lib/gmail/connection";

export type DriveChangeItem = {
  fileId: string;
  removed: boolean;
  name: string | null;
  mimeType: string | null;
  trashed: boolean;
};

export type DriveChangesWatchResult = {
  channelId: string;
  resourceId: string;
  expiration: string | null;
  pageToken: string;
  webhookUrl: string;
};

async function getStartPageToken(accessToken: string) {
  const response = await fetch(
    "https://www.googleapis.com/drive/v3/changes/startPageToken",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  const payload = (await response.json()) as {
    startPageToken?: string;
    error?: { message?: string };
  };

  if (!response.ok || !payload.startPageToken) {
    throw new Error(
      payload.error?.message ?? "Failed to get Drive startPageToken"
    );
  }

  return payload.startPageToken;
}

export async function startDriveChangesWatch(input: {
  accessToken: string;
  pageToken: string;
  webhookUrl?: string;
  channelToken?: string;
  userId?: string;
}) {
  const webhookUrl = input.webhookUrl ?? getDriveWebhookUrl();
  const channelId = randomUUID();
  const channelToken =
    input.channelToken ??
    (input.userId ? `drive-user:${input.userId}` : `drive-changes:${channelId}`);
  // changes.watch max TTL is ~7 days (files.watch is ~1 day). Google clamps to its limit.
  const expirationMs = Date.now() + 7 * 24 * 60 * 60 * 1000;

  const url = new URL("https://www.googleapis.com/drive/v3/changes/watch");
  url.searchParams.set("pageToken", input.pageToken);
  url.searchParams.set("supportsAllDrives", "true");

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: channelId,
      type: "web_hook",
      address: webhookUrl,
      token: channelToken,
      expiration: expirationMs,
    }),
  });

  const payload = (await response.json()) as {
    id?: string;
    resourceId?: string;
    expiration?: string;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(
      payload.error?.message ??
        `Failed to start Drive changes.watch (${response.status})`
    );
  }

  if (!payload.id || !payload.resourceId) {
    throw new Error("Drive changes.watch response missing id or resourceId");
  }

  return {
    channelId: payload.id,
    resourceId: payload.resourceId,
    expiration: payload.expiration
      ? new Date(Number(payload.expiration)).toISOString()
      : null,
    pageToken: input.pageToken,
    webhookUrl,
  } satisfies DriveChangesWatchResult;
}

export async function listDriveChanges(input: {
  accessToken: string;
  pageToken: string;
}) {
  const changes: DriveChangeItem[] = [];
  let pageToken = input.pageToken;
  let newStartPageToken: string | null = null;

  for (let page = 0; page < 20; page += 1) {
    const url = new URL("https://www.googleapis.com/drive/v3/changes");
    url.searchParams.set("pageToken", pageToken);
    url.searchParams.set("pageSize", "100");
    url.searchParams.set("includeRemoved", "true");
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set(
      "fields",
      "nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,trashed))"
    );

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${input.accessToken}` },
    });

    const payload = (await response.json()) as {
      changes?: Array<{
        fileId?: string;
        removed?: boolean;
        file?: {
          id?: string;
          name?: string;
          mimeType?: string;
          trashed?: boolean;
        };
      }>;
      nextPageToken?: string;
      newStartPageToken?: string;
      error?: { message?: string };
    };

    if (!response.ok) {
      throw new Error(
        payload.error?.message ?? `Failed to list Drive changes (${response.status})`
      );
    }

    for (const change of payload.changes ?? []) {
      const fileId = change.fileId ?? change.file?.id;
      if (!fileId) continue;
      changes.push({
        fileId,
        removed: Boolean(change.removed),
        name: change.file?.name ?? null,
        mimeType: change.file?.mimeType ?? null,
        trashed: Boolean(change.file?.trashed),
      });
    }

    if (payload.newStartPageToken) {
      newStartPageToken = payload.newStartPageToken;
    }

    if (!payload.nextPageToken) break;
    pageToken = payload.nextPageToken;
  }

  return {
    changes,
    newStartPageToken: newStartPageToken ?? pageToken,
  };
}

export async function registerDriveChangesWatchForUser(userId: string) {
  const { accessToken } = await getValidGmailAccessToken(userId, {
    skipScopeCheck: true,
  });

  const existing = await getDriveWatchConnectionByUserId(userId);

  if (existing?.driveChannelId && existing.driveResourceId) {
    try {
      await stopDriveChannel({
        accessToken,
        channelId: existing.driveChannelId,
        resourceId: existing.driveResourceId,
      });
    } catch {
      // Channel may already be expired.
    }
  }

  let pageToken = existing?.drivePageToken ?? null;
  if (!pageToken) {
    pageToken = await getStartPageToken(accessToken);
  }

  const watch = await startDriveChangesWatch({
    accessToken,
    pageToken,
    userId,
  });

  await updateDriveWatchState(userId, {
    drivePageToken: watch.pageToken,
    driveChannelId: watch.channelId,
    driveResourceId: watch.resourceId,
    driveWatchExpiration: watch.expiration,
  });

  return watch;
}

export async function unregisterDriveChangesWatchForUser(userId: string) {
  const existing = await getDriveWatchConnectionByUserId(userId);
  if (existing?.driveChannelId && existing.driveResourceId) {
    try {
      const { accessToken } = await getValidGmailAccessToken(userId, {
        skipScopeCheck: true,
      });
      await stopDriveChannel({
        accessToken,
        channelId: existing.driveChannelId,
        resourceId: existing.driveResourceId,
      });
    } catch {
      // Token/channel may already be invalid.
    }
  }

  await updateDriveWatchState(userId, {
    driveChannelId: null,
    driveResourceId: null,
    driveWatchExpiration: null,
  });
}

export async function processDriveChannelPush(
  notification: DriveChannelNotification
) {
  if (!notification.channelId) {
    console.warn("[Drive Push] Missing channel id");
    return { ok: true, matched: false };
  }

  if (notification.resourceState === "sync") {
    console.log("[Drive Push] Channel sync ack", {
      channelId: notification.channelId,
    });
    return { ok: true, matched: true, sync: true };
  }

  const connection = await getDriveWatchConnectionByChannelId(
    notification.channelId
  );
  if (!connection) {
    console.warn("[Drive Push] No connection for channel", notification.channelId);
    return { ok: true, matched: false };
  }

  if (!connection.drivePageToken) {
    console.warn("[Drive Push] Missing page token", connection.userId);
    return { ok: true, matched: true, skipped: "no_page_token" };
  }

  const { accessToken } = await getValidGmailAccessToken(connection.userId, {
    skipScopeCheck: true,
  });

  const listed = await listDriveChanges({
    accessToken,
    pageToken: connection.drivePageToken,
  });

  await updateDriveWatchState(connection.userId, {
    drivePageToken: listed.newStartPageToken,
  });

  let pendingUpserts = 0;
  for (const change of listed.changes) {
    try {
      const upserted = await upsertDriveChangePending(connection.userId, change);
      if (upserted) pendingUpserts += 1;
    } catch (error) {
      console.warn("[Drive Push] Pending upsert failed", {
        userId: connection.userId,
        fileId: change.fileId,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  console.log("[Drive Push] Changes sync", {
    userId: connection.userId,
    email: connection.googleEmail,
    resourceState: notification.resourceState,
    changeCount: listed.changes.length,
    pendingUpserts,
    changes: listed.changes.slice(0, 25),
  });

  return {
    ok: true,
    matched: true,
    userId: connection.userId,
    changeCount: listed.changes.length,
    pendingUpserts,
    changes: listed.changes,
  };
}

export function channelNotificationFromRequest(request: Request) {
  return parseDriveChannelNotification(request);
}
