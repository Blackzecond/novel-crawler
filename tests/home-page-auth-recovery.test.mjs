import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Module from 'node:module';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import ts from 'typescript';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const integrity = await import('../lib/readerIntegrity.mjs');
const deferred = () => {
  let resolvePromise;
  const promise = new Promise((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
};

function compileTsModule(filePath, mocks) {
  const absolutePath = resolve(filePath);
  const source = readFileSync(absolutePath, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const compiled = new Module(absolutePath);
  compiled.filename = absolutePath;
  compiled.paths = Module._nodeModulePaths(dirname(absolutePath));
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (Object.hasOwn(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    compiled._compile(output, absolutePath);
  } finally {
    Module._load = originalLoad;
  }
  return compiled.exports;
}

function makeSupabase(state) {
  return {
    auth: {
      getSession: async () => {
        state.getSessionCalls += 1;
        const result = state.sessionResults.shift();
        return typeof result === 'function' ? result() : result;
      },
      getUser: async () => {
        state.getUserCalls += 1;
        const result = state.userResults.shift() ?? { data: { user: { id: 'account-A' } }, error: null };
        return typeof result === 'function' ? result() : result;
      },
      onAuthStateChange: (callback) => {
        state.authCallback = callback;
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: state.preferenceRows.shift() ?? null,
            error: null,
          }),
        }),
      }),
    }),
  };
}

async function mountHomePage(state, { localHistory = [] } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  const previousGlobals = {};
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'getComputedStyle']) {
    previousGlobals[key] = Object.getOwnPropertyDescriptor(globalThis, key);
  }
  const setGlobal = (key, value) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  setGlobal('window', dom.window);
  setGlobal('document', dom.window.document);
  setGlobal('navigator', dom.window.navigator);
  setGlobal('HTMLElement', dom.window.HTMLElement);
  setGlobal('Node', dom.window.Node);
  setGlobal('Event', dom.window.Event);
  setGlobal('MouseEvent', dom.window.MouseEvent);
  setGlobal('getComputedStyle', dom.window.getComputedStyle.bind(dom.window));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  dom.window.localStorage.setItem('novel_history', JSON.stringify(localHistory));

  const supabase = makeSupabase(state);
  const cloudModule = compileTsModule('lib/cloudPreferences.ts', {
    '@/lib/supabase': { getSupabase: () => supabase, isSupabaseConfigured: () => true },
  });
  const project = {
    id: 'project-A',
    title: 'นิยายบัญชี A',
    host: 'example.com',
    chapters: [
      { id: 'chapter-A', url: '/chapter/A', title: 'ตอน A', status: 'fetched' },
      { id: 'chapter-B', url: '/chapter/B', title: 'ตอน B', status: 'fetched' },
    ],
    updatedAt: 10,
    coverUrl: null,
    lastReadChapterId: null,
  };
  const store = { listProjects: async () => {
    state.listProjectsCalls += 1;
    const nextError = state.listProjectsErrors?.shift();
    if (nextError) throw nextError;
    return state.projects ?? [project];
  } };
  const router = { replace: (url) => { state.redirects.push(url); }, push() {} };
  const iconStub = new Proxy({}, { get: () => () => null });
  const mocks = {
    'next/navigation': { useRouter: () => router },
    'lucide-react': iconStub,
    '@/lib/storage': { getLocalProjectsForMigration: () => [], getStore: () => store },
    '@/lib/supabase': { getSupabase: () => supabase, isSupabaseConfigured: () => true },
    '@/lib/readerPrefs': {
      applySavedTheme() {},
      loadReaderSettings: () => ({ theme: 'light' }),
      saveReaderSettings() {},
    },
    '@/lib/cloudPreferences': {
      loadCloudReaderSettings: async () => null,
      saveCloudReaderSettings: async () => {},
      loadCloudReadingHistory: cloudModule.loadCloudReadingHistory,
    },
    '@/lib/readerIntegrity.mjs': integrity,
    '@/lib/nativeBrowserFetch': { fetchWithNativeBrowser: async () => null, rememberNativeBrowser() {} },
    '@/lib/novelMemory': { exportNovelMemoryBundle: async () => ({}) },
    '@/components/NovelCover': () => null,
  };
  const pageModule = compileTsModule('app/page.tsx', mocks);
  const rootElement = dom.window.document.getElementById('root');
  const root = createRoot(rootElement);
  await act(async () => {
    root.render(React.createElement(pageModule.default));
    await new Promise((resolve) => setImmediate(resolve));
  });

  return {
    dom,
    state,
    async flush() {
      await act(async () => {
        for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
      });
    },
    async clickRetry() {
      const button = [...dom.window.document.querySelectorAll('button')]
        .find((node) => node.textContent.includes('ลองโหลดอีกครั้ง'));
      assert.ok(button, 'retry button should be visible');
      await act(async () => {
        button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        await Promise.resolve();
      });
    },
    async unmount() {
      await act(async () => root.unmount());
      dom.window.close();
      for (const [key, descriptor] of Object.entries(previousGlobals)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
      delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    },
  };
}

const historyA = { projectId: 'project-A', url: '/chapter/A', title: 'ตอน A', readAt: 200 };
const localHistoryB = [{ projectId: 'project-A', url: '/chapter/B', title: 'ตอน B', readAt: 100 }];
const sessionA = { data: { session: { user: { id: 'account-A' } } }, error: null };
const authError = { message: 'temporary auth network failure' };
const preferences = (reading_history) => ({ reader_settings: null, ai_settings: null, reading_history });

test('home page keeps the last cloud chapter when same-account getUser returns an auth error', async () => {
  const state = {
    getSessionCalls: 0,
    getUserCalls: 0,
    listProjectsCalls: 0,
    redirects: [],
    sessionResults: [sessionA],
    userResults: [
      { data: { user: { id: 'account-A' } }, error: null },
      { data: { user: null }, error: authError },
    ],
    preferenceRows: [preferences([historyA])],
  };
  const app = await mountHomePage(state, { localHistory: localHistoryB });
  try {
    await app.flush();
    const readLink = () => app.dom.window.document.querySelector('a[aria-label="อ่านต่อ นิยายบัญชี A ตอน ตอน A"]');
    assert.ok(readLink(), 'cloud chapter A should be selected on the first successful load');
    app.state.authCallback('SIGNED_IN', { user: { id: 'account-A' } });
    await app.flush();
    assert.equal(state.getUserCalls, 2);
    assert.equal(new URL(readLink().href).searchParams.get('url'), '/chapter/A',
      'a transient auth verification failure must not replace the last successful cloud snapshot with local chapter B');
  } finally {
    await app.unmount();
  }
});

test('home page clears the previous cloud chapter for a missing preference row, null history, or empty array', async () => {
  for (const emptyPreferences of [null, preferences(null), preferences([])]) {
    const state = {
      getSessionCalls: 0,
      getUserCalls: 0,
      listProjectsCalls: 0,
      redirects: [],
      sessionResults: [sessionA],
      userResults: [
        { data: { user: { id: 'account-A' } }, error: null },
        { data: { user: { id: 'account-A' } }, error: null },
      ],
      preferenceRows: [preferences([historyA]), emptyPreferences],
    };
    const app = await mountHomePage(state);
    try {
      await app.flush();
      assert.ok(app.dom.window.document.querySelector('a[aria-label="อ่านต่อ นิยายบัญชี A ตอน ตอน A"]'));
      app.state.authCallback('SIGNED_IN', { user: { id: 'account-A' } });
      await app.flush();
      assert.equal(app.dom.window.document.querySelector('a[aria-label="อ่านต่อ นิยายบัญชี A ตอน ตอน A"]'), null,
        'a successful empty cloud response must clear old cloud history');
    } finally {
      await app.unmount();
    }
  }
});

test('home page retry rechecks the session after the initial getSession failure', async () => {
  const retrySession = deferred();
  const state = {
    getSessionCalls: 0,
    getUserCalls: 0,
    listProjectsCalls: 0,
    redirects: [],
    sessionResults: [
      { data: { session: null }, error: authError },
      () => retrySession.promise,
    ],
    userResults: [{ data: { user: { id: 'account-A' } }, error: null }],
    preferenceRows: [preferences([])],
  };
  const app = await mountHomePage(state);
  try {
    await app.flush();
    assert.equal(state.getSessionCalls, 1);
    assert.equal(state.listProjectsCalls, 0);
    assert.ok(app.dom.window.document.querySelector('[role="alert"]'));
    await app.clickRetry();
    assert.equal(state.getSessionCalls, 2, 'retry must repeat the failed session request');
    assert.equal(state.listProjectsCalls, 0, 'project loading waits until session resolution');
    assert.equal(app.dom.window.document.querySelector('#novel-toc-url'), null,
      'the empty-library form must stay hidden while session retry is pending');
    retrySession.resolve(sessionA);
    await app.flush();
    assert.equal(state.listProjectsCalls, 1);
    assert.ok(app.dom.window.document.body.textContent.includes('นิยายบัญชี A'));
    assert.equal(app.dom.window.document.querySelector('#novel-toc-url'), null);
  } finally {
    await app.unmount();
  }
});

test('home page allows another session retry after the service remains offline', async () => {
  const state = {
    getSessionCalls: 0,
    getUserCalls: 0,
    listProjectsCalls: 0,
    redirects: [],
    sessionResults: [
      { data: { session: null }, error: authError },
      { data: { session: null }, error: authError },
      sessionA,
    ],
    userResults: [{ data: { user: { id: 'account-A' } }, error: null }],
    preferenceRows: [preferences([])],
  };
  const app = await mountHomePage(state);
  try {
    await app.flush();
    await app.clickRetry();
    await app.flush();
    assert.equal(state.getSessionCalls, 2);
    assert.ok(app.dom.window.document.querySelector('[role="alert"]'));
    assert.ok([...app.dom.window.document.querySelectorAll('button')].some((button) => button.textContent.includes('ลองโหลดอีกครั้ง')));
    assert.equal(app.dom.window.document.querySelector('#novel-toc-url'), null);
    await app.clickRetry();
    await app.flush();
    assert.equal(state.getSessionCalls, 3);
    assert.equal(state.listProjectsCalls, 1);
    assert.ok(app.dom.window.document.body.textContent.includes('นิยายบัญชี A'));
  } finally {
    await app.unmount();
  }
});

test('home page routes to login when a retried session is confirmed signed out', async () => {
  const state = {
    getSessionCalls: 0,
    getUserCalls: 0,
    listProjectsCalls: 0,
    redirects: [],
    sessionResults: [
      { data: { session: null }, error: authError },
      { data: { session: null }, error: null },
    ],
    userResults: [],
    preferenceRows: [],
  };
  const app = await mountHomePage(state);
  try {
    await app.flush();
    await app.clickRetry();
    await app.flush();
    assert.deepEqual(state.redirects, ['/login']);
    assert.equal(state.listProjectsCalls, 0);
    assert.equal(app.dom.window.document.querySelector('#novel-toc-url'), null);
  } finally {
    await app.unmount();
  }
});

test('retry after a project-list failure does not recheck the known session', async () => {
  const state = {
    getSessionCalls: 0,
    getUserCalls: 0,
    listProjectsCalls: 0,
    listProjectsErrors: [new Error('temporary project-list failure')],
    redirects: [],
    sessionResults: [sessionA],
    userResults: [{ data: { user: { id: 'account-A' } }, error: null }],
    preferenceRows: [preferences([])],
  };
  const app = await mountHomePage(state);
  try {
    await app.flush();
    assert.ok(app.dom.window.document.querySelector('[role="alert"]'));
    await app.clickRetry();
    await app.flush();
    assert.equal(state.getSessionCalls, 1);
    assert.equal(state.listProjectsCalls, 2);
    assert.ok(app.dom.window.document.body.textContent.includes('นิยายบัญชี A'));
  } finally {
    await app.unmount();
  }
});

test('late initial session response cannot replace the account activated by a newer auth event', async () => {
  const initialSession = deferred();
  const projectB = {
    id: 'project-B',
    title: 'นิยายบัญชี B',
    host: 'example.net',
    chapters: [],
    updatedAt: 20,
    coverUrl: null,
    lastReadChapterId: null,
  };
  const state = {
    getSessionCalls: 0,
    getUserCalls: 0,
    listProjectsCalls: 0,
    redirects: [],
    projects: [projectB],
    sessionResults: [() => initialSession.promise],
    userResults: [{ data: { user: { id: 'account-B' } }, error: null }],
    preferenceRows: [preferences([])],
  };
  const app = await mountHomePage(state);
  try {
    state.authCallback('SIGNED_IN', { user: { id: 'account-B' } });
    await app.flush();
    assert.ok(app.dom.window.document.body.textContent.includes('นิยายบัญชี B'));
    initialSession.resolve(sessionA);
    await app.flush();
    assert.ok(app.dom.window.document.body.textContent.includes('นิยายบัญชี B'));
    assert.equal(app.dom.window.document.body.textContent.includes('นิยายบัญชี A'), false);
    assert.equal(state.listProjectsCalls, 1);
  } finally {
    await app.unmount();
  }
});
