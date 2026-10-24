'use client';

import { useState, useEffect, useRef } from 'react';
import { 
  Sun, Moon, BookOpen, Loader2, Copy, Check, 
  ChevronLeft, ChevronRight, Play, Pause, 
  History, RotateCcw, Trash2, Settings 
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
  const scrollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // โหลดประวัติการอ่านจาก localStorage เมื่อเปิดเว็บครั้งแรก
  useEffect(() => {
    const savedHistory = localStorage.getItem('novel_history');
    if (savedHistory) {
      try { setHistory(JSON.parse(savedHistory)); } catch (e) {}
    }
  }, []);

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

  const themeStyles = {
    light: 'bg-white text-gray-900',
    dark: 'bg-gray-900 text-gray-100',
    sepia: 'bg-[#fbf0d9] text-[#5f4b32]',
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
    <div className={`min-h-screen transition-colors duration-200 ${themeStyles[theme]} ${fontClasses[fontFamily]}`}>
      {/* Header Bar */}
      <header className="sticky top-0 z-20 border-b backdrop-blur-md bg-opacity-90 p-4">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row gap-4 justify-between items-center">
          <form onSubmit={handleFormSubmit} className="flex gap-2 w-full md:w-auto flex-1">
            <input
              type="url"
              placeholder="วาง URL นิยายที่ต้องการอ่าน..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="flex-1 px-4 py-2 border rounded-lg text-black focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5 shrink-0"
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
              className="p-2 border rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-1 text-sm"
              title="ประวัติการอ่าน"
            >
              <History className="w-4 h-4" />
            </button>

            {/* Font Family */}
            <select
              value={fontFamily}
              onChange={(e: any) => setFontFamily(e.target.value)}
              className="p-1.5 border rounded-lg text-xs bg-transparent text-black dark:text-white"
            >
              <option value="sans">Sans</option>
              <option value="serif">Serif</option>
              <option value="mono">Mono</option>
            </select>

            {/* Font Size */}
            <div className="flex items-center border rounded-lg p-1">
              <button onClick={() => setFontSize(Math.max(14, fontSize - 2))} className="px-1.5 text-xs font-bold">A-</button>
              <span className="text-xs px-1">{fontSize}px</span>
              <button onClick={() => setFontSize(Math.min(28, fontSize + 2))} className="px-1.5 text-xs font-bold">A+</button>
            </div>

            {/* Theme Selector */}
            <div className="flex gap-1 border rounded-lg p-1">
              <button onClick={() => setTheme('light')} className={`p-1 rounded ${theme === 'light' ? 'bg-gray-200 text-black' : ''}`}>
                <Sun className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setTheme('sepia')} className={`p-1 rounded ${theme === 'sepia' ? 'bg-[#e2d5b7] text-black' : ''}`}>
                📖
              </button>
              <button onClick={() => setTheme('dark')} className={`p-1 rounded ${theme === 'dark' ? 'bg-gray-700 text-white' : ''}`}>
                <Moon className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* History Drawer Modal */}
      {showHistory && (
        <div className="max-w-4xl mx-auto p-4 border-b bg-gray-50 dark:bg-gray-800 transition-all">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-bold flex items-center gap-2 text-sm">
              <History className="w-4 h-4" /> ประวัติการอ่านล่าสุด ({history.length})
            </h3>
            {history.length > 0 && (
              <button onClick={clearHistory} className="text-xs text-red-500 flex items-center gap-1 hover:underline">
                <Trash2 className="w-3 h-3" /> ล้างประวัติ
              </button>
            )}
          </div>

          {history.length === 0 ? (
            <p className="text-xs text-gray-400 py-2">ยังไม่มีประวัติการอ่าน</p>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {history.map((item, index) => (
                <div key={index} className="flex justify-between items-center bg-white dark:bg-gray-700 p-2 rounded border text-xs gap-2">
                  <span className="truncate font-medium flex-1">{item.title}</span>
                  <button
                    onClick={() => {
                      setShowHistory(false);
                      fetchArticle(item.url);
                    }}
                    className="px-2 py-1 bg-blue-600 text-white rounded shrink-0"
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
          <div className="p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg mb-6 space-y-3">
            <p className="text-sm font-semibold">{error}</p>
            <button
              onClick={() => fetchArticle(url, true)}
              className="px-3 py-1.5 bg-red-600 text-white text-xs rounded hover:bg-red-700 flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" /> ลองใหม่ด้วยโหมดดึงข้อมูลลึก (Force Full Render)
            </button>
          </div>
        )}

        {article && (
          <article className="space-y-6">
            <div className="flex flex-col gap-4 border-b pb-4">
              <h1 className="text-2xl md:text-3xl font-bold leading-tight">
                {article.title}
              </h1>

              {/* Action Toolbar */}
              <div className="flex flex-wrap justify-between items-center gap-2 pt-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-md border"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'คัดลอกแล้ว!' : 'คัดลอกเนื้อหา'}
                  </button>

                  {/* Auto Scroll Controls */}
                  <button
                    onClick={() => setAutoScroll(!autoScroll)}
                    className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-md border ${
                      autoScroll ? 'bg-green-600 text-white' : 'bg-gray-100 dark:bg-gray-800'
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
                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-50 text-blue-600 rounded-md disabled:opacity-40 border border-blue-200"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" /> ตอนก่อนหน้า
                  </button>
                  <button
                    onClick={() => article.nextUrl && fetchArticle(article.nextUrl)}
                    disabled={!article.nextUrl || loading}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-600 text-white rounded-md disabled:opacity-40"
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
            <div className="flex justify-between items-center pt-8 border-t mt-10">
              <button
                onClick={() => article.prevUrl && fetchArticle(article.prevUrl)}
                disabled={!article.prevUrl || loading}
                className="flex items-center gap-1 px-4 py-2 text-sm bg-blue-50 text-blue-600 rounded-md disabled:opacity-40 border border-blue-200"
              >
                <ChevronLeft className="w-4 h-4" /> ตอนก่อนหน้า
              </button>
              <button
                onClick={() => article.nextUrl && fetchArticle(article.nextUrl)}
                disabled={!article.nextUrl || loading}
                className="flex items-center gap-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-md disabled:opacity-40"
              >
                ตอนถัดไป <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </article>
        )}

        {!article && !loading && !error && (
          <div className="text-center py-20 text-gray-400 text-sm">
            วาง URL ด้านบนเพื่อเริ่มอ่าน หรือเปิดเลือกเรื่องจากประวัติการอ่าน
          </div>
        )}
      </main>
    </div>
  );
}
