'use client';

import { useState, useEffect, useRef } from 'react';
import { 
  Sun, Moon, BookOpen, Loader2, Copy, Check, Pencil, MoreHorizontal,
  ChevronLeft, ChevronRight, Play, Pause,
  History, RotateCcw, Trash2, Library, Settings, X, List, Sparkles, BookMarked,
} from 'lucide-react';
import { getStore, NovelChapter, NovelProject } from '@/lib/storage';
import { applyWordReplacements, applyWordReplacementsToHtml } from '@/lib/wordReplacements';
import { loadAiSettings, hasAiKey, detectNamedTerms, translateNovelText, extractNovelMemory, inspectThaiTranslation, proofreadThaiFormatting, summarizeGeminiTranslationHistory } from '@/lib/ai';
import { findRelevantGlobalDictionaryTerms, loadGlobalDictionaryEntries } from '@/lib/globalDictionary';
import { loadNovelMemoryContext, loadTranslationInteractionId, saveTranslationInteractionId, loadTranslationInteractionState, saveTranslationCompaction, loadMemoryExtractionCheckpoint, loadNovelMemoryForExtraction, saveNovelMemoryGraph } from '@/lib/novelMemory';
import {
  loadReaderSettings, saveReaderSettings, applySavedTheme,
  readerDefaults, ReaderFont, ReaderTheme,
} from '@/lib/readerPrefs';
import {
  loadCloudReaderSettings, saveCloudReaderSettings,
  loadCloudReadingHistory, saveCloudReadingHistory,
} from '@/lib/cloudPreferences';
import DetectedGlossaryModal, { DetectedGlossaryItem } from '@/components/DetectedGlossaryModal';
import { fetchWithNativeBrowser, prefetchWithNativeBrowser, prefersNativeBrowser, rememberNativeBrowser } from '@/lib/nativeBrowserFetch';
import { escapeReaderText, isReaderTargetCurrent, isArticleTargetCurrent, mergeReadingHistory } from '@/lib/readerIntegrity.mjs';

interface ArticleData {
  title: string;
  content: string;
  textContent: string;
  translatedText?: string;
  preProofreadText?: string;
  prevUrl: string | null;
  nextUrl: string | null;
  /** Real Supabase chapter UUID once a catalog placeholder has been persisted. */
  chapterId?: string;
  sourceUrl?: string;
  projectId?: string | null;
}

interface HistoryItem {
  url: string;
  title: string;
  readAt: number;
  projectId?: string | null;
}

function readerErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    for (const key of ['message', 'error_description', 'details', 'hint']) {
      if (typeof value[key] === 'string' && value[key].trim()) return value[key] as string;
    }
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized;
    } catch { /* use the readable fallback below */ }
  }
  return fallback;
}

export default function ReaderPage() {
  const [url, setUrl] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [currentChapterId, setCurrentChapterId] = useState<string | null>(null);
  const [translationBusy, setTranslationBusy] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const [translationError, setTranslationError] = useState('');
  const [translationErrorAction, setTranslationErrorAction] = useState<'settings' | 'save' | null>(null);
  const [pendingTranslationSave, setPendingTranslationSave] = useState<{ projectId: string; chapterId: string; translatedText: string; preProofreadText: string } | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);
  const [readerProject, setReaderProject] = useState<NovelProject | null>(null);
  const chapterCacheRef = useRef<Map<string, ArticleData>>(new Map());
  const prefetchingRef = useRef<Set<string>>(new Set());
  const activeChapterUrlRef = useRef<string>('');
  const readerRequestRef = useRef(0);
  const activeProjectIdRef = useRef<string | null>(null);
  const historyRef = useRef<HistoryItem[]>([]);
  const historyWriteRef = useRef<Promise<void>>(Promise.resolve());
  const historyClearRef = useRef(0);
  const [showToc, setShowToc] = useState(false);
  const [showGlossary, setShowGlossary] = useState(false);
  const [glossaryNotice, setGlossaryNotice] = useState('');
  const [detectedGlossary, setDetectedGlossary] = useState<{ items: DetectedGlossaryItem[]; sourceLabel?: string; projectId?: string | null; chapterId?: string } | null>(null);
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
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [autoScroll, setAutoScroll] = useState(false);
  const [scrollSpeed, setScrollSpeed] = useState(1);
  const scrollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const settingsBtnRef = useRef<HTMLButtonElement | null>(null);

  // Warm the account-scoped global dictionary cache without delaying chapter rendering.
  useEffect(() => {
    void loadGlobalDictionaryEntries().catch((dictionaryError) => console.info('Global dictionary preload skipped:', dictionaryError));
  }, []);

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
    const initialHistoryClear = historyClearRef.current;
    historyRef.current = localHistory;
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
          const clearedWhileLoading = historyClearRef.current !== initialHistoryClear;
          const merged = clearedWhileLoading ? mergeReadingHistory(historyRef.current) : mergeReadingHistory(historyRef.current, cloudHistory);
          historyRef.current = merged; setHistory(merged);
          localStorage.setItem('novel_history', JSON.stringify(merged));
          historyWriteRef.current = historyWriteRef.current.catch(() => undefined).then(() => saveCloudReadingHistory(merged))
            .catch((syncError) => console.warn('Could not sync hydrated reading history:', syncError));
        } else if (historyRef.current.length > 0) {
          const merged = mergeReadingHistory(historyRef.current);
          historyRef.current = merged; setHistory(merged);
          historyWriteRef.current = historyWriteRef.current.catch(() => undefined).then(() => saveCloudReadingHistory(merged));
          await historyWriteRef.current;
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

  useEffect(() => {
    if (!showMoreMenu) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowMoreMenu(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showMoreMenu]);

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

  const saveToHistory = (itemUrl: string, itemTitle: string, itemProjectId: string | null = projectId) => {
    const newHistory = mergeReadingHistory([{ url: itemUrl, title: itemTitle, readAt: Date.now(), projectId: itemProjectId }, ...historyRef.current]);
    historyRef.current = newHistory; setHistory(newHistory);
    localStorage.setItem('novel_history', JSON.stringify(newHistory));
    historyWriteRef.current = historyWriteRef.current.catch(() => undefined).then(() => saveCloudReadingHistory(newHistory))
      .catch((syncError) => console.warn('Could not sync reading history:', syncError));
  };

  const clearHistory = () => {
    historyClearRef.current++;
    historyRef.current = []; setHistory([]);
    localStorage.removeItem('novel_history');
    historyWriteRef.current = historyWriteRef.current.catch(() => undefined).then(() => saveCloudReadingHistory([]))
      .catch((syncError) => console.warn('Could not clear cloud reading history:', syncError));
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
    if (typeof window !== 'undefined') setShowTranslation(window.localStorage.getItem(`novel_reader_edition:${activeProjectId ?? 'standalone'}`) === 'translation');
    const requestId = ++readerRequestRef.current;
    const isCurrentRequest = () => isReaderTargetCurrent(
      { requestId: readerRequestRef.current, url: activeChapterUrlRef.current, projectId: activeProjectIdRef.current },
      { requestId, url: targetUrl, projectId: activeProjectId },
    );
    setShowMoreMenu(false);
    activeChapterUrlRef.current = targetUrl;
    activeProjectIdRef.current = activeProjectId;
    if (projectId !== activeProjectId) {
      setDetectedGlossary(null); setGlossaryNotice('');
    }
    setTranslationBusy(false); setEditorBusy(false);
    setLoading(true); setError(''); setUrl(targetUrl); setAutoScroll(false);
    const cacheKey = `${activeProjectId ?? 'standalone'}:${targetUrl}`;
    if (forceRender) chapterCacheRef.current.delete(cacheKey);
    try {
      if (!forceRender) {
        const inMemoryArticle = chapterCacheRef.current.get(cacheKey);
        if (inMemoryArticle && (!activeProjectId || readerProject?.id === activeProjectId)) {
          setArticle(inMemoryArticle);
          setTranslationError('');
          const memoryChapter = readerProject?.chapters.find((item) => item.url === targetUrl);
          const cachedChapterId = inMemoryArticle.chapterId
            ?? (memoryChapter && !memoryChapter.id.startsWith('catalog:') ? memoryChapter.id : null);
          // A catalog placeholder is not a database UUID; do not treat it as a
          // persisted chapter while ensureChapter is still pending.
          if (activeProjectId && !cachedChapterId) {
            chapterCacheRef.current.delete(cacheKey);
          } else {
            setCurrentChapterId(cachedChapterId);
          }
          if (!activeProjectId) setReaderProject(null);
          if (activeProjectId && memoryChapter && !memoryChapter.id.startsWith('catalog:')) {
            void getStore().updateProject(activeProjectId, { lastReadChapterId: cachedChapterId ?? memoryChapter.id })
              .catch((progressError) => console.warn('Could not update last-read progress:', progressError));
          }
          if (!(activeProjectId && !cachedChapterId)) {
            setProjectId(activeProjectId);
            syncReaderUrl(targetUrl, activeProjectId);
            saveToHistory(targetUrl, inMemoryArticle.title, activeProjectId);
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return;
          }
        }
      }

      let project: NovelProject | null = null;
      let chapter: NovelChapter | null = null;
      if (activeProjectId) {
        project = readerProject?.id === activeProjectId
          ? readerProject
          : await getStore().getProject(activeProjectId);
        if (!isCurrentRequest()) return;
        if (project) {
          chapter = project.chapters.find((item) => item.url === targetUrl) ?? null;
        }
      }
      if (!forceRender && activeProjectId && project && chapter && chapter.status !== 'pending') {
        const cached = await getStore().getChapterContent(activeProjectId, chapter.id, {
          includeOriginalText: true,
          includeTranslatedText: true,
        });
        if (!isCurrentRequest()) return;
        if (cached && (cached.readerContent !== undefined || cached.originalText !== undefined)) {
          const index = project.chapters.findIndex((item) => item.url === targetUrl);
          const cachedHtml = cached.readerContent ?? (cached.originalText ?? '').split(/\n{2,}/).map((paragraph: string) => `<p>${escapeReaderText(paragraph).replace(/\n/g, '<br>')}</p>`).join('');
          const cachedArticle: ArticleData = {
            title: chapter.title, chapterId: chapter.id, sourceUrl: targetUrl, projectId: activeProjectId, content: cachedHtml,
            translatedText: cached.translatedText,
            preProofreadText: cached.preProofreadText,
            textContent: cached.originalText ?? (cached.readerContent ?? '').replace(/<[^>]*>/g, ' ').trim(),
            prevUrl: index > 0 ? project.chapters[index - 1].url : null,
            nextUrl: index >= 0 && index < project.chapters.length - 1 ? project.chapters[index + 1].url : null,
          };
          chapterCacheRef.current.set(cacheKey, cachedArticle);
          setProjectId(activeProjectId);
          setReaderProject(project);
          setCurrentChapterId(chapter.id);
          setTranslationError('');

          setArticle(cachedArticle);
          syncReaderUrl(targetUrl, activeProjectId);
          saveToHistory(targetUrl, cachedArticle.title, activeProjectId);
          void getStore().updateProject(activeProjectId, { lastReadChapterId: chapter.id }).catch((progressError) => console.warn('Could not update last-read progress:', progressError));
          if (index === project.chapters.length - 1) {
            // Recheck a cached final chapter in the background for newly published next chapters.
            void fetch('/api/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: targetUrl }) })
              .then(async (response) => response.ok ? response.json() : null)
              .then((fresh) => {
                if (!fresh?.nextUrl) return;
                const refreshed = { ...cachedArticle, nextUrl: fresh.nextUrl };
                chapterCacheRef.current.set(cacheKey, refreshed);
                if (isCurrentRequest()) setArticle((current) => current?.chapterId === chapter.id ? refreshed : current);
              }).catch((refreshError) => console.info('Final chapter navigation refresh skipped:', refreshError));
          }
          window.scrollTo({ top: 0, behavior: 'smooth' }); return;
        }
      }
      const parseNativePage = async (nativePage: { url: string; html: string } | null) => {
        if (!nativePage) return null;
        const fallbackRes = await fetch('/api/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: targetUrl, pageUrl: nativePage.url, html: nativePage.html }),
        });
        const fallbackData = await fallbackRes.json().catch(() => ({}));
        if (!fallbackRes.ok) {
          const fallbackError = new Error(fallbackData.error || 'อ่านเนื้อหาจากหน้าเว็บไม่สำเร็จ') as Error & { status?: number; code?: string };
          fallbackError.status = fallbackRes.status;
          fallbackError.code = fallbackData.code;
          throw fallbackError;
        }
        if (activeProjectId) rememberNativeBrowser(activeProjectId);
        return fallbackData;
      };

      // Once this project has passed CAPTCHA in the app WebView, prefer that same
      // app-private cookie session for later chapters. Server fetches cannot read
      // Android WebView cookies and would otherwise trigger a fresh challenge each time.
      let data = null;
      if (activeProjectId && prefersNativeBrowser(activeProjectId)) {
        try {
          const nativePage = await prefetchWithNativeBrowser(targetUrl);
          if (nativePage) data = await parseNativePage(nativePage);
        } catch (nativePrefetchError) {
          console.info('Native session prefetch needs visible verification:', nativePrefetchError);
        }
        if (!data) {
          const visiblePage = await fetchWithNativeBrowser(targetUrl);
          if (!visiblePage) throw new Error('ไม่สามารถเปิด WebView เพื่อดึงเนื้อหาใหม่ได้');
          data = await parseNativePage(visiblePage);
        }
      }

      // Before the app has a verified WebView session, try direct fetch first.
      // Confirmed challenges use the visible WebView; transport errors may use its
      // hidden instance, which shares the same Android CookieManager.
      if (!data) {
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
          const payload = await res.json();
          if (!res.ok) {
            const apiError = new Error(payload.error || 'เกิดข้อผิดพลาด') as Error & { status?: number; code?: string };
            apiError.status = res.status;
            apiError.code = payload.code;
            throw apiError;
          }
          data = payload;
        } catch (serverError) {
          const failure = serverError as Error & { status?: number; code?: string };
          let nativePage = null;
          if (failure.code === 'WEBVIEW_REQUIRED' || failure.status === 428) {
            nativePage = await fetchWithNativeBrowser(targetUrl);
          } else if (failure.code === 'DIRECT_FETCH_FAILED') {
            nativePage = await prefetchWithNativeBrowser(targetUrl);
          } else {
            throw serverError;
          }
          if (!nativePage) throw serverError;
          try {
            const nativeData = await parseNativePage(nativePage);
            if (!nativeData) throw serverError;
            data = nativeData;
          } catch (nativeError) {
            const nativeFailure = nativeError as Error & { status?: number; code?: string };
            if (nativeFailure.code !== 'WEBVIEW_REQUIRED' && nativeFailure.status !== 428) throw nativeError;
            const visiblePage = await fetchWithNativeBrowser(targetUrl);
            if (!visiblePage) throw nativeError;
            data = await parseNativePage(visiblePage);
          }
        }
      }
      if (!isCurrentRequest()) return;
      let articleData: ArticleData = {
        ...data,
        sourceUrl: targetUrl,
        projectId: activeProjectId,
        chapterId: chapter && !chapter.id.startsWith('catalog:') ? chapter.id : undefined,
      };
      if (activeProjectId && project && chapter) {
        const index = project.chapters.findIndex((item) => item.url === targetUrl);
        articleData = { ...articleData, title: chapter.title || data.title,
          prevUrl: index > 0 ? project.chapters[index - 1].url : data.prevUrl ?? null,
          nextUrl: index >= 0 && index < project.chapters.length - 1 ? project.chapters[index + 1].url : data.nextUrl ?? null };
      }

      // Render first. Saving to Storage/DB runs in the background so network persistence
      // cannot hold the reader on its loading screen after parsing has succeeded.
      chapterCacheRef.current.set(cacheKey, articleData);
      setProjectId(activeProjectId);
      setReaderProject(project);
      setCurrentChapterId(chapter?.id && !chapter.id.startsWith('catalog:') ? chapter.id : null);
      setTranslationError('');

      setArticle(articleData);
      syncReaderUrl(targetUrl, activeProjectId);

      if (activeProjectId && project) {
        void (async () => {
          try {
            const previousChapter = data.prevUrl
              ? project!.chapters.find((item) => item.url === data.prevUrl)
              : undefined;
            const previousArticle = data.prevUrl
              ? chapterCacheRef.current.get(`${activeProjectId}:${data.prevUrl}`)
              : undefined;
            const precedingChapter = previousArticle?.prevUrl
              ? project!.chapters.find((item) => item.url === previousArticle.prevUrl)
              : undefined;
            const followingChapter = data.nextUrl
              ? project!.chapters.find((item) => item.url === data.nextUrl)
              : undefined;
            const nextOrder = previousChapter
              ? previousChapter.order + 1
              : precedingChapter
                ? precedingChapter.order + 2
                : followingChapter
                  ? followingChapter.order - 1
                  : Math.max(-1, ...project!.chapters.map((item) => item.order)) + 1;
            const ensuredChapter = await getStore().ensureChapter(activeProjectId, {
              url: targetUrl,
              title: chapter?.title || data.title || 'ไม่มีชื่อบท',
              order: chapter?.order ?? nextOrder,
            });
            if (!ensuredChapter) throw new Error('ไม่สามารถเพิ่มบทเข้าโปรเจกต์ได้');
            const savedChapter = await getStore().updateChapter(activeProjectId, ensuredChapter.id, {
              url: targetUrl,
              title: chapter?.title || data.title,
              order: ensuredChapter.order,
              originalText: data.textContent,
              readerContent: data.content,
              // A forced re-fetch may replace corrupted source content; discard any
              // translation tied to the previous body instead of showing stale text.
              ...(forceRender ? { translatedText: '', preProofreadText: '' } : {}),
              status: 'fetched',
              error: undefined,
            });
            if (!savedChapter) throw new Error('บันทึกเนื้อหาบทไม่สำเร็จ');
            if (!isCurrentRequest()) return;
            // A translation can finish while the source-save callback is still running.
            // Merge only the real UUID into the latest cache/UI object; never replace a
            // newer translated draft with the stale articleData captured before the save.
            const latestCachedArticle = chapterCacheRef.current.get(cacheKey) ?? articleData;
            const savedArticle = { ...latestCachedArticle, chapterId: savedChapter.id };
            chapterCacheRef.current.set(cacheKey, savedArticle);
            if (activeChapterUrlRef.current === targetUrl && activeProjectIdRef.current === activeProjectId) {
              setCurrentChapterId(savedChapter.id);
              setArticle((current) => current && current.sourceUrl === targetUrl
                && (current.projectId ?? null) === (activeProjectId ?? null)
                ? { ...current, chapterId: savedChapter.id }
                : current);
            }
            setReaderProject((current) => current?.id === activeProjectId ? {
              ...current,
              lastReadChapterId: savedChapter.id,
              chapters: [
                ...current.chapters.filter((item) => item.url !== targetUrl),
                savedChapter,
              ].sort((a, b) => a.order - b.order),
            } : current);
            await getStore().updateProject(activeProjectId, { lastReadChapterId: savedChapter.id });

            // In auto mode, detect glossary entries for chapters fetched directly in Reader too.
            if ((project!.glossaryDetection?.characters || project!.glossaryDetection?.terms) && hasAiKey() && data.textContent) {
              try {
                const pairs = await detectNamedTerms(data.textContent, undefined, project!.glossaryDetection);
                if (!isCurrentRequest()) return;
                const latest = await getStore().getProject(activeProjectId);
                if (!isCurrentRequest()) return;
                if (latest) {
                  const glossary = { ...latest.glossary };
                  const glossaryTypes = { ...latest.glossaryTypes };
                  const glossaryMetadata = { ...(latest.glossaryMetadata ?? {}) };
                  const added: typeof pairs = [];
                  for (const pair of pairs) {
                    if (!pair.zh || !pair.th || glossary[pair.zh] !== undefined) continue;
                    glossary[pair.zh] = pair.th;
                    glossaryTypes[pair.zh] = pair.type;
                    glossaryMetadata[pair.zh] = pair.type === 'character' ? { gender: pair.gender ?? 'unknown', notes: '' } : { category: pair.category ?? 'other', notes: '' };
                    added.push(pair);
                  }
                  if (added.length) {
                    const updatedProject = await getStore().updateProject(activeProjectId, { glossary, glossaryTypes, glossaryMetadata });
                    if (!updatedProject) throw new Error('บันทึกคลังศัพท์ไม่สำเร็จ');
                    if (!isCurrentRequest()) return;
                    setReaderProject((current) => current?.id === activeProjectId ? updatedProject : current);
                    
                    setGlossaryNotice(`เพิ่มศัพท์ ${added.length} คำจากบท “${savedChapter.title}”`);
                    
                  } else if (isCurrentRequest()) {
                    setGlossaryNotice(pairs.length ? 'จับศัพท์อัตโนมัติแล้ว แต่ไม่มีรายการใหม่ (คำเดิมไม่ถูกเพิ่มซ้ำ)' : 'จับศัพท์อัตโนมัติแล้ว — ไม่พบคำใหม่ในบทนี้');
                  }
                }
              } catch (detectError) {
                if (isCurrentRequest()) setGlossaryNotice(`จับศัพท์อัตโนมัติไม่สำเร็จ: ${detectError instanceof Error ? detectError.message : String(detectError)}`);
              }
            }
          } catch (saveError) {
            console.warn('Could not save fetched chapter cache:', saveError);
          }
        })();
      }
      saveToHistory(targetUrl, articleData.title, activeProjectId);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      if (isCurrentRequest()) {
        setError(readerErrorMessage(err, 'อ่านบทไม่สำเร็จ กรุณาลองอีกครั้ง'));
        setLoading(false);
        if (article?.sourceUrl) {
          setUrl(article.sourceUrl);
          activeChapterUrlRef.current = article.sourceUrl;
          activeProjectIdRef.current = article.projectId !== undefined ? article.projectId : projectId;
        }
      }
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  };

  // Quietly fetch one chapter ahead. This path never opens WebView or blocks the reader.
  const prefetchNextChapter = async (
    targetUrl: string,
    activeProjectId: string | null,
    projectSnapshot: NovelProject | null,
    previousUrl: string,
  ) => {
    if (!targetUrl) return;
    const cacheKey = `${activeProjectId ?? 'standalone'}:${targetUrl}`;
    if (chapterCacheRef.current.has(cacheKey) || prefetchingRef.current.has(cacheKey)) return;

    let project = projectSnapshot;
    if (activeProjectId && (!project || project.id !== activeProjectId)) {
      try { project = await getStore().getProject(activeProjectId); } catch { return; }
    }
    let chapter = project?.chapters.find((item) => item.url === targetUrl) ?? null;
    if (chapter && chapter.status !== 'pending') return;

    prefetchingRef.current.add(cacheKey);
    try {
      let data: any = null;
      const preferNative = Boolean(activeProjectId && prefersNativeBrowser(activeProjectId));

      // Once this project has needed the app WebView, keep auto-prefetch on that
      // same cookie session. Never fall back to server fetch from this path.
      if (preferNative) {
        try {
          const nativePage = await prefetchWithNativeBrowser(targetUrl);
          if (nativePage) {
            const nativeRes = await fetch('/api/parse', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                url: targetUrl,
                pageUrl: nativePage.url,
                html: nativePage.html,
              }),
            });
            const contentType = nativeRes.headers.get('content-type');
            const payload = contentType?.includes('application/json')
              ? await nativeRes.json()
              : null;
            if (nativeRes.ok && payload?.content && payload?.textContent) {
              data = payload;
              if (activeProjectId) rememberNativeBrowser(activeProjectId);
            } else if (payload?.code === 'WEBVIEW_REQUIRED' || nativeRes.status === 428) {
              if (activeProjectId) rememberNativeBrowser(activeProjectId);
            }
          }
        } catch (nativePrefetchError) {
          console.info('Next chapter WebView prefetch skipped; interactive verification will be available when opened:', nativePrefetchError);
        }
        if (!data) return;
      } else {
        let serverError: unknown = null;
        try {
          const res = await fetch('/api/parse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: targetUrl }),
          });
          const contentType = res.headers.get('content-type');
          if (!contentType?.includes('application/json')) {
            throw new Error(`Server fetch failed: HTTP ${res.status}`);
          }
          const payload = await res.json();
          if (!res.ok) {
            const apiError = new Error(payload.error || `Server fetch failed: ${res.status}`) as Error & { status?: number; code?: string };
            apiError.status = res.status;
            apiError.code = payload.code;
            throw apiError;
          }
          const candidate = payload;
          if (typeof candidate?.content !== 'string' || !candidate.content.trim()
            || typeof candidate?.textContent !== 'string' || !candidate.textContent.trim()) {
            throw new Error('Server returned an empty chapter');
          }
          data = candidate;
        } catch (error) {
          serverError = error;
        }

        if (!data) {
          const failure = serverError as Error & { status?: number; code?: string };
          if (failure.code !== 'WEBVIEW_REQUIRED' && failure.code !== 'DIRECT_FETCH_FAILED'
            && failure.status !== 428) {
            if (serverError) console.info('Next chapter prefetch skipped:', serverError);
            return;
          }

          // A confirmed CAPTCHA is enough to switch this project to the WebView
          // strategy immediately, even if hidden capture cannot clear it.
          if (failure.code === 'WEBVIEW_REQUIRED' || failure.status === 428) {
            if (activeProjectId) rememberNativeBrowser(activeProjectId);
          }

          try {
            const nativePage = await prefetchWithNativeBrowser(targetUrl);
            if (!nativePage) {
              if (serverError) console.info('Next chapter prefetch skipped:', serverError);
              return;
            }
            const nativeRes = await fetch('/api/parse', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                url: targetUrl,
                pageUrl: nativePage.url,
                html: nativePage.html,
              }),
            });
            const contentType = nativeRes.headers.get('content-type');
            const payload = contentType?.includes('application/json')
              ? await nativeRes.json()
              : null;
            if (!nativeRes.ok || !payload?.content || !payload?.textContent) {
              if (payload?.code === 'WEBVIEW_REQUIRED' || nativeRes.status === 428) {
                if (activeProjectId) rememberNativeBrowser(activeProjectId);
              }
              return;
            }
            data = payload;
            if (activeProjectId) rememberNativeBrowser(activeProjectId);
          } catch (nativePrefetchError) {
            console.info('Next chapter hidden WebView prefetch skipped:', nativePrefetchError);
            return;
          }
        }
      }

      if (activeProjectId && project) {
        const previousChapter = project.chapters.find((item) => item.url === previousUrl)
          ?? (data.prevUrl ? project.chapters.find((item) => item.url === data.prevUrl) : undefined);
        const previousArticle = chapterCacheRef.current.get(`${activeProjectId}:${previousUrl}`);
        const precedingChapter = previousArticle?.prevUrl
          ? project.chapters.find((item) => item.url === previousArticle.prevUrl)
          : undefined;
        const followingChapter = data.nextUrl
          ? project.chapters.find((item) => item.url === data.nextUrl)
          : undefined;
        const nextOrder = previousChapter
          ? previousChapter.order + 1
          : precedingChapter
            ? precedingChapter.order + 2
            : followingChapter
              ? followingChapter.order - 1
              : Math.max(-1, ...project.chapters.map((item) => item.order)) + 1;
        const ensured = await getStore().ensureChapter(activeProjectId, {
          url: targetUrl,
          title: chapter?.title || data.title || 'ไม่มีชื่อบท',
          order: chapter?.order ?? nextOrder,
        });
        if (!ensured) throw new Error('ไม่สามารถเพิ่มบทที่ดึงล่วงหน้าเข้าโปรเจกต์ได้');
        chapter = ensured;
        project = await getStore().getProject(activeProjectId) ?? project;
      }

      const chapterIndex = project?.chapters.findIndex((item) => item.url === targetUrl) ?? -1;
      const prefetchedArticle: ArticleData = {
        ...data,
        sourceUrl: targetUrl,
        projectId: activeProjectId,
        chapterId: chapter && !chapter.id.startsWith('catalog:') ? chapter.id : undefined,
        title: chapter?.title || data.title,
        prevUrl: chapterIndex > 0 ? project!.chapters[chapterIndex - 1].url : data.prevUrl ?? null,
        nextUrl: chapterIndex >= 0 && chapterIndex < (project?.chapters.length ?? 0) - 1
          ? project!.chapters[chapterIndex + 1].url
          : data.nextUrl ?? null,
      };
      let cacheableArticle = prefetchedArticle;
      if (activeProjectId && project && chapter) {
        const saved = await getStore().updateChapter(activeProjectId, chapter.id, {
          url: chapter.url,
          title: chapter.title || data.title,
          order: chapter.order,
          originalText: data.textContent,
          readerContent: data.content,
          status: 'fetched',
          error: undefined,
        });
        if (!saved) throw new Error('บันทึกเนื้อหาบทที่ดึงล่วงหน้าไม่สำเร็จ');
        cacheableArticle = { ...prefetchedArticle, chapterId: saved.id };
        setReaderProject((current) => current?.id === activeProjectId ? {
          ...current,
          chapters: [
            ...current.chapters.filter((item) => item.url !== targetUrl),
            saved,
          ].sort((a, b) => a.order - b.order),
        } : current);
      }
      // Cache only after persistence succeeds, and keep the real UUID beside content.
      chapterCacheRef.current.set(cacheKey, cacheableArticle);
    } catch (prefetchError) {
      console.info('Next chapter prefetch skipped:', prefetchError);
    } finally {
      prefetchingRef.current.delete(cacheKey);
    }
  };

  // Start fetching the next chapter as soon as the current chapter is available.
  useEffect(() => {
    if (loading || !article?.nextUrl || !article.sourceUrl) return;
    // The article owns its project identity. Do not combine its nextUrl with
    // projectId/url state from a different navigation render.
    if (!isArticleTargetCurrent(article, projectId, url)) return;
    const articleProjectId = article.projectId ?? null;
    const matchingProject = readerProject?.id === articleProjectId ? readerProject : null;
    void prefetchNextChapter(article.nextUrl, articleProjectId, matchingProject, article.sourceUrl);
  }, [loading, article?.nextUrl, article?.sourceUrl, article?.projectId, projectId, readerProject, url]);

  const handleTranslate = async () => {
    if (!article || loading || translationBusy || editorBusy || !isArticleTargetCurrent(article, projectId, url)) return;
    const settings = loadAiSettings();
    if (!hasAiKey(settings)) {
      setTranslationError('ยังไม่ได้ตั้งค่า API สำหรับการแปล กรุณากรอก Base URL, Model และ API Key ก่อน');
      setTranslationErrorAction('settings');
      return;
    }
    const translationRequestId = readerRequestRef.current;
    const targetProjectId = projectId;
    let targetChapterId = article.chapterId ?? currentChapterId;
    const targetUrl = url;
    let targetArticle = article;
    const isActiveTranslation = () => isReaderTargetCurrent(
      { requestId: readerRequestRef.current, url: activeChapterUrlRef.current, projectId: activeProjectIdRef.current },
      { requestId: translationRequestId, url: targetUrl, projectId: targetProjectId },
    );
    setTranslationBusy(true);
    setTranslationError('');
    setTranslationErrorAction(null);
    setPendingTranslationSave(null);
    try {
      const latestProject = targetProjectId ? await getStore().getProject(targetProjectId) : null;
      if (!isActiveTranslation()) return;
      if (targetProjectId && !targetChapterId) {
        const catalogChapter = latestProject?.chapters.find((item) => item.url === targetUrl);
        const nextOrder = catalogChapter?.order ?? Math.max(-1, ...(latestProject?.chapters ?? []).map((item) => item.order)) + 1;
        const ensured = await getStore().ensureChapter(targetProjectId, { url: targetUrl, title: targetArticle.title, order: nextOrder });
        if (!ensured) throw new Error('ไม่สามารถเตรียมรหัสบทก่อนบันทึกคำแปลได้');
        if (!isActiveTranslation()) return;
        targetChapterId = ensured.id; targetArticle = { ...targetArticle, chapterId: ensured.id };
        setCurrentChapterId(ensured.id);
        setArticle((current) => current && activeChapterUrlRef.current === targetUrl ? { ...current, chapterId: ensured.id } : current);
        chapterCacheRef.current.set(`${targetProjectId}:${targetUrl}`, targetArticle);
      }
      const glossary = latestProject?.glossary ?? readerProject?.glossary ?? {};
      const replacements = latestProject?.wordReplacements ?? readerProject?.wordReplacements ?? [];
      const sourceText = applyWordReplacements(targetArticle.textContent, replacements);
      const dictionaryTerms = await findRelevantGlobalDictionaryTerms(sourceText, glossary).catch((dictionaryError) => {
        console.warn('Global dictionary matching skipped:', dictionaryError);
        return [];
      });
      const graphMemoryContext = targetProjectId
        ? await loadNovelMemoryContext(targetProjectId, sourceText).catch((memoryError) => {
            console.warn('Novel memory retrieval skipped:', memoryError);
            return '';
          })
        : '';
      const conversationState = targetProjectId && settings.baseUrl.toLowerCase().includes('generativelanguage.googleapis.com')
        ? await loadTranslationInteractionState(targetProjectId, settings.model).catch((stateError) => {
            console.warn('Could not load Gemini conversation summary:', stateError);
            return { interactionId: undefined, count: 0, summary: '' };
          })
        : { interactionId: undefined, count: 0, summary: '' };
      const memoryContext = [
        conversationState.summary ? '[สรุปบริบทการแปลก่อนหน้า]\n' + conversationState.summary : '',
        graphMemoryContext,
      ].filter(Boolean).join('\n\n');
      const previousInteractionId = targetProjectId && settings.baseUrl.toLowerCase().includes('generativelanguage.googleapis.com')
        ? (conversationState.interactionId ?? await loadTranslationInteractionId(targetProjectId, settings.model).catch((stateError) => {
            console.warn('Could not load Gemini interaction state:', stateError);
            return undefined;
          }))
        : undefined;
      let nextInteractionId: string | undefined;
      const rawTranslated = applyWordReplacements(await translateNovelText(sourceText, settings, glossary, dictionaryTerms, {
        previousInteractionId,
        memoryContext,
        translationProfile: latestProject?.translationProfile ?? 'general',
        storeInteraction: Boolean(targetProjectId),
        onInteractionId: (id) => { nextInteractionId = id; },
      }), replacements);
      if (targetProjectId && nextInteractionId && settings.baseUrl.toLowerCase().includes('generativelanguage.googleapis.com')) {
        const chapterOrder = latestProject?.chapters.find((item) => item.id === targetChapterId)?.order;
        await saveTranslationInteractionId(targetProjectId, settings.model, nextInteractionId, chapterOrder)
          .catch((stateError) => console.warn('Could not save Gemini interaction state:', stateError));
      }

      // ตรวจอักขระในเครื่องก่อน: คำแปลไทยที่สะอาดไม่ต้องเสีย API call ครั้งที่สอง
      const initialInspection = inspectThaiTranslation(rawTranslated);
      let translated = rawTranslated;
      let preProofreadText = '';
      let proofreadWarning = '';
      if (!initialInspection.passed) {
        preProofreadText = rawTranslated;
        try {
          // ส่งให้ AI บ.ก. เฉพาะคำแปลไทยเท่านั้น ไม่ส่งต้นฉบับจีน Glossary หรือ Memory
          const candidate = applyWordReplacements(await proofreadThaiFormatting(rawTranslated, settings), replacements);
          if (inspectThaiTranslation(candidate).passed) {
            translated = candidate;
          } else {
            proofreadWarning = 'AI บ.ก. ตรวจแล้วแต่ยังพบอักขระที่ไม่ผ่านการตรวจ จึงแสดงคำแปลฉบับเดิมเพื่อป้องกันเนื้อหาเพี้ยน';
          }
        } catch (proofreadError) {
          console.warn('Automatic formatting proofread failed:', proofreadError);
          proofreadWarning = 'AI บ.ก. ตรวจรูปแบบไม่สำเร็จ จึงแสดงคำแปลฉบับเดิม';
        }
      }

      const updatedArticle = { ...targetArticle, translatedText: translated, preProofreadText: preProofreadText || undefined };
      chapterCacheRef.current.set(`${targetProjectId ?? 'standalone'}:${targetUrl}`, updatedArticle);
      if (isActiveTranslation()) { setArticle(updatedArticle); selectReaderEdition(true); }

      if (targetProjectId && targetChapterId) {
        try {
          const saved = await getStore().updateChapter(targetProjectId, targetChapterId, {
            translatedText: translated,
            preProofreadText,
            status: 'translated',
            error: undefined,
          });
          if (saved) {
            setReaderProject((current) => current?.id === targetProjectId && isActiveTranslation() ? {
              ...current,
              chapters: current.chapters.map((item) => item.id === targetChapterId
                ? { ...item, status: 'translated', preProofreadText }
                : item),
            } : current);

            // Build durable memory in batches of five translated chapters, not on every chapter.
            try {
              const provider = settings.baseUrl.toLowerCase().includes('generativelanguage.googleapis.com')
                ? 'gemini'
                : settings.baseUrl.toLowerCase().includes('maas.aliyuncs.com') || settings.baseUrl.toLowerCase().includes('dashscope')
                  ? 'qwen'
                  : 'custom';
              const memoryProject = await getStore().getProject(targetProjectId);
              const checkpoint = await loadMemoryExtractionCheckpoint(targetProjectId, provider, settings.model);
              const pendingChapters = (memoryProject?.chapters ?? [])
                .filter((item) => item.status === 'translated' && item.order <= saved.order && (checkpoint === null || item.order > checkpoint))
                .sort((a, b) => a.order - b.order)
                .slice(0, 5);
              if (pendingChapters.length === 5) {
                const memorySources = await Promise.all(pendingChapters.map(async (item) => {
                  const content = await getStore().getChapterContent(targetProjectId, item.id, {
                    includeOriginalText: true,
                    includeTranslatedText: false,
                  });
                  return { order: item.order, title: item.title, sourceText: content?.originalText ?? '' };
                }));
                if (memorySources.every((item) => item.sourceText.trim())) {
                  const existingMemory = await loadNovelMemoryForExtraction(targetProjectId);
                  const extracted = await extractNovelMemory(memorySources, existingMemory, settings);
                  await saveNovelMemoryGraph(targetProjectId, provider, settings.model, pendingChapters[4].order, extracted);
                  if (provider === 'gemini') {
                    const state = await loadTranslationInteractionState(targetProjectId, settings.model);
                    if (state.count >= 10 && state.interactionId) {
                      // สร้าง summary ต่อจาก chain เก่าก่อน แล้วค่อยบันทึก ID ใหม่และ reset counter
                      const compacted = await summarizeGeminiTranslationHistory(
                        state.interactionId, state.summary, await loadNovelMemoryForExtraction(targetProjectId), settings,
                      );
                      await saveTranslationCompaction(targetProjectId, settings.model, compacted.summary, compacted.interactionId);
                    }
                  }
                }
              }
            } catch (memoryUpdateError) {
              console.warn('Batched novel memory update skipped:', memoryUpdateError);
            }
          } else if (isActiveTranslation()) {
            setTranslationError('แปลสำเร็จแล้ว แต่ยังบันทึกคำแปลลงคลังไม่ได้');
            setTranslationErrorAction('save');
            setPendingTranslationSave({ projectId: targetProjectId, chapterId: targetChapterId, translatedText: translated, preProofreadText });
          }
        } catch (saveError) {
          console.warn('Could not save translated chapter:', saveError);
          if (isActiveTranslation()) {
            setTranslationError('แปลสำเร็จแล้ว แต่บันทึกคำแปลไม่สำเร็จ');
            setTranslationErrorAction('save');
            if (targetChapterId) setPendingTranslationSave({ projectId: targetProjectId, chapterId: targetChapterId, translatedText: translated, preProofreadText });
          }
        }
      }
      if (proofreadWarning && isActiveTranslation()) { setTranslationError(proofreadWarning); setTranslationErrorAction(null); }
    } catch (err) {
      if (isActiveTranslation()) { setTranslationError(err instanceof Error ? err.message : 'แปลไม่สำเร็จ'); setTranslationErrorAction(null); }
    } finally { if (isActiveTranslation()) setTranslationBusy(false); }
  };
  const retrySaveTranslation = async () => {
    const pending = pendingTranslationSave;
    if (!pending || !article || !isArticleTargetCurrent(article, projectId, url)
      || pending.projectId !== projectId || pending.chapterId !== (article.chapterId ?? currentChapterId)) return;
    const requestId = readerRequestRef.current;
    const targetUrl = url;
    const isCurrent = () => isReaderTargetCurrent(
      { requestId: readerRequestRef.current, url: activeChapterUrlRef.current, projectId: activeProjectIdRef.current },
      { requestId, url: targetUrl, projectId: pending.projectId },
    );
    setEditorBusy(true);
    try {
      const saved = await getStore().updateChapter(pending.projectId, pending.chapterId, {
        translatedText: pending.translatedText,
        preProofreadText: pending.preProofreadText,
        status: 'translated',
        error: undefined,
      });
      if (!saved) throw new Error('บันทึกคำแปลไม่สำเร็จ');
      if (!isCurrent()) return;
      setReaderProject((current) => current?.id === pending.projectId ? {
        ...current,
        chapters: current.chapters.map((chapter) => chapter.id === pending.chapterId
          ? { ...chapter, status: 'translated', translatedText: pending.translatedText, preProofreadText: pending.preProofreadText }
          : chapter),
      } : current);
      setPendingTranslationSave(null);
      setTranslationErrorAction(null);
      setTranslationError('');
    } catch (saveError) {
      if (isCurrent()) setTranslationError(saveError instanceof Error ? saveError.message : 'บันทึกคำแปลไม่สำเร็จ');
    } finally {
      if (isCurrent()) setEditorBusy(false);
    }
  };

  const handleRestorePreProofread = async () => {
    if (!article?.preProofreadText || loading || !isArticleTargetCurrent(article, projectId, url)) return;
    const targetArticle = article, targetProjectId = projectId, targetUrl = url, requestId = readerRequestRef.current;
    const isActive = () => isReaderTargetCurrent({ requestId: readerRequestRef.current, url: activeChapterUrlRef.current, projectId: activeProjectIdRef.current }, { requestId, url: targetUrl, projectId: targetProjectId });
    const restored = targetArticle.preProofreadText;
    try {
      let chapterId = targetArticle.chapterId ?? currentChapterId;
      if (targetProjectId && !chapterId) {
        const project = await getStore().getProject(targetProjectId); const chapter = project?.chapters.find((item) => item.url === targetUrl);
        const ensured = await getStore().ensureChapter(targetProjectId, { url: targetUrl, title: targetArticle.title, order: chapter?.order ?? Math.max(-1, ...(project?.chapters ?? []).map((item) => item.order)) + 1 });
        if (!ensured) throw new Error('ไม่สามารถเตรียมรหัสบทเพื่อคืนฉบับก่อนตรวจได้'); chapterId = ensured.id;
      }
      if (targetProjectId && chapterId) {
        const saved = await getStore().updateChapter(targetProjectId, chapterId, { translatedText: restored, preProofreadText: '', status: 'translated', error: undefined });
        if (!saved) throw new Error('บันทึกฉบับก่อนตรวจไม่สำเร็จ');
      }
      const updatedArticle = { ...targetArticle, chapterId: chapterId ?? undefined, translatedText: restored, preProofreadText: undefined };
      chapterCacheRef.current.set(`${targetProjectId ?? 'standalone'}:${targetUrl}`, updatedArticle);
      if (isActive()) { setCurrentChapterId(chapterId ?? null); setArticle(updatedArticle); setShowTranslation(true); }
      if (targetProjectId && chapterId) setReaderProject((current) => current?.id === targetProjectId && isActive() ? { ...current, chapters: current.chapters.map((item) => item.id === chapterId ? { ...item, status: 'translated', translatedText: restored, preProofreadText: undefined } : item) } : current);
    } catch (restoreError) { if (isActive()) setTranslationError('คืนฉบับก่อนตรวจไม่สำเร็จ: ' + (restoreError instanceof Error ? restoreError.message : String(restoreError))); }
  };

  const handleEditTranslation = async () => {
    if (!article?.translatedText || loading || editorBusy || translationBusy || !isArticleTargetCurrent(article, projectId, url)) return;
    const settings = loadAiSettings();
    if (!hasAiKey(settings)) {
      setTranslationError('ยังไม่ได้ตั้งค่า API สำหรับ AI บ.ก. กรุณาตั้งค่า API ก่อน');
      setTranslationErrorAction('settings');
      return;
    }
    const targetArticle = article, targetProjectId = projectId, targetUrl = url, requestId = readerRequestRef.current;
    const isActive = () => isReaderTargetCurrent({ requestId: readerRequestRef.current, url: activeChapterUrlRef.current, projectId: activeProjectIdRef.current }, { requestId, url: targetUrl, projectId: targetProjectId });
    setEditorBusy(true); setTranslationError(''); setTranslationErrorAction(null);
    try {
      const originalDraft = targetArticle.translatedText ?? '';
      if (!originalDraft) return;
      const edited = await proofreadThaiFormatting(originalDraft, settings);
      let targetChapterId = targetArticle.chapterId ?? currentChapterId;
      if (targetProjectId && !targetChapterId) {
        const project = await getStore().getProject(targetProjectId); const chapter = project?.chapters.find((item) => item.url === targetUrl);
        const ensured = await getStore().ensureChapter(targetProjectId, { url: targetUrl, title: targetArticle.title, order: chapter?.order ?? Math.max(-1, ...(project?.chapters ?? []).map((item) => item.order)) + 1 });
        if (!ensured) throw new Error('ไม่สามารถเตรียมรหัสบทก่อนบันทึกผล AI บ.ก. ได้'); targetChapterId = ensured.id;
      }
      const updatedArticle = { ...targetArticle, chapterId: targetChapterId ?? undefined, translatedText: edited, preProofreadText: targetArticle.preProofreadText ?? originalDraft };
      chapterCacheRef.current.set(`${targetProjectId ?? 'standalone'}:${targetUrl}`, updatedArticle);
      if (targetProjectId && targetChapterId) {
        const saved = await getStore().updateChapter(targetProjectId, targetChapterId, { translatedText: edited, preProofreadText: updatedArticle.preProofreadText, status: 'translated', error: undefined });
        if (!saved) throw new Error('AI บ.ก. ตรวจรูปแบบแล้ว แต่บันทึกฉบับแก้ไขลงคลังไม่ได้');
      }
      if (isActive()) { setCurrentChapterId(targetChapterId ?? null); setArticle(updatedArticle); setShowTranslation(true); }
      if (targetProjectId && targetChapterId) setReaderProject((current) => current?.id === targetProjectId && isActive() ? { ...current, chapters: current.chapters.map((item) => item.id === targetChapterId ? { ...item, status: 'translated', preProofreadText: updatedArticle.preProofreadText } : item) } : current);
    } catch (err) { if (isActive()) { setTranslationError(err instanceof Error ? err.message : 'AI บ.ก. ตรวจรูปแบบไม่สำเร็จ'); setTranslationErrorAction(null); } }
    finally { if (isActive()) setEditorBusy(false); }
  };

  const updateReaderGlossaryTerm = async (source: string, translated: string, type?: 'character' | 'term') => {
    const targetProjectId = projectId, targetUrl = url, requestId = readerRequestRef.current;
    const isActive = () => isReaderTargetCurrent({ requestId: readerRequestRef.current, url: activeChapterUrlRef.current, projectId: activeProjectIdRef.current }, { requestId, url: targetUrl, projectId: targetProjectId });
    if (!targetProjectId || loading) return;
    try {
      const latest = await getStore().getProject(targetProjectId);
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
      const updated = await getStore().updateProject(targetProjectId, { glossary, glossaryTypes });
      if (!updated) throw new Error('บันทึกคลังศัพท์ไม่สำเร็จ');
      setReaderProject((current) => current?.id === targetProjectId ? updated : current);
      if (isActive()) setGlossaryNotice(`บันทึกแล้ว: ${source}${translated.trim() ? ' → ' + translated.trim() : ' (ลบออกแล้ว)'}`);
    } catch (err) {
      if (isActive()) setGlossaryNotice(`บันทึกไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const saveDetectedGlossaryEdits = async (items: DetectedGlossaryItem[]) => {
    const targetProjectId = detectedGlossary?.projectId ?? projectId;
    const targetModalChapterId = detectedGlossary?.chapterId;
    const targetModalSourceLabel = detectedGlossary?.sourceLabel;
    if (!targetProjectId) return;
    const latest = await getStore().getProject(targetProjectId);
    if (!latest) throw new Error('ไม่พบโปรเจกต์');
    const glossary = { ...latest.glossary };
    const glossaryTypes = { ...latest.glossaryTypes };
    const glossaryMetadata = { ...(latest.glossaryMetadata ?? {}) };
    const validItems = items.filter((item) => item.zh.trim() && item.th.trim());
    const retainedSources = new Set(validItems.map((item) => item.zh.trim()));
    for (const original of detectedGlossary?.items ?? []) {
      if (!retainedSources.has(original.zh)) {
        delete glossary[original.zh];
        delete glossaryTypes[original.zh];
        delete glossaryMetadata[original.zh];
      }
    }
    for (const item of validItems) {
      const zh = item.zh.trim(); const th = item.th.trim();
      glossary[zh] = th;
      glossaryTypes[zh] = item.type;
      glossaryMetadata[zh] = item.type === 'character' ? { gender: item.gender ?? 'unknown', notes: item.notes ?? '' } : { category: item.category ?? 'other', notes: item.notes ?? '' };
    }
    const updated = await getStore().updateProject(targetProjectId, { glossary, glossaryTypes, glossaryMetadata });
    if (!updated) throw new Error('บันทึกการแก้ไขคลังศัพท์ไม่สำเร็จ');
    setReaderProject((current) => current?.id === targetProjectId ? updated : current);
    if (activeProjectIdRef.current === targetProjectId) setGlossaryNotice(`บันทึกการแก้ไขศัพท์แล้ว ${items.filter((item) => item.zh.trim() && item.th.trim()).length} รายการ`);
    setDetectedGlossary((current) => current?.projectId === targetProjectId && current?.chapterId === targetModalChapterId && current?.sourceLabel === targetModalSourceLabel ? null : current);
  };

  const addReaderGlossaryTerm = async () => {
    const source = readerGlossaryZh.trim();
    const translated = readerGlossaryTh.trim();
    const targetProjectId = projectId, targetUrl = url, requestId = readerRequestRef.current;
    const isActive = () => isReaderTargetCurrent({ requestId: readerRequestRef.current, url: activeChapterUrlRef.current, projectId: activeProjectIdRef.current }, { requestId, url: targetUrl, projectId: targetProjectId });
    if (!targetProjectId || !source || !translated || loading) return;
    try {
      const latest = await getStore().getProject(targetProjectId);
      if (!latest) throw new Error('ไม่พบโปรเจกต์');
      const updated = await getStore().updateProject(targetProjectId, {
        glossary: { ...latest.glossary, [source]: translated },
        glossaryTypes: { ...latest.glossaryTypes, [source]: readerGlossaryType },
      });
      if (!updated) throw new Error('บันทึกคลังศัพท์ไม่สำเร็จ');
      setReaderProject((current) => current?.id === targetProjectId ? updated : current);
      if (isActive()) { setReaderGlossaryZh(''); setReaderGlossaryTh(''); setGlossaryNotice(`เพิ่มและบันทึกแล้ว: ${source} → ${translated}`); }
    } catch (err) {
      if (isActive()) setGlossaryNotice(`เพิ่มศัพท์ไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const toggleReaderGlossary = () => {
    if (projectId) window.location.href = `/project/${encodeURIComponent(projectId)}/glossary`;
  };

  const selectReaderEdition = (translated: boolean) => {
    setShowTranslation(translated);
    if (typeof window !== 'undefined') {
      const key = `novel_reader_edition:${activeProjectIdRef.current ?? projectId ?? 'standalone'}`;
      window.localStorage.setItem(key, translated ? 'translation' : 'original');
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchArticle(url);
  };

  const handleCopy = async () => {
    if (!article) return;
    const rules = readerProject?.wordReplacements ?? [];
    const visibleText = showTranslation && article.translatedText ? applyWordReplacements(article.translatedText, rules) : applyWordReplacements(article.textContent.trim(), rules);
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

  const readerReturnTo = projectId && url
    ? `/read?projectId=${encodeURIComponent(projectId)}&url=${encodeURIComponent(url)}`
    : url ? `/read?url=${encodeURIComponent(url)}` : '/read';

  return (
    <div className={`min-h-screen bg-bg text-fg transition-colors duration-200`}>
      {/* Header Bar — บางเบา คุมสูงตายตัว */}
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur-md">
        <div className="max-w-[44rem] mx-auto flex items-center gap-2 h-14 px-3 sm:px-5">
          <a
            href={projectId ? `/project/${projectId}` : "/"}
            className="inline-flex items-center gap-1.5 h-8 pl-1 pr-2 rounded-lg text-sm text-muted hover:text-accent-soft-fg shrink-0 cursor-pointer transition-colors"
            title={projectId ? "กลับหน้าสารบัญนิยาย" : "กลับหน้าโปรเจกต์แปล"}
          >
            {projectId ? <List className="w-4 h-4" /> : <Library className="w-4 h-4" />}
            <span className="hidden sm:inline">{projectId ? 'กลับหน้าสารบัญ' : 'โปรเจกต์แปล'}</span>
          </a>



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
      </header>
      {glossaryNotice && <div role="status" className="mx-auto max-w-[44rem] px-5 pt-3 text-xs leading-relaxed text-accent-soft-fg"><div className="flex items-center justify-between gap-3 rounded-lg border border-accent-line bg-accent-soft px-3 py-2"><span><BookMarked className="mr-1.5 inline h-3.5 w-3.5" />{glossaryNotice}</span>{projectId && <a href={`/project/${encodeURIComponent(projectId)}/glossary`} className="shrink-0 font-semibold underline underline-offset-2">ตรวจดู</a>}</div></div>}

      {projectId && (
        <div className="max-w-[44rem] mx-auto px-5 pt-2">
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
      {showGlossary && projectId && null}

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
          <div className="max-w-[44rem] mx-auto px-5 py-3">
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
                        fetchArticle(item.url, false, item.projectId ?? null);
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
      <main className="max-w-[40rem] mx-auto px-5 py-6 sm:py-8">
        {error && (
          <div role="alert" className="p-4 bg-danger-bg border border-danger-line text-danger-fg rounded-xl mb-6 space-y-3">
            <p className="text-sm font-semibold">{error}</p>
            <button
              onClick={() => fetchArticle(url, true)}
              className="h-9 px-3 bg-danger-fg text-white text-xs font-medium rounded-lg hover:brightness-110 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" /> ดึงเนื้อหาใหม่
            </button>
          </div>
        )}

        {article && (
          <article className="space-y-5">
            <div className="space-y-4 border-b border-line pb-5">
              <h1 className={`text-2xl sm:text-3xl font-bold leading-tight ${fontClasses[fontFamily]}`}>{article.title}</h1>

              {/* Reader controls: edition switching never invokes translation. */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {article.translatedText ? (
                    <div role="group" aria-label="ฉบับเนื้อหา" className="inline-flex rounded-xl border border-line bg-surface p-1">
                      <button type="button" onClick={() => selectReaderEdition(false)} aria-pressed={!showTranslation} className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${!showTranslation ? 'bg-card text-fg shadow-sm' : 'text-muted hover:text-fg'}`}>ต้นฉบับ</button>
                      <button type="button" onClick={() => selectReaderEdition(true)} aria-pressed={showTranslation} className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${showTranslation ? 'bg-card text-fg shadow-sm' : 'text-muted hover:text-fg'}`}>คำแปลไทย</button>
                    </div>
                  ) : (
                    <button type="button" onClick={handleTranslate} disabled={translationBusy} className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-fg hover:brightness-110 disabled:opacity-50">
                      {translationBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      {translationBusy ? 'กำลังแปล…' : 'แปลเป็นไทย'}
                    </button>
                  )}
                  <button type="button" onClick={handleCopy} aria-label={copied ? "คัดลอกแล้ว" : "คัดลอกเนื้อหา"} title="คัดลอกเนื้อหา" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-fg hover:bg-card">
                    {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                  </button>
                  <button type="button" onClick={() => setAutoScroll(!autoScroll)} aria-label={autoScroll ? "หยุดเลื่อนอัตโนมัติ" : "เลื่อนอัตโนมัติ"} title={autoScroll ? "หยุดเลื่อนอัตโนมัติ" : "เลื่อนอัตโนมัติ"} className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${autoScroll ? "border-transparent bg-green-600 text-white" : "border-line bg-surface text-fg hover:bg-card"}`}>
                    {autoScroll ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </button>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button type="button" onClick={() => setShowMoreMenu((value) => !value)} aria-expanded={showMoreMenu} aria-label="การทำงานเพิ่มเติม" className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border ${showMoreMenu ? 'border-accent-line bg-accent-soft text-accent-soft-fg' : 'border-line bg-surface text-muted hover:bg-card'}`}>
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => article.prevUrl && fetchArticle(article.prevUrl)} disabled={!article.prevUrl || loading} aria-label="ตอนก่อนหน้า" className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface text-fg disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                  <button type="button" onClick={() => article.nextUrl && fetchArticle(article.nextUrl)} disabled={!article.nextUrl || loading} aria-label="ตอนถัดไป" className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-fg disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
                </div>
              </div>
              {showMoreMenu && (
                <div className="rounded-xl border border-line bg-card p-2 shadow-sm" role="menu" aria-label="การทำงานเพิ่มเติม">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <button type="button" role="menuitem" onClick={() => { setShowMoreMenu(false); void fetchArticle(url, true); }} disabled={loading} className="rounded-lg border border-line px-3 py-2.5 text-left text-xs hover:bg-surface disabled:opacity-50"><RotateCcw className="mb-1 h-4 w-4" />ดึงต้นฉบับใหม่</button>
                    {article.translatedText && <button type="button" role="menuitem" onClick={() => { setShowMoreMenu(false); void handleTranslate(); }} disabled={translationBusy} className="rounded-lg border border-line px-3 py-2.5 text-left text-xs hover:bg-surface disabled:opacity-50"><Sparkles className="mb-1 h-4 w-4" />แปลใหม่และแทนที่คำแปลเดิม</button>}
                    {article.translatedText && <button type="button" role="menuitem" onClick={() => { setShowMoreMenu(false); void handleEditTranslation(); }} disabled={editorBusy || translationBusy} className="rounded-lg border border-line px-3 py-2.5 text-left text-xs hover:bg-surface disabled:opacity-50"><Pencil className="mb-1 h-4 w-4" />AI บ.ก. ตรวจคำแปล</button>}
                    {article.preProofreadText && <button type="button" role="menuitem" onClick={() => { setShowMoreMenu(false); void handleRestorePreProofread(); }} className="rounded-lg border border-line px-3 py-2.5 text-left text-xs hover:bg-surface"><RotateCcw className="mb-1 h-4 w-4" />คืนฉบับก่อนตรวจ</button>}
                    <a role="menuitem" href={`/settings/ai?returnTo=${encodeURIComponent(readerReturnTo)}`} className="rounded-lg border border-line px-3 py-2.5 text-left text-xs hover:bg-surface"><Sparkles className="mb-1 h-4 w-4" />ตั้งค่า AI</a>
                    <button type="button" role="menuitem" onClick={() => { setShowMoreMenu(false); setShowHistory(true); }} className="rounded-lg border border-line px-3 py-2.5 text-left text-xs hover:bg-surface"><History className="mb-1 h-4 w-4" />ประวัติการอ่าน</button>
                    {projectId && <button type="button" role="menuitem" onClick={() => { setShowMoreMenu(false); void toggleReaderGlossary(); }} className="rounded-lg border border-line px-3 py-2.5 text-left text-xs hover:bg-surface"><BookMarked className="mb-1 h-4 w-4" />ศัพท์ของเรื่องนี้</button>}
                    <a role="menuitem" href="/dictionary" className="rounded-lg border border-line px-3 py-2.5 text-left text-xs hover:bg-surface"><Library className="mb-1 h-4 w-4" />พจนานุกรมพื้นฐาน</a>
                  </div>
                </div>
              )}
            </div>

            {translationError && (
              <div role="alert" className="rounded-lg border border-danger-line bg-danger-bg p-3 text-sm text-danger-fg">
                <p>{translationError}</p>
              {translationErrorAction === 'settings' && <a href={`/settings/ai?returnTo=${encodeURIComponent(readerReturnTo)}`} className="mt-2 inline-flex items-center gap-1 font-semibold underline underline-offset-2 hover:opacity-80">เปิดหน้าตั้งค่า AI</a>}
              {translationErrorAction === 'save' && pendingTranslationSave && <button type="button" onClick={() => void retrySaveTranslation()} disabled={editorBusy} className="mt-2 inline-flex items-center gap-1 font-semibold underline underline-offset-2 hover:opacity-80 disabled:opacity-50">{editorBusy ? 'กำลังบันทึก…' : 'บันทึกคำแปลอีกครั้ง'}</button>}
              </div>
            )}

            {/* Article Content Render */}
            {showTranslation && article.translatedText ? (
              <div className={`space-y-4 leading-[1.75] ${fontClasses[fontFamily]}`} style={{ fontSize: `${fontSize}px` }}>
                {article.translatedText.split(/\n\s*\n/).map((paragraph, index) => (
                  <p key={index} className="mb-4 whitespace-pre-wrap">{paragraph}</p>
                ))}
              </div>
            ) : (
              <div
                className={`space-y-4 [&>p]:mb-4 [&>p]:block leading-[1.75] ${fontClasses[fontFamily]}`}
                style={{ fontSize: `${fontSize}px` }}
                dangerouslySetInnerHTML={{ __html: applyWordReplacementsToHtml(article.content, readerProject?.wordReplacements ?? []) }}
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
          <section className="mx-auto max-w-xl rounded-2xl border border-line bg-card p-5 text-center shadow-sm sm:p-8">
            <span className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-soft-fg"><BookOpen className="h-6 w-6" /></span>
            <h2 className="text-lg font-bold">เริ่มอ่านนิยาย</h2>
            <p className="mt-1 text-sm text-muted">วางลิงก์หน้าบทนิยายที่ต้องการอ่านได้เลย</p>
            <form onSubmit={handleFormSubmit} className="mt-5 flex flex-col gap-2 sm:flex-row">
              <label htmlFor="quick-read-url" className="sr-only">URL นิยายที่ต้องการอ่าน</label>
              <input id="quick-read-url" type="url" required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://..." className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50" />
              <button type="submit" disabled={loading} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-fg disabled:opacity-50"><BookOpen className="h-4 w-4" />เปิดอ่าน</button>
            </form>
            <p className="mt-3 text-xs text-muted">หรือเลือกเรื่องจากประวัติการอ่าน</p>
            <button type="button" onClick={() => setShowHistory(true)} className="mt-2 inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-xs text-muted hover:bg-surface"><History className="h-4 w-4" />ประวัติการอ่าน</button>
          </section>
        )}
      </main>
      {detectedGlossary && <DetectedGlossaryModal items={detectedGlossary.items} sourceLabel={detectedGlossary.sourceLabel} onClose={() => setDetectedGlossary(null)} onSave={saveDetectedGlossaryEdits} />}
    </div>
  );
}
