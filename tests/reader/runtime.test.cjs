const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const identity = { documentId: 'doc-1', workId: 'work', contentVersion: 'v1', canonicalTextVersion: '1' };
const preferences = { schemaVersion: 1, fontId: 'literata', fontSize: 20, lineSpacing: 'comfortable', theme: 'paper' };

function harness(options = {}) {
  const styles = {};
  const messages = [];
  const loads = [];
  const handlers = {};
  const frames = [];
  const registeredFaces = [];
  let top = 100;
  const block = { nodeType: 1, dataset: { textId: 'b1', sectionId: 's1' }, getAttribute: name => ({ 'data-text-id': 'b1', 'data-section-id': 's1' })[name], matches: selector => selector === '[data-reader-block]', closest: () => block, getBoundingClientRect: () => ({ top: top - window.scrollY, bottom: top + 100 - window.scrollY, left: 24, right: 600 }) };
  const text = { nodeType: 3, textContent: options.inlineBoundary ? 'SOM' : 'SOME TEXT', parentElement: block, parentNode: block };
  block.childNodes = [text, ...(options.inlineBoundary ? [{ nodeType: 3, textContent: 'E TEXT', parentElement: block, parentNode: block }] : [])];
  const makeRange = () => ({ startContainer: text, startOffset: 3, setStart(node, offset) { this.startContainer = node; this.startOffset = offset; }, setEnd() {}, collapse() {}, getBoundingClientRect() { return options.inlineBoundary && this.startContainer === text && this.startOffset === 3 ? { top: 0, bottom: 0, left: 0, right: 0 } : { top: top - window.scrollY, bottom: top + 32 - window.scrollY, left: 24, right: 200 }; }, getClientRects: () => [{ top: top - window.scrollY, bottom: top + 32 - window.scrollY }], toString: () => 'SOM' });
  const root = { style: { setProperty(name, value) { styles[name] = value; if (name === '--reader-font-size') top = Number.parseFloat(value) * 5; } }, scrollHeight: 1000, clientWidth: 400 };
  const document = { documentElement: root, body: { scrollHeight: 1000 }, fonts: { ready: Promise.resolve(), add(face) { registeredFaces.push(face); }, load: () => Promise.resolve([]) }, querySelectorAll: () => [block], querySelector: () => block, createTreeWalker: () => { let index = 0; return { nextNode() { return block.childNodes[index++] || null; } }; }, createRange: makeRange, caretRangeFromPoint: makeRange, addEventListener(type, handler) { handlers[type] = handler; } };
  const window = { document, innerWidth: 400, innerHeight: 800, scrollY: 0, pageYOffset: 0, ReactNativeWebView: { postMessage: raw => messages.push(JSON.parse(raw)) }, requestAnimationFrame: callback => { if (options.deferFrames) frames.push(callback); else callback(); return 1; }, addEventListener(type, handler) { handlers[type] = handler; }, scrollTo(x, y) { this.scrollY = typeof x === 'object' ? x.top : y; this.pageYOffset = this.scrollY; } };
  window.parent = window;
  class FontFace { constructor(family, source, options) { this.family = family; this.source = source; this.options = options; } load() { return new Promise((resolve, reject) => loads.push({ face: this, resolve: () => resolve(this), reject })); } }
  const { createReaderRuntimeScript } = options.runtimeModule || require('../../reader/readerRuntime');
  const originalToString = Function.prototype.toString;
  let script;
  try {
    if (options.bytecodeFunctions) Function.prototype.toString = () => 'function () { [bytecode] }';
    script = createReaderRuntimeScript(identity);
  } finally { Function.prototype.toString = originalToString; }
  vm.runInNewContext(script, { window, document, FontFace, requestAnimationFrame: window.requestAnimationFrame, NodeFilter: { SHOW_TEXT: 4 }, setTimeout, clearTimeout, console });
  return { window, document, styles, messages, loads, registeredFaces, handlers, frames, async flush() { for (let i = 0; i < 8; i += 1) await Promise.resolve(); } };
}

test('runtime scopes appearance to identity, preserves the visible text point and applies font scale once', async () => {
  const h = harness();
  assert.equal(h.messages[0].type, 'ready');
  assert.equal(h.messages[0].documentId, 'doc-1');
  await h.window.BardReader.applyAppearance({ ...identity, requestId: 1, preferences: { ...preferences, fontSize: 30, theme: 'night' }, fontScale: 1.2 });
  await h.flush();
  assert.equal(h.styles['--reader-font-size'], '30px');
  assert.equal(h.styles['--reader-font-scale'], '1.2');
  assert.equal(h.styles['--reader-background'], '#181C1A');
  assert.equal(h.window.scrollY, 50, 'same text point retains its original viewport top after reflow');
  const applied = h.messages.find(message => message.type === 'applied');
  assert.equal(applied.requestId, 1);
  assert.equal(applied.workId, 'work');
  await h.window.BardReader.applyAppearance({ ...identity, documentId: 'old', requestId: 2, preferences, fontScale: 1 });
  assert.equal(h.styles['--reader-font-size'], '30px');
});

test('a stale local font load cannot override a newer appearance or restore an older position', async () => {
  const h = harness();
  const first = h.window.BardReader.applyAppearance({ ...identity, requestId: 1, preferences: { ...preferences, fontSize: 24 }, fontScale: 1, fontFaces: [{ weight: 400, style: 'normal', data: 'AA==' }] });
  const second = h.window.BardReader.applyAppearance({ ...identity, requestId: 2, preferences: { ...preferences, fontId: 'source-serif-4', fontSize: 30 }, fontScale: 1, fontFaces: [{ weight: 400, style: 'normal', data: 'AA==' }] });
  h.loads[1].resolve();
  await second;
  await h.flush();
  h.loads[0].resolve();
  await first;
  await h.flush();
  assert.equal(h.styles['--reader-font-size'], '30px');
  assert.equal(h.window.scrollY, 50);
  assert.deepEqual(h.messages.filter(message => message.type === 'applied').map(message => message.requestId), [2]);
});

test('runtime validates web parent messages and rejects malformed or regressive appearance requests', async () => {
  const h = harness();
  h.window.parent = {};
  h.handlers.message({ source: {}, data: { type: 'bard-reader-appearance', payload: { ...identity, requestId: 4, preferences, fontScale: 1 } } });
  await h.flush();
  assert.equal(h.messages.filter(message => message.type === 'applied').length, 0);
  await h.window.BardReader.applyAppearance({ ...identity, requestId: 1, preferences: { ...preferences, fontId: 'https://evil.test' }, fontScale: 1 });
  await h.flush();
  assert.equal(h.styles['--reader-font-size'], undefined);
  await h.window.BardReader.applyAppearance({ ...identity, requestId: 3, preferences, fontScale: 1 });
  await h.window.BardReader.applyAppearance({ ...identity, requestId: 2, preferences: { ...preferences, fontSize: 30 }, fontScale: 1 });
  assert.equal(h.styles['--reader-font-size'], '20px');
});

test('a newer typography request keeps the original text point while an older layout is settling', async () => {
  const h = harness({ deferFrames: true });
  const first = h.window.BardReader.applyAppearance({ ...identity, requestId: 1, preferences: { ...preferences, fontSize: 24 }, fontScale: 1 });
  await h.flush();
  const second = h.window.BardReader.applyAppearance({ ...identity, requestId: 2, preferences: { ...preferences, fontSize: 30 }, fontScale: 1 });
  await h.flush();
  while (h.frames.length) { h.frames.splice(0).forEach(frame => frame()); await h.flush(); }
  await Promise.all([first, second]);
  assert.equal(h.window.scrollY, 50, 'both in-flight requests must use the text point from before the first reflow');
  assert.deepEqual(h.messages.filter(message => message.type === 'applied').map(message => message.requestId), [2]);
});

test('font failure reports a bounded scoped error and allows a later successful request', async () => {
  const h = harness();
  const first = h.window.BardReader.applyAppearance({ ...identity, requestId: 1, preferences, fontScale: 1, fontFaces: [{ weight: 400, style: 'normal', data: 'AA==' }] });
  h.loads[0].reject(new Error('font failure with private data'));
  await first;
  const error = h.messages.find(message => message.type === 'error');
  assert.equal(error.documentId, 'doc-1');
  assert.equal(error.requestId, 1);
  assert.equal(error.code, 'FONT_LOAD_FAILED');
  assert.equal(JSON.stringify(error).includes('private data'), false);
  await h.window.BardReader.applyAppearance({ ...identity, requestId: 2, preferences: { ...preferences, theme: 'sepia' }, fontScale: 1 });
  assert.equal(h.styles['--reader-background'], '#EDE1CC');
  assert.equal(h.messages.at(-1).type, 'applied');
});

test('when caret APIs are unavailable the visible source block is the restoration fallback', async () => {
  const h = harness();
  delete h.document.caretRangeFromPoint;
  await h.window.BardReader.applyAppearance({ ...identity, requestId: 1, preferences: { ...preferences, fontSize: 30 }, fontScale: 1 });
  assert.equal(h.window.scrollY, 50);
});

test('a text point exactly at an inline-node boundary uses a visible character range', async () => {
  const h = harness({ inlineBoundary: true });
  await h.window.BardReader.applyAppearance({ ...identity, requestId: 1, preferences: { ...preferences, fontSize: 30 }, fontScale: 1 });
  assert.equal(h.window.scrollY, 50, 'a collapsed end-of-span rect must not replace the content point with viewport zero');
});

test('the runtime boots when the host exposes bytecode instead of function source', async () => {
  const h = harness({ bytecodeFunctions: true });
  assert.equal(h.messages[0].type, 'ready');
  await h.window.BardReader.applyAppearance({ ...identity, requestId: 1, preferences, fontScale: 1 });
  assert.equal(h.messages.at(-1).type, 'applied');
});

test('Babel compilation of the actual generator cannot introduce missing helpers into the document runtime', async () => {
  const runtimePath = path.resolve(__dirname, '../../reader/readerRuntime.js');
  const compiled = require('@babel/core').transformSync(fs.readFileSync(runtimePath, 'utf8'), { filename: runtimePath, configFile: false, babelrc: false, plugins: [require.resolve('@babel/plugin-transform-async-to-generator')] }).code;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, require: createRequire(runtimePath) });
  const h = harness({ runtimeModule: module.exports });
  await h.window.BardReader.applyAppearance({ ...identity, requestId: 1, preferences, fontScale: 1 });
  assert.equal(h.messages.at(-1).type, 'applied');
});

test('a curated font shares one pending load and one face registration across appearance changes', async () => {
  const h = harness();
  const fontFaces = [{ weight: 400, style: 'normal', data: 'AA==' }, { weight: 700, style: 'normal', data: 'AA==' }, { weight: 400, style: 'italic', data: 'AA==' }, { weight: 700, style: 'italic', data: 'AA==' }];
  const first = h.window.BardReader.applyAppearance({ ...identity, requestId: 1, preferences, fontScale: 1, fontFaces });
  const second = h.window.BardReader.applyAppearance({ ...identity, requestId: 2, preferences: { ...preferences, theme: 'night' }, fontScale: 1, fontFaces });
  assert.equal(h.loads.length, 4, 'same-font requests share the four original loading promises');
  h.loads.forEach(load => load.resolve());
  await Promise.all([first, second]);
  assert.equal(h.registeredFaces.length, 4);
  const family = h.styles['--reader-font-family'];
  await h.window.BardReader.applyAppearance({ ...identity, requestId: 3, preferences: { ...preferences, fontSize: 24 }, fontScale: 1.2, fontFaces });
  await h.window.BardReader.applyAppearance({ ...identity, requestId: 4, preferences: { ...preferences, lineSpacing: 'spacious', theme: 'sepia' }, fontScale: 1.2 });
  assert.equal(h.loads.length, 4, 'loaded faces are reused after size/spacing/theme changes');
  assert.equal(h.registeredFaces.length, 4, 'font registrations are bounded to the curated faces');
  assert.equal(h.styles['--reader-font-family'], family, 'a cached family is reused even when faces are omitted');
  assert.deepEqual(h.messages.filter(message => message.type === 'applied').map(message => message.requestId), [2, 3, 4]);
});

test('scrolling while a font loads preserves the newer reading point through reflow', async () => {
  const h = harness();
  const applying = h.window.BardReader.applyAppearance({ ...identity, requestId: 1, preferences: { ...preferences, fontSize: 30 }, fontScale: 1, fontFaces: [{ weight: 400, style: 'normal', data: 'AA==' }] });
  h.window.scrollTo(0, 600);
  // A native accessibility scroll may have no pointer or touch event. Also cover
  // a queued browser scroll event that has not run when the font resolves.
  h.loads[0].resolve();
  await applying;
  assert.equal(h.window.scrollY, 650, 'the newly chosen reading point moves only by the 50px text reflow');
  assert.equal(h.messages.at(-1).type, 'applied');
});

test('a failed font load cannot restore a point from before the user scrolled', async () => {
  const h = harness();
  const applying = h.window.BardReader.applyAppearance({ ...identity, requestId: 1, preferences, fontScale: 1, fontFaces: [{ weight: 400, style: 'normal', data: 'AA==' }] });
  h.window.scrollTo(0, 600);
  h.loads[0].reject(new Error('font unavailable'));
  await applying;
  assert.equal(h.window.scrollY, 600, 'a failed appearance leaves the user at their newer position');
  assert.equal(h.messages.at(-1).type, 'error');
});

test('scrolling while layout settles takes precedence over its pending position restore', async () => {
  const h = harness({ deferFrames: true });
  const applying = h.window.BardReader.applyAppearance({ ...identity, requestId: 1, preferences: { ...preferences, fontSize: 30 }, fontScale: 1 });
  await h.flush();
  h.window.scrollTo(0, 600);
  while (h.frames.length) { h.frames.splice(0).forEach(frame => frame()); await h.flush(); }
  await applying;
  assert.equal(h.window.scrollY, 600, 'layout completion must not override a subsequent native scroll');
});

test('newer settings after a user scroll share the new point rather than an older pending point', async () => {
  const h = harness();
  const first = h.window.BardReader.applyAppearance({ ...identity, requestId: 1, preferences: { ...preferences, fontSize: 24 }, fontScale: 1, fontFaces: [{ weight: 400, style: 'normal', data: 'AA==' }] });
  h.window.scrollTo(0, 600);
  const second = h.window.BardReader.applyAppearance({ ...identity, requestId: 2, preferences: { ...preferences, fontId: 'source-serif-4', fontSize: 30 }, fontScale: 1, fontFaces: [{ weight: 400, style: 'normal', data: 'AA==' }] });
  h.loads[1].resolve();
  await second;
  h.loads[0].resolve();
  await first;
  assert.equal(h.window.scrollY, 650);
  assert.deepEqual(h.messages.filter(message => message.type === 'applied').map(message => message.requestId), [2]);
});

test('touching the reading document while layout settles cancels restoration even before scrolling starts', async () => {
  const h = harness({ deferFrames: true });
  const applying = h.window.BardReader.applyAppearance({ ...identity, requestId: 1, preferences: { ...preferences, fontSize: 30 }, fontScale: 1 });
  await h.flush();
  h.handlers.touchstart?.({});
  while (h.frames.length) { h.frames.splice(0).forEach(frame => frame()); await h.flush(); }
  await applying;
  assert.equal(h.window.scrollY, 0, 'the start of a native gesture supersedes delayed scroll restoration');
});
