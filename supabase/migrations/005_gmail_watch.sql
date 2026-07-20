-- Run in Supabase Dashboard → SQL Editor

alter table public.gmail_connections
  add column if not exists history_id text,
  add column if not exists watch_expiration timestamptz;

create table if not exists public.processed_gmail_messages (
  user_id uuid not null references auth.users (id) on delete cascade,
  gmail_message_id text not null,
  processed_at timestamptz not null default now(),
  action text not null default 'triaged',
  primary key (user_id, gmail_message_id)
);

alter table public.processed_gmail_messages enable row level security;
