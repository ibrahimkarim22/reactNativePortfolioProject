const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { createReaderRuntimeScript } = require('../../reader/readerRuntime');
const { parseReaderMessage, buildNavigationScript } = require('../../reader/readerProtocol');

const identity = { documentId: 'nav-doc', workId: 'work', contentVersion: 'v1', canonicalTextVersion: '1' };
const canonical = { ...identity, text: 'one\n\ntwo\n\nthree', sections: [{ id: 'opening', start: 0, end: 5 }, { id: 'act', start: 5, end: 10 }, { id: 'scene', start: 10, end: 15 }] };
const reference = id => ({ kind: 'section', workId: 'work', contentVersion: 'v1', canonicalTextVersion: '1', sectionId: id });
const preferences = { schemaVersion: 1, fontId: 'literata', fontSize: 20, lineSpacing: 'comfortable', theme: 'paper' };

function harness(starts = [24, 400, 900]) {
  const messages = [], frames = [], timers = [], loads = [], listeners = {}, focused = [];
  const ids = ['opening', 'act', 'scene'];
  const window = { innerHeight: 400, innerWidth: 400, scrollY: 0, pageYOffset: 0,
    ReactNativeWebView: { postMessage: raw => messages.push(JSON.parse(raw)) },
    addEventListener: (name, fn) => { (listeners[name] ||= []).push(fn); },
    scrollTo(x, y) { this.scrollY = Math.max(0, Math.min(900, typeof x === 'object' ? x.top : y)); this.pageYOffset = this.scrollY; },
    requestAnimationFrame: fn => { frames.push(fn); return frames.length; }, cancelAnimationFrame() {},
  };
  window.parent = window;
  const blocks = ids.map((id, index) => ({ nodeType: 1, childNodes: [],
    getAttribute: name => ({ 'data-section-id': id, 'data-text-id': 'text-' + id })[name],
    setAttribute() {}, focus: () => focused.push(id),
    getBoundingClientRect: () => ({ top: starts[index] - window.scrollY, bottom: starts[index] + 30 - window.scrollY, left: 24, right: 300 }),
  }));
  const document = { querySelectorAll: () => blocks, querySelector: () => blocks[0],
    documentElement: { scrollHeight: 1300, style: { setProperty(name, value) { if (name === '--reader-font-size') { const scale = Number(value.replace('px', '')) / 20; starts[1] = 400 * scale; starts[2] = 900 * scale; } } } },
    body: { scrollHeight: 1300 }, createTreeWalker: () => ({ nextNode: () => null }),
    fonts: { ready: Promise.resolve(), add() {}, addEventListener() {} }, addEventListener() {},
  };
  class FontFace { load() { return new Promise(resolve => loads.push(() => resolve(this))); } }
  vm.runInNewContext(createReaderRuntimeScript(identity), { window, document, FontFace,
    requestAnimationFrame: window.requestAnimationFrame, cancelAnimationFrame() {},
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {}, console });
  const flush = async () => { for (let i = 0; i < 16; i++) { await Promise.resolve(); const batch = frames.splice(0); for (const fn of batch) fn(); } const batch = timers.splice(0); for (const fn of batch) fn(); await Promise.resolve(); };
  return { window, document, blocks, messages, loads, starts, focused, flush,
    event(name) { for (const fn of listeners[name] || []) fn(); },
    scroll(y) { window.scrollY = y; window.pageYOffset = y; for (const fn of listeners.scroll || []) fn(); },
    jump(id, navigationId = 1, extra = {}) { return window.BardReader.jumpToSection({ ...identity, navigationId, sectionId: id, ...extra }); },
  };
}

test('location follows reading line, heading gaps, reverse scrolling and actual bottom', async () => {
  const h = harness(); await h.flush();
  assert.equal(h.messages.filter(m => m.type === 'location').at(-1)?.sectionId, 'opening');
  h.scroll(300); await h.flush(); assert.equal(h.messages.filter(m => m.type === 'location').at(-1).sectionId, 'opening');
  h.scroll(379); await h.flush(); assert.equal(h.messages.filter(m => m.type === 'location').at(-1).sectionId, 'act');
  h.scroll(375); await h.flush(); assert.equal(h.messages.filter(m => m.type === 'location').at(-1).sectionId, 'act', 'two-pixel hysteresis avoids flicker');
  h.scroll(372); await h.flush(); assert.equal(h.messages.filter(m => m.type === 'location').at(-1).sectionId, 'opening');
  h.scroll(900); await h.flush(); assert.equal(h.messages.filter(m => m.type === 'location').at(-1).sectionId, 'scene');
  const count = h.messages.length; for (let i = 0; i < 100; i++) h.event('scroll'); await h.flush(); assert.equal(h.messages.length, count, 'unchanged scroll events do not flood the bridge');
});

test('a short final section becomes current at bottom without a terminal spacer', async () => {
  const h = harness([24, 400, 1200]); h.scroll(900); await h.flush();
  assert.equal(h.messages.filter(m => m.type === 'location').at(-1)?.sectionId, 'scene');
});

test('jumps retain the mounted document, reject stale/foreign requests and focus only the latest intent', async () => {
  const h = harness(); const runtime = h.window.BardReader;
  assert.equal(typeof runtime.jumpToSection, 'function');
  assert.equal(h.jump('act', 2), true); assert.equal(h.window.scrollY, 376);
  assert.equal(h.jump('scene', 1), false); assert.equal(h.jump('scene', 3, { documentId: 'old' }), false);
  assert.equal(h.jump('missing', 3), false); assert.equal(h.jump('scene', 3, { extra: 'forbidden' }), false);
  assert.equal(h.jump('scene', 4), true); await h.flush();
  assert.equal(h.window.BardReader, runtime); assert.equal(h.window.scrollY, 876);
  assert.equal(h.messages.filter(m => m.type === 'jumped').at(-1).navigationId, 4);
  assert.equal(runtime.focusSection({ ...identity, navigationId: 2, sectionId: 'act' }), false);
  assert.equal(runtime.focusSection({ ...identity, navigationId: 4, sectionId: 'scene' }), true);
  assert.deepEqual(h.focused, ['scene']);
});

test('font acquisition and layout cannot restore over a newer jump; later user scroll wins', async () => {
  const h = harness();
  const apply = h.window.BardReader.applyAppearance({ ...identity, requestId: 1, preferences: { ...preferences, fontSize: 30 }, fontScale: 1,
    fontFaces: [{ weight: 400, style: 'normal', data: 'AAAA' }] });
  await Promise.resolve(); assert.equal(h.loads.length, 1);
  h.jump('act', 1); h.jump('scene', 2); h.loads[0](); await h.flush(); await apply;
  assert.equal(h.window.scrollY, 900, 'new target clamps naturally after reflow');
  h.scroll(500); await h.flush();
  const apply2 = h.window.BardReader.applyAppearance({ ...identity, requestId: 2, preferences, fontScale: 1 });
  await Promise.resolve(); // Input after styling must win over settling callbacks.
  h.scroll(250); await h.flush(); await apply2;
  assert.equal(h.window.scrollY, 250, 'old navigation anchor cannot pull back a newer gesture');
});

test('location and jump messages validate identity, membership, domain IDs and payload bounds', () => {
  const raw = value => JSON.stringify({ ...identity, ...value });
  assert.ok(parseReaderMessage(raw({ type: 'location', sectionId: 'act', locationSeq: 1 }), identity, canonical));
  assert.ok(parseReaderMessage(raw({ type: 'jumped', sectionId: 'act', navigationId: 2 }), identity, canonical));
  for (const extra of [{ sectionId: 'unknown' }, { documentId: 'old' }, { locationSeq: 0 }, { locationSeq: 1.5 }, { requestId: 2 }, { debug: true }]) {
    assert.equal(parseReaderMessage(raw({ type: 'location', sectionId: 'act', locationSeq: 1, ...extra }), identity, canonical), null);
  }
  assert.equal(typeof buildNavigationScript, 'function');
  const script = buildNavigationScript(identity, 1, reference('act'), canonical);
  assert.match(script, /jumpToSection/);
  assert.throws(() => buildNavigationScript(identity, 1, { ...reference('act'), contentVersion: 'old' }, canonical));
  assert.throws(() => buildNavigationScript(identity, 1, reference('missing'), canonical));
  assert.equal(parseReaderMessage(raw({ type: 'location', sectionId: 'act', locationSeq: 1 }), identity, {}), null);
});

test('an accessibility scroll observed before its queued event cancels jump alignment and focus', async () => {
  const h = harness(); h.jump('act', 1);
  h.window.scrollY = 600; h.window.pageYOffset = 600;
  h.event('resize'); await h.flush();
  assert.equal(h.window.scrollY, 600, 'layout callbacks must observe current position before re-aligning');
  assert.equal(h.window.BardReader.focusSection({ ...identity, navigationId: 1, sectionId: 'act' }), false);
});

test('a newly requested jump supersedes an earlier scroll whose event has not arrived', () => {
  const h = harness(); h.window.scrollY = 650; h.window.pageYOffset = 650;
  assert.equal(h.jump('act', 1), true);
  assert.equal(h.window.scrollY, 376);
});

module.exports = { harness, identity, canonical, reference };
