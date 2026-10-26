const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const identity = { documentId: 'selection-runtime', workId: 'work', contentVersion: 'v1', canonicalTextVersion: '1' };
function harness() {
  const file = require.resolve('../../reader/readerRuntime');
  const modulePath = file.replace('readerRuntime.js', 'readerSelectionRuntime.js');
  const source = fs.existsSync(modulePath) ? require(modulePath).SELECTION_RUNTIME_SOURCE : null;
  assert.equal(typeof source, 'string', 'selection runtime must exist as application-owned source');
  const messages = [], handlers = {}, frames = [];
  const nodes = [{}, {}];
  let range = null, copied = 0, invalidMapping = false;
  const document = { addEventListener(name, fn) { handlers[name] = fn; }, fonts: { addEventListener() {} } };
  const window = { innerWidth: 400, innerHeight: 800,
    getSelection: () => range ? { rangeCount: 1, isCollapsed: false, getRangeAt: () => range,
      removeAllRanges: () => { range = null; }, toString: () => { throw Error('selected string is not an authority'); } }
      : { rangeCount: 0, isCollapsed: true, removeAllRanges() {} },
    requestAnimationFrame: fn => { frames.push(fn); return frames.length; },
    addEventListener(name, fn) { handlers[name] = fn; },
  };
  const install = vm.runInNewContext('(' + source + ')', { window, document, Number, Object, JSON });
  const api = install({ identity, root: {}, send: (type, values) => messages.push({ ...identity, type, ...JSON.parse(JSON.stringify(values)) }) }, () => ({
    read(selection) { if (invalidMapping) throw Object.assign(new Error('mapping changed'), { code: 'INVALID_MAPPING' }); const r = selection.getRangeAt(0); copied++; return { kind: 'text-range', start: r.startOffset, end: r.endOffset, exact: r.startContainer === nodes[0] ? 'first' : 'second' }; },
  }));
  return { api, messages, handlers, window, set(which = 0, start = 0, end = 5) { range = { startContainer: nodes[which], startOffset: start, endContainer: nodes[which], endOffset: end, collapsed: false }; },
    cancel() { range = null; }, invalidateMapping() { invalidMapping = true; }, flush() { for (const fn of frames.splice(0)) fn(); }, copied: () => copied,
    capture(id, token = 'capture-' + id, extra = {}) { return api.captureSelection({ ...identity, selectionRequestId: id, captureToken: token, ...extra }); } };
}

test('capture synchronously reads a new live range before its queued selectionchange', () => {
  const h = harness(); h.set(); h.handlers.selectionchange(); h.flush();
  h.set(1); h.handlers.selectionchange();
  assert.equal(h.capture(1), true);
  assert.equal(h.messages.at(-1).selection.exact, 'second');
  const revision = h.messages.at(-1).selectionSeq;
  h.flush();
  assert.equal(h.messages.at(-1).selectionSeq, revision, 'queued unchanged notification cannot replace the capture');
});

test('capture tokens and request ordering reject older commands without reusing a quotation', () => {
  const h = harness(); h.set(); h.capture(2);
  assert.equal(h.capture(1), false);
  assert.equal(h.capture(3, 'bad token space'), false);
  assert.equal(h.capture(3, 'valid', { documentId: 'old' }), false);
  assert.equal(h.capture(3, 'valid', { extra: true }), false);
  assert.equal(h.capture(3, 'token"</script>'), true, 'bounded printable tokens remain data across the typed bridge');
  h.cancel(); h.capture(4);
  assert.equal(h.messages.at(-1).status, 'rejected');
  assert.equal(h.messages.at(-1).code, 'NO_SELECTION');
});

test('clear and actual layout/font invalidation remove live selection without scrolling', () => {
  const h = harness(); h.set(); h.capture(1); const before = h.messages.at(-1).selectionSeq;
  assert.equal(h.api.clearSelection({ ...identity, selectionRequestId: 2, reason: 'contents' }), true);
  h.capture(3); assert.equal(h.messages.at(-1).status, 'rejected');
  assert.ok(h.messages.at(-1).selectionSeq > before);
  h.set(1); h.api.invalidate('font'); h.capture(4);
  assert.equal(h.messages.at(-1).code, 'NO_SELECTION');
  h.set(0); h.window.innerWidth = 320; h.handlers.resize(); h.capture(5);
  assert.equal(h.messages.at(-1).code, 'NO_SELECTION');
  assert.equal(h.api.clearSelection({ ...identity, selectionRequestId: 1, reason: 'cancel' }), false);
});

test('provisional changes carry no quotation; unchanged notifications coalesce', () => {
  const h = harness(); h.set(); for (let i = 0; i < 30; i++) h.handlers.selectionchange(); h.flush();
  assert.equal(h.messages.length, 1); assert.equal(h.messages[0].type, 'selectionChange');
  assert.equal(h.messages[0].state, 'range'); assert.equal('selection' in h.messages[0], false);
  h.cancel(); h.handlers.selectionchange(); h.flush();
  assert.equal(h.messages.at(-1).state, 'none');
});

test('a changed mapping invalidates provisional state even when DOM endpoints are identical', () => {
  const h = harness(); h.set(); h.handlers.selectionchange(); h.flush();
  h.invalidateMapping(); h.handlers.selectionchange(); h.flush();
  assert.equal(h.messages.at(-1).state, 'invalid');
  assert.equal(h.messages.at(-1).code, 'INVALID_MAPPING');
});

test('actual composed reader clears selection when a superseded font load registers faces', async () => {
  const { createReaderRuntimeScript } = require('../../reader/readerRuntime');
  let selected = true, removed = 0;
  const frames = [], loads = [], messages = [];
  const document = { querySelectorAll: () => [], querySelector: () => null, addEventListener() {},
    documentElement: { style: { setProperty() {} }, scrollHeight: 800 }, body: { scrollHeight: 800 },
    fonts: { ready: Promise.resolve(), add() {}, addEventListener() {} } };
  const window = { innerWidth: 400, innerHeight: 800, scrollY: 0, pageYOffset: 0,
    getSelection: () => ({ rangeCount: selected ? 1 : 0, isCollapsed: !selected, removeAllRanges() { selected = false; removed++; } }),
    ReactNativeWebView: { postMessage: raw => messages.push(JSON.parse(raw)) }, addEventListener() {},
    requestAnimationFrame: fn => { frames.push(fn); return frames.length; } };
  class FontFace { load() { return new Promise(resolve => loads.push(() => resolve(this))); } }
  vm.runInNewContext(createReaderRuntimeScript(identity), { document, window, FontFace, setTimeout, clearTimeout });
  assert.equal(typeof window.BardReader.captureSelection, 'function', 'the real emitted document exposes typed capture');
  const preferences = { schemaVersion: 1, fontId: 'source-serif-4', fontSize: 20, lineSpacing: 'comfortable', theme: 'paper' };
  const first = window.BardReader.applyAppearance({ ...identity, requestId: 1, preferences, fontScale: 1, fontFaces: [{ weight: 400, style: 'normal', data: 'AAAA' }] });
  const second = window.BardReader.applyAppearance({ ...identity, requestId: 2, preferences: { ...preferences, fontId: 'literata' }, fontScale: 1 });
  for (let i = 0; i < 8; i++) { await Promise.resolve(); frames.splice(0).forEach(fn => fn()); }
  await second;
  selected = true; const before = removed;
  loads[0](); await first;
  assert.ok(removed > before, 'even an obsolete load can register fonts and must invalidate the newer live range');
  assert.equal(selected, false);
  assert.equal(messages.at(-1).type, 'selectionChange');
});
