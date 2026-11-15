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

export interface GlobalDictionaryImportRow {
  sourceTerm: string;
  translatedTerm: string;
  category: GlobalDictionaryCategory;
  aliases: string[];
  notes: string;
  isActive: boolean;
  rowNumber: number;
}

export interface GlobalDictionaryImportConflict {
  rowNumber: number;
  sourceTerm: string;
  reason: string;
}

export interface GlobalDictionaryImportAnalysis {
  accepted: GlobalDictionaryImportRow[];
  duplicates: number;
  conflicts: GlobalDictionaryImportConflict[];
}

const VALID_CATEGORIES: GlobalDictionaryCategory[] = [
  'brand', 'food', 'drink', 'app', 'place', 'culture', 'unit', 'title', 'other',
];

function normalizeDictionaryKey(value: string): string {
  return value.trim().normalize('NFC').toLocaleLowerCase();
}

function csvEscape(value: string): string {
  return '"' + value.replace(/"/g, '""') + '"';
}

/** RFC-4180-style CSV export; aliases are JSON so commas/newlines remain unambiguous. */
export function exportGlobalDictionaryCsv(entries: GlobalDictionaryEntry[]): string {
  const header = ['source_term', 'translated_term', 'category', 'aliases', 'notes', 'is_active'];
  const rows = entries.map((entry) => [
    entry.sourceTerm,
    entry.translatedTerm,
    entry.category,
    JSON.stringify(entry.aliases),
    entry.notes,
    String(entry.isActive),
  ]);
  return [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');
}

/** Parses quoted CSV fields, escaped quotes, commas and embedded line breaks. */
export function parseGlobalDictionaryCsv(input: string): GlobalDictionaryImportRow[] {
  const source = input.charCodeAt(0) === 0xFEFF ? input.slice(1) : input;
  const matrix: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) matrix.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error('ไฟล์ CSV มีเครื่องหมายอัญประกาศไม่ครบคู่');
  if (field.length || row.length) {
    row.push(field);
    if (row.some((value) => value.trim())) matrix.push(row);
  }
  if (matrix.length < 2) throw new Error('ไม่พบข้อมูลคำศัพท์ในไฟล์ CSV');

  const headers = matrix[0].map((value) => value.trim().replace(/^\uFEFF/, '').toLowerCase());
  const findColumn = (...names: string[]) => headers.findIndex((header) => names.includes(header));
  const sourceIndex = findColumn('source_term', 'sourceterm', 'source', 'original', 'คำต้นฉบับ');
  const targetIndex = findColumn('translated_term', 'translatedterm', 'translation', 'target', 'คำแปล');
  if (sourceIndex < 0 || targetIndex < 0) {
    throw new Error('CSV ต้องมีคอลัมน์ source_term และ translated_term');
  }
  const categoryIndex = findColumn('category', 'ประเภท');
  const aliasesIndex = findColumn('aliases', 'alias', 'คำเรียกอื่น');
  const notesIndex = findColumn('notes', 'note', 'หมายเหตุ');
  const activeIndex = findColumn('is_active', 'isactive', 'active', 'enabled', 'เปิดใช้งาน');
  const get = (values: string[], index: number) => index < 0 ? '' : (values[index] ?? '').trim();

  return matrix.slice(1).map((values, index) => {
    const sourceTerm = get(values, sourceIndex);
    const translatedTerm = get(values, targetIndex);
    if (!sourceTerm || !translatedTerm) {
      throw new Error('แถวที่ ' + (index + 2) + ' ต้องมีทั้งคำต้นฉบับและคำแปล');
    }
    const rawCategory = get(values, categoryIndex) as GlobalDictionaryCategory;
    const category = VALID_CATEGORIES.includes(rawCategory) ? rawCategory : 'other';
    const rawAliases = get(values, aliasesIndex);
    let aliases: string[] = [];
    if (rawAliases) {
      try {
        const parsed: unknown = JSON.parse(rawAliases);
        aliases = Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
      } catch {
        aliases = rawAliases.split(/[|;；]/).map((value) => value.trim()).filter(Boolean);
      }
    }
    const activeValue = get(values, activeIndex).toLowerCase();
    return {
      sourceTerm,
      translatedTerm,
      category,
      aliases: [...new Set(aliases.map((value) => value.trim()).filter((value) => value && value !== sourceTerm))],
      notes: get(values, notesIndex),
      isActive: activeValue ? !['false', '0', 'no', 'off', 'ปิด'].includes(activeValue) : true,
      rowNumber: index + 2,
    };
  });
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

const dictionaryCache = new Map<string, { entries?: GlobalDictionaryEntry[]; pending?: Promise<GlobalDictionaryEntry[]> }>();
const dictionaryVersions = new WeakMap<GlobalDictionaryEntry[], number>();
let nextDictionaryVersion = 1;
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

async function getSessionUserId(): Promise<string> {
  const { data, error } = await getSupabase().auth.getSession();
  if (error || !data.session?.user) throw new Error('กรุณาเข้าสู่ระบบก่อนใช้คลังคำศัพท์พื้นฐาน');
  return data.session.user.id;
}

const DICTIONARY_PAGE_SIZE = 1000;

async function fetchDictionaryRows(activeOnly: boolean): Promise<DictionaryRow[]> {
  const rows: DictionaryRow[] = [];
  for (let from = 0; ; from += DICTIONARY_PAGE_SIZE) {
    let request = getSupabase()
      .from('global_dictionary_entries')
      .select('id, source_term, translated_term, category, aliases, notes, is_active, created_at, updated_at')
      .order('source_term', { ascending: true })
      .range(from, from + DICTIONARY_PAGE_SIZE - 1);
    if (activeOnly) request = request.eq('is_active', true);
    const { data, error } = await request;
    if (error) throw error;
    const batch = (data ?? []) as DictionaryRow[];
    rows.push(...batch);
    if (batch.length < DICTIONARY_PAGE_SIZE) break;
  }
  return rows;
}

/** Loads active entries once per signed-in account. Pass true after an explicit refresh. */
export async function loadGlobalDictionaryEntries(forceRefresh = false): Promise<GlobalDictionaryEntry[]> {
  const userId = await getSessionUserId();
  const cached = dictionaryCache.get(userId);
  if (!forceRefresh && cached?.entries) return cached.entries;
  if (!forceRefresh && cached?.pending) return cached.pending;

  const pending = (async () => {
    const entries = (await fetchDictionaryRows(true)).map(mapRow);
    dictionaryVersions.set(entries, nextDictionaryVersion++);
    dictionaryCache.set(userId, { entries });
    return entries;
  })();
  dictionaryCache.set(userId, { pending });

  try {
    return await pending;
  } catch (error) {
    if (dictionaryCache.get(userId)?.pending === pending) dictionaryCache.delete(userId);
    throw error;
  }
}

/** Lists active and inactive rows for the dictionary management screen. */
export async function listGlobalDictionaryEntries(): Promise<GlobalDictionaryEntry[]> {
  return (await fetchDictionaryRows(false)).map(mapRow);
}

async function findDictionaryConflicts(
  candidate: { id?: string; sourceTerm: string; translatedTerm: string; aliases: string[] },
): Promise<string[]> {
  const existing = await listGlobalDictionaryEntries();
  const candidateKeys = [candidate.sourceTerm, ...candidate.aliases]
    .map(normalizeDictionaryKey).filter(Boolean);
  const conflicts: string[] = [];
  for (const entry of existing) {
    if (entry.id === candidate.id) continue;
    const existingKeys = [entry.sourceTerm, ...entry.aliases].map(normalizeDictionaryKey);
    const shared = candidateKeys.filter((key) => existingKeys.includes(key));
    const exactSourceAlreadyExists = normalizeDictionaryKey(entry.sourceTerm) === normalizeDictionaryKey(candidate.sourceTerm);
    if (exactSourceAlreadyExists) {
      conflicts.push('คำต้นฉบับ “' + candidate.sourceTerm + '” มีอยู่ในคลังแล้ว');
    } else if (shared.length && entry.translatedTerm !== candidate.translatedTerm) {
      conflicts.push('คำว่า ' + shared[0] + ' ถูกกำหนดให้แปลเป็น “' + entry.translatedTerm + '” อยู่แล้ว');
    }
  }
  return [...new Set(conflicts)];
}

export async function analyzeGlobalDictionaryImport(
  rows: GlobalDictionaryImportRow[],
): Promise<GlobalDictionaryImportAnalysis> {
  const existing = await listGlobalDictionaryEntries();
  const registry = new Map<string, { translatedTerm: string; sourceTerm: string }>();
  for (const entry of existing) {
    for (const value of [entry.sourceTerm, ...entry.aliases]) {
      const key = normalizeDictionaryKey(value);
      if (key) registry.set(key, { translatedTerm: entry.translatedTerm, sourceTerm: entry.sourceTerm });
    }
  }

  const accepted: GlobalDictionaryImportRow[] = [];
  const conflicts: GlobalDictionaryImportConflict[] = [];
  let duplicates = 0;
  const seenSources = new Map<string, string>();

  for (const row of rows) {
    const sourceKey = normalizeDictionaryKey(row.sourceTerm);
    const previousTarget = seenSources.get(sourceKey);
    if (previousTarget !== undefined) {
      if (previousTarget === row.translatedTerm) duplicates += 1;
      else conflicts.push({ rowNumber: row.rowNumber, sourceTerm: row.sourceTerm, reason: 'คำต้นฉบับซ้ำในไฟล์ แต่กำหนดคำแปลไม่ตรงกัน' });
      continue;
    }
    seenSources.set(sourceKey, row.translatedTerm);

    const keys = [...new Set([row.sourceTerm, ...row.aliases].map(normalizeDictionaryKey).filter(Boolean))];
    const mismatch = keys.map((key) => ({ key, existing: registry.get(key) }))
      .find(({ existing: match }) => match && match.translatedTerm !== row.translatedTerm);
    if (mismatch) {
      conflicts.push({
        rowNumber: row.rowNumber,
        sourceTerm: row.sourceTerm,
        reason: 'คำว่า ' + mismatch.key + ' ชนกับรายการ “' + mismatch.existing!.sourceTerm + '” ซึ่งแปลต่างกัน',
      });
      continue;
    }

    const exactExisting = existing.find((entry) => normalizeDictionaryKey(entry.sourceTerm) === sourceKey);
    if (exactExisting) {
      duplicates += 1;
      continue;
    }

    accepted.push(row);
    for (const key of keys) registry.set(key, { translatedTerm: row.translatedTerm, sourceTerm: row.sourceTerm });
  }
  return { accepted, duplicates, conflicts };
}

export async function importGlobalDictionaryEntries(rows: GlobalDictionaryImportRow[]): Promise<number> {
  if (!rows.length) return 0;
  const userId = await getCurrentUserId();
  const analysis = await analyzeGlobalDictionaryImport(rows);
  if (analysis.conflicts.length) throw new Error('นำเข้าไม่ได้: ยังมีคำศัพท์ชนกัน กรุณาตรวจสอบรายการก่อน');
  if (!analysis.accepted.length) return 0;

  const payload = analysis.accepted.map((row) => ({
    user_id: userId,
    source_term: row.sourceTerm.trim(),
    translated_term: row.translatedTerm.trim(),
    category: row.category,
    aliases: row.aliases,
    notes: row.notes,
    is_active: row.isActive,
  }));
  const { error } = await getSupabase().from('global_dictionary_entries').insert(payload);
  if (error) throw error;
  invalidateGlobalDictionaryCache();
  return payload.length;
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
  const aliases = [...new Set(input.aliases.map((value) => value.trim()).filter((value) => value && normalizeDictionaryKey(value) !== normalizeDictionaryKey(sourceTerm)))];
  const conflicts = await findDictionaryConflicts({ id: input.id, sourceTerm, translatedTerm, aliases });
  if (conflicts.length) throw new Error(conflicts.join(' / '));
  const userId = await getCurrentUserId();
  const payload = {
    user_id: userId,
    source_term: sourceTerm,
    translated_term: translatedTerm,
    category: input.category,
    aliases,
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
  dictionaryCache.clear();
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
  const dictionaryVersion = dictionaryVersions.get(entries) ?? 0;
  const cacheKey = dictionaryVersion + '#' + protectedKey;
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

  const unique = new Map<string, { term: GlobalDictionaryPromptTerm; count: number; firstStart: number }>();
  for (const match of accepted) {
    if (match.pattern.protected || !match.pattern.entry) continue;
    const source = match.pattern.text;
    const key = source + '\u0000' + match.pattern.entry.id;
    const existing = unique.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    unique.set(key, {
      term: {
        source,
        target: match.pattern.entry.translatedTerm,
        ...(match.pattern.entry.notes ? { note: match.pattern.entry.notes.slice(0, 160) } : {}),
      },
      count: 1,
      firstStart: match.start,
    });
  }

  // Bound dictionary context so an unusually dense chapter cannot consume the
  // model's input budget. Repeated terms are prioritized, then first appearance.
  const ranked = [...unique.values()].sort((a, b) => b.count - a.count || a.firstStart - b.firstStart);
  const selected: GlobalDictionaryPromptTerm[] = [];
  let contextChars = 2;
  for (const item of ranked) {
    if (selected.length >= 100) break;
    const itemChars = JSON.stringify(item.term).length + (selected.length ? 1 : 0);
    if (contextChars + itemChars > 6000) continue;
    selected.push(item.term);
    contextChars += itemChars;
  }
  return selected;
}
