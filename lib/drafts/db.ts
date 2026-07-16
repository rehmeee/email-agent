import { createAdminClient } from "@/lib/supabase/admin";

export type PendingDraftStatus = "pending" | "approved" | "rejected";

export type PendingDraft = {
  id: string;
  userId: string;
  threadId: string | null;
  toAddrs: string;
  subject: string;
  body: string;
  gmailThreadId: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
  status: PendingDraftStatus;
  feedback: string | null;
  gmailDraftId: string | null;
  createdAt: string;
};

function isMissingTableError(message: string) {
  return (
    message.includes("pending_drafts") &&
    (message.includes("schema cache") ||
      message.includes("does not exist") ||
      message.includes("Could not find"))
  );
}

function mapRow(row: {
  id: string;
  user_id: string;
  thread_id: string | null;
  to_addrs: string;
  subject: string;
  body: string;
  gmail_thread_id: string | null;
  in_reply_to: string | null;
  references_header: string | null;
  status: PendingDraftStatus;
  feedback: string | null;
  gmail_draft_id: string | null;
  created_at: string;
}): PendingDraft {
  return {
    id: row.id,
    userId: row.user_id,
    threadId: row.thread_id,
    toAddrs: row.to_addrs,
    subject: row.subject,
    body: row.body,
    gmailThreadId: row.gmail_thread_id,
    inReplyTo: row.in_reply_to,
    referencesHeader: row.references_header,
    status: row.status,
    feedback: row.feedback,
    gmailDraftId: row.gmail_draft_id,
    createdAt: row.created_at,
  };
}

export async function createPendingDraft(input: {
  userId: string;
  threadId?: string | null;
  to: string;
  subject: string;
  body: string;
  gmailThreadId?: string;
  inReplyTo?: string;
  references?: string;
}): Promise<PendingDraft> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("pending_drafts")
    .insert({
      user_id: input.userId,
      thread_id: input.threadId ?? null,
      to_addrs: input.to,
      subject: input.subject,
      body: input.body,
      gmail_thread_id: input.gmailThreadId ?? null,
      in_reply_to: input.inReplyTo ?? null,
      references_header: input.references ?? null,
      status: "pending",
    })
    .select(
      "id, user_id, thread_id, to_addrs, subject, body, gmail_thread_id, in_reply_to, references_header, status, feedback, gmail_draft_id, created_at"
    )
    .single();

  if (error) {
    if (isMissingTableError(error.message)) {
      throw new Error(
        "Pending drafts table is missing. Run supabase/migrations/003_persona_feedback.sql in Supabase."
      );
    }
    throw new Error(`Failed to create pending draft: ${error.message}`);
  }

  return mapRow(data);
}

export async function getPendingDraft(userId: string, draftId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("pending_drafts")
    .select(
      "id, user_id, thread_id, to_addrs, subject, body, gmail_thread_id, in_reply_to, references_header, status, feedback, gmail_draft_id, created_at"
    )
    .eq("id", draftId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error.message)) return null;
    throw new Error(`Failed to load pending draft: ${error.message}`);
  }

  return data ? mapRow(data) : null;
}

export async function markPendingDraftApproved(
  userId: string,
  draftId: string,
  gmailDraftId?: string
) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("pending_drafts")
    .update({
      status: "approved",
      gmail_draft_id: gmailDraftId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", draftId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to approve pending draft: ${error.message}`);
  }
}

export async function markPendingDraftRejected(
  userId: string,
  draftId: string,
  feedback: string
) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("pending_drafts")
    .update({
      status: "rejected",
      feedback,
      updated_at: new Date().toISOString(),
    })
    .eq("id", draftId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to reject pending draft: ${error.message}`);
  }
}
