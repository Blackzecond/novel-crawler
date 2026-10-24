'use client';

import { useState } from 'react';
import { Sun, Moon, BookOpen, Loader2 } from 'lucide-react';

export default function ReaderPage() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [article, setArticle] = useState<{ title: string; content: string } | null>(null);
  const [error, setError] = useState('');
  
  const [fontSize, setFontSize] = useState(18);
  const [theme, setTheme] = useState<'light' | 'dark' | 'sepia'>('light');

  const handleFetch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    setLoading(true);
    setError('');
    setArticle(null);

    try {
      const res = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const rawText = await res.text().catch(() => '');
        throw new Error(`Server ตอบกลับเป็น HTML Error (${res.status}): ${rawText.slice(0, 100)}...`);
      }

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
      setArticle(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
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
          <form onSubmit={handleFetch} className="flex gap-2 w-full md:w-auto flex-1">
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
          <div className="p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">
            {error}
          </div>
        )}

        {article && (
          <article className="space-y-6">
            <h1 className="text-3xl md:text-4xl font-bold leading-tight border-b pb-4">
              {article.title}
            </h1>
            <div
              className="prose max-w-none leading-relaxed space-y-4"
              style={{ fontSize: `${fontSize}px`, lineHeight: '1.8' }}
              dangerouslySetInnerHTML={{ __html: article.content }}
            />
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
