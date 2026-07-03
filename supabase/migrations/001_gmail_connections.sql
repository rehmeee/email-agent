-- Run this in Supabase Dashboard → SQL Editor

create table if not exists public.gmail_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  google_email text,
  access_token text not null,
  refresh_token text,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.gmail_connections enable row level security;

-- Tokens are only accessed server-side via the service role key.
-- No RLS policies for authenticated users on this table.

create or replace function public.set_gmail_connections_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists gmail_connections_updated_at on public.gmail_connections;

create trigger gmail_connections_updated_at
before update on public.gmail_connections
for each row
execute function public.set_gmail_connections_updated_at();
