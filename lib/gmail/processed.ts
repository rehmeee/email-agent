import { createAdminClient } from "@/lib/supabase/admin";

export type ProcessedGmailAction = "triaged" | "skipped" | "drafted";

function isMissingTableError(message: string) {
  return (
    message.includes("processed_gmail_messages") &&
    (message.includes("schema cache") ||
      message.includes("does not exist") ||
      message.includes("Could not find"))
  );
}

export async function isGmailMessageProcessed(
  userId: string,
  gmailMessageId: string
) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("processed_gmail_messages")
    .select("gmail_message_id")
    .eq("user_id", userId)
    .eq("gmail_message_id", gmailMessageId)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error.message)) return false;
    throw new Error(`Failed to check processed message: ${error.message}`);
  }

  return Boolean(data);
}

export async function markGmailMessageProcessed(
  userId: string,
  gmailMessageId: string,
  action: ProcessedGmailAction = "triaged"
) {
  const admin = createAdminClient();
  const { error } = await admin.from("processed_gmail_messages").upsert(
    {
      user_id: userId,
      gmail_message_id: gmailMessageId,
      action,
      processed_at: new Date().toISOString(),
    },
    { onConflict: "user_id,gmail_message_id" }
  );

  if (error) {
    if (isMissingTableError(error.message)) {
      throw new Error(
        "processed_gmail_messages table is missing. Run supabase/migrations/005_gmail_watch.sql."
      );
    }
    throw new Error(`Failed to mark processed message: ${error.message}`);
  }
}
