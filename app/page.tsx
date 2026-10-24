'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Library, BookOpen, Loader2, Trash2, Download,
  ChevronRight, AlertTriangle, ExternalLink, Globe,
} from 'lucide-react';
import { getStore, NovelProject } from '@/lib/storage';

// เว็บต้นฉบับจีนยอดนิยม — กดเพื่อใส่โดเมนต้นทางในช่อง URL
// (วางเฉพาะลิงก์หน้าสารบัญ/目录 เช่น https://www.uukanshu.cc/b/123/ จึงจะจับรายการบทได้)
const EXAMPLE_SITES = [
  { label: '笔趣阁 uukanshu', host: 'www.uukanshu.cc' },
  { label: '69书吧 69shu', host: 'www.69shu.pro' },
  { label: '起点中文 Qidian', host: 'www.qidian.com' },
];

export default function ProjectsHomePage() {
  const router = useRouter();
  const [projects, setProjects] = useState<NovelProject[]>([]);
  const [mounted, setMounted] = useState(false);
  const [url, setUrl] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [chapterNotice, setChapterNotice] = useState<string>('');

  useEffect(() => {
    document.documentElement.dataset.theme = document.documentElement.dataset.theme || 'light';
    void (async () => {
      setProjects(await getStore().listProjects());
      setMounted(true);
    })();
  }, []);

  const loadProjects = async () => setProjects(await getStore().listProjects());

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

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(projects, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `novel-projects-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="min-h-screen bg-bg text-fg transition-colors duration-200">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur-md p-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Library className="w-5 h-5 text-accent" />
            <div>
              <h1 className="text-base font-bold leading-tight">Novel Translator</h1>
              <p className="text-xs text-muted">แปลนิยายจีนเป็นไทยด้วย AI — เริ่มจากวางลิงก์หน้าสารบัญ</p>
            </div>
          </div>
          <a
            href="/read"
            className="inline-flex items-center gap-1.5 h-9 px-3 border border-line rounded-lg text-sm bg-card hover:bg-surface shrink-0"
          >
            <BookOpen className="w-4 h-4" />
            อ่านด่วน
          </a>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        {/* สร้างโปรเจกต์ใหม่ */}
        <section className="rounded-xl border border-line bg-card p-5 space-y-4">
          <h2 className="text-sm font-semibold">เริ่มโปรเจกต์แปลเรื่องใหม่</h2>
          <form onSubmit={handleCreate} className="flex flex-col sm:flex-row gap-2">
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="วางลิงก์หน้าสารบัญ (目录) ของนิยายจีน เช่น https://www.uukanshu.cc/b/xxxx/"
              className="flex-1 px-4 h-10 bg-bg border border-line rounded-lg text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              type="submit"
              disabled={creating}
              className="inline-flex h-10 items-center justify-center gap-1.5 px-4 bg-accent text-accent-fg text-sm rounded-lg hover:brightness-110 disabled:opacity-50 shrink-0"
            >
              {creating ? <Loader2 className="animate-spin w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              สร้างโปรเจกต์
            </button>
          </form>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">เว็บตัวอย่าง:</span>
            {EXAMPLE_SITES.map((site) => (
              <button
                key={site.host}
                type="button"
                onClick={() => setUrl(`https://${site.host}/`)}
                className="inline-flex items-center gap-1 px-2.5 h-7 rounded-full border border-line bg-surface text-xs hover:bg-card"
              >
                <Globe className="w-3 h-3 text-muted" />
                {site.label}
              </button>
            ))}
          </div>

          <p className="text-xs text-muted leading-relaxed">
            เคล็ดลับ: เว็บจีนบางแห่ง (โดยเฉพาะ Qidian) ติด Cloudflare/ต้อง password — แอปจะไปดึงผ่าน
            <span className="text-fg"> ScraperAPI </span>
            อัตโนมัติถ้าตั้ง <code className="text-xs bg-surface px-1 rounded">SCRAPER_API_KEY</code> ไว้บน Vercel
          </p>

          {chapterNotice && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-accent-soft border border-accent-line text-accent-soft-fg text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-2">
                <p>{chapterNotice}</p>
                <a
                  href={`/read?url=${encodeURIComponent(url)}`}
                  className="inline-flex items-center gap-1 underline hover:text-accent"
                >
                  <ExternalLink className="w-3 h-3" />
                  เปิดหน้านี้ด้วยอ่านด่วน
                </a>
              </div>
            </div>
          )}
          {error && (
            <div className="p-3 rounded-lg bg-danger-bg border border-danger-line text-danger-fg text-xs">
              {error}
            </div>
          )}
        </section>

        {/* รายการโปรเจกต์ */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              โปรเจกต์แปลของฉัน {mounted && <span className="text-muted font-normal">({projects.length})</span>}
            </h2>
            <button
              onClick={handleExport}
              disabled={projects.length === 0}
              className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-lg border border-line text-xs bg-surface hover:bg-card disabled:opacity-40"
              title="ส่งออกทุกโปรเจกต์เป็นไฟล์ JSON (สำรอง/ย้ายไป Supabase ภายหลัง)"
            >
              <Download className="w-3 h-3" />
              ส่งออก JSON
            </button>
          </div>

          {mounted && projects.length === 0 && (
            <div className="text-center py-16 text-muted text-sm rounded-xl border border-dashed border-line">
              ยังไม่มีโปรเจกต์ — วางลิงก์หน้าสารบัญด้านบนเพื่อเริ่มเรื่องแรก
            </div>
          )}

          {!mounted ? (
            <div className="text-center py-16 text-muted text-sm">
              <Loader2 className="animate-spin w-5 h-5 mx-auto mb-2" />
              กำลังโหลดโปรเจกต์...
            </div>
          ) : (
            <div className="grid gap-2">
              {projects.map((p) => {
                const fetched = p.chapters.filter((c) => c.status !== 'pending').length;
                const translated = p.chapters.filter((c) => c.status === 'translated').length;
                return (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 p-4 rounded-xl border border-line bg-card hover:border-accent-line transition-colors"
                  >
                    <a href={`/project/${p.id}`} className="flex-1 min-w-0 block">
                      <div className="font-medium text-sm truncate">{p.title}</div>
                      <div className="text-xs text-muted mt-1 truncate flex items-center gap-1.5">
                        <Globe className="w-3 h-3 shrink-0" />
                        {p.host}
                        <span>·</span>
                        บททั้งหมด {p.chapters.length} · ดึงแล้ว {fetched} · แปลแล้ว {translated}
                      </div>
                    </a>
                    <div className="flex items-center gap-2 shrink-0">
                      <a
                        href={`/project/${p.id}`}
                        className="px-3 h-8 inline-flex items-center text-xs bg-accent text-accent-fg rounded-lg"
                      >
                        เปิด
                      </a>
                      <button
                        onClick={() => handleDelete(p)}
                        className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-line text-muted hover:text-danger-fg hover:border-danger-line"
                        aria-label={`ลบโปรเจกต์ ${p.title}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <p className="text-xs text-muted text-center pt-2">
          ข้อมูลทั้งหมดเก็บใน localStorage ของเบราว์เซอร์นี้เท่านั้น (จำกัด ∼5MB) — สำรองด้วย “ส่งออก JSON” แล้วจะผูก Supabase ภายหลังได้ทันที
        </p>
      </main>
    </div>
  );
}
