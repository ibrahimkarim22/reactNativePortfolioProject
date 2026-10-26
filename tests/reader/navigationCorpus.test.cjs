const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const cheerio = require('cheerio');
const { createReaderDocument } = require('../../reader/readerDocument');

const repository = path.resolve(__dirname, '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(repository, 'data/manifest.json'), 'utf8'));
const romans = [null, 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];
const specialLabels = { title: 'Title', contents: 'Original contents', cast: 'Cast', setting: 'Setting', frontmatter: 'Front matter', prologue: 'Prologue', epilogue: 'Epilogue', induction: 'Induction' };
const frontMatterKinds = new Set(['title', 'contents', 'cast', 'setting', 'frontmatter']);

function navigationBuilder() {
  const file = path.join(repository, 'reader/readerNavigation.js');
  const api = fs.existsSync(file) ? require(file) : {};
  assert.equal(typeof api.buildReaderNavigation, 'function', 'the source navigation model must exist');
  return api.buildReaderNavigation;
}

function loadEntry(reference) {
  const playFile = path.join(repository, 'data', reference.play);
  const play = JSON.parse(fs.readFileSync(playFile, 'utf8'));
  const sections = play.sections.map(ref => JSON.parse(fs.readFileSync(path.resolve(path.dirname(playFile), ref.path), 'utf8')));
  return { play, sections };
}

// All expected IDs, hierarchy, ranges and references below come from published
// JSON. No canonical builder, reference helper or navigation helper is an oracle.
function sourceExpectation(entry) {
  let offset = 0;
  const records = entry.play.sections.map(ref => {
    const document = entry.sections.find(section => section.section.id === ref.id);
    const firstBlock = document.content[0];
    const start = offset;
    for (const block of document.content) {
      offset += block.text.length;
      if (block !== entry.sections.find(section => section.section.id === entry.play.sections.at(-1).id).content.at(-1)) offset += block.separatorAfter.length;
    }
    return { ref, document, firstBlock, start, end: offset };
  });
  const items = records.map(({ ref, document, firstBlock }) => {
    const section = document.section;
    const numbered = section.kind === 'act' || section.kind === 'scene' || section.kind === 'induction-scene';
    const ordinal = section.kind === 'act' ? section.act : section.scene;
    if (numbered) assert.ok(romans[ordinal], `independent Roman table covers ${section.id}`);
    const label = section.kind === 'act' ? `Act ${romans[section.act]}`
      : section.kind === 'scene' || section.kind === 'induction-scene' ? `Scene ${romans[section.scene]}` : specialLabels[section.kind];
    assert.ok(label, `known source kind ${section.kind}`);
    const parent = records.find(record => record.ref.id === section.parentSectionId);
    const parentLabel = parent && (parent.document.section.kind === 'act' ? `Act ${romans[parent.document.section.act]}` : 'Induction');
    return {
      id: ref.id,
      textId: firstBlock.id,
      kind: section.kind,
      act: section.act == null ? null : section.act,
      scene: section.scene == null ? null : section.scene,
      parentSectionId: section.parentSectionId == null ? null : section.parentSectionId,
      label,
      locationLabel: parentLabel ? `${parentLabel} · ${label}` : label,
      sourceHeading: section.heading || '',
      frontMatter: frontMatterKinds.has(section.kind),
      reference: { kind: 'section', workId: entry.play.id, contentVersion: entry.play.contentVersion, canonicalTextVersion: entry.play.canonicalTextVersion, sectionId: ref.id },
    };
  });
  return { records, items, initialSectionId: entry.play.sections[0].id };
}

for (const reference of manifest.plays) {
  test(`${reference.id}: every source section is an ordered, reachable reader destination`, () => {
    const buildReaderNavigation = navigationBuilder();
    const entry = loadEntry(reference);
    const expected = sourceExpectation(entry);
    const result = createReaderDocument(entry, { documentId: `navigation-${reference.id}` });
    const before = JSON.stringify({ entry, canonical: result.canonical });
    // The containing array is not authoritative; play.sections alone sets order.
    const actual = buildReaderNavigation({ ...entry, sections: [...entry.sections].reverse() }, result.canonical);
    assert.deepEqual(actual, { items: expected.items, initialSectionId: expected.initialSectionId });
    assert.equal(JSON.stringify({ entry, canonical: result.canonical }), before, 'navigation must not mutate source or canonical data');
    const $ = cheerio.load(result.html);
    const firstBlocks = new Map();
    $('[data-reader-block]').each((_, node) => {
      const id = node.attribs['data-section-id'];
      if (!firstBlocks.has(id)) firstBlocks.set(id, node);
    });
    assert.equal(firstBlocks.size, expected.items.length);
    for (const [index, item] of actual.items.entries()) {
      const record = expected.records[index];
      const destination = firstBlocks.get(item.id);
      assert.ok(destination, `${item.id}: actual generated HTML destination exists`);
      assert.equal(destination.attribs['data-text-id'], item.textId, `${item.id}: opens the first occurrence, including act prefaces`);
      assert.equal(destination.attribs['data-start'], String(record.start), `${item.id}: exact source UTF-16 opening`);
      assert.equal($(destination).text(), record.firstBlock.text, `${item.id}: actual source opening remains intact`);
      assert.deepEqual(result.canonical.sections[index], { id: item.id, start: record.start, end: record.end });
    }
  });
}

test('corpus includes all 1131 destinations, ten act prefaces, and the source special-section hierarchy', () => {
  const buildReaderNavigation = navigationBuilder();
  let total = 0;
  const prefaces = [];
  for (const reference of manifest.plays) {
    const entry = loadEntry(reference);
    const { canonical } = createReaderDocument(entry, { documentId: `special-${reference.id}` });
    const { items } = buildReaderNavigation(entry, canonical);
    total += items.length;
    for (const section of entry.sections.filter(document => document.section.kind === 'act' && document.content.length > 1)) {
      const item = items.find(candidate => candidate.id === section.section.id);
      prefaces.push(`${entry.play.id}:${item.act}`);
      assert.equal(item.textId, section.content[0].id);
      assert.notEqual(item.textId, items.find(candidate => candidate.parentSectionId === item.id && candidate.kind === 'scene').textId);
    }
    for (const item of items.filter(candidate => candidate.kind === 'epilogue')) {
      const parent = items.find(candidate => candidate.id === item.parentSectionId);
      assert.equal(parent.kind, 'act');
      assert.equal(parent.act, 5);
      assert.equal(item.locationLabel, 'Act V · Epilogue');
    }
    if (entry.play.id === 'the-taming-of-the-shrew') {
      const induction = items.filter(item => item.kind === 'induction');
      assert.equal(induction.length, 1);
      assert.deepEqual(items.filter(item => item.kind === 'induction-scene').map(item => [item.parentSectionId, item.act, item.scene, item.locationLabel]), [
        [induction[0].id, null, 1, 'Induction · Scene I'], [induction[0].id, null, 2, 'Induction · Scene II'],
      ]);
    }
    if (entry.play.id === 'king-henry-the-eighth') {
      const prologue = items.find(item => item.kind === 'prologue');
      assert.equal(entry.sections.find(section => section.section.id === prologue.id).content[0].tag, 'p', 'the prologue opens at a source paragraph');
      assert.equal(prologue.textId, 'king-henry-the-eighth/sceneI_15.0/p@4080');
    }
    if (entry.play.id === 'as-you-like-it') {
      assert.equal(items.some(item => item.kind === 'setting'), false, 'a setting inside cast is never invented as a section');
      const cast = entry.sections.find(section => section.section.kind === 'cast');
      assert.ok(cast.content.some(block => block.id === 'as-you-like-it/chap04/h3@3921' && block.text.startsWith('The scene lies first near Oliver')), 'source cast owns the embedded setting');
    }
  }
  assert.equal(manifest.plays.length, 38);
  assert.equal(total, 1131);
  assert.deepEqual(prefaces, ['king-henry-the-fifth:2', 'king-henry-the-fifth:3', 'king-henry-the-fifth:4', 'king-henry-the-fifth:5', 'pericles-prince-of-tyre:1', 'pericles-prince-of-tyre:2', 'pericles-prince-of-tyre:3', 'pericles-prince-of-tyre:4', 'pericles-prince-of-tyre:5', 'romeo-and-juliet:2']);
});

function fixture() {
  const play = { id: 'fixture', contentVersion: 'v1', canonicalTextVersion: '1', sections: [{ id: 'front' }] };
  return { play, sections: [{ work: { id: play.id }, contentVersion: play.contentVersion, canonicalTextVersion: play.canonicalTextVersion, section: { id: 'front', kind: 'frontmatter' }, content: [{ id: 'first', text: 'Original title', tag: 'h2', separatorAfter: '\n\n' }] }] };
}

test('minimal frontmatter fixture gets a stable source destination without invented ordinals or headings', () => {
  const entry = fixture();
  const { canonical } = createReaderDocument(entry, { documentId: 'minimal' });
  assert.deepEqual(navigationBuilder()(entry, canonical), { items: [{ id: 'front', textId: 'first', kind: 'frontmatter', act: null, scene: null, parentSectionId: null, label: 'Front matter', locationLabel: 'Front matter', sourceHeading: '', frontMatter: true, reference: { kind: 'section', workId: 'fixture', contentVersion: 'v1', canonicalTextVersion: '1', sectionId: 'front' } }], initialSectionId: 'front' });
});

test('navigation rejects stale canonical identity and missing or foreign destination mappings', () => {
  const buildReaderNavigation = navigationBuilder();
  const entry = fixture();
  const { canonical } = createReaderDocument(entry, { documentId: 'invalid' });
  for (const [field, value] of [['workId', 'another'], ['contentVersion', 'old'], ['canonicalTextVersion', '2']]) {
    assert.throws(() => buildReaderNavigation(entry, { ...canonical, [field]: value }), `${field}: stale document must not supply a destination`);
  }
  assert.throws(() => buildReaderNavigation(entry, { ...canonical, sections: [] }));
  assert.throws(() => buildReaderNavigation(entry, { ...canonical, units: [] }));
  assert.throws(() => buildReaderNavigation(entry, { ...canonical, units: [{ ...canonical.units[0], id: 'foreign' }] }));
  assert.throws(() => buildReaderNavigation(entry, { ...canonical, units: [{ ...canonical.units[0], sectionId: 'foreign' }] }));
});

test('navigation rejects contradictory section metadata, unknown kinds, and unsupported ordinals', () => {
  const buildReaderNavigation = navigationBuilder();
  const original = loadEntry(manifest.plays.find(play => play.id === 'romeo-and-juliet'));
  const { canonical } = createReaderDocument(original, { documentId: 'metadata' });
  const actIndex = original.play.sections.findIndex(section => section.kind === 'act');
  for (const [field, value] of [['kind', 'scene'], ['act', 2], ['scene', 7], ['parentSectionId', 'foreign'], ['heading', 'Wrong source heading'], ['orderInPlay', 999]]) {
    const entry = JSON.parse(JSON.stringify(original));
    entry.play.sections[actIndex][field] = value;
    assert.throws(() => buildReaderNavigation(entry, canonical), `${field}: reference and source document must agree`);
  }
  for (const [field, value] of [['kind', 'invented'], ['act', 0], ['act', -1], ['act', 1.5], ['act', 'I'], ['act', null]]) {
    const entry = JSON.parse(JSON.stringify(original));
    entry.play.sections[actIndex][field] = value;
    entry.sections[actIndex].section[field] = value;
    assert.throws(() => buildReaderNavigation(entry, canonical), `${field}=${value}: use verified source metadata, never infer from an ID or position`);
  }
  const missing = JSON.parse(JSON.stringify(original));
  missing.sections.pop();
  assert.throws(() => buildReaderNavigation(missing, canonical));
  const duplicate = JSON.parse(JSON.stringify(original));
  duplicate.sections.push(duplicate.sections[0]);
  assert.throws(() => buildReaderNavigation(duplicate, canonical));
});
