'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, BookOpen, Check, ChevronDown, CircleHelp, FilePlus2, FolderOpen, Loader2, Plus, Save, Trash2, Upload, X } from 'lucide-react';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

type GlossarySet = { id: string; name: string; description: string | null; updated_at: string };
type GlossaryEntry = { id: string; source_term: string; translated_term: string; term_type: string; notes: string | null };
type Project = { id: string; title: string };
const TERM_TYPES = [
  { value: 'character', label: 'ตัวละคร' },
  { value: 'place', label: 'สถานที่' },
  { value: 'organization', label: 'องค์กร/สำนัก' },
  { value: 'technique', label: 'วิชา/พลัง' },
  { value: 'item', label: 'สิ่งของ' },
  { value: 'title', label: 'ตำแหน่ง/คำเรียก' },
  { value: 'other', label: 'อื่น ๆ' },
];

export default function GlossarySetsPage() {
  const router = useRouter();
  const [sets, setSets] = useState<GlossarySet[]>([]);
  const [entries, setEntries] = useState<GlossaryEntry[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedSet, setSelectedSet] = useState('');
  const [selectedTerms, setSelectedTerms] = useState<string[]>([]);
  const [targetProject, setTargetProject] = useState('');
  const [setName, setSetName] = useState('');
  const [setDescription, setSetDescription] = useState('');
  const [sourceTerm, setSourceTerm] = useState('');
  const [translatedTerm, setTranslatedTerm] = useState('');
  const [termType, setTermType] = useState('other');
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async (preferredSet?: string) => {
    setError('');
    const supabase = getSupabase();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      router.replace('/login');
      return;
    }
    const [setsResult, projectsResult] = await Promise.all([
      supabase.from('glossary_sets').select('id,name,description,updated_at').order('updated_at', { ascending: false }),
      supabase.from('novel_projects').select('id,title').order('updated_at', { ascending: false }),
    ]);
    if (setsResult.error) throw setsResult.error;
    if (projectsResult.error) throw projectsResult.error;
    const nextSets = (setsResult.data ?? []) as GlossarySet[];
    setSets(nextSets);
    setProjects((projectsResult.data ?? []) as Project[]);
    const nextId = preferredSet && nextSets.some((s) => s.id === preferredSet)
      ? preferredSet
      : (selectedSet && nextSets.some((s) => s.id === selectedSet) ? selectedSet : nextSets[0]?.id ?? '');
    setSelectedSet(nextId);
    if (nextId) {
      const { data, error: entriesError } = await supabase.from('glossary_set_entries')
        .select('id,source_term,translated_term,term_type,notes').eq('set_id', nextId).order('source_term');
      if (entriesError) throw entriesError;
      setEntries((data ?? []) as GlossaryEntry[]);
    } else setEntries([]);
  }, [router, selectedSet]);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setError('ยังไม่ได้ตั้งค่า Supabase ใน Environment Variables');
      setLoading(false);
      return;
    }
    void load().catch((err) => setError(err instanceof Error ? err.message : 'โหลดข้อมูลไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, [load]);

  const visibleEntries = useMemo(() => {
    const q = search.trim().toLocaleLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.source_term.toLocaleLowerCase().includes(q) ||
      e.translated_term.toLocaleLowerCase().includes(q) || (e.notes ?? '').toLocaleLowerCase().includes(q));
  }, [entries, search]);

  const createSet = async (event: FormEvent) => {
    event.preventDefault();
    if (!setName.trim() || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const supabase = getSupabase();
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) throw new Error('กรุณาเข้าสู่ระบบใหม่');
      const { data, error: insertError } = await supabase.from('glossary_sets')
        .insert({ user_id: authData.user.id, name: setName.trim(), description: setDescription.trim() || null })
        .select('id').single();
      if (insertError) throw insertError;
      setSetName(''); setSetDescription('');
      setNotice('สร้างชุดคลังศัพท์แล้ว');
      await load(data.id);
    } catch (err) { setError(err instanceof Error ? err.message : 'สร้างชุดศัพท์ไม่สำเร็จ'); }
    finally { setBusy(false); }
  };

  const addEntry = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedSet || !sourceTerm.trim() || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const supabase = getSupabase();
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) throw new Error('กรุณาเข้าสู่ระบบใหม่');
      const { error: insertError } = await supabase.from('glossary_set_entries').upsert({
        user_id: authData.user.id, set_id: selectedSet, source_term: sourceTerm.trim(),
        translated_term: translatedTerm.trim(), term_type: termType, notes: notes.trim() || null,
      }, { onConflict: 'set_id,source_term' });
      if (insertError) throw insertError;
      setSourceTerm(''); setTranslatedTerm(''); setTermType('other'); setNotes('');
      setNotice('บันทึกคำศัพท์แล้ว');
      await load(selectedSet);
    } catch (err) { setError(err instanceof Error ? err.message : 'บันทึกคำศัพท์ไม่สำเร็จ'); }
    finally { setBusy(false); }
  };

  const deleteEntry = async (entry: GlossaryEntry) => {
    if (!window.confirm(`ลบคำศัพท์ "${entry.source_term}" ออกจากชุดนี้หรือไม่?`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const { error: deleteError } = await getSupabase().from('glossary_set_entries').delete().eq('id', entry.id);
      if (deleteError) throw deleteError;
      setNotice('ลบคำศัพท์แล้ว'); await load(selectedSet);
    } catch (err) { setError(err instanceof Error ? err.message : 'ลบคำศัพท์ไม่สำเร็จ'); }
    finally { setBusy(false); }
  };

  const deleteSet = async () => {
    const current = sets.find((s) => s.id === selectedSet);
    if (!current || !window.confirm(`ลบชุดคลังศัพท์ "${current.name}" พร้อมคำศัพท์ทั้งหมดหรือไม่?`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const { error: deleteError } = await getSupabase().from('glossary_sets').delete().eq('id', current.id);
      if (deleteError) throw deleteError;
      setSelectedTerms([]); setNotice('ลบชุดคลังศัพท์แล้ว'); await load('');
    } catch (err) { setError(err instanceof Error ? err.message : 'ลบชุดคลังศัพท์ไม่สำเร็จ'); }
    finally { setBusy(false); }
  };

  const importEntries = async (all: boolean) => {
    if (!selectedSet || !targetProject || busy) return;
    const terms = all ? entries : entries.filter((entry) => selectedTerms.includes(entry.id));
    if (!terms.length) { setError('เลือกคำศัพท์ที่จะนำเข้าอย่างน้อย 1 รายการ'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const supabase = getSupabase();
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) throw new Error('กรุณาเข้าสู่ระบบใหม่');
      const rows = terms.map((entry) => ({
        user_id: authData.user.id, project_id: targetProject, source_term: entry.source_term,
        translated_term: entry.translated_term, term_type: entry.term_type, notes: entry.notes,
      }));
      const { error: importError } = await supabase.from('glossary_entries').upsert(rows, { onConflict: 'project_id,source_term' });
      if (importError) throw importError;
      setNotice(`นำเข้า ${terms.length} คำไปยังโปรเจกต์แล้ว (คำที่มีชื่อจีนซ้ำจะถูกอัปเดต)`);
      setSelectedTerms([]);
    } catch (err) { setError(err instanceof Error ? err.message : 'นำเข้าคลังศัพท์ไม่สำเร็จ'); }
    finally { setBusy(false); }
  };

  const selected = sets.find((s) => s.id === selectedSet);

  return (
    <main className="min-h-screen bg-bg text-fg">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <a href="/" className="inline-flex items-center gap-2 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" />กลับคลังนิยาย</a>
          <div className="flex items-center gap-2 font-semibold text-sm"><BookOpen className="h-4 w-4 text-accent" />คลังศัพท์ใช้ซ้ำ</div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
        <div>
          <h1 className="text-xl font-bold">ชุดคลังศัพท์</h1>
          <p className="mt-1 text-sm text-muted">เก็บคำแปลไว้ใช้ซ้ำระหว่างนิยายได้ โดยเลือกนำเข้าทีละชุดหรือเฉพาะคำที่ต้องการ — ไม่เชื่อมคลังศัพท์ทุกเรื่องเข้าด้วยกันอัตโนมัติ</p>
        </div>
        {!isSupabaseConfigured() && <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">กรุณาตั้งค่า Supabase URL และ Publishable Key ก่อนใช้งาน</p>}
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {notice && <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</div>}
        <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <section className="rounded-2xl border border-line bg-card p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><FolderOpen className="h-4 w-4 text-accent" />สร้างชุดใหม่</h2>
              <form onSubmit={createSet} className="space-y-3">
                <input value={setName} onChange={(e) => setSetName(e.target.value)} required maxLength={100} placeholder="เช่น ศัพท์เซียน / ชื่อเฉพาะ" className="h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm outline-none focus:ring-2 focus:ring-accent/50" />
                <textarea value={setDescription} onChange={(e) => setSetDescription(e.target.value)} maxLength={500} rows={2} placeholder="คำอธิบาย (ไม่บังคับ)" className="w-full rounded-lg border border-line bg-bg p-3 text-sm outline-none focus:ring-2 focus:ring-accent/50" />
                <button disabled={busy || !setName.trim() || !isSupabaseConfigured()} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 text-sm font-semibold text-accent-fg disabled:opacity-50"><Plus className="h-4 w-4" />สร้างชุดคลังศัพท์</button>
              </form>
            </section>
            <section className="rounded-2xl border border-line bg-card p-3">
              <h2 className="mb-2 px-1 text-xs font-semibold text-muted">ชุดที่มีอยู่ ({sets.length})</h2>
              {loading ? <div className="flex justify-center p-5"><Loader2 className="h-5 w-5 animate-spin" /></div> :
                sets.length === 0 ? <p className="px-1 py-4 text-xs text-muted">ยังไม่มีชุดคลังศัพท์ สร้างชุดแรกได้จากด้านบน</p> :
                <div className="space-y-1">{sets.map((s) => <button key={s.id} onClick={() => { setSelectedSet(s.id); setSelectedTerms([]); setNotice(''); void load(s.id).catch((err) => setError(err.message)); }} className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm ${selectedSet === s.id ? 'bg-accent-soft text-accent-soft-fg' : 'hover:bg-surface'}`}><span className="min-w-0 truncate">{s.name}</span>{selectedSet === s.id && <Check className="h-4 w-4 shrink-0" />}</button>)}</div>}
            </section>
          </aside>
          <div className="min-w-0 space-y-4">
            {selected ? <>
              <section className="rounded-2xl border border-line bg-card p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0"><h2 className="text-lg font-bold">{selected.name}</h2><p className="mt-1 text-xs text-muted">{selected.description || 'ไม่มีคำอธิบาย'} · {entries.length} คำ</p></div>
                  <button onClick={() => void deleteSet()} disabled={busy} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs text-muted hover:border-red-300 hover:text-red-600 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" />ลบชุดนี้</button>
                </div>
                <form onSubmit={addEntry} className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs text-muted">คำต้นฉบับ
                    <input value={sourceTerm} onChange={(e) => setSourceTerm(e.target.value)} required maxLength={300} placeholder="เช่น 沈泽" className="mt-1 h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:ring-2 focus:ring-accent/50" />
                  </label>
                  <label className="text-xs text-muted">คำแปล
                    <input value={translatedTerm} onChange={(e) => setTranslatedTerm(e.target.value)} required maxLength={300} placeholder="เช่น เสิ่นเจ๋อ" className="mt-1 h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:ring-2 focus:ring-accent/50" />
                  </label>
                  <label className="text-xs text-muted">ประเภท
                    <select value={termType} onChange={(e) => setTermType(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg">{TERM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
                  </label>
                  <label className="text-xs text-muted">หมายเหตุ (ไม่บังคับ)
                    <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} placeholder="เช่น ชื่อตัวละครชาย" className="mt-1 h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:ring-2 focus:ring-accent/50" />
                  </label>
                  <button disabled={busy || !sourceTerm.trim() || !translatedTerm.trim()} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-accent px-3 text-sm font-semibold text-accent-fg disabled:opacity-50 sm:col-span-2"><Save className="h-4 w-4" />บันทึกคำศัพท์</button>
                </form>
              </section>
              <section className="rounded-2xl border border-line bg-card">
                <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div><h2 className="text-sm font-semibold">คำศัพท์ในชุดนี้</h2><p className="mt-1 text-xs text-muted">เลือกบางคำเพื่อนำเข้า หรือเลือกนำเข้าทั้งชุด</p></div>
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาคำศัพท์…" className="h-9 w-full rounded-lg border border-line bg-bg px-3 text-sm outline-none focus:ring-2 focus:ring-accent/50 sm:max-w-xs" />
                </div>
                <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
                  <button onClick={() => setSelectedTerms(visibleEntries.length && visibleEntries.every((e) => selectedTerms.includes(e.id)) ? selectedTerms.filter((id) => !visibleEntries.some((e) => e.id === id)) : Array.from(new Set([...selectedTerms, ...visibleEntries.map((e) => e.id)])))} className="rounded-lg border border-line px-3 py-2 text-xs hover:bg-surface">{visibleEntries.length && visibleEntries.every((e) => selectedTerms.includes(e.id)) ? 'ยกเลิกเลือกที่แสดง' : 'เลือกคำที่แสดง'}</button>
                  <span className="text-xs text-muted">เลือกแล้ว {selectedTerms.length} คำ</span>
                  <div className="flex-1" />
                  <button onClick={() => void importEntries(false)} disabled={busy || !targetProject || !selectedTerms.length} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-semibold hover:bg-surface disabled:opacity-40"><FilePlus2 className="h-3.5 w-3.5" />นำเข้าคำที่เลือก</button>
                </div>
                {visibleEntries.length === 0 ? <p className="p-8 text-center text-sm text-muted">{entries.length ? 'ไม่พบคำที่ตรงกับการค้นหา' : 'ชุดนี้ยังไม่มีคำศัพท์ เพิ่มคำแรกจากแบบฟอร์มด้านบน'}</p> :
                  <div className="divide-y divide-line">{visibleEntries.map((entry) => <div key={entry.id} className="flex items-start gap-3 p-3 sm:px-4"><input type="checkbox" checked={selectedTerms.includes(entry.id)} onChange={(e) => setSelectedTerms((old) => e.target.checked ? [...old, entry.id] : old.filter((id) => id !== entry.id))} className="mt-1 h-4 w-4 accent-current" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline gap-x-2 gap-y-1"><span className="font-medium text-sm">{entry.source_term}</span><span className="text-muted">→</span><span className="text-sm text-accent-soft-fg">{entry.translated_term}</span></div><div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted"><span>{TERM_TYPES.find((t) => t.value === entry.term_type)?.label ?? entry.term_type}</span>{entry.notes && <span>· {entry.notes}</span>}</div></div><button onClick={() => void deleteEntry(entry)} title="ลบคำศัพท์" aria-label={`ลบ ${entry.source_term}`} disabled={busy} className="rounded-lg p-2 text-muted hover:text-red-600 disabled:opacity-50"><Trash2 className="h-4 w-4" /></button></div>)}</div>}
                <div className="flex flex-col gap-3 border-t border-line p-4 sm:flex-row sm:items-center">
                  <label className="flex-1 text-xs text-muted">นำเข้าคลังศัพท์ไปยังนิยาย
                    <select value={targetProject} onChange={(e) => setTargetProject(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg">
                      <option value="">เลือกโปรเจกต์ปลายทาง…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                    </select>
                  </label>
                  <button onClick={() => void importEntries(true)} disabled={busy || !targetProject || !entries.length} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg disabled:opacity-40"><Upload className="h-4 w-4" />นำเข้าทั้งชุด ({entries.length})</button>
                </div>
              </section>
            </> : <section className="rounded-2xl border border-dashed border-line bg-card p-10 text-center"><CircleHelp className="mx-auto h-7 w-7 text-muted" /><p className="mt-3 text-sm font-medium">เลือกหรือสร้างชุดคลังศัพท์</p><p className="mt-1 text-xs text-muted">ชุดคลังศัพท์จะแยกจาก glossary ของแต่ละนิยาย จนกว่าจะเลือกนำเข้าเอง</p></section>}
          </div>
        </div>
        {busy && <div className="fixed bottom-4 right-4 inline-flex items-center gap-2 rounded-xl border border-line bg-card px-4 py-3 text-xs shadow-lg"><Loader2 className="h-4 w-4 animate-spin" />กำลังบันทึก…</div>}
      </div>
    </main>
  );
}
