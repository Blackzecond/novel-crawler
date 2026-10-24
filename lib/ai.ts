// ชั้น AI พรีเมียมสำหรับโปรเจกต์แปล — วันนี้ใช้ API ที่ผู้ใช้ตั้งเอง (OpenAI-compatible)
// ตั้งค่า (base URL / โมเดล / key) อยู่ในเครื่องของผู้ใช้ผ่าน localStorage เท่านั้น
// ขอคีย์ได้ ผมจะทำ scaffold รอให้กรอกแล้วใช้ได้ทันที

export interface AiDetectSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AiDetectPair {
  zh: string;
  th: string;
}

export const AI_SETTINGS_KEY = 'novel_ai_settings_v1';

export const defaultAiSettings: AiDetectSettings = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
};

export function loadAiSettings(): AiDetectSettings {
  if (typeof window === 'undefined') return { ...defaultAiSettings };
  try {
    const raw = window.localStorage.getItem(AI_SETTINGS_KEY);
    if (!raw) return { ...defaultAiSettings };
    const parsed = JSON.parse(raw);
    return {
      baseUrl: typeof parsed.baseUrl === 'string' && parsed.baseUrl ? parsed.baseUrl : defaultAiSettings.baseUrl,
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      model: typeof parsed.model === 'string' && parsed.model ? parsed.model : defaultAiSettings.model,
    };
  } catch {
    return { ...defaultAiSettings };
  }
}

export function saveAiSettings(settings: AiDetectSettings) {
  window.localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings));
}

export function hasAiKey(settings = loadAiSettings()): boolean {
  return settings.apiKey.trim().length > 0;
}

/**
 * ตรวจชื่อตัวละคร/ศัพท์เฉพาะจากเนื้อหาบทจีน แล้วถอดเสียง/แปลเป็นไทยพร้อมกัน
 * คืน [] ถ้าไม่พบ — ผู้เรียกเป็นตัวต่อที่เก็บ glossary ของโปรเจกต์ (dedupe ที่จุดเรียก)
 */
export async function detectNamedTerms(text: string, settings?: AiDetectSettings): Promise<AiDetectPair[]> {
  const cfg = settings ?? loadAiSettings();
  if (!cfg.apiKey.trim()) {
    throw new Error('AI_NOT_CONFIGURED');
  }

  const content = text.slice(0, 6000); // ตัดเพื่อควบคุมค่าใช้จ่าย (ดึงบทคือ 5-8k ตัวอักษรพอดี)
  const systemPrompt = [
    'You are a glossary extractor for Chinese web novels.',
    'From the chapter text, extract proper nouns so a Thai translator can translate them consistently:',
    'character names (人名), nicknames/titles, sect/clan names (门派/家族), place names (地名),',
    'cultivation techniques, magic/artifact terms (功法/武功/法宝), and other recurring special terms.',
    'Do NOT include common nouns or ordinary dialogue words.',
    'For each item give: zh = the exact term as written in the text,',
    'th = the Thai name you propose (transliterate personal/licensed names, translate sect/place/artifact terms).',
    'Maximum 30 items. Respond ONLY with JSON: {"items":[{"zh":"...","th":"..."}]}',
  ].join(' ');

  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`AI_API_ERROR:${res.status} ${detail.slice(0, 200)}`);
  }

  const data = await res.json();
  const message: string = data?.choices?.[0]?.message?.content ?? '';
  const raw = message.slice(message.indexOf('{'), message.lastIndexOf('}') + 1);
  if (!raw) return [];

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const items: unknown = Array.isArray(parsed) ? parsed : parsed?.items;
  if (!Array.isArray(items)) return [];

  const seen = new Set<string>();
  const pairs: AiDetectPair[] = [];
  for (const item of items) {
    const zh = typeof item?.zh === 'string' ? item.zh.trim() : '';
    const th = typeof item?.th === 'string' ? item.th.trim() : '';
    if (!zh || !th || seen.has(zh)) continue;
    seen.add(zh);
    pairs.push({ zh, th });
  }
  return pairs;
}
