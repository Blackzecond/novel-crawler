alter table public.novel_projects
  add column if not exists glossary_metadata jsonb not null default '{}'::jsonb,
  add column if not exists glossary_detection jsonb not null default '{"characters":false,"terms":false}'::jsonb;

comment on column public.novel_projects.glossary_metadata is
  'Per-source glossary metadata: gender, category, and notes.';
comment on column public.novel_projects.glossary_detection is
  'Per-project AI glossary detection switches for characters and terms.';
