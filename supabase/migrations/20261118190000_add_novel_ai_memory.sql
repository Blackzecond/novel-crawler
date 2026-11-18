-- Project-scoped stateful AI conversations and relational novel memory.
create table if not exists public.novel_ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,
  task_type text not null check (task_type in ('translation', 'editor', 'detection', 'memory_extraction')),
  provider text not null,
  model text not null,
  last_interaction_id text,
  interaction_count integer not null default 0 check (interaction_count >= 0),
  last_chapter_order integer,
  updated_at timestamptz not null default now(),
  constraint novel_ai_conversations_project_owner_fk
    foreign key (project_id, user_id)
    references public.novel_projects(id, user_id) on delete cascade,
  constraint novel_ai_conversations_scope_key
    unique (project_id, task_type, provider, model)
);

create index if not exists novel_ai_conversations_user_project_idx
  on public.novel_ai_conversations(user_id, project_id);

create table if not exists public.novel_ai_memory_nodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,
  node_type text not null check (node_type in ('character', 'organization', 'location', 'technique', 'item', 'event', 'concept', 'other')),
  canonical_name text not null check (length(btrim(canonical_name)) > 0),
  source_terms text[] not null default '{}',
  summary text not null default '',
  attributes jsonb not null default '{}'::jsonb,
  importance smallint not null default 3 check (importance between 1 and 5),
  first_chapter_order integer,
  last_chapter_order integer,
  evidence text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint novel_ai_memory_nodes_project_owner_fk
    foreign key (project_id, user_id)
    references public.novel_projects(id, user_id) on delete cascade,
  constraint novel_ai_memory_nodes_identity_unique
    unique (id, project_id, user_id)
);

create unique index if not exists novel_ai_memory_nodes_name_unique
  on public.novel_ai_memory_nodes(project_id, node_type, lower(canonical_name));
create index if not exists novel_ai_memory_nodes_source_terms_gin
  on public.novel_ai_memory_nodes using gin(source_terms);
create index if not exists novel_ai_memory_nodes_project_importance_idx
  on public.novel_ai_memory_nodes(project_id, importance desc, updated_at desc);

create table if not exists public.novel_ai_memory_edges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,
  source_node_id uuid not null,
  target_node_id uuid not null,
  relation_type text not null check (length(btrim(relation_type)) > 0),
  description text not null default '',
  first_chapter_order integer,
  last_chapter_order integer,
  evidence text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint novel_ai_memory_edges_project_owner_fk
    foreign key (project_id, user_id)
    references public.novel_projects(id, user_id) on delete cascade,
  constraint novel_ai_memory_edges_source_fk
    foreign key (source_node_id, project_id, user_id)
    references public.novel_ai_memory_nodes(id, project_id, user_id) on delete cascade,
  constraint novel_ai_memory_edges_target_fk
    foreign key (target_node_id, project_id, user_id)
    references public.novel_ai_memory_nodes(id, project_id, user_id) on delete cascade,
  constraint novel_ai_memory_edges_not_self check (source_node_id <> target_node_id),
  constraint novel_ai_memory_edges_unique
    unique (project_id, source_node_id, target_node_id, relation_type)
);

create index if not exists novel_ai_memory_edges_source_idx
  on public.novel_ai_memory_edges(project_id, source_node_id);
create index if not exists novel_ai_memory_edges_target_idx
  on public.novel_ai_memory_edges(project_id, target_node_id);

alter table public.novel_ai_conversations enable row level security;
alter table public.novel_ai_memory_nodes enable row level security;
alter table public.novel_ai_memory_edges enable row level security;

drop policy if exists "Users manage their novel AI conversations" on public.novel_ai_conversations;
create policy "Users manage their novel AI conversations"
  on public.novel_ai_conversations for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their novel AI memory nodes" on public.novel_ai_memory_nodes;
create policy "Users manage their novel AI memory nodes"
  on public.novel_ai_memory_nodes for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their novel AI memory edges" on public.novel_ai_memory_edges;
create policy "Users manage their novel AI memory edges"
  on public.novel_ai_memory_edges for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.novel_ai_conversations to authenticated;
grant select, insert, update, delete on public.novel_ai_memory_nodes to authenticated;
grant select, insert, update, delete on public.novel_ai_memory_edges to authenticated;
