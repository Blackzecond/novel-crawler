'use client';

import { useState, useEffect, useRef } from 'react';
import { 
  Sun, Moon, BookOpen, Loader2, Copy, Check, Pencil,
  ChevronLeft, ChevronRight, Play, Pause,
  History, RotateCcw, Trash2, Library, Settings, X, List, Sparkles, BookMarked, Plus,
} from 'lucide-react';
import { getStore, NovelChapter, NovelProject } from '@/lib/storage';
import { loadAiSettings, hasAiKey, detectNamedTerms, translateNovelText, editNovelTranslation } from '@/lib/ai';
import {
  loadReaderSettings, saveReaderSettings, applySavedTheme,
  readerDefaults, ReaderFont, ReaderTheme,
} from '@/lib/readerPrefs';
import {
  loadCloudReaderSettings, saveCloudReaderSettings,
  loadCloudReadingHistory, saveCloudReadingHistory,
} from '@/lib/cloudPreferences';
import DetectedGlossaryModal, { DetectedGlossaryItem } from '@/components/DetectedGlossaryModal';

interface ArticleData {
  title: string;
  content: string;
  textContent: string;
  translatedText?: string;
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
  const [currentChapterId, setCurrentChapterId] = useState<string | null>(null);
  const [translationBusy, setTranslationBusy] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const [translationError, setTranslationError] = useState('');
  const [showTranslation, setShowTranslation] = useState(false);
  const [readerProject, setReaderProject] = useState<NovelProject | null>(null);
  const chapterCacheRef = useRef<Map<string, ArticleData>>(new Map());
  const [showToc, setShowToc] = useState(false);
  const [showGlossary, setShowGlossary] = useState(false);
  const [glossaryNotice, setGlossaryNotice] = useState('');
  const [detectedGlossary, setDetectedGlossary] = useState<{ items: DetectedGlossaryItem[]; sourceLabel?: string } | null>(null);
  const [readerGlossaryZh, setReaderGlossaryZh] = useState('');
  const [readerGlossaryTh, setReaderGlossaryTh] = useState('');
  const [readerGlossaryType, setReaderGlossaryType] = useState<'character' | 'term'>('term');
  const [tocFilter, setTocFilter] = useState('');
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

  // โหลดค่าจากเครื่องก่อน แล้วซิงก์กับ Cloud เมื่อเข้าสู่ระบบ
  useEffect(() => {
    const localHistory: HistoryItem[] = (() => {
      try {
        const raw = localStorage.getItem('novel_history');
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch { return []; }
    })();
    const localSettings = loadReaderSettings();
    setHistory(localHistory);
    setFontSize(localSettings.fontSize);
    setFontFamily(localSettings.fontFamily);
    setTheme(localSettings.theme);
    document.documentElement.dataset.theme = localSettings.theme;

    void (async () => {
      try {
        const [cloudHistory, cloudSettings] = await Promise.all([
          loadCloudReadingHistory(),
          loadCloudReaderSettings(),
        ]);
        if (cloudHistory && cloudHistory.length > 0) {
          setHistory(cloudHistory);
          localStorage.setItem('novel_history', JSON.stringify(cloudHistory));
        } else if (localHistory.length > 0) {
          // First sync: preserve history that already exists on this device.
          await saveCloudReadingHistory(localHistory);
        }
        if (cloudSettings && Object.keys(cloudSettings).length > 0) {
          const merged = { ...localSettings, ...cloudSettings };
          setFontSize(merged.fontSize);
          setFontFamily(merged.fontFamily);
          setTheme(merged.theme);
          saveReaderSettings(merged);
          document.documentElement.dataset.theme = merged.theme;
        } else {
          await saveCloudReaderSettings(localSettings);
        }
      } catch (syncError) {
        console.warn('Could not sync reader preferences:', syncError);
      } finally {
        prefsHydratedRef.current = true;
      }
    })();
  }, []);

  // ซิงก์/บันทักธีมและค่าตั้งค่าทุกครั้งที่เปลี่ยน (ข้ามรอบแรกเพื่อไม่ทับค่าจำ)
  useEffect(() => {
    if (!prefsHydratedRef.current) return;
    document.documentElement.dataset.theme = theme;
    const settings = { fontSize, fontFamily, theme };
    saveReaderSettings(settings);
    void saveCloudReaderSettings(settings).catch((syncError) => console.warn('Could not sync reader settings:', syncError));
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
        window.scrollBy({ top: scrollSpeed, behavior: 'auto' });
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
    void saveCloudReadingHistory(newHistory).catch((syncError) => console.warn('Could not sync reading history:', syncError));
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem('novel_history');
    void saveCloudReadingHistory([]).catch((syncError) => console.warn('Could not clear cloud reading history:', syncError));
  };

  // Keep the current chapter in the address bar so refresh restores the chapter being read.
  const syncReaderUrl = (targetUrl: string, activeProjectId: string | null) => {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('url', targetUrl);
    if (activeProjectId) {
      nextUrl.searchParams.set('projectId', activeProjectId);
    } else {
      nextUrl.searchParams.delete('projectId');
    }
    window.history.replaceState(
      window.history.state,
      '',
      `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`,
    );
  };

  const fetchArticle = async (targetUrl: string, forceRender = false, projectIdOverride?: string | null) => {
    if (!targetUrl) return;
    const activeProjectId = projectIdOverride === undefined ? projectId : projectIdOverride;
    setLoading(true); setError(''); setUrl(targetUrl); setAutoScroll(false);
    const cacheKey = `${activeProjectId ?? 'standalone'}:${targetUrl}`;
    try {
      if (!forceRender) {
        const inMemoryArticle = chapterCacheRef.current.get(cacheKey);
        if (inMemoryArticle) {
          setArticle(inMemoryArticle);
          setTranslationError('');
          setShowTranslation(false);
          setCurrentChapterId(readerProject?.chapters.find((item) => item.url === targetUrl)?.id ?? null);
          syncReaderUrl(targetUrl, activeProjectId);
          saveToHistory(targetUrl, inMemoryArticle.title);
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }
      }

      let project: NovelProject | null = null;
      let chapter: NovelChapter | null = null;
      if (activeProjectId) {
        project = readerProject?.id === activeProjectId
          ? readerProject
          : await getStore().getProject(activeProjectId);
        if (project) {
          setReaderProject(project);
          chapter = project.chapters.find((item) => item.url === targetUrl) ?? null;
        }
      }
      if (!forceRender && activeProjectId && project && chapter && chapter.status !== 'pending') {
        const cached = await getStore().getChapterContent(activeProjectId, chapter.id, {
          includeOriginalText: true,
          includeTranslatedText: true,
        });
        if (cached?.readerContent !== undefined) {
          const index = project.chapters.findIndex((item) => item.url === targetUrl);
          const cachedArticle: ArticleData = {
            title: chapter.title, content: cached.readerContent,
            translatedText: cached.translatedText,
            textContent: cached.originalText ?? cached.readerContent.replace(/<[^>]*>/g, ' ').trim(),
            prevUrl: index > 0 ? project.chapters[index - 1].url : null,
            nextUrl: index >= 0 && index < project.chapters.length - 1 ? project.chapters[index + 1].url : null,
          };
          chapterCacheRef.current.set(cacheKey, cachedArticle);
          setCurrentChapterId(chapter.id);
          setTranslationError('');
          setShowTranslation(false);
          setArticle(cachedArticle);
          syncReaderUrl(targetUrl, activeProjectId);
          saveToHistory(targetUrl, cachedArticle.title);
          void getStore().updateProject(activeProjectId, { lastReadChapterId: chapter.id }).catch((progressError) => console.warn('Could not update last-read progress:', progressError));
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
        const index = project.chapters.findIndex((item) => item.url === targetUrl);
        articleData = { ...data, title: chapter.title || data.title,
          prevUrl: index > 0 ? project.chapters[index - 1].url : null,
          nextUrl: index >= 0 && index < project.chapters.length - 1 ? project.chapters[index + 1].url : null };
      }

      // Render first. Saving to Storage/DB runs in the background so network persistence
      // cannot hold the reader on its loading screen after parsing has succeeded.
      chapterCacheRef.current.set(cacheKey, articleData);
      setCurrentChapterId(chapter?.id ?? null);
      setTranslationError('');
      setShowTranslation(false);
      setArticle(articleData);
      syncReaderUrl(targetUrl, activeProjectId);

      if (activeProjectId && project && chapter) {
        void (async () => {
          try {
            const savedChapter = await getStore().updateChapter(activeProjectId, chapter.id, {
              url: chapter.url, title: chapter.title || data.title, order: chapter.order,
              originalText: data.textContent, readerContent: data.content, status: 'fetched', error: undefined,
            });
            if (savedChapter) {
              setReaderProject((current) => current?.id === activeProjectId ? {
                ...current,
                lastReadChapterId: savedChapter.id,
                chapters: current.chapters.map((item) => item.url === targetUrl
                  ? { ...item, id: savedChapter.id, status: savedChapter.status }
                  : item),
              } : current);
              await getStore().updateProject(activeProjectId, { lastReadChapterId: savedChapter.id });

              // In auto mode, detect glossary entries for chapters fetched directly in Reader too.
              if (project.glossaryMode === 'auto' && hasAiKey() && data.textContent) {
                try {
                  const pairs = await detectNamedTerms(data.textContent);
                  const latest = await getStore().getProject(activeProjectId);
                  if (latest) {
                    const glossary = { ...latest.glossary };
                    const glossaryTypes = { ...latest.glossaryTypes };
                    const added: typeof pairs = [];
                    for (const pair of pairs) {
                      if (!pair.zh || !pair.th || glossary[pair.zh] !== undefined) continue;
                      glossary[pair.zh] = pair.th;
                      glossaryTypes[pair.zh] = pair.type;
                      added.push(pair);
                    }
                    if (added.length) {
                      const updatedProject = await getStore().updateProject(activeProjectId, { glossary, glossaryTypes });
                      if (!updatedProject) throw new Error('บันทึกคลังศัพท์ไม่สำเร็จ');
                      setReaderProject(updatedProject);
                      const names = added.map((pair) => pair.zh + ' → ' + pair.th).join(', ');
                      setGlossaryNotice(`จับศัพท์อัตโนมัติและบันทึกแล้ว ${added.length} รายการจากบท “${chapter.title}”: ${names}`);
                      setDetectedGlossary({ items: added.map((pair) => ({ zh: pair.zh, th: pair.th, type: pair.type })), sourceLabel: chapter.title });
                    } else {
                      setGlossaryNotice(pairs.length ? 'จับศัพท์อัตโนมัติแล้ว แต่ไม่มีรายการใหม่ (คำเดิมไม่ถูกเพิ่มซ้ำ)' : 'จับศัพท์อัตโนมัติแล้ว — ไม่พบคำใหม่ในบทนี้');
                    }
                  }
                } catch (detectError) {
                  setGlossaryNotice(`จับศัพท์อัตโนมัติไม่สำเร็จ: ${detectError instanceof Error ? detectError.message : String(detectError)}`);
                }
              }
            }
          } catch (saveError) {
            console.warn('Could not save fetched chapter cache:', saveError);
          }
        })();
      }
      saveToHistory(targetUrl, articleData.title);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  };

  const handleTranslate = async () => {
    if (!article || translationBusy || editorBusy) return;
    const settings = loadAiSettings();
    if (!hasAiKey(settings)) {
      setTranslationError('ยังไม่ได้ตั้งค่า API สำหรับการแปล กรุณากรอก Base URL, Model และ API Key ก่อน');
      return;
    }
    setTranslationBusy(true);
    setTranslationError('');
    try {
      const latestProject = projectId ? await getStore().getProject(projectId) : null;
      const glossary = latestProject?.glossary ?? readerProject?.glossary ?? {};
      const translated = await translateNovelText(article.textContent, settings, glossary);
      const updatedArticle = { ...article, translatedText: translated };
      setArticle(updatedArticle);
      chapterCacheRef.current.set(`${projectId ?? 'standalone'}:${url}`, updatedArticle);
      setShowTranslation(true);

      // The translation is usable immediately; persistence failure must not hide it.
      if (projectId && currentChapterId) {
        try {
          const saved = await getStore().updateChapter(projectId, currentChapterId, {
            translatedText: translated,
            status: 'translated',
            error: undefined,
          });
          if (saved) {
            setReaderProject((current) => current?.id === projectId ? {
              ...current,
              chapters: current.chapters.map((item) => item.id === currentChapterId ? { ...item, status: 'translated' } : item),
            } : current);
          } else {
            setTranslationError('แปลสำเร็จแล้ว แต่ยังบันทึกคำแปลลงคลังไม่ได้ คำแปลนี้ยังแสดงอยู่ใน Reader');
          }
        } catch (saveError) {
          console.warn('Could not save translated chapter:', saveError);
          setTranslationError('แปลสำเร็จแล้ว แต่บันทึกคำแปลไม่สำเร็จ คำแปลนี้ยังแสดงอยู่ใน Reader');
        }
      }
    } catch (err) {
      setTranslationError(err instanceof Error ? err.message : 'แปลไม่สำเร็จ');
    } finally {
      setTranslationBusy(false);
    }
  };
  const handleEditTranslation = async () => {
    if (!article?.translatedText || editorBusy || translationBusy) return;
    const settings = loadAiSettings();
    if (!hasAiKey(settings)) {
      setTranslationError('ยังไม่ได้ตั้งค่า API สำหรับ AI บ.ก. กรุณาตั้งค่า API ก่อน');
      return;
    }
    setEditorBusy(true);
    setTranslationError('');
    try {
      const latestProject = projectId ? await getStore().getProject(projectId) : null;
      const glossary = latestProject?.glossary ?? readerProject?.glossary ?? {};
      const edited = await editNovelTranslation(article.textContent, article.translatedText, settings, glossary);
      const updatedArticle = { ...article, translatedText: edited };
      setArticle(updatedArticle);
      chapterCacheRef.current.set(`${projectId ?? 'standalone'}:${url}`, updatedArticle);
      setShowTranslation(true);

      if (projectId && currentChapterId) {
        try {
          const saved = await getStore().updateChapter(projectId, currentChapterId, {
            translatedText: edited,
            status: 'translated',
            error: undefined,
          });
          if (!saved) setTranslationError('AI บ.ก. ตรวจแก้แล้ว แต่บันทึกฉบับแก้ไขลงคลังไม่ได้');
        } catch (saveError) {
          console.warn('Could not save AI-edited chapter:', saveError);
          setTranslationError('AI บ.ก. ตรวจแก้แล้ว แต่บันทึกฉบับแก้ไขลงคลังไม่สำเร็จ');
        }
      }
    } catch (err) {
      setTranslationError(err instanceof Error ? err.message : 'AI บ.ก. ตรวจแก้ไม่สำเร็จ');
    } finally {
      setEditorBusy(false);
    }
  };

  const updateReaderGlossaryTerm = async (source: string, translated: string, type?: 'character' | 'term') => {
    if (!projectId) return;
    try {
      const latest = await getStore().getProject(projectId);
      if (!latest) throw new Error('ไม่พบโปรเจกต์');
      const glossary = { ...latest.glossary };
      const glossaryTypes = { ...latest.glossaryTypes };
      if (!translated.trim()) {
        delete glossary[source];
        delete glossaryTypes[source];
      } else {
        glossary[source] = translated.trim();
        if (type) glossaryTypes[source] = type;
      }
      const updated = await getStore().updateProject(projectId, { glossary, glossaryTypes });
      if (!updated) throw new Error('บันทึกคลังศัพท์ไม่สำเร็จ');
      setReaderProject(updated);
      setGlossaryNotice(`บันทึกแล้ว: ${source}${translated.trim() ? ' → ' + translated.trim() : ' (ลบออกแล้ว)'}`);
    } catch (err) {
      setGlossaryNotice(`บันทึกไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const saveDetectedGlossaryEdits = async (items: DetectedGlossaryItem[]) => {
    if (!projectId) return;
    const latest = await getStore().getProject(projectId);
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
    const updated = await getStore().updateProject(projectId, { glossary, glossaryTypes });
    if (!updated) throw new Error('บันทึกการแก้ไขคลังศัพท์ไม่สำเร็จ');
    setReaderProject(updated);
    setGlossaryNotice(`บันทึกการแก้ไขศัพท์แล้ว ${items.filter((item) => item.zh.trim() && item.th.trim()).length} รายการ`);
    setDetectedGlossary(null);
  };

  const addReaderGlossaryTerm = async () => {
    const source = readerGlossaryZh.trim();
    const translated = readerGlossaryTh.trim();
    if (!projectId || !source || !translated) return;
    try {
      const latest = await getStore().getProject(projectId);
      if (!latest) throw new Error('ไม่พบโปรเจกต์');
      const updated = await getStore().updateProject(projectId, {
        glossary: { ...latest.glossary, [source]: translated },
        glossaryTypes: { ...latest.glossaryTypes, [source]: readerGlossaryType },
      });
      if (!updated) throw new Error('บันทึกคลังศัพท์ไม่สำเร็จ');
      setReaderProject(updated);
      setReaderGlossaryZh('');
      setReaderGlossaryTh('');
      setGlossaryNotice(`เพิ่มและบันทึกแล้ว: ${source} → ${translated}`);
    } catch (err) {
      setGlossaryNotice(`เพิ่มศัพท์ไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const toggleReaderGlossary = async () => {
    const next = !showGlossary;
    setShowGlossary(next);
    if (next && projectId && !readerProject) {
      try {
        setReaderProject(await getStore().getProject(projectId));
      } catch (err) {
        setGlossaryNotice(err instanceof Error ? err.message : 'โหลดคลังศัพท์ไม่สำเร็จ');
      }
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchArticle(url);
  };

  const handleCopy = async () => {
    if (!article) return;
    const visibleText = showTranslation && article.translatedText ? article.translatedText : article.textContent.trim();
    const textToCopy = `${article.title}\n\n${visibleText}`;
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
            href={projectId ? `/project/${projectId}` : "/"}
            className="inline-flex items-center gap-1.5 h-8 pl-1 pr-2 rounded-lg text-sm text-muted hover:text-accent-soft-fg shrink-0 cursor-pointer transition-colors"
            title={projectId ? "กลับหน้าสารบัญนิยาย" : "กลับหน้าโปรเจกต์แปล"}
          >
            {projectId ? <List className="w-4 h-4" /> : <Library className="w-4 h-4" />}
            <span className="hidden sm:inline">{projectId ? 'กลับหน้าสารบัญ' : 'โปรเจกต์แปล'}</span>
          </a>

          <form onSubmit={handleFormSubmit} className="flex gap-2 flex-1 min-w-0">
            <input
              type="url"
              aria-label="URL นิยายที่ต้องการอ่าน"
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
            {projectId && (
              <button type="button" onClick={() => void toggleReaderGlossary()} title="เปิดคลังศัพท์ของเรื่องนี้" aria-label="เปิดคลังศัพท์"
                className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${showGlossary ? 'border-accent-line bg-accent-soft text-accent-soft-fg' : 'border-line text-muted hover:bg-card hover:text-fg'}`}>
                <BookMarked className="h-4 w-4" />
              </button>
            )}
            <a
              href="/settings/ai"
              title="ตั้งค่า AI สำหรับการแปล"
              aria-label="ตั้งค่า AI สำหรับการแปล"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:bg-card hover:text-fg"
            >
              <Sparkles className="w-4 h-4" />
            </a>
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
                aria-expanded={showSettings}
                aria-controls="reader-settings-panel"
                aria-label="การตั้งค่าการอ่าน"
                className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors cursor-pointer shrink-0 ${showSettings ? 'bg-accent-soft border-accent-line text-accent-soft-fg' : 'border-line text-muted hover:bg-card hover:text-fg'}`}
              >
                <Settings className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>
      {glossaryNotice && <div role="status" className="mx-auto max-w-3xl px-4 pt-3 text-xs leading-relaxed text-accent-soft-fg sm:px-6"><div className="rounded-lg border border-accent-line bg-accent-soft px-3 py-2"><BookMarked className="mr-1.5 inline h-3.5 w-3.5" />{glossaryNotice}</div></div>}

      {projectId && (
        <div className="max-w-3xl mx-auto px-3 sm:px-6 pt-2">
          <button type="button" onClick={async () => {
            const next = !showToc; setShowToc(next);
            if (next && !readerProject) { try { setReaderProject(await getStore().getProject(projectId)); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } }
          }} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-line bg-card text-xs hover:border-accent-line" aria-expanded={showToc}>
            <List className="w-3.5 h-3.5" /> สารบัญ{readerProject ? ` (${readerProject.chapters.length})` : ''}
          </button>
          {showToc && readerProject && (
            <div className="mt-2 rounded-xl border border-line bg-card shadow-sm overflow-hidden">
              <div className="p-2 border-b border-line bg-surface">
                <input aria-label="ค้นหาตอนในสารบัญ" value={tocFilter} onChange={(event) => setTocFilter(event.target.value)} placeholder="ค้นหาตอนในสารบัญ..." className="w-full h-9 px-3 rounded-lg border border-line bg-card text-sm focus:outline-none focus:ring-2 focus:ring-accent/60" />
              </div>
              <div className="max-h-[50vh] overflow-y-auto divide-y divide-line">
              {readerProject.chapters.filter((chapter) => !tocFilter.trim() || chapter.title.toLowerCase().includes(tocFilter.trim().toLowerCase())).map((chapter) => (
                <button key={chapter.url} type="button" onClick={() => { setShowToc(false); void fetchArticle(chapter.url); }}
                  className={`w-full text-left px-3 py-2.5 text-sm hover:bg-surface ${chapter.url === url ? 'bg-accent-soft text-accent-soft-fg font-semibold' : ''}`}>
                  <span className="mr-2 text-xs text-muted">{chapter.order + 1}.</span>{chapter.title}
                  {chapter.status !== 'pending' && <span className="ml-2 text-[10px] text-green-600">แคชแล้ว</span>}
                </button>
              ))}
              </div>
            </div>
          )}
        </div>
      )}
      {showGlossary && projectId && (
        <section className="border-b border-line bg-card">
          <div className="mx-auto max-w-3xl space-y-3 px-4 py-4 sm:px-6">
            <div className="flex items-center justify-between gap-2">
              <div><h2 className="flex items-center gap-2 text-sm font-bold"><BookMarked className="h-4 w-4 text-accent" />คลังศัพท์ของเรื่องนี้</h2>
                <p className="mt-1 text-[11px] text-muted">แยกตัวละครกับศัพท์เฉพาะ · แก้ไขแล้วบันทึกลงโปรเจกต์ทันที</p></div>
              <button type="button" onClick={() => setShowGlossary(false)} aria-label="ปิดคลังศัพท์" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface"><X className="h-4 w-4" /></button>
            </div>
            {!readerProject ? <p className="text-xs text-muted">กำลังโหลดคลังศัพท์…</p> : (
              <>
                {([
                  { type: 'character' as const, title: 'ตัวละคร' },
                  { type: 'term' as const, title: 'ศัพท์เฉพาะ' },
                ]).map((group) => {
                  const entries = Object.entries(readerProject.glossary).filter(([source]) =>
                    (readerProject.glossaryTypes?.[source] === 'character' ? 'character' : 'term') === group.type);
                  return <div key={group.type} className="space-y-1.5">
                    <h3 className="text-xs font-semibold">{group.title} ({entries.length})</h3>
                    {entries.length ? entries.map(([source, translated]) => (
                      <div key={source} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[minmax(0,0.8fr)_auto_minmax(0,1.5fr)_5rem_auto]">
                        <span lang="zh-CN" className="col-span-2 min-w-0 truncate text-xs font-medium sm:col-span-1">{source}</span>
                        <span className="hidden text-muted sm:inline">→</span>
                        <input key={source + ':' + translated} defaultValue={translated}
                          aria-label={`คำแปลของ ${source}`}
                          onBlur={(event) => { if (event.target.value.trim() !== translated) void updateReaderGlossaryTerm(source, event.target.value); }}
                          className="col-span-3 h-8 min-w-0 w-full rounded-lg border border-line bg-bg px-2 text-xs sm:col-span-1" />
                        <select value={readerProject.glossaryTypes?.[source] === 'character' ? 'character' : 'term'}
                          onChange={(event) => void updateReaderGlossaryTerm(source, translated, event.target.value as 'character' | 'term')}
                          aria-label={`ประเภทของ ${source}`} className="col-start-2 h-8 w-full min-w-0 rounded-lg border border-line bg-bg px-1 text-[11px] sm:col-auto sm:w-20">
                          <option value="character">ตัวละคร</option><option value="term">ศัพท์</option>
                        </select>
                        <button type="button" onClick={() => void updateReaderGlossaryTerm(source, '')} title="ลบศัพท์"
                          className="col-start-3 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-danger-bg hover:text-danger-fg sm:col-auto"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    )) : <p className="text-[11px] text-muted">ยังไม่มีรายการ</p>}
                  </div>;
                })}
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_7rem_auto]">
                  <input value={readerGlossaryZh} onChange={(event) => setReaderGlossaryZh(event.target.value)} placeholder="คำต้นฉบับจีน" className="h-9 min-w-0 rounded-lg border border-line bg-bg px-2 text-xs" />
                  <input value={readerGlossaryTh} onChange={(event) => setReaderGlossaryTh(event.target.value)} placeholder="คำแปลไทย" className="h-9 min-w-0 rounded-lg border border-line bg-bg px-2 text-xs" />
                  <select value={readerGlossaryType} onChange={(event) => setReaderGlossaryType(event.target.value as 'character' | 'term')} className="h-9 rounded-lg border border-line bg-bg px-2 text-xs">
                    <option value="character">ตัวละคร</option><option value="term">ศัพท์เฉพาะ</option>
                  </select>
                  <button type="button" disabled={!readerGlossaryZh.trim() || !readerGlossaryTh.trim()} onClick={() => void addReaderGlossaryTerm()}
                    className="inline-flex h-9 items-center justify-center gap-1 rounded-lg bg-accent px-3 text-xs font-medium text-accent-fg disabled:opacity-40"><Plus className="h-3.5 w-3.5" />เพิ่ม</button>
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {/* แผงการตั้งค่า — วางนอก <header> เพราะ backdrop-blur ทำ fixed คำนวณผิดที่:
          ยึดขอบล่างจอบนมือถือ, ปรากฏใต้ header มุมขวาบนเดสก์ท็อป */}
      {showSettings && (
        <div
          ref={settingsRef}
          id="reader-settings-panel"
          role="region"
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
          <div role="alert" className="p-4 bg-danger-bg border border-danger-line text-danger-fg rounded-xl mb-6 space-y-3">
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
              <div className="flex flex-nowrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <button type="button" onClick={handleCopy} aria-label={copied ? "คัดลอกแล้ว" : "คัดลอกเนื้อหา"} title={copied ? "คัดลอกแล้ว" : "คัดลอกเนื้อหา"} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-fg transition-colors hover:border-accent-line hover:bg-card">
                    {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                  </button>
                  <button type="button" onClick={handleTranslate} disabled={translationBusy} aria-label={translationBusy ? "กำลังแปล" : article.translatedText ? "แปลใหม่" : "แปลเป็นไทย"} title={translationBusy ? "กำลังแปล" : article.translatedText ? "แปลใหม่" : "แปลเป็นไทย"} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg transition-colors hover:brightness-110 disabled:opacity-50">
                    {translationBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  </button>
                  {article.translatedText && (
                    <>
                      <button type="button" onClick={() => setShowTranslation((value) => !value)} aria-label={showTranslation ? "ดูต้นฉบับ" : "ดูคำแปล"} title={showTranslation ? "ดูต้นฉบับ" : "ดูคำแปล"} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-fg transition-colors hover:border-accent-line hover:bg-card">
                        <BookOpen className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={handleEditTranslation}
                        disabled={editorBusy || translationBusy}
                        aria-label={editorBusy ? "AI บ.ก. กำลังตรวจแก้" : "AI บ.ก. ตรวจแก้คำแปล"}
                        title={editorBusy ? "AI บ.ก. กำลังตรวจแก้ทั้งตอน" : "AI บ.ก. ตรวจแก้คำแปลทั้งตอน (เรียกใช้เอง)"}
                        className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-accent-line bg-accent-soft px-2.5 text-xs font-medium text-accent-soft-fg transition-colors hover:brightness-105 disabled:opacity-50"
                      >
                        {editorBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
                        <span>AI บ.ก.</span>
                      </button>
                    </>
                  )}
                  <button type="button" onClick={() => setAutoScroll(!autoScroll)} aria-label={autoScroll ? "หยุดเลื่อนอัตโนมัติ" : "เลื่อนอัตโนมัติ"} title={autoScroll ? "หยุดเลื่อนอัตโนมัติ" : "เลื่อนอัตโนมัติ"} className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors ${autoScroll ? "border-transparent bg-green-600 text-white" : "border-line bg-surface text-fg hover:border-accent-line hover:bg-card"}`}>
                    {autoScroll ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </button>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button type="button" onClick={() => article.prevUrl && fetchArticle(article.prevUrl)} disabled={!article.prevUrl || loading} aria-label="ตอนก่อนหน้า" title="ตอนก่อนหน้า" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-accent-line bg-accent-soft text-accent-soft-fg transition-colors hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => article.nextUrl && fetchArticle(article.nextUrl)} disabled={!article.nextUrl || loading} aria-label="ตอนถัดไป" title="ตอนถัดไป" className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-fg transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            {translationError && (
              <div role="alert" className="rounded-lg border border-danger-line bg-danger-bg p-3 text-sm text-danger-fg">
                <p>{translationError}</p>
                <a href="/settings/ai" className="mt-2 inline-flex items-center gap-1 font-semibold underline underline-offset-2 hover:opacity-80">
                  เปิดหน้าตั้งค่า AI
                </a>
              </div>
            )}

            {/* Article Content Render */}
            {showTranslation && article.translatedText ? (
              <div className="space-y-6 leading-relaxed" style={{ fontSize: `${fontSize}px` }}>
                {article.translatedText.split(/\n\s*\n/).map((paragraph, index) => (
                  <p key={index} className="mb-6 whitespace-pre-wrap">{paragraph}</p>
                ))}
              </div>
            ) : (
              <div
                className="space-y-6 [&>p]:mb-6 [&>p]:block leading-relaxed"
                style={{ fontSize: `${fontSize}px` }}
                dangerouslySetInnerHTML={{ __html: article.content }}
              />
            )}

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
      {detectedGlossary && <DetectedGlossaryModal items={detectedGlossary.items} sourceLabel={detectedGlossary.sourceLabel} onClose={() => setDetectedGlossary(null)} onSave={saveDetectedGlossaryEdits} />}
    </div>
  );
}
