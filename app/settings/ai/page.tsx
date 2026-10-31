'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, CircleAlert, Loader2, Save, Sparkles, Wifi } from 'lucide-react';
import {
  AiDetectSettings,
  AiProvider,
  AI_PROVIDER_PRESETS,
  inferAiProvider,
  defaultAiSettings,
  hasAiKey,
  loadAiSettings,
  saveAiSettings,
} from '@/lib/ai';
import { loadCloudAiSettings, saveCloudAiSettings } from '@/lib/cloudPreferences';

export default function AiSettingsPage() {
  const [settings, setSettings] = useState<AiDetectSettings>(defaultAiSettings);
  const [provider, setProvider] = useState<AiProvider>(inferAiProvider(defaultAiSettings.baseUrl));
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [returnTo, setReturnTo] = useState('/');

  useEffect(() => {
    const requestedPath = new URLSearchParams(window.location.search).get('returnTo');
    // Only accept a local project path; never allow an external redirect.
    if (requestedPath?.startsWith('/project/') && !requestedPath.startsWith('//') && !requestedPath.includes('\\')) {
      setReturnTo(requestedPath);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const local = loadAiSettings();
      try {
        const cloud = await loadCloudAiSettings();
        if (!active) return;
        const merged = {
          ...local,
          baseUrl: cloud?.baseUrl || local.baseUrl,
          model: cloud?.model || local.model,
        };
        setSettings(merged);
        setProvider(inferAiProvider(merged.baseUrl));
        setSaved(hasAiKey(merged));
      } catch (err) {
        if (!active) return;
        setSettings(local);
        setProvider(inferAiProvider(local.baseUrl));
        setSaved(hasAiKey(local));
        setNotice('โหลดค่าจาก Cloud ไม่สำเร็จ ใช้ค่าที่บันทึกในเบราว์เซอร์นี้แทน');
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => { active = false; };
  }, []);

  const update = (patch: Partial<AiDetectSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
    setSaved(false);
    setNotice('');
    setError('');
  };

  const validate = () => {
    if (!settings.baseUrl.trim()) return 'กรุณากรอก API Base URL';
    if (!settings.model.trim()) return 'กรุณากรอกชื่อโมเดล';
    if (!settings.apiKey.trim()) return 'กรุณากรอก API Key';
    try {
      const url = new URL(settings.baseUrl.trim());
      if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
        return 'API Base URL ต้องใช้ HTTPS (ยกเว้น localhost)';
      }
    } catch {
      return 'รูปแบบ API Base URL ไม่ถูกต้อง';
    }
    return '';
  };

  const persist = async () => {
    const validationError = validate();
    if (validationError) throw new Error(validationError);
    const normalized = {
      ...settings,
      baseUrl: settings.baseUrl.trim().replace(/\/+$/, ''),
      model: settings.model.trim(),
      apiKey: settings.apiKey.trim(),
    };
    saveAiSettings(normalized);
    setSettings(normalized);
    setSaved(true);
    try {
      await saveCloudAiSettings(normalized);
      setNotice('บันทึกการตั้งค่าแล้ว คีย์ API อยู่ในเบราว์เซอร์นี้เท่านั้น');
    } catch {
      setNotice('บันทึกในเบราว์เซอร์แล้ว แต่ซิงก์ Base URL และชื่อโมเดลขึ้น Cloud ไม่สำเร็จ');
    }
    return normalized;
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await persist();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกการตั้งค่าไม่สำเร็จ');
      setSaved(false);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setError('');
    setNotice('');
    try {
      const cfg = await persist();
      const response = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0,
          messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        }),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`ทดสอบไม่ผ่าน (${response.status}): ${detail.slice(0, 220) || response.statusText}`);
      }
      const data = await response.json();
      const answer = data?.choices?.[0]?.message?.content;
      if (typeof answer !== 'string' || !answer.trim()) {
        throw new Error('เชื่อมต่อได้ แต่รูปแบบคำตอบจาก API ไม่ตรงกับ Chat Completions');
      }
      setNotice('เชื่อมต่อสำเร็จ โมเดลตอบกลับแล้ว พร้อมใช้งานทั้ง Reader และระบบจับศัพท์');
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ทดสอบการเชื่อมต่อไม่สำเร็จ');
    } finally {
      setTesting(false);
    }
  };

  return (
    <main className="min-h-screen bg-bg text-fg">
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex h-14 max-w-3xl items-center px-4 sm:px-6">
          <Link href={returnTo} className="inline-flex items-center gap-2 text-sm text-muted hover:text-fg">
            <ArrowLeft className="h-4 w-4" /> กลับหน้าโปรเจกต์
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-6 px-4 py-8 sm:px-6">
        <div className="space-y-2">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-fg">
            <Sparkles className="h-5 w-5" />
          </div>
          <h1 className="text-2xl font-bold">ตั้งค่า AI</h1>
          <p className="text-sm leading-relaxed text-muted">
            ตั้งค่าครั้งเดียว ใช้ร่วมกันทั้งการแปลนิยายใน Reader และการตรวจจับชื่อตัวละคร/ศัพท์เฉพาะ
          </p>
        </div>

        <section className="space-y-4 rounded-2xl border border-line bg-card p-4 sm:p-6">
          {!loaded ? (
            <div role="status" className="flex items-center gap-2 py-6 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดการตั้งค่า...
            </div>
          ) : (
            <>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">ผู้ให้บริการ AI</span>
                <select
                  value={provider}
                  onChange={(event) => {
                    const next = event.target.value as AiProvider;
                    setProvider(next);
                    if (next !== 'custom') {
                      const preset = AI_PROVIDER_PRESETS[next];
                      update({ baseUrl: preset.baseUrl, model: preset.model });
                    } else {
                      setSaved(false);
                    }
                  }}
                  className="h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm outline-none focus:ring-2 focus:ring-accent/50"
                >
                  <option value="gemini">Google Gemini — แนะนำให้เริ่มทดสอบ</option>
                  <option value="qwen">Alibaba Qwen — โมเดลจีน</option>
                  <option value="custom">Custom OpenAI-compatible</option>
                </select>
                <span className="block text-xs text-muted">
                  เปลี่ยนผู้ให้บริการได้โดยไม่ต้องแก้ Reader; เมื่อเปลี่ยนค่ายให้ใช้ API Key ของค่ายนั้นด้วย
                </span>
              </label>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium">API Base URL</span>
                <input
                  type="url"
                  value={settings.baseUrl}
                  onChange={(event) => update({ baseUrl: event.target.value })}
                  placeholder={provider === 'gemini' ? AI_PROVIDER_PRESETS.gemini.baseUrl : provider === 'qwen' ? AI_PROVIDER_PRESETS.qwen.baseUrl : defaultAiSettings.baseUrl}
                  autoComplete="url"
                  className="h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm outline-none focus:ring-2 focus:ring-accent/50"
                />
                <span className="block text-xs text-muted">
                  Gemini ใช้ https://generativelanguage.googleapis.com/v1beta/openai; Qwen ใช้ https://trial.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1 หรือ URL เฉพาะ Workspace จาก Alibaba Cloud
                </span>
              </label>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium">ชื่อโมเดล</span>
                <input
                  type="text"
                  value={settings.model}
                  onChange={(event) => update({ model: event.target.value })}
                  placeholder={provider === 'gemini' ? AI_PROVIDER_PRESETS.gemini.model : provider === 'qwen' ? AI_PROVIDER_PRESETS.qwen.model : 'model-id'}
                  autoComplete="off"
                  className="h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm outline-none focus:ring-2 focus:ring-accent/50"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium">API Key</span>
                <input
                  type="password"
                  value={settings.apiKey}
                  onChange={(event) => update({ apiKey: event.target.value })}
                  placeholder="วาง API Key ที่นี่"
                  autoComplete="off"
                  spellCheck={false}
                  className="h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm outline-none focus:ring-2 focus:ring-accent/50"
                />
                <span className="block text-xs text-muted">เก็บไว้ใน localStorage ของเบราว์เซอร์นี้เท่านั้น ไม่ส่งไปเก็บใน Supabase</span>
              </label>

              <div className="rounded-xl border border-line bg-surface p-3 text-xs leading-relaxed text-muted">
                <p className="font-semibold text-fg">การจัดเก็บและความเป็นส่วนตัว</p>
                <p className="mt-1">Base URL และชื่อโมเดลซิงก์ข้ามอุปกรณ์ผ่านบัญชีของคุณได้ ส่วน API Key จะอยู่ในเบราว์เซอร์นี้และส่งตรงไปยังผู้ให้บริการ API ที่ระบุเท่านั้น</p>
                <p className="mt-1">Gemini Free tier อาจนำข้อมูลที่ส่งไปใช้ปรับปรุงบริการของ Google; หากต้นฉบับมีเนื้อหาส่วนตัวหรือไม่ต้องการให้ใช้ฝึกโมเดล ควรพิจารณาเงื่อนไข Paid tier ก่อนใช้งาน</p>
              </div>

              {error && (
                <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger-line bg-danger-bg p-3 text-sm text-danger-fg">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> <span>{error}</span>
                </div>
              )}
              {notice && (
                <div role="status" className="flex items-start gap-2 rounded-lg border border-accent-line bg-accent-soft p-3 text-sm text-accent-soft-fg">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> <span>{notice}</span>
                </div>
              )}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => void handleTest()}
                  disabled={saving || testing}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line px-4 text-sm font-medium hover:bg-surface disabled:opacity-50"
                >
                  {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
                  {testing ? 'กำลังทดสอบ...' : 'บันทึกและทดสอบ'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving || testing}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg hover:brightness-110 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {saving ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}
                </button>
              </div>
              {saved && <p className="text-right text-xs text-muted">มีการตั้งค่า API Key แล้ว</p>}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
