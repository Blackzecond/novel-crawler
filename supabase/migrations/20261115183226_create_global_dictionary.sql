-- Global dictionary shared by all novels owned by one account.
-- Project glossary entries remain independent and take precedence during matching.

create table if not exists public.global_dictionary_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_term text not null check (length(btrim(source_term)) > 0),
  translated_term text not null check (length(btrim(translated_term)) > 0),
  category text not null default 'other'
    check (category in ('brand', 'food', 'drink', 'app', 'place', 'culture', 'unit', 'title', 'other')),
  aliases text[] not null default '{}'::text[],
  notes text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_term)
);

create index if not exists global_dictionary_user_active_idx
  on public.global_dictionary_entries (user_id, is_active, source_term);
create index if not exists global_dictionary_aliases_gin_idx
  on public.global_dictionary_entries using gin (aliases);

alter table public.global_dictionary_entries enable row level security;

drop policy if exists "Owners manage their global dictionary" on public.global_dictionary_entries;
create policy "Owners manage their global dictionary"
  on public.global_dictionary_entries for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.global_dictionary_entries from anon;
grant select, insert, update, delete on public.global_dictionary_entries to authenticated;

comment on table public.global_dictionary_entries is
  'Per-user reusable Chinese-to-Thai translation terms shared across all novel projects.';
comment on column public.global_dictionary_entries.aliases is
  'Alternative source spellings that map to the same Thai translation.';
comment on column public.global_dictionary_entries.notes is
  'Short context hint for AI; only sent when the entry matches the current chapter.';
