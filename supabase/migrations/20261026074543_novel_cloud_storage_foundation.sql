-- Novel Crawler cloud storage foundation
-- Additive schema: does not migrate or delete existing browser localStorage data.

create table if not exists public.novel_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  source_url text not null,
  host text not null default '',
  glossary_mode text not null default 'manual' check (glossary_mode in ('manual', 'auto')),
  last_read_chapter_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create index if not exists novel_projects_user_updated_idx
  on public.novel_projects (user_id, updated_at desc);

create table if not exists public.novel_chapters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,
  source_url text not null,
  title text not null default '',
  chapter_order integer not null,
  status text not null default 'pending' check (status in ('pending', 'fetched', 'translated')),
  original_storage_provider text check (original_storage_provider in ('supabase', 'google_drive')),
  original_storage_path text,
  translated_storage_provider text check (translated_storage_provider in ('supabase', 'google_drive')),
  translated_storage_path text,
  error_message text,
  fetched_at timestamptz,
  translated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint novel_chapters_project_owner_fk
    foreign key (project_id, user_id)
    references public.novel_projects (id, user_id) on delete cascade,
  unique (id, project_id),
  unique (project_id, source_url)
);

create index if not exists novel_chapters_project_order_idx
  on public.novel_chapters (project_id, chapter_order);
create index if not exists novel_chapters_user_project_idx
  on public.novel_chapters (user_id, project_id);

do $$
begin
  alter table public.novel_projects
    add constraint novel_projects_last_read_chapter_fk
    foreign key (last_read_chapter_id)
    references public.novel_chapters (id)
    on delete set null;
exception when duplicate_object then null;
end $$;

create table if not exists public.glossary_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,
  source_term text not null,
  translated_term text not null default '',
  term_type text not null default 'other'
    check (term_type in ('character', 'place', 'organization', 'technique', 'item', 'title', 'other')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint glossary_entries_project_owner_fk
    foreign key (project_id, user_id)
    references public.novel_projects (id, user_id) on delete cascade,
  unique (project_id, source_term)
);

create index if not exists glossary_entries_user_project_idx
  on public.glossary_entries (user_id, project_id);
create index if not exists glossary_entries_source_term_idx
  on public.glossary_entries (source_term);

create table if not exists public.glossary_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, name)
);

create table if not exists public.glossary_set_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  set_id uuid not null,
  source_term text not null,
  translated_term text not null default '',
  term_type text not null default 'other'
    check (term_type in ('character', 'place', 'organization', 'technique', 'item', 'title', 'other')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint glossary_set_entries_set_owner_fk
    foreign key (set_id, user_id)
    references public.glossary_sets (id, user_id) on delete cascade,
  unique (set_id, source_term)
);

create index if not exists glossary_set_entries_user_set_idx
  on public.glossary_set_entries (user_id, set_id);

-- Every exposed table is private to its owning authenticated account.
alter table public.novel_projects enable row level security;
alter table public.novel_chapters enable row level security;
alter table public.glossary_entries enable row level security;
alter table public.glossary_sets enable row level security;
alter table public.glossary_set_entries enable row level security;

drop policy if exists "Owners manage their novel projects" on public.novel_projects;
create policy "Owners manage their novel projects"
  on public.novel_projects for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Owners manage their novel chapters" on public.novel_chapters;
create policy "Owners manage their novel chapters"
  on public.novel_chapters for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Owners manage their glossary entries" on public.glossary_entries;
create policy "Owners manage their glossary entries"
  on public.glossary_entries for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Owners manage their glossary sets" on public.glossary_sets;
create policy "Owners manage their glossary sets"
  on public.glossary_sets for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Owners manage their glossary set entries" on public.glossary_set_entries;
create policy "Owners manage their glossary set entries"
  on public.glossary_set_entries for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.novel_projects, public.novel_chapters, public.glossary_entries,
  public.glossary_sets, public.glossary_set_entries from anon;
grant select, insert, update, delete on public.novel_projects, public.novel_chapters,
  public.glossary_entries, public.glossary_sets, public.glossary_set_entries to authenticated;

-- Private bucket for chapter text. Object paths must begin with the authenticated user UUID.
insert into storage.buckets (id, name, public)
values ('novel-content', 'novel-content', false)
on conflict (id) do update set public = false;

drop policy if exists "Owners read their novel content" on storage.objects;
create policy "Owners read their novel content"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'novel-content'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Owners upload their novel content" on storage.objects;
create policy "Owners upload their novel content"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'novel-content'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Owners update their novel content" on storage.objects;
create policy "Owners update their novel content"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'novel-content'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'novel-content'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Owners delete their novel content" on storage.objects;
create policy "Owners delete their novel content"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'novel-content'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
