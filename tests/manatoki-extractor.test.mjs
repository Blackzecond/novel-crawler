import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const extractorPath = new URL('../packages/capacitor-browser-fetch/android/src/main/assets/manatoki-extractor.js', import.meta.url);
const source = readFileSync(extractorPath, 'utf8');
const context = {
  window: { __ncManatokiTestMode: true },
  location: { href: 'https://manatoki1.org/not-a-chapter' },
  URL,
  document: {}
};

new vm.Script(source, { filename: 'manatoki-extractor.js' });
vm.runInNewContext(source, context, { filename: 'manatoki-extractor.js' });
const extractProperty = context.window.__ncManatokiTestHooks?.extractProperty;
assert.equal(typeof extractProperty, 'function', 'test hook should expose extractProperty');

test('extracts ordinary JSON properties', () => {
  assert.equal(extractProperty('{"token":"plain-token"}', 'token'), 'plain-token');
  assert.equal(extractProperty('{"cookieName":"nv"}', 'cookieName'), 'nv');
});

test('extracts escaped and multiply escaped JSON properties', () => {
  const escaped = JSON.stringify(JSON.stringify({ token: 'escaped-token' }));
  const deeplyEscaped = JSON.stringify(JSON.stringify(JSON.stringify({ token: 'deep-token' })));
  assert.equal(extractProperty(escaped, 'token'), 'escaped-token');
  assert.equal(extractProperty(deeplyEscaped, 'token'), 'deep-token');
});

test('extracts properties when whitespace surrounds the colon', () => {
  assert.equal(extractProperty('{"token" : "spaced-token"}', 'token'), 'spaced-token');
  assert.equal(extractProperty('{"cookieName"   :   "nv"}', 'cookieName'), 'nv');
});

test('normalizes HTML-escaped property names and values', () => {
  assert.equal(extractProperty('&quot;token&quot;:&quot;entity-token&quot;', 'token'), 'entity-token');
});

test('returns null when the requested property is absent', () => {
  assert.equal(extractProperty('{"other":"value"}', 'token'), null);
  assert.equal(extractProperty('', 'token'), null);
});

test('accepts plain text beginning with a bracketed Korean notice', () => {
  const payload = extractProperty ? context.window.__ncManatokiTestHooks.parseDecodedPayload('[시스템 알림]\n본문 내용입니다.') : null;
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
    kind: 'text',
    text: '[시스템 알림]\n본문 내용입니다.'
  });
});

test('recognizes a valid JSON array so unsupported structures can be rejected', () => {
  const payload = context.window.__ncManatokiTestHooks.parseDecodedPayload('[]');
  assert.equal(payload.kind, 'json');
  assert.deepEqual(JSON.parse(JSON.stringify(payload.data)), []);
});

test('keeps malformed JSON-looking plain text as text', () => {
  const payload = context.window.__ncManatokiTestHooks.parseDecodedPayload('[시스템 알림] 안내');
  assert.equal(payload.kind, 'text');
});
