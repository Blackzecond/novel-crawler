'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowDownUp, ArrowLeft, BookOpen, Download, FileUp, Pencil, Plus, Search, Trash2, Users, X } from 'lucide-react';
import { getStore, NovelProject } from '@/lib/storage';

type EntryType = 'character' | 'term';
type Entry = { source: string; translated: string; type: EntryType };

function csvCell(value: string) {
  return '"' + value.replace(/"/g, '""') + '"';
}
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export default function GlossaryPage({ id }: { id: string }) {
  const [project, setProject] = useState<NovelProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'characters' | 'terms' | 'replacements'>('characters');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setProject(await getStore().getProject(id)); }
    catch (e) { setNotice(e instanceof Error ? e.message : 'โหลดคลังศัพท์ไม่สำเร็จ'); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void refresh(); }, [refresh]);

  const entries = useMemo<Entry[]>(() => {
    if (!project) return [];
    return Object.entries(project.glossary).map(([source, translated]) => ({
      source, translated, type: project.glossaryTypes?.[source] === 'character' ? 'character' : 'term',
    }));
  }, [project]);
  const visible = entries.filter(e => tab === 'characters' ? e.type === 'character' : tab === 'terms' ? e.type === 'term' : false)
    .filter(e => !query || e.source.toLowerCase().includes(query.toLowerCase()) || e.translated.toLowerCase().includes(query.toLowerCase()));

  const saveEntry = async (entry: Entry) => {
    if (!project || !entry.source.trim()) return;
    setBusy(true);
    try {
      const glossary = { ...project.glossary };
      const glossaryTypes = { ...project.glossaryTypes };
      if (editing?.source && editing.source !== entry.source) { delete glossary[editing.source]; delete glossaryTypes[editing.source]; }
      glossary[entry.source.trim()] = entry.translated.trim();
      glossaryTypes[entry.source.trim()] = entry.type;
      const updated = await getStore().updateProject(id, { glossary, glossaryTypes });
      if (!updated) throw new Error('บันทึกไม่สำเร็จ');
      setProject(updated); setEditing(null); setNotice('บันทึกแล้ว');
    } catch (e) { setNotice(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ'); }
    finally { setBusy(false); }
  };

  const deleteEntries = async (sources: string[]) => {
    if (!sources.length || !window.confirm('ลบรายการที่เลือก ' + sources.length + ' รายการถาวรหรือไม่?')) return;
    setBusy(true);
    try {
      const updated = await getStore().deleteGlossaryTerms(id, sources);
      if (!updated) throw new Error('ไม่พบโปรเจกต์');
      setProject(updated); setSelected([]); setNotice('ลบแล้ว ' + sources.length + ' รายการ');
    } catch (e) { setNotice(e instanceof Error ? e.message : 'ลบไม่สำเร็จ'); }
    finally { setBusy(false); }
  };

  const exportCsv = () => {
    const rows = [['source', 'translated', 'type'], ...entries.map(e => [e.source, e.translated, e.type])];
    const csv = '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = (project?.title || 'glossary') + '-glossary.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const importCsv = async (file?: File) => {
    if (!file || !project) return;
    setBusy(true);
    try {
      const rows = parseCsv((await file.text()).replace(/^\uFEFF/, ''));
      const start = rows[0]?.[0]?.toLowerCase() === 'source' ? 1 : 0;
      const glossary = { ...project.glossary };
      const glossaryTypes = { ...project.glossaryTypes };
      let added = 0, updatedCount = 0, skipped = 0;
      for (const row of rows.slice(start)) {
        const source = (row[0] || '').trim(), translated = (row[1] || '').trim();
        const type: EntryType = row[2]?.trim().toLowerCase() === 'character' ? 'character' : 'term';
        if (!source) { skipped++; continue; }
        if (glossary[source] === undefined) added++; else updatedCount++;
        glossary[source] = translated; glossaryTypes[source] = type;
      }
      const updated = await getStore().updateProject(id, { glossary, glossaryTypes });
      if (!updated) throw new Error('นำเข้าไม่สำเร็จ');
      setProject(updated); setSelected([]);
      setNotice('นำเข้าสำเร็จ เพิ่ม ' + added + ' / ปรับปรุง ' + updatedCount + ' / ข้าม ' + skipped + ' รายการ');
    } catch (e) { setNotice(e instanceof Error ? e.message : 'อ่านไฟล์ CSV ไม่สำเร็จ'); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  if (loading) return <main className="min-h-screen bg-bg text-fg flex items-center justify-center text-sm text-muted">กำลังโหลดคลังศัพท์...</main>;
  if (!project) return <main className="min-h-screen bg-bg text-fg p-6"><Link href="/" className="text-sm">กลับหน้าโปรเจกต์</Link><p className="mt-5 text-sm">ไม่พบโปรเจกต์</p></main>;

  return <main className="min-h-screen bg-bg text-fg">
    <header className="mx-auto max-w-4xl px-4 pt-7 pb-4">
      <Link href={`/project/${id}`} className="inline-flex items-center gap-2 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" /> กลับไปยังสารบัญ</Link>
      <div className="mt-8 flex items-center gap-3"><h1 className="text-3xl font-bold">Glossary</h1><span className="text-sm text-muted">{project.title}</span></div>
      <div className="mt-6 flex flex-wrap gap-2">
        <button onClick={exportCsv} className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-card px-4 text-sm"><Download className="h-4 w-4"/> Export CSV</button>
        <button onClick={() => fileRef.current?.click()} disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-card px-4 text-sm"><FileUp className="h-4 w-4"/> Import CSV</button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={e => void importCsv(e.target.files?.[0])}/>
      </div>
      <section className="mt-4 rounded-2xl border border-line bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-sm font-semibold">Detect before every chapter</p><p className="mt-1 text-xs text-muted">ตรวจจับตัวละครและศัพท์เฉพาะอัตโนมัติเมื่อเปิดบทที่ยังไม่ได้ดึง</p></div>
          <button type="button" role="switch" aria-checked={project.glossaryMode === 'auto'} onClick={async()=>{const updated=await getStore().updateProject(id,{glossaryMode:project.glossaryMode==='auto'?'manual':'auto'});if(updated)setProject(updated);}} className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${project.glossaryMode==='auto'?'bg-accent':'bg-line'}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${project.glossaryMode==='auto'?'translate-x-6':'translate-x-1'}`}/></button>
        </div>
      </section>
      <div className="mt-6 rounded-2xl border border-line bg-card p-1.5 flex gap-1">
        {(['characters','terms','replacements'] as const).map(value => <button key={value} onClick={() => {setTab(value);setSelected([]);setQuery('');}} className={`flex-1 rounded-xl py-3 text-sm ${tab===value?'bg-accent-soft text-accent-soft-fg font-semibold':'text-muted'}`}>{value==='characters'?'Characters':value==='terms'?'Terms':'Replacements'}</button>)}
      </div>
    </header>
    <section className="mx-auto max-w-4xl px-4 pb-12">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={`Search ${tab}...`} className="h-11 w-full rounded-xl border border-line bg-card pl-10 pr-3 text-sm outline-none"/></div>
        <button onClick={()=>setEditing({source:'',translated:'',type:tab==='characters'?'character':'term'})} className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-sm font-medium text-accent-fg"><Plus className="h-4 w-4"/> Add</button>
      </div>
      <div className="mt-4 flex items-center justify-between text-xs text-muted">
        <span>{visible.length} รายการ</span>
        <button onClick={()=>setSelected(selected.length===visible.length?[]:visible.map(e=>e.source))} className="underline underline-offset-4">{selected.length?'ยกเลิกเลือก':'Bulk Select'}</button>
      </div>
      {selected.length>0 && <div className="my-3 flex items-center justify-between rounded-xl border border-line bg-card p-3 text-sm"><span>เลือกแล้ว {selected.length} รายการ</span><button disabled={busy} onClick={()=>void deleteEntries(selected)} className="inline-flex items-center gap-1 text-red-600"><Trash2 className="h-4 w-4"/> ลบที่เลือก</button></div>}
      <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-card">
        <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto] bg-surface px-4 py-3 text-xs font-semibold tracking-wide text-muted"><span>RAW</span><span>TRANSLATED</span><span/></div>
        {tab==='replacements' ? <p className="p-6 text-sm text-muted">ยังไม่มีรายการแทนที่แยกจากคลังคำศัพท์ในเวอร์ชันนี้</p> : visible.map(entry=><div key={entry.source} className="grid grid-cols-[auto_minmax(0,0.8fr)_minmax(0,1.2fr)_auto] items-center gap-3 border-t border-line px-4 py-4">
          <input type="checkbox" checked={selected.includes(entry.source)} onChange={e=>setSelected(current=>e.target.checked?[...current,entry.source]:current.filter(x=>x!==entry.source))} aria-label={`เลือก ${entry.source}`} />
          <span className="min-w-0 break-words text-sm" lang="zh-CN">{entry.source}</span>
          <span className="min-w-0 break-words text-sm">{entry.translated}</span>
          <button onClick={()=>setEditing(entry)} aria-label={`แก้ไข ${entry.source}`} className="rounded-lg p-2 text-muted hover:bg-surface"><Pencil className="h-4 w-4"/></button>
        </div>)}
        {tab!=='replacements' && visible.length===0 && <p className="p-8 text-center text-sm text-muted">ยังไม่มีรายการ</p>}
      </div>
      {notice && <p role="status" className="mt-3 rounded-xl bg-accent-soft p-3 text-sm text-accent-soft-fg">{notice}</p>}
    </section>
    {editing && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={()=>setEditing(null)}>
      <div className="w-full max-w-md space-y-3 rounded-2xl border border-line bg-card p-5 shadow-xl" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between"><h2 className="font-semibold">{editing.source?'Edit entry':'Add entry'}</h2><button onClick={()=>setEditing(null)}><X className="h-5 w-5"/></button></div>
        <label className="block text-xs text-muted">RAW<input value={editing.source} onChange={e=>setEditing({...editing,source:e.target.value})} className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm"/></label>
        <label className="block text-xs text-muted">TRANSLATED<input value={editing.translated} onChange={e=>setEditing({...editing,translated:e.target.value})} className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm"/></label>
        <label className="block text-xs text-muted">TYPE<select value={editing.type} onChange={e=>setEditing({...editing,type:e.target.value as EntryType})} className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm"><option value="character">Character</option><option value="term">Term</option></select></label>
        <div className="flex justify-end gap-2"><button onClick={()=>setEditing(null)} className="rounded-lg border border-line px-4 py-2 text-sm">Cancel</button><button disabled={busy||!editing.source.trim()} onClick={()=>void saveEntry(editing)} className="rounded-lg bg-accent px-4 py-2 text-sm text-accent-fg disabled:opacity-50">Save</button></div>
      </div>
    </div>}
  </main>;
}
