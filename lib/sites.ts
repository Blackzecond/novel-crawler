// ผู้ช่วยวิเคราะห์หน้าเว็บนิยายจีน — จับรายการบทจากหน้าสารบัญ (目录) และลิงก์ก่อนหน้า/ถัดไป
// Static extraction บน linkedom — ใช้ฝั่ง server เท่านั้น

import { parseHTML } from 'linkedom';

export interface ChapterLink {
  url: string;
  title: string;
  order: number;
}

export interface TocResult {
  novelTitle: string | null;
  chapters: ChapterLink[];
}

// ชื่อบทแบบจีน: 第...章 / 第...回 / 序章 / 楔子 / 番外 / Chapter N
const CHAPTER_TITLE_RE =
  /第\s*[0-9０-９零一二三四五六七八九十百千千万亿两]+\s*[章节回卷]|序章|楔子|番外|尾声|终章|^chapter\s*\d+/i;

const NAV_NOISE_RE =
  /^(首页|书架|加入书架|上一[页章]|下一[页章]|下部|上部|目录|全文阅读|开始阅读|投推荐票|新[书篇]|排行|榜|关于|联系|广告|登录|注册|手机阅读|电脑版|wap|附录|公告|打赏|订阅|评价|冲榜)/;

function sameSite(abs: URL, base: URL): boolean {
  if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return false;
  const a = abs.hostname.replace(/^www\d?\./, '');
  const b = base.hostname.replace(/^www\d?\./, '');
  return a === b || a.endsWith('.' + b) || b.endsWith('.' + a);
}

export function extractChapterList(html: string, baseUrl: string): TocResult {
  const empty: TocResult = { novelTitle: null, chapters: [] };
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return empty;
  }

  const { document } = parseHTML(html);

  // เก็บทุกลิงก์ภายในเว็บเดียวกัน ตัดซ้ำ url+title, ตัดลิงก์กล่องเมนู
  const seen = new Set<string>();
  const links: { url: string; title: string }[] = [];
  for (const a of Array.from(document.querySelectorAll('a')) as any[]) {
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;
    const abs = new URL(href, base);
    if (!sameSite(abs, base)) continue;
    const title = (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140);
    if (!title || title.length > 120 || NAV_NOISE_RE.test(title)) continue;
    if (abs.href === base.href) continue;
    const key = abs.href + '|' + title;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ url: abs.href, title });
  }

  // รวมกลุ่มตาม directory prefix (เช่น /book/123/) — หน้าสารบัญส่วนใหญ่ปรุงลิงก์บทไว้โฟลเดอร์เดียว
  const groups = new Map<string, { url: string; title: string }[]>();
  for (const link of links) {
    let u: URL;
    try {
      u = new URL(link.url);
    } catch {
      continue;
    }
    const segs = u.pathname.split('/').filter(Boolean);
    if (segs.length < 2) continue; // ต้องมีอย่างน้อย /book/xxx.html
    const prefix = '/' + segs.slice(0, -1).join('/');
    const arr = groups.get(prefix);
    if (arr) arr.push(link);
    else groups.set(prefix, [link]);
  }

  // เลือกกลุ่มที่คะแนนดีสุด: ใหญ่ที่สุด + เหลื่อมเพราะ ratio ชื่อบทแบบจีน
  let best: { items: { url: string; title: string }[]; score: number } | null = null;
  for (const [, items] of groups) {
    if (items.length < 6) continue;
    const uniqueUrls = new Set(items.map((i) => i.url)).size;
    if (uniqueUrls < Math.max(5, Math.floor(items.length * 0.7))) continue;
    const ratio = items.filter((i) => CHAPTER_TITLE_RE.test(i.title)).length / items.length;
    const score = items.length * (0.5 + ratio);
    if (!best || score > best.score) best = { items, score };
  }

  const chapters: ChapterLink[] = best
    ? best.items.map((item, index) => ({ url: item.url, title: item.title, order: index }))
    : [];

  // ชื่อเรื่อง: h1 ก่อน แล้ว <title> (ตัดส่วนตกแต่งของเว็บจีนทิ้ง)
  let novelTitle: string | null = null;
  const h1 = (document.querySelector('h1')?.textContent || '').replace(/\s+/g, ' ').trim();
  const rawTitle = h1 || (document.querySelector('title')?.textContent || '').trim();
  if (rawTitle) {
    const cleaned = rawTitle
      .replace(/(最新章节[列表]*|章节目录|目录|全文[免费]*阅读|无弹窗|笔趣阁.*(阅读|正文)?|章节列表).*/g, '')
      .replace(/^[《【\[「]\s*|\s*[》】\]」]$/g, '')
      .replace(/[-_|（(].*$/, '')
      .trim();
    novelTitle = cleaned || rawTitle;
  }

  return { novelTitle, chapters };
}

export function findNavigationUrls(doc: any, baseUrl: string) {
  let prevUrl: string | null = null;
  let nextUrl: string | null = null;
  const links = Array.from(doc.querySelectorAll('a'));

  for (const link of links as any[]) {
    const text = (link.textContent || '').trim().toLowerCase();
    const href = link.getAttribute('href');
    const rel = (link.getAttribute('rel') || '').toLowerCase();

    if (!href || href.startsWith('javascript:') || href === '#' || href.startsWith('mailto:')) continue;

    try {
      const absUrl = new URL(href, baseUrl).href;
      if (!prevUrl && (rel === 'prev' || /上一章|上一页|上一頁|บทก่อน|ก่อนหน้า|prev|previous/.test(text))) {
        prevUrl = absUrl;
      }
      if (!nextUrl && (rel === 'next' || /下一章|下一页|下一頁|บทถัดไป|ถัดไป|next/.test(text))) {
        nextUrl = absUrl;
      }
    } catch (e) {}
  }
  return { prevUrl, nextUrl };
}
