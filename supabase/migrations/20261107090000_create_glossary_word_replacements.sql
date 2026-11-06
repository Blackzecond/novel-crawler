create table if not exists public.glossary_replacements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.novel_projects(id) on delete cascade,
  variants text[] not null default '{}',
  replacement_text text not null,
  use_regex boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint glossary_replacements_variants_nonempty check (cardinality(variants) > 0),
  constraint glossary_replacements_replacement_nonempty check (length(trim(replacement_text)) > 0)
);
create index if not exists glossary_replacements_project_idx
  on public.glossary_replacements (project_id, created_at);
alter table public.glossary_replacements enable row level security;
grant select, insert, update, delete on public.glossary_replacements to authenticated;
create policy "Users can view their own glossary replacements"
  on public.glossary_replacements for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can insert their own glossary replacements"
  on public.glossary_replacements for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users can update their own glossary replacements"
  on public.glossary_replacements for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users can delete their own glossary replacements"
  on public.glossary_replacements for delete to authenticated
  using ((select auth.uid()) = user_id);
