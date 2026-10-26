const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createReaderDocument } = require('../../reader/readerDocument');
const { resolveSelection } = require('../../shared/contentText');
const { factory, parseRoot, selection, point, plain } = require('./selectionDomFixture.cjs');

const repository = path.resolve(__dirname, '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(repository, 'data/manifest.json'), 'utf8'));

function loadEntry(reference) {
  const file = path.join(repository, 'data', reference.play);
  const play = JSON.parse(fs.readFileSync(file, 'utf8'));
  const sections = play.sections.map(ref => JSON.parse(fs.readFileSync(path.resolve(path.dirname(file), ref.path), 'utf8')));
  return { play, sections };
}

// Expected positions, ownership, quotation and contexts come exclusively from
// published JSON; neither the renderer's canonical result nor adapter is an oracle.
function sourceOracle(entry) {
  const records = [];
  for (const ref of entry.play.sections) {
    for (const block of entry.sections.find(section => section.section.id === ref.id).content) {
      records.push({ block, sectionId: ref.id });
    }
  }
  let text = '';
  for (const [index, record] of records.entries()) {
    record.start = text.length;
    text += record.block.text;
    record.textEnd = text.length;
    text += index === records.length - 1 ? '' : record.block.separatorAfter;
    record.end = text.length;
  }
  function split(offset) {
    return /[\uD800-\uDBFF]/.test(text[offset - 1] || '') && /[\uDC00-\uDFFF]/.test(text[offset] || '');
  }
  function expected(start, end) {
    const first = records.find(record => start >= record.start && start < record.end);
    const last = records.find(record => end > record.start && end <= record.end);
    let prefixStart = Math.max(0, start - 32), suffixEnd = Math.min(text.length, end + 32);
    if (split(prefixStart)) prefixStart += 1;
    if (split(suffixEnd)) suffixEnd -= 1;
    return { kind: 'text-range', workId: entry.play.id, contentVersion: entry.play.contentVersion,
      canonicalTextVersion: entry.play.canonicalTextVersion, offsetUnit: 'utf16', start, end,
      startRef: { textId: first.block.id, sectionId: first.sectionId, offsetUtf16: start - first.start },
      endRef: { textId: last.block.id, sectionId: last.sectionId, offsetUtf16: end - last.start },
      exact: text.slice(start, end), prefix: text.slice(prefixStart, start), suffix: text.slice(end, suffixEnd) };
  }
  return { text, records, split, expected };
}

test('selection corpus covers all 38 published plays', () => { assert.equal(manifest.plays.length, 38); });

for (const reference of manifest.plays) test(`${reference.id}: generated DOM captures independently derived source ranges`, () => {
  const entry = loadEntry(reference), oracle = sourceOracle(entry);
  const generated = createReaderDocument(entry, { documentId: `selection-corpus-${reference.id}` });
  const root = parseRoot(generated.html), blocks = root.childNodes;
  const adapter = factory()(root, generated.identity);
  const candidates = new Set([0, Math.floor(blocks.length / 2), blocks.length - 1]);
  const predicates = [
    block => block.spans && block.spans.some(span => span.tag === 'i'),
    block => block.spans && block.spans.some(span => span.tag === 'b' || span.tag === 'strong'),
    block => block.attribution && block.attribution.status === 'explicit',
    block => block.text.includes('\n'),
    block => block.text.includes('\u00a0'),
    block => block.tag === 'td' || block.tag === 'th',
    block => block.separatorAfter === '\t',
    block => /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(block.text),
  ];
  for (const predicate of predicates) {
    const index = oracle.records.findIndex(record => record.block.text.length && predicate(record.block));
    if (index >= 0) candidates.add(index);
  }
  const seen = new Set();
  const repeat = oracle.records.findIndex(record => {
    if (seen.has(record.block.text)) return record.block.text.length > 0;
    seen.add(record.block.text);
    return false;
  });
  if (repeat >= 0) candidates.add(repeat);
  let captures = 0;
  function check(startPoint, endPoint, start, end) {
    if (start === end || end - start > 16384) return;
    for (const backward of [false, true]) {
      const capture = adapter.read(selection(...startPoint, ...endPoint, backward));
      assert.deepEqual(plain(capture), oracle.expected(start, end), `${reference.id}: exact source range ${start}:${end}, backward=${backward}`);
      assert.equal(resolveSelection(generated.canonical, capture).text, oracle.text.slice(start, end));
      captures += 1;
    }
  }
  for (const index of candidates) {
    const record = oracle.records[index], block = blocks[index];
    if (record.block.text.length) {
      // Full source-block selection traverses every formatting fragment, cue,
      // explicit LF and NBSP in this occurrence, without trimming the result.
      check([block, 0], [block, block.childNodes.length], record.start, record.textEnd);
      let start = Math.min(1, record.block.text.length - 1), end = Math.min(record.block.text.length, start + 17);
      if (oracle.split(record.start + start)) start -= 1;
      if (oracle.split(record.start + end)) end += 1;
      check(point(block, start), point(block, end, true), record.start + start, record.start + end);
    }
    if (record.end > record.textEnd) check([block, block.childNodes.length], [root, index + 1], record.textEnd, record.end);
  }
  // The first transition of every source section exercises canonical separator
  // ownership across section boundaries in both selection directions.
  const sectionTransitions = oracle.records.map((record, index) => index > 0 && record.sectionId !== oracle.records[index - 1].sectionId ? index : -1).filter(index => index >= 0);
  for (const index of sectionTransitions) {
    const previous = oracle.records[index - 1], next = oracle.records[index];
    check([blocks[index - 1], 0], [blocks[index], blocks[index].childNodes.length], previous.start, next.textEnd);
  }
  assert.ok(captures >= 12, `${reference.id}: representative text, layout and section captures ran`);
});
