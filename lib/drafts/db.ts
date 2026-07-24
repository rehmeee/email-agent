import { createAdminClient } from "@/lib/supabase/admin";
import {
  normalizeDraftAttachments,
  type DraftAttachment,
  type DraftPreview,
} from "@/lib/drafts/preview";

export type MailMindDraftSource = "inbox" | "chat";
export type MailMindDraftStatus = "active" | "superseded" | "dismissed";

export type MailMindDraftRecord = {
  id: string;
  userId: string;
  gmailDraftId: string;
  source: MailMindDraftSource;
  sourceMessageId: string | null;
  to: string;
  subject: string;
  body: string;
  attachments: DraftAttachment[] | null;
  gmailThreadId: string | null;
  inReplyTo: string | null;
  references: string | null;
  status: MailMindDraftStatus;
  supersededBy: string | null;
  createdAt: string;
  updatedAt: string;
};

type DraftRow = {
  id: string;
  user_id: string;
  gmail_draft_id: string;
  source: MailMindDraftSource;
  source_message_id: string | null;
  to: string;
  subject: string;
  body: string;
  attachments?: DraftAttachment[] | null;
  gmail_thread_id: string | null;
  in_reply_to: string | null;
  references: string | null;
  status: MailMindDraftStatus;
  superseded_by: string | null;
  created_at: string;
  updated_at: string;
};

function isMissingTableError(message: string) {
  return (
    message.includes("mailmind_drafts") &&
    (message.includes("schema cache") ||
      message.includes("does not exist") ||
      message.includes("Could not find"))
  );
}

function mapRow(row: DraftRow): MailMindDraftRecord {
  return {
    id: row.id,
    userId: row.user_id,
    gmailDraftId: row.gmail_draft_id,
    source: row.source,
    sourceMessageId: row.source_message_id,
    to: row.to,
    subject: row.subject,
    body: row.body,
    attachments: normalizeDraftAttachments(row.attachments) ?? null,
    gmailThreadId: row.gmail_thread_id,
    inReplyTo: row.in_reply_to,
    references: row.references,
    status: row.status,
    supersededBy: row.superseded_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function draftPreviewFromRecord(
  record: MailMindDraftRecord
): DraftPreview {
  return {
    to: record.to,
    subject: record.subject,
    body: record.body,
    gmailThreadId: record.gmailThreadId ?? undefined,
    inReplyTo: record.inReplyTo ?? undefined,
    references: record.references ?? undefined,
    attachments: record.attachments ?? undefined,
  };
}

export async function saveMailMindDraft(input: {
  userId: string;
  gmailDraftId: string;
  source: MailMindDraftSource;
  sourceMessageId?: string | null;
  draft: DraftPreview;
}): Promise<MailMindDraftRecord | null> {
  const admin = createAdminClient();
  const attachments = normalizeDraftAttachments(input.draft.attachments) ?? null;
  const { data, error } = await admin
    .from("mailmind_drafts")
    .upsert(
      {
        user_id: input.userId,
        gmail_draft_id: input.gmailDraftId,
        source: input.source,
        source_message_id: input.sourceMessageId ?? null,
        to: input.draft.to,
        subject: input.draft.subject,
        body: input.draft.body,
        attachments,
        gmail_thread_id: input.draft.gmailThreadId ?? null,
        in_reply_to: input.draft.inReplyTo ?? null,
        references: input.draft.references ?? null,
        status: "active",
        superseded_by: null,
      },
      { onConflict: "user_id,gmail_draft_id" }
    )
    .select("*")
    .single();

  if (error) {
    if (isMissingTableError(error.message)) {
      console.warn(
        "[mailmind_drafts] table missing — run supabase/migrations/007_mailmind_drafts.sql"
      );
      return null;
    }
    // Older DBs without attachments column: retry without it.
    if (
      error.message.includes("attachments") &&
      (error.message.includes("schema cache") ||
        error.message.includes("does not exist") ||
        error.message.includes("Could not find"))
    ) {
      console.warn(
        "[mailmind_drafts] attachments column missing — run supabase/migrations/008_mailmind_draft_attachments.sql"
      );
      const retry = await admin
        .from("mailmind_drafts")
        .upsert(
          {
            user_id: input.userId,
            gmail_draft_id: input.gmailDraftId,
            source: input.source,
            source_message_id: input.sourceMessageId ?? null,
            to: input.draft.to,
            subject: input.draft.subject,
            body: input.draft.body,
            gmail_thread_id: input.draft.gmailThreadId ?? null,
            in_reply_to: input.draft.inReplyTo ?? null,
            references: input.draft.references ?? null,
            status: "active",
            superseded_by: null,
          },
          { onConflict: "user_id,gmail_draft_id" }
        )
        .select("*")
        .single();
      if (retry.error) {
        throw new Error(`Failed to save MailMind draft: ${retry.error.message}`);
      }
      return mapRow(retry.data as DraftRow);
    }
    throw new Error(`Failed to save MailMind draft: ${error.message}`);
  }

  return mapRow(data as DraftRow);
}

export async function listActiveMailMindDrafts(
  userId: string,
  limit = 40
): Promise<MailMindDraftRecord[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("mailmind_drafts")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (isMissingTableError(error.message)) return [];
    throw new Error(`Failed to list MailMind drafts: ${error.message}`);
  }

  return (data as DraftRow[]).map(mapRow);
}

export async function getMailMindDraftForUser(
  userId: string,
  draftRowId: string
): Promise<MailMindDraftRecord | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("mailmind_drafts")
    .select("*")
    .eq("user_id", userId)
    .eq("id", draftRowId)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error.message)) return null;
    throw new Error(`Failed to load MailMind draft: ${error.message}`);
  }

  return data ? mapRow(data as DraftRow) : null;
}

/**
 * Mark old draft superseded and insert the MCP replacement as active.
 */
export async function supersedeMailMindDraft(input: {
  userId: string;
  previous: MailMindDraftRecord;
  newGmailDraftId: string;
  draft: DraftPreview;
}): Promise<MailMindDraftRecord | null> {
  const admin = createAdminClient();

  const { error: updateError } = await admin
    .from("mailmind_drafts")
    .update({
      status: "superseded",
      superseded_by: input.newGmailDraftId,
    })
    .eq("user_id", input.userId)
    .eq("id", input.previous.id);

  if (updateError) {
    if (isMissingTableError(updateError.message)) return null;
    throw new Error(
      `Failed to supersede MailMind draft: ${updateError.message}`
    );
  }

  return saveMailMindDraft({
    userId: input.userId,
    gmailDraftId: input.newGmailDraftId,
    source: input.previous.source,
    sourceMessageId: input.previous.sourceMessageId,
    draft: input.draft,
  });
}
