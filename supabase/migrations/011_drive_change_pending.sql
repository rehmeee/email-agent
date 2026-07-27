-- Debounced Drive change queue (per user + file).
-- Run in Supabase Dashboard → SQL Editor.

create table if not exists public.drive_change_pending (
  user_id uuid not null references auth.users (id) on delete cascade,
  file_id text not null,
  last_event_at timestamptz not null default now(),
  removed boolean not null default false,
  trashed boolean not null default false,
  mime_type text,
  name text,
  event_count integer not null default 1
    check (event_count >= 1),
  processing_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, file_id)
);

create index if not exists drive_change_pending_drain_idx
  on public.drive_change_pending (last_event_at)
  where processing_at is null;

alter table public.drive_change_pending enable row level security;

-- Accessed server-side via service role only.
