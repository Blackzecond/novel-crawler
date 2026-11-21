import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('stale reader requests cannot repaint the active chapter', async () => {
 const s=await read('../app/read/page.tsx');
 assert.match(s,/const requestId = \+\+readerRequestRef\.current/);
 assert.match(s,/if \(!isCurrentRequest\(\)\) return;/);
 assert.match(s,/if \(isCurrentRequest\(\)\) setLoading\(false\)/);
});
test('history is scoped by project and restores its project context', async () => {
 const s=await read('../app/read/page.tsx'); const c=await read('../lib/cloudPreferences.ts');
 assert.match(s,/projectId\?: string \| null/);
 assert.match(s,/h\.projectId \?\? null\) !== itemProjectId/);
 assert.match(s,/fetchArticle\(item\.url, false, item\.projectId \?\? null\)/);
 assert.match(c,/projectId\?: string \| null/);
});
test('last chapter cache can be restored', async () => {
 const s=await read('../app/read/page.tsx');
 assert.match(s,/if \(cached\?\.readerContent !== undefined\) \{/);
 assert.doesNotMatch(s,/cached\?\.readerContent !== undefined && project\.chapters\.findIndex/);
});
test('backup includes reader HTML and pre-proofread draft; import restores glossary types', async () => {
 const h=await read('../app/page.tsx'); const c=await read('../lib/cloudStorage.ts');
 assert.match(h,/preProofreadText: content\.preProofreadText/); assert.match(h,/readerContent: content\.readerContent/);
 assert.match(c,/preProofreadText: oldChapter\.preProofreadText/); assert.match(c,/glossaryTypes: raw\.glossaryTypes/);
});
test('imported replacement rules get fresh primary keys', async () => {
 const c=await read('../lib/cloudStorage.ts'); assert.match(c,/wordReplacements: Array\.isArray\(raw\.wordReplacements\)[\s\S]*?id: createId\(\)/);
});
test('natural-language CAPTCHA phrases are not challenge signals', async () => {
 const s=await read('../lib/fetchHtml.ts'); const f=s.slice(s.indexOf('export function isChallengePage'),s.indexOf('function isChallengeResponse'));
 assert.doesNotMatch(f,/just a moment|verify you are human|checking your browser/); assert.match(f,/challenge-platform/);
});
test('one-to-five chapter directory groups can be recognized', async () => {
 const s=await read('../lib/sites.ts'); const t=await read('../app/api/toc/route.ts');
 assert.match(s,/extractChapterList\(html, baseUrl, minGroupSize = 1\)/); assert.match(s,/items\.length === 1 && !CHAPTER_TITLE_RE/);
 assert.match(t,/extractChapterList\(page\.html, page\.url, 1\)/); assert.match(t,/toc\.chapters\.length >= 1/);
});
