const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const parse5 = require('parse5');

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'data/source/pg100-images.html'), 'utf8');
const parserPath = path.join(root, 'scripts/parseGutenberg.js');
// Never import the old script: its unguarded main would overwrite tracked data.
const api = fs.readFileSync(parserPath, 'utf8').includes('module.exports') ? require(parserPath) : {};
let result;
function collection() {
  assert.equal(typeof api.parseSource, 'function', 'parser must expose a side-effect-free parseSource API');
  result ||= api.parseSource(source);
  return result;
}
const locations = [];
let offset = 0;
for (const line of source.split('\n')) { locations.push(offset); offset += line.length + 1; }
const originalElements = [];
function visit(node) {
  if (node.tagName && node.sourceCodeLocation) originalElements.push(node);
  for (const child of node.childNodes || []) visit(child);
}
visit(parse5.parse(source, { sourceCodeLocationInfo: true }));
function originalParagraph(line) {
  const position = locations[line - 1];
  const node = originalElements.find((entry) => entry.tagName === 'p'
    && entry.sourceCodeLocation.startOffset <= position
    && entry.sourceCodeLocation.endOffset > position);
  assert.ok(node, `real-source paragraph at line ${line}`);
  return node;
}
function fixtureText(node) {
  let value = '';
  function walk(entry) {
    if (entry.nodeName === '#text') value += entry.value.replace(/\r\n?/g, '\n').replace(/[ \t]*\n[ \t]*/g, ' ');
    else if (entry.tagName === 'br') value += '\n';
    else for (const child of entry.childNodes || []) walk(child);
  }
  walk(node);
  return value.split('\n').map((part) => part.replace(/^[ \t]+|[ \t]+$/g, '')).join('\n');
}
function blockAt(line) {
  const node = originalParagraph(line);
  const start = node.sourceCodeLocation.startOffset;
  const blocks = collection().plays.flatMap((entry) => entry.sections.flatMap((section) => section.content));
  const block = blocks.find((entry) => entry.sourceRef.start === start);
  assert.ok(block, `source paragraph at line ${line} must be emitted`);
  assert.equal(block.text, fixtureText(node), `unaltered real-source text at line ${line}`);
  return block;
}

test('pure parser covers exactly the 38 intended anchored works', () => {
  const parsed = collection();
  assert.equal(parsed.plays.length, 38);
  assert.deepEqual(parsed.plays.map((entry) => entry.play.source.chapterId),
    Array.from({ length: 38 }, (_, index) => `chap${String(index + 2).padStart(2, '0')}`));
  assert.ok(parsed.plays.every((entry) => entry.play.schemaVersion === '2.0.0'));
});

for (const [name, line] of [
  ['Helena continuation', 3432], ['Philo continuation', 10520],
  ['Hamlet dumb show', 52286], ['cue-only Falstaff', 61733], ['Falstaff continuation', 61737],
  ['Henry VIII song', 100086], ['coronation procession', 101574],
  ['Margaret continuation', 194569], ['Romeo guest list', 197936],
  ['Ariel song', 211127], ['song second stanza', 247162], ['song third stanza', 247170],
]) test(`preserves ${name} verbatim from the real source`, () => blockAt(line));

test('prologue, epilogue, induction, cast and act-opening material have ordered sections', () => {
  const parsed = collection();
  const romeo = parsed.plays.find((entry) => entry.play.id === 'romeo-and-juliet');
  assert.ok(romeo.sections.some((section) => section.section.kind === 'prologue'));
  const tempest = parsed.plays.find((entry) => entry.play.id === 'the-tempest');
  assert.ok(tempest.sections.some((section) => section.section.kind === 'epilogue'));
  const shrew = parsed.plays.find((entry) => entry.play.id === 'the-taming-of-the-shrew');
  assert.equal(shrew.sections.filter((section) => section.section.kind === 'induction-scene').length, 2);
  assert.ok(shrew.sections.some((section) => section.section.kind === 'cast'));
  const henry = parsed.plays.find((entry) => entry.play.id === 'king-henry-the-fifth');
  assert.ok(henry.sections.filter((section) => section.section.kind === 'act')
    .some((section) => section.content.some((block) => block.speakerLabel === 'CHORUS.')));
  for (const entry of parsed.plays) assert.deepEqual(entry.sections.map((section) => section.section.orderInPlay),
    entry.sections.map((_, index) => index + 1));
});

test('unlabelled text is not assigned an invented preceding speaker', () => {
  for (const line of [10520, 52286, 211127]) {
    const block = blockAt(line);
    assert.equal(block.speakerLabel, null);
    assert.notEqual(block.attribution.status, 'explicit');
  }
  assert.equal(blockAt(10501).speakerLabel, 'PHILO.');
  assert.equal(blockAt(61733).speakerLabel, 'FALSTAFF.');
});

test('ordinary scene identities survive while generated numbering is identified', () => {
  const romeo = collection().plays.find((entry) => entry.play.id === 'romeo-and-juliet');
  const first = romeo.play.acts[0].scenes[0];
  assert.equal(first.id, 'romeo-and-juliet-1-1');
  assert.equal(first.path, './scenes/act-1-scene-1.json');
  const section = romeo.sections.find((entry) => entry.section.id === first.id);
  assert.ok(section.content.every((block) => block.lines.every((line) => line.sourceLineNumber === null)));
});

test('an inherited prologue anchor does not create another section from its speaker cue', () => {
  const parsed = collection();
  const kinsmen = parsed.plays.find((entry) => entry.play.id === 'the-two-noble-kinsmen');
  assert.equal(kinsmen.sections.filter((entry) => entry.section.kind === 'prologue').length, 1);
  const henry = parsed.plays.find((entry) => entry.play.id === 'king-henry-the-eighth');
  const prologue = henry.sections.find((entry) => entry.section.kind === 'prologue');
  assert.equal(prologue.section.heading, prologue.content[0].text.split('\n')[0]);
});

test('printed accented uppercase speaker cues retain their exact attribution', () => {
  for (const line of [74794, 77313, 130755]) {
    const block = blockAt(line);
    assert.equal(block.speakerLabel, fixtureText(originalParagraph(line)).split('\n')[0]);
    assert.equal(block.attribution.status, 'explicit');
  }
});

test('source cues before explicit breaks do not require an invented final period', () => {
  for (const line of [20317, 48058, 100081, 214576]) {
    const block = blockAt(line);
    assert.equal(block.speakerLabel, fixtureText(originalParagraph(line)).split('\n')[0]);
    assert.equal(block.attribution.status, 'explicit');
  }
});

test('reviewed mixed-case source cues are retained without generalizing prose into speakers', () => {
  const evidence = require('../../scripts/sourceCueEvidence.json');
  for (const entry of evidence.entries) {
    const block = blockAt(entry.sourceRef.line);
    assert.equal(block.speakerLabel, entry.label);
    assert.equal(block.attribution.status, 'explicit');
  }
  assert.equal(blockAt(10520).speakerLabel, null);
  assert.equal(blockAt(211127).speakerLabel, null);
});

test('an unpunctuated cue with an inline singing annotation is distinct from a song caption', () => {
  const balthasar = blockAt(163293);
  const original = fixtureText(originalParagraph(163293)).split('\n')[0];
  assert.equal(balthasar.speakerLabel, original.slice(0, original.indexOf(' [')));
  const caption = blockAt(211123);
  assert.equal(caption.speakerLabel, null);
  assert.notEqual(caption.attribution.status, 'explicit');
  const lyrics = blockAt(14264);
  assert.equal(lyrics.speakerLabel, null);
  assert.equal(lyrics.type, 'passage');
  assert.equal(lyrics.attribution.status, 'source-unlabelled');
  const multiLineSong = blockAt(156127);
  assert.equal(multiLineSong.type, 'passage');
  assert.equal(multiLineSong.speakerLabel, null);
});

test('unsupported meaningful markup produces a located diagnostic instead of disappearing', () => {
  collection();
  const insertion = source.indexOf('<p class="drama">', source.indexOf('id="chap02"'));
  const changed = source.slice(0, insertion) + '<canvas>unsupported technical fixture</canvas>' + source.slice(insertion);
  const parsed = api.parseSource(changed);
  assert.ok(parsed.diagnostics.some((item) => item.severity === 'error' && item.sourceRef
    && /canvas/.test(item.message)));
});
