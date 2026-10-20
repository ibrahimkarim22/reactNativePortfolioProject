const assert = require('node:assert/strict');
const test = require('node:test');
const { factory, parseRoot, selection, point, plain } = require('./selectionDomFixture.cjs');

const identity = { documentId: 'dom-doc', workId: 'work', contentVersion: 'revision', canonicalTextVersion: '1' };
function fixture() {
  const root = parseRoot('<main><p data-reader-block="true" data-text-id="a" data-section-id="s1" data-start="0" data-text-end="16" data-end="18" data-separator="&#10;&#10;">CUE.<i>A<b>\u00a0\ud83d\ude00</b>Z</i>\nrepeat</p><span data-reader-block="true" data-text-id="b" data-section-id="s2" data-start="18" data-text-end="24" data-end="25" data-separator="&#9;">repeat</span><p data-reader-block="true" data-text-id="c" data-section-id="s2" data-start="25" data-text-end="28" data-end="28" data-separator="">end</p></main>');
  return { root, blocks: root.childNodes, adapter: factory()(root, identity) };
}

function expected(start, end, startRef, endRef) {
  const text = 'CUE.A\u00a0\ud83d\ude00Z\nrepeat\n\nrepeat\tend';
  return { kind: 'text-range', workId: 'work', contentVersion: 'revision', canonicalTextVersion: '1', offsetUnit: 'utf16', start, end, startRef, endRef,
    exact: text.slice(start, end), prefix: text.slice(Math.max(0, start - 32), start), suffix: text.slice(end, end + 32) };
}
const ref = (textId, sectionId, offsetUtf16) => ({ textId, sectionId, offsetUtf16 });

test('reads literal nested italic and bold UTF-16 positions without selected-string authority', () => {
  const { blocks, adapter } = fixture();
  const start = point(blocks[0], 4), end = point(blocks[0], 9, true);
  assert.deepEqual(plain(adapter.read(selection(...start, ...end))), expected(4, 9, ref('a', 's1', 4), ref('a', 's1', 9)));
});

test('normalized Range gives identical forward and backward captures across sections and repeated text', () => {
  const { blocks, adapter } = fixture();
  const start = point(blocks[0], 10), end = point(blocks[1], 6, true);
  const want = expected(10, 24, ref('a', 's1', 10), ref('b', 's2', 6));
  assert.deepEqual(plain(adapter.read(selection(...start, ...end))), want);
  assert.deepEqual(plain(adapter.read(selection(...start, ...end, true))), want);
});

test('element child offsets count exact nested text while a block end excludes its separator', () => {
  const { blocks, adapter } = fixture();
  const italic = blocks[0].childNodes[1];
  const result = adapter.read(selection(italic, 1, blocks[0], blocks[0].childNodes.length));
  assert.deepEqual(plain(result), expected(5, 16, ref('a', 's1', 5), ref('a', 's1', 16)));
});

test('root child boundaries include paragraph and table separators with canonical endpoint ownership', () => {
  const { root, blocks, adapter } = fixture();
  assert.deepEqual(plain(adapter.read(selection(blocks[0], blocks[0].childNodes.length, root, 1))),
    expected(16, 18, ref('a', 's1', 16), ref('a', 's1', 18)));
  assert.deepEqual(plain(adapter.read(selection(root, 1, root, 2))),
    expected(18, 25, ref('b', 's2', 0), ref('b', 's2', 7)));
  assert.deepEqual(plain(adapter.read(selection(root, 0, root, 3))),
    expected(0, 28, ref('a', 's1', 0), ref('c', 's2', 3)));
});

test('shared boundaries use next block for starts and previous block for ends even with no separator', () => {
  const root = parseRoot('<main><p data-reader-block="true" data-text-id="a" data-section-id="s" data-start="0" data-text-end="1" data-end="1" data-separator="">A</p><p data-reader-block="true" data-text-id="b" data-section-id="s" data-start="1" data-text-end="2" data-end="2" data-separator="">B</p></main>');
  const adapter = factory()(root, identity);
  assert.deepEqual(plain(adapter.read(selection(root, 0, root, 1)).endRef), ref('a', 's', 1));
  assert.deepEqual(plain(adapter.read(selection(root, 1, root, 2)).startRef), ref('b', 's', 0));
});

test('32-unit contexts omit a surrogate pair cut by the outer context boundary', () => {
  const text = 'x\ud83d\ude00' + 'a'.repeat(31) + 'Q' + 'b'.repeat(31) + '\ud83d\ude00z';
  const root = parseRoot(`<main><p data-reader-block="true" data-text-id="a" data-section-id="s" data-start="0" data-text-end="${text.length}" data-end="${text.length}" data-separator="">${text}</p></main>`);
  const node = root.childNodes[0].childNodes[0];
  const capture = factory()(root, identity).read(selection(node, 34, node, 35));
  assert.equal(capture.exact, 'Q');
  assert.equal(capture.prefix, 'a'.repeat(31));
  assert.equal(capture.suffix, 'b'.repeat(31));
});

for (const [name, getSelection, code] of [
  ['collapsed range', ({ blocks }) => selection(...point(blocks[0], 4), ...point(blocks[0], 4)), 'COLLAPSED_SELECTION'],
  ['empty native selection', () => ({ rangeCount: 0 }), 'INVALID_SELECTION'],
  ['multiple ranges', () => ({ rangeCount: 2 }), 'INVALID_SELECTION'],
  ['throwing range', () => ({ rangeCount: 1, getRangeAt() { throw new Error('detached'); } }), 'INVALID_SELECTION'],
  ['outside root endpoint', ({ blocks }) => selection(parseRoot('<main>x</main>').childNodes[0], 0, ...point(blocks[0], 4)), 'OUTSIDE_ROOT'],
  ['negative text offset', ({ blocks }) => selection(blocks[0].childNodes[0], -1, ...point(blocks[0], 4)), 'INVALID_RANGE'],
  ['excess text offset', ({ blocks }) => selection(blocks[0].childNodes[0], 5, ...point(blocks[0], 9)), 'INVALID_RANGE'],
  ['fractional element offset', ({ root }) => selection(root, 0.5, root, 1), 'INVALID_RANGE'],
  ['excess root offset', ({ root }) => selection(root, 0, root, 4), 'INVALID_RANGE'],
  ['reversed range', ({ blocks }) => selection(...point(blocks[0], 9), ...point(blocks[0], 4)), 'INVALID_RANGE'],
  ['surrogate split', ({ blocks }) => selection(...point(blocks[0], 7), ...point(blocks[0], 9)), 'SURROGATE_BOUNDARY'],
  ['canonically collapsed distinct endpoints', ({ root, blocks }) => selection(root, 1, blocks[1], 0), 'COLLAPSED_SELECTION'],
]) test(`rejects ${name} explicitly`, () => {
  const f = fixture();
  assert.throws(() => f.adapter.read(getSelection(f)), { code });
});

test('rejects oversized capture without truncation but accepts exactly 16,384 UTF-16 units', () => {
  const text = 'x'.repeat(16385);
  const root = parseRoot(`<main><p data-reader-block="true" data-text-id="a" data-section-id="s" data-start="0" data-text-end="16385" data-end="16385" data-separator="">${text}</p></main>`);
  const adapter = factory()(root, identity), node = root.childNodes[0].childNodes[0];
  assert.equal(adapter.read(selection(node, 0, node, 16384)).exact.length, 16384);
  assert.throws(() => adapter.read(selection(node, 0, node, 16385)), { code: 'SELECTION_TOO_LARGE' });
});

for (const [name, mutate] of [
  ['gap', f => { f.blocks[1].attribs['data-start'] = '20'; }],
  ['noncanonical integer', f => { f.blocks[0].attribs['data-start'] = '00'; }],
  ['incorrect text end', f => { f.blocks[0].attribs['data-text-end'] = '18'; }],
  ['incorrect separator', f => { f.blocks[0].attribs['data-separator'] = '\n'; }],
  ['duplicate text id', f => { f.blocks[1].attribs['data-text-id'] = 'a'; }],
  ['missing section id', f => { delete f.blocks[1].attribs['data-section-id']; }],
  ['nested mapped block', f => { f.blocks[0].childNodes[1].attribs['data-reader-block'] = 'true'; }],
  ['unmapped root child', f => { delete f.blocks[1].attribs['data-reader-block']; }],
  ['text replacement', f => { f.blocks[0].childNodes[0].data = 'FAKE!'; }],
]) test(`fails closed on ${name} at initialization and after indexing`, () => {
  const f = fixture();
  mutate(f);
  assert.throws(() => factory()(f.root, identity), { code: 'INVALID_MAPPING' });
  assert.throws(() => f.adapter.read(selection(f.root, 0, f.root, 1)), { code: 'INVALID_MAPPING' });
});

test('same-length text mutation and equal-text node replacement invalidate the initial index', () => {
  const f = fixture();
  f.blocks[1].childNodes[0].data = 'REPEAT';
  assert.throws(() => f.adapter.read(selection(f.root, 0, f.root, 1)), { code: 'INVALID_MAPPING' });
  const g = fixture();
  const { Text } = require('domhandler');
  const replacement = new Text('repeat');
  replacement.parent = g.blocks[1];
  g.blocks[1].childNodes[0] = replacement;
  assert.throws(() => g.adapter.read(selection(g.root, 0, g.root, 1)), { code: 'INVALID_MAPPING' });
});
