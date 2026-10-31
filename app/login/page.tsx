'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpen, Loader2, LockKeyhole } from 'lucide-react';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [busy, setBusy] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setCheckingSession(false);
      return;
    }
    void getSupabase().auth.getSession().then(({ data }) => {
      if (data.session) router.replace('/');
      else setCheckingSession(false);
    }).catch(() => setCheckingSession(false));
  }, [router]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (!isSupabaseConfigured()) {
        throw new Error('ยังไม่ได้ตั้งค่า Supabase URL และ Publishable Key ใน Environment Variables');
      }
      const supabase = getSupabase();
      if (mode === 'signin') {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
        router.replace('/');
        router.refresh();
      } else {
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (authError) throw authError;
        if (data.session) {
          router.replace('/');
          router.refresh();
        } else {
          setMessage('สร้างบัญชีแล้ว กรุณาตรวจอีเมลเพื่อยืนยันบัญชี ก่อนเข้าสู่ระบบ');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เข้าสู่ระบบไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  if (checkingSession) {
    return (
      <main className="min-h-screen bg-bg text-fg flex items-center justify-center gap-2 text-sm text-muted">
        <Loader2 className="h-5 w-5 animate-spin" /> กำลังตรวจสอบสถานะเข้าสู่ระบบ...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg text-fg flex items-center justify-center px-4 py-10">
      <section className="w-full max-w-sm rounded-2xl border border-line bg-card shadow-sm p-6 space-y-5">
        <div className="flex flex-col items-center text-center gap-2">
          <span className="h-11 w-11 inline-flex items-center justify-center rounded-xl bg-accent text-accent-fg">
            <BookOpen className="w-5 h-5" />
          </span>
          <h1 className="text-xl font-bold">Novel Translator</h1>
          <p className="text-sm text-muted">เข้าสู่ระบบเพื่อซิงก์คลังนิยายข้ามอุปกรณ์</p>
        </div>

        {!isSupabaseConfigured() && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 text-amber-800 text-xs p-3 leading-relaxed">
            ยังไม่ได้ตั้งค่า Supabase ใน Environment Variables กรุณาตั้ง NEXT_PUBLIC_SUPABASE_URL และ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ก่อนใช้งานระบบคลาวด์
          </div>
        )}

        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-muted">อีเมล</span>
            <input type="email" required autoComplete="email" value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full h-10 rounded-lg border border-line bg-bg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/60" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted">รหัสผ่าน</span>
            <input type="password" required minLength={mode === 'signup' ? 8 : undefined}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password} onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full h-10 rounded-lg border border-line bg-bg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/60" />
            {mode === 'signup' && <span className="block mt-1 text-[11px] text-muted">อย่างน้อย 8 ตัวอักษร</span>}
          </label>

          {error && <p role="alert" className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs p-3">{error}</p>}
          {message && <p role="status" className="rounded-lg bg-green-50 border border-green-200 text-green-700 text-xs p-3">{message}</p>}

          <button type="submit" disabled={busy || !isSupabaseConfigured()}
            className="w-full h-10 rounded-lg bg-accent text-accent-fg text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LockKeyhole className="w-4 h-4" />}
            {mode === 'signin' ? 'เข้าสู่ระบบ' : 'สร้างบัญชี'}
          </button>
        </form>

        <button type="button" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); setMessage(''); }}
          className="w-full text-xs text-muted hover:text-fg">
          {mode === 'signin' ? 'ยังไม่มีบัญชี? สร้างบัญชีแรกที่นี่' : 'มีบัญชีอยู่แล้ว? กลับไปเข้าสู่ระบบ'}
        </button>
      </section>
    </main>
  );
}
