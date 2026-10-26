const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const file = '../../reader/readerHighlightProtocol';
const protocol = () => fs.existsSync(require('node:path').resolve(__dirname, file + '.js')) ? require(file) : {};
const identity = { documentId: 'paint', workId: 'work', contentVersion: 'v1', canonicalTextVersion: '1' };
const canonical = { ...identity, text: 'AB😀C\n\nDE', units: [{ id: 'a', sectionId: 's', start: 0, textEnd: 5, end: 7 }, { id: 'b', sectionId: 's', start: 7, textEnd: 9, end: 9 }] };
const item = { id: 'test-1', start: 1, end: 8, colorId: 'yellow' };
test('paint helper sends bounded atomic chunks through fixed calls with no quotations or executable IDs', () => {
  const p = protocol(); assert.equal(typeof p.buildHighlightScripts, 'function');
  const items = Array.from({ length: 200 }, (_, i) => ({ ...item, id: 'id-' + i + '<script>\u2028' }));
  const payloads = p.highlightUpdatePayloads(identity, 1, 2, items, canonical), calls = [];
  assert.equal(payloads[0].phase, 'begin'); assert.equal(payloads[0].count, 200); assert.equal(payloads.at(-1).phase, 'commit');
  for (const payload of payloads) assert.ok(JSON.stringify(payload).length <= 8192);
  for (const script of p.buildHighlightScripts(identity, 1, 2, items, canonical)) vm.runInNewContext(script, { window: { BardReader: { updateHighlights(payload) { calls.push(payload); } } } });
  assert.equal(calls.filter(p => p.phase === 'chunk').flatMap(p => p.items).length, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), payloads);
  assert.equal(p.highlightUpdatePayloads(identity, 2, 3, [], canonical)[0].chunks, 0);
});
test('paint helper rejects malformed identities, extra keys, duplicate IDs, bounds and separator-only ranges', () => {
  const p = protocol(); assert.equal(typeof p.highlightUpdatePayloads, 'function');
  for (const items of [[{ ...item, colorId: 'red' }], [{ ...item, colorId: ['yellow'] }], [{ ...item, exact: 'text' }], [item, item], [{ ...item, start: 3 }], [{ ...item, end: 10 }], [{ ...item, start: 5, end: 7 }], Array.from({ length: 201 }, (_, i) => ({ ...item, id: String(i) }))]) assert.throws(() => p.highlightUpdatePayloads(identity, 1, 1, items, canonical));
  for (const [owner, revision] of [[0, 1], [1, 0], [1.1, 1]]) assert.throws(() => p.highlightUpdatePayloads(identity, owner, revision, [item], canonical));
  assert.throws(() => p.highlightUpdatePayloads({ ...identity, workId: 'old' }, 1, 1, [item], canonical));
});
test('typed acknowledgement parser rejects unknown keys, oversized messages and invalid statuses', () => {
  const p = protocol(); assert.equal(typeof p.parseHighlightMessage, 'function');
  const ack = { ...identity, type: 'highlightsApplied', ownerGeneration: 1, revision: 2, status: 'applied' };
  assert.deepEqual(p.parseHighlightMessage(JSON.stringify(ack), identity), ack);
  for (const changes of [{ debug: true }, { ownerGeneration: 0 }, { revision: 0 }, { status: 'ok' }, { documentId: 'old' }, { code: 'arbitrary' }]) assert.equal(p.parseHighlightMessage(JSON.stringify({ ...ack, ...changes }), identity), null);
  assert.equal(p.parseHighlightMessage(' '.repeat(8193), identity), null);
  const shown = { ...ack, type: 'highlightShown', showId: 1, id: item.id };
  assert.deepEqual(p.parseHighlightMessage(JSON.stringify(shown), identity), shown);
  assert.equal(p.parseHighlightMessage(JSON.stringify({ ...shown, showId: 0 }), identity), null);
});
test('Show passage builder carries exact validated range and its own monotonic ID', () => {
  const p = protocol(); assert.equal(typeof p.highlightShowPayload, 'function');
  assert.deepEqual(p.highlightShowPayload(identity, 1, 2, 3, item, canonical), { ...identity, ownerGeneration: 1, revision: 2, showId: 3, id: 'test-1', start: 1, end: 8 });
  const calls = []; vm.runInNewContext(p.buildHighlightShowScript(identity, 1, 2, 3, item, canonical), { window: { BardReader: { showHighlight(payload) { calls.push(payload); } } } });
  assert.equal(calls[0].showId, 3);
});
test('native record conversion validates every unchanged Stage 2 reference field before compacting', () => {
  const p = protocol(); assert.equal(typeof p.highlightItemsFromReferences, 'function');
  const selectionRef = { kind: 'text-range', ...Object.fromEntries(['workId', 'contentVersion', 'canonicalTextVersion'].map(k => [k, identity[k]])), offsetUnit: 'utf16', start: 1, end: 8,
    startRef: { textId: 'a', sectionId: 's', offsetUtf16: 1 }, endRef: { textId: 'b', sectionId: 's', offsetUtf16: 1 }, exact: 'B😀C\n\nD', prefix: 'A', suffix: 'E' };
  const record = { id: 'one', colorId: 'yellow', selectionRef };
  assert.deepEqual(p.highlightItemsFromReferences([record], canonical), [{ id: 'one', start: 1, end: 8, colorId: 'yellow' }]);
  for (const changes of [{ exact: 'relocated' }, { prefix: '' }, { startRef: { ...selectionRef.startRef, textId: 'b' } }, { debug: true }, { contentVersion: 'old' }]) assert.throws(() => p.highlightItemsFromReferences([{ ...record, selectionRef: { ...selectionRef, ...changes } }], canonical));
  assert.throws(() => p.highlightItemsFromReferences([{ ...record, extra: true }], canonical));
  const hidden = structuredClone(record); Object.defineProperty(hidden.selectionRef, 'hidden', { value: 'not-on-wire' });
  assert.throws(() => p.highlightItemsFromReferences([hidden], canonical));
  const symbol = structuredClone(record); symbol.selectionRef.startRef[Symbol('hidden')] = 1;
  assert.throws(() => p.highlightItemsFromReferences([symbol], canonical));
  const getter = structuredClone(record); Object.defineProperty(getter.selectionRef, 'exact', { enumerable: true, get: () => selectionRef.exact });
  assert.throws(() => p.highlightItemsFromReferences([getter], canonical));
});
test('typed payload script boundary rejects malformed payloads and executes only the fixed allowed command', () => {
  const p = protocol(); assert.equal(typeof p.buildHighlightCommandScript, 'function');
  const begin = { ...identity, ownerGeneration: 1, revision: 1, phase: 'begin', count: 1, chunks: 1 };
  const commands = []; vm.runInNewContext(p.buildHighlightCommandScript('apply', begin, canonical), { window: { BardReader: { updateHighlights(value) { commands.push(value); } } } });
  assert.equal(commands[0].phase, 'begin');
  for (const changes of [{ extra: 'no' }, { count: 201 }, { chunks: 0 }, { ownerGeneration: 0 }, { phase: 'arbitrary' }]) assert.throws(() => p.buildHighlightCommandScript('apply', { ...begin, ...changes }, canonical));
  const show = { ...identity, ownerGeneration: 1, revision: 1, showId: 1, id: 'one', start: 1, end: 8 };
  vm.runInNewContext(p.buildHighlightCommandScript('show', show, canonical), { window: { BardReader: { showHighlight(value) { commands.push(value); } } } });
  assert.equal(commands[1].showId, 1);
  assert.throws(() => p.buildHighlightCommandScript('show', { ...show, start: 3 }, canonical));
  assert.throws(() => p.buildHighlightCommandScript('arbitrary', show, canonical));
});
test('chunk bounds include the web command envelope for short and maximum-length IDs', () => {
  const p = protocol();
  for (const length of [4, 128]) {
    const items = Array.from({ length: 200 }, (_, i) => ({ ...item, id: String(i).padStart(3, '0') + 'x'.repeat(length - 3) }));
    for (const payload of p.highlightUpdatePayloads(identity, 1, 1, items, canonical)) assert.ok(JSON.stringify({ type: 'bard-reader-highlights', payload }).length <= 8192);
  }
});
module.exports = { canonical, item };
