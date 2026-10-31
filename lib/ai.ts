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


/**
 * แปลข้อความนิยายเป็นภาษาไทยผ่าน OpenAI-compatible Chat Completions API.
 * API key อ่านจาก localStorage และส่งตรงไปยัง Base URL ที่ผู้ใช้กำหนด
 * ผลลัพธ์เป็นข้อความล้วนเพื่อให้ Reader แสดงผลอย่างปลอดภัยโดยไม่ใช้ dangerouslySetInnerHTML.
 */
function splitTranslationText(text: string, maxChars = 700): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const boundary = Math.max(
        text.lastIndexOf('。', end), text.lastIndexOf('！', end), text.lastIndexOf('？', end),
        text.lastIndexOf('；', end), text.lastIndexOf('，', end), text.lastIndexOf('.', end),
        text.lastIndexOf('!', end), text.lastIndexOf('?', end), text.lastIndexOf(';', end),
        text.lastIndexOf(',', end), text.lastIndexOf('\n', end),
      );
      if (boundary >= start + Math.floor(maxChars * 0.55)) end = boundary + 1;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks.filter((chunk) => chunk.length > 0);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * แปลข้อความนิยายเป็นภาษาไทยผ่าน OpenAI-compatible Chat Completions API.
 * แบ่งคำขอเป็นช่วง ตรวจการตัดผลลัพธ์ และรอเมื่อ Provider ปฏิเสธเพราะ OTPM.
 */
export async function translateNovelText(
  text: string,
  settings?: AiDetectSettings,
  glossary: Record<string, string> = {},
): Promise<string> {
  const cfg = settings ?? loadAiSettings();
  if (!cfg.apiKey.trim()) throw new Error('AI_NOT_CONFIGURED');
  if (!text.trim()) throw new Error('ไม่มีเนื้อหาสำหรับแปล');

  const glossaryEntries = Object.entries(glossary).filter(([source, target]) => source.trim() && target.trim());
  const glossaryInstruction = glossaryEntries.length
    ? 'Follow this glossary exactly for the listed terms. Do not change their Thai spellings:\n' +
      JSON.stringify(Object.fromEntries(glossaryEntries))
    : '';

  const systemPrompt = [
    'You are a professional Chinese-to-Thai web novel translator.',
    'Translate the supplied Chinese novel text into natural, faithful Thai.',
    'Preserve the original meaning, paragraph order, dialogue, names, titles, and formatting.',
    'Do not summarize, omit, explain, add plot details, or include the original Chinese.',
    'Use consistent Thai transliteration for proper nouns within this passage.',
    'Return only the Thai translation.',
    glossaryInstruction,
  ].filter(Boolean).join('\n');

  const chunks = splitTranslationText(text);
  const translatedChunks: string[] = [];

  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index];
    let response: Response | null = null;
    let detail = '';

    for (let attempt = 0; attempt < 5; attempt++) {
      response = await fetch(cfg.baseUrl.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + cfg.apiKey.trim(),
        },
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0.2,
          max_tokens: 900,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: chunk },
          ],
        }),
      });

      if (response.ok) break;
      detail = await response.text().catch(() => '');
      const isOutputRateLimit = response.status === 429 && /output tokens per minute|OTPM|requested\s+\d+/i.test(detail);
      if (!isOutputRateLimit || attempt === 4) {
        throw new Error('AI_API_ERROR:' + response.status + ' ' + detail.slice(0, 300));
      }

      const retryAfter = Number(response.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.max(1000, retryAfter * 1000)
        : 60_000;
      await wait(waitMs);
    }

    if (!response?.ok) {
      throw new Error('AI_API_ERROR:429 ' + detail.slice(0, 300));
    }

    const data = await response.json();
    const choice = data?.choices?.[0];
    const translated = choice?.message?.content;
    if (choice?.finish_reason === 'length') {
      throw new Error('AI_TRANSLATION_TRUNCATED:คำแปลส่วนที่ ' + (index + 1) + '/' + chunks.length + ' ถูกตัดเพราะชนเพดาน output tokens กรุณาลองใหม่หรือลดขนาดช่วงแปล');
    }
    if (typeof translated !== 'string' || !translated.trim()) {
      throw new Error('AI ไม่ส่งคำแปลกลับมาในส่วนที่ ' + (index + 1) + '/' + chunks.length);
    }
    translatedChunks.push(translated.trim());
  }

  return translatedChunks.join('\n\n');
}
