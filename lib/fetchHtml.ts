// Server-side direct fetch shared by /api/parse and /api/toc.
// Anti-bot challenges are handed to Android WebView immediately.

export class FetchChallengeError extends Error {
  constructor(message = 'เว็บไซต์กำลังแสดงหน้า Cloudflare/CAPTCHA') {
    super(message);
    this.name = 'FetchChallengeError';
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

/**
 * Fetches the page directly from its source.
 * External scraping/proxy services are intentionally disabled.
 * forceRender remains accepted for API compatibility but does not invoke a proxy.
 */
export async function fetchArticleHtml(targetUrl: string, _forceRender = false): Promise<string> {
  const hostname = (() => { try { return new URL(targetUrl).hostname; } catch { return 'invalid-url'; } })();
  const startedAt = Date.now();
  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9,th;q=0.8,en;q=0.7',
      },
      signal: AbortSignal.timeout(8000),
      redirect: 'follow',
    });
    const html = await response.text();
    if (isChallengeResponse(response, html)) throw new FetchChallengeError();
    console.info('[fetchArticleHtml]', {
      host: hostname,
      totalMs: Date.now() - startedAt,
      result: response.ok ? (html ? 'html' : 'empty') : 'http-error',
      status: response.status,
    });
    return response.ok ? html : '';
  } catch (error) {
    if (error instanceof FetchChallengeError) throw error;
    console.info('[fetchArticleHtml]', {
      host: hostname,
      totalMs: Date.now() - startedAt,
      result: 'fetch-error',
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}
