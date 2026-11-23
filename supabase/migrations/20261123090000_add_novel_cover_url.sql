alter table public.novel_projects
  add column if not exists cover_url text;

comment on column public.novel_projects.cover_url is
  'Direct image URL for the novel cover extracted from its source page.';
