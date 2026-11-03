import { Capacitor } from '@capacitor/core';
import { BrowserFetch } from '@blackzecond/capacitor-browser-fetch';

export interface NativeBrowserPage {
  url: string;
  title: string;
  html: string;
}

/**
 * Opens the source page in the app-private Android WebView.
 * Returns null on web/PWA so callers can preserve the server-only flow.
 */
export async function fetchWithNativeBrowser(url: string): Promise<NativeBrowserPage | null> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    return null;
  }

  return BrowserFetch.open({ url });
}
