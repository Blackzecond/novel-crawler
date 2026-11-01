import type { NewProjectData, NovelChapter, NovelProject, NovelStore } from '@/lib/storage';
import { getSupabase } from '@/lib/supabase';

const BUCKET = 'novel-content';

type ProjectRow = {
  id: string; title: string; source_url: string; host: string;
  glossary_mode: 'manual' | 'auto'; last_read_chapter_id: string | null;
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

function mapProject(row: ProjectRow, fetchedChapters: NovelChapter[], glossary: Record<string, string>, glossaryTypes: Record<string, 'character' | 'term'>): NovelProject {
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

async function buildProjects(rows: ProjectRow[]): Promise<NovelProject[]> {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const [chapters, glossaries] = await Promise.all([loadChapters(ids), loadGlossary(ids)]);
  const byProject = new Map<string, NovelChapter[]>();
  for (const row of chapters) {
    const list = byProject.get(row.project_id) ?? [];
    list.push(mapChapter(row));
    byProject.set(row.project_id, list);
  }
  return rows.map((row) => {
    const glossary = glossaries.get(row.id) ?? { terms: {}, types: {} };
    return mapProject(row, byProject.get(row.id) ?? [], glossary.terms, glossary.types);
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
    if (patch.lastReadChapterId !== undefined) update.last_read_chapter_id = patch.lastReadChapterId || null;
    if (Object.keys(update).length > 1 || patch.glossary !== undefined || patch.glossaryTypes !== undefined) {
      const { error } = await supabase.from('novel_projects').update(update).eq('id', id).eq('user_id', userId);
      if (error) throw error;
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
          glossaryMode: raw.glossaryMode === 'auto' ? 'auto' : 'manual',
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
