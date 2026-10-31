'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Library, BookOpen, Loader2, Trash2, Download, Upload,
  ChevronRight, AlertTriangle, ExternalLink, Globe, Sparkles, FolderOpen, LogOut, CloudUpload, Search, ArrowUpDown, RefreshCw,
} from 'lucide-react';
import { getLocalProjectsForMigration, getStore, NovelProject } from '@/lib/storage';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { applySavedTheme, loadReaderSettings, saveReaderSettings } from '@/lib/readerPrefs';
import { loadCloudReaderSettings, saveCloudReaderSettings } from '@/lib/cloudPreferences';

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
  const fetched = project.chapters.filter((c) => c.status !== 'pending').length;
  const translated = project.chapters.filter((c) => c.status === 'translated').length;
  const pct = total ? Math.round((fetched / total) * 100) : 0;
  const translatedPct = total ? Math.round((translated / total) * 100) : 0;

  return (
    <article className="group rounded-2xl border border-line bg-card shadow-sm hover:-translate-y-0.5 hover:shadow-lg hover:border-accent-line transition-all duration-200">
      <div className="p-4 sm:p-5 space-y-4">
        <div className="flex items-start gap-3">
          <span className="h-10 w-10 rounded-xl bg-accent-soft text-accent-soft-fg inline-flex items-center justify-center shrink-0">
            <BookOpen className="w-4.5 h-4.5" />
          </span>
          <a href={`/project/${project.id}`} className="flex-1 min-w-0 block cursor-pointer">
            <span className="block font-semibold text-sm leading-snug truncate group-hover:text-accent-soft-fg transition-colors">{project.title}</span>
            <span className="text-xs text-muted mt-1 inline-flex items-center gap-1 max-w-full">
              <Globe className="w-3 h-3 shrink-0" />
              <span className="truncate">{project.host}</span>
            </span>
          </a>
          <button
            onClick={() => onDelete(project)}
            className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-muted hover:text-danger-fg hover:bg-danger-bg transition-colors cursor-pointer shrink-0"
            aria-label={`ลบโปรเจกต์ ${project.title}`}
            title="ลบโปรเจกต์"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 rounded-xl bg-surface/80 p-3">
          <div>
            <p className="text-[10px] text-muted">ทั้งหมด</p>
            <p className="text-sm font-semibold mt-0.5">{total.toLocaleString('th-TH')} <span className="text-[10px] font-normal text-muted">บท</span></p>
          </div>
          <div>
            <p className="text-[10px] text-muted">ดึงเนื้อหาแล้ว</p>
            <p className="text-sm font-semibold mt-0.5">{fetched.toLocaleString('th-TH')}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted">แปลแล้ว</p>
            <p className="text-sm font-semibold mt-0.5 inline-flex items-center gap-1"><Sparkles className="w-3 h-3 text-green-600" />{translated.toLocaleString('th-TH')}</p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted">ความคืบหน้าการดึงเนื้อหา</span>
            <span className="font-semibold tabular-nums">{pct}%</span>
          </div>
          <div
            className="h-1.5 rounded-full bg-surface overflow-hidden"
            role="progressbar"
            aria-label={`ดึงเนื้อหา ${project.title}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <div className="h-full rounded-full bg-accent transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex items-center justify-between text-[10px] text-muted">
            <span>{fetched.toLocaleString('th-TH')} / {total.toLocaleString('th-TH')} บท</span>
            <span>แปลแล้ว {translatedPct}%</span>
          </div>
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
      const res = await fetch('/api/toc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');

      if (data.type === 'directory') {
        const project = await getStore().createProject({
          title: data.novelTitle || data.host,
          sourceUrl: url,
          host: data.host,
          chapters: data.chapters,
        });
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
          return content ? { ...chapter, originalText: content.originalText, translatedText: content.translatedText } : chapter;
        }));
        return { ...project, chapters };
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
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3 px-4 sm:px-6 h-16">
          <a href="/" className="flex items-center gap-3 min-w-0" aria-label="Novel Translator หน้าหลัก">
            <span className="h-10 w-10 inline-flex items-center justify-center rounded-2xl bg-accent text-accent-fg shadow-sm shadow-accent/20 shrink-0">
              <Library className="w-5 h-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] font-bold leading-tight tracking-tight truncate">Novel Translator</span>
              <span className="block text-[11px] text-muted mt-0.5 truncate">พื้นที่จัดการนิยายและงานแปล</span>
            </span>
          </a>
          <nav aria-label="เมนูหลัก" className="flex items-center gap-1 sm:gap-2 shrink-0">
            <a href="/read" className="inline-flex items-center justify-center gap-2 h-9 px-2.5 sm:px-3 rounded-xl text-xs sm:text-sm text-muted hover:text-fg hover:bg-surface transition-colors">
              <BookOpen className="w-4 h-4" /><span className="hidden sm:inline">อ่านด่วน</span>
            </a>
            <a href="/glossary-sets" className="inline-flex items-center justify-center gap-2 h-9 px-2.5 sm:px-3 rounded-xl text-xs sm:text-sm text-muted hover:text-fg hover:bg-surface transition-colors">
              <Library className="w-4 h-4" /><span className="hidden sm:inline">คลังศัพท์</span>
            </a>
            <a href="/settings/ai" className="inline-flex items-center justify-center gap-2 h-9 px-2.5 sm:px-3 rounded-xl text-xs sm:text-sm text-muted hover:text-fg hover:bg-surface transition-colors" title="ตั้งค่า API สำหรับการแปลและจับศัพท์">
              <Sparkles className="w-4 h-4" /><span className="hidden sm:inline">ตั้งค่า AI</span>
            </a>
            {isSupabaseConfigured() && (
              <button onClick={() => void signOut()} title="ออกจากระบบ" aria-label="ออกจากระบบ"
                className="h-9 w-9 inline-flex items-center justify-center rounded-xl text-muted hover:text-danger-fg hover:bg-danger-bg transition-colors">
                <LogOut className="w-4 h-4" />
              </button>
            )}
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
        {/* สร้างโปรเจกต์ใหม่ — Hero */}
        <section id="new-project" className="relative isolate overflow-hidden rounded-3xl border border-accent-line/70 bg-card shadow-sm">
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-br from-accent-soft via-card to-card" />
          <div aria-hidden="true" className="absolute -right-16 -top-24 h-64 w-64 rounded-full bg-accent/10 blur-3xl" />
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
            <span className="text-xs font-medium text-muted mr-1">เว็บที่รองรับตัวอย่าง</span>
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

        {/* รายการโปรเจกต์ */}
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.14em] text-accent-soft-fg uppercase mb-1">คลังงานของคุณ</p>
              <h2 className="text-xl font-bold tracking-tight">
                โปรเจกต์แปลของฉัน{' '}
                {mounted && <span className="text-muted font-medium text-base">({projects.length})</span>}
              </h2>
              <p className="text-xs text-muted mt-1">จัดการนิยายที่กำลังอ่านและแปลอยู่ในที่เดียว</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => importInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg border border-line text-xs bg-card hover:bg-surface hover:border-accent-line transition-colors cursor-pointer"
                title="นำเข้าโปรเจกต์จากไฟล์ JSON ที่ export ไว้ (id ซ้ำจะถูกแทนที่ด้วยข้อมูลไฟล์)"
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
