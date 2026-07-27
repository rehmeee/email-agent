import { randomUUID } from "crypto";
import { getValidGmailAccessToken } from "@/lib/gmail/connection";

export type DriveChannelNotification = {
  source: "drive_channel";
  channelId: string | null;
  resourceId: string | null;
  resourceState: string | null;
  resourceUri: string | null;
  changed: string | null;
  messageNumber: string | null;
  channelToken: string | null;
  channelExpiration: string | null;
  fileId: string | null;
};

export type DriveFileWatchResult = {
  fileId: string;
  channelId: string;
  resourceId: string;
  expiration: string | null;
  webhookUrl: string;
};

export type DrivePubSubNotification = {
  source: "pubsub";
  eventType: string | null;
  fileId: string | null;
  subscriptionName: string | null;
  messageId: string | null;
  attributes: Record<string, string>;
  data: unknown;
  rawDataText: string;
};

/** Public HTTPS URL Google will POST Drive channel notifications to. */
export function getDriveWebhookUrl() {
  const explicit = process.env.DRIVE_WEBHOOK_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!appUrl) {
    throw new Error(
      "Missing NEXT_PUBLIC_APP_URL (or DRIVE_WEBHOOK_URL). For local Drive watch, set NEXT_PUBLIC_APP_URL to your ngrok HTTPS URL."
    );
  }

  const base = appUrl.replace(/\/$/, "");
  if (base.includes("localhost") || base.startsWith("http://")) {
    throw new Error(
      `Drive files.watch requires a public HTTPS webhook. Set NEXT_PUBLIC_APP_URL to your ngrok URL (e.g. https://oxidizing-hush-recite.ngrok-free.dev), or set DRIVE_WEBHOOK_URL. Current: ${base}`
    );
  }

  return `${base}/api/drive/webhook`;
}

function extractFileIdFromUri(uri: string | null): string | null {
  if (!uri) return null;
  const match = uri.match(/\/files\/([^/?#]+)/);
  return match?.[1] ?? null;
}

/** Parse Drive API push-channel headers (files.watch / changes.watch). */
export function parseDriveChannelNotification(
  request: Request
): DriveChannelNotification | null {
  const channelId = request.headers.get("X-Goog-Channel-ID");
  const resourceState = request.headers.get("X-Goog-Resource-State");
  const resourceId = request.headers.get("X-Goog-Resource-ID");

  if (!channelId && !resourceState && !resourceId) {
    return null;
  }

  const resourceUri = request.headers.get("X-Goog-Resource-URI");

  return {
    source: "drive_channel",
    channelId,
    resourceId,
    resourceState,
    resourceUri,
    changed: request.headers.get("X-Goog-Changed"),
    messageNumber: request.headers.get("X-Goog-Message-Number"),
    channelToken: request.headers.get("X-Goog-Channel-Token"),
    channelExpiration: request.headers.get("X-Goog-Channel-Expiration"),
    fileId: extractFileIdFromUri(resourceUri),
  };
}

function extractFileIdFromUnknown(value: unknown): string | null {
  if (typeof value === "string") {
    const match = value.match(/files\/([a-zA-Z0-9_-]+)/);
    if (match?.[1]) return match[1];
    if (/^[a-zA-Z0-9_-]{10,}$/.test(value)) return value;
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractFileIdFromUnknown(item);
      if (found) return found;
    }
    return null;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["fileId", "file_id", "id", "name", "subject"]) {
      if (key in record) {
        const found = extractFileIdFromUnknown(record[key]);
        if (found) return found;
      }
    }
    for (const nested of Object.values(record)) {
      const found = extractFileIdFromUnknown(nested);
      if (found) return found;
    }
  }

  return null;
}

/** Optional fallback if a Pub/Sub push still hits this webhook. */
export function decodeDrivePubSubMessage(body: unknown): DrivePubSubNotification {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid Pub/Sub body");
  }

  const envelope = body as {
    message?: {
      data?: string;
      attributes?: Record<string, string>;
      messageId?: string;
      message_id?: string;
    };
    subscription?: string;
  };

  const message = envelope.message;
  if (!message?.data) {
    throw new Error("Missing Pub/Sub message.data");
  }

  const attributes = message.attributes ?? {};
  const rawDataText = Buffer.from(message.data, "base64").toString("utf-8");

  let data: unknown = rawDataText;
  try {
    data = JSON.parse(rawDataText) as unknown;
  } catch {
    // Keep raw string if not JSON.
  }

  if (
    data &&
    typeof data === "object" &&
    "emailAddress" in data &&
    "historyId" in data
  ) {
    throw new Error("Gmail Pub/Sub payload on Drive webhook — ignored");
  }

  const eventType =
    attributes["ce-type"] ??
    attributes["ce_type"] ??
    (typeof data === "object" &&
    data &&
    "type" in data &&
    typeof (data as { type?: unknown }).type === "string"
      ? (data as { type: string }).type
      : null);

  const fileId =
    extractFileIdFromUnknown(attributes["ce-subject"]) ??
    extractFileIdFromUnknown(attributes.subject) ??
    extractFileIdFromUnknown(data);

  return {
    source: "pubsub",
    eventType,
    fileId,
    subscriptionName: envelope.subscription ?? null,
    messageId: message.messageId ?? message.message_id ?? null,
    attributes,
    data,
    rawDataText,
  };
}

/**
 * Start a Drive API files.watch channel (GA). Works with consumer Gmail + drive.readonly.
 * Workspace Events Pub/Sub path is not used — it failed for consumer accounts.
 */
export async function startDriveFileWatch(input: {
  accessToken: string;
  fileId: string;
  webhookUrl?: string;
  channelToken?: string;
}) {
  const fileId = input.fileId.trim();
  if (!fileId) {
    throw new Error("fileId is required");
  }

  const webhookUrl = input.webhookUrl ?? getDriveWebhookUrl();
  const channelId = randomUUID();
  const channelToken = input.channelToken ?? `drive-file:${fileId}`;

  // Max ~1 day for Drive channels; request ~23h so renewals have headroom.
  const expirationMs = Date.now() + 23 * 60 * 60 * 1000;

  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/watch`,
    {
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
    }
  );

  const payload = (await response.json()) as {
    id?: string;
    resourceId?: string;
    expiration?: string;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(
      payload.error?.message ?? `Failed to start Drive file watch (${response.status})`
    );
  }

  if (!payload.id || !payload.resourceId) {
    throw new Error("Drive files.watch response missing id or resourceId");
  }

  return {
    fileId,
    channelId: payload.id,
    resourceId: payload.resourceId,
    expiration: payload.expiration
      ? new Date(Number(payload.expiration)).toISOString()
      : null,
    webhookUrl,
  } satisfies DriveFileWatchResult;
}

export async function stopDriveChannel(input: {
  accessToken: string;
  channelId: string;
  resourceId: string;
}) {
  const response = await fetch("https://www.googleapis.com/drive/v3/channels/stop", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: input.channelId,
      resourceId: input.resourceId,
    }),
  });

  if (!response.ok) {
    const payload = (await response.json()) as { error?: { message?: string } };
    throw new Error(
      payload.error?.message ?? `Failed to stop Drive channel (${response.status})`
    );
  }
}

export async function registerDriveFileWatchForUser(
  userId: string,
  fileId: string
) {
  const { accessToken } = await getValidGmailAccessToken(userId, {
    skipScopeCheck: true,
  });
  return startDriveFileWatch({ accessToken, fileId });
}
