'use client';

import { useEffect, useState } from 'react';
import { Check, X, Sparkles } from 'lucide-react';

export interface DetectedGlossaryItem {
  zh: string;
  th: string;
  type: 'character' | 'term';
}

export default function DetectedGlossaryModal({
  items,
  sourceLabel,
  onClose,
  onSave,
}: {
  items: DetectedGlossaryItem[];
  sourceLabel?: string;
  onClose: () => void;
  onSave: (items: DetectedGlossaryItem[]) => Promise<void>;
}) {
  const [draft, setDraft] = useState<DetectedGlossaryItem[]>(items);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(items), [items]);

  const update = (index: number, patch: Partial<DetectedGlossaryItem>) => {
    setDraft((current) => current.map((item, i) => i === index ? { ...item, ...patch } : item));
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft.filter((item) => item.zh.trim()));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-3 sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="detected-glossary-title" className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-line p-4">
          <div className="min-w-0">
            <h2 id="detected-glossary-title" className="flex items-center gap-2 text-base font-bold"><Sparkles className="h-4 w-4 text-accent" />ตรวจพบศัพท์ใหม่ {items.length} รายการ</h2>
            <p className="mt-1 text-xs text-muted">ตรวจและแก้คำแปลหรือประเภทได้ทันที{sourceLabel ? ` · ${sourceLabel}` : ''}</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="ปิดหน้าต่าง" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface disabled:opacity-40"><X className="h-4 w-4" /></button>
        </header>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {draft.map((item, index) => (
            <div key={item.zh + ':' + index} className="grid grid-cols-1 gap-2 rounded-xl border border-line bg-bg p-3 sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1.5fr)_7rem]">
              <label className="min-w-0 space-y-1">
                <span className="block text-[11px] text-muted">คำจีน</span>
                <input value={item.zh} onChange={(event) => update(index, { zh: event.target.value })} className="h-9 w-full min-w-0 rounded-lg border border-line bg-card px-2 text-sm" />
              </label>
              <label className="min-w-0 space-y-1">
                <span className="block text-[11px] text-muted">คำแปลไทย</span>
                <input value={item.th} onChange={(event) => update(index, { th: event.target.value })} className="h-9 w-full min-w-0 rounded-lg border border-line bg-card px-2 text-sm" />
              </label>
              <label className="min-w-0 space-y-1">
                <span className="block text-[11px] text-muted">ประเภท</span>
                <select value={item.type} onChange={(event) => update(index, { type: event.target.value as 'character' | 'term' })} className="h-9 w-full rounded-lg border border-line bg-card px-2 text-xs">
                  <option value="character">ตัวละคร</option><option value="term">ศัพท์เฉพาะ</option>
                </select>
              </label>
            </div>
          ))}
        </div>
        <footer className="flex items-center justify-between gap-2 border-t border-line p-4">
          <span className="text-[11px] text-muted">บันทึกแล้วจะแทนที่รายการเดิมในคลังศัพท์</span>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={onClose} disabled={saving} className="h-9 rounded-lg border border-line px-3 text-xs hover:bg-surface disabled:opacity-40">ปิด</button>
            <button type="button" onClick={() => void save()} disabled={saving || !draft.some((item) => item.zh.trim() && item.th.trim())} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-accent-fg disabled:opacity-40"><Check className="h-3.5 w-3.5" />{saving ? 'กำลังบันทึก…' : 'บันทึกการแก้ไข'}</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
