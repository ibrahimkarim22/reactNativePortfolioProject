const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let api = {};
try {
  api = require('../../shared/contentText');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND' || !error.message.includes('shared/contentText')) throw error;
}
const call = (name, ...args) => {
  assert.equal(typeof api[name], 'function', `contentText must export ${name}`);
  return api[name](...args);
};

function fixture() {
  const source = { name: 'technical fixture', sha256: 'source-digest' };
  const play = {
    id: 'technical-work', schemaVersion: '2.0.0', canonicalTextVersion: '1', contentVersion: 'v1', source,
    sections: [{ id: 'one', orderInPlay: 0 }, { id: 'two', orderInPlay: 1 }],
  };
  const section = (id, content, orderInPlay) => ({
    schemaVersion: '2.0.0', canonicalTextVersion: '1', contentVersion: 'v1',
    work: { id: play.id }, source, section: { id, orderInPlay }, content,
  });
  const sections = [
    section('one', [
      { id: 'a', text: 'A\ud83d\ude00\u00a0e\u0301', separatorAfter: '\n\n' },
      { id: 'b', text: 'B\n', separatorAfter: '\t' },
    ], 0),
    section('two', [{ id: 'c', text: 'C  D\n', separatorAfter: '\n\n' }], 1),
  ];
  return { play, sections };
}
const document = () => call('buildCanonicalDocument', fixture());
const select = (doc, start, end) => call('createSelection', doc, start, end);
const resolve = (doc, selection) => call('resolveSelection', doc, selection);
const throwsCode = (fn, code) => assert.throws(fn, error => error.code === code);

test('canonical concatenation preserves Unicode and explicit final breaks without adding a final separator', () => {
  const doc = document();
  assert.equal(doc.workId, 'technical-work');
  assert.equal(doc.contentVersion, 'v1');
  assert.equal(doc.canonicalTextVersion, '1');
  assert.equal(doc.text, 'A\ud83d\ude00\u00a0e\u0301\n\nB\n\tC  D\n');
  assert.deepEqual(doc.units, [
    { id: 'a', sectionId: 'one', start: 0, textEnd: 6, end: 8 },
    { id: 'b', sectionId: 'one', start: 8, textEnd: 10, end: 11 },
    { id: 'c', sectionId: 'two', start: 11, textEnd: 16, end: 16 },
  ]);
  assert.deepEqual(doc.sections, [{ id: 'one', start: 0, end: 11 }, { id: 'two', start: 11, end: 16 }]);
});

test('canonical order follows authoritative play section references', () => {
  const input = fixture();
  input.sections.reverse();
  assert.equal(call('buildCanonicalDocument', input).text, 'A\ud83d\ude00\u00a0e\u0301\n\nB\n\tC  D\n');
});

test('canonical mappings distinguish identical text at distinct source occurrences', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../data/source/pg100-images.html'), 'utf8');
  assert.ok(source.split('<b>ACT I</b>').length > 2, 'repeated heading must exist in immutable source');
  const input = fixture();
  input.sections[0].content = [
    { id: 'chap02/h2@100', text: 'ACT I', separatorAfter: '\n\n' },
    { id: 'chap03/h2@200', text: 'ACT I', separatorAfter: '\n\n' },
  ];
  const doc = call('buildCanonicalDocument', input);
  assert.equal(doc.units[0].id, 'chap02/h2@100');
  assert.equal(doc.units[1].id, 'chap03/h2@200');
  assert.equal(select(doc, 7, 12).startRef.textId, 'chap03/h2@200');
});

test('canonical construction rejects stale section versions and duplicate text IDs', () => {
  const stale = fixture();
  stale.sections[0].contentVersion = 'old';
  throwsCode(() => call('buildCanonicalDocument', stale), 'CONTENT_VERSION_MISMATCH');
  const duplicate = fixture();
  duplicate.sections[1].content[0].id = 'a';
  throwsCode(() => call('buildCanonicalDocument', duplicate), 'INVALID_DOCUMENT');
});

test('canonical construction rejects missing or unowned sections', () => {
  const missing = fixture();
  missing.sections.pop();
  throwsCode(() => call('buildCanonicalDocument', missing), 'INVALID_DOCUMENT');
  const extra = fixture();
  extra.play.sections.pop();
  throwsCode(() => call('buildCanonicalDocument', extra), 'INVALID_DOCUMENT');
});

test('text ranges round trip across blocks and sections with whole-work UTF-16 offsets', () => {
  const doc = document();
  const selection = select(doc, 1, 14);
  assert.deepEqual(selection, {
    kind: 'text-range', workId: 'technical-work', contentVersion: 'v1', canonicalTextVersion: '1',
    offsetUnit: 'utf16', start: 1, end: 14,
    startRef: { textId: 'a', sectionId: 'one', offsetUtf16: 1 },
    endRef: { textId: 'c', sectionId: 'two', offsetUtf16: 3 },
    exact: '\ud83d\ude00\u00a0e\u0301\n\nB\n\tC  ', prefix: 'A', suffix: 'D\n',
  });
  assert.deepEqual(resolve(doc, selection), { start: 1, end: 14, text: selection.exact });
});

test('separator positions and exact unit boundaries have stable endpoint owners', () => {
  const doc = document();
  const separator = select(doc, 6, 8);
  assert.deepEqual(separator.startRef, { textId: 'a', sectionId: 'one', offsetUtf16: 6 });
  assert.deepEqual(separator.endRef, { textId: 'a', sectionId: 'one', offsetUtf16: 8 });
  assert.equal(separator.exact, '\n\n');
  assert.deepEqual(select(doc, 8, 11).startRef, { textId: 'b', sectionId: 'one', offsetUtf16: 0 });
  assert.deepEqual(select(doc, 8, 11).endRef, { textId: 'b', sectionId: 'one', offsetUtf16: 3 });
  assert.deepEqual(select(doc, 11, 16).endRef, { textId: 'c', sectionId: 'two', offsetUtf16: 5 });
});

test('selection context is limited to 32 UTF-16 units on either side', () => {
  const input = fixture();
  input.play.sections = [input.play.sections[0]];
  input.sections = [input.sections[0]];
  input.sections[0].content = [{ id: 'long', text: 'x'.repeat(40) + 'Y' + 'z'.repeat(40), separatorAfter: '' }];
  const selection = select(call('buildCanonicalDocument', input), 40, 41);
  assert.equal(selection.prefix, 'x'.repeat(32));
  assert.equal(selection.suffix, 'z'.repeat(32));
});

test('selection context never splits an astral character at its outer edge', () => {
  const input = fixture();
  input.play.sections = [input.play.sections[0]];
  input.sections = [input.sections[0]];
  input.sections[0].content = [{ id: 'long', text: '\ud83d\ude00' + 'x'.repeat(31) + 'Y' + 'z'.repeat(31) + '\ud83d\ude00', separatorAfter: '' }];
  const doc = call('buildCanonicalDocument', input);
  const selection = select(doc, 33, 34);
  assert.equal(selection.prefix, 'x'.repeat(31));
  assert.equal(selection.suffix, 'z'.repeat(31));
  assert.equal(resolve(doc, selection).text, 'Y');
});

test('invalid, empty, reversed, and noninteger ranges are rejected', () => {
  const doc = document();
  for (const [start, end] of [[-1, 4], [1, 17], [4, 4], [8, 4], [1.5, 4], [1, NaN]]) {
    throwsCode(() => select(doc, start, end), 'INVALID_RANGE');
  }
});

test('selection endpoints may not divide a UTF-16 surrogate pair', () => {
  const doc = document();
  throwsCode(() => select(doc, 2, 4), 'SURROGATE_BOUNDARY');
  throwsCode(() => select(doc, 1, 2), 'SURROGATE_BOUNDARY');
  const selection = select(doc, 1, 3);
  assert.equal(resolve(doc, selection).text, '\ud83d\ude00');
  throwsCode(() => resolve(doc, { ...selection, end: 2 }), 'SURROGATE_BOUNDARY');
});

test('resolution validates identity and revisions before examining invalid ranges or references', () => {
  const doc = document();
  const selection = select(doc, 1, 3);
  const broken = { ...selection, start: -1, startRef: null };
  throwsCode(() => resolve(doc, { ...broken, contentVersion: 'old' }), 'CONTENT_VERSION_MISMATCH');
  throwsCode(() => resolve(doc, { ...broken, canonicalTextVersion: '0' }), 'CANONICAL_TEXT_VERSION_MISMATCH');
  throwsCode(() => resolve(doc, { ...broken, workId: 'other-work' }), 'WORK_MISMATCH');
});

test('resolution rejects forged endpoint IDs, ownership, and local offsets', () => {
  const doc = document();
  const selection = select(doc, 1, 14);
  for (const change of [{ textId: 'b' }, { sectionId: 'missing-section' }, { offsetUtf16: 2 }]) {
    throwsCode(() => resolve(doc, { ...selection, startRef: { ...selection.startRef, ...change } }), 'ENDPOINT_REFERENCE_MISMATCH');
    throwsCode(() => resolve(doc, { ...selection, endRef: { ...selection.endRef, ...change } }), 'ENDPOINT_REFERENCE_MISMATCH');
  }
});

test('resolution rejects exact and context mismatches without quotation relocation', () => {
  const doc = document();
  const selection = select(doc, 1, 14);
  throwsCode(() => resolve(doc, { ...selection, exact: 'elsewhere' }), 'EXACT_MISMATCH');
  throwsCode(() => resolve(doc, { ...selection, prefix: '' }), 'CONTEXT_MISMATCH');
  throwsCode(() => resolve(doc, { ...selection, suffix: 'wrong' }), 'CONTEXT_MISMATCH');
  throwsCode(() => resolve(doc, { ...selection, offsetUnit: 'codepoint' }), 'INVALID_SELECTION');
});

test('whole section references resolve separately from text ranges and reject stale identity', () => {
  const doc = document();
  const reference = call('createSectionReference', doc, 'two');
  assert.deepEqual(reference, {
    kind: 'section', workId: 'technical-work', contentVersion: 'v1', canonicalTextVersion: '1', sectionId: 'two',
  });
  assert.deepEqual(call('resolveSectionReference', doc, reference), { sectionId: 'two', start: 11, end: 16, text: 'C  D\n' });
  throwsCode(() => call('createSectionReference', doc, 'missing'), 'SECTION_NOT_FOUND');
  throwsCode(() => call('resolveSectionReference', doc, { ...reference, contentVersion: 'old', sectionId: 'missing' }), 'CONTENT_VERSION_MISMATCH');
  throwsCode(() => call('resolveSectionReference', doc, { ...reference, sectionId: 'missing' }), 'SECTION_NOT_FOUND');
});

test('an empty section remains addressable without permitting an empty text selection', () => {
  const input = fixture();
  input.sections[1].content = [];
  const doc = call('buildCanonicalDocument', input);
  const reference = call('createSectionReference', doc, 'two');
  assert.deepEqual(call('resolveSectionReference', doc, reference), { sectionId: 'two', start: 10, end: 10, text: '' });
  throwsCode(() => select(doc, 10, 10), 'INVALID_RANGE');
});
