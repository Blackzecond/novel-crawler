// ค่าตั้งค่า reader (ธีม/ฟอนต์/ขนาดอักษร) ที่ต้องจำสถานะระหว่างใช้งาน
// ใช้ร่วมกันทั้ง reader และหน้าอื่นที่ต้องอ้างธีมเดียวกัน

export type ReaderTheme = 'light' | 'dark' | 'sepia';
export type ReaderFont = 'sans' | 'serif' | 'mono';

export interface ReaderSettings {
  fontSize: number;
  fontFamily: ReaderFont;
  theme: ReaderTheme;
}

export const readerDefaults: ReaderSettings = {
  fontSize: 18,
  fontFamily: 'sans',
  theme: 'light',
};

const READER_SETTINGS_KEY = 'novel_reader_settings_v1';

export function loadReaderSettings(): ReaderSettings {
  if (typeof window === 'undefined') return { ...readerDefaults };
  try {
    const raw = window.localStorage.getItem(READER_SETTINGS_KEY);
    if (!raw) return { ...readerDefaults };
    const parsed = JSON.parse(raw);
    const fontSize = Number(parsed?.fontSize);
    return {
      fontSize: Number.isFinite(fontSize) ? Math.min(28, Math.max(14, fontSize)) : readerDefaults.fontSize,
      fontFamily: ['sans', 'serif', 'mono'].includes(parsed?.fontFamily) ? parsed.fontFamily : readerDefaults.fontFamily,
      theme: ['light', 'dark', 'sepia'].includes(parsed?.theme) ? parsed.theme : readerDefaults.theme,
    };
  } catch {
    return { ...readerDefaults };
  }
}

export function saveReaderSettings(patch: Partial<ReaderSettings>) {
  const next = { ...loadReaderSettings(), ...patch };
  window.localStorage.setItem(READER_SETTINGS_KEY, JSON.stringify(next));
}

/** ตั้ง data-theme บน <html> ให้ทุกหน้าใช้ธีมเดียวกับที่บันทึกไว้ (เรียกตอน mount) */
export function applySavedTheme() {
  document.documentElement.dataset.theme = loadReaderSettings().theme;
}
