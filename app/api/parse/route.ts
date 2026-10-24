import { NextRequest, NextResponse } from 'next/server';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || !body.url) {
      return NextResponse.json({ error: 'กรุณาระบุ URL' }, { status: 400 });
    }

    const res = await fetch(body.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `ไม่สามารถดึงข้อมูลได้ (เว็บต้นทางตอบกลับ Status: ${res.status})` },
        { status: res.status }
      );
    }

    const html = await res.text();
    if (!html || html.trim().length === 0) {
      return NextResponse.json({ error: 'หน้าเว็บต้นทางไม่มีเนื้อหา HTML' }, { status: 400 });
    }

    const dom = new JSDOM(html, { url: body.url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article || !article.content) {
      return NextResponse.json({ error: 'ไม่พบเนื้อหาหลักในหน้าเว็บนี้' }, { status: 422 });
    }

    return NextResponse.json({
      title: article.title || 'ไม่มีชื่อเรื่อง',
      content: article.content,
    });
  } catch (error: any) {
    console.error('Parse API Error:', error);
    return NextResponse.json(
      { error: error.message || 'เกิดข้อผิดพลาดในการดึงข้อมูล' },
      { status: 500 }
    );
  }
}
