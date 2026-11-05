export interface BrowserFetchResult {
  url: string;
  title: string;
  html: string;
}

export interface BrowserFetchPlugin {
  open(options: { url: string; expandToc?: boolean }): Promise<BrowserFetchResult>;
  prefetch(options: { url: string }): Promise<BrowserFetchResult>;
}

export declare const BrowserFetch: BrowserFetchPlugin;
