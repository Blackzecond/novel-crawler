export interface BrowserFetchResult {
  url: string;
  title: string;
  html: string;
}

export interface BrowserFetchPlugin {
  open(options: { url: string; expandToc?: boolean }): Promise<BrowserFetchResult>;
  prefetch(options: { url: string }): Promise<BrowserFetchResult>;
  debugNetwork(options: { url: string }): Promise<void>;
}

export declare const BrowserFetch: BrowserFetchPlugin;
