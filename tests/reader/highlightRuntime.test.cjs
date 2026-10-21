const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const { factory, textNodes, selection, plain, parseRoot, walk } = require('./selectionDomFixture.cjs');
const identity = { documentId: 'paint', workId: 'work', contentVersion: 'v1', canonicalTextVersion: '1' };
function fixture() {
  const root = parseRoot('<main><p data-reader-block="true" data-text-id="a" data-section-id="s" data-start="0" data-text-end="5" data-end="7" data-separator="&#10;&#10;">A<i>B<b>😀</b>C</i></p><p data-reader-block="true" data-text-id="b" data-section-id="s" data-start="7" data-text-end="9" data-end="9" data-separator="">DE</p></main>');
  return { root };
}
function createRange() { return { setStart(node, offset) { this.startContainer = node; this.startOffset = offset; }, setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; } }; }
function harness(supported = true, external = {}) {
  const file = require('node:path').resolve(__dirname, '../../reader/readerHighlightRuntime.js');
  const source = fs.existsSync(file) ? require(file).HIGHLIGHT_RUNTIME_SOURCE : undefined;
  assert.equal(typeof source, 'string', 'fixed highlight runtime exists');
  const root = external.root || fixture().root, documentIdentity = external.identity || identity;
  const messages = [], registry = new Map([['foreign', 'keep']]), calls = [];
  const window = { scrollY: 100, innerHeight: 500, scrollTo(x, y) { this.scrollY = y; calls.push('scroll'); } };
  const document = { createRange() { const range = createRange(); range.getClientRects = () => [{ top: 324 - window.scrollY, width: 10, height: 20 }]; return range; } };
  class Highlight { constructor(...ranges) { this.ranges = ranges; } add(range) { this.ranges.push(range); } }
  const install = vm.runInNewContext(source + '\ninstallHighlights;', { window, document, CSS: supported ? { highlights: registry } : {}, Highlight: supported ? Highlight : undefined });
  const runtime = install({ identity: documentIdentity, root, send(type, values) { messages.push({ ...documentIdentity, type, ...values }); }, observeScroll() { calls.push('observe'); }, newIntent() { calls.push('intent'); }, markOwnScroll() { calls.push('mark'); }, refreshLocation() { calls.push('location'); } }, factory(), {});
  const payload = (phase, extra = {}, ownerGeneration = 1, revision = 1) => ({ ...documentIdentity, ownerGeneration, revision, phase, ...extra });
  const begin = (count = 1, chunks = 1, owner = 1, revision = 1) => runtime.update(payload('begin', { count, chunks }, owner, revision));
  const chunk = (items = [{ id: 'one', start: 1, end: 8, colorId: 'yellow' }], owner = 1, revision = 1) => runtime.update(payload('chunk', { index: 0, items }, owner, revision));
  const commit = (owner = 1, revision = 1) => runtime.update(payload('commit', {}, owner, revision));
  return { root, runtime, messages, registry, window, calls, payload, begin, chunk, commit };
}
test('paint commit is atomic and preserves original nodes, formatting, selection and unrelated registry names', () => {
  const h = harness(), nodes = textNodes(h.root), data = nodes.map(n => n.data), adapter = factory()(h.root, identity);
  const before = plain(adapter.read(selection(h.root, 0, h.root, 2)));
  assert.equal(h.begin(), true); assert.equal(h.chunk(), true); assert.equal(h.registry.size, 1);
  assert.equal(h.commit(), true); assert.equal(h.registry.get('bard-highlight-yellow').ranges.length, 4);
  assert.equal(h.messages.at(-1).status, 'applied'); assert.equal(h.registry.get('foreign'), 'keep');
  assert.deepEqual(textNodes(h.root), nodes); assert.deepEqual(nodes.map(n => n.data), data); assert.deepEqual(plain(adapter.read(selection(h.root, 0, h.root, 2))), before);
  assert.equal(h.begin(0, 0, 1, 2), true); assert.equal(h.commit(1, 2), true);
  assert.equal(h.registry.has('bard-highlight-yellow'), false); assert.equal(h.registry.get('foreign'), 'keep');
});
test('stale ownership/revision, malformed chunks and partial transactions cannot paint', () => {
  const h = harness(); h.begin(); h.chunk(); h.commit();
  const original = h.registry.get('bard-highlight-yellow');
  assert.equal(h.begin(), false); assert.equal(h.begin(0, 0, 0, 2), false);
  assert.equal(h.begin(1, 1, 1, 2), true); assert.equal(h.commit(1, 2), false); assert.equal(h.registry.get('bard-highlight-yellow'), original);
  assert.equal(h.begin(1, 1, 2, 1), true);
  assert.equal(h.chunk(undefined, 1, 3), false); assert.equal(h.registry.has('bard-highlight-yellow'), false, 'new owner immediately conceals old paint');
  assert.equal(h.chunk([{ id: 'one', start: 5, end: 7, colorId: 'yellow' }], 2, 1), false); assert.equal(h.commit(2, 1), false);
  assert.equal(h.runtime.update({ ...h.payload('begin', { count: 0, chunks: 0 }, 2, 2), extra: true }), false);
  assert.equal(h.runtime.update({ ...h.payload('begin', { count: 0, chunks: 0 }, 2, 2), documentId: 'old' }), false);
});
test('unsupported CSS painting reports unavailable without replacing source or touching foreign highlights', () => {
  const h = harness(false); h.begin(); h.chunk(); assert.equal(h.commit(), false);
  assert.equal(h.messages.at(-1).status, 'unsupported'); assert.equal(h.registry.size, 1);
});
test('Show passage aligns the first actual glyph and cancels restoration without creating native selection', () => {
  const h = harness(); h.begin(); h.chunk(); h.commit();
  const command = { ...identity, ownerGeneration: 1, revision: 1, showId: 1, id: 'one', start: 1, end: 8 };
  assert.equal(h.runtime.show(command), true); assert.equal(h.window.scrollY, 300);
  assert.deepEqual(h.calls, ['observe', 'intent', 'scroll', 'mark', 'location']); assert.equal(h.messages.at(-1).type, 'highlightShown');
  assert.equal(h.runtime.show(command), false); assert.equal(h.runtime.show({ ...command, showId: 2, start: 0 }), false);
});
test('a new paint revision retires older Show passage commands before its chunks arrive', () => {
  const h = harness(); h.begin(); h.chunk(); h.commit(); h.begin(1, 1, 1, 2);
  assert.equal(h.runtime.show({ ...identity, ownerGeneration: 1, revision: 1, showId: 1, id: 'one', start: 1, end: 8 }), false);
  assert.equal(h.window.scrollY, 100);
});

test('paint rejects duplicate IDs, reordered chunks, unknown item fields, oversized messages and range mutations', () => {
  for (const items of [[{ id: 'one', start: 1, end: 8, colorId: 'yellow', exact: 'copy' }], [{ id: 'one', start: 3, end: 8, colorId: 'yellow' }], [{ id: 'one', start: 1, end: 20, colorId: 'yellow' }], [{ id: 'one', start: 1, end: 8, colorId: 'red' }]]) {
    const h = harness(); h.begin(); assert.equal(h.chunk(items), false); assert.equal(h.commit(), false); assert.equal(h.registry.size, 1);
  }
  const h = harness(); h.begin(2, 1);
  const item = { id: 'one', start: 1, end: 8, colorId: 'yellow' };
  assert.equal(h.chunk([item, item]), false);
  h.begin(1, 1, 1, 2);
  assert.equal(h.runtime.update(h.payload('chunk', { index: 1, items: [item] }, 1, 2)), false);
  h.begin(1, 1, 1, 3); assert.equal(h.chunk([item], 1, 3), true);
  textNodes(h.root)[0].data = 'X';
  assert.equal(h.commit(1, 3), false); assert.equal(h.registry.size, 1);
  const giant = harness(); giant.begin();
  assert.equal(giant.chunk([{ ...item, id: 'x'.repeat(8192) }]), false); assert.equal(giant.commit(), false);
});
module.exports = { harness };

function composedHarness() {
  const { createReaderRuntimeScript } = require('../../reader/readerRuntime');
  const { root } = fixture(), blocks = root.childNodes, nodes = textNodes(root), frames = [], loads = [], handlers = {}, fontHandlers = {}, messages = [];
  let scale = 1, fontShift = 0, resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const window = { scrollY: 0, pageYOffset: 0, innerWidth: 400, innerHeight: 500,
    scrollTo(x, y) { this.scrollY = Math.max(0, Math.min(2500, y)); this.pageYOffset = this.scrollY; },
    requestAnimationFrame(fn) { frames.push(fn); return frames.length; },
    addEventListener(name, fn) { (handlers[name] ||= []).push(fn); },
    ReactNativeWebView: { postMessage(raw) { messages.push(JSON.parse(raw)); } },
    getSelection: () => ({ rangeCount: 0, isCollapsed: true, removeAllRanges() {} }),
  }; window.parent = window;
  const glyphTop = () => 350 * scale + fontShift;
  blocks.forEach((block, i) => { block.getBoundingClientRect = () => ({ top: (i ? 900 : 100) * scale - window.scrollY, bottom: (i ? 1400 : 800) * scale - window.scrollY, width: 300, height: 700 }); });
  const document = { querySelector: () => root, querySelectorAll: () => blocks, addEventListener() {},
    documentElement: { scrollHeight: 3000, style: { setProperty(name, value) { if (name === '--reader-font-size') scale = Number.parseFloat(value) / 20; } } }, body: { scrollHeight: 3000 },
    fonts: { ready, add() { fontShift += 50; }, addEventListener(name, fn) { (fontHandlers[name] ||= []).push(fn); } },
    createRange() { const range = createRange(); range.getClientRects = () => [{ top: (range.startContainer === nodes[1] ? glyphTop() : 100 * scale) - window.scrollY, width: 10, height: 20 }]; return range; },
  };
  class Highlight { constructor() { this.ranges = []; } add(range) { this.ranges.push(range); } }
  class FontFace { load() { return new Promise(resolve => loads.push(() => resolve(this))); } }
  vm.runInNewContext(createReaderRuntimeScript(identity), { window, document, CSS: { highlights: new Map() }, Highlight, FontFace, setTimeout, clearTimeout });
  const item = { id: 'one', start: 1, end: 8, colorId: 'yellow' };
  for (const payload of require('../../reader/readerHighlightProtocol').highlightUpdatePayloads(identity, 1, 1, [item], { ...identity, text: 'AB😀C\n\nDE', units: [{ start: 0, textEnd: 5 }, { start: 7, textEnd: 9 }] })) window.BardReader.updateHighlights(payload);
  function show(showId = 1) { return window.BardReader.showHighlight({ ...identity, ownerGeneration: 1, revision: 1, showId, id: 'one', start: 1, end: 8 }); }
  function appearance(fontFaces) { return window.BardReader.applyAppearance({ ...identity, requestId: 1, preferences: { schemaVersion: 1, fontId: 'literata', fontSize: 30, lineSpacing: 'comfortable', theme: 'paper' }, fontScale: 1, ...(fontFaces ? { fontFaces } : {}) }); }
  async function flush() { for (let i = 0; i < 20; i++) { await Promise.resolve(); frames.splice(0).forEach(fn => fn()); } }
  function event(name) { for (const fn of handlers[name] || []) fn(); }
  return { window, root, document, nodes, messages, loads, show, appearance, flush, event, glyphTop,
    resolveReady(shift = 0) { fontShift += shift; resolveReady(); },
    fontEvent(shift = 0) { fontShift += shift; for (const fn of fontHandlers.loadingdone || []) fn(); },
  };
}
test('composed Show passage remains at the 24px reading line after an older font load and appearance settle', async () => {
  const h = composedHarness(), before = textNodes(h.root).map(node => [node, node.data]);
  const appearance = h.appearance([{ weight: 400, style: 'normal', data: 'AAAA' }]);
  assert.equal(h.show(), true); assert.equal(h.glyphTop() - h.window.scrollY, 24);
  h.loads[0](); h.resolveReady(); await h.flush(); await appearance;
  assert.equal(h.glyphTop() - h.window.scrollY, 24);
  assert.deepEqual(textNodes(h.root).map(node => [node, node.data]), before);
});
test('composed Show passage survives pending font-ready layout and later font reflow', async () => {
  const h = composedHarness(), appearance = h.appearance(); await h.flush();
  assert.equal(h.show(), true); assert.equal(h.glyphTop() - h.window.scrollY, 24);
  h.resolveReady(60); await h.flush(); await appearance;
  assert.equal(h.glyphTop() - h.window.scrollY, 24);
  h.fontEvent(35); await h.flush(); assert.equal(h.glyphTop() - h.window.scrollY, 24);
});
test('composed later user scrolling and scene jumps supersede Show passage restoration', async () => {
  for (const action of ['scroll', 'jump']) {
    const h = composedHarness(), appearance = h.appearance(); await h.flush(); h.show();
    if (action === 'scroll') { h.window.scrollTo(0, 77); h.event('scroll'); }
    else h.window.BardReader.jumpToSection({ ...identity, navigationId: 1, sectionId: 's' });
    const expected = h.window.scrollY;
    h.resolveReady(60); await h.flush(); await appearance;
    assert.equal(h.window.scrollY, expected, action);
    h.fontEvent(35); await h.flush(); assert.equal(h.window.scrollY, expected, action);
  }
});

const path = require('node:path');
const { createReaderDocument } = require('../../reader/readerDocument');
const { highlightUpdatePayloads } = require('../../reader/readerHighlightProtocol');
const repository = path.resolve(__dirname, '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(repository, 'data/manifest.json'), 'utf8'));
for (const reference of manifest.plays) test(`${reference.id}: generated original text, formatting, mapping and captures survive paint, recolor and removal`, () => {
  const file = path.join(repository, 'data', reference.play), play = JSON.parse(fs.readFileSync(file, 'utf8'));
  const sections = play.sections.map(ref => JSON.parse(fs.readFileSync(path.resolve(path.dirname(file), ref.path), 'utf8')));
  const generated = createReaderDocument({ play, sections }, { documentId: 'paint-corpus-' + reference.id });
  const root = parseRoot(generated.html), h = harness(true, { root, identity: generated.identity });
  const before = [];
  walk(root, node => before.push({ node, data: node.data, attributes: node.attribs ? { ...node.attribs } : null, children: Array.from(node.childNodes || []) }));
  // This oracle uses the published source blocks, independently of renderer
  // mappings and the inverse adapter under test.
  let offset = 0;
  const records = sections.flatMap(section => section.content).map((block, index, all) => {
    const record = { block, start: offset, end: offset + block.text.length, index };
    offset = record.end + (index === all.length - 1 ? 0 : block.separatorAfter.length);
    return record;
  });
  const candidates = new Set([0, Math.floor(records.length / 2), records.length - 1]);
  for (const tag of ['i', 'b', 'strong']) {
    const index = records.findIndex(({ block }) => block.spans && block.spans.some(span => span.tag === tag));
    if (index >= 0) candidates.add(index);
  }
  const selected = Array.from(candidates).map(i => records[i]).filter(r => r.end > r.start && r.end - r.start <= 16384);
  const items = selected.map((r, i) => ({ id: 'corpus-' + i, start: r.start, end: r.end, colorId: ['yellow', 'sage', 'blue', 'rose'][i % 4] }));
  const adapter = factory()(root, generated.identity);
  const captures = selected.map(r => plain(adapter.read(selection(root.childNodes[r.index], 0, root.childNodes[r.index], root.childNodes[r.index].childNodes.length))));
  function assertPreserved() {
    const after = []; walk(root, node => after.push(node));
    assert.equal(after.length, before.length);
    before.forEach((record, i) => {
      assert.equal(after[i], record.node); assert.equal(after[i].data, record.data);
      assert.deepEqual(after[i].attribs ? { ...after[i].attribs } : null, record.attributes);
      assert.deepEqual(Array.from(after[i].childNodes || []), record.children);
    });
    selected.forEach((r, i) => assert.deepEqual(plain(adapter.read(selection(root.childNodes[r.index], 0, root.childNodes[r.index], root.childNodes[r.index].childNodes.length))), captures[i]));
  }
  for (const [revision, next] of [[1, items], [2, items.map(item => ({ ...item, colorId: 'rose' }))], [3, []]]) {
    for (const payload of highlightUpdatePayloads(generated.identity, 1, revision, next, generated.canonical)) assert.equal(h.runtime.update(payload), true);
    assertPreserved();
    if (revision === 1) {
      for (const item of items) {
        const ranges = h.registry.get('bard-highlight-' + item.colorId).ranges;
        const actual = ranges.filter(r => adapter.read(selection(r.startContainer, r.startOffset, r.endContainer, r.endOffset)).start >= item.start
          && adapter.read(selection(r.startContainer, r.startOffset, r.endContainer, r.endOffset)).end <= item.end)
          .map(r => r.startContainer.data.slice(r.startOffset, r.endOffset)).join('');
        assert.equal(actual, selected.find(r => r.start === item.start).block.text);
      }
    }
  }
  assert.equal(h.registry.size, 1); assert.equal(h.registry.get('foreign'), 'keep');
});
