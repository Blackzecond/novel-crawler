-- Cover the composite ownership foreign keys and last-read lookup.
create index if not exists novel_projects_last_read_chapter_idx
  on public.novel_projects (last_read_chapter_id)
  where last_read_chapter_id is not null;

create index if not exists novel_chapters_project_owner_fk_idx
  on public.novel_chapters (project_id, user_id);

create index if not exists glossary_entries_project_owner_fk_idx
  on public.glossary_entries (project_id, user_id);

create index if not exists glossary_set_entries_set_owner_fk_idx
  on public.glossary_set_entries (set_id, user_id);
