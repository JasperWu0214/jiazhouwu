-- Run once in the Supabase SQL Editor. Browser clients have no table policies.
create table if not exists public.page_views (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  page text not null,
  referrer text not null default '',
  user_agent text not null default '',
  language text not null default '',
  timezone text not null default '',
  country text,
  constraint page_views_country_format check (country is null or country ~ '^[A-Z]{2}$')
);

create index if not exists page_views_created_at_id_idx on public.page_views (created_at, id);
alter table public.page_views enable row level security;
revoke all on table public.page_views from anon, authenticated;
-- New Supabase projects do not grant Data API access to new tables by default.
-- Only the server-side service role may insert visits and read reports.
grant select, insert on table public.page_views to service_role;
grant usage, select on sequence public.page_views_id_seq to service_role;
