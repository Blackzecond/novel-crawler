import { NextRequest, NextResponse } from 'next/server';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';

function formatNovelContent(htmlContent: string): string {
  if (!htmlContent) return '';
  // แปลง <br> ซ้ำๆ หรือ \n ให้กลายเป็นย่อหน้า <p>
  let formatted = htmlContent
    .replace(/(<br\s*\/?>\s*){2,}/gi, '</p><p>')
    .replace(/(<br\s*\/?>)/gi, '</p><p>');

  if (!formatted.startsWith('<p>')) {
    formatted = `<p>${formatted}</p>`;
  }
  return formatted;
}

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
    } catch (e) {}
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

    // 1. ลองดึงตรงแบบ Fast Fetch (3 วินาที)
    try {
      const directRes = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept-Language': 'zh-CN,zh;q=0.9,th;q=0.8,en;q=0.7',
        },
        signal: AbortSignal.timeout(3000),
      });

      if (directRes.ok) {
        const tempHtml = await directRes.text();
        if (!tempHtml.includes('正在验证浏览器') && !tempHtml.includes('cf-challenge')) {
          html = tempHtml;
        }
      }
    } catch (e) {}

    // 2. ถ้าติดล็อก ให้ใช้ ScraperAPI แบบเร็ว (ไม่ใช้ render=true เพื่อประหยัดเวลาเหลือ 2-3 วิ)
    if (!html && apiKey) {
      try {
        const fastProxyUrl = `https://api.scraperapi.com?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}&keep_headers=true`;
        const res = await fetch(fastProxyUrl, { signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const tempHtml = await res.text();
          if (!tempHtml.includes('正在验证浏览器') && !tempHtml.includes('cf-challenge')) {
            html = tempHtml;
          }
        }
      } catch (e) {}
    }

    // 3. ถ้ายังติด Cloudflare JS Challenge จริงๆ ค่อยสลับไปใช้โหมด Full Render (สำรองสุดท้าย)
    if (!html && apiKey) {
      const renderUrl = `https://api.scraperapi.com?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}&render=true`;
      const res = await fetch(renderUrl);
      if (res.ok) {
        html = await res.text();
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
      content: formatNovelContent(article.content),
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
