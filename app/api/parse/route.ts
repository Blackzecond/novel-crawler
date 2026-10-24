import { NextRequest, NextResponse } from 'next/server';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || !body.url) {
      return NextResponse.json({ error: 'กรุณาระบุ URL' }, { status: 400 });
    }

    const response = await fetch(body.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `เว็บต้นทางปฏิเสธการเชื่อมต่อ (Status: ${response.status})` },
        { status: 400 }
      );
    }

    const html = await response.text();
    if (!html || html.trim().length === 0) {
      return NextResponse.json({ error: 'หน้าเว็บต้นทางไม่มีเนื้อหา HTML' }, { status: 400 });
    }

    // ใช้ linkedom ประมวลผล DOM เบาและรองรับ Vercel Serverless 100%
    const { document } = parseHTML(html);
    const reader = new Readability(document);
    const article = reader.parse();

    if (!article || !article.content) {
      return NextResponse.json(
        { error: 'ดึงหน้าเว็บได้ แต่ไม่พบเนื้อหาหลัก (อาจเป็นเว็บที่ใช้ JavaScript โหลดเนื้อหา)' },
        { status: 422 }
      );
    }

    return NextResponse.json({
      title: article.title || 'ไม่มีชื่อเรื่อง',
      content: article.content,
    });

  } catch (error: any) {
    return NextResponse.json(
      { error: `API Internal Error: ${error.message || String(error)}` },
      { status: 500 }
    );
  }
}
