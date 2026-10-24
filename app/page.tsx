'use client';

import { useState } from 'react';
import { Sun, Moon, BookOpen, Loader2, Copy, Check, ChevronLeft, ChevronRight } from 'lucide-react';

interface ArticleData {
  title: string;
  content: string;
  textContent: string;
  prevUrl: string | null;
  nextUrl: string | null;
}

export default function ReaderPage() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [article, setArticle] = useState<ArticleData | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  
  const [fontSize, setFontSize] = useState(18);
  const [theme, setTheme] = useState<'light' | 'dark' | 'sepia'>('light');

  const fetchArticle = async (targetUrl: string) => {
    if (!targetUrl) return;

    setLoading(true);
    setError('');
    setUrl(targetUrl);

    try {
      const res = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
      });

      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const rawText = await res.text().catch(() => '');
        throw new Error(`Server ตอบกลับผิดพลาด (${res.status}): ${rawText.slice(0, 100)}...`);
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');

      setArticle(data);
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
    // คัดลอกข้อความที่มี \n\n เว้นบรรทัดระหว่างย่อหน้าเหมือนต้นฉบับ
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

  return (
    <div className={`min-h-screen transition-colors duration-200 ${themeStyles[theme]}`}>
      <header className="sticky top-0 z-10 border-b backdrop-blur-md bg-opacity-80 p-4">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row gap-4 justify-between items-center">
          <form onSubmit={handleFormSubmit} className="flex gap-2 w-full md:w-auto flex-1">
            <input
              type="url"
              placeholder="วาง URL นิยายที่ต้องการอ่าน..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="flex-1 px-4 py-2 border rounded-lg text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              {loading ? <Loader2 className="animate-spin w-4 h-4" /> : <BookOpen className="w-4 h-4" />}
              ดึงเนื้อหา
            </button>
          </form>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1 border rounded-lg p-1">
              <button onClick={() => setFontSize(Math.max(14, fontSize - 2))} className="px-2 py-1 font-bold">A-</button>
              <span className="text-xs px-1">{fontSize}px</span>
              <button onClick={() => setFontSize(Math.min(28, fontSize + 2))} className="px-2 py-1 font-bold">A+</button>
            </div>

            <div className="flex gap-1 border rounded-lg p-1">
              <button onClick={() => setTheme('light')} className={`p-1.5 rounded ${theme === 'light' ? 'bg-gray-200 text-black' : ''}`} title="Light">
                <Sun className="w-4 h-4" />
              </button>
              <button onClick={() => setTheme('sepia')} className={`p-1.5 rounded ${theme === 'sepia' ? 'bg-[#e2d5b7] text-black' : ''}`} title="Sepia">
                📖
              </button>
              <button onClick={() => setTheme('dark')} className={`p-1.5 rounded ${theme === 'dark' ? 'bg-gray-700 text-white' : ''}`} title="Dark">
                <Moon className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        {error && (
          <div className="p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg mb-6">
            {error}
          </div>
        )}

        {article && (
          <article className="space-y-6">
            <div className="flex flex-col gap-4 border-b pb-4">
              <h1 className="text-3xl md:text-4xl font-bold leading-tight">
                {article.title}
              </h1>

              <div className="flex flex-wrap justify-between items-center gap-2 pt-2">
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 border"
                >
                  {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'คัดลอกแล้ว!' : 'คัดลอกเนื้อหา'}
                </button>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => article.prevUrl && fetchArticle(article.prevUrl)}
                    disabled={!article.prevUrl || loading}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-50 text-blue-600 rounded-md hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed border border-blue-200"
                  >
                    <ChevronLeft className="w-4 h-4" /> บทก่อนหน้า
                  </button>
                  <button
                    onClick={() => article.nextUrl && fetchArticle(article.nextUrl)}
                    disabled={!article.nextUrl || loading}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    บทถัดไป <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* แสดงผลย่อหน้าพร้อมเว้นระยะห่าง \n\n สบายตา */}
            <div
              className="prose max-w-none space-y-6 [&>p]:mb-6 [&>p]:leading-loose [&>p]:block"
              style={{ fontSize: `${fontSize}px` }}
              dangerouslySetInnerHTML={{ __html: article.content }}
            />

            <div className="flex justify-between items-center pt-8 border-t mt-10">
              <button
                onClick={() => article.prevUrl && fetchArticle(article.prevUrl)}
                disabled={!article.prevUrl || loading}
                className="flex items-center gap-1 px-4 py-2 bg-blue-50 text-blue-600 rounded-md hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed border border-blue-200"
              >
                <ChevronLeft className="w-4 h-4" /> บทก่อนหน้า
              </button>
              <button
                onClick={() => article.nextUrl && fetchArticle(article.nextUrl)}
                disabled={!article.nextUrl || loading}
                className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                บทถัดไป <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </article>
        )}

        {!article && !loading && !error && (
          <div className="text-center py-20 text-gray-400">
            วาง URL ด้านบนเพื่อเริ่มอ่านในโหมดคลีน
          </div>
        )}
      </main>
    </div>
  );
}
