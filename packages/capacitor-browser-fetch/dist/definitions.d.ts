import type { Plugin } from '@capacitor/core';

export interface BrowserFetchResult {
  url: string;
  title: string;
  html: string;
}

export interface BrowserFetchPlugin extends Plugin {
  open(options: { url: string }): Promise<BrowserFetchResult>;
}

export declare const BrowserFetch: BrowserFetchPlugin;
