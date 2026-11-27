export interface BrowserFetchPage {
  url: string;
  title: string;
  html: string;
}

export interface BrowserFetchResult extends BrowserFetchPage {
  pages?: BrowserFetchPage[];
}

export interface BrowserFetchPlugin {
  open(options: { url: string; expandToc?: boolean }): Promise<BrowserFetchResult>;
  prefetch(options: { url: string }): Promise<BrowserFetchResult>;
}

export declare const BrowserFetch: BrowserFetchPlugin;
