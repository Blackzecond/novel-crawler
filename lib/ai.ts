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
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * แปลนิยายหนึ่งตอนด้วยคำขอเดียว เพื่อรักษาบริบทและความต่อเนื่องตลอดทั้งตอน.
 * ไม่แบ่งข้อความหรือ retry ด้วยการตัดข้อความเป็นส่วนย่อย หากชนเพดานจะแจ้งข้อผิดพลาด.
 */
export async function translateNovelText(
  text: string,
  settings?: AiDetectSettings,
  glossary: Record<string, string> = {},
): Promise<string> {
  const cfg = settings ?? loadAiSettings();
  if (!cfg.apiKey.trim()) throw new Error('AI_NOT_CONFIGURED');
  if (!text.trim()) throw new Error('ไม่มีเนื้อหาสำหรับแปล');

  const relevantGlossary = Object.fromEntries(
    Object.entries(glossary).filter(([source, target]) => source.trim() && target.trim() && text.includes(source)),
  );
  const systemPrompt = [
    'คุณเป็นนักแปลนิยายจีนเป็นภาษาไทยระดับมืออาชีพ เชี่ยวชาญนิยายเว็บจีนร่วมสมัยและนิยายแนวเซียน/แฟนตาซี',
    'งานของคุณคือแปลต้นฉบับภาษาจีนทั้งตอนเป็นภาษาไทย โดยต้องรักษาความหมายและรายละเอียดของต้นฉบับ พร้อมเรียบเรียงให้เป็นภาษาไทยที่เป็นธรรมชาติ',
    '',
    'หลักการแปลที่ต้องปฏิบัติตาม:',
    '1. อ่านและทำความเข้าใจต้นฉบับทั้งตอนก่อนแปล ใช้บริบทของทั้งตอนตัดสินความหมายของคำ สรรพนาม ศัพท์เฉพาะ และบทสนทนา',
    '2. แปลตามความหมายและบริบท ไม่ถอดโครงสร้างประโยคจีนมาเรียงเป็นภาษาไทยตรง ๆ หากทำให้ภาษาไทยแข็งหรือผิดธรรมชาติ แต่ห้ามเปลี่ยนสาระของประโยค',
    '3. ใช้ภาษาไทยที่กระชับ ชัดเจน เป็นสำนวนเล่านิยาย ไม่ใช้ภาษาทื่อแบบแปลคำต่อคำ ไม่ใช้คำฟุ่มเฟือยหรือขยายความเกินต้นฉบับ',
    '4. ห้ามแต่งเติมอารมณ์ ความคิด คำอธิบาย เหตุผล เหตุการณ์ หรือรายละเอียดที่ต้นฉบับไม่มี และห้ามตัดทอนข้อความแม้เห็นว่าเป็นคำซ้ำ',
    '5. รักษาลำดับย่อหน้า ลำดับเหตุการณ์ บทสนทนา น้ำเสียง และระดับภาษาของตัวละครตามต้นฉบับ',
    '6. ไม่แปลชื่อบุคคลเป็นความหมาย ไม่แทรกช่องว่างกลางชื่อเต็ม และใช้รูปสะกดชื่อเดิมให้เหมือนกันตลอดทั้งตอน หากมีชื่อใน Glossary ให้ใช้ตามนั้นทุกครั้ง',
    '7. แปลศัพท์เฉพาะตามหน้าที่และบริบทในเรื่อง อย่าสับสนคำที่มีความหมายใกล้กัน เช่น พลัง จิตสัมผัส กลิ่นอาย ลมหายใจ และพลังปราณ ต้องไม่เหมารวมเป็นคำเดียว',
    '8. หลีกเลี่ยงคำอังกฤษ คำทับศัพท์สมัยใหม่ และสำนวนภาษาพูดที่ไม่จำเป็น เมื่อมีคำไทยที่ตรงความหมายอยู่แล้วให้ใช้คำไทย',
    '9. ใช้สรรพนามและประธานเท่าที่จำเป็น ภาษาไทยสามารถละประธานได้เมื่อบริบทชัดเจน อย่าเติมคำว่า เขา หรือชื่อซ้ำทุกประโยคโดยไม่จำเป็น',
    '10. ตรวจทานคำแปลกับต้นฉบับทั้งตอนก่อนส่ง โดยตรวจความครบถ้วน ความถูกต้องของความหมาย ชื่อ ศัพท์เฉพาะ และความเป็นธรรมชาติของภาษาไทย แก้เฉพาะจุดที่ผิดหรือแข็งเกินไปโดยไม่แต่งใหม่',
    '',
    'แนวทางศัพท์จากบริบทนิยาย:',
    '- 妖獸 ใช้ อสูร เว้นแต่ Glossary กำหนดไว้เป็นอย่างอื่น',
    '- 神念 หมายถึงสัมผัสรับรู้ทางจิตในบริบทการฝึกตน ให้ใช้ จิตสัมผัส เว้นแต่ Glossary กำหนดคำเฉพาะไว้',
    '- 收斂氣息 ในบริบทซ่อนตัว/ปกปิดพลัง ให้สื่อว่าเก็บกลิ่นอายหรือปกปิดกลิ่นอาย ไม่แปลตรงตัวเป็นการเก็บลมหายใจ',
    '- 漣漪 หมายถึงระลอกคลื่นบนผิวน้ำ ไม่ใช่คลื่นสั่น',
    '- เลือกคำตามบริบทเสมอ หาก Glossary ระบุคำแปลไว้ให้ยึด Glossary เป็นหลัก',
    'ส่งเฉพาะคำแปลภาษาไทยฉบับสมบูรณ์ทั้งตอน ห้ามส่งคำเกริ่น คำอธิบาย หมายเหตุ หรือข้อความภาษาจีน',
    ...(Object.keys(relevantGlossary).length
      ? ['Glossary ต่อไปนี้เป็นข้อกำหนดบังคับสำหรับคำที่ระบุ ต้องใช้รูปภาษาไทยตามนี้อย่างสม่ำเสมอ:', JSON.stringify(relevantGlossary)]
      : []),
  ].join('\n');

  // Estimate a sufficient completion budget for the whole chapter, within Qwen 3.8 27B's 16K output ceiling.
  const maxTokens = Math.min(16_384, Math.max(2_048, Math.ceil(text.length * 2)));

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
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
      }),
    });

    if (response.ok) break;
    detail = await response.text().catch(() => '');
    const isOutputRateLimit = response.status === 429 && /output tokens per minute|OTPM|requested\s+\d+/i.test(detail);
    if (!isOutputRateLimit || attempt === 4) {
      throw new Error('AI_API_ERROR:' + response.status + ' ' + detail.slice(0, 500));
    }

    const retryAfterHeader = Number(response.headers.get('retry-after'));
    const retryAfterMessage = detail.match(/try again in\s+([\d.]+)\s*(ms|milliseconds|s|seconds?)/i);
    const messageDelay = retryAfterMessage
      ? Number(retryAfterMessage[1]) * (/^(ms|milliseconds)$/i.test(retryAfterMessage[2]) ? 1 : 1000)
      : 0;
    const waitMs = retryAfterHeader > 0
      ? Math.max(250, retryAfterHeader * 1000)
      : messageDelay > 0
        ? Math.max(250, messageDelay + 250)
        : 5000;
    await wait(waitMs);
  }

  if (!response?.ok) {
    throw new Error('AI_API_ERROR:429 ' + detail.slice(0, 500));
  }

  const data = await response.json();
  const choice = data?.choices?.[0];
  const translated = choice?.message?.content;
  if (choice?.finish_reason === 'length') {
    throw new Error(
      'AI_TRANSLATION_TRUNCATED:โมเดลส่งคำแปลมาไม่ครบทั้งตอน แม้ส่งต้นฉบับเป็นคำขอเดียวแล้ว เพดาน output ของโมเดลหรือโควตาอาจไม่เพียงพอ กรุณาใช้โมเดลหรือแพ็กเกจที่รองรับ output tokens สูงขึ้น',
    );
  }
  if (typeof translated !== 'string' || !translated.trim()) {
    throw new Error('AI ไม่ส่งคำแปลกลับมา');
  }

  return translated.trim();
}

/**
 * บรรณาธิการ AI ตรวจแก้คำแปลทั้งตอนเทียบกับต้นฉบับในคำขอเดียว
 * เป็นขั้นตอนแยกที่ผู้ใช้เรียกเอง ไม่ทำงานอัตโนมัติและไม่แบ่งตอน
 */
export async function editNovelTranslation(
  sourceText: string,
  draftTranslation: string,
  settings?: AiDetectSettings,
  glossary: Record<string, string> = {},
): Promise<string> {
  const cfg = settings ?? loadAiSettings();
  if (!cfg.apiKey.trim()) throw new Error('AI_NOT_CONFIGURED');
  if (!sourceText.trim() || !draftTranslation.trim()) throw new Error('ไม่มีต้นฉบับหรือคำแปลสำหรับตรวจแก้');

  const relevantGlossary = Object.fromEntries(
    Object.entries(glossary).filter(([source, target]) => source.trim() && target.trim() && sourceText.includes(source)),
  );
  const systemPrompt = [
    'คุณเป็นบรรณาธิการภาษาไทยผู้เชี่ยวชาญด้านนิยายแปลจีน หน้าที่คือพิสูจน์อักษรและตรวจแก้คำแปลภาษาไทยโดยเทียบกับต้นฉบับภาษาจีนที่ให้มา',
    'แก้เฉพาะข้อผิดพลาดที่ตรวจพบได้ ได้แก่ แปลผิดความหมาย แปลตกหล่น เติมเนื้อหาเอง ชื่อหรือศัพท์เฉพาะไม่สม่ำเสมอ ไวยากรณ์ไทยผิด และสำนวนแปลตรงตัวที่ผิดธรรมชาติ',
    'รักษาความหมาย รายละเอียด น้ำเสียง ลำดับย่อหน้า บทสนทนา และรูปแบบของต้นฉบับอย่างเคร่งครัด',
    'ห้ามแต่งสำนวนใหม่เพื่อความสวยงาม ห้ามเพิ่มอารมณ์หรือคำอธิบาย ห้ามสรุป ห้ามย่อ และห้ามตัดข้อความที่ถูกต้องอยู่แล้ว',
    'หากประโยคเดิมถูกต้องและเป็นธรรมชาติอยู่แล้ว ให้คงไว้ ไม่ต้องเปลี่ยนเพียงเพื่อให้ดูแตกต่าง',
    'ห้ามเดาความหมายที่ต้นฉบับไม่รองรับ หากจุดใดกำกวมให้รักษาความหมายอย่างระมัดระวัง ไม่สร้างข้อมูลเพิ่ม',
    'ชื่อบุคคลต้องเขียนติดกัน ไม่เว้นวรรคกลางชื่อ และต้องใช้ Glossary ตามที่กำหนด',
    'ส่งคืนคำแปลภาษาไทยฉบับแก้ไขครบทั้งตอนเท่านั้น ห้ามส่งคำอธิบาย รายงานการแก้ไข หรือข้อความภาษาจีน',
    ...(Object.keys(relevantGlossary).length
      ? ['Glossary บังคับ:', JSON.stringify(relevantGlossary)]
      : []),
  ].join('\n');
  const maxTokens = Math.min(16_384, Math.max(2_048, Math.ceil(sourceText.length * 2)));

  const response = await fetch(cfg.baseUrl.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + cfg.apiKey.trim(),
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.1,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: 'ต้นฉบับภาษาจีนทั้งตอน:\n' + sourceText + '\n\nคำแปลภาษาไทยฉบับร่างที่ต้องตรวจแก้ทั้งตอน:\n' + draftTranslation,
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error('AI_EDITOR_API_ERROR:' + response.status + ' ' + detail.slice(0, 500));
  }
  const data = await response.json();
  const choice = data?.choices?.[0];
  const edited = choice?.message?.content;
  if (choice?.finish_reason === 'length') {
    throw new Error('AI_EDITOR_TRUNCATED:คำแก้ไขไม่ครบทั้งตอน กรุณาใช้โมเดลหรือแพ็กเกจที่รองรับ output tokens สูงขึ้น');
  }
  if (typeof edited !== 'string' || !edited.trim()) throw new Error('AI บรรณาธิการไม่ส่งคำแก้ไขกลับมา');
  return edited.trim();
}
