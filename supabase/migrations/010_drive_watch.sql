-- Drive changes.watch state (per Google-connected user).
-- Run in Supabase Dashboard → SQL Editor.

alter table public.gmail_connections
  add column if not exists drive_page_token text,
  add column if not exists drive_channel_id text,
  add column if not exists drive_resource_id text,
  add column if not exists drive_watch_expiration timestamptz;

create index if not exists gmail_connections_drive_channel_id_idx
  on public.gmail_connections (drive_channel_id)
  where drive_channel_id is not null;
