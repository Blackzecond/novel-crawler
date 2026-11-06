'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ChevronLeft, ChevronRight, ChevronDown, Loader2, Play, Square, Trash2,
  ExternalLink, Search, ArrowUpDown, AlertTriangle, CheckCircle2, Circle,
  Sparkles, Globe, BookOpen, Download, FolderOpen, Pencil, Check, X,
  BookMarked, Plus, History, MoreVertical,
} from 'lucide-react';
import { getStore, NovelChapter, NovelProject } from '@/lib/storage';
import {
  detectNamedTerms, hasAiKey, loadAiSettings, saveAiSettings, translateNovelText,
} from '@/lib/ai';
import { loadCloudAiSettings, saveCloudAiSettings } from '@/lib/cloudPreferences';
import DetectedGlossaryModal, { DetectedGlossaryItem } from '@/components/DetectedGlossaryModal';
import { fetchWithNativeBrowser, prefersNativeBrowser, rememberNativeBrowser } from '@/lib/nativeBrowserFetch';

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
  const [chapterMenuId, setChapterMenuId] = useState<string | null>(null);
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null);
  const [chapterTitleDraft, setChapterTitleDraft] = useState('');
  const [bulkDeleteMode, setBulkDeleteMode] = useState(false);
  const [selectedChapterIds, setSelectedChapterIds] = useState<string[]>([]);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState({ running: false, done: 0, total: 0 });
  const abortRef = useRef(false);

  // เปลี่ยนชื่อโปรเจกต์
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');

  // แผงศัพท์เฉพาะ (glossary)
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [glossaryNotice, setGlossaryNotice] = useState('');
  const [detectedGlossary, setDetectedGlossary] = useState<{ items: DetectedGlossaryItem[]; sourceLabel?: string } | null>(null);
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
      const parseNativePage = async () => {
        const nativePage = await fetchWithNativeBrowser(chapter.url);
        if (!nativePage) return null;
        const fallbackRes = await fetch('/api/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: chapter.url,
            pageUrl: nativePage.url,
            html: nativePage.html,
          }),
        });
        const fallbackData = await fallbackRes.json().catch(() => ({}));
        if (!fallbackRes.ok) throw new Error(fallbackData.error || 'อ่านเนื้อหาจากหน้าเว็บไม่สำเร็จ');
        rememberNativeBrowser(id);
        return fallbackData;
      };

      // Fast path: always try the server fetch first. Only open WebView when the
      // response indicates a challenge or the server cannot retrieve the chapter.
      const res = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: chapter.url, forceRender, fastOnly: !forceRender && prefersNativeBrowser(id) }),
      });
      let data = await res.json().catch(() => ({}));
      if (!res.ok) {
        data = await parseNativePage();
        if (!data) throw new Error(data?.error || 'ไม่สามารถดึงข้อมูลได้ และอุปกรณ์นี้ไม่รองรับ WebView สำรอง');
      }

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
    setDetectedGlossary({ items: savedTerms.map((pair) => ({ zh: pair.zh, th: pair.th, type: pair.type })), sourceLabel });
  };

  const saveDetectedGlossaryEdits = async (items: DetectedGlossaryItem[]) => {
    const latest = await getStore().getProject(id);
    if (!latest) throw new Error('ไม่พบโปรเจกต์');
    const glossary = { ...latest.glossary };
    const glossaryTypes = { ...latest.glossaryTypes };
    const validItems = items.filter((item) => item.zh.trim() && item.th.trim());
    const retainedSources = new Set(validItems.map((item) => item.zh.trim()));
    for (const original of detectedGlossary?.items ?? []) {
      if (!retainedSources.has(original.zh)) {
        delete glossary[original.zh];
        delete glossaryTypes[original.zh];
      }
    }
    for (const item of validItems) {
      const zh = item.zh.trim(); const th = item.th.trim();
      glossary[zh] = th;
      glossaryTypes[zh] = item.type;
    }
    const updated = await getStore().updateProject(id, { glossary, glossaryTypes });
    if (!updated) throw new Error('บันทึกการแก้ไขคลังศัพท์ไม่สำเร็จ');
    setProject(updated);
    setGlossaryNotice(`บันทึกการแก้ไขศัพท์แล้ว ${items.filter((item) => item.zh.trim() && item.th.trim()).length} รายการ`);
    setDetectedGlossary(null);
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
    try {
      const latest = await getStore().getProject(id);
      if (!latest) throw new Error('ไม่พบโปรเจกต์');
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
      if (!updated) throw new Error('บันทึกไม่สำเร็จ');
      setProject(updated);
      setGlossaryNotice(th.trim() ? `บันทึกคำแปลแล้ว: ${zh} → ${th.trim()}` : `ลบ ${zh} ออกจากคลังแล้ว`);
    } catch (err) {
      setGlossaryNotice(`บันทึกศัพท์ไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const addManualTerm = async () => {
    const zh = addZh.trim();
    const th = addTh.trim();
    if (!zh) return;
    try {
      const latest = await getStore().getProject(id);
      if (!latest) throw new Error('ไม่พบโปรเจกต์');
      const glossary = { ...latest.glossary, [zh]: th };
      const glossaryTypes = { ...latest.glossaryTypes, [zh]: addTermType };
      const updated = await getStore().updateProject(id, { glossary, glossaryTypes });
      if (!updated || updated.glossary[zh] !== th) throw new Error('บันทึกไม่สำเร็จ');
      setProject(updated);
      setGlossaryNotice(`เพิ่มและบันทึกแล้ว: ${zh}${th ? ' → ' + th : ' (ยังไม่ระบุคำแปล)'} (${addTermType === 'character' ? 'ตัวละคร' : 'ศัพท์เฉพาะ'})`);
      setAddZh('');
      setAddTh('');
      setAddTermType('term');
    } catch (err) {
      setGlossaryNotice(`เพิ่มศัพท์ไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`);
    }
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
  const glossaryEntries = Object.entries(project.glossary);
  const characterEntries = glossaryEntries.filter(([zh]) => project.glossaryTypes?.[zh] === 'character');
  const termEntries = glossaryEntries.filter(([zh]) => project.glossaryTypes?.[zh] !== 'character');
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
            <button onClick={() => setSortDesc(!sortDesc)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm hover:bg-card" title={hasOriginalOrderAsc ? 'สารบัญต้นฉบับเรียงบทจากน้อยไปมาก' : 'สารบัญต้นฉบับเรียงบทแบบย้อนกลับ'}>
              <ArrowUpDown className="h-3.5 w-3.5"/> {sortDesc ? 'ใหม่…เก่า' : 'เก่า…ใหม่'}
            </button>
            <div className="relative min-w-[10rem] flex-1 basis-full sm:basis-auto">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"/>
              <input aria-label="ค้นหาชื่อบท" value={filter} onChange={e=>setFilter(e.target.value)} placeholder="ค้นหาชื่อบท..." className="h-9 w-full rounded-lg border border-line bg-bg pl-9 pr-3 text-sm"/>
            </div>
            <button onClick={() => {setBulkDeleteMode(!bulkDeleteMode);setSelectedChapterIds([]);}} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm">{bulkDeleteMode ? 'ยกเลิกเลือกลบ' : 'ลบหลายตอน'}</button>
            {bulkDeleteMode && <button disabled={!selectedChapterIds.length} onClick={async()=>{if(!window.confirm(`ลบ ${selectedChapterIds.length} ตอนพร้อมไฟล์ทั้งหมดถาวรหรือไม่?`))return;const updated=await getStore().deleteChapters(id,selectedChapterIds);if(updated)setProject(updated);setSelectedChapterIds([]);setBulkDeleteMode(false);}} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-danger-fg px-3 text-sm text-white disabled:opacity-40">ลบที่เลือก ({selectedChapterIds.length})</button>}
          </div>
          {queue.running && (
            <p className="text-[11px] text-muted flex items-center gap-1.5">
              <Loader2 className="animate-spin w-3 h-3" />
              กำลังดึงแบบลำดับ — เว้นจังหวะ {FETCH_DELAY_MS / 1000} วิ/บท กัน rate-limit ปิดแท็บนี้ไม่ได้ระหว่างลงมือทำ
            </p>
          )}
        </section>

        <section className="flex items-center justify-between rounded-xl border border-line bg-card px-4 py-3">
          <div><p className="text-sm font-semibold">Glossary</p><p className="mt-0.5 text-xs text-muted">จัดการตัวละครและศัพท์เฉพาะของเรื่องนี้</p></div>
          <Link href={`/project/${project.id}/glossary`} className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3 text-sm font-medium text-accent-fg"><BookMarked className="h-4 w-4"/> เปิดคลังศัพท์</Link>
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
            const isLastRead = c.id === project.lastReadChapterId;
            const selected = selectedChapterIds.includes(c.id);
            return (
              <div key={c.id} className="flex items-center gap-3 px-3 py-3 hover:bg-surface/50 sm:px-4">
                {bulkDeleteMode && <input type="checkbox" checked={selected} onChange={(e) => setSelectedChapterIds(current => e.target.checked ? [...current, c.id] : current.filter(value => value !== c.id))} aria-label={`เลือกลบ ${c.title}`} className="h-4 w-4 shrink-0"/>}
                <span className="hidden w-10 shrink-0 text-right text-xs tabular-nums text-muted sm:block">{c.order + 1}</span>
                <Link href={`/read?projectId=${encodeURIComponent(project.id)}&url=${encodeURIComponent(c.url)}`} className="min-w-0 flex-1 text-left">
                  <span className="line-clamp-2 block text-sm leading-snug">{c.title}</span>
                  {c.error && <span className="mt-0.5 block truncate text-xs text-danger-fg">{c.error}</span>}
                  {isLastRead && <span className="mt-0.5 block text-[11px] text-accent-soft-fg">อ่านค้างไว้</span>}
                </Link>
                <StatusBadge status={c.status}/>
                <div className="relative shrink-0">
                  <button type="button" onClick={() => setChapterMenuId(chapterMenuId === c.id ? null : c.id)} aria-label="เมนูบท" className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface"><MoreVertical className="h-5 w-5"/></button>
                  {chapterMenuId === c.id && <div className="absolute right-0 top-10 z-30 w-44 rounded-xl border border-line bg-card p-1 shadow-xl">
                    <button onClick={() => {setEditingChapterId(c.id);setChapterTitleDraft(c.title);setChapterMenuId(null);}} className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-surface">แก้ไขชื่อตอน</button>
                    <button onClick={async()=>{if(!window.confirm('ลบตอนนี้พร้อมไฟล์เนื้อหาทั้งหมดถาวรหรือไม่?'))return;const updated=await getStore().deleteChapters(id,[c.id]);if(updated)setProject(updated);setChapterMenuId(null);}} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-danger-fg hover:bg-surface">ลบตอน</button>
                  </div>}
                </div>
                {editingChapterId === c.id && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                  <div className="w-full max-w-sm rounded-2xl border border-line bg-card p-5">
                    <h2 className="font-semibold">แก้ไขชื่อตอน</h2>
                    <input autoFocus value={chapterTitleDraft} onChange={e=>setChapterTitleDraft(e.target.value)} className="mt-3 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm"/>
                    <div className="mt-4 flex justify-end gap-2"><button onClick={()=>setEditingChapterId(null)} className="rounded-lg border border-line px-3 py-2 text-sm">ยกเลิก</button><button onClick={async()=>{const updated=await getStore().renameChapter(id,c.id,chapterTitleDraft.trim());if(updated)setProject(updated);setEditingChapterId(null);}} disabled={!chapterTitleDraft.trim()} className="rounded-lg bg-accent px-3 py-2 text-sm text-accent-fg disabled:opacity-40">บันทึก</button></div>
                  </div>
                </div>}
              </div>
            );
          })}
        </section>




      </main>
      {detectedGlossary && <DetectedGlossaryModal items={detectedGlossary.items} sourceLabel={detectedGlossary.sourceLabel} onClose={() => setDetectedGlossary(null)} onSave={saveDetectedGlossaryEdits} />}
    </div>
  );
}
