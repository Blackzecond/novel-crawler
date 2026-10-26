'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Library, BookOpen, Loader2, Trash2, Download, Upload,
  ChevronRight, AlertTriangle, ExternalLink, Globe, Sparkles, FolderOpen, LogOut, CloudUpload,
} from 'lucide-react';
import { getLocalProjectsForMigration, getStore, NovelProject } from '@/lib/storage';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { applySavedTheme } from '@/lib/readerPrefs';

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
  const fetched = project.chapters.filter((c) => c.status !== 'pending').length;
  const translated = project.chapters.filter((c) => c.status === 'translated').length;
  const pct = project.chapters.length ? (fetched / project.chapters.length) * 100 : 0;

  return (
    <article className="group relative rounded-xl border border-line bg-card shadow-sm hover:shadow-md hover:border-accent-line transition-all">
      <div className="flex items-center gap-3 p-4">
        <a href={`/project/${project.id}`} className="flex-1 min-w-0 block cursor-pointer">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-accent shrink-0" />
            <span className="font-semibold text-sm truncate">{project.title}</span>
          </div>
          <div className="text-xs text-muted mt-1.5 flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 max-w-full">
              <Globe className="w-3 h-3 shrink-0" />
              <span className="truncate">{project.host}</span>
            </span>
            <span aria-hidden className="text-line">·</span>
            <span className="shrink-0">{project.chapters.length} บท</span>
            <span aria-hidden className="text-line">·</span>
            <span className="inline-flex items-center gap-1 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-accent/60" />
              ดึงแล้ว {fetched}
            </span>
            {translated > 0 && (
              <span className="inline-flex items-center gap-1 shrink-0">
                <Sparkles className="w-3 h-3 text-green-600" />
                แปลแล้ว {translated}
              </span>
            )}
          </div>
        </a>
        <div className="flex items-center gap-1.5 shrink-0">
          <a
            href={`/project/${project.id}`}
            aria-label={`เปิดโปรเจกต์ ${project.title}`}
            className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-muted hover:text-accent-soft-fg hover:bg-accent-soft transition-colors cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </a>
          <button
            onClick={() => onDelete(project)}
            className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-muted hover:text-danger-fg hover:border-danger-line transition-colors cursor-pointer"
            aria-label={`ลบโปรเจกต์ ${project.title}`}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
      {/* แถบความคืบหน้าการดึงข้อมูล */}
      <div className="h-1 rounded-b-xl bg-surface overflow-hidden">
        <div
          className="h-full bg-accent transition-all group-hover:brightness-110"
          style={{ width: `${pct}%` }}
        />
      </div>
    </article>
  );
}

export default function ProjectsHomePage() {
  const router = useRouter();
  const [projects, setProjects] = useState<NovelProject[]>([]);
  const [mounted, setMounted] = useState(false);
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
    applySavedTheme(); // ใช้ธีมที่เคยตั้งไว้ใน reader ให้ต่อเนื่อง
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
      } catch (err) {
        setError(err instanceof Error ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
      } finally {
        setMounted(true);
      }
    })();
  }, [router]);

  const loadProjects = async () => setProjects(await getStore().listProjects());

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
    await getStore().deleteProject(p.id);
    void loadProjects();
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
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur-md">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3 px-4 sm:px-6 h-14">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="h-8 w-8 inline-flex items-center justify-center rounded-lg bg-accent text-accent-fg shrink-0">
              <Library className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h1 className="text-base font-bold leading-tight truncate">Novel Translator</h1>
              <p className="text-[11px] text-muted leading-tight truncate hidden sm:block">
                แปลนิยายจีนเป็นไทยด้วย AI — เริ่มจากวางลิงก์หน้าสารบัญ
              </p>
            </div>
          </div>
          <a
            href="/read"
            className="inline-flex items-center gap-1.5 h-8 px-3 border border-line rounded-lg text-xs bg-card hover:bg-surface hover:border-accent-line transition-colors shrink-0 cursor-pointer"
          >
            <BookOpen className="w-3.5 h-3.5" />
            อ่านด่วน (URL ใดก็ได้)
          </a>
          <a
            href="/glossary-sets"
            className="inline-flex items-center gap-1.5 h-8 px-3 border border-line rounded-lg text-xs bg-card hover:bg-surface hover:border-accent-line transition-colors shrink-0 cursor-pointer"
          >
            <BookOpen className="w-3.5 h-3.5" />
            คลังศัพท์
          </a>
          {isSupabaseConfigured() && (
            <button onClick={() => void signOut()} title="ออกจากระบบ"
              className="h-8 w-8 inline-flex items-center justify-center border border-line rounded-lg text-muted hover:text-fg bg-card shrink-0">
              <LogOut className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8">
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
        <section className="rounded-2xl border border-line bg-card shadow-sm p-5 sm:p-6 space-y-4">
          <div className="flex items-start gap-3">
            <span className="h-9 w-9 inline-flex items-center justify-center rounded-lg bg-accent-soft text-accent-soft-fg shrink-0">
              <FolderOpen className="w-4.5 h-4.5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-bold leading-snug">เริ่มโปรเจกต์แปลเรื่องใหม่</h2>
              <p className="text-xs text-muted mt-0.5 leading-relaxed">
                วางลิงก์หน้าสารบัญ (目录) ของนิยายจีน — ระบบจะจับรายชื่อบทให้อัตโนมัติ
              </p>
            </div>
          </div>

          <form onSubmit={handleCreate} className="flex flex-col sm:flex-row gap-2">
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.uukanshu.cc/b/xxxx/"
              className="flex-1 px-4 h-11 bg-bg border border-line rounded-xl text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/60 focus:border-accent-line"
            />
            <button
              type="submit"
              disabled={creating}
              className="inline-flex h-11 items-center justify-center gap-1.5 px-5 bg-accent text-accent-fg text-sm font-medium rounded-xl hover:brightness-110 disabled:opacity-50 transition-all cursor-pointer"
            >
              {creating ? (
                <Loader2 className="animate-spin w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
              สร้างโปรเจกต์
            </button>
          </form>

          <div className="flex flex-wrap items-center gap-2 -mt-1">
            <span className="text-xs text-muted">เว็บตัวอย่าง:</span>
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
        </section>

        {/* รายการโปรเจกต์ */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">
              โปรเจกต์แปลของฉัน{' '}
              {mounted && <span className="text-muted font-normal">({projects.length})</span>}
            </h2>
            <div className="flex items-center gap-1.5">
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

          {mounted && projects.length === 0 && (
            <div className="rounded-xl border border-dashed border-line bg-card/50 py-12 px-6 text-center">
              <FolderOpen className="w-10 h-10 mx-auto mb-3 text-line" />
              <p className="text-sm text-muted font-medium">ยังไม่มีโปรเจกต์</p>
              <p className="text-xs text-muted mt-1">
                วางลิงก์หน้าสารบัญด้านบนเพื่อเริ่มเรื่องแรกของคุณ
              </p>
            </div>
          )}

          {importNotice && (
            <p className={`text-xs rounded-lg px-3 py-2 border ${importNotice.startsWith('นำเข้าไม่สำเร็จ') ? 'bg-danger-bg border-danger-line text-danger-fg' : 'bg-accent-soft border-accent-line text-accent-soft-fg'}`}>{importNotice}</p>
          )}

          {!mounted ? (
            <div className="text-center py-12 text-muted text-sm">
              <Loader2 className="animate-spin w-5 h-5 mx-auto mb-2" />
              กำลังโหลดโปรเจกต์...
            </div>
          ) : (
            <div className="grid gap-2.5">
              {projects.map((p) => (
                <ProjectCard key={p.id} project={p} onDelete={handleDelete} />
              ))}
            </div>
          )}
        </section>

        <p className="text-[11px] text-muted text-center pt-2 leading-relaxed max-w-lg mx-auto">
          ข้อมูลทั้งหมดเก็บใน localStorage ของเบราว์เซอร์นี้เท่านั้น (จำกัด ∼5MB) — สำรองด้วย
          “ส่งออก JSON” แล้วจะผูก Supabase ภายหลังได้ทันที
        </p>
      </main>
    </div>
  );
}
