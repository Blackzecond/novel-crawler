import { NextRequest, NextResponse } from 'next/server';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';

function findNavigationUrls(doc: any, baseUrl: string) {
  let prevUrl: string | null = null;
  let nextUrl: string | null = null;
  const links = Array.from(doc.querySelectorAll('a'));

  for (const link of links as any[]) {
    const text = (link.textContent || '').trim().toLowerCase();
    const href = link.getAttribute('href');
    const rel = (link.getAttribute('rel') || '').toLowerCase();

    if (!href || href.startsWith('javascript:') || href === '#' || href.startsWith('mailto:')) continue;

    try {
      const absUrl = new URL(href, baseUrl).href;

      if (!prevUrl && (rel === 'prev' || /上一章|上一页|上一頁|บทก่อน|ก่อนหน้า|prev|previous/.test(text))) {
        prevUrl = absUrl;
      }
      if (!nextUrl && (rel === 'next' || /下一章|下一页|下一頁|บทถัดไป|ถัดไป|next/.test(text))) {
        nextUrl = absUrl;
      }
    } catch (e) {
      // ignore invalid URL
    }
  }
  return { prevUrl, nextUrl };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || !body.url) {
      return NextResponse.json({ error: 'กรุณาระบุ URL' }, { status: 400 });
    }

    const targetUrl = body.url;
    const apiKey = process.env.SCRAPER_API_KEY || '';
    let html = '';

    // 1. ลองดึงตรงแบบ Fast Fetch ก่อน (timeout 4 วินาที)
    try {
      const directRes = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'th-TH,th;q=0.9,zh-CN;q=0.8,zh;q=0.7,en;q=0.6',
        },
        signal: AbortSignal.timeout(4000),
      });

      if (directRes.ok) {
        const tempHtml = await directRes.text();
        if (!tempHtml.includes('正在验证浏览器') && !tempHtml.includes('cf-challenge') && !tempHtml.includes('Just a moment...')) {
          html = tempHtml;
        }
      }
    } catch (e) {
      // Direct fetch failed or timed out, fallback to ScraperAPI
    }

    // 2. ถ้าดึงตรงไม่ได้ ให้ใช้ ScraperAPI เป็นตัวสำรอง
    if (!html && apiKey) {
      const scraperUrl = `https://api.scraperapi.com?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}&render=true`;
      const response = await fetch(scraperUrl);
      if (response.ok) {
        html = await response.text();
      }
    }

    if (!html) {
      return NextResponse.json(
        { error: 'ไม่สามารถดึงข้อมูลได้ (เว็บปฏิเสธการเชื่อมต่อหรือติดระบบป้องกัน)' },
        { status: 400 }
      );
    }

    const { document } = parseHTML(html);
    const navUrls = findNavigationUrls(document, targetUrl);

    const reader = new Readability(document);
    const article = reader.parse();

    if (!article || !article.content) {
      return NextResponse.json(
        { error: 'ดึงหน้าเว็บได้ แต่ไม่พบเนื้อหาหลักในหน้านี้' },
        { status: 422 }
      );
    }

    return NextResponse.json({
      title: article.title || 'ไม่มีชื่อเรื่อง',
      content: article.content,
      textContent: article.textContent || '',
      prevUrl: navUrls.prevUrl,
      nextUrl: navUrls.nextUrl,
    });

  } catch (error: any) {
    return NextResponse.json(
      { error: `API Error: ${error.message || String(error)}` },
      { status: 500 }
    );
  }
}
