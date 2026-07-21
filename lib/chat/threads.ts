import { createAdminClient } from "@/lib/supabase/admin";
import type { ChatDraftMetadata } from "@/lib/drafts/preview";

export type ChatThread = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessageRecord = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  metadata?: ChatDraftMetadata | null;
};

function isMissingChatTableError(message: string) {
  return (
    (message.includes("chat_threads") || message.includes("chat_messages")) &&
    (message.includes("schema cache") ||
      message.includes("does not exist") ||
      message.includes("Could not find"))
  );
}

function buildTitleFromMessage(message: string) {
  const trimmed = message.trim().replace(/\s+/g, " ");
  if (!trimmed) return "New chat";
  return trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed;
}

function parseMetadata(raw: unknown): ChatDraftMetadata | null {
  if (!raw || typeof raw !== "object") return null;
  const meta = raw as Partial<ChatDraftMetadata>;
  if (!meta.draft || typeof meta.draft !== "object") return null;
  if (!meta.draft.to || !meta.draft.subject || !meta.draft.body) return null;
  if (
    meta.draftStatus !== "pending" &&
    meta.draftStatus !== "accepted" &&
    meta.draftStatus !== "revised"
  ) {
    return null;
  }
  return {
    draft: {
      to: meta.draft.to,
      subject: meta.draft.subject,
      body: meta.draft.body,
      gmailThreadId: meta.draft.gmailThreadId,
      inReplyTo: meta.draft.inReplyTo,
      references: meta.draft.references,
    },
    draftStatus: meta.draftStatus,
    gmailDraftId: meta.gmailDraftId ?? null,
  };
}

export async function listChatThreads(userId: string): Promise<ChatThread[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("chat_threads")
    .select("id, title, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) {
    if (isMissingChatTableError(error.message)) return [];
    throw new Error(`Failed to list chat threads: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function getChatThreadMessages(
  userId: string,
  threadId: string
): Promise<ChatMessageRecord[]> {
  const admin = createAdminClient();

  const { data: thread, error: threadError } = await admin
    .from("chat_threads")
    .select("id")
    .eq("id", threadId)
    .eq("user_id", userId)
    .maybeSingle();

  if (threadError) {
    if (isMissingChatTableError(threadError.message)) return [];
    throw new Error(`Failed to read chat thread: ${threadError.message}`);
  }

  if (!thread) {
    throw new Error("Chat thread not found.");
  }

  const { data, error } = await admin
    .from("chat_messages")
    .select("id, role, content, created_at, metadata")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });

  if (error) {
    // Older DBs without metadata column — fall back.
    if (error.message.includes("metadata")) {
      const fallback = await admin
        .from("chat_messages")
        .select("id, role, content, created_at")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true });
      if (fallback.error) {
        if (isMissingChatTableError(fallback.error.message)) return [];
        throw new Error(`Failed to read chat messages: ${fallback.error.message}`);
      }
      return (fallback.data ?? []).map((row) => ({
        id: row.id,
        role: row.role as "user" | "assistant",
        content: row.content,
        createdAt: row.created_at,
        metadata: null,
      }));
    }
    if (isMissingChatTableError(error.message)) return [];
    throw new Error(`Failed to read chat messages: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    role: row.role as "user" | "assistant",
    content: row.content,
    createdAt: row.created_at,
    metadata: parseMetadata(row.metadata),
  }));
}

export async function findLatestPendingDraftMessage(
  userId: string,
  threadId: string
) {
  const messages = await getChatThreadMessages(userId, threadId);
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (
      message.role === "assistant" &&
      message.metadata?.draftStatus === "pending" &&
      message.metadata.draft
    ) {
      return message;
    }
  }
  return null;
}

export async function createChatThread(userId: string, title = "New chat") {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("chat_threads")
    .insert({ user_id: userId, title })
    .select("id, title, created_at, updated_at")
    .single();

  if (error) {
    if (isMissingChatTableError(error.message)) {
      throw new Error(
        "Database setup required. Run supabase/migrations/002_chat_threads.sql in the Supabase SQL Editor."
      );
    }
    throw new Error(`Failed to create chat thread: ${error.message}`);
  }

  return {
    id: data.id,
    title: data.title,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function addChatMessage(
  threadId: string,
  role: "user" | "assistant",
  content: string,
  metadata?: ChatDraftMetadata | null
) {
  const admin = createAdminClient();

  const row: Record<string, unknown> = {
    thread_id: threadId,
    role,
    content,
  };
  if (metadata) {
    row.metadata = metadata;
  }

  const { data, error } = await admin
    .from("chat_messages")
    .insert(row)
    .select("id, role, content, created_at, metadata")
    .single();

  if (error) {
    if (error.message.includes("metadata") && metadata) {
      const fallback = await admin
        .from("chat_messages")
        .insert({ thread_id: threadId, role, content })
        .select("id, role, content, created_at")
        .single();
      if (fallback.error) {
        throw new Error(`Failed to save chat message: ${fallback.error.message}`);
      }
      await admin
        .from("chat_threads")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", threadId);
      return {
        id: fallback.data.id,
        role: fallback.data.role as "user" | "assistant",
        content: fallback.data.content,
        createdAt: fallback.data.created_at,
        metadata: null,
      } satisfies ChatMessageRecord;
    }
    if (isMissingChatTableError(error.message)) {
      throw new Error(
        "Database setup required. Run supabase/migrations/002_chat_threads.sql in the Supabase SQL Editor."
      );
    }
    throw new Error(`Failed to save chat message: ${error.message}`);
  }

  await admin
    .from("chat_threads")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", threadId);

  return {
    id: data.id,
    role: data.role as "user" | "assistant",
    content: data.content,
    createdAt: data.created_at,
    metadata: parseMetadata(data.metadata),
  } satisfies ChatMessageRecord;
}

export async function updateChatMessageMetadata(
  userId: string,
  messageId: string,
  metadata: ChatDraftMetadata
) {
  const admin = createAdminClient();

  const { data: message, error: loadError } = await admin
    .from("chat_messages")
    .select("id, thread_id")
    .eq("id", messageId)
    .maybeSingle();

  if (loadError || !message) {
    throw new Error("Chat message not found.");
  }

  const { data: thread, error: threadError } = await admin
    .from("chat_threads")
    .select("id")
    .eq("id", message.thread_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (threadError || !thread) {
    throw new Error("Chat message not found.");
  }

  const { error } = await admin
    .from("chat_messages")
    .update({ metadata })
    .eq("id", messageId);

  if (error) {
    throw new Error(`Failed to update message metadata: ${error.message}`);
  }
}

export async function deleteChatThread(userId: string, threadId: string) {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("chat_threads")
    .delete()
    .eq("id", threadId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) {
    if (isMissingChatTableError(error.message)) {
      throw new Error(
        "Database setup required. Run supabase/migrations/002_chat_threads.sql in the Supabase SQL Editor."
      );
    }
    throw new Error(`Failed to delete chat thread: ${error.message}`);
  }

  if (!data) {
    throw new Error("Chat thread not found.");
  }

  return { id: data.id };
}

export async function ensureChatThread(
  userId: string,
  threadId: string | null | undefined,
  firstUserMessage?: string
) {
  if (threadId) {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("chat_threads")
      .select("id, title, created_at, updated_at")
      .eq("id", threadId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      if (isMissingChatTableError(error.message)) {
        throw new Error(
          "Database setup required. Run supabase/migrations/002_chat_threads.sql in the Supabase SQL Editor."
        );
      }
      throw new Error(`Failed to read chat thread: ${error.message}`);
    }

    if (!data) {
      throw new Error("Chat thread not found.");
    }

    return {
      id: data.id,
      title: data.title,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  const title = firstUserMessage
    ? buildTitleFromMessage(firstUserMessage)
    : "New chat";
  return createChatThread(userId, title);
}
