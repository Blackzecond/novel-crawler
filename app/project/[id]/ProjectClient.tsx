'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ChevronLeft, ChevronRight, Loader2, Play, Square, Trash2,
  ExternalLink, Search, ArrowUpDown, AlertTriangle, CheckCircle2, Circle,
  Sparkles, Globe, Library,
} from 'lucide-react';
import { getStore, NovelChapter, NovelProject } from '@/lib/storage';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function StatusBadge({ status }: { status: NovelChapter['status'] }) {
  if (status === 'translated')
    return (
      <span className="inline-flex items-center gap-1 px-1.5 h-5 rounded-full text-[10px] bg-green-600 text-white shrink-0">
        <Sparkles className="w-3 h-3" /> แปลแล้ว
      </span>
    );
  if (status === 'fetched')
    return (
      <span className="inline-flex items-center gap-1 px-1.5 h-5 rounded-full text-[10px] bg-accent-soft text-accent-soft-fg border border-accent-line shrink-0">
        <CheckCircle2 className="w-3 h-3" /> ดึงแล้ว
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-1.5 h-5 rounded-full text-[10px] bg-surface text-muted border border-line shrink-0">
      <Circle className="w-3 h-3" /> ยังไม่ดึง
    </span>
  );
}

export default function ProjectClient({ id }: { id: string }) {
  const [project, setProject] = useState<NovelProject | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [sortDesc, setSortDesc] = useState(false);
  const [filter, setFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState({ running: false, done: 0, total: 0 });
  const abortRef = useRef(false);

  const refresh = useCallback(async () => {
    const p = await getStore().getProject(id);
    if (!p) setNotFound(true);
    setProject(p);
    setLoaded(true);
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const applyChapter = (updated: NovelChapter) => {
    setProject((prev) =>
      prev
        ? { ...prev, chapters: prev.chapters.map((c) => (c.id === updated.id ? updated : c)) }
        : prev
    );
  };

  const fetchChapter = async (chapter: NovelChapter, forceRender = false): Promise<boolean> => {
    setBusyIds((prev) => new Set(prev).add(chapter.id));
    try {
      const res = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: chapter.url, forceRender }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');

      const updated = await getStore().updateChapter(id, chapter.id, {
        originalText: data.textContent,
        status: 'fetched',
        error: undefined,
      });
      if (updated) applyChapter(updated);
      return true;
    } catch (err: any) {
      const updated = await getStore().updateChapter(id, chapter.id, {
        status: chapter.status === 'fetched' ? 'fetched' : 'pending',
        error: err.message,
      });
      if (updated) applyChapter(updated);
      // อัปเดต project ให้รีเฟรช (เพราะ updateChapter อ่าน state จาก storage ล่าสุด)
      void refresh();
      return false;
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(chapter.id);
        return next;
      });
    }
  };

  const fetchAllPending = async () => {
    if (!project) return;
    const pending = project.chapters.filter((c) => c.status === 'pending');
    if (pending.length === 0) return;
    abortRef.current = false;
    setQueue({ running: true, done: 0, total: pending.length });
    for (let i = 0; i < pending.length; i++) {
      if (abortRef.current) break;
      // ดึงจาก storage ล่าสุดเสมอ (กัน state เก่า)
      const latest = await getStore().getProject(id);
      const ch = latest?.chapters.find((c) => c.id === pending[i].id);
      if (!ch || ch.status !== 'pending') {
        setQueue((q) => ({ ...q, done: i + 1 }));
        continue;
      }
      await fetchChapter(ch);
      setQueue((q) => ({ ...q, done: i + 1 }));
      if (i < pending.length - 1 && !abortRef.current) await sleep(700); // เว้นจังหวะกันเว็บโดน rate-limit
    }
    setQueue((q) => ({ ...q, running: false }));
  };

  const handleDelete = async () => {
    if (!project) return;
    if (!window.confirm(`ลบโปรเจกต์ "${project.title}" (รวมทุกบทและเนื้อหาที่ดึงมา)?`)) return;
    abortRef.current = true;
    await getStore().deleteProject(id);
    window.location.href = '/';
  };

  if (notFound) {
    return (
      <div className="min-h-screen bg-bg text-fg flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-muted">ไม่พบโปรเจกต์นี้ (อาจถูกลบไปแล้วหรือเปิดบนเบราว์เซอร์เครื่องอื่น)</p>
        <Link href="/" className="text-sm text-accent-soft-fg underline">กลับหน้าโปรเจกต์</Link>
      </div>
    );
  }

  if (!loaded || !project) {
    return (
      <div className="min-h-screen bg-bg text-fg flex items-center justify-center text-muted text-sm">
        <Loader2 className="animate-spin w-5 h-5 mr-2" /> กำลังโหลด...
      </div>
    );
  }

  const fetchedCount = project.chapters.filter((c) => c.status !== 'pending').length;
  const translatedCount = project.chapters.filter((c) => c.status === 'translated').length;
  const orders = project.chapters.map((c) => c.order);
  const chapters = project.chapters
    .filter((c) => !filter || c.title.includes(filter.trim()))
    .sort((a, b) => (sortDesc ? b.order - a.order : a.order - b.order));
  const hasOriginalOrderAsc = orders.length > 1 && orders[0] <= orders[orders.length - 1];

  return (
    <div className="min-h-screen bg-bg text-fg transition-colors duration-200">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur-md p-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-sm text-fg hover:text-accent-soft-fg shrink-0"
              title="กลับหน้าโปรเจกต์แปล"
            >
              <ChevronLeft className="w-4 h-4" />
              โปรเจกต์
            </Link>
            <div className="min-w-0">
              <h1 className="text-base font-bold leading-tight truncate">{project.title}</h1>
              <p className="text-xs text-muted truncate flex items-center gap-1.5">
                <Globe className="w-3 h-3 shrink-0" /> {project.host} · {project.chapters.length} บท
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={project.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="h-9 w-9 inline-flex items-center justify-center border border-line rounded-lg hover:bg-card text-muted"
              title="เปิดหน้าสารบัญต้นฉบับ"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
            <button
              onClick={handleDelete}
              className="h-9 w-9 inline-flex items-center justify-center border border-line rounded-lg hover:text-danger-fg hover:border-danger-line text-muted"
              aria-label="ลบโปรเจกต์"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-6 space-y-5">
        {/* สถิติ + ควบคุมการดึงข้อมูล */}
        <section className="rounded-xl border border-line bg-card p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <StatusBadge status="pending" /> <span className="text-muted mr-2">ยังไม่ดึง {project.chapters.length - fetchedCount}</span>
            <StatusBadge status="fetched" /> <span className="text-muted mr-2">{fetchedCount}</span>
            <StatusBadge status="translated" /> <span className="text-muted">{translatedCount}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                if (queue.running) {
                  abortRef.current = true;
                } else {
                  void fetchAllPending();
                }
              }}
              disabled={fetchedCount === project.chapters.length && !queue.running}
              className={`inline-flex h-9 items-center gap-1.5 px-3 rounded-lg text-sm border ${
                queue.running
                  ? 'bg-danger-fg text-white border-transparent'
                  : 'bg-accent text-accent-fg border-transparent'
              } disabled:opacity-40`}
            >
              {queue.running ? (
                <>
                  <Square className="w-3.5 h-3.5" /> หยุดดึง ({queue.done}/{queue.total})
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" /> ดึงเนื้อหาที่ยังไม่ได้ ({project.chapters.length - fetchedCount})
                </>
              )}
            </button>
            <button
              onClick={() => setSortDesc(!sortDesc)}
              className="inline-flex h-9 items-center gap-1.5 px-3 rounded-lg text-sm border border-line bg-surface hover:bg-card"
              title={hasOriginalOrderAsc ? 'สารบัญต้นฉบับเรียงบทจากน้อยไปมาก' : 'สารบัญต้นฉบับเรียงบทแบบย้อนกลับ'}
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              {sortDesc ? 'ใหม่…เก่า' : 'เก่า…ใหม่'}
            </button>
            <div className="relative flex-1 min-w-[10rem]">
              <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="ค้นหาชื่อบท..."
                className="w-full h-9 pl-8 pr-3 text-sm bg-bg border border-line rounded-lg text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          </div>
          {queue.running && (
            <div className="h-1.5 rounded-full bg-surface overflow-hidden">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${queue.total ? (queue.done / queue.total) * 100 : 0}%` }}
              />
            </div>
          )}
        </section>

        {/* รายการบท */}
        <section className="rounded-xl border border-line bg-card divide-y divide-line">
          {chapters.length === 0 && (
            <div className="p-8 text-center text-sm text-muted">ไม่พบบทที่ตรงกับคำค้น</div>
          )}
          {chapters.map((c) => {
            const busy = busyIds.has(c.id);
            return (
              <div key={c.id}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <span className="text-xs text-muted w-12 shrink-0 tabular-nums">
                    {c.order + 1}
                  </span>
                  <button
                    onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <span className="text-sm truncate block">{c.title}</span>
                    {c.error && (
                      <span className="text-xs text-danger-fg truncate block mt-0.5">{c.error}</span>
                    )}
                  </button>
                  <StatusBadge status={c.status} />
                  {!busy && (
                    <button
                      onClick={() => void fetchChapter(c)}
                      className="inline-flex h-7 items-center gap-1 px-2 rounded-md text-xs border border-line bg-surface hover:bg-card shrink-0"
                      title="ดึงเนื้อหาบทนี้"
                    >
                      <ChevronRight className="w-3 h-3" /> ดึง
                    </button>
                  )}
                  {busy && <Loader2 className="animate-spin w-4 h-4 text-accent shrink-0" />}
                  <ChevronRight
                    className={`w-4 h-4 text-muted shrink-0 transition-transform ${expandedId === c.id ? 'rotate-90' : ''}`}
                  />
                </div>

                {expandedId === c.id && (
                  <div className="px-4 pb-4 space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={`/read?url=${encodeURIComponent(c.url)}`}
                        className="inline-flex items-center gap-1 px-2.5 h-7 rounded-md text-xs bg-accent text-accent-fg"
                      >
                        <ExternalLink className="w-3 h-3" /> เปิดใน Reader
                      </Link>
                      <button
                        onClick={() => void fetchChapter(c, true)}
                        className="inline-flex items-center gap-1 px-2.5 h-7 rounded-md text-xs border border-line bg-surface hover:bg-card"
                      >
                        ลองใหม่ (Force Full Render)
                      </button>
                      <button
                        disabled
                        title="รอ Phase 3 — ต่อยอด AI key แล้วใช้งานได้"
                        className="inline-flex items-center gap-1 px-2.5 h-7 rounded-md text-xs border border-line bg-surface text-muted opacity-60 cursor-not-allowed"
                      >
                        <Sparkles className="w-3 h-3" /> แปลด้วย AI
                      </button>
                    </div>
                    <pre className="text-xs leading-relaxed whitespace-pre-wrap font-sans max-h-56 overflow-y-auto p-3 rounded-lg bg-surface border border-line">
                      {c.originalText?.slice(0, 2000) || 'ยังไม่ได้ดึงเนื้อหา'}
                      {c.originalText && c.originalText.length > 2000 && ' …'}
                    </pre>
                    {c.originalText && (
                      <p className="text-[11px] text-muted">
                        ({c.originalText.length.toLocaleString()} ตัวอักษร)
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      </main>
    </div>
  );
}
