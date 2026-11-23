export interface ReaderTarget { requestId: number; url: string; projectId?: string | null; }
export function isReaderTargetCurrent(active: ReaderTarget, target: ReaderTarget): boolean;
export interface ReadingHistoryEntry { url: string; title: string; readAt: number; projectId?: string | null; }
export function mergeReadingHistory(...collections: ReadingHistoryEntry[][]): ReadingHistoryEntry[];
export function escapeReaderText(value: string): string;
export function isArticleTargetCurrent(article: { sourceUrl?: string; projectId?: string | null } | null | undefined, projectId: string | null | undefined, url: string): boolean;
export function isCloudflareChallengeMarkup(input?: { url?: string; html?: string; body?: string }): boolean;
export function isChapterTitle(title: string): boolean;
export function isLikelyChapterGroup(items: Array<{ title: string }>): boolean;

export function withStableReplacementOrder<T extends object>(items: T[], baseTime?: number): Array<T & { created_at: string }>;

export function resolveChapterStatus<T extends string>(current: T, requested?: T, clearsTranslation?: boolean): T;

export function selectLatestReadableChapter<
  TChapter extends { url: string; title?: string },
  TProject extends { id: string; chapters: TChapter[] },
>(projects: TProject[], historyCollections?: Array<Array<{ url: string; title?: string; readAt: number; projectId?: string | null }>>): { project: TProject; chapter: TChapter; readAt: number } | null;

export function isAccountRequestCurrent(activeVersion: number, requestVersion: number, activeScope: string | null, requestScope: string | null): boolean;
export function resolveShelfHistoryRefresh<TLocal, TCloud>(localHistory: TLocal[], previousCloudHistory: TCloud[], cloudHistory: TCloud[] | null, succeeded: boolean): { cloudHistory: TCloud[]; combinedHistory: Array<TLocal | TCloud> };
export function isShelfHistoryRequestCurrent(accountVersion: number, requestAccountVersion: number, historyVersion: number, requestHistoryVersion: number, activeScope: string | null, requestScope: string | null): boolean;
