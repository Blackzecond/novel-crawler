import { NextRequest, NextResponse } from 'next/server';
import { parseHTML } from 'linkedom';
import { fetchArticleHtml } from '@/lib/fetchHtml';
import { extractChapterList, findNavigationUrls } from '@/lib/sites';

// วิเคราะห์ว่า URL ที่วางมาเป็นหน้าสารบัญ (directory) หรือหน้าบท (chapter)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || !body.url) {
      return NextResponse.json({ error: 'กรุณาระบุ URL' }, { status: 400 });
    }

    const targetUrl: string = body.url;
    const forceRender: boolean = body.forceRender || false;

    const html = await fetchArticleHtml(targetUrl, forceRender);
    if (!html) {
      return NextResponse.json(
        {
          error:
            'ไม่สามารถเปิดหน้าเว็บได้ (เว็บปฏิเสธการเชื่อมต่อหรือติด anti-bot) — เว็บที่ติด Cloudflare ต้องตั้ง SCRAPER_API_KEY บน Vercel',
        },
        { status: 400 }
      );
    }

    const toc = extractChapterList(html, targetUrl);

    // พบรายการบทจำนวนมาก → เป็นหน้าสารบัญ (目录)
    if (toc.chapters.length >= 6) {
      return NextResponse.json({
        type: 'directory',
        novelTitle: toc.novelTitle,
        host: new URL(targetUrl).hostname,
        count: toc.chapters.length,
        chapters: toc.chapters,
      });
    }

    // ไม่พบสารบัญ — มีโอกาสเป็นหน้าบท แนะนำทางให้ผู้ใช้
    const { document } = parseHTML(html);
    const nav = findNavigationUrls(document, targetUrl);
    return NextResponse.json({
      type: 'chapter',
      novelTitle: toc.novelTitle,
      prevUrl: nav.prevUrl,
      nextUrl: nav.nextUrl,
      message:
        'หน้านี้เป็นหน้าบทหรือไม่พบรายการบท — ให้วางลิงก์หน้าสารบัญ (目录/章节列表) ของเรื่อง หรือกดอ่านด่วนต่อจากนี้',
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: `API Error: ${error.message || String(error)}` },
      { status: 500 }
    );
  }
}
