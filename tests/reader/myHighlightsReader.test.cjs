const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');

function host() {
  const file = path.resolve(__dirname, '../../reader/useMyHighlightsReader.js');
  assert.ok(fs.existsSync(file), 'reader handoff adapter exists');
  let cursor = 0, effects = [], starts = 0, cancellations = 0, callback;
  let owner = { uid: 'a', generation: 1, ready: true };
  const slots = [];
  const equal = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const memo = (fn, deps) => { const i = cursor++; if (!slots[i] || !equal(slots[i].deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value; };
  const effect = (fn, deps) => { const i = cursor++; if (!slots[i] || !equal(slots[i].deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, fn, cleanup: fn() }; }); };
  const React = { useRef: value => memo(() => ({ current: value }), []), useCallback: (fn, deps) => memo(() => fn, deps),
    useState: initial => { const value = memo(() => ({ current: initial }), []); return [value.current, next => { value.current = typeof next === 'function' ? next(value.current) : next; }]; }, useEffect: effect,
    useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot() };
  const store = {}, calls = [];
  const module = { exports: {} };
  const deps = { react: React, './useHighlightOwner': { highlightOwner: { getSnapshot: () => owner, subscribe: () => () => {} } }, './normalHighlightStore': {
    normalHighlightManager: { forWork: scope => { calls.push(scope); return store; } },
    normalMyHighlightsHandoff: { open: options => { starts++; callback = options; return { cancel: () => cancellations++ }; } },
  } };
  const code = babel.transformFileSync(file, { babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'] }).code;
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: file })(name => deps[name], module, module.exports);
  return { calls, store, get starts() { return starts; }, get cancellations() { return cancellations; }, get callback() { return callback; },
    setOwner(next) { owner = next; },
    render(props) { cursor = 0; effects = []; const result = module.exports.default(props); effects.forEach(fn => fn()); return result; },
    replay() { const active = slots.filter(slot => slot?.fn); active.forEach(slot => slot.cleanup?.()); active.forEach(slot => { slot.cleanup = slot.fn(); }); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

test('ordinary reader entry never opens an account store for a nonexistent drawer request', async () => {
  const h = host(); h.render({ document: { canonical: {} }, session: {} }); await Promise.resolve();
  assert.equal(h.starts, 0); assert.equal(h.calls.length, 0);
});
test('one mounted request survives effect replay and late completion after cancel cannot update UI', async () => {
  const h = host(), request = { uid: 'a', generation: 1, workId: 'hamlet', token: 1 }, document = { canonical: { workId: 'hamlet' } }, session = {};
  const props = { request, document, session };
  h.render(props); h.replay(); await Promise.resolve();
  assert.equal(h.starts, 1); assert.equal(h.callback.store, h.store); assert.equal(h.callback.session, session);
  const result = h.render(props); result.cancel();
  h.callback.onError(new Error('late'));
  assert.equal(h.render(props).error, null); assert.equal(h.render(props).opening, false);
  h.unmount(); assert.equal(h.cancellations, 1);
});
test('reader handoff adapter reports an exact-jump failure without fabricating a fallback location', async () => {
  const h = host(), props = { request: { uid: 'a', generation: 1 }, document: { canonical: {} }, session: {} };
  h.render(props); await Promise.resolve();
  h.callback.onError({ code: 'HIGHLIGHT_CHANGED' });
  const result = h.render(props);
  assert.match(result.error, /changed|unavailable/i); assert.equal(result.opening, false);
});
test('account transitions clear pending and failed status immediately and never revive A after B', async () => {
  for (const failed of [false, true]) {
    const h = host(), props = { request: { uid: 'a', generation: 1 }, document: { canonical: {} }, session: {} };
    h.render(props); await Promise.resolve();
    const original = h.callback;
    if (failed) original.onError({ code: 'HIGHLIGHT_CHANGED' });
    assert.equal(!!h.render(props).error, failed);
    h.setOwner({ uid: 'b', generation: 2, ready: true });
    let result = h.render(props);
    assert.equal(result.opening, false); assert.equal(result.error, null);
    h.setOwner({ uid: 'a', generation: 3, ready: true });
    original.onError(new Error('late'));
    result = h.render(props); await Promise.resolve();
    assert.equal(result.opening, false); assert.equal(result.error, null); assert.equal(h.starts, 1);
  }
});
test('intervening reading interaction clears a completed error without restarting its consumed request', async () => {
  const h = host(), props = { request: { uid: 'a', generation: 1 }, document: { canonical: {} }, session: {} };
  h.render(props); await Promise.resolve(); h.callback.onError({ code: 'HIGHLIGHT_CHANGED' });
  const result = h.render(props); assert.ok(result.error); result.cancel();
  assert.equal(h.render(props).error, null); await Promise.resolve(); assert.equal(h.starts, 1);
});
