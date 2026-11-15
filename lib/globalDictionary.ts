import { getSupabase } from '@/lib/supabase';

export type GlobalDictionaryCategory =
  | 'brand' | 'food' | 'drink' | 'app' | 'place' | 'culture' | 'unit' | 'title' | 'other';

export interface GlobalDictionaryEntry {
  id: string;
  sourceTerm: string;
  translatedTerm: string;
  category: GlobalDictionaryCategory;
  aliases: string[];
  notes: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GlobalDictionaryPromptTerm {
  source: string;
  target: string;
  note?: string;
}

interface DictionaryRow {
  id: string;
  source_term: string;
  translated_term: string;
  category: GlobalDictionaryCategory;
  aliases: string[] | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface Pattern {
  text: string;
  entry?: GlobalDictionaryEntry;
  protected: boolean;
}

interface MatchCandidate {
  start: number;
  end: number;
  pattern: Pattern;
}

interface TrieNode {
  next: Map<string, number>;
  fail: number;
  outputs: Pattern[];
}

let cachedUserId: string | null = null;
let cachedEntries: GlobalDictionaryEntry[] | null = null;
let cachedLoad: Promise<GlobalDictionaryEntry[]> | null = null;
const matcherCache = new Map<string, AhoCorasickMatcher>();

function mapRow(row: DictionaryRow): GlobalDictionaryEntry {
  return {
    id: row.id,
    sourceTerm: row.source_term,
    translatedTerm: row.translated_term,
    category: row.category,
    aliases: Array.isArray(row.aliases) ? row.aliases.filter((value) => typeof value === 'string' && value.trim()) : [],
    notes: row.notes ?? '',
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getCurrentUserId(): Promise<string> {
  const { data, error } = await getSupabase().auth.getUser();
  if (error || !data.user) throw new Error('กรุณาเข้าสู่ระบบก่อนใช้คลังคำศัพท์พื้นฐาน');
  return data.user.id;
}

/** Loads active entries once per signed-in account. Pass true after an explicit refresh. */
export async function loadGlobalDictionaryEntries(forceRefresh = false): Promise<GlobalDictionaryEntry[]> {
  const userId = await getCurrentUserId();
  if (!forceRefresh && cachedUserId === userId && cachedEntries) return cachedEntries;
  if (!forceRefresh && cachedUserId === userId && cachedLoad) return cachedLoad;

  cachedUserId = userId;
  cachedLoad = (async () => {
    const { data, error } = await getSupabase()
      .from('global_dictionary_entries')
      .select('id, source_term, translated_term, category, aliases, notes, is_active, created_at, updated_at')
      .eq('is_active', true)
      .order('source_term', { ascending: true });
    if (error) throw error;
    const entries = ((data ?? []) as DictionaryRow[]).map(mapRow);
    cachedEntries = entries;
    return entries;
  })();

  try {
    return await cachedLoad;
  } catch (error) {
    cachedEntries = null;
    cachedLoad = null;
    throw error;
  }
}

/** Lists active and inactive rows for the dictionary management screen. */
export async function listGlobalDictionaryEntries(): Promise<GlobalDictionaryEntry[]> {
  const { data, error } = await getSupabase()
    .from('global_dictionary_entries')
    .select('id, source_term, translated_term, category, aliases, notes, is_active, created_at, updated_at')
    .order('source_term', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as DictionaryRow[]).map(mapRow);
}

export async function saveGlobalDictionaryEntry(input: {
  id?: string;
  sourceTerm: string;
  translatedTerm: string;
  category: GlobalDictionaryCategory;
  aliases: string[];
  notes: string;
  isActive: boolean;
}): Promise<void> {
  const sourceTerm = input.sourceTerm.trim();
  const translatedTerm = input.translatedTerm.trim();
  if (!sourceTerm || !translatedTerm) throw new Error('กรุณากรอกคำต้นฉบับและคำแปล');
  const userId = await getCurrentUserId();
  const payload = {
    user_id: userId,
    source_term: sourceTerm,
    translated_term: translatedTerm,
    category: input.category,
    aliases: [...new Set(input.aliases.map((value) => value.trim()).filter((value) => value && value !== sourceTerm))],
    notes: input.notes.trim(),
    is_active: input.isActive,
    updated_at: new Date().toISOString(),
  };
  const query = getSupabase().from('global_dictionary_entries');
  const { error } = input.id
    ? await query.update(payload).eq('id', input.id)
    : await query.insert(payload);
  if (error) throw error;
  invalidateGlobalDictionaryCache();
}

export async function deleteGlobalDictionaryEntry(id: string): Promise<void> {
  const { error } = await getSupabase().from('global_dictionary_entries').delete().eq('id', id);
  if (error) throw error;
  invalidateGlobalDictionaryCache();
}

export function invalidateGlobalDictionaryCache(): void {
  cachedEntries = null;
  cachedLoad = null;
  matcherCache.clear();
}

class AhoCorasickMatcher {
  private readonly nodes: TrieNode[] = [{ next: new Map(), fail: 0, outputs: [] }];

  constructor(patterns: Pattern[]) {
    const seen = new Set<string>();
    for (const pattern of patterns) {
      if (!pattern.text || seen.has(pattern.text)) continue;
      seen.add(pattern.text);
      let state = 0;
      for (let index = 0; index < pattern.text.length; index += 1) {
        const character = pattern.text[index];
        let nextState = this.nodes[state].next.get(character);
        if (nextState === undefined) {
          nextState = this.nodes.length;
          this.nodes[state].next.set(character, nextState);
          this.nodes.push({ next: new Map(), fail: 0, outputs: [] });
        }
        state = nextState;
      }
      this.nodes[state].outputs.push(pattern);
    }
    this.buildFailureLinks();
  }

  private buildFailureLinks(): void {
    const queue: number[] = [];
    for (const child of this.nodes[0].next.values()) queue.push(child);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const state = queue[cursor];
      for (const [character, child] of this.nodes[state].next) {
        queue.push(child);
        let fallback = this.nodes[state].fail;
        while (fallback !== 0 && !this.nodes[fallback].next.has(character)) {
          fallback = this.nodes[fallback].fail;
        }
        this.nodes[child].fail = this.nodes[fallback].next.get(character) ?? 0;
        this.nodes[child].outputs.push(...this.nodes[this.nodes[child].fail].outputs);
      }
    }
  }

  find(text: string): MatchCandidate[] {
    const found: MatchCandidate[] = [];
    let state = 0;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      while (state !== 0 && !this.nodes[state].next.has(character)) {
        state = this.nodes[state].fail;
      }
      state = this.nodes[state].next.get(character) ?? 0;
      for (const pattern of this.nodes[state].outputs) {
        found.push({
          start: index - pattern.text.length + 1,
          end: index + 1,
          pattern,
        });
      }
    }
    return found;
  }
}

function getMatcher(entries: GlobalDictionaryEntry[], protectedTerms: string[]): AhoCorasickMatcher {
  const protectedKey = [...new Set(protectedTerms.filter(Boolean))].sort().join('\u0001');
  const cacheKey = protectedKey;
  const cached = matcherCache.get(cacheKey);
  if (cached) return cached;

  const patterns: Pattern[] = protectedTerms.map((text) => ({ text, protected: true }));
  for (const entry of entries) {
    patterns.push({ text: entry.sourceTerm, entry, protected: false });
    for (const alias of entry.aliases) patterns.push({ text: alias, entry, protected: false });
  }
  const matcher = new AhoCorasickMatcher(patterns);
  if (matcherCache.size >= 8) matcherCache.delete(matcherCache.keys().next().value as string);
  matcherCache.set(cacheKey, matcher);
  return matcher;
}

/**
 * Finds only global dictionary terms present in this chapter.
 * Project glossary phrases are inserted as higher-priority protected matches.
 */
export async function findRelevantGlobalDictionaryTerms(
  text: string,
  projectGlossary: Record<string, string> = {},
): Promise<GlobalDictionaryPromptTerm[]> {
  if (!text.trim()) return [];
  const entries = await loadGlobalDictionaryEntries();
  if (!entries.length) return [];

  const protectedTerms = Object.entries(projectGlossary)
    .filter(([source, target]) => source.trim() && target.trim())
    .map(([source]) => source.trim());
  const matcher = getMatcher(entries, protectedTerms);
  const candidates = matcher.find(text);

  // Protected project glossary terms win any overlapping match. Among global
  // entries, leftmost-longest matching avoids sending nested duplicates.
  candidates.sort((a, b) =>
    Number(b.pattern.protected) - Number(a.pattern.protected)
    || a.start - b.start
    || (b.end - b.start) - (a.end - a.start),
  );

  const occupied = new Uint8Array(text.length);
  const accepted: MatchCandidate[] = [];
  for (const candidate of candidates) {
    let overlaps = false;
    for (let index = candidate.start; index < candidate.end; index += 1) {
      if (occupied[index]) { overlaps = true; break; }
    }
    if (overlaps) continue;
    for (let index = candidate.start; index < candidate.end; index += 1) occupied[index] = 1;
    accepted.push(candidate);
  }

  const unique = new Map<string, GlobalDictionaryPromptTerm>();
  for (const match of accepted) {
    if (match.pattern.protected || !match.pattern.entry) continue;
    const source = match.pattern.text;
    const key = source + '\u0000' + match.pattern.entry.id;
    if (unique.has(key)) continue;
    unique.set(key, {
      source,
      target: match.pattern.entry.translatedTerm,
      ...(match.pattern.entry.notes ? { note: match.pattern.entry.notes } : {}),
    });
  }
  return [...unique.values()];
}
