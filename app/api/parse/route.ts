import { NextRequest, NextResponse } from 'next/server';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';

// คำนวณ Session Number จากชื่อโดเมนเพื่อใช้ IP และ Cookie เดิมผ่าน Cloudflare
function getDomainSessionId(urlStr: string): number {
  try {
    const hostname = new URL(urlStr).hostname;
    let hash = 0;
    for (let i = 0; i < hostname.length; i++) {
      hash = (hash << 5) - hash + hostname.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash % 9000) + 1000;
  } catch (e) {
    return 5555;
  }
}

// จัดระเบียบข้อความ ย่อยแท็ก <br> และย่อหน้าให้มี \n\n ชัดเจน
function processNovelContent(rawHtml: string) {
  if (!rawHtml) return { formattedHtml: '', plainText: '' };

  let clean = rawHtml
    .replace(/[\r\n]+/g, ' ')
    .replace(/(<br\s*\/?>\s*)+/gi, '</p><p>')
    .replace(/<p>\s*<\/p>/gi, '');

  if (!clean.startsWith('<p>')) {
    clean = `<p>${clean}</p>`;
  }

  const { document } = parseHTML(`<div>${clean}</div>`);
  const paragraphs = Array.from(document.querySelectorAll('p'))
    .map((p: any) => (p.textContent || '').trim())
    .filter((text: string) => text.length > 0);

  // สร้างข้อความแบบเว้นย่อหน้า \n\n สำหรับกดคัดลอก
  const plainText = paragraphs.join('\n\n');
  // สร้าง HTML ย่อหน้า <p>
  const formattedHtml = paragraphs.map((text: string) => `<p>${text}</p>`).join('');

  return { formattedHtml, plainText };
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
    const sessionId = getDomainSessionId(targetUrl);
    let html = '';

    // 1. Fast Fetch ตรง (ไม่ผ่าน Proxy)
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

    // 2. Fast Proxy ผ่าน ScraperAPI พร้อม session_number (จำ Cookie/IP)
    if (!html && apiKey) {
      try {
        const fastProxyUrl = `https://api.scraperapi.com?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}&session_number=${sessionId}&keep_headers=true`;
        const res = await fetch(fastProxyUrl, { signal: AbortSignal.timeout(7000) });
        if (res.ok) {
          const tempHtml = await res.text();
          if (!tempHtml.includes('正在验证浏览器') && !tempHtml.includes('cf-challenge')) {
            html = tempHtml;
          }
        }
      } catch (e) {}
    }

    // 3. Fallback: Full Render พร้อมจำ session_number
    if (!html && apiKey) {
      const renderUrl = `https://api.scraperapi.com?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}&session_number=${sessionId}&render=true`;
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

    const { formattedHtml, plainText } = processNovelContent(article.content);

    return NextResponse.json({
      title: article.title || 'ไม่มีชื่อเรื่อง',
      content: formattedHtml,
      textContent: plainText,
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
