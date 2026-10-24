'use client';

import { useState, useEffect, useRef } from 'react';
import { 
  Sun, Moon, BookOpen, Loader2, Copy, Check, 
  ChevronLeft, ChevronRight, ChevronDown, Play, Pause, 
  History, RotateCcw, Trash2, Library 
} from 'lucide-react';

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
  const [loading, setLoading] = useState(false);
  const [article, setArticle] = useState<ArticleData | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  
  // Customization State
  const [fontSize, setFontSize] = useState(18);
  const [lineHeight, setLineHeight] = useState<'normal' | 'relaxed' | 'loose'>('relaxed');
  const [fontFamily, setFontFamily] = useState<'sans' | 'serif' | 'mono'>('sans');
  const [theme, setTheme] = useState<'light' | 'dark' | 'sepia'>('light');

  // History & Features State
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [autoScroll, setAutoScroll] = useState(false);
  const [scrollSpeed, setScrollSpeed] = useState(1);
  const [showFontMenu, setShowFontMenu] = useState(false);
  const scrollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const fontDropdownRef = useRef<HTMLDivElement | null>(null);

  // โหลดประวัติการอ่านจาก localStorage เมื่อเปิดเว็บครั้งแรก
  useEffect(() => {
    const savedHistory = localStorage.getItem('novel_history');
    if (savedHistory) {
      try { setHistory(JSON.parse(savedHistory)); } catch (e) {}
    }
  }, []);

  // ซิงก์ธีมที่เลือกในแอปกับ <html> เพื่อให้ background ที่เลื่อนเกินขอบ (overscroll) ตรงสีกับธีม
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // รับ ?url= จาก router (เปิดบทจากโปรเจกต์) แล้วดึงเนื้อหาทันที
  useEffect(() => {
    const target = new URLSearchParams(window.location.search).get('url');
    if (target) {
      setUrl(target);
      void fetchArticle(target);
    }
  }, []);

  // ปิด dropdown ฟอนต์เมื่อคลิกนอกกรอบหรือกด Esc
  useEffect(() => {
    if (!showFontMenu) return;
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (fontDropdownRef.current && !fontDropdownRef.current.contains(e.target as Node)) {
        setShowFontMenu(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowFontMenu(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showFontMenu]);

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

  const fetchArticle = async (targetUrl: string, forceRender = false) => {
    if (!targetUrl) return;

    setLoading(true);
    setError('');
    setUrl(targetUrl);
    setAutoScroll(false);

    try {
      const res = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl, forceRender }),
      });

      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const rawText = await res.text().catch(() => '');
        throw new Error(`Server ตอบกลับผิดพลาด (${res.status}): ${rawText.slice(0, 100)}...`);
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');

      setArticle(data);
      saveToHistory(targetUrl, data.title);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
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

  const lineHeightClasses = {
    normal: '[&>p]:leading-normal',
    relaxed: '[&>p]:leading-relaxed',
    loose: '[&>p]:leading-loose',
  };

  return (
    <div className={`min-h-screen bg-bg text-fg transition-colors duration-200 ${fontClasses[fontFamily]}`}>
      {/* Header Bar */}
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur-md p-4">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row gap-4 justify-between items-center">
          <div className="flex items-center gap-3 shrink-0">
            <a
              href="/"
              className="inline-flex items-center gap-1.5 text-sm text-fg hover:text-accent-soft-fg"
              title="กลับหน้าโปรเจกต์แปล"
            >
              <Library className="w-4 h-4" />
              โปรเจกต์แปล
            </a>
          </div>

          <form onSubmit={handleFormSubmit} className="flex gap-2 w-full md:w-auto flex-1">
            <input
              type="url"
              placeholder="วาง URL นิยายที่ต้องการอ่าน..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="flex-1 px-4 py-2 bg-card border border-line rounded-lg text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent text-sm"
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-accent text-accent-fg text-sm rounded-lg hover:brightness-110 disabled:opacity-50 flex items-center gap-1.5 shrink-0"
            >
              {loading ? <Loader2 className="animate-spin w-4 h-4" /> : <BookOpen className="w-4 h-4" />}
              ดึงเนื้อหา
            </button>
          </form>

          {/* Controller Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            {/* History Toggle */}
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="inline-flex h-9 w-9 items-center justify-center border border-line rounded-lg hover:bg-card shrink-0"
              title="ประวัติการอ่าน"
              aria-label="ประวัติการอ่าน"
            >
              <History className="w-4 h-4" />
            </button>

            {/* Font Family — custom dropdown (native select popup ไม่เข้าธีม) */}
            <div ref={fontDropdownRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setShowFontMenu(!showFontMenu)}
                aria-haspopup="listbox"
                aria-expanded={showFontMenu}
                aria-label="เลือกชนิดฟอนต์"
                className="inline-flex h-9 items-center gap-1 px-2 border border-line rounded-lg text-sm bg-card text-fg hover:bg-surface"
              >
                {fontFamily === 'sans' ? 'Sans' : fontFamily === 'serif' ? 'Serif' : 'Mono'}
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showFontMenu ? 'rotate-180' : ''}`} />
              </button>
              {showFontMenu && (
                <div
                  role="listbox"
                  className="absolute z-30 top-full mt-1 w-32 py-1 rounded-lg border border-line bg-card shadow-lg"
                >
                  {(['sans', 'serif', 'mono'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      role="option"
                      aria-selected={fontFamily === f}
                      onClick={() => { setFontFamily(f); setShowFontMenu(false); }}
                      className={`w-full flex items-center justify-between gap-2 text-left px-3 py-1.5 text-sm hover:bg-surface ${fontFamily === f ? 'text-accent-soft-fg font-medium' : 'text-fg'}`}
                    >
                      {f === 'sans' ? 'Sans' : f === 'serif' ? 'Serif' : 'Mono'}
                      {fontFamily === f && <Check className="w-3.5 h-3.5" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Font Size */}
            <div className="flex items-center border border-line rounded-lg h-9 px-1 bg-card shrink-0">
              <button onClick={() => setFontSize(Math.max(14, fontSize - 2))} className="inline-flex h-7 items-center justify-center px-1.5 text-xs font-bold" aria-label="ลดขนาดอักษร">A-</button>
              <span className="text-xs px-1">{fontSize}px</span>
              <button onClick={() => setFontSize(Math.min(28, fontSize + 2))} className="inline-flex h-7 items-center justify-center px-1.5 text-xs font-bold" aria-label="เพิ่มขนาดอักษร">A+</button>
            </div>

            {/* Theme Selector */}
            <div className="flex items-center gap-1 border border-line rounded-lg h-9 px-1 bg-card shrink-0">
              <button onClick={() => setTheme('light')} className={`inline-flex h-7 w-7 items-center justify-center rounded ${theme === 'light' ? 'bg-gray-200 text-black' : ''}`} aria-label="ธีมสว่าง">
                <Sun className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setTheme('sepia')} className={`inline-flex h-7 w-7 items-center justify-center rounded ${theme === 'sepia' ? 'bg-[#e2d5b7] text-[#5f4b32]' : ''}`} title="ธีมกระดาษ (Sepia)" aria-label="ธีมกระดาษสีสลัก">
                📖
              </button>
              <button onClick={() => setTheme('dark')} className={`inline-flex h-7 w-7 items-center justify-center rounded ${theme === 'dark' ? 'bg-gray-700 text-white' : ''}`} aria-label="ธีมมืด">
                <Moon className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* History Drawer Modal */}
      {showHistory && (
        <div className="max-w-4xl mx-auto p-4 border-b border-line bg-surface transition-all">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-bold flex items-center gap-2 text-sm">
              <History className="w-4 h-4" /> ประวัติการอ่านล่าสุด ({history.length})
            </h3>
            {history.length > 0 && (
              <button onClick={clearHistory} className="text-xs text-danger-fg flex items-center gap-1 hover:underline">
                <Trash2 className="w-3 h-3" /> ล้างประวัติ
              </button>
            )}
          </div>

          {history.length === 0 ? (
            <p className="text-xs text-muted py-2">ยังไม่มีประวัติการอ่าน</p>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {history.map((item, index) => (
                <div key={index} className="flex justify-between items-center bg-card border border-line p-2 rounded text-xs gap-2">
                  <span className="truncate font-medium flex-1">{item.title}</span>
                  <button
                    onClick={() => {
                      setShowHistory(false);
                      fetchArticle(item.url);
                    }}
                    className="px-2 py-1 bg-accent text-accent-fg rounded shrink-0"
                  >
                    อ่านต่อ
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Main Reader View */}
      <main className="max-w-3xl mx-auto px-6 py-8">
        {error && (
          <div className="p-4 bg-danger-bg border border-danger-line text-danger-fg rounded-lg mb-6 space-y-3">
            <p className="text-sm font-semibold">{error}</p>
            <button
              onClick={() => fetchArticle(url, true)}
              className="px-3 py-1.5 bg-red-600 text-white text-xs rounded hover:brightness-110 flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" /> ลองใหม่ด้วยโหมดดึงข้อมูลลึก (Force Full Render)
            </button>
          </div>
        )}

        {article && (
          <article className="space-y-6">
            <div className="flex flex-col gap-4 border-b border-line pb-4">
              <h1 className="text-2xl md:text-3xl font-bold leading-tight">
                {article.title}
              </h1>

              {/* Action Toolbar */}
              <div className="flex flex-wrap justify-between items-center gap-2 pt-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-surface text-fg rounded-md border border-line hover:bg-card"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'คัดลอกแล้ว!' : 'คัดลอกเนื้อหา'}
                  </button>

                  {/* Auto Scroll Controls */}
                  <button
                    onClick={() => setAutoScroll(!autoScroll)}
                    className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-md border border-line ${
                      autoScroll ? 'bg-green-600 text-white' : 'bg-surface text-fg'
                    }`}
                  >
                    {autoScroll ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    {autoScroll ? 'หยุดเลื่อน' : 'เลื่อนเลื่อนออโต้'}
                  </button>
                </div>

                {/* Chapter Navigation */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => article.prevUrl && fetchArticle(article.prevUrl)}
                    disabled={!article.prevUrl || loading}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-accent-soft text-accent-soft-fg rounded-md disabled:opacity-40 border border-accent-line"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" /> ตอนก่อนหน้า
                  </button>
                  <button
                    onClick={() => article.nextUrl && fetchArticle(article.nextUrl)}
                    disabled={!article.nextUrl || loading}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-accent text-accent-fg rounded-md disabled:opacity-40"
                  >
                    ตอนถัดไป <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Article Content Render */}
            <div
              className={`prose max-w-none space-y-6 [&>p]:mb-6 [&>p]:block ${lineHeightClasses[lineHeight]}`}
              style={{ fontSize: `${fontSize}px` }}
              dangerouslySetInnerHTML={{ __html: article.content }}
            />

            {/* Bottom Chapter Navigation */}
            <div className="flex justify-between items-center pt-8 border-t border-line mt-10">
              <button
                onClick={() => article.prevUrl && fetchArticle(article.prevUrl)}
                disabled={!article.prevUrl || loading}
                className="flex items-center gap-1 px-4 py-2 text-sm bg-accent-soft text-accent-soft-fg rounded-md disabled:opacity-40 border border-accent-line"
              >
                <ChevronLeft className="w-4 h-4" /> ตอนก่อนหน้า
              </button>
              <button
                onClick={() => article.nextUrl && fetchArticle(article.nextUrl)}
                disabled={!article.nextUrl || loading}
                className="flex items-center gap-1 px-4 py-2 text-sm bg-accent text-accent-fg rounded-md disabled:opacity-40"
              >
                ตอนถัดไป <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </article>
        )}

        {!article && !loading && !error && (
          <div className="text-center py-20 text-muted text-sm">
            วาง URL ด้านบนเพื่อเริ่มอ่าน หรือเปิดเลือกเรื่องจากประวัติการอ่าน
          </div>
        )}
      </main>
    </div>
  );
}
