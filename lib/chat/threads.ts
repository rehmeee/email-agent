import { createAdminClient } from "@/lib/supabase/admin";

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
    .select("id, role, content, created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });

  if (error) {
    if (isMissingChatTableError(error.message)) return [];
    throw new Error(`Failed to read chat messages: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    role: row.role as "user" | "assistant",
    content: row.content,
    createdAt: row.created_at,
  }));
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
  content: string
) {
  const admin = createAdminClient();

  const { error } = await admin.from("chat_messages").insert({
    thread_id: threadId,
    role,
    content,
  });

  if (error) {
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
