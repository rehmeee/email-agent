-- Reuse public.agent_memory (from 003) as ONE JSON memory document per user.
-- Replaces the old append-only row model (kind/content rows).
-- Run in Supabase Dashboard → SQL Editor.
--
-- If you already created agent_memory_profiles from an earlier version of this
-- file, it is dropped below.

drop table if exists public.agent_memory_profiles cascade;

drop table if exists public.agent_memory cascade;

create table public.agent_memory (
  user_id uuid primary key references auth.users (id) on delete cascade,
  memory jsonb not null default '{"do":[],"dont":[],"facts":[]}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.agent_memory enable row level security;

-- Accessed server-side via service role only.

create or replace function public.set_agent_memory_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists agent_memory_updated_at on public.agent_memory;
create trigger agent_memory_updated_at
before update on public.agent_memory
for each row
execute function public.set_agent_memory_updated_at();
