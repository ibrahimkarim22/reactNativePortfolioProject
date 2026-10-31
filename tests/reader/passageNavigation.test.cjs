const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { createSelection } = require('../../shared/contentText');
const protocol = require('../../reader/readerProtocol');
const { createReaderRuntimeScript } = require('../../reader/readerRuntime');
const { parseRoot, textNodes } = require('./selectionDomFixture.cjs');

const identity = { documentId: 'passage-doc', workId: 'work', contentVersion: 'v1', canonicalTextVersion: '1' };
const canonical = { ...identity, text: 'Repeat\n\nRepeat\n\nAB\ud83d\ude00C\n\nDE',
  units: [{ id: 'a', sectionId: 's1', start: 0, textEnd: 6, end: 8 }, { id: 'b', sectionId: 's1', start: 8, textEnd: 14, end: 16 },
    { id: 'c', sectionId: 's2', start: 16, textEnd: 21, end: 23 }, { id: 'd', sectionId: 's2', start: 23, textEnd: 25, end: 25 }],
  sections: [{ id: 's1', start: 0, end: 16 }, { id: 's2', start: 16, end: 25 }] };
const reference = (start = 8, end = 14) => createSelection(canonical, start, end);
const payload = (navigationId = 1, start = 8, end = 14) => ({ ...identity, navigationId, sectionId: createSelection(canonical, start, end).startRef.sectionId, start, end });

function harness() {
  const root = parseRoot('<main><p data-reader-block="true" data-text-id="a" data-section-id="s1" data-start="0" data-text-end="6" data-end="8" data-separator="&#10;&#10;">Repeat</p><p data-reader-block="true" data-text-id="b" data-section-id="s1" data-start="8" data-text-end="14" data-end="16" data-separator="&#10;&#10;">Repeat</p><p data-reader-block="true" data-text-id="c" data-section-id="s2" data-start="16" data-text-end="21" data-end="23" data-separator="&#10;&#10;">A<i>B<b>&#x1f600;</b>C</i></p><p data-reader-block="true" data-text-id="d" data-section-id="s2" data-start="23" data-text-end="25" data-end="25" data-separator="">DE</p></main>');
  const nodes = textNodes(root), blocks = root.childNodes, frames = [], handlers = {}, fontHandlers = {}, messages = [], focused = [];
  let shift = 0, scale = 1, resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const window = { scrollY: 0, pageYOffset: 0, innerHeight: 500, innerWidth: 400,
    scrollTo(x, y) { this.scrollY = Math.max(0, Math.min(2500, y)); this.pageYOffset = this.scrollY; },
    requestAnimationFrame(fn) { frames.push(fn); return frames.length; },
    addEventListener(name, fn) { (handlers[name] ||= []).push(fn); },
    ReactNativeWebView: { postMessage(raw) { messages.push(JSON.parse(raw)); } },
    getSelection: () => ({ rangeCount: 0, isCollapsed: true, removeAllRanges() {} }),
  }; window.parent = window;
  const nodeTop = node => (100 + nodes.indexOf(node) * 180) * scale + shift;
  blocks.forEach((block, i) => {
    block.getBoundingClientRect = () => ({ top: (100 + i * 500) * scale + shift - window.scrollY, bottom: (500 + i * 500) * scale + shift - window.scrollY });
    block.setAttribute = () => {}; block.focus = () => focused.push(i);
  });
  const document = { querySelector: () => root, querySelectorAll: () => blocks, addEventListener() {},
    documentElement: { scrollHeight: 3000, style: { setProperty(name, value) { if (name === '--reader-font-size') scale = Number.parseFloat(value) / 20; } } }, body: { scrollHeight: 3000 },
    fonts: { ready, add() {}, addEventListener(name, fn) { (fontHandlers[name] ||= []).push(fn); } },
    createRange() { return { setStart(node, offset) { this.startContainer = node; this.startOffset = offset; }, setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; },
      getClientRects() { return [{ top: nodeTop(this.startContainer) + this.startOffset * 2 - window.scrollY, width: 10, height: 20 }]; } }; },
  };
  vm.runInNewContext(createReaderRuntimeScript(identity), { window, document, setTimeout, clearTimeout });
  return { root, nodes, window, messages, focused, nodeTop,
    async flush() { for (let i = 0; i < 20; i++) { await Promise.resolve(); frames.splice(0).forEach(fn => fn()); } },
    event(name) { for (const fn of handlers[name] || []) fn(); },
    parentMessage(data, source = window.parent) { for (const fn of handlers.message || []) fn({ source, data }); },
    resolveReady() { resolveReady(); },
    fontEvent(amount) { shift += amount; for (const fn of fontHandlers.loadingdone || []) fn(); },
  };
}

test('passage commands validate the complete canonical reference before sending bounded exact offsets', () => {
  assert.equal(typeof protocol.passageCommandPayload, 'function');
  assert.deepEqual(protocol.passageCommandPayload(identity, 2, reference(), canonical), payload(2));
  assert.match(protocol.buildPassageNavigationScript(identity, 2, reference(), canonical), /jumpToPassage/);
  assert.match(protocol.buildPassageFocusScript(identity, 2, reference(), canonical), /focusPassage/);
  for (const changes of [{ exact: 'other' }, { prefix: '' }, { contentVersion: 'old' }, { workId: 'other' },
    { startRef: { ...reference().startRef, textId: 'a' } }, { start: 9 }, { end: 999 }]) {
    assert.throws(() => protocol.passageCommandPayload(identity, 2, { ...reference(), ...changes }, canonical));
  }
  assert.throws(() => protocol.passageCommandPayload({ ...identity, workId: 'other' }, 2, reference(), canonical));
  assert.throws(() => protocol.passageCommandPayload(identity, 0, reference(), canonical));
});

test('exact passage jumps distinguish repeated text and focus the actual containing block without painting or changing nodes', async () => {
  const h = harness(), before = h.nodes.map(node => [node, node.data]), reader = h.window.BardReader;
  assert.equal(typeof reader.jumpToPassage, 'function');
  assert.equal(reader.jumpToPassage(payload()), true);
  assert.equal(h.window.scrollY, h.nodeTop(h.nodes[1]) - 24, 'second Repeat is used rather than the identical first quote');
  await h.flush();
  assert.equal(h.messages.filter(m => m.type === 'jumped').at(-1).sectionId, 's1');
  assert.equal(reader.focusPassage(payload()), true);
  assert.deepEqual(h.focused, [1]);
  assert.equal(reader.focusSection({ ...identity, navigationId: 1, sectionId: 's1' }), false, 'passage acknowledgements cannot focus the section opening');
  assert.deepEqual(h.nodes.map(node => [node, node.data]), before);
  assert.equal(h.window.BardReader, reader);
});

test('passage geometry crosses source formatting and layout separators without native selection', async () => {
  const h = harness();
  assert.equal(h.window.BardReader.jumpToPassage(payload(1, 17, 24)), true);
  assert.equal(h.window.scrollY, h.nodeTop(h.nodes[3]) - 24);
  await h.flush();
  assert.equal(h.window.BardReader.focusPassage(payload(1, 17, 24)), true);
  assert.deepEqual(h.focused, [2]);
  assert.equal(h.window.BardReader.jumpToPassage(payload(2, 21, 24)), true, 'separator-backed start uses the next actual source glyph');
  assert.equal(h.window.scrollY, h.nodeTop(h.nodes.at(-1)) - 24);
});

test('malformed, stale, foreign, mismatched-section and separator-only passage commands do not move the reader', () => {
  const h = harness(), original = h.window.scrollY;
  for (const changes of [{ documentId: 'old' }, { navigationId: 0 }, { start: -1 }, { end: 999 }, { start: 19 },
    { start: 7, end: 8 }, { sectionId: 's2' }, { extra: true }]) {
    assert.equal(h.window.BardReader.jumpToPassage({ ...payload(), ...changes }), false);
    assert.equal(h.window.scrollY, original);
  }
  assert.equal(h.window.BardReader.jumpToPassage(payload(2)), true);
  const position = h.window.scrollY;
  assert.equal(h.window.BardReader.jumpToPassage(payload(1, 0, 6)), false);
  assert.equal(h.window.BardReader.jumpToSection({ ...identity, navigationId: 1, sectionId: 's2' }), false);
  assert.equal(h.window.scrollY, position);
});

test('appearance and later font reflow preserve passage alignment until a newer section jump or user scroll wins', async () => {
  const h = harness(), reader = h.window.BardReader;
  const apply = reader.applyAppearance({ ...identity, requestId: 1, preferences: { schemaVersion: 1, fontId: 'literata', fontSize: 30, lineSpacing: 'comfortable', theme: 'paper' }, fontScale: 1 });
  assert.equal(reader.jumpToPassage(payload()), true);
  h.resolveReady(); await h.flush(); await apply;
  assert.equal(h.nodeTop(h.nodes[1]) - h.window.scrollY, 24);
  h.fontEvent(50); await h.flush(); assert.equal(h.nodeTop(h.nodes[1]) - h.window.scrollY, 24);
  reader.jumpToSection({ ...identity, navigationId: 2, sectionId: 's2' });
  await h.flush(); assert.equal(reader.focusPassage(payload()), false);
  assert.equal(reader.jumpToPassage(payload(3)), true);
  h.window.scrollY = 77; h.window.pageYOffset = 77;
  h.fontEvent(50); await h.flush();
  assert.equal(h.window.scrollY, 77);
  assert.equal(reader.focusPassage(payload(3)), false);
});

test('web passage messages are accepted only from the owning parent frame', () => {
  const h = harness(), data = { type: 'bard-reader-passage-jump', payload: payload() };
  h.parentMessage(data, {}); assert.equal(h.window.scrollY, 0);
  h.parentMessage(data); assert.equal(h.window.scrollY, h.nodeTop(h.nodes[1]) - 24);
});

test('missing source geometry reports the matching navigation failure without falling back to the scene opening', () => {
  const h = harness();
  h.nodes[1].data = 'Changed';
  assert.equal(h.window.BardReader.jumpToPassage(payload()), false);
  assert.equal(h.window.scrollY, 0);
  const message = h.messages.findLast(value => value.type === 'error');
  assert.equal(message?.navigationId, 1);
  assert.equal(message.code, 'PASSAGE_UNAVAILABLE');
  assert.ok(protocol.parseReaderMessage(JSON.stringify(message), identity, canonical));
  assert.equal(protocol.parseReaderMessage(JSON.stringify({ ...message, navigationId: 0 }), identity, canonical), null);
  assert.equal(protocol.parseReaderMessage(JSON.stringify({ ...message, requestId: 1 }), identity, canonical), null);
  assert.equal(protocol.parseReaderMessage(JSON.stringify({ ...message, documentId: 'old' }), identity, canonical), null);
  assert.equal(h.window.BardReader.focusPassage(payload()), false);
});
