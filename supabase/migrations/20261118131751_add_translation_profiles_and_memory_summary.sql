alter table public.novel_projects
  add column if not exists translation_profile text not null default 'general'
  check (translation_profile in ('general','modern','xianxia','wuxia','fantasy','scifi'));

alter table public.novel_ai_conversations
  add column if not exists conversation_summary text not null default '';

grant select, insert, update, delete on public.novel_projects to authenticated;
