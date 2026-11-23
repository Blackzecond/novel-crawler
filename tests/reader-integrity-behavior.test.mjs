import test from 'node:test';
import assert from 'node:assert/strict';
import { isReaderTargetCurrent, mergeReadingHistory, escapeReaderText, isCloudflareChallengeMarkup, isChapterTitle, isLikelyChapterGroup, isArticleTargetCurrent, selectLatestReadableChapter } from '../lib/readerIntegrity.mjs';
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


test('latest shelf target follows read time, not project update time', () => {
  const projects = [
    { id: 'A', updatedAt: 100, chapters: [{ id: 'a11', url: '/a/11', title: 'A11' }, { id: 'a12', url: '/a/12', title: 'ชื่อบท A12 ใหม่' }] },
    { id: 'B', updatedAt: 999, chapters: [{ id: 'b5', url: '/b/5', title: 'B5' }] },
  ];
  const result = selectLatestReadableChapter(projects, [[
    { projectId: 'B', url: '/b/5', readAt: 9 },
    { projectId: 'A', url: '/a/12', readAt: 10 },
  ]]);
  assert.equal(result.project.id, 'A');
  assert.equal(result.chapter.id, 'a12');
  assert.equal(result.chapter.title, 'ชื่อบท A12 ใหม่');
});

test('cloud and local histories compete by timestamp; local wins exact ties', () => {
  const project = { id: 'A', chapters: [{ id: 'a11', url: '/a/11' }, { id: 'a12', url: '/a/12' }] };
  const result = selectLatestReadableChapter([project], [
    [{ projectId: 'A', url: '/a/11', readAt: 10 }],
    [{ projectId: 'A', url: '/a/12', readAt: 10 }],
  ]);
  assert.equal(result.chapter.id, 'a11');
  const newerCloud = selectLatestReadableChapter([project], [
    [{ projectId: 'A', url: '/a/11', readAt: 9 }],
    [{ projectId: 'A', url: '/a/12', readAt: 10 }],
  ]);
  assert.equal(newerCloud.chapter.id, 'a12');
});

test('history requires projectId and exact chapter URL; standalone and shared URLs cannot cross projects', () => {
  const projects = [
    { id: 'A', chapters: [{ id: 'a', url: '/same?chapter=1' }] },
    { id: 'B', chapters: [{ id: 'b', url: '/same?chapter=1' }] },
  ];
  const result = selectLatestReadableChapter(projects, [[
    { projectId: null, url: '/same?chapter=1', readAt: 100 },
    { url: '/same?chapter=1', readAt: 99 },
    { projectId: 'A', url: '/same', readAt: 98 },
    { projectId: 'B', url: '/same?chapter=1', readAt: 5 },
  ]]);
  assert.equal(result.project.id, 'B');
  assert.equal(result.chapter.id, 'b');
});

test('invalid timestamps and removed projects or chapters are skipped', () => {
  const projects = [{ id: 'A', chapters: [{ id: 'a1', url: '/a/1' }] }];
  const result = selectLatestReadableChapter(projects, [[
    { projectId: 'A', url: '/a/1', readAt: Infinity },
    { projectId: 'A', url: '/a/1', readAt: 0 },
    { projectId: 'A', url: '/removed', readAt: 30 },
    { projectId: 'gone', url: '/gone', readAt: 40 },
    { projectId: 'A', url: '/a/1', readAt: 2 },
  ]]);
  assert.equal(result.chapter.id, 'a1');
  assert.equal(result.readAt, 2);
  assert.equal(selectLatestReadableChapter(projects, [[{ projectId: 'A', url: '/removed', readAt: 50 }]]), null);
});
