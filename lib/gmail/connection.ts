import { createAdminClient } from "@/lib/supabase/admin";

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
];

export const REQUIRED_GMAIL_SCOPE_PREFIX = "gmail.readonly";

function tokenHasGmailReadScope(scopes: string[]) {
  return scopes.some(
    (scope) =>
      scope.includes("gmail.readonly") ||
      scope.includes("gmail.modify") ||
      scope.includes("mail.google.com")
  );
}

function tokenHasGmailComposeScope(scopes: string[]) {
  return scopes.some(
    (scope) =>
      scope.includes("gmail.compose") || scope.includes("gmail.modify")
  );
}

function tokenHasRequiredGmailScopes(scopes: string[]) {
  return tokenHasGmailReadScope(scopes) && tokenHasGmailComposeScope(scopes);
}

export async function fetchGoogleTokenScopes(accessToken: string) {
  const response = await fetch(
    `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
  );

  const payload = (await response.json()) as { scope?: string; error?: string };

  if (!response.ok) {
    return [];
  }

  return payload.scope?.split(" ").filter(Boolean) ?? [];
}

function isMissingGmailTableError(message: string) {
  return (
    message.includes("gmail_connections") &&
    (message.includes("schema cache") ||
      message.includes("does not exist") ||
      message.includes("Could not find"))
  );
}

export type GmailConnectionStatus = {
  connected: boolean;
  googleEmail: string | null;
  connectedAt: string | null;
  scopes: string[];
  setupRequired?: boolean;
  needsReconnect?: boolean;
  agentReady?: boolean;
};

export type GmailTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  googleEmail: string | null;
};

export async function saveGmailTokens(
  userId: string,
  tokens: {
    accessToken: string;
    refreshToken?: string | null;
    expiresIn?: number | null;
    googleEmail?: string | null;
    scopes?: string[];
  }
) {
  const admin = createAdminClient();

  const existing = await admin
    .from("gmail_connections")
    .select("refresh_token")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing.error && isMissingGmailTableError(existing.error.message)) {
    throw new Error(
      "Database setup required. Run supabase/migrations/001_gmail_connections.sql in the Supabase SQL Editor."
    );
  }

  const refreshToken =
    tokens.refreshToken ?? existing.data?.refresh_token ?? null;

  const tokenExpiresAt =
    tokens.expiresIn != null
      ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString()
      : null;

  const { error } = await admin.from("gmail_connections").upsert({
    user_id: userId,
    google_email: tokens.googleEmail ?? null,
    access_token: tokens.accessToken,
    refresh_token: refreshToken,
    token_expires_at: tokenExpiresAt,
    scopes: tokens.scopes ?? GMAIL_SCOPES,
    connected_at: new Date().toISOString(),
  });

  if (error) {
    if (isMissingGmailTableError(error.message)) {
      throw new Error(
        "Database setup required. Run supabase/migrations/001_gmail_connections.sql in the Supabase SQL Editor."
      );
    }

    throw new Error(`Failed to save Gmail tokens: ${error.message}`);
  }
}

export async function getGmailConnectionStatus(
  userId: string
): Promise<GmailConnectionStatus> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("gmail_connections")
    .select("google_email, connected_at, scopes")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (isMissingGmailTableError(error.message)) {
      return {
        connected: false,
        googleEmail: null,
        connectedAt: null,
        scopes: [],
        setupRequired: true,
      };
    }

    throw new Error(`Failed to read Gmail connection: ${error.message}`);
  }

  if (!data) {
    return {
      connected: false,
      googleEmail: null,
      connectedAt: null,
      scopes: [],
      agentReady: false,
    };
  }

  try {
    const { accessToken } = await getValidGmailAccessToken(userId, {
      skipScopeCheck: true,
    });
    const liveScopes = await fetchGoogleTokenScopes(accessToken);
    const hasRequiredScopes = tokenHasRequiredGmailScopes(liveScopes);

    return {
      connected: hasRequiredScopes,
      googleEmail: data.google_email,
      connectedAt: data.connected_at,
      scopes: liveScopes.length > 0 ? liveScopes : data.scopes ?? [],
      needsReconnect: !hasRequiredScopes,
      agentReady: hasRequiredScopes,
    };
  } catch {
    return {
      connected: false,
      googleEmail: data.google_email,
      connectedAt: data.connected_at,
      scopes: data.scopes ?? [],
      needsReconnect: true,
      agentReady: false,
    };
  }
}

export async function deleteGmailConnection(userId: string) {
  const admin = createAdminClient();

  try {
    const { accessToken } = await getValidGmailAccessToken(userId, {
      skipScopeCheck: true,
    });
    await fetch("https://gmail.googleapis.com/gmail/v1/users/me/stop", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    // Ignore if tokens are already invalid.
  }

  const { error } = await admin
    .from("gmail_connections")
    .delete()
    .eq("user_id", userId);

  if (error && !isMissingGmailTableError(error.message)) {
    throw new Error(`Failed to remove Gmail connection: ${error.message}`);
  }
}

export type GmailConnectionRecord = {
  userId: string;
  googleEmail: string | null;
  historyId: string | null;
  watchExpiration: string | null;
};

export async function getGmailConnectionByGoogleEmail(
  googleEmail: string
): Promise<GmailConnectionRecord | null> {
  const admin = createAdminClient();
  const normalized = googleEmail.trim().toLowerCase();

  const { data, error } = await admin
    .from("gmail_connections")
    .select("user_id, google_email, history_id, watch_expiration")
    .ilike("google_email", normalized)
    .maybeSingle();

  if (error) {
    if (isMissingGmailTableError(error.message)) return null;
    throw new Error(`Failed to read Gmail connection: ${error.message}`);
  }

  if (!data) return null;

  return {
    userId: data.user_id,
    googleEmail: data.google_email,
    historyId: data.history_id ?? null,
    watchExpiration: data.watch_expiration ?? null,
  };
}

export async function updateGmailWatchState(
  userId: string,
  input: {
    historyId?: string | null;
    watchExpiration?: string | null;
  }
) {
  const admin = createAdminClient();
  const patch: Record<string, string | null> = {};

  if ("historyId" in input) {
    patch.history_id = input.historyId ?? null;
  }
  if ("watchExpiration" in input) {
    patch.watch_expiration = input.watchExpiration ?? null;
  }

  if (Object.keys(patch).length === 0) return;

  const { error } = await admin
    .from("gmail_connections")
    .update(patch)
    .eq("user_id", userId);

  if (error) {
    if (isMissingGmailTableError(error.message)) {
      throw new Error(
        "Database setup required. Run supabase/migrations/005_gmail_watch.sql."
      );
    }
    throw new Error(`Failed to update Gmail watch state: ${error.message}`);
  }
}

export async function listGmailConnectionsNeedingWatchRenewal(withinMs = 24 * 60 * 60 * 1000) {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() + withinMs).toISOString();

  const { data, error } = await admin
    .from("gmail_connections")
    .select("user_id, watch_expiration")
    .or(`watch_expiration.is.null,watch_expiration.lt.${cutoff}`);

  if (error) {
    if (isMissingGmailTableError(error.message)) return [];
    throw new Error(`Failed to list Gmail connections: ${error.message}`);
  }

  return (data ?? []).map((row) => row.user_id as string);
}

async function refreshAccessToken(refreshToken: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing Google OAuth credentials");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description ?? payload.error ?? "Token refresh failed"
    );
  }

  return {
    accessToken: payload.access_token,
    expiresIn: payload.expires_in ?? 3600,
  };
}

export async function getValidGmailAccessToken(
  userId: string,
  options?: { skipScopeCheck?: boolean }
): Promise<GmailTokens> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("gmail_connections")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) {
    throw new Error("Gmail is not connected for this user.");
  }

  const expiresAt = data.token_expires_at
    ? new Date(data.token_expires_at)
    : null;
  const isExpired =
    !expiresAt || expiresAt.getTime() <= Date.now() + 60_000;

  if (!isExpired) {
    if (!options?.skipScopeCheck) {
      await assertGmailScopes(data.access_token);
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt,
      googleEmail: data.google_email,
    };
  }

  if (!data.refresh_token) {
    throw new Error("Gmail token expired. Please reconnect Gmail.");
  }

  const refreshed = await refreshAccessToken(data.refresh_token);

  await saveGmailTokens(userId, {
    accessToken: refreshed.accessToken,
    refreshToken: data.refresh_token,
    expiresIn: refreshed.expiresIn,
    googleEmail: data.google_email,
    scopes: data.scopes,
  });

  if (!options?.skipScopeCheck) {
    await assertGmailScopes(refreshed.accessToken);
  }

  return {
    accessToken: refreshed.accessToken,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
    googleEmail: data.google_email,
  };
}

async function assertGmailScopes(accessToken: string) {
  const scopes = await fetchGoogleTokenScopes(accessToken);

  if (!tokenHasRequiredGmailScopes(scopes)) {
    const missing = [];
    if (!tokenHasGmailReadScope(scopes)) {
      missing.push("gmail.readonly");
    }
    if (!tokenHasGmailComposeScope(scopes)) {
      missing.push("gmail.compose");
    }

    throw new Error(
      `Gmail is missing required permissions (${missing.join(", ")}). Click Reconnect Gmail on the dashboard to grant inbox read and draft access.`
    );
  }
}

export async function fetchGmailProfile(accessToken: string) {
  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  const payload = (await response.json()) as {
    emailAddress?: string;
    messagesTotal?: number;
    threadsTotal?: number;
    historyId?: string;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "Failed to fetch Gmail profile");
  }

  return payload;
}

export async function listRecentGmailMessages(
  accessToken: string,
  maxResults = 5
) {
  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  const payload = (await response.json()) as {
    messages?: { id: string; threadId: string }[];
    resultSizeEstimate?: number;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "Failed to list Gmail messages");
  }

  return payload;
}
