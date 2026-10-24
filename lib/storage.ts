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
  error?: string;
}

export interface NovelProject {
  id: string;
  title: string;
  sourceUrl: string;
  host: string;
  glossary: Record<string, string>;
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
  createProject(data: NewProjectData): Promise<NovelProject>;
  renameProject(id: string, title: string): Promise<NovelProject | null>;
  deleteProject(id: string): Promise<void>;
  updateChapter(
    projectId: string,
    chapterId: string,
    patch: Partial<Omit<NovelChapter, 'id' | 'translatedText'>>
  ): Promise<NovelChapter | null>;
}

export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const STORAGE_KEY = 'novel_projects_v1';

function loadAll(): NovelProject[] {
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

function saveAll(projects: NovelProject[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

export const localStorageStore: NovelStore = {
  async listProjects() {
    // เรียงเรื่องที่แตะล่าสุดก่อน
    return loadAll().sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async getProject(id) {
    return loadAll().find((p) => p.id === id) ?? null;
  },

  async createProject(data) {
    const projects = loadAll();
    const now = Date.now();
    const project: NovelProject = {
      id: createId(),
      title: data.title,
      sourceUrl: data.sourceUrl,
      host: data.host,
      glossary: data.glossary ?? {},
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
    const projects = loadAll();
    const target = projects.find((p) => p.id === id);
    if (!target) return null;
    target.title = title;
    target.updatedAt = Date.now();
    saveAll(projects);
    return target;
  },

  async deleteProject(id) {
    const projects = loadAll();
    saveAll(projects.filter((p) => p.id !== id));
  },

  async updateChapter(projectId, chapterId, patch) {
    const projects = loadAll();
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
    if ('error' in patch) chapter.error = patch.error;
    target.updatedAt = Date.now();
    saveAll(projects);
    return chapter;
  },
};

// จุดเปลี่ยน adapter เพียงจุดเดียว — UI ทุกหน้าเรียกผ่าน getStore()
export function getStore(): NovelStore {
  return localStorageStore;
}
