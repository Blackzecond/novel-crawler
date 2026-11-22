'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowDownUp, ArrowLeft, BookOpen, Download, FileUp, Pencil, Plus, Search, Trash2, X, UserRound, MapPin, Landmark, Building2, Package, Sparkles, Swords, Boxes } from 'lucide-react';
import { createId, getStore, NovelProject, WordReplacement } from '@/lib/storage';

type EntryType = 'character' | 'term';
type Entry = { source: string; translated: string; type: EntryType; gender: string; category: string; notes: string };
const TERM_CATEGORIES = [{value:'place',label:'สถานที่',icon:MapPin},{value:'sect',label:'สำนัก',icon:Landmark},{value:'organization',label:'องค์กร',icon:Building2},{value:'item',label:'สิ่งของ',icon:Package},{value:'technique',label:'วิชา/เคล็ดวิชา',icon:Swords},{value:'cultivation',label:'การบำเพ็ญ',icon:Sparkles},{value:'other',label:'อื่น ๆ',icon:Boxes}];

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
  const [editingReplacement, setEditingReplacement] = useState<WordReplacement | null>(null);
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
      gender: project.glossaryMetadata?.[source]?.gender ?? 'unknown',
      category: project.glossaryMetadata?.[source]?.category ?? 'other',
      notes: project.glossaryMetadata?.[source]?.notes ?? '',
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
      const glossaryMetadata = { ...(project.glossaryMetadata ?? {}) };
      if (editing?.source && editing.source !== entry.source) { delete glossary[editing.source]; delete glossaryTypes[editing.source]; delete glossaryMetadata[editing.source]; }
      glossary[entry.source.trim()] = entry.translated.trim();
      glossaryTypes[entry.source.trim()] = entry.type;
      glossaryMetadata[entry.source.trim()] = entry.type === 'character' ? { gender: entry.gender || 'unknown', notes: entry.notes } : { category: entry.category || 'other', notes: entry.notes };
      const updated = await getStore().updateProject(id, { glossary, glossaryTypes, glossaryMetadata });
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

  const saveReplacement = async () => {
    if (!project || !editingReplacement) return;
    const variants = editingReplacement.variants.map(value => value.trim()).filter(Boolean);
    if (!variants.length || !editingReplacement.replacement.trim()) return;
    setBusy(true);
    try {
      const current = project.wordReplacements ?? [];
      const exists = current.some(item => item.id === editingReplacement.id);
      const next = exists
        ? current.map(item => item.id === editingReplacement.id ? { ...editingReplacement, variants } : item)
        : [...current, { ...editingReplacement, variants }];
      const updated = await getStore().updateProject(id, { wordReplacements: next });
      if (!updated) throw new Error('บันทึกกฎแทนที่ไม่สำเร็จ');
      setProject(updated); setEditingReplacement(null); setNotice('บันทึกกฎแทนที่แล้ว');
    } catch (e) { setNotice(e instanceof Error ? e.message : 'บันทึกกฎแทนที่ไม่สำเร็จ'); }
    finally { setBusy(false); }
  };

  const deleteReplacement = async (replacementId: string) => {
    if (!project || !window.confirm('ลบกฎแทนที่นี้หรือไม่?')) return;
    setBusy(true);
    try {
      const updated = await getStore().updateProject(id, { wordReplacements: (project.wordReplacements ?? []).filter(item => item.id !== replacementId) });
      if (!updated) throw new Error('ลบกฎไม่สำเร็จ');
      setProject(updated); setNotice('ลบกฎแทนที่แล้ว');
    } catch (e) { setNotice(e instanceof Error ? e.message : 'ลบกฎไม่สำเร็จ'); }
    finally { setBusy(false); }
  };

  const exportCsv = () => {
    const rows = [['source', 'translated', 'type', 'gender', 'category', 'notes'], ...entries.map(e => [e.source, e.translated, e.type, e.gender, e.category, e.notes])];
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
      const glossaryMetadata = { ...(project.glossaryMetadata ?? {}) };
      let added = 0, updatedCount = 0, skipped = 0;
      for (const row of rows.slice(start)) {
        const source = (row[0] || '').trim(), translated = (row[1] || '').trim();
        const type: EntryType = row[2]?.trim().toLowerCase() === 'character' ? 'character' : 'term';
        if (!source) { skipped++; continue; }
        if (glossary[source] === undefined) added++; else updatedCount++;
        glossary[source] = translated; glossaryTypes[source] = type;
        glossaryMetadata[source] = type === 'character' ? { gender: row[3] || 'unknown', notes: row[5] || '' } : { category: row[4] || 'other', notes: row[5] || '' };
      }
      const updated = await getStore().updateProject(id, { glossary, glossaryTypes, glossaryMetadata });
      if (!updated) throw new Error('นำเข้าไม่สำเร็จ');
      setProject(updated); setSelected([]);
      setNotice('นำเข้าสำเร็จ เพิ่ม ' + added + ' / ปรับปรุง ' + updatedCount + ' / ข้าม ' + skipped + ' รายการ');
    } catch (e) { setNotice(e instanceof Error ? e.message : 'อ่านไฟล์ CSV ไม่สำเร็จ'); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  if (loading) return <main className="min-h-screen bg-bg text-fg flex items-center justify-center text-sm text-muted">กำลังโหลดคลังศัพท์...</main>;
  if (!project) return <main className="min-h-screen bg-bg text-fg p-6"><Link href="/" className="text-sm">กลับหน้าโปรเจกต์</Link><p className="mt-5 text-sm">ไม่พบโปรเจกต์</p></main>;

  return <main className="min-h-screen bg-bg text-fg">
    <header className="mx-auto max-w-4xl px-4 pb-4 pt-6 sm:pt-8">
      <Link href={"/project/" + id} className="inline-flex min-h-10 items-center gap-2 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> กลับสารบัญ
      </Link>
      <div className="mt-4">
        <h1 className="font-serif text-2xl font-bold sm:text-3xl">ศัพท์ของเรื่องนี้</h1>
        <p className="mt-1 truncate text-sm text-muted">{project.title}</p>
        <p className="mt-1 text-xs text-muted">คำศัพท์และกฎแทนคำมีผลเฉพาะนิยายเรื่องนี้</p>
      </div>
      <div className="mt-5 flex gap-1 rounded-xl border border-line bg-card p-1">
        {(['characters','terms','replacements'] as const).map(value => (
          <button key={value} onClick={() => { setTab(value); setSelected([]); setQuery(''); }} aria-pressed={tab===value}
            className={"min-h-11 min-w-0 flex-1 rounded-lg px-2 text-xs font-medium sm:text-sm " + (tab===value?'bg-accent-soft text-accent-soft-fg':'text-muted hover:bg-surface')}>
            {value==='characters'?'ตัวละคร':value==='terms'?'ศัพท์เฉพาะ':'กฎแทนคำ'}
          </button>
        ))}
      </div>
    </header>
    <section className="mx-auto max-w-4xl px-4 pb-12">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">ค้นหาคำจีนหรือคำแปลไทย</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"/>
          <input value={query} onChange={event=>setQuery(event.target.value)} type="search"
            placeholder={tab==='characters'?'ค้นหาชื่อตัวละคร…':tab==='terms'?'ค้นหาคำจีนหรือคำแปลไทย…':'ค้นหารูปคำหรือคำที่ใช้แทน…'}
            className="h-11 w-full rounded-xl border border-line bg-card pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-accent/40"/>
        </label>
        <button onClick={()=>tab==='replacements' ? setEditingReplacement({id:createId(),variants:[''],replacement:'',useRegex:false}) : setEditing({source:'',translated:'',type:tab==='characters'?'character':'term',gender:'unknown',category:'other',notes:''})}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-semibold text-accent-fg">
          <Plus className="h-4 w-4"/> {tab==='replacements'?'เพิ่มกฎ':'เพิ่มคำ'}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>{tab==='replacements' ? (project.wordReplacements??[]).filter(rule=>!query||rule.variants.some(value=>value.toLowerCase().includes(query.toLowerCase()))||rule.replacement.toLowerCase().includes(query.toLowerCase())).length : visible.length} รายการ</span>
        {tab!=='replacements' && <button disabled={!visible.length} onClick={()=>setSelected(selected.length===visible.length?[]:visible.map(entry=>entry.source))} className="min-h-9 rounded-lg px-2 underline underline-offset-4 disabled:opacity-40">{selected.length?'ยกเลิกเลือก':'เลือกหลายรายการ'}</button>}
      </div>
      {tab!=='replacements' && selected.length>0 && <div className="my-3 flex items-center justify-between gap-3 rounded-xl border border-line bg-card p-3 text-sm"><span>เลือกแล้ว {selected.length} รายการ</span><button disabled={busy} onClick={()=>void deleteEntries(selected)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-danger-fg hover:bg-surface disabled:opacity-40"><Trash2 className="h-4 w-4"/> ลบที่เลือก</button></div>}
      <div className="mt-2 overflow-hidden rounded-2xl border border-line bg-card">
        {tab==='replacements' ? (
          (project.wordReplacements??[]).filter(rule=>!query||rule.variants.some(value=>value.toLowerCase().includes(query.toLowerCase()))||rule.replacement.toLowerCase().includes(query.toLowerCase())).map(rule=>(
            <article key={rule.id} className="flex items-start justify-between gap-3 border-b border-line px-4 py-4 last:border-0">
              <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{rule.variants.join(' / ')}</p><p className="mt-1 break-words text-sm text-muted">แทนด้วย {rule.replacement}</p><span className="mt-1 inline-flex rounded bg-surface px-2 py-1 text-[10px] text-muted">{rule.useRegex?'Regex':'ข้อความตรงตัว'}</span></div>
              <div className="flex shrink-0 gap-1"><button onClick={()=>setEditingReplacement({...rule,variants:[...rule.variants]})} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-surface" aria-label="แก้ไขกฎ"><Pencil className="h-4 w-4"/></button><button onClick={()=>void deleteReplacement(rule.id)} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-surface" aria-label="ลบกฎ"><Trash2 className="h-4 w-4"/></button></div>
            </article>
          ))
        ) : (
          <>
            <div className="hidden grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto] bg-surface px-4 py-3 text-xs font-semibold text-muted sm:grid"><span>คำจีน</span><span>คำแปลไทย</span><span/></div>
            {visible.map(entry=>(
              <article key={entry.source} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-line px-3 py-3 sm:grid-cols-[auto_minmax(0,0.8fr)_minmax(0,1.2fr)_auto] sm:gap-3 sm:px-4 sm:py-4">
                <input type="checkbox" checked={selected.includes(entry.source)} onChange={event=>setSelected(current=>event.target.checked?[...current,entry.source]:current.filter(value=>value!==entry.source))} aria-label={"เลือก " + entry.source} className="row-span-2 h-4 w-4 sm:row-span-1"/>
                <span className="min-w-0 break-words text-sm font-medium sm:font-normal" lang="zh-CN">{entry.source}</span>
                <span className="col-start-2 min-w-0 break-words text-sm sm:col-start-auto">{entry.translated}<span className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-muted">
                  {entry.type==='character' ? (entry.gender==='unknown'?'ไม่ระบุเพศ':entry.gender==='male'?'ชาย':'หญิง') : (()=>{const meta=TERM_CATEGORIES.find(item=>item.value===entry.category)??TERM_CATEGORIES[6];const Icon=meta.icon;return <><Icon className="h-3 w-3"/>{meta.label}</>;})()}
                  {entry.notes && <span>· {entry.notes}</span>}
                </span></span>
                <button onClick={()=>setEditing(entry)} aria-label={"แก้ไข " + entry.source} className="row-span-2 inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-surface sm:row-span-1"><Pencil className="h-4 w-4"/></button>
              </article>
            ))}
          </>
        )}
        {(tab==='replacements' ? (project.wordReplacements??[]).filter(rule=>!query||rule.variants.some(value=>value.toLowerCase().includes(query.toLowerCase()))||rule.replacement.toLowerCase().includes(query.toLowerCase())).length===0 : visible.length===0) && <div className="p-8 text-center"><BookOpen className="mx-auto h-8 w-8 text-muted"/><p className="mt-3 text-sm font-medium">{query?'ไม่พบรายการที่ตรงกับคำค้น':'ยังไม่มีรายการในหมวดนี้'}</p>{query && <button onClick={()=>setQuery('')} className="mt-2 text-xs font-semibold text-accent-soft-fg underline">ล้างคำค้น</button>}</div>}
      </div>
      {notice && <p role="status" className="mt-3 rounded-xl border border-line bg-card p-3 text-sm">{notice}</p>}
      <details className="group mt-6 rounded-2xl border border-line bg-card">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold">จัดการคลังศัพท์ <span className="text-xs font-normal text-muted">CSV · ตรวจจับอัตโนมัติ</span></summary>
        <div className="space-y-4 border-t border-line p-4">
          <div><p className="text-sm font-semibold">ไฟล์ CSV ของเรื่องนี้</p><p className="mt-1 text-xs text-muted">คำจีนเดิมในไฟล์จะปรับปรุงคำแปลและข้อมูลของเรื่องนี้เท่านั้น</p>
            <div className="mt-3 flex flex-wrap gap-2"><button onClick={exportCsv} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line px-3 text-xs"><Download className="h-4 w-4"/> ส่งออก CSV</button><button onClick={()=>fileRef.current?.click()} disabled={busy} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line px-3 text-xs disabled:opacity-40"><FileUp className="h-4 w-4"/> นำเข้า CSV</button><input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={event=>void importCsv(event.target.files?.[0])}/></div>
          </div>
          <div className="space-y-3 border-t border-line pt-4"><div><p className="text-sm font-semibold">ตรวจจับศัพท์อัตโนมัติ</p><p className="mt-1 text-xs text-muted">เลือกประเภทศัพท์ที่ให้ AI ตรวจจับอัตโนมัติเมื่อเปิดบทใหม่</p></div>
            {([{key:'characters' as const,label:'ตัวละคร',hint:'ชื่อตัวละคร',icon:UserRound},{key:'terms' as const,label:'ศัพท์เฉพาะ',hint:'สถานที่ สำนัก องค์กร สิ่งของ และคำเฉพาะของเรื่อง',icon:BookOpen}]).map(option=>{
              const enabled=project.glossaryDetection?.[option.key]===true; const Icon=option.icon;
              return <div key={option.key} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-bg px-3 py-3"><div className="flex min-w-0 items-center gap-2"><Icon className="h-4 w-4 shrink-0 text-muted"/><div><p className="text-sm font-medium">{option.label}</p><p className="text-[11px] text-muted">{option.hint}</p></div></div><button type="button" role="switch" aria-label={'เปิดตรวจจับ '+option.label} aria-checked={enabled} onClick={async()=>{const next={characters:project.glossaryDetection?.characters===true,terms:project.glossaryDetection?.terms===true,[option.key]:!enabled};const updated=await getStore().updateProject(id,{glossaryDetection:next});if(updated)setProject(updated);}} className={"relative h-7 w-12 shrink-0 rounded-full transition-colors " + (enabled?'bg-accent':'bg-line')}><span className={"absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform " + (enabled?'translate-x-6':'translate-x-1')}/></button></div>;
            })}
          </div>
        </div>
      </details>
    </section>
    {editingReplacement && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={()=>setEditingReplacement(null)}>
      <div className="w-full max-w-xl space-y-4 rounded-2xl border border-line bg-card p-5 shadow-xl" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">กฎแทนคำ</h2><button onClick={()=>setEditingReplacement(null)} aria-label="ปิด"><X className="h-5 w-5"/></button></div>
        <p className="text-sm text-muted">กฎนี้ใช้กับเนื้อหาทุกบทของนิยายเรื่องนี้เท่านั้น</p>
        <div className="flex items-center justify-between"><label className="text-sm font-medium">คำต้นฉบับ</label><button onClick={()=>setEditingReplacement({...editingReplacement,variants:[...editingReplacement.variants,'']})} className="rounded-lg bg-accent px-3 py-2 text-xs text-accent-fg"><Plus className="mr-1 inline h-3.5 w-3.5"/>เพิ่มรูปแบบคำ</button></div>
        {editingReplacement.variants.map((variant,index)=><div key={index} className="flex gap-2"><input value={variant} onChange={e=>setEditingReplacement({...editingReplacement,variants:editingReplacement.variants.map((v,i)=>i===index?e.target.value:v)})} placeholder="คำหรือข้อความที่ต้องการแทน" className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 text-sm"/>{editingReplacement.variants.length>1&&<button onClick={()=>setEditingReplacement({...editingReplacement,variants:editingReplacement.variants.filter((_,i)=>i!==index)})} aria-label="ลบรูปแบบนี้" className="px-2 text-muted"><X className="h-4 w-4"/></button>}</div>)}
        <label className="flex items-center justify-between rounded-xl border border-line p-4"><span><span className="block text-sm font-medium">ใช้ Regex</span><span className="mt-1 block text-xs text-muted">ใช้ Regular Expression แทนการค้นหาข้อความตรงตัว</span></span><input type="checkbox" checked={editingReplacement.useRegex} onChange={e=>setEditingReplacement({...editingReplacement,useRegex:e.target.checked})} className="h-5 w-5"/></label>
        <label className="block text-sm font-medium">คำที่ใช้แทน<input value={editingReplacement.replacement} onChange={e=>setEditingReplacement({...editingReplacement,replacement:e.target.value})} placeholder="คำหรือข้อความที่ใช้แทน" className="mt-2 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm"/></label>
        <div className="flex justify-end gap-2 border-t border-line pt-3"><button onClick={()=>setEditingReplacement(null)} className="rounded-lg px-4 py-2 text-sm text-muted">ยกเลิก</button><button disabled={busy||!editingReplacement.variants.some(v=>v.trim())||!editingReplacement.replacement.trim()} onClick={()=>void saveReplacement()} className="rounded-lg bg-accent px-5 py-2 text-sm text-accent-fg disabled:opacity-40">บันทึก</button></div>
      </div>
    </div>}
    {editing && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={()=>setEditing(null)}>
      <div className="w-full max-w-md space-y-3 rounded-2xl border border-line bg-card p-5 shadow-xl" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between"><h2 className="font-semibold">{editing.source?'แก้ไขรายการ':'เพิ่มรายการ'}</h2><button onClick={()=>setEditing(null)}><X className="h-5 w-5"/></button></div>
        <label className="block text-xs text-muted">คำจีน<input autoFocus value={editing.source} onChange={e=>setEditing({...editing,source:e.target.value})} className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm"/></label>
        <label className="block text-xs text-muted">คำแปลไทย<input value={editing.translated} onChange={e=>setEditing({...editing,translated:e.target.value})} className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm"/></label>
        {editing.type==='character' ? <label className="block text-xs text-muted">เพศ<select value={editing.gender} onChange={e=>setEditing({...editing,gender:e.target.value})} className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm"><option value="unknown">ไม่ระบุ</option><option value="male">ชาย</option><option value="female">หญิง</option></select></label> : <label className="block text-xs text-muted">หมวดหมู่<select value={editing.category} onChange={e=>setEditing({...editing,category:e.target.value})} className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm">{TERM_CATEGORIES.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label>}
        <label className="block text-xs text-muted">หมายเหตุ<textarea value={editing.notes} onChange={e=>setEditing({...editing,notes:e.target.value})} rows={3} className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm"/></label>
        <div className="flex justify-end gap-2"><button onClick={()=>setEditing(null)} className="rounded-lg border border-line px-4 py-2 text-sm">ยกเลิก</button><button disabled={busy||!editing.source.trim()} onClick={()=>void saveEntry(editing)} className="rounded-lg bg-accent px-4 py-2 text-sm text-accent-fg disabled:opacity-50">บันทึก</button></div>
      </div>
    </div>}
  </main>;
}
