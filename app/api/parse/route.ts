import { NextRequest, NextResponse } from 'next/server';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { fetchArticleHtml } from '@/lib/fetchHtml';
import { findNavigationUrls } from '@/lib/sites';

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

  const plainText = paragraphs.join('\n\n');
  const formattedHtml = paragraphs.map((text: string) => `<p>${text}</p>`).join('');

  return { formattedHtml, plainText };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || !body.url) {
      return NextResponse.json({ error: 'กรุณาระบุ URL' }, { status: 400 });
    }

    const targetUrl = body.url;
    const forceRender = body.forceRender || false;
    const suppliedHtml = typeof body.html === 'string' ? body.html : '';
    if (suppliedHtml.length > 8_000_000) {
      return NextResponse.json({ error: 'หน้าเว็บมีขนาดใหญ่เกินไป' }, { status: 413 });
    }

    const html = suppliedHtml || await fetchArticleHtml(targetUrl, forceRender);
    const pageUrl = typeof body.pageUrl === 'string' ? body.pageUrl : targetUrl;

    if (!html) {
      return NextResponse.json(
        { error: 'ไม่สามารถดึงข้อมูลได้ (เว็บปฏิเสธการเชื่อมต่อหรือติดระบบป้องกัน)' },
        { status: 400 }
      );
    }

    const { document } = parseHTML(html);
    const navUrls = findNavigationUrls(document, pageUrl);
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
