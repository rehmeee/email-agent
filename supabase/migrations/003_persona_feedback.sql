-- Run this in Supabase Dashboard → SQL Editor

create table if not exists public.persona_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  profile jsonb not null default '{}'::jsonb,
  source_sample_count integer not null default 0,
  status text not null default 'building'
    check (status in ('building', 'ready', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('preference', 'fact', 'correction', 'style_note')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists agent_memory_user_id_created_at_idx
  on public.agent_memory (user_id, created_at desc);

create table if not exists public.pending_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  thread_id uuid references public.chat_threads (id) on delete set null,
  to_addrs text not null,
  subject text not null,
  body text not null,
  gmail_thread_id text,
  in_reply_to text,
  references_header text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  feedback text,
  gmail_draft_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pending_drafts_user_id_created_at_idx
  on public.pending_drafts (user_id, created_at desc);

alter table public.persona_profiles enable row level security;
alter table public.agent_memory enable row level security;
alter table public.pending_drafts enable row level security;

-- Accessed server-side via service role only (same pattern as gmail_connections).

create or replace function public.set_persona_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists persona_profiles_updated_at on public.persona_profiles;
create trigger persona_profiles_updated_at
before update on public.persona_profiles
for each row
execute function public.set_persona_profiles_updated_at();

create or replace function public.set_pending_drafts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists pending_drafts_updated_at on public.pending_drafts;
create trigger pending_drafts_updated_at
before update on public.pending_drafts
for each row
execute function public.set_pending_drafts_updated_at();
