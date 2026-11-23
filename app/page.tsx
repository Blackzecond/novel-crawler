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
import { loadCloudReaderSettings, saveCloudReaderSettings } from '@/lib/cloudPreferences';
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
            <a href={`/read?projectId=${encodeURIComponent(project.id)}&url=${encodeURIComponent(lastRead.url)}`} className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-accent-fg hover:brightness-105">
              <BookOpen className="h-4 w-4" /><span className="min-w-0 truncate">อ่านต่อ · {lastRead.title}</span>
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
  const [mounted, setMounted] = useState(false);
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
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [importNotice, setImportNotice] = useState('');
  const [localMigrationCount, setLocalMigrationCount] = useState(0);
  const [migratingLocal, setMigratingLocal] = useState(false);
  const [cloudUserId, setCloudUserId] = useState<string | null>(null);
  const coverFetchInProgress = useRef(new Set<string>());

  useEffect(() => {
    applySavedTheme(); // ใช้ธีมในเครื่องทันที แล้วปรับเป็นค่าจาก Cloud หากมี
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
    void (async () => {
      try {
        if (isSupabaseConfigured()) {
          const { data, error: sessionError } = await getSupabase().auth.getSession();
          if (sessionError) throw sessionError;
          if (!data.session?.user) {
            router.replace('/login');
            return;
          }
          const userId = data.session.user.id;
          setCloudUserId(userId);
          const migrationKey = `novel_cloud_migrated_v1_${userId}`;
          if (window.localStorage.getItem(migrationKey) !== '1') {
            setLocalMigrationCount(getLocalProjectsForMigration().length);
          }
        }
        setProjects(await getStore().listProjects());
        setProjectsError('');
      } catch (err) {
        setProjectsError(err instanceof Error ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
      } finally {
        setMounted(true);
      }
    })();
  }, [router]);

  useEffect(() => {
    const missingCovers = projects.filter((project) => project.sourceUrl && !project.coverUrl && !coverFetchInProgress.current.has(project.id));
    for (const project of missingCovers) {
      coverFetchInProgress.current.add(project.id);
      void (async () => {
        try {
          const response = await fetch('/api/cover', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: project.sourceUrl, title: project.title }),
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok || typeof result.coverUrl !== 'string' || !result.coverUrl) return;
          const updated = await getStore().updateProject(project.id, { coverUrl: result.coverUrl });
          if (updated) {
            setProjects((current) => current.map((item) => item.id === project.id ? { ...item, coverUrl: result.coverUrl } : item));
          }
        } catch (coverError) {
          console.warn('Could not load novel cover:', project.sourceUrl, coverError);
        }
      })();
    }
  }, [projects]);

  const loadProjects = async () => {
    try {
      const nextProjects = await getStore().listProjects();
      setProjects(nextProjects);
      setProjectsError('');
      return true;
    } catch (err) {
      setProjectsError(err instanceof Error ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
      return false;
    }
  };

  const retryLoadProjects = async () => {
    if (retryingProjects) return;
    setRetryingProjects(true);
    setProjectsError('');
    try {
      await loadProjects();
    } finally {
      setRetryingProjects(false);
    }
  };

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

  // Use the per-project last-read pointer and its existing update timestamp;
  // if the chapter was removed, fall back to the regular shelf entry.
  const latestReadProject = useMemo(() => projects
    .filter((project) => project.lastReadChapterId && project.chapters.some((chapter) => chapter.id === project.lastReadChapterId))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null, [projects]);

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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || creating) return;
    setCreating(true);
    setError('');
    setChapterNotice('');
    try {
      let usedNativeBrowser = false;
      const res = await fetch('/api/toc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      let data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const nativePage = await fetchWithNativeBrowser(url, { expandToc: true });
        if (!nativePage) throw new Error(data.error || 'เกิดข้อผิดพลาด');
        usedNativeBrowser = true;
        const fallbackRes = await fetch('/api/toc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, pageUrl: nativePage.url, html: nativePage.html, pages: nativePage.pages }),
        });
        data = await fallbackRes.json().catch(() => ({}));
        if (!fallbackRes.ok) throw new Error(data.error || 'อ่านสารบัญจากหน้าเว็บไม่สำเร็จ');
      }

      // A server response may be successful but contain only a JS shell with no TOC.
      // Give the native WebView one chance before treating it as a chapter page.
      if (data.type !== 'directory' && !usedNativeBrowser) {
        const nativePage = await fetchWithNativeBrowser(url, { expandToc: true });
        if (nativePage) {
          usedNativeBrowser = true;
          const fallbackRes = await fetch('/api/toc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, pageUrl: nativePage.url, html: nativePage.html, pages: nativePage.pages }),
          });
          data = await fallbackRes.json().catch(() => ({}));
          if (!fallbackRes.ok) throw new Error(data.error || 'อ่านสารบัญจากหน้าเว็บไม่สำเร็จ');
        }
      }

      if (data.type === 'directory') {
        const project = await getStore().createProject({
          title: data.novelTitle || data.host,
          sourceUrl: url,
          host: data.host,
          chapters: data.chapters,
        });
        if (usedNativeBrowser) rememberNativeBrowser(project.id);
        router.push(`/project/${project.id}`);
        return;
      }
      // เป็นหน้าบทหรือจับสารบัญไม่ได้
      setChapterNotice(data.message || 'ไม่พบรายการบทบนหน้านี้');
    } catch (err: any) {
      setError(err.message);
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
        {(showCreateForm || (mounted && !projectsError && projects.length === 0)) && (
        <section id="new-project" className="rounded-2xl border border-line bg-card shadow-sm">
          <div className="p-5 sm:p-8 space-y-5 sm:space-y-6">
          <div className="flex items-start gap-3">
            <span className="h-11 w-11 inline-flex items-center justify-center rounded-2xl bg-accent text-accent-fg shadow-md shadow-accent/20 shrink-0">
              <FolderOpen className="w-5 h-5" />
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-[11px] font-semibold tracking-[0.14em] uppercase text-accent-soft-fg mb-1">เริ่มต้นใช้งาน</p>
              <h2 className="text-xl sm:text-2xl font-bold leading-tight tracking-tight">เริ่มโปรเจกต์แปลเรื่องใหม่</h2>
              <p className="text-sm text-muted mt-1.5 leading-relaxed max-w-xl">
                วางลิงก์หน้าสารบัญนิยายจีน แล้วระบบจะดึงรายชื่อบทมาเตรียมไว้ให้
              </p>
            </div>
          </div>

          <form onSubmit={handleCreate} className="flex flex-col sm:flex-row gap-2.5">
            <label htmlFor="novel-toc-url" className="sr-only">ลิงก์หน้าสารบัญนิยาย</label>
            <input
              id="novel-toc-url"
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
              สร้างโปรเจกต์
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
              <button type="button" onClick={() => setShowCreateForm((open) => !open)}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-accent px-3 text-xs font-semibold text-accent-fg hover:brightness-105">
                <FolderOpen className="h-4 w-4" /> เพิ่มนิยาย
              </button>
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
                <p className="mt-1 break-words text-xs text-danger-fg/80">{projectsError}</p>
              </div>
              <button type="button" onClick={() => void retryLoadProjects()} disabled={retryingProjects}
                className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-danger-line bg-card px-3 text-xs font-semibold text-danger-fg disabled:opacity-50">
                {retryingProjects ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {retryingProjects ? 'กำลังลองใหม่…' : 'ลองโหลดอีกครั้ง'}
              </button>
            </div>
          )}

          {mounted && !projectsError && projects.length === 0 && (
            <div className="rounded-2xl border border-dashed border-accent-line bg-accent-soft/40 py-10 px-6 text-center">
              <span className="h-14 w-14 rounded-2xl bg-card border border-line inline-flex items-center justify-center mb-4 text-accent-soft-fg">
                <FolderOpen className="w-7 h-7" />
              </span>
              <p className="text-base font-semibold">ชั้นหนังสือของคุณยังว่างอยู่</p>
              <p className="text-xs text-muted mt-1.5 max-w-sm mx-auto leading-relaxed">
                เริ่มจากเพิ่มนิยายเรื่องแรก ระบบจะสร้างพื้นที่เก็บสารบัญ เนื้อหาบท และงานแปลไว้ให้
              </p>
              <a href="#new-project" className="mt-5 inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl bg-accent text-accent-fg text-xs font-semibold shadow-sm hover:brightness-110 transition-all">
                <FolderOpen className="w-4 h-4" /> เพิ่มนิยายเรื่องแรก
              </a>
            </div>
          )}

          {importNotice && (
            <p className={`text-xs rounded-lg px-3 py-2 border ${importNotice.startsWith('นำเข้าไม่สำเร็จ') ? 'bg-danger-bg border-danger-line text-danger-fg' : 'bg-accent-soft border-accent-line text-accent-soft-fg'}`}>{importNotice}</p>
          )}

          {latestReadProject && (
            <section className="flex items-center gap-3 rounded-2xl border border-accent-line bg-accent-soft/50 p-3 sm:p-4">
              <NovelCover projectId={latestReadProject.id} title={latestReadProject.title} coverUrl={latestReadProject.coverUrl} />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold tracking-wide text-accent-soft-fg">อ่านค้างไว้</p>
                <p className="mt-0.5 truncate font-serif text-base font-semibold">{latestReadProject.title}</p>
                <p className="truncate text-xs text-muted">{latestReadProject.chapters.find((chapter) => chapter.id === latestReadProject.lastReadChapterId)?.title}</p>
              </div>
              <a href={`/read?projectId=${encodeURIComponent(latestReadProject.id)}&url=${encodeURIComponent(latestReadProject.chapters.find((chapter) => chapter.id === latestReadProject.lastReadChapterId)!.url)}`}
                className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-accent-fg">
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
              <span className="sr-only">กำลังโหลดโปรเจกต์…</span>
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