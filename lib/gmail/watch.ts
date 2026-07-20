import {
  fetchGmailProfile,
  getValidGmailAccessToken,
  updateGmailWatchState,
} from "@/lib/gmail/connection";

export function getGmailPubSubTopic() {
  const topic = process.env.GMAIL_PUBSUB_TOPIC?.trim();
  if (!topic) {
    throw new Error(
      "Missing GMAIL_PUBSUB_TOPIC. Set it to projects/<project>/topics/gmail-push"
    );
  }
  return topic;
}

export async function startGmailWatch(accessToken: string, topicName: string) {
  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/watch",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        topicName,
        labelIds: ["INBOX"],
        labelFilterBehavior: "INCLUDE",
      }),
    }
  );

  const payload = (await response.json()) as {
    historyId?: string;
    expiration?: string;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "Failed to start Gmail watch");
  }

  if (!payload.historyId || !payload.expiration) {
    throw new Error("Gmail watch response missing historyId or expiration");
  }

  return {
    historyId: String(payload.historyId),
    expiration: new Date(Number(payload.expiration)),
  };
}

export async function stopGmailWatch(accessToken: string) {
  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/stop",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!response.ok) {
    const payload = (await response.json()) as { error?: { message?: string } };
    throw new Error(payload.error?.message ?? "Failed to stop Gmail watch");
  }
}

export async function registerGmailWatchForUser(userId: string) {
  const { accessToken } = await getValidGmailAccessToken(userId, {
    skipScopeCheck: true,
  });
  const topicName = getGmailPubSubTopic();
  const watch = await startGmailWatch(accessToken, topicName);

  await updateGmailWatchState(userId, {
    historyId: watch.historyId,
    watchExpiration: watch.expiration.toISOString(),
  });

  return watch;
}

export async function unregisterGmailWatchForUser(userId: string) {
  try {
    const { accessToken } = await getValidGmailAccessToken(userId, {
      skipScopeCheck: true,
    });
    await stopGmailWatch(accessToken);
  } catch {
    // Token may already be invalid during disconnect.
  }

  await updateGmailWatchState(userId, {
    historyId: null,
    watchExpiration: null,
  });
}

export async function seedHistoryIdFromProfile(userId: string, accessToken: string) {
  const profile = await fetchGmailProfile(accessToken);
  if (profile.historyId) {
    await updateGmailWatchState(userId, {
      historyId: String(profile.historyId),
    });
    return String(profile.historyId);
  }
  return null;
}
