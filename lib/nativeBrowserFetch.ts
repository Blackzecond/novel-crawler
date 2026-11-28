import { Capacitor } from '@capacitor/core';
import { BrowserFetch } from '@blackzecond/capacitor-browser-fetch';

export interface NativeBrowserPage {
  url: string;
  title: string;
  html: string;
  pages?: { url: string; title: string; html: string }[];
}

const strategyKey = (projectId: string) => `novel-fetch-strategy-v1:${projectId}`;

function supportsNativeBrowser(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export function prefersNativeBrowser(projectId: string): boolean {
  // Ignore stale WebView preferences on web/PWA, where the native plugin is unavailable.
  if (typeof window === 'undefined' || !supportsNativeBrowser()) return false;
  try {
    return window.localStorage.getItem(strategyKey(projectId)) === 'webview';
  } catch {
    return false;
  }
}

export function rememberNativeBrowser(projectId: string): void {
  if (typeof window === 'undefined' || !supportsNativeBrowser()) return;
  try {
    window.localStorage.setItem(strategyKey(projectId), 'webview');
  } catch {
    // Storage may be unavailable; the normal server-first fallback remains active.
  }
}

/**
 * Opens the source page in the app-private Android WebView.
 * Returns null on web/PWA so callers can preserve the server-only flow.
 */
export async function fetchWithNativeBrowser(url: string, options: { expandToc?: boolean } = {}): Promise<NativeBrowserPage | null> {
  if (!supportsNativeBrowser()) {
    return null;
  }

  return BrowserFetch.open({ url, expandToc: options.expandToc ?? false });
}


/**
 * Fetches a chapter through a hidden Android WebView using the same
 * app-private CookieManager session as the interactive browser.
 * Returns null on web/PWA; rejects when the page cannot be captured safely.
 */
export async function debugNativeBrowserNetwork(url: string): Promise<boolean> {
  if (!supportsNativeBrowser()) return false;
  await BrowserFetch.debugNetwork({ url });
  return true;
}

export async function prefetchWithNativeBrowser(url: string): Promise<NativeBrowserPage | null> {
  if (!supportsNativeBrowser()) {
    return null;
  }
  return BrowserFetch.prefetch({ url });
}
