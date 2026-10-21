const assert = require('node:assert/strict');
const test = require('node:test');
const core = require('../../reader/readerHighlights');
const canonical = {
  workId: 'work', contentVersion: 'v1', canonicalTextVersion: '1', text: 'Écho\u00a0😀\n\nÉcho\tfin',
  units: [{ id: 'a', sectionId: 's1', start: 0, textEnd: 7, end: 9 }, { id: 'b', sectionId: 's2', start: 9, textEnd: 13, end: 14 }, { id: 'c', sectionId: 's2', start: 14, textEnd: 17, end: 17 }],
};
const scope = { uid: 'account-A', workId: 'work', canonical };
const ref = { kind: 'text-range', workId: 'work', contentVersion: 'v1', canonicalTextVersion: '1', offsetUnit: 'utf16', start: 0, end: 13,
  startRef: { textId: 'a', sectionId: 's1', offsetUtf16: 0 }, endRef: { textId: 'b', sectionId: 's2', offsetUtf16: 4 }, exact: 'Écho\u00a0😀\n\nÉcho', prefix: '', suffix: '\tfin' };
const makeRecord = (changes = {}) => ({ schemaVersion: 1, id: 'one', owner: { kind: 'account', uid: 'account-A' }, workId: 'work', selectionRef: structuredClone(ref), colorId: 'sage', revision: 1, createdAt: 1700000000000, updatedAt: 1700000000000, ...changes });
function narrow(start, end) {
  const first = canonical.units.find(unit => start >= unit.start && start < unit.end), last = canonical.units.find(unit => end > unit.start && end <= unit.end);
  return { ...structuredClone(ref), start, end, exact: canonical.text.slice(start, end), prefix: canonical.text.slice(Math.max(0, start - 32), start), suffix: canonical.text.slice(end, end + 32),
    startRef: { textId: first.id, sectionId: first.sectionId, offsetUtf16: start - first.start }, endRef: { textId: last.id, sectionId: last.sectionId, offsetUtf16: end - last.start } };
}

test('saved records preserve every canonical UTF-16 field, repeated occurrence, NBSP, accent and separator without freezing caller data', () => {
  assert.equal(typeof core.validateHighlightRecord, 'function');
  const input = makeRecord(), original = structuredClone(input), record = core.validateHighlightRecord(input, scope);
  assert.deepEqual(record, original); assert.notEqual(record, input); assert.notEqual(record.selectionRef, input.selectionRef);
  for (const object of [record, record.owner, record.selectionRef, record.selectionRef.startRef, record.selectionRef.endRef]) assert.equal(Object.isFrozen(object), true);
  assert.equal(Object.isFrozen(input), false); assert.equal(Object.isFrozen(input.selectionRef), false);
  input.selectionRef.exact = 'changed'; assert.equal(record.selectionRef.exact, original.selectionRef.exact);
  const repeat = core.validateSelectionRef(narrow(9, 13), canonical); assert.equal(repeat.start, 9); assert.equal(repeat.exact, 'Écho');
});

test('record schema, owner/work scope and metadata reject unknown or invalid values', () => {
  assert.equal(typeof core.validateHighlightRecord, 'function');
  const changes = [{ schemaVersion: 2 }, { schemaVersion: '1' }, { id: '' }, { id: 'x'.repeat(129) }, { owner: { kind: 'guest', uid: 'account-A' } }, { owner: { kind: 'account', uid: 'account-B' } }, { owner: { kind: 'account', uid: 'account-A', email: 'private' } }, { workId: 'other' }, { colorId: 'red' }, { colorId: ['sage'] }, { revision: 0 }, { revision: 1.1 }, { createdAt: -1 }, { createdAt: '2026-01-01T00:00:00Z' }, { updatedAt: Infinity }, { updatedAt: 1 }, { documentId: 'ephemeral' }];
  for (const change of changes) assert.throws(() => core.validateHighlightRecord(makeRecord(change), scope), { code: 'INVALID_HIGHLIGHT' });
  for (const key of Object.keys(makeRecord())) { const value = makeRecord(); delete value[key]; assert.throws(() => core.validateHighlightRecord(value, scope), { code: 'INVALID_HIGHLIGHT' }, key); }
  const hidden = makeRecord(); Object.defineProperty(hidden, 'hidden', { value: true }); assert.throws(() => core.validateHighlightRecord(hidden, scope), { code: 'INVALID_HIGHLIGHT' });
  const symbol = makeRecord(); symbol[Symbol('private')] = 1; assert.throws(() => core.validateHighlightRecord(symbol, scope), { code: 'INVALID_HIGHLIGHT' });
  const getter = makeRecord(); Object.defineProperty(getter, 'colorId', { enumerable: true, get: () => 'sage' }); assert.throws(() => core.validateHighlightRecord(getter, scope), { code: 'INVALID_HIGHLIGHT' });
  assert.throws(() => core.validateHighlightRecord(makeRecord(), { ...scope, uid: null }), { code: 'INVALID_HIGHLIGHT' });
});

test('complete references reject forged quotation/context/endpoints, unsafe boundaries and separator-only captures', () => {
  assert.equal(typeof core.validateSelectionRef, 'function');
  for (const change of [{ exact: 'relocated' }, { prefix: 'invented' }, { suffix: '' }, { offsetUnit: 'codepoint' }, { start: 0.5 }, { end: Number.MAX_SAFE_INTEGER + 1 }, { startRef: { ...ref.startRef, textId: 'b' } }, { endRef: { ...ref.endRef, extra: true } }, { debug: true }]) assert.throws(() => core.validateSelectionRef({ ...ref, ...change }, canonical), { code: 'INVALID_HIGHLIGHT' });
  for (const key of Object.keys(ref)) { const value = structuredClone(ref); delete value[key]; assert.throws(() => core.validateSelectionRef(value, canonical), { code: 'INVALID_HIGHLIGHT' }); }
  assert.throws(() => core.validateSelectionRef(narrow(6, 7), canonical), { code: 'INVALID_HIGHLIGHT' });
  assert.throws(() => core.validateSelectionRef(narrow(7, 9), canonical), { code: 'SEPARATOR_ONLY' });
});

test('the unchanged selection cap accepts exactly 16,384 UTF-16 units and refuses a larger selection without truncation', () => {
  assert.equal(typeof core.validateSelectionRef, 'function');
  const text = 'x'.repeat(16385), document = { workId: 'work', contentVersion: 'v1', canonicalTextVersion: '1', text, units: [{ id: 'a', sectionId: 's1', start: 0, textEnd: text.length, end: text.length }] };
  const value = { ...ref, start: 0, end: 16384, startRef: { textId: 'a', sectionId: 's1', offsetUtf16: 0 }, endRef: { textId: 'a', sectionId: 's1', offsetUtf16: 16384 }, exact: 'x'.repeat(16384), prefix: '', suffix: 'x' };
  assert.equal(core.validateSelectionRef(value, document).exact.length, 16384);
  assert.throws(() => core.validateSelectionRef({ ...value, end: 16385, exact: text, suffix: '', endRef: { ...value.endRef, offsetUtf16: 16385 } }, document), { code: 'SELECTION_TOO_LARGE' });
});

test('incompatible versions remain immutable unresolved records with the original reference and quotation', () => {
  assert.equal(typeof core.classifyRecord, 'function');
  for (const [field, code] of [['contentVersion', 'CONTENT_VERSION_MISMATCH'], ['canonicalTextVersion', 'CANONICAL_TEXT_VERSION_MISMATCH']]) {
    const input = makeRecord({ selectionRef: { ...ref, [field]: 'old-version' } }), before = structuredClone(input);
    assert.deepEqual(core.validateHighlightRecord(input, scope), before);
    const result = core.classifyRecord(input, scope);
    assert.equal(result.status, 'unresolved'); assert.equal(result.code, code); assert.deepEqual(result.record, before);
    assert.equal(Object.isFrozen(result.record.selectionRef), true);
    assert.throws(() => core.validateSelectionRef(input.selectionRef, canonical), { code });
  }
  assert.equal(core.classifyRecord(makeRecord(), scope).status, 'resolved');
  assert.throws(() => core.classifyRecord(makeRecord({ schemaVersion: 99 }), scope), { code: 'INVALID_HIGHLIGHT' });
  const hiddenField = { ...ref, contentVersion: 'old-version' }; Object.defineProperty(hiddenField, 'exact', { value: ref.exact, enumerable: false });
  assert.throws(() => core.classifyRecord(makeRecord({ selectionRef: hiddenField }), scope), { code: 'INVALID_HIGHLIGHT' });
});

test('creation identifies exact duplicates, preserves adjacent entries and rejects all partial or nested overlaps', () => {
  assert.equal(typeof core.findCreateConflict, 'function');
  const first = core.validateHighlightRecord(makeRecord({ selectionRef: narrow(0, 4) }), scope);
  assert.deepEqual(core.findCreateConflict([first], narrow(0, 4), canonical), { kind: 'duplicate', record: first });
  assert.deepEqual(core.findCreateConflict([first], narrow(4, 7), canonical), { kind: 'new' });
  assert.deepEqual(core.findCreateConflict([first], narrow(9, 13), canonical), { kind: 'new' });
  for (const value of [narrow(0, 7), narrow(1, 3), narrow(2, 7)]) assert.throws(() => core.findCreateConflict([first], value, canonical), error => error.code === 'HIGHLIGHT_OVERLAP' && assert.deepEqual(error.conflictIds, ['one']) === undefined);
  const old = makeRecord({ id: 'old', selectionRef: { ...first.selectionRef, contentVersion: 'old' } });
  assert.deepEqual(core.findCreateConflict([old], narrow(0, 4), canonical), { kind: 'new' });
});

test('loaded conflict detection marks every participant and never chooses a paint winner', () => {
  assert.equal(typeof core.findStoredConflicts, 'function');
  const records = [makeRecord({ id: 'adjacent', selectionRef: narrow(4, 7) }), makeRecord({ id: 'nested', selectionRef: narrow(1, 3) }), makeRecord({ id: 'one', selectionRef: narrow(0, 4) }), makeRecord({ id: 'duplicate', selectionRef: narrow(0, 4) }), makeRecord({ id: 'other', selectionRef: narrow(9, 13) })];
  const ids = core.findStoredConflicts(records, canonical);
  assert.deepEqual(ids, ['duplicate', 'one', 'nested']); assert.equal(Object.isFrozen(ids), true);
  assert.throws(() => core.findCreateConflict(records, narrow(0, 4), canonical), error => error.code === 'HIGHLIGHT_OVERLAP' && error.conflictIds.includes('nested'));
  assert.equal(core.findStoredConflicts([makeRecord({ selectionRef: { ...ref, contentVersion: 'old' } })], canonical).length, 0);
});

test('record keys encode UID, work and annotation as distinct bounded segments', () => {
  assert.equal(typeof core.keyFor, 'function');
  assert.equal(core.prefixFor('A/B', 'work/é'), '@bard/reader-highlights:v1/A%2FB/work%2F%C3%A9/');
  assert.equal(core.keyFor('A/B', 'work/é', 'id/%'), '@bard/reader-highlights:v1/A%2FB/work%2F%C3%A9/id%2F%25');
  assert.notEqual(core.keyFor('A', 'B/C', 'id'), core.keyFor('A/B', 'C', 'id'));
  for (const args of [[null, 'work', 'id'], ['', 'work', 'id'], ['a', '', 'id'], ['a', 'work', 'x'.repeat(129)], ['a', 'work', '\ud800']]) assert.throws(() => core.keyFor(...args), { code: 'INVALID_HIGHLIGHT' });
});

test('UTF-8 byte accounting includes astral characters, accents, NBSP and replacement for isolated surrogates', () => {
  assert.equal(typeof core.utf8Length, 'function');
  for (const [value, bytes] of [['ASCII', 5], ['é', 2], ['\u00a0', 2], ['😀', 4], ['\ud800', 3], ['\udc00', 3], ['\ud800x', 4]]) assert.equal(core.utf8Length(value), bytes);
  assert.equal(core.utf8Length('é'.repeat(65536)), 131072); assert.equal(core.utf8Length('é'.repeat(65536) + 'x'), 131073);
  assert.throws(() => core.utf8Length(null), { code: 'INVALID_HIGHLIGHT' });
});

test('capacity, read/write and overlap errors provide actionable messages without changing records', () => {
  assert.equal(typeof core.errorMessage, 'function');
  for (const [code, pattern] of [['HIGHLIGHT_COUNT_LIMIT', /200/], ['HIGHLIGHT_RECORD_TOO_LARGE', /128 KiB/], ['HIGHLIGHT_WORK_TOO_LARGE', /512 KiB/], ['HIGHLIGHT_READ_FAILED', /read|load/i], ['HIGHLIGHT_WRITE_FAILED', /sav|writ/i], ['HIGHLIGHT_OVERLAP', /overlap/i]]) assert.match(core.errorMessage(code), pattern);
  assert.match(core.errorMessage('untrusted arbitrary text'), /highlight/i);
  assert.match(core.errorMessage('UNSUPPORTED'), /paint.*unavailable|painting.*unavailable/i);
  assert.match(core.errorMessage('UNSUPPORTED'), /saved.*retain/i);
  assert.match(core.errorMessage('HIGHLIGHTS_UNSUPPORTED'), /unavailable/i);
  assert.match(core.errorMessage('RETRY_REQUIRED'), /retry/i);
  assert.match(core.errorMessage('NOT_FOUND'), /no longer available/i);
});

function publishedFixture() {
  const fs = require('node:fs'), path = require('node:path');
  const repository = path.resolve(__dirname, '../..');
  const manifest = JSON.parse(fs.readFileSync(path.join(repository, 'data/manifest.json'), 'utf8'));
  const entry = manifest.plays.find(play => play.id === 'alls-well-that-ends-well');
  const file = path.join(repository, 'data', entry.play), play = JSON.parse(fs.readFileSync(file, 'utf8'));
  const sections = play.sections.map(ref => JSON.parse(fs.readFileSync(path.resolve(path.dirname(file), ref.path), 'utf8')));
  const canonical = require('../../shared/contentText').buildCanonicalDocument({ play, sections });
  // Expected endpoints come from published block order and exact source strings,
  // independently of the canonical selection constructor and record validator.
  let text = '';
  const records = sections.flatMap(section => section.content.map(block => ({ block, sectionId: section.section.id })));
  records.forEach((record, index) => {
    record.start = text.length; text += record.block.text; record.textEnd = text.length;
    if (index < records.length - 1) text += record.block.separatorAfter;
    record.end = text.length;
  });
  function selection(start, end) {
    const first = records.find(r => start >= r.start && start < r.end), last = records.find(r => end > r.start && end <= r.end);
    return { kind: 'text-range', workId: play.id, contentVersion: play.contentVersion, canonicalTextVersion: play.canonicalTextVersion, offsetUnit: 'utf16', start, end,
      startRef: { textId: first.block.id, sectionId: first.sectionId, offsetUtf16: start - first.start }, endRef: { textId: last.block.id, sectionId: last.sectionId, offsetUtf16: end - last.start },
      exact: text.slice(start, end), prefix: text.slice(Math.max(0, start - 32), start), suffix: text.slice(end, end + 32) };
  }
  return { play, records, text, selection, canonical };
}
test('published NBSP, accented text and paragraph separators round-trip through the complete record unchanged', () => {
  const source = publishedFixture(), before = JSON.stringify(source.canonical);
  const indices = [source.records.findIndex(r => r.block.text.includes('\u00a0')), source.records.findIndex(r => /[\u00c0-\u024f]/.test(r.block.text)), source.records.findIndex((r, i) => r.block.text.length && r.end > r.textEnd && source.records[i + 1]?.block.text.length)];
  assert.ok(indices.every(i => i >= 0));
  for (const [index, position] of indices.entries()) {
    const first = source.records[position], end = index === 2 ? source.records[position + 1].textEnd : first.textEnd;
    const selectionRef = source.selection(first.start, end);
    const input = makeRecord({ id: 'source-' + index, workId: source.play.id, selectionRef });
    const result = core.validateHighlightRecord(input, { uid: 'account-A', workId: source.play.id, canonical: source.canonical });
    assert.deepEqual(result.selectionRef, selectionRef); assert.equal(result.selectionRef.exact, source.text.slice(first.start, end));
    if (index === 0) assert.ok(result.selectionRef.exact.includes('\u00a0'));
    if (index === 1) assert.match(result.selectionRef.exact, /[\u00c0-\u024f]/);
    if (index === 2) assert.ok(result.selectionRef.exact.includes(first.block.separatorAfter));
  }
  assert.equal(JSON.stringify(source.canonical), before);
});
test('published repeated quotations remain independent occurrences instead of relocating to a text match', () => {
  const source = publishedFixture(), seen = new Map();
  let pair;
  for (const record of source.records) {
    if (record.block.text.length > 4 && seen.has(record.block.text)) { pair = [seen.get(record.block.text), record]; break; }
    seen.set(record.block.text, record);
  }
  assert.ok(pair);
  const first = makeRecord({ workId: source.play.id, selectionRef: source.selection(pair[0].start, pair[0].textEnd) });
  const next = source.selection(pair[1].start, pair[1].textEnd);
  assert.equal(first.selectionRef.exact, next.exact); assert.notEqual(first.selectionRef.start, next.start);
  assert.deepEqual(core.findCreateConflict([first], next, source.canonical), { kind: 'new' });
});
