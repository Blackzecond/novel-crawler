'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Bug, ExternalLink, Loader2, Network } from 'lucide-react';
import { debugNativeBrowserNetwork } from '@/lib/nativeBrowserFetch';

const DEFAULT_URL = 'https://manatoki1.org/novel/57318/6963520';
const BOOKKOR_URL = 'https://012.bookkor.com/전능의-뇌를-얻었다/2743-ep-6963520';

export default function NetworkDebugPage() {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const startInspector = async () => {
    const target = url.trim();
    if (!(target.startsWith('https://') || target.startsWith('http://'))) {
      setMessage('กรุณาระบุ URL ที่ขึ้นต้นด้วย http:// หรือ https://');
      return;
    }
    setBusy(true);
    setMessage('กำลังเปิด WebView Network Inspector…');
    try {
      const opened = await debugNativeBrowserNetwork(target);
      setMessage(opened
        ? 'ปิดหน้าต่าง Network Inspector แล้ว กลับมาที่หน้านี้ได้เลย'
        : 'เครื่องมือนี้ใช้ได้ในแอป Android ของ Novel Crawler เท่านั้น');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'เปิด Network Inspector ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-bg text-fg">
      <header className="sticky top-0 z-20 border-b border-line bg-card/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Link href="/" aria-label="กลับหน้าหลัก" className="rounded-lg p-2 text-muted hover:bg-surface hover:text-fg">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0">
            <h1 className="font-semibold">WebView Network Inspector</h1>
            <p className="text-xs text-muted">เครื่องมือ Debug ชั่วคราวสำหรับตรวจการโหลดเนื้อหานิยาย</p>
          </div>
          <Bug className="ml-auto h-5 w-5 text-muted" />
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        <section className="rounded-2xl border border-line bg-card p-4 sm:p-5">
          <div className="mb-3 flex items-center gap-2 font-semibold">
            <Network className="h-5 w-5" /> ตรวจเว็บต้นทาง
          </div>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setUrl(DEFAULT_URL)} className="rounded-lg border border-line px-3 py-2 text-xs font-medium">Manatoki · ตอน 255</button>
            <button type="button" onClick={() => setUrl(BOOKKOR_URL)} className="rounded-lg border border-line px-3 py-2 text-xs font-medium">Bookkor · ตอน 255</button>
          </div>
          <label htmlFor="debug-url" className="mb-2 block text-sm text-muted">URL ของหน้าที่ต้องการตรวจ</label>
          <input
            id="debug-url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            spellCheck={false}
            className="w-full rounded-xl border border-line bg-bg px-3 py-3 text-sm"
          />
          <button
            type="button"
            onClick={() => void startInspector()}
            disabled={busy}
            className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-fg disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
            {busy ? 'กำลังเปิด…' : 'เปิดหน้าเว็บพร้อมจับ Network'}
          </button>
          {message && <p role="status" className="mt-3 text-sm text-muted">{message}</p>}
        </section>

        <section className="rounded-2xl border border-line bg-card p-4 sm:p-5">
          <h2 className="mb-2 font-semibold">วิธีทดสอบ</h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted">
            <li>เลือก Manatoki หรือ Bookkor แล้วเปิดหน้าเว็บพร้อมจับ Fetch/XHR ตั้งแต่ก่อนสคริปต์ของเว็บทำงาน</li>
            <li>รอจนเนื้อหาตอน 255 ปรากฏ หากยังไม่โหลดให้กดโหลดใหม่</li>
            <li>ดู Response ใน Log ว่ามีข้อความเกาหลีหรือ JSON หรือไม่</li>
            <li>สำหรับ Bookkor กด “ตรวจ DOM” หลังเนื้อหาปรากฏ เพื่อเก็บ innerText, textContent, HTML, ฟอนต์ และแหล่ง CSS/JS มาเทียบกัน</li>
            <li>กดคัดลอก Log แล้วนำมาส่งในแชตนี้ จากนั้นกดปิด</li>
          </ol>
        </section>

        <section className="rounded-2xl border border-amber-300/60 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950">
          <strong>หมายเหตุด้านความเป็นส่วนตัว:</strong> ตัวตรวจจับบันทึก URL, HTTP status, Content-Type และตัวอย่าง Response text สูงสุด 12,000 ตัวอักษรต่อรายการ เฉพาะ Fetch/XHR ที่เป็น origin เดียวกับหน้าเว็บเท่านั้น ส่วน DOM Snapshot จะเก็บข้อความหน้าเว็บ ตัวอย่าง HTML รายชื่อ CSS/JS และข้อมูลฟอนต์เมื่อผู้ใช้กดตรวจ DOM ไม่บันทึก Cookie หรือ Request headers และ Log อยู่ในหน่วยความจำชั่วคราวจนปิดหน้าต่าง
        </section>
      </div>
    </main>
  );
}
