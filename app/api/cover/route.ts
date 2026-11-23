import { NextRequest, NextResponse } from 'next/server';
import { parseHTML } from 'linkedom';
import { fetchArticleHtml } from '@/lib/fetchHtml';


function isPublicHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
      || host === '127.0.0.1' || host === '::1'
      || /^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return null;
    return url;
  } catch {
    return null;
  }
}

function absoluteImageUrl(raw: string | null | undefined, baseUrl: string): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value || value.startsWith('data:') || value.startsWith('blob:')) return null;
  try {
    const url = new URL(value, baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function extractCover(html: string, pageUrl: string, title?: string): string | null {
  const { document } = parseHTML(html);
  const meta = [
    document.querySelector('meta[property="og:image"]')?.getAttribute('content'),
    document.querySelector('meta[name="og:image"]')?.getAttribute('content'),
    document.querySelector('meta[name="twitter:image"]')?.getAttribute('content'),
    document.querySelector('meta[property="twitter:image"]')?.getAttribute('content'),
  ];
  for (const candidate of meta) {
    const url = absoluteImageUrl(candidate, pageUrl);
    if (url) return url;
  }

  const titleText = (title ?? document.querySelector('h1')?.textContent ?? '').trim().toLowerCase();
  const images = Array.from(document.querySelectorAll('img'));
  const score = (img: Element) => {
    const alt = (img.getAttribute('alt') ?? '').toLowerCase();
    const imageTitle = (img.getAttribute('title') ?? '').toLowerCase();
    const context = (img.parentElement?.getAttribute('class') ?? '').toLowerCase();
    const source = img.getAttribute('src') ?? img.getAttribute('data-src')
      ?? img.getAttribute('data-original') ?? img.getAttribute('data-lazy-src');
    if (!source) return -1;
    const lowerSource = source.toLowerCase();
    if (/avatar|logo|icon|qrcode|banner|ad[s_-]?\d*/.test(lowerSource)) return -1;
    let value = 0;
    if (alt.includes('封面') || imageTitle.includes('封面')) value += 100;
    if (titleText && (alt.includes(titleText) || imageTitle.includes(titleText))) value += 80;
    if (/cover|book.?img|book.?cover|fmimg|novel.?img/.test(context)) value += 60;
    if (/article\/image|book|cover|img22\.ixdzs/.test(lowerSource)) value += 15;
    const width = Number(img.getAttribute('width')) || 0;
    const height = Number(img.getAttribute('height')) || 0;
    if (height > width && height >= 80) value += 10;
    return value;
  };
  const ranked = images.map((img) => ({ img, value: score(img) }))
    .filter((item) => item.value >= 15)
    .sort((a, b) => b.value - a.value);
  for (const item of ranked) {
    const img = item.img;
    const raw = img.getAttribute('src') ?? img.getAttribute('data-src')
      ?? img.getAttribute('data-original') ?? img.getAttribute('data-lazy-src');
    const url = absoluteImageUrl(raw, pageUrl);
    if (url) return url;
  }
  return null;
}

function normalizeTitle(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

/**
 * Last-resort lookup for Chinese web-novel covers.
 * Only accept Bing image results whose metadata repeats the requested title.
 * Return Bing's hosted thumbnail so the bookshelf does not depend on the
 * original image host's hotlink policy.
 */
async function searchChineseNovelCover(title: string): Promise<string | null> {
  const cleanTitle = title.trim();
  if (!cleanTitle || cleanTitle.length < 2) return null;

  try {
    const query = encodeURIComponent(`"${cleanTitle}" 小说 封面`);
    const response = await fetch(`https://www.bing.com/images/search?q=${query}&qft=+filterui:imagesize-medium`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NovelCrawler/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(4500),
      cache: 'no-store',
    });
    if (!response.ok) return null;

    const html = await response.text();
    const { document } = parseHTML(html);
    const wanted = normalizeTitle(cleanTitle);
    const results = Array.from(document.querySelectorAll('a.iusc'));
    for (const result of results.slice(0, 12)) {
      const rawMetadata = result.getAttribute('m');
      if (!rawMetadata) continue;
      try {
        const metadata = JSON.parse(rawMetadata) as { t?: string; desc?: string; turl?: string; murl?: string };
        const searchableText = normalizeTitle(`${metadata.t ?? ''} ${metadata.desc ?? ''}`);
        if (!searchableText.includes(wanted)) continue;

        const thumbnail = absoluteImageUrl(metadata.turl, 'https://www.bing.com');
        if (thumbnail && new URL(thumbnail).hostname.endsWith('mm.bing.net')) return thumbnail;

        const original = absoluteImageUrl(metadata.murl, 'https://www.bing.com');
        if (original) return original;
      } catch {
        // Ignore malformed image-result metadata and continue to the next result.
      }
    }
  } catch {
    // Search is optional; a timeout or blocked search provider must not affect project creation.
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const pageUrl = typeof body?.url === 'string' ? body.url : '';
    if (!isPublicHttpUrl(pageUrl)) {
      return NextResponse.json({ error: 'URL ไม่ถูกต้อง' }, { status: 400 });
    }

    let coverUrl: string | null = null;
    try {
      const html = await fetchArticleHtml(pageUrl);
      coverUrl = extractCover(html, pageUrl, typeof body?.title === 'string' ? body.title : '');
    } catch {
      // A failed source-page fetch should still allow the optional title search.
    }

    if (!coverUrl && typeof body?.title === 'string') {
      coverUrl = await searchChineseNovelCover(body.title);
    }
    return NextResponse.json({ coverUrl });
  } catch (error) {
    return NextResponse.json({
      coverUrl: null,
      error: error instanceof Error ? error.message : 'ดึงรูปปกไม่สำเร็จ',
    }, { status: 200 });
  }
}
