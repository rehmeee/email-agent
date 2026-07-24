-- MailMind-tracked Gmail drafts (inbox auto-drafts + chat accepts).
-- Run in Supabase Dashboard → SQL Editor.

create table if not exists public.mailmind_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  gmail_draft_id text not null,
  source text not null check (source in ('inbox', 'chat')),
  source_message_id text,
  "to" text not null,
  subject text not null,
  body text not null,
  gmail_thread_id text,
  in_reply_to text,
  "references" text,
  status text not null default 'active'
    check (status in ('active', 'superseded', 'dismissed')),
  superseded_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mailmind_drafts_user_active_idx
  on public.mailmind_drafts (user_id, status, updated_at desc);

create unique index if not exists mailmind_drafts_user_gmail_draft_id_idx
  on public.mailmind_drafts (user_id, gmail_draft_id);

alter table public.mailmind_drafts enable row level security;

create or replace function public.set_mailmind_drafts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists mailmind_drafts_updated_at on public.mailmind_drafts;
create trigger mailmind_drafts_updated_at
before update on public.mailmind_drafts
for each row
execute function public.set_mailmind_drafts_updated_at();
