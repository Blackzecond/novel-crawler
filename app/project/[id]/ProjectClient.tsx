'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ChevronLeft, ChevronRight, ChevronDown, Loader2, Play, Square, Trash2,
  ExternalLink, Search, ArrowUpDown, AlertTriangle, CheckCircle2, Circle,
  Sparkles, Globe, BookOpen, Download, FolderOpen, Pencil, Check, X,
  BookMarked, Plus, History,
} from 'lucide-react';
import { getStore, NovelChapter, NovelProject } from '@/lib/storage';
import {
  detectNamedTerms, hasAiKey, loadAiSettings, saveAiSettings, translateNovelText,
} from '@/lib/ai';
import { loadCloudAiSettings, saveCloudAiSettings } from '@/lib/cloudPreferences';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ค่าปริยายช่องว่างระหว่างดึงแต่ละบท (กันเว็บต้นทาง rate-limit)
// ภายหลังจะยอมรับการตั้งค่าเฉพาะเว็บต้นทางแทนค่าคงที่นี้
const FETCH_DELAY_MS = 700;

function htmlToPlainText(html: string): string {
  if (typeof DOMParser === 'undefined') return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim();
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  return (parsed.body.textContent ?? '').split(String.fromCharCode(160)).join(' ').trim();
}

function StatusBadge({ status }: { status: NovelChapter['status'] }) {
  if (status === 'translated')
    return (
      <span className="inline-flex items-center gap-1 px-1.5 h-5 rounded-full text-[10px] font-medium bg-green-600 text-white shrink-0">
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
  const [loadError, setLoadError] = useState('');
  const [sortDesc, setSortDesc] = useState(false);
  const [filter, setFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState({ running: false, done: 0, total: 0 });
  const abortRef = useRef(false);

  // เปลี่ยนชื่อโปรเจกต์
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');

  // แผงศัพท์เฉพาะ (glossary)
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [glossaryNotice, setGlossaryNotice] = useState('');
  const [detecBusyIds, setDetecBusyIds] = useState<Set<string>>(new Set());
  const [translateBusyIds, setTranslateBusyIds] = useState<Set<string>>(new Set());
  const [chapterNotice, setChapterNotice] = useState('');
  const [addZh, setAddZh] = useState('');
  const [addTh, setAddTh] = useState('');
  const [addTermType, setAddTermType] = useState<'character' | 'term'>('term');
  const [selectedGlossaryTerms, setSelectedGlossaryTerms] = useState<string[]>([]);
  const [aiReady, setAiReady] = useState(false);

  const refresh = useCallback(async () => {
    setLoaded(false);
    setLoadError('');
    setNotFound(false);
    try {
      const p = await getStore().getProject(id);
      setProject(p);
      setNotFound(!p);
    } catch (err) {
      if (err instanceof Error && err.message.includes('กรุณาเข้าสู่ระบบ')) {
        window.location.href = '/login';
        return;
      }
      setLoadError(err instanceof Error ? err.message : 'โหลดโปรเจกต์ไม่สำเร็จ');
    } finally {
      setLoaded(true);
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Sync non-secret AI configuration across devices; API keys stay in this browser.
  useEffect(() => {
    void (async () => {
      const local = loadAiSettings();
      try {
        const cloud = await loadCloudAiSettings();
        if (cloud && (cloud.baseUrl || cloud.model)) {
          const merged = {
            ...local,
            baseUrl: cloud.baseUrl || local.baseUrl,
            model: cloud.model || local.model,
          };
          saveAiSettings(merged);
          setAiReady(hasAiKey(merged));
        } else {
          await saveCloudAiSettings(local);
          setAiReady(hasAiKey(local));
        }
      } catch (syncError) {
        console.warn('Could not sync AI settings:', syncError);
        setAiReady(hasAiKey(local));
      }
    })();
  }, []);

  const applyChapter = (updated: NovelChapter) => {
    setProject((prev) =>
      prev
        ? { ...prev, chapters: prev.chapters.map((c) => (c.id === updated.id || c.url === updated.url ? updated : c)) }
        : prev
    );
  };

  // โหลดเนื้อหาเฉพาะบทที่ผู้ใช้เปิด เพื่อลดการดาวน์โหลดนิยายทั้งเรื่องจาก Storage
  const loadChapterContent = async (chapter: NovelChapter) => {
    if (chapter.originalText !== undefined) return chapter;
    const loadedChapter = await getStore().getChapterContent(id, chapter.id);
    if (!loadedChapter) return chapter;
    if (loadedChapter.originalText === undefined && loadedChapter.readerContent) {
      loadedChapter.originalText = htmlToPlainText(loadedChapter.readerContent);
    }
    applyChapter(loadedChapter);
    return loadedChapter;
  };

  const toggleExpanded = async (chapter: NovelChapter) => {
    if (expandedId === chapter.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(chapter.id);
    try {
      await loadChapterContent(chapter);
    } catch (err) {
      setGlossaryNotice(`โหลดเนื้อหาบทไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`);
    }
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
        url: chapter.url,
        title: chapter.title,
        order: chapter.order,
        originalText: data.textContent,
        readerContent: data.content,
        status: 'fetched',
        error: undefined,
      });
      if (updated) applyChapter(updated);

      // โหมดอัตโนมัติ: ตรวจชื่อ/ศัพท์เฉพาะทันทีหลังดึงบทสำเร็จ (dedupe ที่ระดับโปรเจกต์)
      if (updated) {
        const latest = await getStore().getProject(id);
        if (latest?.glossaryMode === 'auto' && hasAiKey()) {
          // Read the persisted chapter text from Storage for automatic glossary detection.
          const storedChapter = await getStore().getChapterContent(id, updated.id);
          const storedText = storedChapter?.originalText ?? updated.originalText;
          if (storedText) await runDetect(chapter.title, storedText);
        }
      }
      return true;
    } catch (err: any) {
      const updated = await getStore().updateChapter(id, chapter.id, {
        url: chapter.url,
        title: chapter.title,
        order: chapter.order,
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
      if (i < pending.length - 1 && !abortRef.current) await sleep(FETCH_DELAY_MS); // เว้นจังหวะกันเว็บโดน rate-limit
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

  // ---------- เปลี่ยนชื่อโปรเจกต์ ----------
  const startRename = () => {
    if (!project) return;
    setRenameDraft(project.title);
    setRenaming(true);
  };

  const saveRename = async () => {
    if (!renameDraft.trim()) return;
    const updated = await getStore().updateProject(id, { title: renameDraft.trim() });
    if (updated) setProject(updated);
    setRenaming(false);
  };

  // ---------- ศัพท์เฉพาะ (glossary) ----------
  /** เพิ่มคู่ศัพท์ใหม่เข้า glossary ของโปรเจกต์ — ข้ามคำที่มีอยู่แล้วเสมอ (dedupe) */
  const mergeDetected = async (pairs: { zh: string; th: string; type: 'character' | 'term' }[], sourceLabel?: string) => {
    const latest = await getStore().getProject(id);
    if (!latest) throw new Error('ไม่พบโปรเจกต์สำหรับบันทึกคลังศัพท์');
    const glossary = { ...latest.glossary };
    const glossaryTypes = { ...latest.glossaryTypes };
    const added: typeof pairs = [];
    for (const pair of pairs) {
      const zh = pair.zh.trim();
      const th = pair.th.trim();
      if (!zh || !th || glossary[zh] !== undefined) continue;
      glossary[zh] = th;
      glossaryTypes[zh] = pair.type === 'character' ? 'character' : 'term';
      added.push({ ...pair, zh, th });
    }
    if (added.length === 0) {
      setGlossaryNotice(pairs.length
        ? 'ตรวจเสร็จแล้ว แต่ไม่พบคำใหม่ที่ยังไม่มีในคลัง (คำเดิมจะไม่ถูกเพิ่มซ้ำ)'
        : 'ตรวจเสร็จแล้ว — AI ไม่พบชื่อหรือศัพท์เฉพาะในบทนี้');
      return;
    }
    const updated = await getStore().updateProject(id, { glossary, glossaryTypes });
    const savedTerms = updated ? added.filter((pair) => updated.glossary[pair.zh] === pair.th) : [];
    if (!updated || savedTerms.length !== added.length) throw new Error('บันทึกศัพท์ไม่ครบ กรุณาลองใหม่');
    setProject(updated);
    const characters = savedTerms.filter((pair) => pair.type === 'character');
    const terms = savedTerms.filter((pair) => pair.type !== 'character');
    const details = [
      characters.length ? `ตัวละคร: ${characters.map((pair) => pair.zh + ' → ' + pair.th).join(', ')}` : '',
      terms.length ? `ศัพท์: ${terms.map((pair) => pair.zh + ' → ' + pair.th).join(', ')}` : '',
    ].filter(Boolean).join(' · ');
    setGlossaryNotice(`บันทึกสำเร็จ ${savedTerms.length} รายการ${sourceLabel ? ` จากบท “${sourceLabel}”` : ''} — ${details}`);
  };

  const runDetect = async (chapterTitle: string, text: string) => {
    try {
      const pairs = await detectNamedTerms(text);
      await mergeDetected(pairs, chapterTitle);
    } catch (err: any) {
      if (err.message === 'AI_NOT_CONFIGURED') {
        setGlossaryNotice('ยังไม่ได้ตั้ง AI API key — กลับไปหน้าหลักแล้วเลือก “ตั้งค่า AI” เพื่อใส่คีย์/โมเดลที่ใช้');
      } else {
        setGlossaryNotice(`ตรวจศัพท์ล้มเหลว: ${err.message}`);
      }
    }
  };

  const detectChapter = async (c: NovelChapter) => {
    setDetecBusyIds((prev) => new Set(prev).add(c.id));
    setChapterNotice('');
    try {
      const chapter = await loadChapterContent(c);
      const sourceText = chapter.originalText ?? (chapter.readerContent ? htmlToPlainText(chapter.readerContent) : '');
      if (!sourceText.trim()) {
        setChapterNotice('ไม่พบเนื้อหาที่แคชไว้ในบท “' + c.title + '” กรุณาดึงเนื้อหาบทนี้ก่อน');
        return;
      }
      await runDetect(c.title, sourceText);
    } catch (err) {
      setChapterNotice('โหลดเนื้อหาสำหรับจับศัพท์ไม่สำเร็จ: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setDetecBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(c.id);
        return next;
      });
    }
  };

  const translateChapter = async (c: NovelChapter) => {
    setTranslateBusyIds((prev) => new Set(prev).add(c.id));
    setChapterNotice('');
    try {
      const chapter = await loadChapterContent(c);
      const sourceText = chapter.originalText ?? (chapter.readerContent ? htmlToPlainText(chapter.readerContent) : '');
      if (!sourceText.trim()) {
        setChapterNotice('ไม่พบเนื้อหาที่แคชไว้ในบท “' + c.title + '” กรุณาดึงเนื้อหาบทนี้ก่อน');
        return;
      }
      const latest = await getStore().getProject(id);
      const translatedText = await translateNovelText(sourceText, loadAiSettings(), latest?.glossary ?? project?.glossary ?? {});
      const saved = await getStore().updateChapter(id, chapter.id, {
        url: chapter.url, title: chapter.title, order: chapter.order,
        translatedText, status: 'translated', error: undefined,
      });
      if (saved) applyChapter(saved);
      setChapterNotice('แปลบท “' + c.title + '” สำเร็จและบันทึกลงคลังแล้ว');
    } catch (err) {
      setChapterNotice('แปลบท “' + c.title + '” ไม่สำเร็จ: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setTranslateBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(c.id);
        return next;
      });
    }
  };

  /** แก้/ลบคำแปลใน glossary (th ว่าง = ลบคำ) */
  const updateGlossaryTerm = async (zh: string, th: string, type?: 'character' | 'term') => {
    const latest = await getStore().getProject(id);
    if (!latest) return;
    const glossary = { ...latest.glossary };
    const glossaryTypes = { ...latest.glossaryTypes };
    if (th.trim()) {
      glossary[zh] = th.trim();
      if (type) glossaryTypes[zh] = type;
    } else {
      delete glossary[zh];
      delete glossaryTypes[zh];
    }
    const updated = await getStore().updateProject(id, { glossary, glossaryTypes });
    if (updated) setProject(updated);
  };

  const addManualTerm = async () => {
    const zh = addZh.trim();
    const th = addTh.trim();
    if (!zh || !th) return;
    const latest = await getStore().getProject(id);
    if (!latest) return;
    const glossary = { ...latest.glossary, [zh]: th };
    const glossaryTypes = { ...latest.glossaryTypes, [zh]: addTermType };
    const updated = await getStore().updateProject(id, { glossary, glossaryTypes });
    if (updated) {
      setProject(updated);
      setGlossaryNotice(`เพิ่มและบันทึกแล้ว: ${zh} → ${th} (${addTermType === 'character' ? 'ตัวละคร' : 'ศัพท์เฉพาะ'})`);
    }
    setAddZh('');
    setAddTh('');
    setAddTermType('term');
  };

  const deleteGlossaryTerms = async (terms: string[]) => {
    if (!terms.length) return;
    const confirmed = window.confirm(`ลบรายการที่เลือก ${terms.length} รายการออกจากคลังศัพท์หรือไม่?`);
    if (!confirmed) return;
    try {
      const updated = await getStore().deleteGlossaryTerms(id, terms);
      if (!updated) throw new Error('ไม่พบโปรเจกต์');
      setProject(updated);
      setSelectedGlossaryTerms([]);
      setGlossaryNotice(`ลบศัพท์สำเร็จ ${terms.length} รายการ`);
    } catch (err) {
      setGlossaryNotice(`ลบศัพท์ไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const setGlossaryMode = async (mode: 'manual' | 'auto') => {
    const updated = await getStore().updateProject(id, { glossaryMode: mode });
    if (updated) setProject(updated);
  };

  if (loadError) {
    return (
      <div className="min-h-screen bg-bg text-fg flex flex-col items-center justify-center gap-3 px-6 text-center">
        <AlertTriangle className="w-10 h-10 text-danger-fg" />
        <p role="alert" className="text-sm text-muted max-w-sm leading-relaxed">โหลดโปรเจกต์ไม่สำเร็จ: {loadError}</p>
        <button onClick={() => void refresh()} className="h-9 px-4 rounded-lg bg-accent text-accent-fg text-sm font-medium">ลองอีกครั้ง</button>
        <Link href="/" className="text-sm text-muted hover:text-fg">กลับหน้าโปรเจกต์</Link>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-bg text-fg flex flex-col items-center justify-center gap-3 px-6 text-center">
        <FolderOpen className="w-10 h-10 text-line" />
        <p className="text-sm text-muted max-w-xs leading-relaxed">
          ไม่พบโปรเจกต์นี้ (อาจถูกลบไปแล้วหรือเปิดบนเบราว์เซอร์เครื่องอื่น)
        </p>
        <Link href="/" className="inline-flex items-center gap-1.5 h-9 px-4 text-sm bg-accent text-accent-fg rounded-lg font-medium">
          <ChevronLeft className="w-4 h-4" /> กลับหน้าโปรเจกต์
        </Link>
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

  const total = project.chapters.length;
  const fetchedCount = project.chapters.filter((c) => c.status !== 'pending').length;
  const pendingCount = total - fetchedCount;
  const translatedCount = project.chapters.filter((c) => c.status === 'translated').length;
  const orders = project.chapters.map((c) => c.order);
  const chapters = project.chapters
    .filter((c) => !filter || c.title.includes(filter.trim()))
    .sort((a, b) => (sortDesc ? b.order - a.order : a.order - b.order));
  const hasOriginalOrderAsc = orders.length > 1 && orders[0] <= orders[orders.length - 1];
  const progressPct = total ? ((queue.running ? queue.done : fetchedCount) / total) * 100 : 0;
  const glossaryEntries = Object.entries(project.glossary);\n  const characterEntries = glossaryEntries.filter(([zh]) => project.glossaryTypes?.[zh] === 'character');\n  const termEntries = glossaryEntries.filter(([zh]) => project.glossaryTypes?.[zh] !== 'character');
  const lastRead = project.lastReadChapterId
    ? project.chapters.find((c) => c.id === project.lastReadChapterId) ?? null
    : null;

  return (
    <div className="min-h-screen bg-bg text-fg transition-colors duration-200">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur-md">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3 px-4 sm:px-6 h-14">
          <div className="flex items-center gap-2 min-w-0">
            <Link
              href="/"
              className="inline-flex items-center gap-0.5 h-8 pl-1 pr-2 rounded-lg text-sm text-muted hover:text-accent-soft-fg shrink-0 cursor-pointer transition-colors"
              title="กลับหน้าโปรเจกต์แปล"
            >
              <ChevronLeft className="w-4 h-4" />
              โปรเจกต์
            </Link>
            <div className="h-6 w-px bg-line shrink-0" />
            {renaming ? (
              <div className="flex items-center gap-1 min-w-0 flex-1 sm:flex-none sm:w-80">
                <input
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveRename();
                    if (e.key === 'Escape') setRenaming(false);
                  }}
                  className="h-8 flex-1 min-w-0 px-2 text-sm bg-bg border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/60"
                />
                <button onClick={() => void saveRename()} className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-accent-soft-fg hover:bg-accent-soft cursor-pointer" aria-label="ยืนยันชื่อใหม่">
                  <Check className="w-4 h-4" />
                </button>
                <button onClick={() => setRenaming(false)} className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-muted hover:bg-card cursor-pointer" aria-label="ยกเลิก">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1 min-w-0">
                <div className="min-w-0">
                  <h1 className="text-sm sm:text-base font-bold leading-tight truncate">{project.title}</h1>
                  <p className="text-[11px] text-muted leading-tight truncate hidden sm:flex items-center gap-1.5">
                    <Globe className="w-3 h-3 shrink-0" /> {project.host} · {total} บท
                  </p>
                </div>
                <button
                  onClick={startRename}
                  className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-muted hover:text-accent-soft-fg hover:bg-card shrink-0 cursor-pointer"
                  title="เปลี่ยนชื่อโปรเจกต์"
                  aria-label="เปลี่ยนชื่อโปรเจกต์"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <a
              href={project.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-line text-muted hover:text-accent-soft-fg hover:border-accent-line hover:bg-accent-soft transition-colors cursor-pointer"
              title="เปิดหน้าสารบัญต้นฉบับ"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
            <button
              onClick={handleDelete}
              className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-line text-muted hover:text-danger-fg hover:border-danger-line transition-colors cursor-pointer"
              aria-label="ลบโปรเจกต์"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-5 sm:py-6 space-y-4 sm:space-y-5">
        {/* แถบสถิติ + ความคืบหน้า + อ่านต่อ */}
        <section className="rounded-xl border border-line bg-card shadow-sm p-4 space-y-3">
          {lastRead && (
            <Link
              href={`/read?projectId=${encodeURIComponent(project.id)}&url=${encodeURIComponent(lastRead.url)}`}
              className="inline-flex w-full sm:w-auto items-center justify-center gap-1.5 h-8 px-3 text-xs font-medium bg-accent-soft text-accent-soft-fg border border-accent-line rounded-lg hover:brightness-105 cursor-pointer"
            >
              <History className="w-3.5 h-3.5" />
              อ่านต่อจากบทล่าสุด: {lastRead.title}
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          )}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-lg sm:text-xl font-bold leading-none">{pendingCount}</p>
              <p className="text-[11px] text-muted mt-1">ยังไม่ดึง</p>
            </div>
            <div className="border-x border-line">
              <p className="text-lg sm:text-xl font-bold leading-none text-accent-soft-fg">{fetchedCount}</p>
              <p className="text-[11px] text-muted mt-1">ดึงแล้ว</p>
            </div>
            <div>
              <p className="text-lg sm:text-xl font-bold leading-none text-green-600">{translatedCount}</p>
              <p className="text-[11px] text-muted mt-1">แปลแล้ว</p>
            </div>
          </div>
          <div className="h-1.5 rounded-full bg-surface overflow-hidden">
            <div
              className={`h-full transition-all ${queue.running ? 'bg-accent animate-pulse' : 'bg-accent'}`}
              style={{ width: `${progressPct}%` }}
            />
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
              disabled={pendingCount === 0 && !queue.running}
              className={`inline-flex h-9 items-center justify-center gap-1.5 px-3 rounded-lg text-sm font-medium transition-all disabled:opacity-40 cursor-pointer ${
                queue.running
                  ? 'bg-danger-fg text-white border border-transparent'
                  : 'bg-accent text-accent-fg border border-transparent hover:brightness-110'
              }`}
            >
              {queue.running ? (
                <>
                  <Square className="w-3.5 h-3.5" /> หยุดดึง ({queue.done}/{queue.total})
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" /> ดึงที่ยังไม่ได้ ({pendingCount})
                </>
              )}
            </button>
            <button
              onClick={() => setSortDesc(!sortDesc)}
              className="inline-flex h-9 items-center gap-1.5 px-3 rounded-lg text-sm border border-line bg-surface hover:bg-card hover:border-accent-line transition-colors cursor-pointer"
              title={hasOriginalOrderAsc ? 'สารบัญต้นฉบับเรียงบทจากน้อยไปมาก' : 'สารบัญต้นฉบับเรียงบทแบบย้อนกลับ'}
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              {sortDesc ? 'ใหม่…เก่า' : 'เก่า…ใหม่'}
            </button>
            <div className="relative flex-1 min-w-[10rem] basis-full sm:basis-auto">
              <Search className="w-3.5 h-3.5 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                aria-label="ค้นหาชื่อบท"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="ค้นหาชื่อบท..."
                className="w-full h-9 pl-9 pr-3 text-sm bg-bg border border-line rounded-lg text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/60 focus:border-accent-line"
              />
            </div>
          </div>
          {queue.running && (
            <p className="text-[11px] text-muted flex items-center gap-1.5">
              <Loader2 className="animate-spin w-3 h-3" />
              กำลังดึงแบบลำดับ — เว้นจังหวะ {FETCH_DELAY_MS / 1000} วิ/บท กัน rate-limit ปิดแท็บนี้ไม่ได้ระหว่างลงมือทำ
            </p>
          )}
        </section>

        {/* แผงศัพท์เฉพาะ / ชื่อตัวละคร (glossary) */}
        <section className="rounded-xl border border-line bg-card shadow-sm">
          <button
            onClick={() => setGlossaryOpen(!glossaryOpen)}
            className="w-full flex items-center justify-between gap-2 px-4 py-3 cursor-pointer"
            aria-expanded={glossaryOpen}
          >
            <span className="flex items-center gap-2 min-w-0">
              <BookMarked className="w-4 h-4 text-accent shrink-0" />
              <span className="text-sm font-semibold truncate">ศัพท์เฉพาะ / ชื่อตัวละคร</span>
              <span className="inline-flex items-center justify-center px-1.5 h-5 rounded-full text-[10px] bg-accent-soft text-accent-soft-fg border border-accent-line shrink-0">
                {glossaryEntries.length}
              </span>
            </span>
            <ChevronDown className={`w-4 h-4 text-muted transition-transform shrink-0 ${glossaryOpen ? 'rotate-180' : ''}`} />
          </button>

          {glossaryOpen && (
            <div className="px-4 pb-4 pt-3 space-y-3 border-t border-line">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {/* โหมดตรวจ: กดเอง / อัตโนมัติหลังดึง */}
                <div className="inline-flex rounded-lg border border-line overflow-hidden text-[11px] font-medium" role="group" aria-label="โหมดตรวจศัพท์เฉพาะ">
                  <button
                    onClick={() => void setGlossaryMode('manual')}
                    className={`px-2.5 h-7 ${project.glossaryMode === 'manual' ? 'bg-accent-soft text-accent-soft-fg' : 'text-muted hover:text-fg'} cursor-pointer`}
                    aria-pressed={project.glossaryMode === 'manual'}
                  >
                    กดตรวจเอง
                  </button>
                  <button
                    onClick={() => void setGlossaryMode('auto')}
                    className={`px-2.5 h-7 ${project.glossaryMode === 'auto' ? 'bg-accent-soft text-accent-soft-fg' : 'text-muted hover:text-fg'} cursor-pointer`}
                    aria-pressed={project.glossaryMode === 'auto'}
                  >
                    อัตโนมัติหลังดึง
                  </button>
                </div>
              </div>

              <p className="text-[11px] text-muted leading-relaxed">
                {project.glossaryMode === 'auto'
                  ? 'โหมดอัตโนมัติ: จับชื่อตัวละคร/ศัพท์เฉพาะทันทีหลังดึงเนื้อหาบทสำเร็จ คำที่มีอยู่แล้วจะไม่ถูกเพิ่มซ้ำ'
                  : 'โหมดกดเอง: ขยายบทที่ดึงแล้วแล้วกด “จับศัพท์ (AI)” คำที่มีอยู่แล้วจะไม่ถูกเพิ่มซ้ำ'}
              </p>

              {/* รายการศัพท์ */}
              <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                {glossaryEntries.map(([zh, th]) => (
                  <div key={zh} className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate max-w-[38%] shrink-0" lang="zh-CN">{zh}</span>
                    <span className="text-muted shrink-0">→</span>
                    <input
                      key={`${zh}:${th}`}
                      defaultValue={th}
                      onBlur={(e) => {
                        if (e.target.value.trim() !== th) void updateGlossaryTerm(zh, e.target.value);
                      }}
                      className="flex-1 min-w-0 h-8 px-2 text-sm bg-bg border border-line rounded-lg text-fg focus:outline-none focus:ring-2 focus:ring-accent/60"
                      aria-label={`คำแปลไทยของ ${zh}`}
                    />
                    <button
                      onClick={() => void updateGlossaryTerm(zh, '')}
                      className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-muted hover:text-danger-fg shrink-0 cursor-pointer"
                      aria-label={`ลบศัพท์ ${zh}`}
                      title="ลบศัพท์นี้"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {glossaryEntries.length === 0 && (
                  <p className="text-xs text-muted">
                    ยังไม่มีศัพท์ในโปรเจกต์ — ตรวจจากบทที่ดึงแล้ว หรือเพิ่มคำเองด้านล่าง
                  </p>
                )}
              </div>

              {/* เพิ่มคำเอง */}
              <div className="flex items-center gap-2">
                <input
                  value={addZh}
                  onChange={(e) => setAddZh(e.target.value)}
                  placeholder="ศัพท์จีน เช่น 林动"
                  className="w-32 sm:w-44 shrink-0 h-8 px-2 text-sm bg-bg border border-line rounded-lg text-fg focus:outline-none focus:ring-2 focus:ring-accent/60"
                />
                <span className="text-muted shrink-0">→</span>
                <input
                  value={addTh}
                  onChange={(e) => setAddTh(e.target.value)}
                  placeholder="คำแปลไทย (เว้นได้ เติมทีหลัง)"
                  className="flex-1 min-w-0 h-8 px-2 text-sm bg-bg border border-line rounded-lg text-fg focus:outline-none focus:ring-2 focus:ring-accent/60"
                />
                <button
                  disabled={!addZh.trim()}
                  onClick={() => void addManualTerm()}
                  className="h-8 inline-flex items-center gap-1 px-2.5 rounded-lg bg-accent text-accent-fg text-xs font-medium disabled:opacity-40 cursor-pointer shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" /> เพิ่ม
                </button>
              </div>

              {glossaryNotice && (
                <p className="text-[11px] text-muted flex items-start gap-1.5 rounded-lg bg-surface border border-line px-2.5 py-1.5">
                  <Sparkles className="w-3 h-3 mt-0.5 shrink-0 text-accent" /> {glossaryNotice}
                </p>
              )}
            </div>
          )}
        </section>

        {/* รายการบท */}
        <section className="rounded-xl border border-line bg-card shadow-sm divide-y divide-line">
          {chapters.length === 0 && (
            <div className="p-10 text-center">
              <Search className="w-8 h-8 mx-auto mb-2 text-line" />
              <p className="text-sm text-muted">ไม่พบบทที่ตรงกับคำค้น</p>
            </div>
          )}
          {chapters.map((c) => {
            const busy = busyIds.has(c.id);
            const detecting = detecBusyIds.has(c.id);
            const translating = translateBusyIds.has(c.id);
            const expanded = expandedId === c.id;
            const isLastRead = c.id === project.lastReadChapterId;
            return (
              <div key={c.id}>
                <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 hover:bg-surface/50 transition-colors">
                  <span className="hidden sm:block text-xs text-muted w-10 shrink-0 tabular-nums text-right">
                    {c.order + 1}
                  </span>
                  <button
                    onClick={() => void toggleExpanded(c)}
                    className="flex-1 min-w-0 text-left cursor-pointer"
                    aria-expanded={expanded}
                  >
                    <span className="text-sm leading-snug line-clamp-2">{c.title}</span>
                    {c.error && (
                      <span className="flex items-center gap-1 text-xs text-danger-fg truncate mt-0.5">
                        <AlertTriangle className="w-3 h-3 shrink-0" /> {c.error}
                      </span>
                    )}
                  </button>
                  <StatusBadge status={c.status} />
                  <button
                    onClick={() => void fetchChapter(c)}
                    disabled={busy}
                    className={`hidden md:inline-flex h-7 items-center gap-1 px-2.5 rounded-md text-xs border border-line bg-surface hover:bg-card hover:border-accent-line transition-colors shrink-0 cursor-pointer disabled:opacity-40 ${
                      c.status !== 'pending' ? 'opacity-60' : ''
                    }`}
                    title="ดึงเนื้อหาบทนี้"
                  >
                    <ChevronRight className="w-3 h-3" /> ดึง
                  </button>
                  {busy && <Loader2 className="animate-spin w-4 h-4 text-accent shrink-0" />}
                  <ChevronDown
                    className={`w-4 h-4 text-muted shrink-0 transition-transform cursor-pointer ${expanded ? 'rotate-180' : ''}`}
                    onClick={() => setExpandedId(expanded ? null : c.id)}
                  />
                </div>

                {expanded && (
                  <div className="px-3 sm:px-4 pb-4 pt-3 space-y-3 bg-surface/50 border-t border-line/60">
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => void fetchChapter(c)}
                        disabled={busy}
                        className="md:hidden inline-flex items-center gap-1 px-2.5 h-8 rounded-md text-xs bg-accent text-accent-fg font-medium cursor-pointer disabled:opacity-50"
                      >
                        <ChevronRight className="w-3 h-3" /> ดึงเนื้อหา
                      </button>
                      <Link
                        href={`/read?projectId=${encodeURIComponent(project.id)}&url=${encodeURIComponent(c.url)}`}
                        className="inline-flex items-center gap-1 px-2.5 h-8 rounded-md text-xs bg-accent text-accent-fg font-medium cursor-pointer"
                      >
                        <BookOpen className="w-3 h-3" /> เปิดใน Reader
                      </Link>
                      <button
                        onClick={() => void fetchChapter(c, true)}
                        className="inline-flex items-center gap-1 px-2.5 h-8 rounded-md text-xs border border-line bg-surface hover:bg-card transition-colors cursor-pointer"
                      >
                        ลองใหม่ (Force Render)
                      </button>
                      <button
                        onClick={() => void detectChapter(c)}
                        disabled={detecting || !aiReady}
                        title={!aiReady ? 'ยังไม่ได้ตั้ง AI API key — กลับไปหน้าหลักแล้วเลือก “ตั้งค่า AI”' : 'โหลดเนื้อหาจาก Storage/Cache แล้วจับชื่อตัวละครและศัพท์เฉพาะด้วย AI'}
                        className={`inline-flex items-center gap-1 px-2.5 h-8 rounded-md text-xs border transition-colors ${
                          aiReady
                            ? 'border-accent-line bg-accent-soft text-accent-soft-fg hover:brightness-105'
                            : 'border-line bg-surface text-muted opacity-60 cursor-not-allowed'
                        }`}
                      >
                        {detecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                        จับศัพท์ (AI)
                      </button>
                      <button
                        onClick={() => void translateChapter(c)}
                        disabled={translating || !aiReady}
                        title={!aiReady ? 'ยังไม่ได้ตั้ง AI API key — กลับไปหน้าหลักแล้วเลือก “ตั้งค่า AI”' : 'แปลเนื้อหาที่แคชไว้และบันทึกคำแปลลงคลัง'}
                        className={`inline-flex items-center gap-1 px-2.5 h-8 rounded-md text-xs border transition-colors ${aiReady ? 'border-accent-line bg-accent-soft text-accent-soft-fg hover:brightness-105' : 'border-line bg-surface text-muted opacity-60 cursor-not-allowed'}`}
                      >
                        {translating ? <Loader2 className="w-3 h-3 animate-spin" /> : <BookOpen className="w-3 h-3" />}
                        {translating ? 'กำลังแปล' : 'แปลด้วย AI'}
                      </button>
                    </div>
                    {isLastRead && (
                      <p className="text-[11px] text-accent-soft-fg flex items-center gap-1">
                        <History className="w-3 h-3" /> คุณค้างอ่านบทนี้ไว้
                      </p>
                    )}
                    {chapterNotice && <p role="status" className="text-[11px] text-muted rounded-lg bg-surface border border-line px-2.5 py-1.5">{chapterNotice}</p>}
                    <pre className="text-xs leading-relaxed whitespace-pre-wrap font-sans max-h-56 overflow-y-auto p-3 rounded-lg bg-bg border border-line">
                      {c.originalText?.slice(0, 2000) || (c.readerContent ? htmlToPlainText(c.readerContent).slice(0, 2000) : 'ยังไม่ได้ดึงเนื้อหา')}
                      {c.originalText && c.originalText.length > 2000 && ' …'}
                    </pre>
                    {(c.originalText || c.readerContent) && (
                      <p className="flex items-center gap-1 text-[11px] text-muted">
                        <Download className="w-3 h-3" />
                        {(c.originalText ?? htmlToPlainText(c.readerContent ?? '')).length.toLocaleString()} ตัวอักษร
                      </p>
                    )}
                    {c.translatedText && (
                      <div className="space-y-1">
                        <p className="text-[11px] font-medium text-muted">คำแปลที่บันทึกไว้</p>
                        <pre className="text-xs leading-relaxed whitespace-pre-wrap font-sans max-h-40 overflow-y-auto p-3 rounded-lg bg-bg border border-line">{c.translatedText.slice(0, 2000)}{c.translatedText.length > 2000 ? ' …' : ''}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </section>

        {!queue.running && pendingCount > 0 && (
          <p className="text-[11px] text-muted text-center flex items-center justify-center gap-1.5">
            <Sparkles className="w-3 h-3" />
            กดปุ่ม “ดึงที่ยังไม่ได้” ด้านบนเพื่อดึงบททั้งหมดแบบลำดับในครั้งเดียว หรือขยายแต่ละบทเพื่อดึงเฉพาะที่ต้องการ
          </p>
        )}


      </main>
    </div>
  );
}
