-- Attachment metadata for MailMind drafts (Drive file ids/names — not file bytes).
-- Run in Supabase Dashboard → SQL Editor after 007_mailmind_drafts.sql.

alter table public.mailmind_drafts
  add column if not exists attachments jsonb;
