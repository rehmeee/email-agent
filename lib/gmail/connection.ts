import { createAdminClient } from "@/lib/supabase/admin";

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
];

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
    };
  }

  return {
    connected: true,
    googleEmail: data.google_email,
    connectedAt: data.connected_at,
    scopes: data.scopes ?? [],
  };
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
  userId: string
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

  return {
    accessToken: refreshed.accessToken,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
    googleEmail: data.google_email,
  };
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
