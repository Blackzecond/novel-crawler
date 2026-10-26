'use client';

import { useState, useEffect, useRef } from 'react';
import { 
  Sun, Moon, BookOpen, Loader2, Copy, Check, 
  ChevronLeft, ChevronRight, Play, Pause, 
  History, RotateCcw, Trash2, Library, Settings, X, List,
} from 'lucide-react';
import { getStore, NovelChapter, NovelProject } from '@/lib/storage';
import {
  loadReaderSettings, saveReaderSettings, applySavedTheme,
  readerDefaults, ReaderFont, ReaderTheme,
} from '@/lib/readerPrefs';

interface ArticleData {
  title: string;
  content: string;
  textContent: string;
  prevUrl: string | null;
  nextUrl: string | null;
}

interface HistoryItem {
  url: string;
  title: string;
  readAt: number;
}

export default function ReaderPage() {
  const [url, setUrl] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [readerProject, setReaderProject] = useState<NovelProject | null>(null);
  const [showToc, setShowToc] = useState(false);
  const [loading, setLoading] = useState(false);
  const [article, setArticle] = useState<ArticleData | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  
  // Customization State — โหลดค่าจำตอน mount (ยังใช้ default สำหรับ SSR กัน mismatach)
  const [fontSize, setFontSize] = useState(readerDefaults.fontSize);
  const [fontFamily, setFontFamily] = useState<ReaderFont>(readerDefaults.fontFamily);
  const [theme, setTheme] = useState<ReaderTheme>(readerDefaults.theme);
  const prefsHydratedRef = useRef(false);

  // History & Features State
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [autoScroll, setAutoScroll] = useState(false);
  const [scrollSpeed, setScrollSpeed] = useState(1);
  const scrollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const settingsBtnRef = useRef<HTMLButtonElement | null>(null);

  // โหลดประวัติการอ่านและค่าตั้งค่า reader จาก localStorage เมื่อเปิดเว็บครั้งแรก
  useEffect(() => {
    const savedHistory = localStorage.getItem('novel_history');
    if (savedHistory) {
      try { setHistory(JSON.parse(savedHistory)); } catch (e) {}
    }
    const saved = loadReaderSettings();
    setFontSize(saved.fontSize);
    setFontFamily(saved.fontFamily);
    setTheme(saved.theme);
    document.documentElement.dataset.theme = saved.theme;
    prefsHydratedRef.current = true;
  }, []);

  // ซิงก์/บันทักธีมและค่าตั้งค่าทุกครั้งที่เปลี่ยน (ข้ามรอบแรกเพื่อไม่ทับค่าจำ)
  useEffect(() => {
    if (!prefsHydratedRef.current) return;
    document.documentElement.dataset.theme = theme;
    saveReaderSettings({ fontSize, fontFamily, theme });
  }, [fontSize, fontFamily, theme]);

  // รับ URL และ projectId จากหน้าโปรเจกต์ เพื่อใช้ cache และสารบัญของเรื่องนั้น
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const target = params.get('url');
    const targetProjectId = params.get('projectId');
    if (targetProjectId) setProjectId(targetProjectId);
    if (target) {
      setUrl(target);
      void fetchArticle(target, false, targetProjectId);
    }
  }, []);

  // ปิดแผงการตั้งค่าเมื่อคลิกนอกกรอบหรือกด Esc
  useEffect(() => {
    if (!showSettings) return;
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      // ไม่ปิดถ้ากดที่แผงการตั้งค่าเอง หรือที่ปุ่ม toggle (กันคลิกแล้วเปิดซ้ำ)
      if (settingsRef.current?.contains(target) || settingsBtnRef.current?.contains(target)) return;
      setShowSettings(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowSettings(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showSettings]);

  // ระบบ Auto-Scroll
  useEffect(() => {
    if (autoScroll) {
      scrollIntervalRef.current = setInterval(() => {
        window.scrollBy({ top: scrollSpeed, behavior: 'smooth' });
      }, 50);
    } else if (scrollIntervalRef.current) {
      clearInterval(scrollIntervalRef.current);
    }
    return () => {
      if (scrollIntervalRef.current) clearInterval(scrollIntervalRef.current);
    };
  }, [autoScroll, scrollSpeed]);

  const saveToHistory = (itemUrl: string, itemTitle: string) => {
    const newHistory = [
      { url: itemUrl, title: itemTitle, readAt: Date.now() },
      ...history.filter((h) => h.url !== itemUrl),
    ].slice(0, 20); // เก็บไว้สูงสุด 20 เรื่องล่าสุด

    setHistory(newHistory);
    localStorage.setItem('novel_history', JSON.stringify(newHistory));
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem('novel_history');
  };

  const fetchArticle = async (targetUrl: string, forceRender = false, projectIdOverride?: string | null) => {
    if (!targetUrl) return;
    const activeProjectId = projectIdOverride === undefined ? projectId : projectIdOverride;
    setLoading(true); setError(''); setUrl(targetUrl); setAutoScroll(false);
    try {
      let project: NovelProject | null = null;
      let chapter: NovelChapter | null = null;
      if (activeProjectId) {
        project = await getStore().getProject(activeProjectId);
        if (project) { setReaderProject(project); chapter = project.chapters.find((item) => item.url === targetUrl) ?? null; }
      }
      if (!forceRender && activeProjectId && project && chapter && chapter.status !== 'pending') {
        const cached = await getStore().getChapterContent(activeProjectId, chapter.id);
        if (cached?.readerContent !== undefined) {
          const index = project.chapters.findIndex((item) => item.url === targetUrl);
          const cachedArticle: ArticleData = {
            title: chapter.title, content: cached.readerContent,
            textContent: cached.originalText ?? cached.readerContent.replace(/<[^>]*>/g, ' ').trim(),
            prevUrl: index > 0 ? project.chapters[index - 1].url : null,
            nextUrl: index >= 0 && index < project.chapters.length - 1 ? project.chapters[index + 1].url : null,
          };
          setArticle(cachedArticle); saveToHistory(targetUrl, cachedArticle.title);
          void getStore().updateProject(activeProjectId, { lastReadChapterId: chapter.id });
          window.scrollTo({ top: 0, behavior: 'smooth' }); return;
        }
      }
      const res = await fetch('/api/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: targetUrl, forceRender }) });
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const rawText = await res.text().catch(() => '');
        throw new Error(`Server ตอบกลับผิดพลาด (${res.status}): ${rawText.slice(0, 100)}...`);
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
      let articleData: ArticleData = data;
      if (activeProjectId && project && chapter) {
        const savedChapter = await getStore().updateChapter(activeProjectId, chapter.id, {
          url: chapter.url, title: chapter.title || data.title, order: chapter.order,
          originalText: data.textContent, readerContent: data.content, status: 'fetched', error: undefined,
        });
        if (savedChapter) {
          await getStore().updateProject(activeProjectId, { lastReadChapterId: savedChapter.id });
          const refreshed = await getStore().getProject(activeProjectId); if (refreshed) setReaderProject(refreshed);
        }
        const index = project.chapters.findIndex((item) => item.url === targetUrl);
        articleData = { ...data, title: chapter.title || data.title,
          prevUrl: index > 0 ? project.chapters[index - 1].url : null,
          nextUrl: index >= 0 && index < project.chapters.length - 1 ? project.chapters[index + 1].url : null };
      }
      setArticle(articleData); saveToHistory(targetUrl, articleData.title); window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  };
  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchArticle(url);
  };

  const handleCopy = async () => {
    if (!article) return;
    const textToCopy = `${article.title}\n\n${article.textContent.trim()}`;
    await navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const fontClasses = {
    sans: 'font-sans',
    serif: 'font-serif',
    mono: 'font-mono',
  };

  const themes = [
    { id: 'light' as const, label: 'สว่าง', icon: <Sun className="w-4 h-4" /> },
    { id: 'sepia' as const, label: 'กระดาษ', icon: <span aria-hidden className="text-sm">📖</span> },
    { id: 'dark' as const, label: 'มืด', icon: <Moon className="w-4 h-4" /> },
  ];

  const fonts = [
    { id: 'sans' as const, label: 'Sans' },
    { id: 'serif' as const, label: 'Serif' },
    { id: 'mono' as const, label: 'Mono' },
  ] as const;

  return (
    <div className={`min-h-screen bg-bg text-fg transition-colors duration-200 ${fontClasses[fontFamily]}`}>
      {/* Header Bar — บางเบา คุมสูงตายตัว */}
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur-md">
        <div className="max-w-3xl mx-auto flex items-center gap-2 h-14 px-3 sm:px-6">
          <a
            href="/"
            className="inline-flex items-center gap-1.5 h-8 pl-1 pr-2 rounded-lg text-sm text-muted hover:text-accent-soft-fg shrink-0 cursor-pointer transition-colors"
            title="กลับหน้าโปรเจกต์แปล"
          >
            <Library className="w-4 h-4" />
            <span className="hidden sm:inline">โปรเจกต์แปล</span>
          </a>

          <form onSubmit={handleFormSubmit} className="flex gap-2 flex-1 min-w-0">
            <input
              type="url"
              placeholder="วาง URL นิยายที่ต้องการอ่าน..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="flex-1 min-w-0 px-3 h-9 bg-card border border-line rounded-lg text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/60 focus:border-accent-line text-sm"
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="h-9 px-3 sm:px-4 bg-accent text-accent-fg text-sm font-medium rounded-lg hover:brightness-110 disabled:opacity-50 inline-flex items-center gap-1.5 shrink-0 cursor-pointer transition-all"
            >
              {loading ? <Loader2 className="animate-spin w-4 h-4" /> : <BookOpen className="w-4 h-4" />}
              <span className="hidden sm:inline">ดึงเนื้อหา</span>
            </button>
          </form>

          {/* History + Settings toggles */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors cursor-pointer shrink-0 ${showHistory ? 'bg-accent-soft border-accent-line text-accent-soft-fg' : 'border-line text-muted hover:bg-card hover:text-fg'}`}
              title="ประวัติการอ่าน"
              aria-label="ประวัติการอ่าน"
              aria-expanded={showHistory}
            >
              <History className="w-4 h-4" />
            </button>
            <div className="shrink-0">
              <button
                type="button"
                ref={settingsBtnRef}
                onClick={() => setShowSettings(!showSettings)}
                aria-haspopup="dialog"
                aria-expanded={showSettings}
                aria-label="การตั้งค่าการอ่าน"
                className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors cursor-pointer shrink-0 ${showSettings ? 'bg-accent-soft border-accent-line text-accent-soft-fg' : 'border-line text-muted hover:bg-card hover:text-fg'}`}
              >
                <Settings className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {projectId && (
        <div className="max-w-3xl mx-auto px-3 sm:px-6 pt-2">
          <button type="button" onClick={async () => {
            const next = !showToc; setShowToc(next);
            if (next && !readerProject) { try { setReaderProject(await getStore().getProject(projectId)); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } }
          }} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-line bg-card text-xs hover:border-accent-line" aria-expanded={showToc}>
            <List className="w-3.5 h-3.5" /> สารบัญ{readerProject ? ` (${readerProject.chapters.length})` : ''}
          </button>
          {showToc && readerProject && (
            <div className="mt-2 max-h-[55vh] overflow-y-auto rounded-xl border border-line bg-card shadow-sm divide-y divide-line">
              {readerProject.chapters.map((chapter) => (
                <button key={chapter.url} type="button" onClick={() => { setShowToc(false); void fetchArticle(chapter.url); }}
                  className={`w-full text-left px-3 py-2.5 text-sm hover:bg-surface ${chapter.url === url ? 'bg-accent-soft text-accent-soft-fg font-semibold' : ''}`}>
                  <span className="mr-2 text-xs text-muted">{chapter.order + 1}.</span>{chapter.title}
                  {chapter.status !== 'pending' && <span className="ml-2 text-[10px] text-green-600">แคชแล้ว</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {/* แผงการตั้งค่า — วางนอก <header> เพราะ backdrop-blur ทำ fixed คำนวณผิดที่:
          ยึดขอบล่างจอบนมือถือ, ปรากฏใต้ header มุมขวาบนเดสก์ท็อป */}
      {showSettings && (
        <div
          ref={settingsRef}
          role="dialog"
          aria-label="การตั้งค่าการอ่าน"
          className={`fixed z-30 inset-x-0 bottom-0 sm:inset-x-auto sm:bottom-auto sm:top-[4.25rem] sm:right-6 sm:w-72 p-4 sm:p-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-3 rounded-t-2xl sm:rounded-xl border border-line bg-card shadow-xl space-y-4 sm:space-y-3`}
        >
                  <div className="flex items-center justify-between sm:hidden -mb-1">
                    <h3 className="text-sm font-bold">การตั้งค่าการอ่าน</h3>
                    <button onClick={() => setShowSettings(false)} className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-muted hover:text-fg cursor-pointer" aria-label="ปิดการตั้งค่า">
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* ธีม */}
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-medium text-muted uppercase tracking-wide">ธีมสี</p>
                    <div className="flex gap-1.5">
                      {themes.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => setTheme(t.id)}
                          className={`flex-1 h-9 inline-flex items-center justify-center gap-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                            theme === t.id
                              ? 'bg-accent-soft border-accent-line text-accent-soft-fg'
                              : 'border-line bg-surface text-muted hover:text-fg'
                          }`}
                          aria-pressed={theme === t.id}
                          title={t.label}
                        >
                          {t.icon}
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ฟอนต์ */}
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-medium text-muted uppercase tracking-wide">ชนิดฟอนต์</p>
                    <div className="flex gap-1.5">
                      {fonts.map((f) => (
                        <button
                          key={f.id}
                          onClick={() => setFontFamily(f.id)}
                          className={`flex-1 h-8 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                            fontFamily === f.id
                              ? 'bg-accent-soft border-accent-line text-accent-soft-fg'
                              : 'border-line bg-surface text-muted hover:text-fg'
                          }`}
                          aria-pressed={fontFamily === f.id}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ขนาดอักษร */}
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-medium text-muted uppercase tracking-wide">ขนาดอักษร ({fontSize}px)</p>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setFontSize(Math.max(14, fontSize - 2))} className="h-8 flex-1 rounded-lg border border-line bg-surface text-xs font-bold hover:bg-card cursor-pointer" aria-label="ลดขนาดอักษร">A-</button>
                      <div className="flex-1 h-1.5 rounded-full bg-surface overflow-hidden shrink-0">
                        <div className="h-full bg-accent transition-all" style={{ width: `${((fontSize - 14) / 14) * 100}%` }} />
                      </div>
                      <button onClick={() => setFontSize(Math.min(28, fontSize + 2))} className="h-8 flex-1 rounded-lg border border-line bg-surface text-xs font-bold hover:bg-card cursor-pointer" aria-label="เพิ่มขนาดอักษร">A+</button>
                    </div>
                  </div>
                </div>
              )}

      {/* History Drawer */}
      {showHistory && (
        <div className="border-b border-line bg-surface">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3">
            <div className="flex justify-between items-center mb-2.5">
              <h3 className="font-bold flex items-center gap-2 text-sm">
                <History className="w-4 h-4" /> ประวัติการอ่านล่าสุด ({history.length})
              </h3>
              {history.length > 0 && (
                <button onClick={clearHistory} className="text-xs text-danger-fg flex items-center gap-1 hover:underline cursor-pointer">
                  <Trash2 className="w-3 h-3" /> ล้างประวัติ
                </button>
              )}
            </div>

            {history.length === 0 ? (
              <p className="text-xs text-muted py-2">ยังไม่มีประวัติการอ่าน</p>
            ) : (
              <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                {history.map((item, index) => (
                  <div key={index} className="flex justify-between items-center gap-2 bg-card border border-line p-2 rounded-lg">
                    <span className="truncate font-medium min-w-0 flex-1 text-xs">{item.title}</span>
                    <button
                      onClick={() => {
                        setShowHistory(false);
                        fetchArticle(item.url);
                      }}
                      className="px-2.5 h-7 bg-accent text-accent-fg rounded-md text-xs font-medium shrink-0 cursor-pointer"
                    >
                      อ่านต่อ
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Reader View */}
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {error && (
          <div className="p-4 bg-danger-bg border border-danger-line text-danger-fg rounded-xl mb-6 space-y-3">
            <p className="text-sm font-semibold">{error}</p>
            <button
              onClick={() => fetchArticle(url, true)}
              className="h-9 px-3 bg-danger-fg text-white text-xs font-medium rounded-lg hover:brightness-110 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" /> ลองใหม่ (Force Full Render)
            </button>
          </div>
        )}

        {article && (
          <article className="space-y-5">
            <div className="space-y-4 border-b border-line pb-5">
              <h1 className="text-2xl sm:text-3xl font-bold leading-tight">{article.title}</h1>

              {/* Action Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1.5 h-8 px-3 text-xs bg-surface text-fg rounded-lg border border-line hover:bg-card hover:border-accent-line transition-colors cursor-pointer"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'คัดลอกแล้ว!' : 'คัดลอกเนื้อหา'}
                  </button>

                  {/* Auto Scroll Controls */}
                  <button
                    onClick={() => setAutoScroll(!autoScroll)}
                    className={`inline-flex items-center gap-1.5 h-8 px-3 text-xs rounded-lg border transition-colors cursor-pointer ${
                      autoScroll ? 'bg-green-600 text-white border-transparent' : 'bg-surface text-fg border-line hover:bg-card'
                    }`}
                  >
                    {autoScroll ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    {autoScroll ? 'หยุดเลื่อน' : 'เลื่อนอัตโนมัติ'}
                  </button>
                </div>

                {/* Chapter Navigation */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => article.prevUrl && fetchArticle(article.prevUrl)}
                    disabled={!article.prevUrl || loading}
                    className="inline-flex items-center gap-1 h-8 px-3 text-xs bg-accent-soft text-accent-soft-fg rounded-lg disabled:opacity-40 border border-accent-line font-medium cursor-pointer transition-colors"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" /> ตอนก่อนหน้า
                  </button>
                  <button
                    onClick={() => article.nextUrl && fetchArticle(article.nextUrl)}
                    disabled={!article.nextUrl || loading}
                    className="inline-flex items-center gap-1 h-8 px-3 text-xs bg-accent text-accent-fg rounded-lg disabled:opacity-40 font-medium cursor-pointer transition-colors"
                  >
                    ตอนถัดไป <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Article Content Render */}
            <div
              className="space-y-6 [&>p]:mb-6 [&>p]:block leading-relaxed"
              style={{ fontSize: `${fontSize}px` }}
              dangerouslySetInnerHTML={{ __html: article.content }}
            />

            {/* Bottom Chapter Navigation */}
            <div className="flex justify-between items-center gap-2 pt-6 mt-8 border-t border-line">
              <button
                onClick={() => article.prevUrl && fetchArticle(article.prevUrl)}
                disabled={!article.prevUrl || loading}
                className="inline-flex items-center gap-1 h-9 px-4 text-sm bg-accent-soft text-accent-soft-fg rounded-lg disabled:opacity-40 border border-accent-line font-medium cursor-pointer transition-colors"
              >
                <ChevronLeft className="w-4 h-4" /> ตอนก่อนหน้า
              </button>
              <button
                onClick={() => article.nextUrl && fetchArticle(article.nextUrl)}
                disabled={!article.nextUrl || loading}
                className="inline-flex items-center gap-1 h-9 px-4 text-sm bg-accent text-accent-fg rounded-lg disabled:opacity-40 font-medium cursor-pointer transition-colors"
              >
                ตอนถัดไป <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </article>
        )}

        {!article && !loading && !error && (
          <div className="text-center py-20 px-6">
            <BookOpen className="w-10 h-10 mx-auto mb-3 text-line" />
            <p className="text-sm text-muted font-medium">ยังไม่ได้เปิดหน้าให้อ่าน</p>
            <p className="text-xs text-muted mt-1">วาง URL ด้านบนเพื่อเริ่มอ่าน หรือกดไอคอนประวัติการอ่าน</p>
          </div>
        )}
      </main>
    </div>
  );
}
