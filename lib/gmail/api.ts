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

/**
 * Gmail thread IDs are hex (e.g. 19f81d3097b7be8c).
 * Reject empty strings, UUIDs, placeholders, and other junk the model may invent.
 */
export function sanitizeGmailThreadId(
  value?: string | null
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (/^(null|undefined|none|n\/a|\(omit.*\))$/i.test(trimmed)) {
    return undefined;
  }
  // Chat UUIDs look like 8-4-4-4-12 hex with dashes — never valid Gmail thread ids.
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      trimmed
    )
  ) {
    return undefined;
  }
  if (/^[0-9a-f]+$/i.test(trimmed) && trimmed.length >= 10) {
    return trimmed;
  }
  return undefined;
}

function sanitizeHeaderValue(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (/^(null|undefined|none|n\/a|\(omit.*\))$/i.test(trimmed)) {
    return undefined;
  }
  return trimmed;
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

export type SentMailSample = {
  id: string;
  subject: string;
  to: string;
  date: string;
  body: string;
};

function stripQuotedReply(body: string) {
  const lines = body.split(/\r?\n/);
  const kept: string[] = [];

  for (const line of lines) {
    if (/^on .+ wrote:$/i.test(line.trim())) break;
    if (line.trim() === "--") break;
    if (line.startsWith(">")) continue;
    kept.push(line);
  }

  return kept.join("\n").trim();
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await mapper(items[current]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

export async function fetchSentMessagesForPersona(
  accessToken: string,
  options?: { maxMessages?: number; maxBodyChars?: number; concurrency?: number }
): Promise<SentMailSample[]> {
  // List uses Gmail maxResults (same idea as list_emails). Full bodies are
  // fetched in small concurrent batches to avoid "too many concurrent requests".
  const maxMessages = options?.maxMessages ?? 40;
  const maxBodyChars = options?.maxBodyChars ?? 1000;
  const concurrency = options?.concurrency ?? 3;

  const list = await gmailFetch<GmailMessageListResponse>(
    accessToken,
    `/messages?q=${encodeURIComponent("in:sent")}&maxResults=${maxMessages}`
  );

  if (!list.messages?.length) {
    return [];
  }

  const samples = await mapPool(list.messages, concurrency, async (item) => {
    const full = await getGmailMessage(accessToken, item.id, "full");

    const cleaned = stripQuotedReply(full.body).slice(0, maxBodyChars).trim();

    if (!cleaned) {
      return null;
    }

    return {
      id: full.id,
      subject: full.subject,
      to: full.to,
      date: full.date,
      body: cleaned,
    } satisfies SentMailSample;
  });

  return samples.filter((sample): sample is SentMailSample => sample != null);
}

export async function getGmailMessage(
  accessToken: string,
  messageId: string,
  mode: "summary"
): Promise<GmailMessageSummary>;
export async function getGmailMessage(
  accessToken: string,
  messageId: string,
  mode?: "full"
): Promise<
  GmailMessageSummary & {
    body: string;
    messageIdHeader: string;
    to: string;
    replyToEmail: string;
  }
>;
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
  const threadId = sanitizeGmailThreadId(input.threadId);
  const inReplyTo = sanitizeHeaderValue(input.inReplyTo);
  const references = sanitizeHeaderValue(input.references) ?? inReplyTo;

  const mimeLines = [
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
  ];

  if (inReplyTo) {
    mimeLines.push(`In-Reply-To: ${inReplyTo}`);
    mimeLines.push(`References: ${references}`);
  }

  mimeLines.push("", input.body);

  const message: { raw: string; threadId?: string } = {
    raw: encodeMimeMessage(mimeLines.join("\r\n")),
  };

  if (threadId) {
    message.threadId = threadId;
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

type GmailHistoryRecord = {
  id?: string;
  messages?: { id: string; threadId: string }[];
  messagesAdded?: {
    message?: {
      id: string;
      threadId: string;
      labelIds?: string[];
    };
  }[];
};

type GmailHistoryListResponse = {
  history?: GmailHistoryRecord[];
  historyId?: string;
  nextPageToken?: string;
};

export type GmailHistorySyncResult = {
  addedMessageIds: string[];
  historyId: string;
};

export async function listGmailHistory(
  accessToken: string,
  startHistoryId: string
): Promise<GmailHistorySyncResult> {
  const added = new Set<string>();
  let pageToken: string | undefined;
  let latestHistoryId = startHistoryId;

  do {
    const params = new URLSearchParams({
      startHistoryId,
      historyTypes: "messageAdded",
      labelId: "INBOX",
    });
    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const response = await gmailFetch<GmailHistoryListResponse>(
      accessToken,
      `/history?${params.toString()}`
    );

    for (const record of response.history ?? []) {
      for (const item of record.messagesAdded ?? []) {
        const message = item.message;
        if (!message?.id) continue;
        const labels = message.labelIds ?? [];
        if (labels.length > 0 && !labels.includes("INBOX")) continue;
        added.add(message.id);
      }
    }

    if (response.historyId) {
      latestHistoryId = String(response.historyId);
    }

    pageToken = response.nextPageToken;
  } while (pageToken);

  return {
    addedMessageIds: [...added],
    historyId: latestHistoryId,
  };
}
