-- Drive file knowledge cache for MailMind summarize agent.
-- Run in Supabase Dashboard → SQL Editor.

create table if not exists public.drive_file_summaries (
  user_id uuid not null references auth.users (id) on delete cascade,
  file_id text not null,
  name text not null,
  mime_type text not null default '',
  description text not null default '',
  summary text not null,
  modified_time timestamptz,
  size_bytes bigint,
  export_format_hint text,
  draft_use_count integer not null default 0
    check (draft_use_count >= 0),
  status text not null default 'active'
    check (status in ('active', 'deleted')),
  last_reason text not null default 'chat_miss'
    check (last_reason in ('chat_miss', 'drive_event')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, file_id)
);

create index if not exists drive_file_summaries_user_updated_idx
  on public.drive_file_summaries (user_id, updated_at desc);

create index if not exists drive_file_summaries_user_use_count_idx
  on public.drive_file_summaries (user_id, draft_use_count desc);

alter table public.drive_file_summaries enable row level security;

-- Accessed server-side via service role only.

create or replace function public.set_drive_file_summaries_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists drive_file_summaries_updated_at on public.drive_file_summaries;
create trigger drive_file_summaries_updated_at
before update on public.drive_file_summaries
for each row
execute function public.set_drive_file_summaries_updated_at();
