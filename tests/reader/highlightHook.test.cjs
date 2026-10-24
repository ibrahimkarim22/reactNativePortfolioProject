const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');
function host({ runtime } = {}) {
  const file = path.resolve(__dirname, '../../reader/useReaderHighlights.js');
  assert.ok(fs.existsSync(file), 'production auth/session adapter exists');
  let cursor = 0, effects = [], authCallback, subscriptions = 0, normalReads = 0;
  const seenAuth = [];
  const slots = [], sessions = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const memo = (f, deps) => { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: f(), deps }; return slots[i].value; };
  const effect = (f, deps) => { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { f, deps, cleanup: f() }; }); };
  const React = { useRef: v => memo(() => ({ current: v }), []), useMemo: memo, useEffect: effect,
    useSyncExternalStore: (subscribe, getSnapshot) => { effect(() => subscribe(() => {}), [subscribe]); return getSnapshot(); } };
  const createSession = options => {
    const calls = []; let snapshot = { scope: { uid: null }, privacyReady: false }; const listeners = new Set();
    const session = { calls, options, getSnapshot: () => snapshot, subscribe: f => { listeners.add(f); return () => listeners.delete(f); },
      setOwner: uid => { calls.push(['owner', uid]); snapshot = { ...snapshot, scope: { uid } }; listeners.forEach(f => f()); },
      setReady: ready => calls.push(['ready', ready]), dispose: () => calls.push(['dispose']),
      create() {}, recolor() {}, remove() {}, retry() {}, show() {} };
    sessions.push(session); return session;
  };
  const dependencies = {
    react: React, '@react-native-async-storage/async-storage': {}, '../firebaseConfig': { FIREBASE_AUTH: {} },
    'firebase/auth': { onAuthStateChanged: (_auth, callback, onError) => { seenAuth.push(_auth); subscriptions++; authCallback = callback; return () => subscriptions--; } },
    './readerHighlightStore': { createHighlightStoreManager: () => ({}) }, './readerHighlightSession': { createReaderHighlightSession: createSession },
  };
  const module = { exports: {} };
  const code = babel.transformFileSync(file, { babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'] }).code;
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: file })(name => { if (name === '../firebaseConfig') normalReads++; return dependencies[name]; }, module, module.exports);
  return { sessions, seenAuth, get normalReads() { return normalReads; }, auth: uid => { const user = uid ? { uid } : null; if (runtime) runtime.auth.currentUser = user; authCallback(user); }, get subscriptions() { return subscriptions; },
    render(document, ready = true) { cursor = 0; effects = []; const value = module.exports.default(document, { current: {} }, ready, runtime); effects.forEach(f => f()); return value; },
    replay() { const active = slots.filter(s => s?.f); active.forEach(s => s.cleanup?.()); active.forEach(s => { s.cleanup = s.f(); }); },
    unmount() { slots.forEach(s => s?.cleanup?.()); },
  };
}

test('isolated runtime uses only its synthetic Auth and manager without initializing normal Firebase', async () => {
  const auth = {}, manager = {}, owners = [], works = [];
  const runtime = { mode: 'emulator', auth, manager, coordinator: { setOwner: uid => { owners.push(uid); return Promise.resolve(); }, openWork: canonical => { works.push(canonical); return Promise.resolve(); } } };
  const h = host({ runtime }), canonical = {}, document = { canonical };
  h.render(document); h.auth('synthetic-a'); h.render(document);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.normalReads, 0); assert.deepEqual(h.seenAuth, [auth]);
  assert.equal(h.sessions[0].options.manager, manager); assert.deepEqual(owners, ['synthetic-a']);
  assert.ok(works.includes(canonical)); h.unmount();
});

test('A to B to A never lets the first A startup reopen a superseded work subscription', async () => {
  const pending = [], works = [], auth = {};
  const runtime = { mode: 'emulator', auth, manager: {}, coordinator: {
    setOwner: () => new Promise(resolve => pending.push(resolve)),
    openWork: canonical => { works.push(canonical); return Promise.resolve(); },
  } };
  const h = host({ runtime }); h.render({ canonical: {} });
  h.auth('a'); h.auth('b'); h.auth('a');
  pending[0](); pending[1](); pending[2]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(works.length, 1); h.unmount();
});
test('auth adapter starts without an owner, observes account changes, and reading readiness is explicit', () => {
  const h = host(), document = {}; h.render(document, false);
  assert.equal(h.subscriptions, 1); assert.deepEqual(h.sessions[0].calls, [['ready', false]]);
  h.auth('test-a'); assert.equal(h.render(document, true).scope.uid, 'test-a');
  h.auth('test-b'); assert.equal(h.render(document, true).scope.uid, 'test-b');
  h.auth(null); assert.equal(h.render(document, true).scope.uid, null);
  assert.ok(h.sessions[0].calls.some(x => x[0] === 'ready' && x[1] === true));
});
test('StrictMode effect replay preserves a live session; actual unmount disposes and unsubscribes', async () => {
  const h = host(); h.render({}); h.replay(); await Promise.resolve();
  assert.equal(h.sessions[0].calls.filter(x => x[0] === 'dispose').length, 0);
  assert.equal(h.subscriptions, 1); h.unmount(); await Promise.resolve();
  assert.equal(h.subscriptions, 0); assert.equal(h.sessions[0].calls.filter(x => x[0] === 'dispose').length, 1);
});
test('a replacement document retires only the old session; no document creates no personal store', async () => {
  const h = host(); h.render(undefined); assert.equal(h.sessions.length, 0);
  h.render({}); const old = h.sessions[0]; h.render({}); await Promise.resolve();
  assert.ok(old.calls.some(x => x[0] === 'dispose')); assert.equal(h.sessions.length, 2);
  assert.equal(h.sessions[1].calls.some(x => x[0] === 'dispose'), false);
});
