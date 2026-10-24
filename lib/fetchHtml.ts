// ชุดกลยุทธ์การดึงหน้าเว็บนิยาย (ใช้ร่วมกันทั้ง /api/parse และ /api/toc)
// ลำดับ: direct fetch (เร็ว) → ScraperAPI fast proxy → ScraperAPI full render

function getDomainSessionId(urlStr: string): number {
  try {
    const hostname = new URL(urlStr).hostname;
    let hash = 0;
    for (let i = 0; i < hostname.length; i++) {
      hash = (hash << 5) - hash + hostname.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash % 9000) + 1000;
  } catch {
    return 5555;
  }
}

export function isChallengePage(html: string): boolean {
  return html.includes('正在验证浏览器') || html.includes('cf-challenge');
}

export async function fetchArticleHtml(targetUrl: string, forceRender = false): Promise<string> {
  const apiKey = process.env.SCRAPER_API_KEY || '';
  const sessionId = getDomainSessionId(targetUrl);
  let html = '';

  // 1) direct fetch — เร็วสุด แต่รับได้เฉพาะเว็บที่ไม่มี anti-bot
  if (!forceRender) {
    try {
      const res = await fetch(targetUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept-Language': 'zh-CN,zh;q=0.9,th;q=0.8,en;q=0.7',
        },
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const text = await res.text();
        if (!isChallengePage(text)) html = text;
      }
    } catch (e) {}
  }

  // 2) ScraperAPI fast proxy (ไม่ render JS) — สำหรับเว็บกัน UA หรือ rate-limit ปกติ
  if (!html && !forceRender && apiKey) {
    try {
      const fastProxyUrl = `https://api.scraperapi.com?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}&session_number=${sessionId}&keep_headers=true`;
      const res = await fetch(fastProxyUrl, { signal: AbortSignal.timeout(7000) });
      if (res.ok) {
        const text = await res.text();
        if (!isChallengePage(text)) html = text;
      }
    } catch (e) {}
  }

  // 3) ScraperAPI full render — สำหรับเว็บที่สารบัญ/เนื้อหาวาดด้วย JS หรือติด Cloudflare
  if (!html && apiKey) {
    try {
      const renderUrl = `https://api.scraperapi.com?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}&session_number=${sessionId}&render=true`;
      const res = await fetch(renderUrl, { signal: AbortSignal.timeout(60000) });
      if (res.ok) html = await res.text();
    } catch (e) {}
  }

  return html;
}
