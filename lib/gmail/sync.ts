import { runMailMindAgent } from "@/lib/agent/graph";
import { listGmailHistory } from "@/lib/gmail/api";
import {
  getGmailConnectionByGoogleEmail,
  getValidGmailAccessToken,
  updateGmailWatchState,
} from "@/lib/gmail/connection";
import {
  isGmailMessageProcessed,
  markGmailMessageProcessed,
} from "@/lib/gmail/processed";
import { fetchAndTriageGmailMessage } from "@/lib/gmail/triage";
import { seedHistoryIdFromProfile } from "@/lib/gmail/watch";

function historyIdTooOldError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("historyid") ||
    message.includes("history id") ||
    message.includes("not found") ||
    message.includes("404")
  );
}

async function resolveStartHistoryId(
  userId: string,
  accessToken: string,
  storedHistoryId: string | null,
  notificationHistoryId?: string
) {
  if (storedHistoryId) return storedHistoryId;
  if (notificationHistoryId) return notificationHistoryId;

  const seeded = await seedHistoryIdFromProfile(userId, accessToken);
  if (seeded) return seeded;

  throw new Error("No Gmail historyId available for sync");
}

export async function processNewGmailMessage(input: {
  userId: string;
  accessToken: string;
  gmailEmail: string | null;
  messageId: string;
}) {
  const alreadyProcessed = await isGmailMessageProcessed(
    input.userId,
    input.messageId
  );
  if (alreadyProcessed) {
    return { skipped: true, reason: "already_processed" as const };
  }

  const { triage } = await fetchAndTriageGmailMessage(
    input.accessToken,
    input.messageId
  );

  if (triage.decision === "skip") {
    await markGmailMessageProcessed(input.userId, input.messageId, "skipped");
    return {
      skipped: true,
      reason: triage.reason,
      action: "skipped" as const,
      gmailDraftCreated: false,
      reply: `Skipped: ${triage.reason}`,
      triage,
    };
  }

  const result = await runMailMindAgent({
    eventType: "new_email",
    userId: input.userId,
    accessToken: input.accessToken,
    gmailEmail: input.gmailEmail,
    gmailMessageId: input.messageId,
    triageReason: triage.reason,
    traceContext: {
      userId: input.userId,
      environment: process.env.NODE_ENV ?? "development",
      tags: ["gmail-push", "new-email", "needs-reply"],
    },
  });

  const action = result.gmailDraftCreated ? "drafted" : "skipped";
  await markGmailMessageProcessed(input.userId, input.messageId, action);

  return {
    skipped: !result.gmailDraftCreated,
    reason: result.gmailDraftCreated
      ? triage.reason
      : result.reply || "Agent did not create a draft",
    action,
    gmailDraftCreated: Boolean(result.gmailDraftCreated),
    reply: result.reply,
    triage,
  };
}

export async function syncGmailHistoryForUser(input: {
  userId: string;
  accessToken: string;
  gmailEmail: string | null;
  storedHistoryId: string | null;
  notificationHistoryId?: string;
}) {
  const startHistoryId = await resolveStartHistoryId(
    input.userId,
    input.accessToken,
    input.storedHistoryId,
    input.notificationHistoryId
  );

  let syncResult;

  try {
    syncResult = await listGmailHistory(input.accessToken, startHistoryId);
  } catch (error) {
    if (!historyIdTooOldError(error)) {
      throw error;
    }

    const freshHistoryId = await seedHistoryIdFromProfile(
      input.userId,
      input.accessToken
    );
    if (!freshHistoryId) throw error;

    syncResult = await listGmailHistory(input.accessToken, freshHistoryId);
  }

  await updateGmailWatchState(input.userId, {
    historyId: syncResult.historyId,
  });

  const processed: Array<{
    messageId: string;
    action: string;
    gmailDraftCreated?: boolean;
    reason?: string;
  }> = [];

  for (const messageId of syncResult.addedMessageIds) {
    const result = await processNewGmailMessage({
      userId: input.userId,
      accessToken: input.accessToken,
      gmailEmail: input.gmailEmail,
      messageId,
    });

    if (result.reason === "already_processed") {
      continue;
    }

    processed.push({
      messageId,
      action: result.action ?? (result.skipped ? "skipped" : "drafted"),
      gmailDraftCreated: Boolean(result.gmailDraftCreated),
      reason: "reason" in result ? result.reason : undefined,
    });
  }

  return {
    historyId: syncResult.historyId,
    newMessages: syncResult.addedMessageIds.length,
    processed,
  };
}

export async function processGmailPushNotification(input: {
  emailAddress: string;
  historyId?: string;
}) {
  const connection = await getGmailConnectionByGoogleEmail(input.emailAddress);
  if (!connection) {
    console.warn("[Gmail Push] No connection for email", input.emailAddress);
    return { ok: true, matched: false };
  }

  const { accessToken, googleEmail } = await getValidGmailAccessToken(
    connection.userId,
    { skipScopeCheck: true }
  );

  const sync = await syncGmailHistoryForUser({
    userId: connection.userId,
    accessToken,
    gmailEmail: googleEmail,
    storedHistoryId: connection.historyId,
    notificationHistoryId: input.historyId,
  });

  console.log("[Gmail Push] Sync complete", {
    userId: connection.userId,
    email: input.emailAddress,
    newMessages: sync.newMessages,
    processed: sync.processed.length,
    outcomes: sync.processed,
  });

  return { ok: true, matched: true, ...sync };
}

/** Decode Gmail Pub/Sub push envelope. */
export function decodeGmailPubSubMessage(body: unknown) {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid Pub/Sub body");
  }

  const envelope = body as {
    message?: { data?: string };
  };

  const encoded = envelope.message?.data;
  if (!encoded) {
    throw new Error("Missing Pub/Sub message.data");
  }

  const decoded = JSON.parse(
    Buffer.from(encoded, "base64").toString("utf-8")
  ) as {
    emailAddress?: string;
    historyId?: string;
  };

  if (!decoded.emailAddress) {
    throw new Error("Missing emailAddress in Gmail push payload");
  }

  return {
    emailAddress: decoded.emailAddress,
    historyId: decoded.historyId ? String(decoded.historyId) : undefined,
  };
}
