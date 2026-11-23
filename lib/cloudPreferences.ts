import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import type { ReaderSettings } from '@/lib/readerPrefs';

export interface ReadingHistoryItem {
  url: string;
  title: string;
  readAt: number;
  projectId?: string | null;
}

export interface CloudAiSettings {
  baseUrl: string;
  model: string;
}

type PreferencesRow = {
  reader_settings: Partial<ReaderSettings> | null;
  ai_settings: Partial<CloudAiSettings> | null;
  reading_history: ReadingHistoryItem[] | null;
};

async function currentUserId(expectedUserId?: string): Promise<string | null> {
  if (!isSupabaseConfigured()) {
    if (expectedUserId) throw new Error('Supabase is not configured for the expected account');
    return null;
  }
  const { data, error } = await getSupabase().auth.getUser();
  if (expectedUserId) {
    if (error) throw error;
    if (!data.user || data.user.id !== expectedUserId) {
      throw new Error('The active Supabase account no longer matches the requested account');
    }
  } else if (error || !data.user) {
    return null;
  }
  return data.user?.id ?? null;
}

async function readPreferences(expectedUserId?: string): Promise<PreferencesRow | null> {
  const userId = await currentUserId(expectedUserId);
  if (!userId) return null;
  const { data, error } = await getSupabase()
    .from('user_preferences')
    .select('reader_settings, ai_settings, reading_history')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as PreferencesRow | null) ?? null;
}

async function writePreference(column: 'reader_settings' | 'ai_settings' | 'reading_history', value: unknown) {
  const userId = await currentUserId();
  if (!userId) return;
  const supabase = getSupabase();
  // Ensure defaults exist without replacing any previously saved preference columns.
  const { error: ensureError } = await supabase.from('user_preferences')
    .upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true });
  if (ensureError) throw ensureError;
  const { error } = await supabase.from('user_preferences')
    .update({ [column]: value, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (error) throw error;
}

export async function loadCloudReaderSettings(): Promise<Partial<ReaderSettings> | null> {
  const row = await readPreferences();
  return row?.reader_settings ?? null;
}

export async function saveCloudReaderSettings(settings: ReaderSettings): Promise<void> {
  await writePreference('reader_settings', settings);
}

export async function loadCloudReadingHistory(expectedUserId?: string): Promise<ReadingHistoryItem[] | null> {
  const row = await readPreferences(expectedUserId);
  if (expectedUserId) return Array.isArray(row?.reading_history) ? row!.reading_history! : [];
  return Array.isArray(row?.reading_history) ? row!.reading_history! : null;
}

export async function saveCloudReadingHistory(history: ReadingHistoryItem[]): Promise<void> {
  await writePreference('reading_history', history.slice(0, 20));
}

export async function loadCloudAiSettings(): Promise<Partial<CloudAiSettings> | null> {
  const row = await readPreferences();
  return row?.ai_settings ?? null;
}

export async function saveCloudAiSettings(settings: CloudAiSettings): Promise<void> {
  // API keys are intentionally excluded: keep secrets in this browser only.
  await writePreference('ai_settings', { baseUrl: settings.baseUrl, model: settings.model });
}
