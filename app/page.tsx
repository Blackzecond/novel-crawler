'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Library, BookOpen, Loader2, Trash2, Download, Upload,
  ChevronRight, ChevronDown, AlertTriangle, ExternalLink, Globe, Sparkles, FolderOpen, LogOut, CloudUpload, Search, ArrowUpDown, RefreshCw,
} from 'lucide-react';
import { getLocalProjectsForMigration, getStore, NovelProject } from '@/lib/storage';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { applySavedTheme, loadReaderSettings, saveReaderSettings } from '@/lib/readerPrefs';
import { loadCloudReaderSettings, saveCloudReaderSettings, loadCloudReadingHistory } from '@/lib/cloudPreferences';
import { selectLatestReadableChapter, isAccountRequestCurrent, resolveShelfHistoryRefresh, isShelfHistoryRequestCurrent } from '@/lib/readerIntegrity.mjs';
import { fetchWithNativeBrowser, rememberNativeBrowser } from '@/lib/nativeBrowserFetch';
import { exportNovelMemoryBundle } from '@/lib/novelMemory';
import NovelCover from '@/components/NovelCover';

// เว็บต้นฉบับจีนยอดนิยม — กดเพื่อใส่โดเมนต้นทางในช่อง URL
// (วางเฉพาะลิงก์หน้าสารบัญ/目录 เช่น https://www.uukanshu.cc/b/123/ จึงจะจับรายการบทได้)
const EXAMPLE_SITES = [
  { label: '笔趣阁 uukanshu', host: 'www.uukanshu.cc' },
  { label: '69书吧 69shu', host: 'www.69shu.pro' },
  { label: '起点中文 Qidian', host: 'www.qidian.com' },
];

function ProjectCard({
  project,
  onDelete,
}: {
  project: NovelProject;
  onDelete: (p: NovelProject) => void;
}) {
  const total = project.chapters.length;
  const fetched = project.chapters.filter((chapter) => chapter.status !== 'pending').length;
  const translated = project.chapters.filter((chapter) => chapter.status === 'translated').length;
  const lastRead = project.lastReadChapterId
    ? project.chapters.find((chapter) => chapter.id === project.lastReadChapterId) ?? null
    : null;

  return (
    <article className="group flex min-w-0 gap-3 rounded-2xl border border-line bg-card p-3 shadow-sm transition-colors hover:border-accent-line sm:gap-4 sm:p-4">
      <a href={`/project/${project.id}`} className="shrink-0" aria-label={`เปิดสารบัญ ${project.title}`}>
        <NovelCover projectId={project.id} title={project.title} coverUrl={project.coverUrl} />
      </a>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start gap-2">
          <a href={`/project/${project.id}`} className="min-w-0 flex-1">
            <span className="block line-clamp-2 break-words font-serif text-base font-semibold leading-snug text-fg group-hover:text-accent-soft-fg sm:text-lg">{project.title}</span>
            <span className="mt-1 inline-flex max-w-full items-center gap-1 text-xs text-muted">
              <Globe className="h-3 w-3 shrink-0" /><span className="truncate">{project.host}</span>
            </span>
          </a>
          <button onClick={() => onDelete(project)} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-danger-bg hover:text-danger-fg" aria-label={`ลบโปรเจกต์ ${project.title}`} title="ลบเรื่องนี้">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 text-[11px] text-muted">
          แปลแล้ว {translated.toLocaleString('th-TH')} จาก {total.toLocaleString('th-TH')} ตอน
          <span className="mx-1.5 text-line">·</span>{fetched.toLocaleString('th-TH')} ตอนดึงเนื้อหาแล้ว
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
          {lastRead ? (
            <a href={`/read?projectId=${encodeURIComponent(project.id)}&url=${encodeURIComponent(lastRead.url)}`} aria-label={`อ่านต่อ ${project.title} ตอน ${lastRead.title}`} className="inline-flex min-h-11 w-fit max-w-full items-center justify-start gap-1.5 rounded-lg px-2 text-xs font-semibold text-accent-soft-fg hover:bg-accent-soft hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2">
              <BookOpen className="h-4 w-4 shrink-0" /><span className="min-w-0 truncate">อ่านต่อ ›</span>
            </a>
          ) : (
            <a href={`/project/${project.id}`} className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line px-3 text-xs font-medium text-fg hover:bg-surface">
              <BookOpen className="h-4 w-4" /> เปิดสารบัญ
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

export default function ProjectsHomePage() {
  const router = useRouter();
  const [projects, setProjects] = useState<NovelProject[]>([]);
  const [readingHistory, setReadingHistory] = useState<Array<{ url: string; title?: string; readAt: number; projectId?: string | null }>>([]);
  const [mounted, setMounted] = useState(false);
  const accountScopeRef = useRef<string | null | undefined>(undefined);
  const accountRequestVersionRef = useRef(0);
  const reloadProjectsRef = useRef<() => Promise<boolean>>(async () => false);
  const [projectsError, setProjectsError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [projectSort, setProjectSort] = useState<'updated' | 'title' | 'progress'>('updated');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [retryingProjects, setRetryingProjects] = useState(false);
  const [url, setUrl] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [chapterNotice, setChapterNotice] = useState<string>('');
  const [tocDraft, setTocDraft] = useState<{
    title: string;
    host: string;
    chapters: { url: string; title: string; order: number }[];
    excludedUrls: string[];
    pages: { url: string; title: string; html: string }[];
    usedNativeBrowser: boolean;
  } | null>(null);
  const [tocDraftTitle, setTocDraftTitle] = useState('');
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const createUrlInputRef = useRef<HTMLInputElement | null>(null);
  const [importNotice, setImportNotice] = useState('');
  const [localMigrationCount, setLocalMigrationCount] = useState(0);
  const [migratingLocal, setMigratingLocal] = useState(false);
  const [cloudUserId, setCloudUserId] = useState<string | null>(null);

  useEffect(() => {
    applySavedTheme();
    void (async () => {
      try {
        const localSettings = loadReaderSettings();
        const cloudSettings = await loadCloudReaderSettings();
        if (cloudSettings && Object.keys(cloudSettings).length > 0) {
          const merged = { ...localSettings, ...cloudSettings };
          saveReaderSettings(merged);
          document.documentElement.dataset.theme = merged.theme;
        } else {
          await saveCloudReaderSettings(localSettings);
        }
      } catch (syncError) {
        console.warn('Could not sync reader theme:', syncError);
      }
    })();

    let active = true;
    let authEventVersion = 0;
    let projectLoadPending = false;
    let projectRequestVersion = 0;
    let historyRequestVersion = 0;
    let projectsLoadAttempted = false;
    let lastSuccessfulCloudHistory: Array<{ url: string; title?: string; readAt: number; projectId?: string | null }> = [];
    const readLocalHistory = () => {
      try {
        const raw = window.localStorage.getItem('novel_history');
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed as Array<{ url: string; title?: string; readAt: number; projectId?: string | null }> : [];
      } catch {
        return [];
      }
    };
    const isCurrentRequest = (version: number, scope: string) =>
      active && isAccountRequestCurrent(accountRequestVersionRef.current, version, accountScopeRef.current ?? null, scope);

    const loadProjectsForScope = async (version: number, scope: string) => {
      const thisProjectRequest = ++projectRequestVersion;
      projectLoadPending = true;
      try {
        const nextProjects = await getStore().listProjects();
        if (!isCurrentRequest(version, scope) || thisProjectRequest !== projectRequestVersion) return false;
        setProjects(nextProjects);
        setProjectsError('');
        return true;
      } catch (loadError) {
        if (!isCurrentRequest(version, scope) || thisProjectRequest !== projectRequestVersion) return false;
        setProjectsError(loadError instanceof Error ? loadError.message : 'โหลดข้อมูลไม่สำเร็จ');
        return false;
      } finally {
        if (isCurrentRequest(version, scope) && thisProjectRequest === projectRequestVersion) {
          projectLoadPending = false;
          projectsLoadAttempted = true;
          setMounted(true);
        }
      }
    };

    const refreshCloudHistory = async (version: number, scope: string) => {
      const thisHistoryRequest = ++historyRequestVersion;
      const isCurrentHistoryRequest = () => isShelfHistoryRequestCurrent(
        accountRequestVersionRef.current, version, historyRequestVersion, thisHistoryRequest,
        accountScopeRef.current ?? null, scope,
      ) && active;
      // Keep the last successful combined history visible while a same-account refresh is pending.
      // On account changes the caller has already cleared the previous account's state.
      try {
        const cloudHistory = await loadCloudReadingHistory(scope);
        if (!isCurrentHistoryRequest()) return;
        const refreshed = resolveShelfHistoryRefresh(readLocalHistory(), lastSuccessfulCloudHistory, cloudHistory, true);
        lastSuccessfulCloudHistory = refreshed.cloudHistory;
        setReadingHistory(refreshed.combinedHistory);
      } catch (historyError) {
        // Preserve the last good cloud snapshot but reread local storage (it may have been cleared).
        if (isCurrentHistoryRequest()) {
          const refreshed = resolveShelfHistoryRefresh(readLocalHistory(), lastSuccessfulCloudHistory, null, false);
          setReadingHistory(refreshed.combinedHistory);
        }
        console.info('Could not refresh cloud reading history; keeping the last successful history:', historyError);
      }
    };

    const activateAccount = (userId: string | null): Promise<boolean> => {
      const scope = isSupabaseConfigured() ? userId : 'local';
      if (scope === null) {
        if (accountScopeRef.current !== null) {
          accountRequestVersionRef.current++;
          projectRequestVersion++;
          historyRequestVersion++;
          accountScopeRef.current = null;
          setProjects([]);
          lastSuccessfulCloudHistory = [];
          setReadingHistory([]);
          setProjectsError('');
          setMounted(false);
          setCloudUserId(null);
          setLocalMigrationCount(0);
          setRetryingProjects(false);
        }
        router.replace('/login');
        return Promise.resolve(false);
      }

      const changedAccount = accountScopeRef.current !== scope;
      if (changedAccount) {
        accountRequestVersionRef.current++;
        projectRequestVersion++;
        historyRequestVersion++;
        accountScopeRef.current = scope;
        setProjects([]);
        lastSuccessfulCloudHistory = [];
        setReadingHistory(readLocalHistory());
        setProjectsError('');
        setMounted(false);
        setCloudUserId(userId);
        setLocalMigrationCount(0);
        setImportNotice('');
        setRetryingProjects(false);
        if (userId) {
          const migrationKey = `novel_cloud_migrated_v1_${userId}`;
          if (window.localStorage.getItem(migrationKey) !== '1') {
            setLocalMigrationCount(getLocalProjectsForMigration().length);
          }
        }
      }

      const version = accountRequestVersionRef.current;
      let projectLoad: Promise<boolean> | null = null;
      if (changedAccount || (!projectsLoadAttempted && !projectLoadPending)) {
        projectLoad = loadProjectsForScope(version, scope);
      }
      if (userId) void refreshCloudHistory(version, scope);
      else if (changedAccount) setReadingHistory(readLocalHistory());
      return projectLoad ?? Promise.resolve(true);
    };

    if (isSupabaseConfigured()) {
      let sessionResolutionPromise: Promise<boolean> | null = null;
      const resolveSessionAndActivate = (): Promise<boolean> => {
        if (sessionResolutionPromise) return sessionResolutionPromise;
        const requestAuthEventVersion = authEventVersion;
        setMounted(false);
        const request = (async () => {
          try {
            const { data, error: sessionError } = await getSupabase().auth.getSession();
            if (!active || authEventVersion !== requestAuthEventVersion) return false;
            if (sessionError) throw sessionError;
            return await activateAccount(data.session?.user?.id ?? null);
          } catch (sessionError) {
            if (!active || authEventVersion !== requestAuthEventVersion) return false;
            setProjectsError(sessionError instanceof Error ? sessionError.message : 'ตรวจสอบสถานะเข้าสู่ระบบไม่สำเร็จ');
            setMounted(true);
            return false;
          }
        })();
        sessionResolutionPromise = request;
        void request.then(
          () => { if (sessionResolutionPromise === request) sessionResolutionPromise = null; },
          () => { if (sessionResolutionPromise === request) sessionResolutionPromise = null; },
        );
        return request;
      };

      const { data } = getSupabase().auth.onAuthStateChange((event, session) => {
        if (!['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED'].includes(event)) return;
        authEventVersion++;
        queueMicrotask(() => {
          if (active) void activateAccount(session?.user?.id ?? null);
        });
      });

      void resolveSessionAndActivate();

      reloadProjectsRef.current = async () => {
        const scope = accountScopeRef.current;
        if (scope === undefined) return resolveSessionAndActivate();
        if (scope === null) {
          router.replace('/login');
          return false;
        }
        return loadProjectsForScope(accountRequestVersionRef.current, scope);
      };

      return () => {
        active = false;
        accountRequestVersionRef.current++;
        data.subscription.unsubscribe();
        reloadProjectsRef.current = async () => false;
      };
    }

    activateAccount(null);
    reloadProjectsRef.current = async () => {
      const scope = accountScopeRef.current;
      if (scope !== 'local') return false;
      return loadProjectsForScope(accountRequestVersionRef.current, scope);
    };
    return () => {
      active = false;
      accountRequestVersionRef.current++;
      reloadProjectsRef.current = async () => false;
    };
  }, [router]);

  const loadProjects = async () => reloadProjectsRef.current();

  const retryLoadProjects = async () => {
    if (retryingProjects) return;
    setRetryingProjects(true);
    try {
      await loadProjects();
    } finally {
      setRetryingProjects(false);
    }
  };

  useEffect(() => {
    if (!showCreateForm || projects.length === 0) return;
    const input = createUrlInputRef.current;
    input?.focus({ preventScroll: true });
    input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [showCreateForm, projects.length]);

  const visibleProjects = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    const filtered = projects.filter((project) =>
      !query || project.title.toLocaleLowerCase().includes(query) || project.host.toLocaleLowerCase().includes(query)
    );
    return [...filtered].sort((a, b) => {
      if (projectSort === 'title') return a.title.localeCompare(b.title, 'th');
      if (projectSort === 'progress') {
        const progressA = a.chapters.length ? a.chapters.filter((chapter) => chapter.status !== 'pending').length / a.chapters.length : 0;
        const progressB = b.chapters.length ? b.chapters.filter((chapter) => chapter.status !== 'pending').length / b.chapters.length : 0;
        return progressB - progressA || b.updatedAt - a.updatedAt;
      }
      return b.updatedAt - a.updatedAt;
    });
  }, [projects, searchQuery, projectSort]);

  // Pick one validated project + chapter pair from actual read timestamps.
  const latestRead = useMemo(() => selectLatestReadableChapter(projects, [readingHistory]), [projects, readingHistory]);
  const emptyLibrary = mounted && !projectsError && !retryingProjects && projects.length === 0;

  const migrateLocalProjects = async () => {
    if (migratingLocal || !cloudUserId) return;
    setMigratingLocal(true);
    setImportNotice('');
    try {
      const localProjects = getLocalProjectsForMigration();
      const result = await getStore().importProjects(localProjects);
      if (result.imported > 0) {
        window.localStorage.setItem(`novel_cloud_migrated_v1_${cloudUserId}`, '1');
      }
      setLocalMigrationCount(0);
      await loadProjects();
      setImportNotice(`ย้ายข้อมูลจากเครื่องสำเร็จ ${result.imported} เรื่อง${result.skipped ? ` (ข้าม ${result.skipped} เรื่องที่มีปัญหา)` : ''} — ข้อมูลต้นฉบับที่มีอยู่ถูกอัปโหลดไปยัง Storage`);
    } catch (err) {
      setImportNotice(`ย้ายข้อมูลไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setMigratingLocal(false);
    }
  };

  const signOut = async () => {
    const { error: signOutError } = await getSupabase().auth.signOut();
    if (signOutError) setError(signOutError.message);
    else router.replace('/login');
  };

  const analyzeTocPages = async (
    sourceUrl: string,
    nativePage: Awaited<ReturnType<typeof fetchWithNativeBrowser>>,
  ) => {
    const response = await fetch('/api/toc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nativePage
        ? { url: sourceUrl, pageUrl: nativePage.url, html: nativePage.html, pages: nativePage.pages }
        : { url: sourceUrl }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'อ่านสารบัญจากหน้าเว็บไม่สำเร็จ');
    return data;
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const sourceUrl = url.trim();
    if (!sourceUrl || creating) return;
    setCreating(true);
    setError('');
    setChapterNotice('');
    setTocDraft(null);
    try {
      // Android must let the user inspect and manually capture every TOC page first.
      // Web/PWA has no native WebView, so it uses server extraction but still requires review.
      const nativePage = await fetchWithNativeBrowser(sourceUrl, { expandToc: true });
      const data = await analyzeTocPages(sourceUrl, nativePage);
      if (data.type !== 'directory' || !Array.isArray(data.chapters) || data.chapters.length === 0) {
        setChapterNotice(data.message || 'ไม่พบรายการบทบนหน้านี้');
        return;
      }
      const pages = nativePage?.pages?.length
        ? nativePage.pages
        : nativePage
          ? [{ url: nativePage.url, title: nativePage.title, html: nativePage.html }]
          : [];
      const draft = {
        title: data.novelTitle || data.host,
        host: data.host,
        chapters: data.chapters,
        excludedUrls: [],
        pages,
        usedNativeBrowser: Boolean(nativePage),
      };
      setTocDraft(draft);
      setTocDraftTitle(draft.title);
    } catch (err: any) {
      setError(err.message || 'อ่านสารบัญไม่สำเร็จ');
    } finally {
      setCreating(false);
    }
  };

  const reviewTocInBrowser = async () => {
    if (!tocDraft || creating) return;
    setCreating(true);
    setError('');
    try {
      const nativePage = await fetchWithNativeBrowser(url.trim(), { expandToc: true });
      if (!nativePage) throw new Error('การเปิด WebView เพื่อตรวจสารบัญรองรับในแอป Android เท่านั้น');
      const newPages = nativePage.pages?.length
        ? nativePage.pages
        : [{ url: nativePage.url, title: nativePage.title, html: nativePage.html }];
      const mergedPages = [...tocDraft.pages];
      const seen = new Set(mergedPages.map((page) => page.url));
      for (const page of newPages) {
        if (!seen.has(page.url)) {
          seen.add(page.url);
          mergedPages.push(page);
        }
      }
      const data = await analyzeTocPages(url.trim(), {
        ...nativePage,
        pages: mergedPages,
      });
      if (data.type !== 'directory' || !Array.isArray(data.chapters) || data.chapters.length === 0) {
        throw new Error(data.message || 'ไม่พบรายการบทจากหน้าที่เก็บไว้');
      }
      const editedChapters = new Map(tocDraft.chapters.map((chapter) => [chapter.url, chapter]));
      const chapters = data.chapters
        .filter((chapter: { url: string }) => !tocDraft.excludedUrls.includes(chapter.url))
        .map((chapter: { url: string; title: string; order: number }) => ({
          ...chapter,
          title: editedChapters.get(chapter.url)?.title ?? chapter.title,
        }));
      setTocDraft({
        title: data.novelTitle || tocDraft.title,
        host: data.host || tocDraft.host,
        chapters,
        excludedUrls: tocDraft.excludedUrls,
        pages: mergedPages,
        usedNativeBrowser: true,
      });
    } catch (err: any) {
      setError(err.message || 'กลับไปตรวจสารบัญไม่สำเร็จ');
    } finally {
      setCreating(false);
    }
  };

  const confirmCreateProject = async () => {
    if (!tocDraft || !tocDraft.chapters.length || creating) return;
    setCreating(true);
    setError('');
    try {
      const project = await getStore().createProject({
        title: tocDraftTitle.trim() || tocDraft.title || tocDraft.host,
        sourceUrl: url.trim(),
        host: tocDraft.host,
        chapters: tocDraft.chapters.map((chapter, order) => ({ ...chapter, order })),
      });
      if (tocDraft.usedNativeBrowser) rememberNativeBrowser(project.id);

      // Cover lookup stays asynchronous and never blocks project creation/navigation.
      if (!project.coverUrl && project.sourceUrl) {
        void (async () => {
          try {
            const coverResponse = await fetch('/api/cover', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: project.sourceUrl, title: project.title }),
            });
            const coverResult = await coverResponse.json().catch(() => ({}));
            if (!coverResponse.ok || typeof coverResult.coverUrl !== 'string' || !coverResult.coverUrl) return;
            await getStore().updateProject(project.id, { coverUrl: coverResult.coverUrl });
          } catch (coverError) {
            console.warn('Could not resolve novel cover:', project.sourceUrl, coverError);
          }
        })();
      }
      router.push(`/project/${project.id}`);
    } catch (err: any) {
      setError(err.message || 'สร้างโปรเจคไม่สำเร็จ');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (p: NovelProject) => {
    if (!window.confirm(`ลบโปรเจกต์ "${p.title}" (รวมทุกบทและเนื้อหาที่ดึงมา)?`)) return;
    try {
      await getStore().deleteProject(p.id);
      await loadProjects();
    } catch (err) {
      setProjectsError(err instanceof Error ? err.message : 'ลบโปรเจกต์ไม่สำเร็จ');
    }
  };

  const handleExport = async () => {
    try {
      const completeProjects = await Promise.all(projects.map(async (project) => {
        const chapters = await Promise.all(project.chapters.map(async (chapter) => {
          const content = chapter.status === 'pending' ? null : await getStore().getChapterContent(project.id, chapter.id);
          if (chapter.status !== 'pending' && !content) throw new Error(`อ่านข้อมูลสำรองของบท “${chapter.title}” ในเรื่อง “${project.title}” ไม่สำเร็จ`);
          return content ? {
            ...chapter,
            originalText: content.originalText,
            translatedText: content.translatedText,
            preProofreadText: content.preProofreadText,
            readerContent: content.readerContent,
          } : chapter;
        }));
        const aiMemory = await exportNovelMemoryBundle(project.id);
        return { ...project, chapters, ...(aiMemory ? { aiMemory } : {}) };
      }));
      const blob = new Blob([JSON.stringify(completeProjects, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      const objectUrl = URL.createObjectURL(blob);
      a.href = objectUrl;
      a.download = `novel-projects-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setImportNotice(`ส่งออกไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleImportFile = async (file: File) => {
    setImportNotice('');
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data)) throw new Error('รูปแบบไฟล์ไม่ถูกต้อง (ต้องเป็นไฟล์ JSON ที่ export จากแอปนี้)');
      const result = await getStore().importProjects(data);
      void loadProjects();
      setImportNotice(`นำเข้าสำเร็จ ${result.imported} โปรเจกต์${result.skipped ? ` (ข้าม ${result.skipped} รายการที่ข้อมูลไม่ครบ)` : ''}`);
    } catch (err: any) {
      setImportNotice(`นำเข้าไม่สำเร็จ: ${err.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-bg text-fg transition-colors duration-200">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-line/80 bg-card/85 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-6">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <a href="/" className="flex min-w-0 shrink items-center gap-2 sm:gap-3" aria-label="Novel Translator หน้าหลัก">
              <span className="h-10 w-10 inline-flex items-center justify-center rounded-2xl bg-accent text-accent-fg shadow-sm shadow-accent/20 shrink-0">
                <Library className="w-5 h-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-bold leading-tight tracking-tight truncate">Novel Translator</span>
                <span className="block text-[11px] text-muted mt-0.5 truncate">พื้นที่จัดการนิยายและงานแปล</span>
              </span>
            </a>
            {isSupabaseConfigured() && (
              <button onClick={() => void signOut()} title="ออกจากระบบ" aria-label="ออกจากระบบ"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted hover:text-danger-fg hover:bg-danger-bg transition-colors sm:order-2">
                <LogOut className="h-4 w-4" />
              </button>
            )}
          </div>
          <nav aria-label="เมนูหลัก" className="flex w-full min-w-0 items-center justify-center overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:w-auto sm:flex-1 sm:justify-end">
            <div className="mx-auto flex w-max min-w-full items-center justify-center gap-1 sm:gap-2">
            <a href="/read" className="inline-flex h-9 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-xl px-2 text-[11px] font-medium text-muted hover:text-fg hover:bg-surface transition-colors sm:gap-1.5 sm:px-2.5 sm:text-xs"><BookOpen className="h-4 w-4" />อ่านด่วน</a>
            <a href="/dictionary" className="inline-flex h-9 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-xl px-2 text-[11px] font-medium text-muted hover:text-fg hover:bg-surface transition-colors sm:gap-1.5 sm:px-2.5 sm:text-xs"><BookOpen className="h-4 w-4" />พจนานุกรม</a>
            <a href="/glossary-sets" className="inline-flex h-9 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-xl px-2 text-[11px] font-medium text-muted hover:text-fg hover:bg-surface transition-colors sm:gap-1.5 sm:px-2.5 sm:text-xs"><Library className="h-4 w-4" />ชุดศัพท์</a>
            <a href="/settings/ai" className="inline-flex h-9 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-xl px-2 text-[11px] font-medium text-muted hover:text-fg hover:bg-surface transition-colors sm:gap-1.5 sm:px-2.5 sm:text-xs" title="ตั้งค่า API สำหรับการแปลและจับศัพท์"><Sparkles className="h-4 w-4" />ตั้งค่า AI</a>
            </div>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-8 sm:space-y-10">
        {localMigrationCount > 0 && (
          <section className="rounded-xl border border-amber-300 bg-amber-50 text-amber-950 p-4 space-y-2">
            <div className="flex items-center gap-2 font-semibold text-sm">
              <CloudUpload className="w-4 h-4" /> พบข้อมูลนิยายเก่าในเบราว์เซอร์นี้ {localMigrationCount} เรื่อง
            </div>
            <p className="text-xs leading-relaxed">
              ข้อมูลเก่ายังอยู่ในเครื่องและยังไม่ถูกลบ กดย้ายเพื่อคัดลอกข้อมูลเข้า Supabase และอัปโหลดเนื้อหาบทที่บันทึกไว้ไปยัง Storage
            </p>
            <button onClick={() => void migrateLocalProjects()} disabled={migratingLocal}
              className="inline-flex items-center justify-center gap-2 h-9 px-3 rounded-lg bg-amber-900 text-white text-xs font-semibold disabled:opacity-50">
              {migratingLocal ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudUpload className="w-4 h-4" />}
              {migratingLocal ? 'กำลังย้ายข้อมูล…' : 'ย้ายข้อมูลจากเครื่องนี้'}
            </button>
          </section>
        )}
        {/* ฟอร์มเพิ่มนิยายเปิดเมื่อผู้ใช้เรียก หรือเมื่อคลังว่างจริง */}
        {(showCreateForm || emptyLibrary) && (
        <section id="new-project" className="rounded-2xl border border-line bg-card shadow-sm">
          <div className="p-5 sm:p-8 space-y-5 sm:space-y-6">
          <div className="flex items-start gap-3">
            <span className="h-11 w-11 inline-flex items-center justify-center rounded-2xl bg-accent text-accent-fg shadow-md shadow-accent/20 shrink-0">
              <FolderOpen className="w-5 h-5" />
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-[11px] font-semibold tracking-[0.14em] uppercase text-accent-soft-fg mb-1">เริ่มต้นใช้งาน</p>
              <h2 className="text-xl sm:text-2xl font-bold leading-tight tracking-tight">{emptyLibrary ? 'เพิ่มนิยายเรื่องแรก' : 'เริ่มโปรเจกต์แปลเรื่องใหม่'}</h2>
              <p className="text-sm text-muted mt-1.5 leading-relaxed max-w-xl">
                {emptyLibrary ? 'วางลิงก์หน้าสารบัญของเรื่องที่อยากอ่าน' : 'วางลิงก์หน้าสารบัญนิยายจีน แล้วระบบจะดึงรายชื่อบทมาเตรียมไว้ให้'}
              </p>
            </div>
          </div>

          {!tocDraft ? (
          <>
          <form onSubmit={handleCreate} className="flex flex-col sm:flex-row gap-2.5">
            <label htmlFor="novel-toc-url" className="sr-only">ลิงก์หน้าสารบัญนิยาย</label>
            <input
              id="novel-toc-url"
              ref={createUrlInputRef}
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.uukanshu.cc/b/xxxx/"
              className="flex-1 min-w-0 px-4 h-12 bg-bg/90 border border-line rounded-xl text-sm text-fg placeholder:text-muted shadow-inner shadow-black/[0.02] focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
            />
            <button
              type="submit"
              disabled={creating}
              className="inline-flex h-12 items-center justify-center gap-2 px-6 bg-accent text-accent-fg text-sm font-semibold rounded-xl shadow-md shadow-accent/20 hover:brightness-110 active:scale-[0.98] disabled:opacity-50 transition-all cursor-pointer"
            >
              {creating ? (
                <Loader2 className="animate-spin w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
              {emptyLibrary ? 'เพิ่มนิยาย' : 'สร้างโปรเจกต์'}
            </button>
          </form>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs font-medium text-muted mr-1">เว็บที่รองรับ</span>
            {EXAMPLE_SITES.map((site) => (
              <button
                key={site.host}
                type="button"
                onClick={() => setUrl(`https://${site.host}/`)}
                className="inline-flex items-center gap-1 px-2.5 h-7 rounded-full border border-line bg-surface text-xs hover:bg-card hover:border-accent-line transition-colors cursor-pointer"
              >
                <Globe className="w-3 h-3 text-muted" />
                {site.label}
              </button>
            ))}
          </div>

          {chapterNotice && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-accent-soft border border-accent-line text-accent-soft-fg text-xs leading-relaxed">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-2 min-w-0">
                <p>{chapterNotice}</p>
                <a
                  href={`/read?url=${encodeURIComponent(url)}`}
                  className="inline-flex items-center gap-1 underline hover:brightness-110 cursor-pointer"
                >
                  <ExternalLink className="w-3 h-3" />
                  เปิดหน้านี้ด้วยอ่านด่วน
                </a>
              </div>
            </div>
          )}
          {error && (
            <div className="p-3 rounded-xl bg-danger-bg border border-danger-line text-danger-fg text-xs">
              {error}
            </div>
          )}
          </>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-accent-line bg-accent-soft/50 p-3">
                <p className="text-sm font-semibold text-accent-soft-fg">ตรวจสอบสารบัญก่อนสร้างโปรเจค</p>
                <p className="mt-1 text-xs text-muted">ตรวจพบ {tocDraft.chapters.length.toLocaleString('th-TH')} ตอน {tocDraft.usedNativeBrowser ? `จาก ${tocDraft.pages.length.toLocaleString('th-TH')} หน้าที่เก็บไว้` : 'จากการอ่านหน้าเว็บต้นทาง'} โปรดตรวจชื่อเรื่องและรายการตอนก่อนยืนยัน</p>
              </div>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted">ชื่อโปรเจค</span>
                <input value={tocDraftTitle} onChange={(event) => setTocDraftTitle(event.target.value)}
                  className="h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40" />
              </label>
              <div className="max-h-80 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
                {tocDraft.chapters.map((chapter, index) => (
                  <div key={chapter.url} className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface">
                    <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted">{(index + 1).toLocaleString('th-TH')}</span>
                    <input aria-label={`ชื่อบทที่ ${index + 1}`} value={chapter.title}
                      onChange={(event) => setTocDraft((current) => current ? ({
                        ...current,
                        chapters: current.chapters.map((item) => item.url === chapter.url ? { ...item, title: event.target.value } : item),
                      }) : current)}
                      className="h-9 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 text-xs text-fg focus:border-line focus:bg-bg focus:outline-none" />
                    <button type="button" aria-label={`ลบบทที่ ${index + 1}`}
                      onClick={() => setTocDraft((current) => current ? ({
                        ...current,
                        chapters: current.chapters.filter((item) => item.url !== chapter.url),
                        excludedUrls: current.excludedUrls.includes(chapter.url)
                          ? current.excludedUrls
                          : [...current.excludedUrls, chapter.url],
                      }) : current)}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-danger-bg hover:text-danger-fg">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted">สามารถแก้ชื่อบทหรือลบบทที่ไม่ถูกต้องได้ หากพบว่าขาดบางหน้า ให้กลับไปเปิดหน้าสารบัญและเก็บหน้าเพิ่มเติม</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void reviewTocInBrowser()} disabled={creating}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-line px-3 text-xs font-semibold hover:bg-surface disabled:opacity-50">
                  <Globe className="h-4 w-4" /> กลับไปตรวจใน WebView
                </button>
                <button type="button" onClick={() => void confirmCreateProject()} disabled={creating || tocDraft.chapters.length === 0}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-xs font-semibold text-accent-fg disabled:opacity-50">
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
                  ยืนยันและสร้างโปรเจค ({tocDraft.chapters.length.toLocaleString('th-TH')} ตอน)
                </button>
                <button type="button" onClick={() => { setTocDraft(null); setError(''); }}
                  className="inline-flex h-10 items-center justify-center rounded-xl px-3 text-xs text-muted hover:bg-surface">
                  ยกเลิก
                </button>
              </div>
              {error && <div className="rounded-xl border border-danger-line bg-danger-bg p-3 text-xs text-danger-fg">{error}</div>}
            </div>
          )}
                  </div>
        </section>
        )}

        {/* รายการโปรเจกต์ */}
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.14em] text-accent-soft-fg uppercase mb-1">คลังงานของคุณ</p>
              <h2 className="font-serif text-2xl font-bold tracking-tight">
                ชั้นหนังสือ{' '}
                {mounted && <span className="text-muted font-medium text-base">({projects.length})</span>}
              </h2>
              <p className="text-xs text-muted mt-1">แตะปกเพื่อเปิดสารบัญ หรืออ่านต่อจากตอนที่ค้างไว้</p>
            </div>
            <div className="flex items-center gap-2">
              {!emptyLibrary && <button type="button" onClick={() => setShowCreateForm((open) => !open)}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-accent px-3 text-xs font-semibold text-accent-fg hover:brightness-105">
                <FolderOpen className="h-4 w-4" /> เพิ่มนิยาย
              </button>}
              <details className="relative">
                <summary className="flex h-10 cursor-pointer list-none items-center gap-1.5 rounded-xl border border-line bg-card px-3 text-xs font-medium hover:bg-surface">จัดการคลัง <ChevronDown className="h-3.5 w-3.5" /></summary>
                <div className="absolute right-0 top-full z-30 mt-2 flex min-w-44 flex-col gap-1 rounded-xl border border-line bg-card p-2 shadow-xl">
              <button
                onClick={() => importInputRef.current?.click()}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-left text-xs hover:bg-surface"
                title="นำเข้า JSON: หาก ID โปรเจกต์ซ้ำ ข้อมูลในไฟล์จะถูกแทนที่"
              >
                <Upload className="w-3.5 h-3.5" />
                นำเข้า JSON
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleImportFile(file);
                  e.target.value = '';
                }}
              />
              <button
                onClick={handleExport}
                disabled={projects.length === 0}
                className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg border border-line text-xs bg-card hover:bg-surface hover:border-accent-line transition-colors disabled:opacity-40 cursor-pointer"
                title="ส่งออกทุกโปรเจกต์เป็นไฟล์ JSON (สำรอง/ย้ายไป Supabase ภายหลัง)"
              >
                <Download className="w-3.5 h-3.5" />
                ส่งออก JSON
              </button>
                </div>
              </details>
            </div>
          </div>

          {projectsError && (
            <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-danger-line bg-danger-bg p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-danger-fg">โหลดคลังโปรเจกต์ไม่สำเร็จ</p>
                <p className="mt-1 break-words text-xs text-danger-fg/80">{retryingProjects ? "กำลังโหลดคลังอีกครั้ง…" : projectsError}</p>
              </div>
              <button type="button" onClick={() => void retryLoadProjects()} disabled={retryingProjects}
                className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-danger-line bg-card px-3 text-xs font-semibold text-danger-fg disabled:opacity-50">
                {retryingProjects ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {retryingProjects ? 'กำลังลองใหม่…' : 'ลองโหลดอีกครั้ง'}
              </button>
            </div>
          )}

          {importNotice && (
            <p className={`text-xs rounded-lg px-3 py-2 border ${importNotice.startsWith('นำเข้าไม่สำเร็จ') ? 'bg-danger-bg border-danger-line text-danger-fg' : 'bg-accent-soft border-accent-line text-accent-soft-fg'}`}>{importNotice}</p>
          )}

          {latestRead && (
            <section className="flex items-center gap-3 rounded-2xl border border-accent-line bg-accent-soft/50 p-3 sm:p-4">
              <NovelCover projectId={latestRead.project.id} title={latestRead.project.title} coverUrl={latestRead.project.coverUrl} />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold tracking-wide text-accent-soft-fg">อ่านค้างไว้</p>
                <p className="mt-0.5 truncate font-serif text-base font-semibold">{latestRead.project.title}</p>
                <p className="truncate text-xs text-muted">{latestRead.chapter.title}</p>
              </div>
              <a href={`/read?projectId=${encodeURIComponent(latestRead.project.id)}&url=${encodeURIComponent(latestRead.chapter.url)}`}
                aria-label={`อ่านต่อ ${latestRead.project.title} ตอน ${latestRead.chapter.title}`}
                className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-accent-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2">
                อ่านต่อ <ChevronRight className="h-4 w-4" />
              </a>
            </section>
          )}

          {!mounted ? (
            <div role="status" aria-label="กำลังโหลดโปรเจกต์" className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} aria-hidden="true" className="rounded-2xl border border-line bg-card p-5 animate-pulse">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-surface" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="h-3 w-2/3 rounded bg-surface" />
                      <div className="h-2.5 w-1/3 rounded bg-surface" />
                    </div>
                  </div>
                  <div className="mt-5 h-16 rounded-xl bg-surface" />
                  <div className="mt-4 h-2 rounded bg-surface" />
                  <div className="mt-4 h-9 rounded-xl bg-surface" />
                </div>
              ))}
              <span className="sr-only">{retryingProjects ? "กำลังโหลดคลังอีกครั้ง…" : "กำลังโหลดโปรเจกต์…"}</span>
            </div>
          ) : !projectsError && projects.length > 0 ? (
            <>
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="relative min-w-0 flex-1">
                  <span className="sr-only">ค้นหาโปรเจกต์</span>
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                  <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="ค้นหาชื่อเรื่องหรือเว็บไซต์…" type="search"
                    className="h-10 w-full rounded-xl border border-line bg-card pl-9 pr-3 text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/40" />
                </label>
                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setSortMenuOpen((open) => !open)}
                    aria-label="เรียงลำดับโปรเจกต์"
                    aria-haspopup="listbox"
                    aria-expanded={sortMenuOpen}
                    className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-card px-3 text-xs text-fg transition-colors hover:border-accent-line hover:bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
                  >
                    <ArrowUpDown className="h-4 w-4 text-muted" />
                    <span>{projectSort === 'updated' ? 'แก้ไขล่าสุด' : projectSort === 'title' ? 'ชื่อเรื่อง' : 'ความคืบหน้าการดึง'}</span>
                    <ChevronDown className={`h-3.5 w-3.5 text-muted transition-transform ${sortMenuOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {sortMenuOpen && (
                    <div
                      role="listbox"
                      aria-label="เรียงลำดับโปรเจกต์"
                      className="absolute right-0 top-full z-20 mt-2 min-w-full overflow-hidden rounded-xl border border-line bg-card p-1.5 shadow-xl"
                    >
                      {([
                        ['updated', 'แก้ไขล่าสุด'],
                        ['title', 'ชื่อเรื่อง'],
                        ['progress', 'ความคืบหน้าการดึง'],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          role="option"
                          aria-selected={projectSort === value}
                          onClick={() => {
                            setProjectSort(value);
                            setSortMenuOpen(false);
                          }}
                          className={`flex w-full items-center justify-between whitespace-nowrap rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                            projectSort === value
                              ? 'bg-accent-soft text-accent-soft-fg font-semibold'
                              : 'text-fg hover:bg-surface'
                          }`}
                        >
                          {label}
                          {projectSort === value && <span aria-hidden="true">✓</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {visibleProjects.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {visibleProjects.map((p) => <ProjectCard key={p.id} project={p} onDelete={handleDelete} />)}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-line bg-card/60 px-6 py-10 text-center">
                  <Search className="mx-auto h-7 w-7 text-muted" />
                  <p className="mt-3 text-sm font-semibold">ไม่พบโปรเจกต์ที่ตรงกับคำค้น</p>
                  <p className="mt-1 text-xs text-muted">ลองค้นด้วยชื่อเรื่องหรือโดเมนเว็บไซต์อื่น</p>
                  <button type="button" onClick={() => setSearchQuery('')} className="mt-4 text-xs font-semibold text-accent-soft-fg hover:underline">ล้างคำค้น</button>
                </div>
              )}
            </>
          ) : null}
        </section>

        <p className="text-[11px] text-muted text-center pt-2 leading-relaxed max-w-lg mx-auto">
          ข้อมูลโปรเจกต์และเนื้อหาบทที่บันทึกแล้วจัดเก็บบนคลาวด์ สามารถส่งออก JSON เพื่อสำรองข้อมูลเพิ่มเติมได้
        </p>
      </main>
    </div>
  );
}