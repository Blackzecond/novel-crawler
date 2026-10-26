-- Keep the full table of contents as project metadata; only downloaded chapters need rows.
alter table public.novel_projects
  add column if not exists chapter_catalog jsonb not null default '[]'::jsonb;

-- Reader HTML is cached separately from extracted plain text.
alter table public.novel_chapters
  add column if not exists reader_storage_path text;

-- Preserve all existing chapter links in the catalog before cleaning up unfetched rows.
update public.novel_projects p
set chapter_catalog = coalesce((
  select jsonb_agg(
    jsonb_build_object(
      'url', c.source_url,
      'title', c.title,
      'order', c.chapter_order
    ) order by c.chapter_order
  )
  from public.novel_chapters c
  where c.project_id = p.id
), '[]'::jsonb)
where jsonb_array_length(p.chapter_catalog) = 0
  and exists (select 1 from public.novel_chapters c where c.project_id = p.id);

-- Pending rows without any cached content are represented by chapter_catalog instead.
delete from public.novel_chapters
where status = 'pending'
  and original_storage_path is null
  and translated_storage_path is null
  and reader_storage_path is null;
