-- Per-account preferences synced across devices.
create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reader_settings jsonb not null default '{}'::jsonb,
  ai_settings jsonb not null default '{}'::jsonb,
  reading_history jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

drop policy if exists "Owners manage their preferences" on public.user_preferences;
create policy "Owners manage their preferences"
  on public.user_preferences for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.user_preferences from anon;
grant select, insert, update, delete on public.user_preferences to authenticated;
