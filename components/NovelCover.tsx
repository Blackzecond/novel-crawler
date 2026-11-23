'use client';

import { useEffect, useState } from 'react';

const COVER_PALETTES = [
  ['#7f3f35', '#d39b78', '#f1d9b6'],
  ['#315b61', '#83aaa0', '#dce8d7'],
  ['#514b70', '#9b91b7', '#e7d9e8'],
  ['#755a35', '#c6a66d', '#f0e3bd'],
  ['#3e526f', '#8ea8c2', '#dce5ec'],
  ['#67504d', '#bd8e83', '#ead5c8'],
] as const;

export default function NovelCover({
  projectId,
  title,
  coverUrl,
  size = 'small',
}: {
  projectId: string;
  title: string;
  coverUrl?: string;
  size?: 'small' | 'large';
}) {
  const [readyCoverUrl, setReadyCoverUrl] = useState<string | null>(null);
  const [failedCoverUrl, setFailedCoverUrl] = useState<string | null>(null);
  const seed = Array.from(projectId).reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 7);
  const palette = COVER_PALETTES[seed % COVER_PALETTES.length];
  const mark = ['水', '山', '月', '雲', '竹', '風'][seed % 6];
  const large = size === 'large';
  const dimensions = large ? 'h-32 w-24 sm:h-40 sm:w-30' : 'h-24 w-[4.5rem]';

  // Let the page content and card layout paint before requesting remote cover images.
  // Native lazy loading then defers covers that are still outside the viewport.
  useEffect(() => {
    if (!coverUrl) return;

    const timeoutId = window.setTimeout(() => {
      setReadyCoverUrl(coverUrl);
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [coverUrl]);

  if (coverUrl && readyCoverUrl === coverUrl && failedCoverUrl !== coverUrl) {
    return (
      <div className={`relative shrink-0 overflow-hidden rounded-xl border border-black/10 bg-surface shadow-sm ${dimensions}`}>
        <img
          src={coverUrl}
          alt={`${title} 封面`}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedCoverUrl(coverUrl)}
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  return (
    <div
      role="img"
      aria-label={`${title} 的識別封面`}
      className={`relative isolate shrink-0 overflow-hidden rounded-xl border border-black/10 shadow-sm ${dimensions}`}
      style={{
        backgroundColor: palette[0],
        backgroundImage: `radial-gradient(circle at 78% 18%, ${palette[2]}99 0, transparent 35%), linear-gradient(145deg, ${palette[1]}, ${palette[0]} 72%)`,
      }}
    >
      <div aria-hidden="true" className="absolute inset-2 rounded-lg border border-white/35" />
      <div aria-hidden="true" className="absolute -right-5 -top-4 h-20 w-20 rounded-full border border-white/20" />
      <div aria-hidden="true" className="absolute -bottom-8 -left-5 h-24 w-24 rounded-full border border-white/20" />
      <div className="absolute inset-0 flex flex-col items-center justify-center text-white/90">
        <span className={`font-serif leading-none drop-shadow-sm ${large ? 'text-5xl' : 'text-3xl'}`}>{mark}</span>
        <span className={`mt-2 max-w-[80%] text-center font-medium tracking-[0.18em] ${large ? 'text-[9px]' : 'text-[7px]'}`}>NOVEL</span>
      </div>
      <span aria-hidden="true" className="absolute bottom-2 left-0 right-0 text-center text-[7px] tracking-[0.25em] text-white/70">COLLECTION</span>
    </div>
  );
}
