import { NextRequest, NextResponse } from 'next/server';
import { parseHTML } from 'linkedom';
import { fetchArticleHtml, FetchChallengeError, FetchTransportError, isChallengePage } from '@/lib/fetchHtml';
import { extractChapterList, findNavigationUrls } from '@/lib/sites';

// Analyze whether the supplied URL is a novel directory (目录) or a chapter page.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || !body.url) {
      return NextResponse.json({ error: 'กรุณาระบุ URL' }, { status: 400 });
    }

    const targetUrl: string = body.url;
    const forceRender: boolean = body.forceRender || false;
    const suppliedHtml = typeof body.html === 'string' ? body.html : '';
    const suppliedPages = Array.isArray(body.pages) ? body.pages.slice(0, 50).filter((page: any) =>
      page && typeof page.html === 'string' && typeof page.url === 'string'
    ) : [];
    const encoder = new TextEncoder();
    const totalPageBytes = suppliedPages.reduce((sum: number, page: any) => sum + encoder.encode(page.html).byteLength, 0);
    if (encoder.encode(suppliedHtml).byteLength > 3_500_000 || totalPageBytes > 12_000_000) {
      return NextResponse.json({ error: 'หน้าเว็บมีขนาดใหญ่เกินไป' }, { status: 413 });
    }

    const targetHost = new URL(targetUrl).hostname.replace(/^www\d?\./, '');
    const pages = suppliedPages.filter((page: any) => {
      try {
        const pageHost = new URL(page.url).hostname.replace(/^www\d?\./, '');
        return pageHost === targetHost || pageHost.endsWith('.' + targetHost) || targetHost.endsWith('.' + pageHost);
      } catch { return false; }
    });
    const html = pages.length ? pages[0].html : (suppliedHtml || await fetchArticleHtml(targetUrl, forceRender));
    const pageUrl = pages.length ? pages[0].url : (typeof body.pageUrl === 'string' ? body.pageUrl : targetUrl);

    if ((pages.length && pages.some((page: any) => isChallengePage(page.html))) || (html && isChallengePage(html))) {
      return NextResponse.json(
        { code: 'WEBVIEW_REQUIRED', error: 'เว็บไซต์กำลังแสดงหน้า Cloudflare/CAPTCHA กรุณายืนยันผ่าน WebView' },
        { status: 428 }
      );
    }
    if (!html) {
      return NextResponse.json(
        {
          error:
            'ไม่สามารถเปิดหน้าเว็บได้ (เว็บปฏิเสธการเชื่อมต่อหรือติด anti-bot) — เว็บที่ติด Cloudflare ต้องยืนยันผ่าน WebView',
        },
        { status: 400 }
      );
    }

    const pageSources = pages.length ? pages : [{ html, url: pageUrl }];
    const seenChapterUrls = new Set<string>();
    const mergedChapters: { url: string; title: string; order: number }[] = [];
    let novelTitle: string | null = null;
    for (const page of pageSources) {
      const result = extractChapterList(page.html, page.url, pageSources.length > 1 ? 2 : 6);
      novelTitle = novelTitle || result.novelTitle;
      for (const chapter of result.chapters) {
        if (seenChapterUrls.has(chapter.url)) continue;
        seenChapterUrls.add(chapter.url);
        mergedChapters.push({ ...chapter, order: mergedChapters.length });
      }
    }
    const toc = { novelTitle, chapters: mergedChapters };

    if (toc.chapters.length >= 6) {
      return NextResponse.json({
        type: 'directory',
        novelTitle: toc.novelTitle,
        host: new URL(targetUrl).hostname,
        count: toc.chapters.length,
        chapters: toc.chapters,
      });
    }

    const { document } = parseHTML(html);
    const nav = findNavigationUrls(document, pageUrl);
    return NextResponse.json({
      type: 'chapter',
      novelTitle: toc.novelTitle,
      prevUrl: nav.prevUrl,
      nextUrl: nav.nextUrl,
      message:
        'หน้านี้เป็นหน้าบทหรือไม่พบรายการบท — ให้วางลิงก์หน้าสารบัญ (目录/章节列表) ของเรื่อง หรือกดอ่านด่วนต่อจากนี้',
    });
  } catch (error: any) {
    if (error instanceof FetchChallengeError) {
      return NextResponse.json(
        { code: 'WEBVIEW_REQUIRED', error: error.message },
        { status: 428 }
      );
    }
    if (error instanceof FetchTransportError) {
      return NextResponse.json(
        { code: 'DIRECT_FETCH_FAILED', error: error.message },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: `API Error: ${error.message || String(error)}` },
      { status: 500 }
    );
  }
}
