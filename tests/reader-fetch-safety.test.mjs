import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('web/PWA ignores stale Android WebView strategy and cannot persist it', async () => {
  const source = await read('../lib/nativeBrowserFetch.ts');
  assert.match(source, /function supportsNativeBrowser\(\): boolean[\s\S]*?Capacitor\.isNativePlatform\(\)[\s\S]*?Capacitor\.getPlatform\(\) === 'android'/);
  assert.match(source, /prefersNativeBrowser\(projectId: string\): boolean \{\s*\/\/ Ignore stale WebView preferences[\s\S]*?supportsNativeBrowser\(\)/);
  assert.match(source, /rememberNativeBrowser\(projectId: string\): void \{\s*if \(typeof window === 'undefined' \|\| !supportsNativeBrowser\(\)\) return/);
});

test('parser extracts list-only chapter content and rejects empty extraction', async () => {
  const source = await read('../app/api/parse/route.ts');
  assert.match(source, /if \(!paragraphs\.length\) \{[\s\S]*?querySelectorAll\('li'\)/);
  assert.match(source, /if \(!plainText\.trim\(\) \|\| !formattedHtml\.trim\(\)\)[\s\S]*?status: 422/);
});

test('prefetch validates content before assigning it and caches only after saving its real UUID', async () => {
  const source = await read('../app/read/page.tsx');
  const candidateValidation = source.indexOf('const candidate = payload;');
  const candidateAssign = source.indexOf('data = candidate;', candidateValidation);
  assert.ok(candidateValidation >= 0 && candidateAssign > candidateValidation);
  assert.ok(source.indexOf("!candidate.content.trim()", candidateValidation) < candidateAssign);
  assert.match(source, /cacheableArticle = \{ \.\.\.prefetchedArticle, chapterId: saved\.id \}/);
  assert.match(source, /Cache only after persistence succeeds, and keep the real UUID beside content\.[\s\S]*?chapterCacheRef\.current\.set\(cacheKey, cacheableArticle\)/);
  assert.match(source, /const cachedChapterId = inMemoryArticle\.chapterId/);
  assert.match(source, /if \(activeProjectId && !cachedChapterId\)/);
});
