import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const homePage = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const nativePlugin = readFileSync(new URL('../packages/capacitor-browser-fetch/android/src/main/java/com/blackzecond/novelcrawler/browserfetch/BrowserFetchPlugin.java', import.meta.url), 'utf8');

test('project creation stages a TOC draft and only creates after explicit confirmation', () => {
  const createHandler = homePage.slice(homePage.indexOf('const handleCreate ='), homePage.indexOf('const reviewTocInBrowser ='));
  const confirmHandler = homePage.slice(homePage.indexOf('const confirmCreateProject ='), homePage.indexOf('const handleDelete ='));

  assert.match(createHandler, /setTocDraft\(draft\)/);
  assert.doesNotMatch(createHandler, /getStore\(\)\.createProject/);
  assert.match(confirmHandler, /getStore\(\)\.createProject/);
  assert.match(homePage, /ยืนยันและสร้างโปรเจค/);
  assert.match(homePage, /กลับไปตรวจใน WebView/);
});

test('native TOC capture requires manual page capture and confirmation', () => {
  assert.match(nativePlugin, /เก็บหน้านี้/);
  assert.match(nativePlugin, /ยืนยันสารบัญ/);
  assert.match(nativePlugin, /finishTocCapture\(call, dialog, finished, capturedTocPages\)/);
  assert.match(nativePlugin, /capturedTocPages\.put/);
  assert.doesNotMatch(nativePlugin, /webView\.loadUrl\(nextUrl\)/);
});

test('TOC WebView no longer auto-expands controls behind the user', () => {
  const showBrowser = nativePlugin.slice(nativePlugin.indexOf('private void showBrowser('), nativePlugin.indexOf('private void finishTocCapture('));
  assert.doesNotMatch(showBrowser, /el\.click\(\)/);
  assert.match(showBrowser, /ตรวจสอบสารบัญ เลื่อนหรือเปลี่ยนหน้าเว็บได้/);
});
