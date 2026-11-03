export interface BrowserFetchResult {
  url: string;
  title: string;
  html: string;
}

export interface BrowserFetchPlugin {
  open(options: { url: string }): Promise<BrowserFetchResult>;
}

export declare const BrowserFetch: BrowserFetchPlugin;
