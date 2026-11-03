// Server-side fetch strategies shared by /api/parse and /api/toc.
// Detected anti-bot challenges are handed to Android WebView immediately.

export class FetchChallengeError extends Error {
  constructor(message = 'เว็บไซต์กำลังแสดงหน้า Cloudflare/CAPTCHA') {
    super(message);
    this.name = 'FetchChallengeError';
  }
}

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
  const value = html.toLowerCase();
  return (
    value.includes('正在验证浏览器') ||
    value.includes('安全验证') ||
    value.includes('just a moment') ||
    value.includes('verify you are human') ||
    value.includes('performing security verification') ||
    value.includes('checking your browser') ||
    value.includes('checking if the site connection is secure') ||
    value.includes('cf-challenge') ||
    value.includes('cf-chl-') ||
    value.includes('challenge-platform') ||
    value.includes('/cdn-cgi/challenge-platform/')
  );
}

function isChallengeResponse(response: Response, html: string): boolean {
  const statusLooksBlocked = [403, 429, 503].includes(response.status);
  const hasCloudflareRay = Boolean(response.headers.get('cf-ray'));
  return response.headers.get('cf-mitigated')?.toLowerCase() === 'challenge'
    || isChallengePage(html)
    || (statusLooksBlocked && hasCloudflareRay);
}

export async function fetchArticleHtml(targetUrl: string, forceRender = false): Promise<string> {
  const apiKey = process.env.SCRAPER_API_KEY || '';
  const sessionId = getDomainSessionId(targetUrl);
  const hostname = (() => { try { return new URL(targetUrl).hostname; } catch { return 'invalid-url'; } })();
  const timings: Record<string, number> = {};
  const startedAt = Date.now();
  let html = '';

  // 1) Direct fetch: detect challenge responses even when the status is not 2xx.
  if (!forceRender) {
    const stageStartedAt = Date.now();
    try {
      const res = await fetch(targetUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept-Language': 'zh-CN,zh;q=0.9,th;q=0.8,en;q=0.7',
        },
        signal: AbortSignal.timeout(3000),
        redirect: 'follow',
      });
      const text = await res.text();
      if (isChallengeResponse(res, text)) throw new FetchChallengeError();
      if (res.ok) html = text;
    } catch (error) {
      if (error instanceof FetchChallengeError) throw error;
    } finally {
      timings.direct = Date.now() - stageStartedAt;
    }
  }

  // 2) Fast proxy: if it also returns a challenge, skip browserless rendering.
  if (!html && !forceRender && apiKey) {
    const stageStartedAt = Date.now();
    try {
      const fastProxyUrl = `https://api.scraperapi.com?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}&session_number=${sessionId}&keep_headers=true`;
      const res = await fetch(fastProxyUrl, { signal: AbortSignal.timeout(5000) });
      const text = await res.text();
      if (isChallengeResponse(res, text)) throw new FetchChallengeError();
      if (res.ok) html = text;
    } catch (error) {
      if (error instanceof FetchChallengeError) throw error;
    } finally {
      timings.fastProxy = Date.now() - stageStartedAt;
    }
  }

  // 3) Full render is only for JS-rendered/transient failures, with a bounded wait.
  if (!html && apiKey) {
    const stageStartedAt = Date.now();
    try {
      const renderUrl = `https://api.scraperapi.com?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}&session_number=${sessionId}&render=true`;
      const res = await fetch(renderUrl, { signal: AbortSignal.timeout(15000) });
      const text = await res.text();
      if (isChallengeResponse(res, text)) throw new FetchChallengeError();
      if (res.ok) html = text;
    } catch (error) {
      if (error instanceof FetchChallengeError) throw error;
    } finally {
      timings.fullRender = Date.now() - stageStartedAt;
    }
  }

  console.info('[fetchArticleHtml]', {
    host: hostname,
    totalMs: Date.now() - startedAt,
    stages: timings,
    result: html ? 'html' : 'empty',
    forceRender,
  });
  return html;
}
