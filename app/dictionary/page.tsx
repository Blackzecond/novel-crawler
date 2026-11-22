'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, BookOpen, Check, Download, FileSpreadsheet, Loader2, Pencil,
  Plus, RefreshCw, Search, Trash2, Upload, X, AlertTriangle,
} from 'lucide-react';
import {
  analyzeGlobalDictionaryImport,
  deleteGlobalDictionaryEntry,
  exportGlobalDictionaryCsv,
  importGlobalDictionaryEntries,
  listGlobalDictionaryEntries,
  parseGlobalDictionaryCsv,
  saveGlobalDictionaryEntry,
  type GlobalDictionaryCategory,
  type GlobalDictionaryEntry,
  type GlobalDictionaryImportAnalysis,
  type GlobalDictionaryImportRow,
} from '@/lib/globalDictionary';

const CATEGORIES: { value: GlobalDictionaryCategory; label: string }[] = [
  { value: 'brand', label: 'แบรนด์ / บริษัท' },
  { value: 'food', label: 'อาหาร' },
  { value: 'drink', label: 'เครื่องดื่ม' },
  { value: 'app', label: 'แอป / บริการ' },
  { value: 'place', label: 'สถานที่' },
  { value: 'culture', label: 'วัฒนธรรม' },
  { value: 'unit', label: 'หน่วย / จำนวนเงิน' },
  { value: 'title', label: 'ตำแหน่ง / คำเรียก' },
  { value: 'sect', label: 'สำนัก / ตระกูล' },
  { value: 'cultivation', label: 'การบำเพ็ญ / พลัง' },
  { value: 'technique', label: 'วิชา / ค่ายกล' },
  { value: 'item', label: 'สิ่งของ / สมบัติวิเศษ' },
  { value: 'creature', label: 'อสูร / สัตว์วิเศษ' },
  { value: 'other', label: 'อื่น ๆ' },
];

type Draft = {
  id?: string;
  sourceTerm: string;
  translatedTerm: string;
  category: GlobalDictionaryCategory;
  aliasesText: string;
  notes: string;
  isActive: boolean;
};

const emptyDraft = (): Draft => ({
  sourceTerm: '',
  translatedTerm: '',
  category: 'other',
  aliasesText: '',
  notes: '',
  isActive: true,
});

export default function GlobalDictionaryPage() {
  const [entries, setEntries] = useState<GlobalDictionaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Draft | null>(null);
  const [notice, setNotice] = useState('');
  const [formError, setFormError] = useState('');
  const [importRows, setImportRows] = useState<GlobalDictionaryImportRow[]>([]);
  const [importAnalysis, setImportAnalysis] = useState<GlobalDictionaryImportAnalysis | null>(null);
  const [importName, setImportName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      setEntries(await listGlobalDictionaryEntries());
      setNotice('');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'โหลดคลังคำศัพท์ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const visibleEntries = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) =>
      [entry.sourceTerm, entry.translatedTerm, entry.category, entry.notes, ...entry.aliases]
        .some((value) => value.toLocaleLowerCase().includes(needle)),
    );
  }, [entries, query]);

  const openEdit = (entry?: GlobalDictionaryEntry) => {
    setFormError('');
    if (!entry) { setEditing(emptyDraft()); return; }
    setEditing({
      id: entry.id,
      sourceTerm: entry.sourceTerm,
      translatedTerm: entry.translatedTerm,
      category: entry.category,
      aliasesText: entry.aliases.join('\n'),
      notes: entry.notes,
      isActive: entry.isActive,
    });
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await saveGlobalDictionaryEntry({
        id: editing.id,
        sourceTerm: editing.sourceTerm,
        translatedTerm: editing.translatedTerm,
        category: editing.category,
        aliases: editing.aliasesText.split(/[\n,，]/),
        notes: editing.notes,
        isActive: editing.isActive,
      });
      setEditing(null);
      setNotice('บันทึกคำศัพท์แล้ว');
      await refresh();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'บันทึกคำศัพท์ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (entry: GlobalDictionaryEntry) => {
    if (!window.confirm('ลบคำศัพท์ ' + entry.sourceTerm + ' ออกจากคลังพื้นฐานหรือไม่?')) return;
    setBusy(true);
    try {
      await deleteGlobalDictionaryEntry(entry.id);
      setNotice('ลบคำศัพท์แล้ว');
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'ลบคำศัพท์ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (entry: GlobalDictionaryEntry) => {
    setBusy(true);
    try {
      await saveGlobalDictionaryEntry({
        id: entry.id,
        sourceTerm: entry.sourceTerm,
        translatedTerm: entry.translatedTerm,
        category: entry.category,
        aliases: entry.aliases,
        notes: entry.notes,
        isActive: !entry.isActive,
      });
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'เปลี่ยนสถานะไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    const csv = '\uFEFF' + exportGlobalDictionaryCsv(entries);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'novel-crawler-global-dictionary.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setNotice('ส่งออก ' + entries.length + ' รายการแล้ว');
  };

  const downloadCsvTemplate = () => {
    const csv = '\uFEFF' + exportGlobalDictionaryCsv([]);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'novel-crawler-dictionary-template.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const inspectImportFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setImportAnalysis(null);
    try {
      const text = await file.text();
      const rows = parseGlobalDictionaryCsv(text);
      const analysis = await analyzeGlobalDictionaryImport(rows);
      setImportRows(rows);
      setImportAnalysis(analysis);
      setImportName(file.name);
      setNotice('');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'อ่านไฟล์ CSV ไม่สำเร็จ');
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const confirmImport = async () => {
    if (!importAnalysis || importAnalysis.conflicts.length) return;
    setBusy(true);
    try {
      const count = await importGlobalDictionaryEntries(importRows);
      setImportRows([]);
      setImportAnalysis(null);
      setImportName('');
      setNotice('นำเข้า ' + count + ' รายการสำเร็จ ข้ามรายการซ้ำ ' + (importAnalysis.duplicates) + ' รายการ');
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'นำเข้าคำศัพท์ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-bg text-fg">
      <header className="mx-auto max-w-4xl px-4 pt-7 pb-5">
        <a href="/" className="inline-flex items-center gap-2 text-sm text-muted hover:text-fg">
          <ArrowLeft className="h-4 w-4" /> กลับชั้นหนังสือ
        </a>
        <div className="mt-7 flex items-center justify-between gap-3">
          <div>
            <h1 className="font-serif text-2xl font-bold">พจนานุกรมพื้นฐาน</h1>
            <p className="mt-1 text-sm text-muted">ใช้ร่วมกันทุกนิยาย และส่งให้ AI เฉพาะคำที่พบในบทที่กำลังแปล</p>
          </div>
          <button onClick={() => openEdit()} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-accent px-4 text-sm font-medium text-accent-fg">
            <Plus className="h-4 w-4" /> เพิ่มคำ
          </button>
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-xl border border-line bg-card px-3">
          <Search className="h-4 w-4 text-muted" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาคำจีน คำแปล หรือ Alias..." className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none" />
          <button onClick={() => void refresh()} disabled={loading || busy} aria-label="โหลดใหม่" className="rounded-lg p-2 text-muted hover:bg-surface disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <details className="group mt-3 rounded-xl border border-line bg-card">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-medium">จัดการไฟล์ <span className="text-xs text-muted">แม่แบบ · นำเข้า · ส่งออก</span></summary>
          <div className="grid grid-cols-2 gap-2 border-t border-line p-3 sm:flex">
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={busy || loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-line bg-card px-3 text-sm hover:bg-surface disabled:opacity-50">
            <Upload className="h-4 w-4" /> นำเข้า CSV
          </button>
          <button type="button" onClick={exportCsv} disabled={busy || loading || !entries.length} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-line bg-card px-3 text-sm hover:bg-surface disabled:opacity-50">
            <Download className="h-4 w-4" /> ส่งออก CSV
          </button>
          <button type="button" onClick={downloadCsvTemplate} disabled={busy || loading} className="col-span-2 inline-flex h-9 items-center justify-center gap-2 text-xs text-muted underline underline-offset-4 hover:text-fg sm:ml-auto sm:col-span-1">
            ดาวน์โหลดแม่แบบ CSV
          </button>
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => void inspectImportFile(event.target.files?.[0])} />
          </div>
        </details>
        <div className="mt-3 flex items-center justify-between text-xs text-muted">
          <span>{visibleEntries.length} / {entries.length} รายการ</span>
          <span>คำที่ปิดใช้งานจะไม่ถูกส่งให้ AI</span>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-4 pb-12">
        {notice && <div role="status" className="mb-3 rounded-xl border border-line bg-card p-3 text-sm">{notice}</div>}

        {importAnalysis && (
          <div className="mb-4 rounded-2xl border border-line bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-muted" />
                <div>
                  <h2 className="text-sm font-semibold">ตรวจสอบไฟล์นำเข้า</h2>
                  <p className="text-xs text-muted">{importName}</p>
                </div>
              </div>
              <button type="button" onClick={() => { setImportRows([]); setImportAnalysis(null); }} aria-label="ยกเลิกนำเข้า" className="rounded-lg p-1 text-muted hover:bg-surface"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-surface p-2"><p className="text-lg font-semibold tabular-nums">{importAnalysis.accepted.length}</p><p className="text-[11px] text-muted">เพิ่มได้</p></div>
              <div className="rounded-xl bg-surface p-2"><p className="text-lg font-semibold tabular-nums">{importAnalysis.duplicates}</p><p className="text-[11px] text-muted">ซ้ำ / ข้าม</p></div>
              <div className="rounded-xl bg-surface p-2"><p className="text-lg font-semibold tabular-nums">{importAnalysis.conflicts.length}</p><p className="text-[11px] text-muted">คำชนกัน</p></div>
            </div>
            {importAnalysis.conflicts.length > 0 && (
              <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
                <div className="flex items-center gap-2 text-sm font-medium"><AlertTriangle className="h-4 w-4 text-amber-600" /> พบคำศัพท์ที่กำหนดคำแปลขัดแย้งกัน</div>
                <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-muted">
                  {importAnalysis.conflicts.map((conflict) => <li key={conflict.rowNumber}>แถว {conflict.rowNumber} · {conflict.sourceTerm}: {conflict.reason}</li>)}
                </ul>
                <p className="mt-2 text-xs text-muted">ระบบจะไม่บันทึกไฟล์นี้จนกว่าจะแก้รายการที่ชนกันแล้วนำเข้าใหม่</p>
              </div>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => { setImportRows([]); setImportAnalysis(null); }} className="rounded-lg px-3 py-2 text-sm text-muted">ยกเลิก</button>
              <button type="button" onClick={() => void confirmImport()} disabled={busy || importAnalysis.accepted.length === 0 || importAnalysis.conflicts.length > 0} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm text-accent-fg disabled:opacity-40">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} นำเข้ารายการที่ผ่าน
              </button>
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-line bg-card">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดคลังคำศัพท์...</div>
          ) : visibleEntries.length ? visibleEntries.map((entry) => (
            <article key={entry.id} className="flex items-start gap-3 border-b border-line px-4 py-4 last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="break-words text-sm font-semibold" lang="zh-CN">{entry.sourceTerm}</span>
                  {!entry.isActive && <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] text-muted">ปิดใช้งาน</span>}
                </div>
                <p className="mt-1 break-words text-sm">{entry.translatedTerm}</p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
                  <span>{CATEGORIES.find((item) => item.value === entry.category)?.label ?? 'อื่น ๆ'}</span>
                  {entry.aliases.length > 0 && <span>Alias: {entry.aliases.join(' / ')}</span>}
                  {entry.notes && <span>{entry.notes}</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={() => void toggleActive(entry)} disabled={busy} title={entry.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-[11px] text-muted hover:bg-surface disabled:opacity-40">
                  {entry.isActive ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}{entry.isActive ? 'ปิดใช้' : 'เปิดใช้'}
                </button>
                <button type="button" onClick={() => openEdit(entry)} disabled={busy} aria-label="แก้ไข" className="rounded-lg p-2 text-muted hover:bg-surface disabled:opacity-40"><Pencil className="h-4 w-4" /></button>
                <button type="button" onClick={() => void remove(entry)} disabled={busy} aria-label="ลบ" className="rounded-lg p-2 text-muted hover:bg-surface disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
              </div>
            </article>
          )) : (
            <div className="p-10 text-center">
              <BookOpen className="mx-auto h-8 w-8 text-muted" />
              <p className="mt-3 text-sm font-medium">{entries.length ? 'ไม่พบคำศัพท์ที่ค้นหา' : 'ยังไม่มีคำศัพท์พื้นฐาน'}</p>
              <p className="mt-1 text-xs text-muted">เพิ่มคำที่ต้องการให้ AI ใช้คำแปลเดิมทุกครั้ง เช่น 茅台 → เหมาไถ</p>
            </div>
          )}
        </div>
      </section>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditing(null)}>
          <div className="w-full max-w-lg space-y-4 rounded-2xl border border-line bg-card p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{editing.id ? 'แก้ไขคำศัพท์' : 'เพิ่มคำศัพท์พื้นฐาน'}</h2>
              <button onClick={() => setEditing(null)} aria-label="ปิด"><X className="h-5 w-5" /></button>
            </div>
            {formError && <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700">{formError}</div>}
            <label className="block text-xs text-muted">คำต้นฉบับ
              <input value={editing.sourceTerm} onChange={(event) => setEditing({ ...editing, sourceTerm: event.target.value })} className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg" placeholder="茅台" />
            </label>
            <label className="block text-xs text-muted">คำแปลที่ต้องการ
              <input value={editing.translatedTerm} onChange={(event) => setEditing({ ...editing, translatedTerm: event.target.value })} className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg" placeholder="เหมาไถ" />
            </label>
            <label className="block text-xs text-muted">ประเภท
              <select value={editing.category} onChange={(event) => setEditing({ ...editing, category: event.target.value as GlobalDictionaryCategory })} className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg">
                {CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
              </select>
            </label>
            <label className="block text-xs text-muted">คำเรียกอื่น / Alias
              <textarea value={editing.aliasesText} onChange={(event) => setEditing({ ...editing, aliasesText: event.target.value })} rows={2} className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg" placeholder="หนึ่งคำต่อบรรทัด" />
            </label>
            <label className="block text-xs text-muted">หมายเหตุสำหรับ AI
              <textarea value={editing.notes} onChange={(event) => setEditing({ ...editing, notes: event.target.value })} rows={2} className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg" placeholder="เช่น ชื่อสุราจีน ไม่ต้องแปลความหมายตามตัวอักษร" />
            </label>
            <label className="flex items-center justify-between rounded-xl border border-line p-3 text-sm">
              <span>เปิดใช้งานในการแปล</span>
              <input type="checkbox" checked={editing.isActive} onChange={(event) => setEditing({ ...editing, isActive: event.target.checked })} className="h-5 w-5" />
            </label>
            <div className="flex justify-end gap-2 border-t border-line pt-3">
              <button onClick={() => setEditing(null)} className="rounded-lg px-4 py-2 text-sm text-muted">ยกเลิก</button>
              <button onClick={() => void save()} disabled={busy || !editing.sourceTerm.trim() || !editing.translatedTerm.trim()} className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2 text-sm text-accent-fg disabled:opacity-40">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} บันทึก
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
