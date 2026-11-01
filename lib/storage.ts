import { supabaseStore } from '@/lib/cloudStorage';

// ชั้นเก็บข้อมูลโปรเจกต์แปล — วันนี้ใช้ localStorage, วันหลังผูก Supabase
// ทุกเมธอดเป็น async และออกแบบ signature ให้เปลี่ยนเป็น backend adapter ได้โดยไม่แก้ UI:
// ตอนผูก Supabase เขียน supabaseStore ให้ implement NovelStore แล้วเปลี่ยนตรง getStore() จุดเดียว

export interface NovelChapter {
  id: string;
  url: string;
  title: string;
  order: number;
  status: 'pending' | 'fetched' | 'translated';
  originalText?: string;
  translatedText?: string;
  /** Cached reader HTML; separate from plain text used by glossary/AI tools. */
  readerContent?: string;
  error?: string;
}

export interface NovelProject {
  id: string;
  title: string;
  sourceUrl: string;
  host: string;
  glossary: Record<string, string>;
  glossaryTypes: Record<string, 'character' | 'term'>;
  // โหมดตรวจชื่อตัวละคร/ศัพท์เฉพาะด้วย AI: 'manual' = กดเองรายบท, 'auto' = จับหลังดึงเนื้อหาสำเร็จทุกบท
  glossaryMode: 'manual' | 'auto';
  // id บทล่าสุดที่เปิดอ่านจากโปรเจกต์นี้ — ใช้ทำปุ่ม "อ่านต่อ"
  lastReadChapterId?: string;
  chapters: NovelChapter[];
  createdAt: number;
  updatedAt: number;
}

export interface NewProjectData {
  title: string;
  sourceUrl: string;
  host: string;
  chapters: { url: string; title: string; order: number }[];
  glossary?: Record<string, string>;
}

export interface NovelStore {
  listProjects(): Promise<NovelProject[]>;
  getProject(id: string): Promise<NovelProject | null>;
  getChapterContent(
    projectId: string,
    chapterId: string,
    options?: { includeOriginalText?: boolean; includeTranslatedText?: boolean }
  ): Promise<NovelChapter | null>;
  createProject(data: NewProjectData): Promise<NovelProject>;
  renameProject(id: string, title: string): Promise<NovelProject | null>;
  updateProject(
    id: string,
    patch: Partial<Pick<NovelProject, 'title' | 'glossary' | 'glossaryTypes' | 'glossaryMode' | 'lastReadChapterId'>>
  ): Promise<NovelProject | null>;
  deleteGlossaryTerms(projectId: string, sourceTerms: string[]): Promise<NovelProject | null>;
  // นำเข้าจากไฟล์ส่งออก JSON — id ซ้ำกับข้อมูลในเครื่องจะถูกแทนที่ด้วยข้อมูลไฟล์นำเข้า
  importProjects(projects: NovelProject[]): Promise<{ imported: number; skipped: number }>;
  deleteProject(id: string): Promise<void>;
  updateChapter(
    projectId: string,
    chapterId: string,
    patch: Partial<Omit<NovelChapter, 'id'>>
  ): Promise<NovelChapter | null>;
}

export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const STORAGE_KEY = 'novel_projects_v1';

function saveAll(projects: NovelProject[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

/**
 * ปรับสถานะให้ครบถ้วนกันล้อมั้งข้อมูลเก่าจากเวอร์ชันก่อนหรือไฟล์นำเข้าที่ข้อมูลไม่ครบ
 */
function normalizeProject(p: any): NovelProject | null {
  if (!p || typeof p !== 'object' || !p.id || !Array.isArray(p.chapters)) return null;
  return {
    id: String(p.id),
    title: String(p.title ?? 'ไม่มีชื่อเรื่อง'),
    sourceUrl: String(p.sourceUrl ?? ''),
    host: String(p.host ?? ''),
    glossary: p.glossary && typeof p.glossary === 'object' ? p.glossary : {},
    glossaryTypes: p.glossaryTypes && typeof p.glossaryTypes === 'object' ? p.glossaryTypes : {},
    glossaryMode: p.glossaryMode === 'auto' ? 'auto' : 'manual',
    lastReadChapterId: typeof p.lastReadChapterId === 'string' ? p.lastReadChapterId : undefined,
    createdAt: Number(p.createdAt) || Date.now(),
    updatedAt: Number(p.updatedAt) || Date.now(),
    chapters: p.chapters,
  };
}

function loadAllRaw(): unknown[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function loadAllValid(): NovelProject[] {
  return loadAllRaw()
    .map(normalizeProject)
    .filter((p): p is NovelProject => p !== null);
}

export const localStorageStore: NovelStore = {
  async listProjects() {
    // เรียงเรื่องที่แตะล่าสุดก่อน
    return loadAllValid().sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async getProject(id) {
    return loadAllValid().find((p) => p.id === id) ?? null;
  },

  async getChapterContent(projectId, chapterId) {
    const project = loadAllValid().find((p) => p.id === projectId);
    return project?.chapters.find((chapter) => chapter.id === chapterId) ?? null;
  },

  async createProject(data) {
    const projects = loadAllValid();
    const now = Date.now();
    const project: NovelProject = {
      id: createId(),
      title: data.title,
      sourceUrl: data.sourceUrl,
      host: data.host,
      glossary: data.glossary ?? {},
      glossaryTypes: {},
      glossaryMode: 'manual',
      createdAt: now,
      updatedAt: now,
      chapters: data.chapters.map((c) => ({
        id: createId(),
        url: c.url,
        title: c.title,
        order: c.order,
        status: 'pending' as const,
      })),
    };
    projects.push(project);
    saveAll(projects);
    return project;
  },

  async renameProject(id, title) {
    return this.updateProject(id, { title });
  },

  async updateProject(id, patch) {
    const projects = loadAllValid();
    const target = projects.find((p) => p.id === id);
    if (!target) return null;
    if (patch.title !== undefined) target.title = patch.title;
    if (patch.glossary !== undefined) target.glossary = patch.glossary;
    if (patch.glossaryTypes !== undefined) target.glossaryTypes = patch.glossaryTypes;
    if (patch.glossaryMode !== undefined) target.glossaryMode = patch.glossaryMode;
    if (patch.lastReadChapterId !== undefined) target.lastReadChapterId = patch.lastReadChapterId;
    target.updatedAt = Date.now();
    saveAll(projects);
    return target;
  },

  async deleteGlossaryTerms(projectId, sourceTerms) {
    const projects = loadAllValid();
    const target = projects.find((p) => p.id === projectId);
    if (!target) return null;
    const glossary = { ...target.glossary };
    const glossaryTypes = { ...target.glossaryTypes };
    for (const term of sourceTerms) { delete glossary[term]; delete glossaryTypes[term]; }
    target.glossary = glossary;
    target.glossaryTypes = glossaryTypes;
    target.updatedAt = Date.now();
    saveAll(projects);
    return target;
  },

  async importProjects(incoming) {
    const projects = loadAllValid();
    let imported = 0;
    let skipped = 0;
    for (const raw of incoming) {
      const project = normalizeProject(raw);
      if (!project) {
        skipped++;
        continue;
      }
      const existingIndex = projects.findIndex((p) => p.id === project.id);
      if (existingIndex >= 0) {
        projects[existingIndex] = project; // ข้อมูลไฟล์นำเข้าชนะ id ซ้ำ
        imported++;
      } else {
        projects.push(project);
        imported++;
      }
    }
    if (imported > 0) saveAll(projects);
    return { imported, skipped };
  },

  async deleteProject(id) {
    const projects = loadAllValid();
    saveAll(projects.filter((p) => p.id !== id));
  },

  async updateChapter(projectId, chapterId, patch) {
    const projects = loadAllValid();
    const target = projects.find((p) => p.id === projectId);
    if (!target) return null;
    const chapter = target.chapters.find((c) => c.id === chapterId);
    if (!chapter) return null;

    // อนุญาตให้แปลาสถานะขึ้นไป เช่น pending → fetched → translated เท่านั้น
    const maxRank = Math.max(
      chapter.status === 'translated' ? 2 : chapter.status === 'fetched' ? 1 : 0,
      patch.status === 'translated' ? 2 : patch.status === 'fetched' ? 1 : patch.status === 'pending' ? 0 : -1
    );
    chapter.status = maxRank === 2 ? 'translated' : maxRank === 1 ? 'fetched' : 'pending';
    if ('originalText' in patch) chapter.originalText = patch.originalText;
    if ('translatedText' in patch) chapter.translatedText = patch.translatedText;
    if ('readerContent' in patch) chapter.readerContent = patch.readerContent;
    if ('error' in patch) chapter.error = patch.error;
    target.updatedAt = Date.now();
    saveAll(projects);
    return chapter;
  },
};

// จุดเปลี่ยน adapter เพียงจุดเดียว — UI ทุกหน้าเรียกผ่าน getStore()
export function getLocalProjectsForMigration(): NovelProject[] {
  return loadAllValid();
}

export function getStore(): NovelStore {
  if (typeof window !== 'undefined' &&
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return supabaseStore;
  }
  return localStorageStore;
}
