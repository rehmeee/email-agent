-- Run this in Supabase Dashboard → SQL Editor

create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_threads_user_id_idx on public.chat_threads (user_id);
create index if not exists chat_threads_updated_at_idx on public.chat_threads (updated_at desc);
create index if not exists chat_messages_thread_id_idx on public.chat_messages (thread_id);

alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;

-- Accessed server-side via service role only (same pattern as gmail_connections).

create or replace function public.set_chat_threads_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists chat_threads_updated_at on public.chat_threads;

create trigger chat_threads_updated_at
before update on public.chat_threads
for each row
execute function public.set_chat_threads_updated_at();
