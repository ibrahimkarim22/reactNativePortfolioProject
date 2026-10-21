const assert = require('node:assert/strict');
const test = require('node:test');
const { factory, parseRoot, textNodes, selection, plain } = require('./selectionDomFixture.cjs');
const identity = { documentId: 'paint', workId: 'work', contentVersion: 'v1', canonicalTextVersion: '1' };
function fixture() {
  const root = parseRoot('<main><p data-reader-block="true" data-text-id="a" data-section-id="s" data-start="0" data-text-end="5" data-end="7" data-separator="&#10;&#10;">A<i>B<b>😀</b>C</i></p><p data-reader-block="true" data-text-id="b" data-section-id="s" data-start="7" data-text-end="9" data-end="9" data-separator="">DE</p></main>');
  return { root, adapter: factory()(root, identity) };
}
// Range construction is the browser boundary; the adapter and original parsed
// source DOM remain real. No stringification is used to infer canonical offsets.
function createRange() { return { setStart(node, offset) { this.startContainer = node; this.startOffset = offset; }, setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; } }; }
test('inverse mapping paints only original text intersections across nested formatting and layout separators', () => {
  const { root, adapter } = fixture(), before = textNodes(root), data = before.map(n => n.data);
  const capture = plain(adapter.read(selection(root, 0, root, 2)));
  assert.equal(typeof adapter.rangesFor, 'function');
  const ranges = adapter.rangesFor(1, 8, createRange);
  assert.deepEqual(Array.from(ranges, r => [before.indexOf(r.startContainer), r.startOffset, before.indexOf(r.endContainer), r.endOffset]), [[1, 0, 1, 1], [2, 0, 2, 2], [3, 0, 3, 1], [4, 0, 4, 1]]);
  assert.deepEqual(textNodes(root), before); assert.deepEqual(before.map(n => n.data), data);
  assert.deepEqual(plain(adapter.read(selection(root, 0, root, 2))), capture);
});
test('inverse mapping rejects separator-only, unsafe bounds, surrogate splits and changed original nodes', () => {
  const { root, adapter } = fixture(); assert.equal(typeof adapter.rangesFor, 'function');
  for (const [start, end, code] of [[5, 7, 'SEPARATOR_ONLY'], [0, 0, 'INVALID_RANGE'], [-1, 1, 'INVALID_RANGE'], [0, 10, 'INVALID_RANGE'], [0.5, 1, 'INVALID_RANGE'], [3, 4, 'SURROGATE_BOUNDARY']]) assert.throws(() => adapter.rangesFor(start, end, createRange), { code });
  textNodes(root)[0].data = 'X';
  assert.throws(() => adapter.rangesFor(0, 1, createRange), { code: 'INVALID_MAPPING' });
});
test('inverse ranges enforce the unchanged 16,384 UTF-16 cap', () => {
  const text = 'x'.repeat(16385), root = parseRoot(`<main><p data-reader-block="true" data-text-id="a" data-section-id="s" data-start="0" data-text-end="16385" data-end="16385" data-separator="">${text}</p></main>`);
  const adapter = factory()(root, identity); assert.equal(typeof adapter.rangesFor, 'function');
  assert.equal(adapter.rangesFor(0, 16384, createRange)[0].endOffset, 16384);
  assert.throws(() => adapter.rangesFor(0, 16385, createRange), { code: 'SELECTION_TOO_LARGE' });
});
module.exports = { fixture, identity, createRange };
