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
type GlossaryRow = { source_term: string; translated_term: string };

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

function mapProject(row: ProjectRow, fetchedChapters: NovelChapter[], glossary: Record<string, string>): NovelProject {
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

async function loadGlossary(projectIds: string[]): Promise<Map<string, Record<string, string>>> {
  const result = new Map<string, Record<string, string>>();
  if (!projectIds.length) return result;
  const { data, error } = await getSupabase()
    .from('glossary_entries').select('project_id, source_term, translated_term')
    .in('project_id', projectIds);
  if (error) throw error;
  for (const row of data ?? []) {
    const terms = result.get(row.project_id) ?? {};
    terms[row.source_term] = row.translated_term;
    result.set(row.project_id, terms);
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
  return rows.map((row) => mapProject(row, byProject.get(row.id) ?? [], glossaries.get(row.id) ?? {}));
}

function contentPath(userId: string, projectId: string, chapterId: string, kind: 'original' | 'translated') {
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

  async getChapterContent(projectId, chapterId) {
    await currentUserId();
    const row = await getChapterRow(projectId, chapterId);
    if (!row) return null;
    const chapter = mapChapter(row);
    if (row.original_storage_provider === 'supabase') {
      chapter.originalText = await readText(row.original_storage_path);
    }
    if (row.reader_storage_path) chapter.readerContent = await readText(row.reader_storage_path);
    if (row.translated_storage_provider === 'supabase') {
      chapter.translatedText = await readText(row.translated_storage_path);
    }
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
        user_id: userId, project_id: projectRow.id, source_term, translated_term,
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
    if (Object.keys(update).length > 1 || patch.glossary !== undefined) {
      const { error } = await supabase.from('novel_projects').update(update).eq('id', id).eq('user_id', userId);
      if (error) throw error;
    }
    if (patch.glossary !== undefined) {
      const { data: existing, error: existingError } = await supabase.from('glossary_entries')
        .select('source_term').eq('project_id', id).eq('user_id', userId);
      if (existingError) throw existingError;
      const wanted = new Set(Object.keys(patch.glossary));
      const removed = (existing ?? []).map((row) => row.source_term).filter((term) => !wanted.has(term));
      if (removed.length) {
        const { error } = await supabase.from('glossary_entries').delete()
          .eq('project_id', id).eq('user_id', userId).in('source_term', removed);
        if (error) throw error;
      }
      const entries = Object.entries(patch.glossary).map(([source_term, translated_term]) => ({
        user_id: userId, project_id: id, source_term, translated_term,
      }));
      if (entries.length) {
        const { error } = await supabase.from('glossary_entries').upsert(entries, { onConflict: 'project_id,source_term' });
        if (error) throw error;
      }
    }
    return loadOneProject(id);
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
          const patch: Partial<Omit<NovelChapter, 'id'>> = {
            status: oldChapter.status ?? 'pending',
            error: oldChapter.error,
            originalText: oldChapter.originalText,
            translatedText: oldChapter.translatedText,
          };
          await this.updateChapter(created.id, newId, patch);
        }
        const glossary = raw.glossary && typeof raw.glossary === 'object' ? raw.glossary as Record<string, string> : {};
        await this.updateProject(created.id, {
          glossary,
          glossaryMode: raw.glossaryMode === 'auto' ? 'auto' : 'manual',
          lastReadChapterId: oldToNew.get(raw.lastReadChapterId ?? ''),
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
    let row = await getChapterRow(projectId, chapterId);
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

    if (patch.originalText !== undefined) {
      const path = contentPath(userId, projectId, actualChapterId, 'original');
      await putText(path, patch.originalText);
      update.original_storage_provider = 'supabase';
      update.original_storage_path = path;
    }
    if (patch.readerContent !== undefined) {
      const path = contentPath(userId, projectId, actualChapterId, 'reader');
      await putText(path, patch.readerContent);
      update.reader_storage_path = path;
    }
    if (patch.translatedText !== undefined) {
      const path = contentPath(userId, projectId, actualChapterId, 'translated');
      await putText(path, patch.translatedText);
      update.translated_storage_provider = 'supabase';
      update.translated_storage_path = path;
    }
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
    const updated = await this.getChapterContent(projectId, chapterId);
    if (!updated) return null;
    if (patch.originalText !== undefined) updated.originalText = patch.originalText;
    if (patch.translatedText !== undefined) updated.translatedText = patch.translatedText;
    if (patch.readerContent !== undefined) updated.readerContent = patch.readerContent;
    return updated;
  },
};
