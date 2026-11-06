import type { GlossaryDetection, GlossaryMetadata, NewProjectData, NovelChapter, NovelProject, NovelStore, WordReplacement } from '@/lib/storage';
import { getSupabase } from '@/lib/supabase';

const BUCKET = 'novel-content';

type ProjectRow = {
  id: string; title: string; source_url: string; host: string;
  glossary_mode: 'manual' | 'auto'; glossary_metadata?: Record<string, GlossaryMetadata> | null; glossary_detection?: GlossaryDetection | null; last_read_chapter_id: string | null;
  chapter_catalog: { url: string; title: string; order: number }[] | null;
  created_at: string; updated_at: string;
};
type ChapterRow = {
  id: string; project_id: string; source_url: string; title: string;
  chapter_order: number; status: NovelChapter['status'];
  original_storage_provider: 'supabase' | 'google_drive' | null;
  original_storage_path: string | null;
  reader_storage_path: string | null;
  translated_storage_provider: 'supabase' | 'google_drive' | null;
  translated_storage_path: string | null;
  error_message: string | null; created_at: string; updated_at: string;
};
type ReplacementRow = { id: string; variants: string[]; replacement_text: string; use_regex: boolean; created_at: string };
type GlossaryRow = { project_id: string; source_term: string; translated_term: string; term_type?: string | null };

function toTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function mapChapter(row: ChapterRow): NovelChapter {
  return {
    id: row.id,
    url: row.source_url,
    title: row.title,
    order: row.chapter_order,
    status: row.status,
    error: row.error_message ?? undefined,
  };
}

function mapProject(row: ProjectRow, fetchedChapters: NovelChapter[], glossary: Record<string, string>, glossaryTypes: Record<string, 'character' | 'term'>, wordReplacements: WordReplacement[]): NovelProject {
  const fetchedByUrl = new Map(fetchedChapters.map((chapter) => [chapter.url, chapter]));
  const catalog = Array.isArray(row.chapter_catalog) ? row.chapter_catalog : [];
  const chapters: NovelChapter[] = catalog.map((item) => fetchedByUrl.get(item.url) ?? ({
    id: `catalog:${encodeURIComponent(item.url)}`,
    url: item.url,
    title: item.title,
    order: item.order,
    status: 'pending' as const,
  }));
  const catalogUrls = new Set(catalog.map((item) => item.url));
  for (const chapter of fetchedChapters) if (!catalogUrls.has(chapter.url)) chapters.push(chapter);
  return {
    id: row.id,
    title: row.title,
    sourceUrl: row.source_url,
    host: row.host,
    glossary,
    glossaryTypes,
    wordReplacements,
    glossaryMode: row.glossary_mode,
    lastReadChapterId: row.last_read_chapter_id ?? undefined,
    chapters,
    createdAt: toTimestamp(row.created_at),
    updatedAt: toTimestamp(row.updated_at),
  };
}

async function currentUserId(): Promise<string> {
  const { data, error } = await getSupabase().auth.getUser();
  if (error || !data.user) throw new Error('กรุณาเข้าสู่ระบบก่อนใช้งานคลังนิยาย');
  return data.user.id;
}

async function loadProjectRows(projectId?: string) {
  const supabase = getSupabase();
  let query = supabase.from('novel_projects').select('*').order('updated_at', { ascending: false });
  if (projectId) query = query.eq('id', projectId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ProjectRow[];
}

async function loadChapters(projectIds: string[]): Promise<ChapterRow[]> {
  if (!projectIds.length) return [];
  const { data, error } = await getSupabase()
    .from('novel_chapters').select('*').in('project_id', projectIds).order('chapter_order');
  if (error) throw error;
  return (data ?? []) as ChapterRow[];
}

async function loadGlossary(projectIds: string[]): Promise<Map<string, { terms: Record<string, string>; types: Record<string, 'character' | 'term'> }>> {
  const result = new Map<string, { terms: Record<string, string>; types: Record<string, 'character' | 'term'> }>();
  if (!projectIds.length) return result;
  const { data, error } = await getSupabase()
    .from('glossary_entries').select('project_id, source_term, translated_term, term_type')
    .in('project_id', projectIds);
  if (error) throw error;
  for (const row of (data ?? []) as GlossaryRow[]) {
    const value = result.get(row.project_id) ?? { terms: {}, types: {} };
    value.terms[row.source_term] = row.translated_term;
    value.types[row.source_term] = row.term_type === 'character' ? 'character' : 'term';
    result.set(row.project_id, value);
  }
  return result;
}

async function loadWordReplacements(projectIds: string[]): Promise<Map<string, WordReplacement[]>> {
  const result = new Map<string, WordReplacement[]>();
  if (!projectIds.length) return result;
  const { data, error } = await getSupabase().from('glossary_replacements')
    .select('id, project_id, variants, replacement_text, use_regex, created_at')
    .in('project_id', projectIds).order('created_at');
  if (error) throw error;
  for (const row of (data ?? []) as Array<ReplacementRow & { project_id: string }>) {
    const items = result.get(row.project_id) ?? [];
    items.push({ id: row.id, variants: row.variants ?? [], replacement: row.replacement_text, useRegex: row.use_regex });
    result.set(row.project_id, items);
  }
  return result;
}

async function buildProjects(rows: ProjectRow[]): Promise<NovelProject[]> {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const [chapters, glossaries, replacements] = await Promise.all([loadChapters(ids), loadGlossary(ids), loadWordReplacements(ids)]);
  const byProject = new Map<string, NovelChapter[]>();
  for (const row of chapters) {
    const list = byProject.get(row.project_id) ?? [];
    list.push(mapChapter(row));
    byProject.set(row.project_id, list);
  }
  return rows.map((row) => {
    const glossary = glossaries.get(row.id) ?? { terms: {}, types: {} };
    return mapProject(row, byProject.get(row.id) ?? [], glossary.terms, glossary.types, replacements.get(row.id) ?? []);
  });
}

function contentPath(userId: string, projectId: string, chapterId: string, kind: 'original' | 'translated' | 'reader') {
  return `${userId}/${projectId}/${chapterId}/${kind}.txt`;
}

async function putText(path: string, value: string): Promise<void> {
  const { error } = await getSupabase().storage.from(BUCKET).upload(path, new Blob([value], { type: 'text/plain;charset=utf-8' }), {
    upsert: true,
    contentType: 'text/plain; charset=utf-8',
    cacheControl: '3600',
  });
  if (error) throw error;
}

async function readText(path: string | null): Promise<string | undefined> {
  if (!path) return undefined;
  const { data, error } = await getSupabase().storage.from(BUCKET).download(path);
  if (error) {
    // Older metadata may point to a file not yet migrated; preserve the chapter list.
    if (error.message.toLowerCase().includes('not found') || error.message.toLowerCase().includes('object')) return undefined;
    throw error;
  }
  return await data.text();
}

async function getChapterRowByUrl(projectId: string, url: string): Promise<ChapterRow | null> {
  const { data, error } = await getSupabase().from('novel_chapters')
    .select('*').eq('project_id', projectId).eq('source_url', url).maybeSingle();
  if (error) throw error;
  return (data as ChapterRow | null) ?? null;
}

async function getChapterRow(projectId: string, chapterId: string): Promise<ChapterRow | null> {
  const { data, error } = await getSupabase().from('novel_chapters')
    .select('*').eq('project_id', projectId).eq('id', chapterId).maybeSingle();
  if (error) throw error;
  return (data as ChapterRow | null) ?? null;
}

async function loadOneProject(projectId: string): Promise<NovelProject | null> {
  const rows = await loadProjectRows(projectId);
  if (!rows.length) return null;
  const [project] = await buildProjects(rows);
  return project;
}

export const supabaseStore: NovelStore = {
  async listProjects() {
    await currentUserId();
    return buildProjects(await loadProjectRows());
  },

  async getProject(id) {
    await currentUserId();
    return loadOneProject(id);
  },

  async getChapterContent(projectId, chapterId, options = {}) {
    await currentUserId();
    const row = await getChapterRow(projectId, chapterId);
    if (!row) return null;
    const includeOriginalText = options.includeOriginalText !== false;
    const includeTranslatedText = options.includeTranslatedText !== false;
    const chapter = mapChapter(row);
    const [originalText, readerContent, translatedText] = await Promise.all([
      includeOriginalText && row.original_storage_provider === 'supabase'
        ? readText(row.original_storage_path)
        : Promise.resolve(undefined),
      row.reader_storage_path ? readText(row.reader_storage_path) : Promise.resolve(undefined),
      includeTranslatedText && row.translated_storage_provider === 'supabase'
        ? readText(row.translated_storage_path)
        : Promise.resolve(undefined),
    ]);
    if (originalText !== undefined) chapter.originalText = originalText;
    if (readerContent !== undefined) chapter.readerContent = readerContent;
    if (translatedText !== undefined) chapter.translatedText = translatedText;
    return chapter;
  },

  async createProject(data: NewProjectData) {
    const userId = await currentUserId();
    const supabase = getSupabase();
    const { data: row, error } = await supabase.from('novel_projects').insert({
      user_id: userId,
      title: data.title,
      source_url: data.sourceUrl,
      host: data.host,
      glossary_mode: 'manual',
      chapter_catalog: data.chapters,
    }).select('*').single();
    if (error) throw error;
    const projectRow = row as ProjectRow;

    if (data.glossary && Object.keys(data.glossary).length) {
      const entries = Object.entries(data.glossary).map(([source_term, translated_term]) => ({
        user_id: userId, project_id: projectRow.id, source_term, translated_term, term_type: 'other',
      }));
      const { error: glossaryError } = await supabase.from('glossary_entries').insert(entries);
      if (glossaryError) throw glossaryError;
    }
    const created = await loadOneProject(projectRow.id);
    if (!created) throw new Error('สร้างโปรเจกต์แล้วแต่โหลดข้อมูลกลับไม่สำเร็จ');
    return created;
  },

  async renameProject(id, title) {
    return this.updateProject(id, { title });
  },

  async updateProject(id, patch) {
    const userId = await currentUserId();
    const supabase = getSupabase();
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.title !== undefined) update.title = patch.title;
    if (patch.glossaryMode !== undefined) update.glossary_mode = patch.glossaryMode;
    if (patch.glossaryMetadata !== undefined) update.glossary_metadata = patch.glossaryMetadata;
    if (patch.glossaryDetection !== undefined) { update.glossary_detection = patch.glossaryDetection; update.glossary_mode = patch.glossaryDetection.characters || patch.glossaryDetection.terms ? 'auto' : 'manual'; }
    if (patch.lastReadChapterId !== undefined) update.last_read_chapter_id = patch.lastReadChapterId || null;
    if (Object.keys(update).length > 1 || patch.glossary !== undefined || patch.glossaryTypes !== undefined) {
      const { error } = await supabase.from('novel_projects').update(update).eq('id', id).eq('user_id', userId);
      if (error) throw error;
    }
    if (patch.wordReplacements !== undefined) {
      const { data: existingRules, error: existingRulesError } = await supabase.from('glossary_replacements')
        .select('id').eq('project_id', id).eq('user_id', userId);
      if (existingRulesError) throw existingRulesError;
      const nextIds = new Set(patch.wordReplacements.map((item) => item.id));
      const removedIds = ((existingRules ?? []) as Array<{ id: string }>).map((item) => item.id).filter((ruleId) => !nextIds.has(ruleId));
      if (removedIds.length) {
        const { error: deleteError } = await supabase.from('glossary_replacements')
          .delete().eq('project_id', id).eq('user_id', userId).in('id', removedIds);
        if (deleteError) throw deleteError;
      }
      if (patch.wordReplacements.length) {
        const rows = patch.wordReplacements.map((item) => ({
          id: item.id,
          user_id: userId,
          project_id: id,
          variants: item.variants,
          replacement_text: item.replacement,
          use_regex: item.useRegex,
          updated_at: new Date().toISOString(),
        }));
        const { error: upsertError } = await supabase.from('glossary_replacements').upsert(rows, { onConflict: 'id' });
        if (upsertError) throw upsertError;
      }
    }
    if (patch.glossary !== undefined || patch.glossaryTypes !== undefined) {
      const { data: existing, error: existingError } = await supabase.from('glossary_entries')
        .select('source_term, translated_term, term_type').eq('project_id', id).eq('user_id', userId);
      if (existingError) throw existingError;
      const existingRows = (existing ?? []) as Array<{ source_term: string; translated_term: string; term_type?: string | null }>;
      const existingMap = new Map(existingRows.map((row) => [row.source_term, row]));
      const terms = patch.glossary ?? Object.fromEntries(existingRows.map((row) => [row.source_term, row.translated_term]));
      const wanted = new Set(Object.keys(terms));
      const removed = existingRows.map((row) => row.source_term).filter((term) => !wanted.has(term));
      if (removed.length) {
        const { error } = await supabase.from('glossary_entries').delete()
          .eq('project_id', id).eq('user_id', userId).in('source_term', removed);
        if (error) throw error;
      }
      const entries = Object.entries(terms).map(([source_term, translated_term]) => ({
        user_id: userId, project_id: id, source_term, translated_term,
        term_type: patch.glossaryTypes?.[source_term] === 'character' || (!patch.glossaryTypes?.[source_term] && existingMap.get(source_term)?.term_type === 'character') ? 'character' : 'other',
      }));
      if (entries.length) {
        const { error } = await supabase.from('glossary_entries').upsert(entries, { onConflict: 'project_id,source_term' });
        if (error) throw error;
      }
    }
    return loadOneProject(id);
  },

  async deleteGlossaryTerms(projectId, sourceTerms) {
    if (!sourceTerms.length) return loadOneProject(projectId);
    const userId = await currentUserId();
    const { error } = await getSupabase().from('glossary_entries').delete()
      .eq('project_id', projectId).eq('user_id', userId).in('source_term', sourceTerms);
    if (error) throw error;
    return loadOneProject(projectId);
  },

  async importProjects(incoming) {
    let imported = 0;
    let skipped = 0;
    for (const raw of incoming) {
      if (!raw || typeof raw !== 'object' || !raw.id || !Array.isArray(raw.chapters)) {
        skipped++;
        continue;
      }
      let created: NovelProject | null = null;
      try {
        created = await this.createProject({
          title: String(raw.title ?? 'ไม่มีชื่อเรื่อง'),
          sourceUrl: String(raw.sourceUrl ?? ''),
          host: String(raw.host ?? ''),
          chapters: raw.chapters.map((chapter: NovelChapter) => ({
            url: String(chapter.url ?? ''),
            title: String(chapter.title ?? ''),
            order: Number(chapter.order) || 0,
          })),
        });
        const oldToNew = new Map<string, string>();
        const normalizedChapters = [...raw.chapters].sort((a: NovelChapter, b: NovelChapter) => a.order - b.order);
        const newChapters = [...created.chapters].sort((a, b) => a.order - b.order);
        normalizedChapters.forEach((chapter: NovelChapter, index: number) => {
          if (newChapters[index]) oldToNew.set(chapter.id, newChapters[index].id);
        });

        for (const oldChapter of raw.chapters as NovelChapter[]) {
          const newId = oldToNew.get(oldChapter.id);
          if (!newId) continue;
          const hasSavedContent = Boolean(oldChapter.originalText || oldChapter.translatedText || oldChapter.readerContent);
          if ((oldChapter.status ?? 'pending') === 'pending' && !hasSavedContent) continue;
          const patch: Partial<Omit<NovelChapter, 'id'>> = {
            url: oldChapter.url, title: oldChapter.title, order: oldChapter.order,
            status: oldChapter.status ?? 'pending',
            error: oldChapter.error,
            originalText: oldChapter.originalText,
            translatedText: oldChapter.translatedText,
            readerContent: oldChapter.readerContent,
          };
          await this.updateChapter(created.id, newId, patch);
        }
        const glossary = raw.glossary && typeof raw.glossary === 'object' ? raw.glossary as Record<string, string> : {};
        const refreshed = await this.getProject(created.id);
        const oldLastRead = (raw.chapters as NovelChapter[]).find((chapter) => chapter.id === raw.lastReadChapterId);
        const newLastRead = oldLastRead ? refreshed?.chapters.find((chapter) => chapter.url === oldLastRead.url && chapter.status !== 'pending') : undefined;
        await this.updateProject(created.id, {
          glossary,
          wordReplacements: Array.isArray(raw.wordReplacements) ? raw.wordReplacements : [],
          glossaryMode: raw.glossaryMode === 'auto' ? 'auto' : 'manual',
          glossaryMetadata: raw.glossaryMetadata && typeof raw.glossaryMetadata === 'object' ? raw.glossaryMetadata : {},
          glossaryDetection: raw.glossaryDetection && typeof raw.glossaryDetection === 'object' ? raw.glossaryDetection : { characters: raw.glossaryMode === 'auto', terms: raw.glossaryMode === 'auto' },
          lastReadChapterId: newLastRead?.id,
        });
        imported++;
      } catch {
        skipped++;
        if (created) await this.deleteProject(created.id).catch(() => undefined);
      }
    }
    return { imported, skipped };
  },

  async renameChapter(projectId, chapterId, title) {
    const userId = await currentUserId();
    const supabase = getSupabase();
    const { data: projectRow, error: projectError } = await supabase.from('novel_projects')
      .select('chapter_catalog').eq('id', projectId).eq('user_id', userId).single();
    if (projectError) throw projectError;
    const catalog = Array.isArray(projectRow.chapter_catalog) ? projectRow.chapter_catalog : [];
    const target = await loadOneProject(projectId);
    const chapter = target?.chapters.find((item) => item.id === chapterId);
    if (!chapter) return target;
    const nextCatalog = catalog.map((item: { url: string; title: string; order: number }) =>
      item.url === chapter.url ? { ...item, title } : item
    );
    const { error: catalogError } = await supabase.from('novel_projects')
      .update({ chapter_catalog: nextCatalog, updated_at: new Date().toISOString() })
      .eq('id', projectId).eq('user_id', userId);
    if (catalogError) throw catalogError;
    const { error: chapterError } = await supabase.from('novel_chapters')
      .update({ title, updated_at: new Date().toISOString() })
      .eq('project_id', projectId).eq('user_id', userId).eq('source_url', chapter.url);
    if (chapterError) throw chapterError;
    return loadOneProject(projectId);
  },

  async deleteChapters(projectId, chapterIds) {
    if (!chapterIds.length) return loadOneProject(projectId);
    const userId = await currentUserId();
    const supabase = getSupabase();
    const catalogUrls = new Set(chapterIds.filter((id) => id.startsWith('catalog:'))
      .map((id) => decodeURIComponent(id.slice('catalog:'.length))));
    const rowIds = chapterIds.filter((id) => !id.startsWith('catalog:'));
    const { data: rows, error: loadError } = rowIds.length
      ? await supabase.from('novel_chapters')
          .select('id, source_url, original_storage_provider, original_storage_path, reader_storage_path, translated_storage_provider, translated_storage_path')
          .eq('project_id', projectId).eq('user_id', userId).in('id', rowIds)
      : { data: [], error: null };
    if (loadError) throw loadError;
    const chapterRows = (rows ?? []) as Array<{
      id: string; source_url: string;
      original_storage_provider: string | null; original_storage_path: string | null;
      reader_storage_path: string | null; translated_storage_provider: string | null; translated_storage_path: string | null;
    }>;
    for (const row of chapterRows) catalogUrls.add(row.source_url);
    const paths = chapterRows.flatMap((row) => [
      row.original_storage_provider === 'supabase' ? row.original_storage_path : null,
      row.reader_storage_path,
      row.translated_storage_provider === 'supabase' ? row.translated_storage_path : null,
    ]).filter((path): path is string => Boolean(path));
    if (paths.length) {
      const { error } = await supabase.storage.from(BUCKET).remove(paths);
      if (error) throw error;
    }
    const { data: projectRow, error: projectError } = await supabase.from('novel_projects')
      .select('chapter_catalog').eq('id', projectId).eq('user_id', userId).single();
    if (projectError) throw projectError;
    const catalog = Array.isArray(projectRow.chapter_catalog) ? projectRow.chapter_catalog : [];
    const { error: catalogError } = await supabase.from('novel_projects')
      .update({
        chapter_catalog: catalog.filter((item: { url: string }) => !catalogUrls.has(item.url)),
        updated_at: new Date().toISOString(),
      }).eq('id', projectId).eq('user_id', userId);
    if (catalogError) throw catalogError;
    if (chapterRows.length) {
      const { error: deleteError } = await supabase.from('novel_chapters')
        .delete().eq('project_id', projectId).eq('user_id', userId).in('id', chapterRows.map((row) => row.id));
      if (deleteError) throw deleteError;
    }
    return loadOneProject(projectId);
  },

  async deleteProject(id) {
    const userId = await currentUserId();
    const rows = await loadChapters([id]);
    const paths = rows.flatMap((row) => [
      row.original_storage_provider === 'supabase' ? row.original_storage_path : null,
      row.reader_storage_path,
      row.translated_storage_provider === 'supabase' ? row.translated_storage_path : null,
    ]).filter((path): path is string => Boolean(path));
    if (paths.length) {
      const { error } = await getSupabase().storage.from(BUCKET).remove(paths);
      if (error) throw error;
    }
    const { error } = await getSupabase().from('novel_projects').delete().eq('id', id).eq('user_id', userId);
    if (error) throw error;
  },

  async ensureChapter(projectId, chapter) {
    const userId = await currentUserId();
    const supabase = getSupabase();
    const { data: projectRow, error: projectError } = await supabase
      .from('novel_projects').select('chapter_catalog')
      .eq('id', projectId).eq('user_id', userId).single();
    if (projectError) throw projectError;

    const catalog = Array.isArray(projectRow.chapter_catalog)
      ? projectRow.chapter_catalog as { url: string; title: string; order: number }[]
      : [];
    const existingCatalogIndex = catalog.findIndex((item) => item.url === chapter.url);
    const catalogEntry = {
      url: chapter.url,
      title: chapter.title || catalog[existingCatalogIndex]?.title || 'ไม่มีชื่อบท',
      order: Number.isFinite(chapter.order) ? chapter.order : catalog[existingCatalogIndex]?.order ?? catalog.length,
    };
    const nextCatalog = [...catalog];
    if (existingCatalogIndex >= 0) nextCatalog[existingCatalogIndex] = { ...catalog[existingCatalogIndex], ...catalogEntry };
    else nextCatalog.push(catalogEntry);
    nextCatalog.sort((a, b) => a.order - b.order);

    if (existingCatalogIndex < 0 || catalog[existingCatalogIndex].title !== catalogEntry.title || catalog[existingCatalogIndex].order !== catalogEntry.order) {
      const { error: catalogError } = await supabase.from('novel_projects')
        .update({ chapter_catalog: nextCatalog, updated_at: new Date().toISOString() })
        .eq('id', projectId).eq('user_id', userId);
      if (catalogError) throw catalogError;
    }

    let row = await getChapterRowByUrl(projectId, chapter.url);
    if (!row) {
      const { data: inserted, error: insertError } = await supabase.from('novel_chapters').insert({
        user_id: userId,
        project_id: projectId,
        source_url: chapter.url,
        title: catalogEntry.title,
        chapter_order: catalogEntry.order,
        status: 'pending',
      }).select('*').single();
      if (insertError) {
        row = await getChapterRowByUrl(projectId, chapter.url);
        if (!row) throw insertError;
      } else {
        row = inserted as ChapterRow;
      }
    } else if (row.title !== catalogEntry.title || row.chapter_order !== catalogEntry.order) {
      const { data: updated, error: updateError } = await supabase.from('novel_chapters')
        .update({ title: catalogEntry.title, chapter_order: catalogEntry.order, updated_at: new Date().toISOString() })
        .eq('id', row.id).eq('project_id', projectId).eq('user_id', userId)
        .select('*').single();
      if (updateError) throw updateError;
      row = updated as ChapterRow;
    }
    return mapChapter(row);
  },

  async updateChapter(projectId, chapterId, patch) {
    const userId = await currentUserId();
    let row = chapterId.startsWith('catalog:') ? null : await getChapterRow(projectId, chapterId);
    const supabase = getSupabase();
    if (!row) {
      if (!patch.url || patch.title === undefined || patch.order === undefined) {
        throw new Error('ไม่พบข้อมูลบทในฐานข้อมูล และข้อมูลสารบัญไม่ครบสำหรับสร้างแถวบท');
      }
      const { data: inserted, error: insertError } = await supabase.from('novel_chapters').insert({
        user_id: userId, project_id: projectId, source_url: patch.url,
        title: patch.title, chapter_order: patch.order, status: 'pending',
      }).select('*').single();
      if (insertError) {
        row = await getChapterRowByUrl(projectId, patch.url);
        if (!row) throw insertError;
      } else {
        row = inserted as ChapterRow;
      }
    }
    const actualChapterId = row.id;
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    const originalPath = patch.originalText !== undefined
      ? contentPath(userId, projectId, actualChapterId, 'original')
      : row.original_storage_path;
    const readerPath = patch.readerContent !== undefined
      ? contentPath(userId, projectId, actualChapterId, 'reader')
      : row.reader_storage_path;
    const translatedPath = patch.translatedText !== undefined
      ? contentPath(userId, projectId, actualChapterId, 'translated')
      : row.translated_storage_path;

    const uploads: Promise<void>[] = [];
    if (patch.originalText !== undefined) {
      update.original_storage_provider = 'supabase';
      update.original_storage_path = originalPath;
      uploads.push(putText(originalPath!, patch.originalText));
    }
    if (patch.readerContent !== undefined) {
      update.reader_storage_path = readerPath;
      uploads.push(putText(readerPath!, patch.readerContent));
    }
    if (patch.translatedText !== undefined) {
      update.translated_storage_provider = 'supabase';
      update.translated_storage_path = translatedPath;
      uploads.push(putText(translatedPath!, patch.translatedText));
    }
    await Promise.all(uploads);
    if (patch.title !== undefined) update.title = patch.title;
    if (patch.status !== undefined) {
      update.status = patch.status;
      if (patch.status === 'fetched') update.fetched_at = new Date().toISOString();
      if (patch.status === 'translated') update.translated_at = new Date().toISOString();
    }
    if ('error' in patch) update.error_message = patch.error ?? null;

    const { error } = await supabase.from('novel_chapters').update(update)
      .eq('id', actualChapterId).eq('project_id', projectId).eq('user_id', userId);
    if (error) throw error;

    // Return the chapter from the row and in-memory patch; do not download the files just uploaded.
    const updated = mapChapter({
      ...row,
      title: patch.title ?? row.title,
      chapter_order: patch.order ?? row.chapter_order,
      status: patch.status ?? row.status,
      error_message: 'error' in patch ? patch.error ?? null : row.error_message,
      original_storage_provider: patch.originalText !== undefined ? 'supabase' : row.original_storage_provider,
      original_storage_path: originalPath,
      reader_storage_path: readerPath,
      translated_storage_provider: patch.translatedText !== undefined ? 'supabase' : row.translated_storage_provider,
      translated_storage_path: translatedPath,
    });
    if (patch.originalText !== undefined) updated.originalText = patch.originalText;
    if (patch.translatedText !== undefined) updated.translatedText = patch.translatedText;
    if (patch.readerContent !== undefined) updated.readerContent = patch.readerContent;
    return updated;
  },
};
