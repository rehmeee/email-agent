type GmailHeader = { name: string; value: string };

type GmailMessageListResponse = {
  messages?: { id: string; threadId: string }[];
  resultSizeEstimate?: number;
  error?: { message?: string };
};

type GmailMessagePart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailMessagePart[];
};

type GmailMessageResponse = {
  id: string;
  threadId: string;
  snippet?: string;
  payload?: {
    headers?: GmailHeader[];
    body?: { data?: string };
    parts?: GmailMessagePart[];
  };
  error?: { message?: string };
};

function getHeader(headers: GmailHeader[] | undefined, name: string) {
  return (
    headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())
      ?.value ?? ""
  );
}

function decodeBase64Url(data: string) {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf-8");
}

function extractPlainText(payload?: GmailMessageResponse["payload"]): string {
  if (!payload) return "";

  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  const parts = payload.parts ?? [];
  for (const part of parts) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }
  }

  for (const part of parts) {
    if (part.mimeType === "text/html" && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }
  }

  for (const part of parts) {
    const nested = extractPlainText({ parts: part.parts });
    if (nested) return nested;
  }

  return "";
}

async function gmailFetch<T>(
  accessToken: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  const payload = (await response.json()) as T & { error?: { message?: string } };

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "Gmail API request failed");
  }

  return payload;
}

function encodeMimeMessage(message: string) {
  return Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function parseEmailAddress(value: string) {
  const bracketMatch = value.match(/<([^>]+)>/);
  if (bracketMatch?.[1]) {
    return bracketMatch[1].trim();
  }

  const emailMatch = value.match(/[^\s<>]+@[^\s<>]+/);
  return emailMatch?.[0]?.trim() ?? value.trim();
}

export type GmailMessageSummary = {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
};

function toSummary(message: GmailMessageResponse): GmailMessageSummary {
  const headers = message.payload?.headers ?? [];

  return {
    id: message.id,
    threadId: message.threadId,
    subject: getHeader(headers, "Subject") || "(no subject)",
    from: getHeader(headers, "From") || "Unknown sender",
    date: getHeader(headers, "Date") || "",
    snippet: message.snippet ?? "",
  };
}

export async function listGmailMessages(
  accessToken: string,
  maxResults = 10
): Promise<GmailMessageSummary[]> {
  const list = await gmailFetch<GmailMessageListResponse>(
    accessToken,
    `/messages?maxResults=${maxResults}`
  );

  if (!list.messages?.length) {
    return [];
  }

  const summaries = await Promise.all(
    list.messages.map((item) => getGmailMessage(accessToken, item.id, "summary"))
  );

  return summaries;
}

export async function searchGmailMessages(
  accessToken: string,
  query: string,
  maxResults = 10
): Promise<GmailMessageSummary[]> {
  const encodedQuery = encodeURIComponent(query);
  const list = await gmailFetch<GmailMessageListResponse>(
    accessToken,
    `/messages?q=${encodedQuery}&maxResults=${maxResults}`
  );

  if (!list.messages?.length) {
    return [];
  }

  const summaries = await Promise.all(
    list.messages.map((item) => getGmailMessage(accessToken, item.id, "summary"))
  );

  return summaries;
}

export async function getGmailMessage(
  accessToken: string,
  messageId: string,
  mode: "summary" | "full" = "full"
) {
  const format = mode === "summary" ? "metadata" : "full";
  const metadataHeaders =
    mode === "summary"
      ? "&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date"
      : "";

  const message = await gmailFetch<GmailMessageResponse>(
    accessToken,
    `/messages/${messageId}?format=${format}${metadataHeaders}`
  );

  const summary = toSummary(message);

  if (mode === "summary") {
    return summary;
  }

  const body = extractPlainText(message.payload).trim();
  const headers = message.payload?.headers ?? [];

  return {
    ...summary,
    body: body || summary.snippet,
    messageIdHeader: getHeader(headers, "Message-ID"),
    to: getHeader(headers, "To"),
    replyToEmail: parseEmailAddress(summary.from),
  };
}

export type GmailDraftResult = {
  draftId: string;
  messageId: string;
  threadId: string;
};

export async function createGmailDraft(
  accessToken: string,
  input: {
    to: string;
    subject: string;
    body: string;
    threadId?: string;
    inReplyTo?: string;
    references?: string;
  }
): Promise<GmailDraftResult> {
  const mimeLines = [
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
  ];

  if (input.inReplyTo) {
    mimeLines.push(`In-Reply-To: ${input.inReplyTo}`);
    mimeLines.push(`References: ${input.references ?? input.inReplyTo}`);
  }

  mimeLines.push("", input.body);

  const message: { raw: string; threadId?: string } = {
    raw: encodeMimeMessage(mimeLines.join("\r\n")),
  };

  if (input.threadId) {
    message.threadId = input.threadId;
  }

  const draft = await gmailFetch<{
    id: string;
    message: { id: string; threadId: string };
  }>(accessToken, "/drafts", {
    method: "POST",
    body: JSON.stringify({ message }),
  });

  return {
    draftId: draft.id,
    messageId: draft.message.id,
    threadId: draft.message.threadId,
  };
}

type GmailDraftListResponse = {
  drafts?: { id: string; message: { id: string; threadId: string } }[];
  resultSizeEstimate?: number;
};

type GmailDraftResponse = {
  id: string;
  message: GmailMessageResponse;
};

export type GmailDraftSummary = {
  draftId: string;
  messageId: string;
  subject: string;
  to: string;
  snippet: string;
  date: string;
};

export async function listGmailDrafts(
  accessToken: string,
  maxResults = 10
): Promise<GmailDraftSummary[]> {
  const list = await gmailFetch<GmailDraftListResponse>(
    accessToken,
    `/drafts?maxResults=${maxResults}`
  );

  if (!list.drafts?.length) {
    return [];
  }

  const drafts = await Promise.all(
    list.drafts.map(async (item) => {
      const draft = await gmailFetch<GmailDraftResponse>(
        accessToken,
        `/drafts/${item.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=To&metadataHeaders=Date`
      );
      const headers = draft.message.payload?.headers ?? [];

      return {
        draftId: draft.id,
        messageId: draft.message.id,
        subject: getHeader(headers, "Subject") || "(no subject)",
        to: getHeader(headers, "To") || "No recipient",
        snippet: draft.message.snippet ?? "",
        date: getHeader(headers, "Date") || "",
      };
    })
  );

  return drafts;
}
