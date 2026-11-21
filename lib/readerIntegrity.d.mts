export interface ReaderTarget { requestId: number; url: string; projectId?: string | null; }
export function isReaderTargetCurrent(active: ReaderTarget, target: ReaderTarget): boolean;
export interface ReadingHistoryEntry { url: string; title: string; readAt: number; projectId?: string | null; }
export function mergeReadingHistory(...collections: ReadingHistoryEntry[][]): ReadingHistoryEntry[];
export function escapeReaderText(value: string): string;
export function isCloudflareChallengeMarkup(input?: { url?: string; html?: string; body?: string }): boolean;
export function isChapterTitle(title: string): boolean;
export function isLikelyChapterGroup(items: Array<{ title: string }>): boolean;

export function withStableReplacementOrder<T extends object>(items: T[], baseTime?: number): Array<T & { created_at: string }>;

export function resolveChapterStatus<T extends string>(current: T, requested?: T, clearsTranslation?: boolean): T;
