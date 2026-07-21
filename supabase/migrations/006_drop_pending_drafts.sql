-- Run in Supabase Dashboard → SQL Editor

alter table public.chat_messages
  add column if not exists metadata jsonb;

drop table if exists public.pending_drafts;
