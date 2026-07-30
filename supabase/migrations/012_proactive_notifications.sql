-- Proactive notifications + draft/meeting watches.
-- Run in Supabase Dashboard → SQL Editor.

-- Short-lived per-user notification inbox
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null
    check (type in ('important_email', 'draft_unsent', 'meeting_reminder')),
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create unique index if not exists notifications_user_dedupe_idx
  on public.notifications (user_id, dedupe_key);

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

create index if not exists notifications_expires_idx
  on public.notifications (expires_at);

alter table public.notifications enable row level security;

-- Draft watches (one-shot; last 4h of 2-day wait)
create table if not exists public.draft_watches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mailmind_draft_id uuid not null references public.mailmind_drafts (id) on delete cascade,
  gmail_draft_id text not null,
  source text not null check (source in ('chat', 'inbox_important')),
  subject text not null default '',
  window_open timestamptz not null,
  window_end timestamptz not null,
  created_at timestamptz not null default now()
);

create unique index if not exists draft_watches_user_draft_idx
  on public.draft_watches (user_id, mailmind_draft_id);

create index if not exists draft_watches_due_idx
  on public.draft_watches (window_open, window_end);

create index if not exists draft_watches_user_idx
  on public.draft_watches (user_id, created_at);

alter table public.draft_watches enable row level security;

-- Meeting watches (multi-read; T-30m default)
create table if not exists public.meeting_watches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  calendar_event_id text not null,
  title text not null,
  starts_at timestamptz not null,
  lead_minutes integer[] not null default '{40}'::integer[],
  fired_leads integer[] not null default '{}'::integer[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists meeting_watches_user_event_idx
  on public.meeting_watches (user_id, calendar_event_id);

create index if not exists meeting_watches_starts_idx
  on public.meeting_watches (starts_at);

alter table public.meeting_watches enable row level security;

create or replace function public.set_meeting_watches_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists meeting_watches_updated_at on public.meeting_watches;
create trigger meeting_watches_updated_at
before update on public.meeting_watches
for each row
execute function public.set_meeting_watches_updated_at();
