import type { Metadata, Viewport } from 'next';
import { Noto_Sans_Thai, Noto_Serif_Thai } from 'next/font/google';
import './globals.css';

const thaiSans = Noto_Sans_Thai({
  subsets: ['thai', 'latin'],
  variable: '--font-thai-sans',
  display: 'swap',
});

const thaiSerif = Noto_Serif_Thai({
  subsets: ['thai', 'latin'],
  variable: '--font-thai-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Novel Translator',
  description: 'จัดการคลังนิยาย อ่านต้นฉบับ และเตรียมเนื้อหาสำหรับแปล',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Novel Translator',
  },
};

export const viewport: Viewport = {
  themeColor: '#2563eb',
  width: 'device-width',
  initialScale: 1,
  // ไม่กำหนด maximumScale — ปล่อยให้ผู้ใช้พิมใช้ zoom ได้ (accessibility)
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th" className={`${thaiSans.variable} ${thaiSerif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
