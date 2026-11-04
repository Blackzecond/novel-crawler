import { NextRequest, NextResponse } from 'next/server';
import { parseHTML } from 'linkedom';
import { fetchArticleHtml, FetchChallengeError, isChallengePage } from '@/lib/fetchHtml';
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
    if (new TextEncoder().encode(suppliedHtml).byteLength > 3_500_000) {
      return NextResponse.json({ error: 'หน้าเว็บมีขนาดใหญ่เกินไป' }, { status: 413 });
    }

    const html = suppliedHtml || await fetchArticleHtml(targetUrl, forceRender);
    const pageUrl = typeof body.pageUrl === 'string' ? body.pageUrl : targetUrl;

    if (html && isChallengePage(html)) {
      return NextResponse.json(
        { code: 'WEBVIEW_REQUIRED', error: 'เว็บไซต์กำลังแสดงหน้า Cloudflare/CAPTCHA กรุณายืนยันผ่าน WebView' },
        { status: 428 }
      );
    }
    if (!html) {
      return NextResponse.json(
        {
          error:
            'ไม่สามารถเปิดหน้าเว็บได้ (เว็บปฏิเสธการเชื่อมต่อหรือติด anti-bot) — เว็บที่ติด Cloudflare ต้องตั้ง SCRAPER_API_KEY บน Vercel',
        },
        { status: 400 }
      );
    }

    const toc = extractChapterList(html, pageUrl);

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
    return NextResponse.json(
      { error: `API Error: ${error.message || String(error)}` },
      { status: 500 }
    );
  }
}
