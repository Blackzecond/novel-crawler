// AI provider layer for Novel Crawler.
// API keys remain in this browser's localStorage. Gemini uses the native Interactions API; other providers use OpenAI-compatible Chat Completions.

export interface AiDetectSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export type AiProvider = 'gemini' | 'qwen' | 'custom';

export const AI_PROVIDER_PRESETS: Record<Exclude<AiProvider, 'custom'>, { label: string; baseUrl: string; model: string }> = {
  gemini: {
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1/interactions',
    model: 'gemini-3.8-flash',
  },
  qwen: {
    label: 'Alibaba Qwen',
    baseUrl: 'https://trial.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.8-max',
  },
};

export function normalizeAiBaseUrl(baseUrl: string): string {
  if (baseUrl.toLowerCase().includes('generativelanguage.googleapis.com')) {
    return AI_PROVIDER_PRESETS.gemini.baseUrl;
  }
  return baseUrl;
}

export function inferAiProvider(baseUrl: string): AiProvider {
  const normalized = baseUrl.toLowerCase();
  if (normalized.includes('generativelanguage.googleapis.com')) return 'gemini';
  if (normalized.includes('maas.aliyuncs.com') || normalized.includes('dashscope')) return 'qwen';
  return 'custom';
}

export interface AiDetectPair {
  zh: string;
  th: string;
}

export const AI_SETTINGS_KEY = 'novel_ai_settings_v1';

export const defaultAiSettings: AiDetectSettings = {
  baseUrl: AI_PROVIDER_PRESETS.gemini.baseUrl,
  apiKey: '',
  model: AI_PROVIDER_PRESETS.gemini.model,
};

export function loadAiSettings(): AiDetectSettings {
  if (typeof window === 'undefined') return { ...defaultAiSettings };
  try {
    const raw = window.localStorage.getItem(AI_SETTINGS_KEY);
    if (!raw) return { ...defaultAiSettings };
    const parsed = JSON.parse(raw);
    return {
      baseUrl: typeof parsed.baseUrl === 'string' && parsed.baseUrl ? normalizeAiBaseUrl(parsed.baseUrl) : defaultAiSettings.baseUrl,
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

async function requestChatCompletion(
  settings: AiDetectSettings,
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  maxTokens?: number,
  temperature = 0.2,
): Promise<{ content: string; finishReason: string | null }> {
  if (!settings.apiKey.trim()) throw new Error('AI_NOT_CONFIGURED');

  if (inferAiProvider(settings.baseUrl) === 'gemini') {
    const systemInstruction = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n');
    const input = messages.filter((message) => message.role === 'user').map((message) => message.content).join('\n\n');
    const response = await fetch(AI_PROVIDER_PRESETS.gemini.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': settings.apiKey.trim(),
      },
      body: JSON.stringify({
        model: settings.model,
        ...(systemInstruction ? { system_instruction: systemInstruction } : {}),
        input,
        store: false,
        generation_config: {
          ...(maxTokens ? { max_output_tokens: maxTokens } : {}),
          thinking_level: 'low',
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error('AI_API_ERROR:' + response.status + ' ' + detail.slice(0, 500));
    }

    const data = await response.json();
    const outputText = typeof data?.output_text === 'string' ? data.output_text : '';
    const collectText = (value: any): string => {
      if (typeof value === 'string') return value;
      if (Array.isArray(value)) return value.map(collectText).join('');
      if (!value || typeof value !== 'object') return '';
      if (typeof value.text === 'string') return value.text;
      if (typeof value.content === 'string') return value.content;
      if (Array.isArray(value.content)) return collectText(value.content);
      return '';
    };
    const content = outputText || collectText(data?.steps) || collectText(data?.output);
    if (!content.trim()) {
      const status = typeof data?.status === 'string' ? data.status : 'unknown';
      throw new Error('AI ไม่ส่งข้อความกลับมา (Interactions status: ' + status + ')');
    }
    return {
      content: content.trim(),
      finishReason: typeof data?.status === 'string' ? data.status : null,
    };
  }

  const response = await fetch(settings.baseUrl.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + settings.apiKey.trim(),
    },
    body: JSON.stringify({
      model: settings.model,
      temperature,
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      ...(inferAiProvider(settings.baseUrl) !== 'custom' ? { reasoning_effort: 'low' } : {}),
      messages,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error('AI_API_ERROR:' + response.status + ' ' + detail.slice(0, 500));
  }

  const data = await response.json();
  const choice = data?.choices?.[0];
  const raw = choice?.message?.content;
  const content = typeof raw === 'string'
    ? raw
    : Array.isArray(raw)
      ? raw.map((part: any) => typeof part?.text === 'string' ? part.text : '').join('')
      : '';
  if (!content.trim()) throw new Error('AI ไม่ส่งข้อความกลับมา');
  return { content: content.trim(), finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null };
}

/** ทดสอบการเชื่อมต่อผ่าน adapter ของ Provider ที่เลือก */
export async function testAiConnection(settings: AiDetectSettings): Promise<string> {
  const result = await requestChatCompletion(
    settings,
    [{ role: 'user', content: 'Reply with exactly: OK' }],
    64,
    0,
  );
  return result.content;
}

function estimateOutputTokens(text: string): number {
  // Reserve a generous output budget for Thai prose; provider limits still apply.
  return Math.min(65_536, Math.max(4_096, Math.ceil(text.length * 2.5)));
}

/**
 * ตรวจชื่อตัวละคร/ศัพท์เฉพาะจากเนื้อหาบทจีน แล้วถอดเสียง/แปลเป็นไทยพร้อมกัน
 * คืน [] ถ้าไม่พบ — ผู้เรียกเป็นตัวต่อที่เก็บ glossary ของโปรเจกต์ (dedupe ที่จุดเรียก)
 */
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

  const result = await requestChatCompletion(
    cfg,
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content },
    ],
    2048,
    0,
  );
  const message = result.content;
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
 * แปลนิยายหนึ่งตอนด้วยคำขอเดียว ไม่แบ่งข้อความหรือ retry ด้วยการตัดข้อความเป็นส่วนย่อย
 * รับ glossary ของโปรเจกต์เพื่อรักษาชื่อและศัพท์เฉพาะให้สม่ำเสมอ
 */
export async function translateNovelText(
  text: string,
  settings?: AiDetectSettings,
  glossary: Record<string, string> = {},
): Promise<string> {
  const cfg = settings ?? loadAiSettings();
  if (!text.trim()) throw new Error('ไม่มีเนื้อหาสำหรับแปล');

  const relevantGlossary = Object.fromEntries(
    Object.entries(glossary).filter(([source, target]) => source.trim() && target.trim() && text.includes(source)),
  );
  const systemPrompt = [
    'คุณเป็นนักแปลนิยายจีนเป็นภาษาไทยระดับมืออาชีพ เชี่ยวชาญนิยายเว็บจีนร่วมสมัยและนิยายแนวเซียน/แฟนตาซี',
    'แปลต้นฉบับภาษาจีนทั้งตอนเป็นภาษาไทย โดยรักษาความหมาย รายละเอียด และบริบทของต้นฉบับ',
    'อ่านและทำความเข้าใจต้นฉบับทั้งตอนก่อนแปล ใช้บริบทของทั้งตอนตัดสินความหมายของคำ สรรพนาม ศัพท์เฉพาะ และบทสนทนา',
    'ใช้ภาษาไทยที่กระชับ เป็นธรรมชาติแบบนิยายแปล ห้ามถอดโครงสร้างประโยคจีนจนภาษาไทยแข็งหรือผิดธรรมชาติ',
    'ห้ามแต่งเติมอารมณ์ ความคิด คำอธิบาย เหตุผล เหตุการณ์ หรือรายละเอียดที่ต้นฉบับไม่มี และห้ามตัดทอนข้อความแม้เห็นว่าเป็นคำซ้ำ',
    'รักษาลำดับย่อหน้า ลำดับเหตุการณ์ บทสนทนา น้ำเสียง และระดับภาษาของตัวละครตามต้นฉบับ',
    'ชื่อบุคคลต้องเขียนติดกัน ไม่เว้นวรรคกลางชื่อ และใช้รูปสะกดเดิมให้เหมือนกันตลอดทั้งตอน',
    'แปลศัพท์เฉพาะตามหน้าที่และบริบท อย่าเหมารวมคำที่มีความหมายต่างกัน เช่น จิตสัมผัส กลิ่นอาย ลมหายใจ และพลังปราณ',
    'หลีกเลี่ยงคำอังกฤษและสำนวนภาษาพูดที่ไม่จำเป็น ใช้คำไทยเมื่อมีคำที่ตรงความหมาย',
    'ใช้สรรพนามและประธานเท่าที่จำเป็น สามารถละประธานได้เมื่อบริบทชัดเจน',
    'ส่งเฉพาะคำแปลภาษาไทยทั้งตอน ห้ามส่งคำเกริ่น คำอธิบาย หมายเหตุ หรือข้อความภาษาจีน',
    ...(Object.keys(relevantGlossary).length
      ? ['Glossary ต่อไปนี้เป็นข้อกำหนดบังคับ ต้องใช้รูปภาษาไทยตามนี้อย่างสม่ำเสมอ:', JSON.stringify(relevantGlossary)]
      : []),
  ].join('\n');

  const result = await requestChatCompletion(
    cfg,
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text },
    ],
    estimateOutputTokens(text),
    0.2,
  );
  return result.content;
}

/**
 * AI บรรณาธิการตรวจคำแปลไทยทั้งตอนเทียบกับต้นฉบับจีนทั้งตอนในคำขอเดียว
 * ผู้ใช้เป็นผู้กดเรียกเอง ไม่มีการทำงานอัตโนมัติ และไม่แบ่งตอน
 */
export async function editNovelTranslation(
  sourceText: string,
  draftTranslation: string,
  settings?: AiDetectSettings,
  glossary: Record<string, string> = {},
): Promise<string> {
  const cfg = settings ?? loadAiSettings();
  if (!sourceText.trim() || !draftTranslation.trim()) {
    throw new Error('ไม่มีต้นฉบับหรือคำแปลสำหรับตรวจแก้');
  }

  const relevantGlossary = Object.fromEntries(
    Object.entries(glossary).filter(([source, target]) => source.trim() && target.trim() && sourceText.includes(source)),
  );
  const systemPrompt = [
    'คุณเป็นบรรณาธิการภาษาไทยผู้เชี่ยวชาญด้านนิยายแปลจีน หน้าที่คือพิสูจน์อักษรและตรวจแก้คำแปลโดยเทียบกับต้นฉบับจีน',
    'แก้เฉพาะข้อผิดพลาดที่ตรวจพบได้ ได้แก่ แปลผิดความหมาย แปลตกหล่น เติมเนื้อหาเอง ชื่อหรือศัพท์เฉพาะไม่สม่ำเสมอ ไวยากรณ์ไทยผิด และสำนวนแปลตรงตัวที่ผิดธรรมชาติ',
    'รักษาความหมาย รายละเอียด น้ำเสียง ลำดับย่อหน้า บทสนทนา และรูปแบบของต้นฉบับอย่างเคร่งครัด',
    'ห้ามแต่งสำนวนใหม่เพื่อความสวยงาม ห้ามเพิ่มอารมณ์หรือคำอธิบาย ห้ามสรุป ห้ามย่อ และห้ามตัดข้อความที่ถูกต้องอยู่แล้ว',
    'หากประโยคเดิมถูกต้องและเป็นธรรมชาติอยู่แล้ว ให้คงไว้ ไม่ต้องเปลี่ยนเพียงเพื่อให้ดูแตกต่าง',
    'ห้ามเดาความหมายที่ต้นฉบับไม่รองรับ หากจุดใดกำกวมให้รักษาความหมายอย่างระมัดระวัง',
    'ชื่อบุคคลต้องเขียนติดกัน ไม่เว้นวรรคกลางชื่อ และต้องใช้ Glossary ตามที่กำหนด',
    'ส่งคืนคำแปลภาษาไทยฉบับแก้ไขครบทั้งตอนเท่านั้น ห้ามส่งคำอธิบาย รายงานการแก้ไข หรือข้อความภาษาจีน',
    ...(Object.keys(relevantGlossary).length
      ? ['Glossary บังคับ:', JSON.stringify(relevantGlossary)]
      : []),
  ].join('\n');

  const combinedInput = sourceText + '\n\n' + draftTranslation;
  const result = await requestChatCompletion(
    cfg,
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'ต้นฉบับภาษาจีนทั้งตอน:\n' + sourceText + '\n\nคำแปลภาษาไทยฉบับร่างที่ต้องตรวจแก้ทั้งตอน:\n' + draftTranslation },
    ],
    estimateOutputTokens(draftTranslation || combinedInput),
    0.1,
  );
  return result.content;
}
