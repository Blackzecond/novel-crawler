import { NextRequest, NextResponse } from 'next/server';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || !body.url) {
      return NextResponse.json({ error: 'กรุณาระบุ URL' }, { status: 400 });
    }

    // 1. จำลอง Headers ให้เหมือน Chrome บน Windows
    const response = await fetch(body.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
        'Upgrade-Insecure-Requests': '1',
      },
      redirect: 'follow',
    });

    // 2. ดักจับกรณีติด Cloudflare (403/503)
    if (!response.ok) {
      const status = response.status;
      if (status === 403 || status === 503) {
        return NextResponse.json(
          { error: `ถูกเว็บต้นทางบล็อก (Status ${status}): เว็บนี้ติด Cloudflare/Anti-Bot บล็อก IP ของ Vercel Server` },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: `เว็บต้นทางปฏิเสธการเชื่อมต่อ (Status ${status})` },
        { status: 400 }
      );
    }

    const html = await response.text();

    // 3. ตรวจสอบว่าได้ HTML หน้าเนื้อหา หรือได้หน้า Captcha
    if (html.includes('Just a moment...') || html.includes('cf-challenge') || html.includes('enable JavaScript')) {
      return NextResponse.json(
        { error: 'ติดหน้าตรวจจับ Bot (Cloudflare Challenge) ของเว็บต้นทาง ไม่สามารถดึงเนื้อหาตรงๆ ได้' },
        { status: 400 }
      );
    }

    // 4. แปลง HTML ด้วย JSDOM และ Readability
    const dom = new JSDOM(html, { url: body.url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article || !article.content) {
      return NextResponse.json(
        { error: 'ดึงหน้าเว็บได้ แต่ไม่พบข้อความหลัก (เป็นไปได้ว่าเว็บใช้ JavaScript โหลดเนื้อหาทีหลัง)' },
        { status: 422 }
      );
    }

    return NextResponse.json({
      title: article.title || 'ไม่มีชื่อเรื่อง',
      content: article.content,
    });

  } catch (error: any) {
    // พ่นข้อความ Error ที่แท้จริงออกมาแสดงบนหน้าจอ
    return NextResponse.json(
      { error: `Server Exception: ${error.name || 'Error'} - ${error.message || String(error)}` },
      { status: 500 }
    );
  }
}
