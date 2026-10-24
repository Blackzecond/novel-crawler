import { NextRequest, NextResponse } from 'next/server';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || !body.url) {
      return NextResponse.json({ error: 'กรุณาระบุ URL' }, { status: 400 });
    }

    const targetUrl = body.url;
    // อ่านค่า API Key จาก Environment Variable หรือใส่ API Key ตรงๆ ในเครื่องหมายคำพูดด้านล่างถ้าใช้อ่านคนเดียว
    const apiKey = process.env.SCRAPER_API_KEY || '';

    // ถ้ามี API Key จะยิงผ่าน ScraperAPI + สั่ง render=true เพื่อผ่านหน้า Cloudflare
    const fetchUrl = apiKey
      ? `https://api.scraperapi.com?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}&render=true`
      : targetUrl;

    const response = await fetch(fetchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `ไม่สามารถดึงข้อมูลได้ (Status: ${response.status})` },
        { status: 400 }
      );
    }

    const html = await response.text();

    if (html.includes('正在验证浏览器') || html.includes('cf-challenge') || html.includes('Just a moment...')) {
      return NextResponse.json(
        { error: 'ยังคงติดหน้า Cloudflare Challenge: กรุณาตรวจสอบว่าใส่ SCRAPER_API_KEY ถูกต้องหรือไม่' },
        { status: 400 }
      );
    }

    const { document } = parseHTML(html);
    const reader = new Readability(document);
    const article = reader.parse();

    if (!article || !article.content) {
      return NextResponse.json(
        { error: 'ดึงหน้าเว็บได้ แต่ไม่พบเนื้อหาหลักในหน้านี้' },
        { status: 422 }
      );
    }

    return NextResponse.json({
      title: article.title || 'ไม่มีชื่อเรื่อง',
      content: article.content,
    });

  } catch (error: any) {
    return NextResponse.json(
      { error: `API Error: ${error.message || String(error)}` },
      { status: 500 }
    );
  }
}
