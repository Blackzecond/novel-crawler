import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

type ConversationRow = {
  last_interaction_id: string | null;
  interaction_count: number | null;
};

export async function loadTranslationInteractionId(
  projectId: string,
  model: string,
): Promise<string | undefined> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('novel_ai_conversations')
    .select('last_interaction_id')
    .eq('project_id', projectId)
    .eq('task_type', 'translation')
    .eq('provider', 'gemini')
    .eq('model', model)
    .maybeSingle();
  if (error) throw error;
  const row = data as Pick<ConversationRow, 'last_interaction_id'> | null;
  return row?.last_interaction_id ?? undefined;
}

export async function saveTranslationInteractionId(
  projectId: string,
  model: string,
  interactionId: string,
  chapterOrder?: number,
): Promise<void> {
  const supabase = getSupabase();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error('กรุณาเข้าสู่ระบบก่อนบันทึกสถานะ AI');
  const { data: existing, error: readError } = await supabase
    .from('novel_ai_conversations')
    .select('interaction_count')
    .eq('project_id', projectId)
    .eq('task_type', 'translation')
    .eq('provider', 'gemini')
    .eq('model', model)
    .maybeSingle();
  if (readError) throw readError;
  const count = Number((existing as Pick<ConversationRow, 'interaction_count'> | null)?.interaction_count ?? 0) + 1;
  const { error } = await supabase.from('novel_ai_conversations').upsert({
    user_id: auth.user.id,
    project_id: projectId,
    task_type: 'translation',
    provider: 'gemini',
    model,
    last_interaction_id: interactionId,
    interaction_count: count,
    last_chapter_order: Number.isFinite(chapterOrder) ? chapterOrder : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'project_id,task_type,provider,model' });
  if (error) throw error;
}

export async function loadTranslationInteractionState(projectId: string, model: string): Promise<{ interactionId?: string; count: number; summary: string }> {
  const { data, error } = await getSupabase().from('novel_ai_conversations')
    .select('last_interaction_id,interaction_count,conversation_summary')
    .eq('project_id', projectId).eq('task_type', 'translation').eq('provider', 'gemini').eq('model', model).maybeSingle();
  if (error) throw error;
  return {
    interactionId: data?.last_interaction_id ?? undefined,
    count: Number(data?.interaction_count ?? 0),
    summary: typeof data?.conversation_summary === 'string' ? data.conversation_summary : '',
  };
}

export async function saveTranslationCompaction(
  projectId: string, model: string, summary: string, newInteractionId: string,
): Promise<void> {
  const { error } = await getSupabase().from('novel_ai_conversations')
    .update({ last_interaction_id: newInteractionId, interaction_count: 0, conversation_summary: summary, updated_at: new Date().toISOString() })
    .eq('project_id', projectId).eq('task_type', 'translation').eq('provider', 'gemini').eq('model', model);
  if (error) throw error;
}

type MemoryNode = {
  id: string;
  node_type: string;
  canonical_name: string;
  source_terms: string[] | null;
  summary: string | null;
  attributes: Record<string, unknown> | null;
  importance: number | null;
};

type MemoryEdge = {
  source_node_id: string;
  target_node_id: string;
  relation_type: string;
  description: string | null;
};

function matchesSource(text: string, node: MemoryNode): boolean {
  const terms = [node.canonical_name, ...(node.source_terms ?? [])]
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);
  return terms.some((term) => text.includes(term));
}

/**
 * Retrieves only graph facts whose entity names/aliases occur in this chapter.
 * This first version deliberately uses indexed relational data + exact Chinese
 * term matching; it does not require an embedding API call for every chapter.
 */
export async function loadNovelMemoryContext(
  projectId: string,
  sourceText: string,
  maxCharacters = 4200,
): Promise<string> {
  if (!sourceText.trim()) return '';
  const supabase = getSupabase();
  const { data: nodeRows, error: nodeError } = await supabase
    .from('novel_ai_memory_nodes')
    .select('id,node_type,canonical_name,source_terms,summary,attributes,importance')
    .eq('project_id', projectId)
    .order('importance', { ascending: false })
    .limit(300);
  if (nodeError) throw nodeError;
  const nodes = (nodeRows ?? []) as MemoryNode[];
  if (!nodes.length) return '';

  const matched = nodes.filter((node) => matchesSource(sourceText, node)).slice(0, 16);
  if (!matched.length) return '';
  const matchedIds = new Set(matched.map((node) => node.id));

  const { data: edgeRows, error: edgeError } = await supabase
    .from('novel_ai_memory_edges')
    .select('source_node_id,target_node_id,relation_type,description')
    .eq('project_id', projectId)
    .limit(600);
  if (edgeError) throw edgeError;
  const allEdges = (edgeRows ?? []) as MemoryEdge[];
  const relatedEdges = allEdges.filter((edge) =>
    matchedIds.has(edge.source_node_id) || matchedIds.has(edge.target_node_id)
  ).slice(0, 24);

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const neighborIds = new Set<string>();
  for (const edge of relatedEdges) {
    if (!matchedIds.has(edge.source_node_id)) neighborIds.add(edge.source_node_id);
    if (!matchedIds.has(edge.target_node_id)) neighborIds.add(edge.target_node_id);
  }
  const neighborNodes = [...neighborIds]
    .map((id) => nodeById.get(id))
    .filter((node): node is MemoryNode => Boolean(node))
    .slice(0, 10);

  const lines: string[] = ['[ข้อมูลความจำที่เกี่ยวข้องกับตอนนี้]'];
  for (const node of [...matched, ...neighborNodes]) {
    const summary = node.summary?.trim();
    if (!summary) continue;
    lines.push(`- [${node.node_type}] ${node.canonical_name}: ${summary}`);
  }
  for (const edge of relatedEdges) {
    const source = nodeById.get(edge.source_node_id)?.canonical_name;
    const target = nodeById.get(edge.target_node_id)?.canonical_name;
    if (source && target) {
      lines.push(`- ความสัมพันธ์: ${source} — ${edge.relation_type} — ${target}${edge.description ? ' (' + edge.description + ')' : ''}`);
    }
  }
  return lines.join('\n').slice(0, maxCharacters);
}


export async function loadMemoryExtractionCheckpoint(
  projectId: string,
  provider: string,
  model: string,
): Promise<number | null> {
  const { data, error } = await getSupabase()
    .from('novel_ai_conversations')
    .select('last_chapter_order')
    .eq('project_id', projectId)
    .eq('task_type', 'memory_extraction')
    .eq('provider', provider)
    .eq('model', model)
    .maybeSingle();
  if (error) throw error;
  const value = (data as { last_chapter_order: number | null } | null)?.last_chapter_order;
  return typeof value === 'number' ? value : null;
}

export async function loadNovelMemoryForExtraction(projectId: string, maxCharacters = 9000): Promise<string> {
  const { data, error } = await getSupabase()
    .from('novel_ai_memory_nodes')
    .select('node_type,canonical_name,source_terms,summary,attributes,importance')
    .eq('project_id', projectId)
    .order('importance', { ascending: false })
    .limit(120);
  if (error) throw error;
  const lines = (data ?? []).map((row: any) =>
    `- [${row.node_type}] ${row.canonical_name} (ชื่อที่พบ: ${(row.source_terms ?? []).join(', ')}): ${row.summary}`
  );
  return lines.join('\\n').slice(0, maxCharacters);
}

export async function saveNovelMemoryGraph(
  projectId: string,
  provider: string,
  model: string,
  throughChapterOrder: number,
  extraction: import('@/lib/ai').NovelMemoryExtraction,
): Promise<void> {
  const supabase = getSupabase();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error('กรุณาเข้าสู่ระบบก่อนบันทึกความจำ');
  const { data: existingRows, error: existingError } = await supabase
    .from('novel_ai_memory_nodes')
    .select('id,node_type,canonical_name,source_terms,summary,attributes,importance,first_chapter_order,last_chapter_order')
    .eq('project_id', projectId)
    .limit(1000);
  if (existingError) throw existingError;

  const existing = new Map<string, any>();
  const idsByName = new Map<string, string>();
  for (const row of (existingRows ?? []) as any[]) {
    existing.set(`${row.node_type}::${row.canonical_name.toLocaleLowerCase()}`, row);
    idsByName.set(row.canonical_name.toLocaleLowerCase(), row.id);
  }

  for (const node of extraction.nodes) {
    const nameKey = node.canonical_name.toLocaleLowerCase();
    const key = `${node.node_type}::${nameKey}`;
    const current = existing.get(key);
    const sourceTerms = [...new Set([...(current?.source_terms ?? []), node.canonical_name, ...node.source_terms])].slice(0, 20);
    const payload = {
      source_terms: sourceTerms,
      summary: node.summary,
      attributes: { ...(current?.attributes ?? {}), ...node.attributes },
      importance: Math.max(current?.importance ?? 1, node.importance),
      last_chapter_order: throughChapterOrder,
      evidence: node.evidence ?? null,
      updated_at: new Date().toISOString(),
    };
    if (current) {
      const { error } = await supabase.from('novel_ai_memory_nodes').update(payload).eq('id', current.id);
      if (error) throw error;
      idsByName.set(nameKey, current.id);
    } else {
      const { data, error } = await supabase.from('novel_ai_memory_nodes').insert({
        user_id: auth.user.id,
        project_id: projectId,
        node_type: node.node_type,
        canonical_name: node.canonical_name,
        ...payload,
        first_chapter_order: throughChapterOrder,
      }).select('id').single();
      if (error) throw error;
      idsByName.set(nameKey, data.id);
      existing.set(key, { id: data.id, node_type: node.node_type, canonical_name: node.canonical_name, source_terms: sourceTerms, summary: node.summary, attributes: node.attributes, importance: node.importance, first_chapter_order: throughChapterOrder, last_chapter_order: throughChapterOrder });
    }
  }

  const edgeRows = extraction.edges.flatMap((edge) => {
    const sourceId = idsByName.get(edge.source_name.toLocaleLowerCase());
    const targetId = idsByName.get(edge.target_name.toLocaleLowerCase());
    if (!sourceId || !targetId || sourceId === targetId) return [];
    return [{
      user_id: auth.user.id,
      project_id: projectId,
      source_node_id: sourceId,
      target_node_id: targetId,
      relation_type: edge.relation_type,
      description: edge.description,
      last_chapter_order: throughChapterOrder,
      evidence: edge.evidence ?? null,
      updated_at: new Date().toISOString(),
    }];
  });
  if (edgeRows.length) {
    const { error } = await supabase.from('novel_ai_memory_edges').upsert(edgeRows, {
      onConflict: 'project_id,source_node_id,target_node_id,relation_type',
    });
    if (error) throw error;
  }

  const { data: previous, error: previousError } = await supabase
    .from('novel_ai_conversations')
    .select('interaction_count')
    .eq('project_id', projectId)
    .eq('task_type', 'memory_extraction')
    .eq('provider', provider)
    .eq('model', model)
    .maybeSingle();
  if (previousError) throw previousError;
  const { error: checkpointError } = await supabase.from('novel_ai_conversations').upsert({
    user_id: auth.user.id,
    project_id: projectId,
    task_type: 'memory_extraction',
    provider,
    model,
    last_chapter_order: throughChapterOrder,
    interaction_count: Number((previous as { interaction_count?: number } | null)?.interaction_count ?? 0) + 1,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'project_id,task_type,provider,model' });
  if (checkpointError) throw checkpointError;
}



export type NovelMemoryBackup = {
  nodes: Array<Record<string, any>>;
  edges: Array<Record<string, any>>;
  conversations: Array<Record<string, any>>;
};

async function loadAllProjectRows(table: string, projectId: string, userId: string): Promise<Array<Record<string, any>>> {
  const supabase = getSupabase();
  const pageSize = 500;
  const rows: Array<Record<string, any>> = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from(table).select('*').eq('project_id', projectId)
      .eq('user_id', userId).order('id').range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as Array<Record<string, any>>;
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

/** Export graph memory and project conversation/checkpoint metadata for a complete project backup. */
export async function exportNovelMemoryBundle(projectId: string): Promise<NovelMemoryBackup | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!auth.user) return null;
  const [nodes, edges, conversations] = await Promise.all([
    loadAllProjectRows('novel_ai_memory_nodes', projectId, auth.user.id),
    loadAllProjectRows('novel_ai_memory_edges', projectId, auth.user.id),
    loadAllProjectRows('novel_ai_conversations', projectId, auth.user.id),
  ]);
  return { nodes, edges, conversations };
}

/** Restore project-scoped memory with fresh node/edge IDs. External Gemini interaction IDs are intentionally reset. */
export async function importNovelMemoryBundle(projectId: string, bundle: NovelMemoryBackup | null | undefined): Promise<void> {
  if (!bundle || !isSupabaseConfigured()) return;
  const supabase = getSupabase();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error('กรุณาเข้าสู่ระบบก่อนนำเข้าความจำ AI');
  const now = new Date().toISOString();
  const nodeIds = new Map<string, string>();
  for (const node of bundle.nodes ?? []) if (typeof node.id === 'string') nodeIds.set(node.id, crypto.randomUUID());

  const nodeRows = (bundle.nodes ?? []).flatMap((node) => {
    const id = nodeIds.get(node.id);
    if (!id || !node.canonical_name || !node.node_type) return [];
    return [{
      id, user_id: auth.user.id, project_id: projectId, node_type: node.node_type,
      canonical_name: node.canonical_name, source_terms: Array.isArray(node.source_terms) ? node.source_terms : [],
      summary: typeof node.summary === 'string' ? node.summary : '',
      attributes: node.attributes && typeof node.attributes === 'object' ? node.attributes : {},
      importance: Math.min(5, Math.max(1, Number(node.importance) || 3)),
      first_chapter_order: Number.isFinite(node.first_chapter_order) ? node.first_chapter_order : null,
      last_chapter_order: Number.isFinite(node.last_chapter_order) ? node.last_chapter_order : null,
      evidence: typeof node.evidence === 'string' ? node.evidence : null,
      created_at: typeof node.created_at === 'string' ? node.created_at : now, updated_at: now,
    }];
  });
  for (let i = 0; i < nodeRows.length; i += 200) {
    const { error } = await supabase.from('novel_ai_memory_nodes').insert(nodeRows.slice(i, i + 200));
    if (error) throw error;
  }

  const edgeRows = (bundle.edges ?? []).flatMap((edge) => {
    const sourceId = nodeIds.get(edge.source_node_id); const targetId = nodeIds.get(edge.target_node_id);
    if (!sourceId || !targetId || sourceId === targetId || !edge.relation_type) return [];
    return [{
      id: crypto.randomUUID(), user_id: auth.user.id, project_id: projectId,
      source_node_id: sourceId, target_node_id: targetId, relation_type: edge.relation_type,
      description: typeof edge.description === 'string' ? edge.description : '',
      first_chapter_order: Number.isFinite(edge.first_chapter_order) ? edge.first_chapter_order : null,
      last_chapter_order: Number.isFinite(edge.last_chapter_order) ? edge.last_chapter_order : null,
      evidence: typeof edge.evidence === 'string' ? edge.evidence : null,
      created_at: typeof edge.created_at === 'string' ? edge.created_at : now, updated_at: now,
    }];
  });
  for (let i = 0; i < edgeRows.length; i += 200) {
    const { error } = await supabase.from('novel_ai_memory_edges').insert(edgeRows.slice(i, i + 200));
    if (error) throw error;
  }

  const conversationRows = (bundle.conversations ?? []).flatMap((row) => {
    if (!row.task_type || !row.provider || !row.model) return [];
    return [{
      user_id: auth.user.id, project_id: projectId, task_type: row.task_type,
      provider: row.provider, model: row.model,
      // Interaction IDs belong to the original external Gemini chain; continue from the imported summary instead.
      last_interaction_id: null, interaction_count: 0,
      last_chapter_order: Number.isFinite(row.last_chapter_order) ? row.last_chapter_order : null,
      conversation_summary: typeof row.conversation_summary === 'string' ? row.conversation_summary : '',
      updated_at: now,
    }];
  });
  if (conversationRows.length) {
    const { error } = await supabase.from('novel_ai_conversations').upsert(conversationRows, {
      onConflict: 'project_id,task_type,provider,model',
    });
    if (error) throw error;
  }
}
