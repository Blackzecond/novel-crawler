import test from 'node:test';
import assert from 'node:assert/strict';
import { isReaderTargetCurrent, mergeReadingHistory, escapeReaderText, isCloudflareChallengeMarkup, isChapterTitle, isLikelyChapterGroup, isArticleTargetCurrent } from '../lib/readerIntegrity.mjs';
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
test('late request from another project is rejected', async () => {
  let active = { requestId: 1, projectId: 'P', url: '/P/A' }; const target = { ...active }; const gate = deferred();
  const result = gate.promise.then((value) => isReaderTargetCurrent(active, target) ? value : 'ignored');
  active = { requestId: 2, projectId: 'Q', url: '/Q/B' }; gate.resolve('A'); assert.equal(await result, 'ignored');
});
test('history merge isolates projects and keeps newest record', () => {
  const result = mergeReadingHistory([{ url: '/same', title: 'P old', readAt: 1, projectId: 'P' }, { url: '/same', title: 'Q', readAt: 2, projectId: 'Q' }], [{ url: '/same', title: 'P new', readAt: 3, projectId: 'P' }]);
  assert.equal(result.length, 2); assert.equal(result.find((x) => x.projectId === 'P').title, 'P new');
});
test('legacy plain text is HTML escaped', () => assert.equal(escapeReaderText('<x>&'), '&lt;x&gt;&amp;'));
test('CAPTCHA classifier distinguishes challenge markup from prose and widgets', () => {
  assert.equal(isCloudflareChallengeMarkup({ body: 'Just a moment, she said.' }), false);
  assert.equal(isCloudflareChallengeMarkup({ html: '<div class="cf-turnstile"></div>' }), false);
  assert.equal(isCloudflareChallengeMarkup({ html: '<form id="challenge-form"></form>' }), true);
});
test('TOC confidence rejects menu pairs but accepts short chapter lists', () => {
  assert.equal(isLikelyChapterGroup([{ title: 'Previous' }, { title: 'Next' }]), false);
  assert.equal(isLikelyChapterGroup([{ title: 'Chapter 1' }, { title: 'Chapter 2' }]), true);
  assert.equal(isChapterTitle('บทที่ 1'), true);
});

test('replacement order is persisted by increasing created_at timestamps', async () => {
  const { withStableReplacementOrder } = await import('../lib/readerIntegrity.mjs');
  const rows = withStableReplacementOrder([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 1000);
  assert.deepEqual(rows.map((row) => row.created_at), [
    '1970-01-01T00:00:01.000Z', '1970-01-01T00:00:01.001Z', '1970-01-01T00:00:01.002Z',
  ]);
});

test('forced source refresh can clear translated status while ordinary fetch cannot downgrade it', async () => {
  const { resolveChapterStatus } = await import('../lib/readerIntegrity.mjs');
  assert.equal(resolveChapterStatus('translated', 'fetched'), 'translated');
  assert.equal(resolveChapterStatus('translated', 'fetched', true), 'fetched');
  assert.equal(resolveChapterStatus('pending', 'fetched'), 'fetched');
});
