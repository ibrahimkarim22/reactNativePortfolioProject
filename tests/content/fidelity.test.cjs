const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const validatorPath = path.resolve(__dirname, '../../scripts/validateGutenbergFidelity.js');
const sourceFile = path.resolve(__dirname, '../../data/source/pg100-images.html');

function validator() {
  assert.ok(fs.existsSync(validatorPath), 'the independent fidelity validator must exist');
  return require(validatorPath);
}

test('independent traversal inventories all 44 chapters and reports every missing play', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bard-fidelity-missing-'));
  try {
    const report = validator().validateCollection({ sourceFile, candidateRoot: temp });
    assert.equal(report.passed, false);
    assert.equal(report.source.chapterCount, 44);
    assert.equal(report.source.playCount, 38);
    assert.equal(report.plays.length, 38);
    assert.equal(report.plays.filter(play => play.errors.some(error => error.code === 'missing-play')).length, 38);
    assert.ok(report.exclusions.some(exclusion => exclusion.reason === 'non-play-work' && exclusion.anchor === 'chap01'));
    assert.ok(report.exclusions.some(exclusion => exclusion.reason === 'non-play-work' && exclusion.anchor === 'chap44'));
    assert.ok(report.exclusions.every(exclusion => Number.isInteger(exclusion.start) && exclusion.end > exclusion.start));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('a newly meaningful unsupported element fails with its original source location', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bard-fidelity-markup-'));
  try {
    const raw = fs.readFileSync(sourceFile, 'utf8');
    const insertion = raw.indexOf('</h2>', raw.indexOf('id="chap02"')) + 5;
    const unsupported = '<video>NONLITERARY VALIDATOR MARKUP FIXTURE</video>';
    const changedSource = path.join(temp, 'source.html');
    fs.writeFileSync(changedSource, raw.slice(0, insertion) + unsupported + raw.slice(insertion));
    const report = validator().validateCollection({ sourceFile: changedSource, candidateRoot: temp });
    const error = report.errors.find(error => error.code === 'unsupported-markup');
    assert.equal(report.passed, false);
    assert.ok(error, 'unknown meaningful markup must not become an exclusion');
    assert.equal(error.location.start, insertion);
    assert.equal(error.location.tag, 'video');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('an image inserted into play text cannot be silently discarded', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bard-fidelity-image-'));
  try {
    const raw = fs.readFileSync(sourceFile, 'utf8');
    const insertion = raw.indexOf('</h2>', raw.indexOf('id="chap02"')) + 5;
    const changedSource = path.join(temp, 'source.html');
    fs.writeFileSync(changedSource, raw.slice(0, insertion) + '<img alt="Meaningful fixture image">' + raw.slice(insertion));
    const report = validator().validateCollection({ sourceFile: changedSource, candidateRoot: temp });
    assert.ok(report.errors.some(error => error.code === 'unsupported-markup' && error.location.start === insertion));
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

// The fixture is structural, deliberately nonliterary. Canonical strings and
// inline ranges are hand specified; no production extraction code builds it.
const fixtureIds = [
  'alls-well-that-ends-well', 'antony-and-cleopatra', 'as-you-like-it', 'errors',
  'coriolanus', 'cymbeline', 'hamlet-prince-of-denmark',
  'the-first-part-of-king-henry-the-fourth', 'the-second-part-of-king-henry-the-fourth',
  'king-henry-the-fifth', 'the-first-part-of-henry-the-sixth',
  'the-second-part-of-king-henry-the-sixth', 'the-third-part-of-king-henry-the-sixth',
  'king-henry-the-eighth', 'king-john', 'julius-caesar', 'king-lear', 'loves-labours-lost',
  'macbeth', 'measure-for-measure', 'the-merchant-of-venice', 'the-merry-wives-of-windsor',
  'a-midsummer-nights-dream', 'much-ado-about-nothing', 'othello-the-moor-of-venice',
  'pericles-prince-of-tyre', 'king-richard-the-second', 'king-richard-the-third',
  'romeo-and-juliet', 'the-taming-of-the-shrew', 'the-tempest', 'timon-of-athens',
  'titus-andronicus', 'troilus-and-cressida', 'twelfth-night-or-what-you-will',
  'the-two-gentlemen-of-verona', 'the-two-noble-kinsmen', 'the-winters-tale',
];
const fixtureCatalogIds = [...fixtureIds.slice(0, 4), fixtureIds[37], ...fixtureIds.slice(4, 14), fixtureIds[15], fixtureIds[14], ...fixtureIds.slice(16, 37)];
const fixtureCodes = ['AWW', 'Ant', 'AYL', 'Err', 'WT', 'Cor', 'Cym', 'Ham', '1H4', '2H4', 'H5', '1H6', '2H6', '3H6', 'H8', 'JC', 'Jn', 'Lr', 'LLL', 'Mac', 'MM', 'MV', 'Wiv', 'MND', 'Ado', 'Oth', 'Per', 'R2', 'R3', 'Rom', 'Shr', 'Tmp', 'Tim', 'Tit', 'Tro', 'TN', 'TGV', 'TNK'];
const fixtureImages = ['AWWimage.png', 'ANTimage.png', 'AYLimage.jpg', 'Errimage.png', 'WTimage.png', 'Corimage.png', 'Cymimage.png', 'Hamimage.png', '1H4image.png', '2H4image.png', 'H5image.png', '1H6image.png', '2H6image.png', '3H6image.png', 'H8image.png', 'JCimage.png', 'Jnimage.png', 'Lrimage.png', 'LLLimage.png', 'Macimage.png', 'MMimage.png', 'MVimage.png', 'Wivimage.png', 'MNDimage.jpg', 'Adoimage.png', 'Othimage.png', 'Perimage.png', 'R2image.png', 'R3image.png', 'Romimage.jpg', 'Shrimage.png', 'Tmpimage.jpg', 'Timimage.png', 'Titimage.png', 'Troimage.png', 'TNimage.jpg', 'TGVimage.png', 'TNKimage.png'];

function makeFixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bard-fidelity-fixture-'));
  const pieces = ['<!doctype html><html><head><title>Structural fixture</title></head><body>'];
  const specs = [];
  let copiedCue;
  if (options.sourceCue) {
    const raw = fs.readFileSync(sourceFile, 'utf8');
    const markup = raw.slice(options.sourceCue.start, options.sourceCue.end);
    assert.ok(markup.startsWith('<p') && markup.endsWith('</p>'));
    assert.ok(markup.includes(options.sourceCue.label));
    // Copy selected original paragraphs mechanically. Explicit expected cue
    // labels and italic ranges below are separately checked source evidence.
    const text = markup.replace(/^<p[^>]*>/, '').replace(/<\/p>$/, '').replace(/<\/?i>/g, '').split(/<br\s*\/?\s*>/i).map(part => part.replace(/\r\n?/g, '\n').replace(/^[\t\n ]+|[\t\n ]+$/g, '').replace(/[\t ]*\n[\t ]*/g, ' ')).join('\n');
    assert.ok(!/[<>]/.test(text));
    copiedCue = [markup, text, 'scene', { spans: options.sourceCue.spans || [], speakerLabel: options.sourceCue.caption ? null : options.sourceCue.label, caption: Boolean(options.sourceCue.caption) }];
  }
  for (let chapter = 1; chapter <= 44; chapter += 1) {
    const anchor = `chap${String(chapter).padStart(2, '0')}`;
    const blockSpecs = [
      [`<h2><a id="${anchor}"></a>Fixture work ${chapter}</h2>`, `Fixture work ${chapter}`, 'title'],
      ['<h2>ACT I</h2>', 'ACT I', 'act'],
      [`<h3><a id="sceneI_${chapter}.1"></a>SCENE I. Fixture location</h3>`, 'SCENE I. Fixture location', 'scene'],
      [options.classlessCue ? '<p>TESTER.<br>Alpha  &amp; <i>beta</i>&nbsp;<br><br></p>' : '<p class="drama">TESTER.<br>Alpha  &amp; <i>beta</i>&nbsp;<br><br></p>', 'TESTER.\nAlpha  & beta\u00a0\n\n', 'scene'],
      [`<p>Fixture tail ${chapter}.</p>`, `Fixture tail ${chapter}.`, 'scene'],
    ];
    if (options.cueSuffix) {
      blockSpecs[3][0] = blockSpecs[3][0].replace('TESTER.', 'TESTER. x');
      blockSpecs[3][1] = 'TESTER. x\nAlpha  & beta\u00a0\n\n';
      blockSpecs[3][3] = { spans: [{ tag: 'i', start: 19, end: 23 }] };
    }
    if (options.song) {
      blockSpecs[3][0] = blockSpecs[3][0].replace('TESTER.', 'SONG.');
      blockSpecs[3][1] = 'SONG.\nAlpha  & beta\u00a0\n\n';
      blockSpecs[3][3] = { spans: [{ tag: 'i', start: 15, end: 19 }] };
    }
    if (options.collectiveCue) {
      blockSpecs[3][0] = blockSpecs[3][0].replace('TESTER.', 'TESTER. CHECKER.');
      blockSpecs[3][1] = 'TESTER. CHECKER.\nAlpha  & beta\u00a0\n\n';
      blockSpecs[3][3] = { spans: [{ tag: 'i', start: 26, end: 30 }], speakerLabel: 'TESTER. CHECKER.' };
    }
    if (copiedCue) blockSpecs[3] = copiedCue;
    if (options.extraCanonical) blockSpecs.push(
      ['<p>  Inline\r\n   flow  &nbsp;😀 <i>outer <b>inner</b></i>  </p>', 'Inline flow  \u00a0😀 outer inner', 'scene', { spans: [{ tag: 'b', start: 23, end: 28 }, { tag: 'i', start: 17, end: 28 }] }],
      ['<p><i>Italic<br></i></p>', 'Italic\n', 'scene', { spans: [{ tag: 'i', start: 0, end: 7 }] }],
      ['<pre> \n raw  \t&nbsp;<br>\n</pre>', ' \n raw  \t\u00a0\n\n', 'scene'],
      ['<td> Left </td>', 'Left', 'scene', { before: '<table><tbody><tr>', separatorAfter: '\t' }],
      ['<td> Right<br><br></td>', 'Right\n\n', 'scene', { after: '</tr></tbody></table>', separatorAfter: '\n' }],
    );
    const workStart = pieces.join('').length;
    const blocks = [];
    for (const [markup, text, kind, extra = {}] of blockSpecs) {
      if (extra.before) pieces.push(extra.before);
      const start = pieces.join('').length;
      pieces.push(markup);
      blocks.push({ markup, text, kind, start, end: start + markup.length, ...extra });
      if (extra.after) pieces.push(extra.after);
    }
    specs.push({ chapter, anchor, workStart, blocks });
  }
  pieces.push('<section id="pg-footer"><p>Fixture footer</p></section></body></html>');
  const html = pieces.join('');
  const fixtureSource = path.join(root, 'fixture.html');
  fs.writeFileSync(fixtureSource, html);
  const sha256 = crypto.createHash('sha256').update(html).digest('hex');
  const collection = [];
  for (let index = 0; index < fixtureIds.length; index += 1) {
    const id = fixtureIds[index];
    const spec = specs[index + 1];
    const source = { name: 'Project Gutenberg', ebookNumber: 100, sourceFile: 'fixture.html', rights: 'Public domain in the USA', sha256, chapterId: spec.anchor };
    const work = { id, title: `Fixture work ${spec.chapter}` };
    const sectionIds = { title: `${id}-title-0`, act: `${id}-act-${spec.blocks[1].start - spec.workStart}`, scene: `${id}-1-1` };
    const refs = ['title', 'act', 'scene'].map((kind, orderInPlay) => ({
      id: sectionIds[kind], kind, path: kind === 'scene' ? './scenes/act-1-scene-1.json' : `./sections/${kind}.json`,
      act: kind === 'title' ? null : 1, scene: kind === 'scene' ? 1 : null,
      parentSectionId: kind === 'scene' ? sectionIds.act : null,
      orderInPlay: orderInPlay + 1, heading: spec.blocks[orderInPlay].text,
    }));
    const sections = refs.map(ref => ({ schemaVersion: '2.0.0', canonicalTextVersion: '1', contentVersion: '', work, source, section: { ...ref }, content: [] }));
    for (const blockSpec of spec.blocks) {
      const tag = blockSpec.markup.match(/^<(\w+)/)[1];
      const beforeBlock = html.slice(0, blockSpec.start);
      const sourceRef = { start: blockSpec.start, end: blockSpec.end, line: beforeBlock.split(/\r\n|\n|\r/).length, column: blockSpec.start - Math.max(beforeBlock.lastIndexOf('\n'), beforeBlock.lastIndexOf('\r')), path: `${spec.anchor}/${tag}@${blockSpec.start - spec.workStart}`, anchor: blockSpec.kind === 'title' || blockSpec.kind === 'act' ? spec.anchor : `sceneI_${spec.chapter}.1` };
      const blockId = `${id}/${sourceRef.anchor}/${tag}@${blockSpec.start - spec.workStart}`;
      let start = 0;
      const lines = blockSpec.text.split('\n').map((line, lineIndex) => {
        const entry = { id: `${blockId}/line-${lineIndex + 1}`, start, end: start + line.length, sourceLineNumber: null };
        start += line.length + 1;
        return entry;
      });
      const speech = tag === 'p' && (blockSpec.text.startsWith('TESTER.') || Boolean(blockSpec.speakerLabel));
      const block = {
        id: blockId, type: blockSpec.caption ? 'heading' : speech ? 'speech' : /^h/.test(tag) ? 'heading' : 'passage', tag,
        classes: blockSpec.markup.match(/class="([^"]+)"/)?.[1].split(/\s+/) || [], text: blockSpec.text, separatorAfter: blockSpec.separatorAfter || '\n\n',
        spans: blockSpec.spans || (speech ? [{ tag: 'i', start: 17, end: 21 }] : []), lines, sourceRef,
        speakerLabel: speech ? blockSpec.speakerLabel || 'TESTER.' : null,
        attribution: speech ? { status: 'explicit', cueStart: 0, cueEnd: (blockSpec.speakerLabel || 'TESTER.').length } : { status: tag === 'p' && !blockSpec.caption ? 'source-unlabelled' : 'not-applicable' },
      };
      sections.find(section => section.section.kind === blockSpec.kind).content.push(block);
    }
    sections.forEach(section => { section.section.sourceRef = { ...section.content[0].sourceRef }; delete section.section.path; });
    const play = { schemaVersion: '2.0.0', canonicalTextVersion: '1', contentVersion: '', id, title: work.title, fullTitle: work.title, genre: 'Fixture', source, sections: refs, acts: [{ act: 1, scenes: [{ id: sectionIds.scene, scene: 1, path: refs[2].path }] }] };
    collection.push({ play, sections });
  }
  function save() {
    for (const item of collection) {
      const versionFile = path.resolve(__dirname, '../../scripts/contentVersion.js');
      const version = fs.existsSync(versionFile) ? require(versionFile).computeContentVersion(item.play, item.sections) : 'fixture-version';
      item.play.contentVersion = version;
      item.sections.forEach(section => { section.contentVersion = version; });
      const workRoot = path.join(root, 'data', 'plays', item.play.id);
      fs.mkdirSync(workRoot, { recursive: true });
      fs.writeFileSync(path.join(workRoot, 'play.json'), JSON.stringify(item.play));
      for (let index = 0; index < item.sections.length; index += 1) {
        const file = path.join(workRoot, item.play.sections[index].path);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(item.sections[index]));
      }
    }
    const ordered = fixtureCatalogIds.map(id => collection.find(item => item.play.id === id));
    const manifestPlays = ordered.map(({ play }, legacyId) => ({
      id: play.id, legacyId, title: play.title, displayName: play.title, genre: play.genre, difficulty: 1,
      folder: `./plays/${play.id}/`, play: `./plays/${play.id}/play.json`, characters: `./plays/${play.id}/characters.json`, synopsis: `./plays/${play.id}/synopsis.json`, quiz: `./plays/${play.id}/quiz.json`,
      schemaVersion: play.schemaVersion, canonicalTextVersion: play.canonicalTextVersion, contentVersion: play.contentVersion, sections: play.sections,
    }));
    const { computeCollectionVersion } = require('../../scripts/contentVersion');
    const manifest = { version: 'v2', schemaVersion: '2.0.0', canonicalTextVersion: '1', contentVersion: computeCollectionVersion(manifestPlays.map(play => ({ workId: play.id, contentVersion: play.contentVersion }))), plays: manifestPlays };
    fs.writeFileSync(path.join(root, 'data/manifest.json'), JSON.stringify(manifest));
    const imports = ordered.map(({ play }, index) => `const SECTIONS_${index}=[${play.sections.map(ref => `require(${JSON.stringify(`../data/plays/${play.id}/${ref.path.slice(2)}`)})`).join(',')}];`).join('\n');
    const entries = ordered.map(({ play }, index) => `{id:${JSON.stringify(play.id)},slug:${JSON.stringify(play.id)},legacyId:${index},name:${JSON.stringify(play.title)},code:${JSON.stringify(fixtureCodes[index])},difficulty:1,mainImage:require(${JSON.stringify(`../assets/images/${fixtureImages[index]}`)}),medalImage:require(${JSON.stringify(`../assets/medalCollection/m${index === 1 ? 'ANT' : fixtureCodes[index]}.png`)}),play:require(${JSON.stringify(`../data/plays/${play.id}/play.json`)}),characters:require(${JSON.stringify(`../data/plays/${play.id}/characters.json`)}),synopsis:require(${JSON.stringify(`../data/plays/${play.id}/synopsis.json`)}),quiz:require(${JSON.stringify(`../data/plays/${play.id}/quiz.json`)}),sections:SECTIONS_${index},scenes:[SECTIONS_${index}[2]]}`).join(',\n');
    fs.mkdirSync(path.join(root, 'shared'), { recursive: true });
    fs.writeFileSync(path.join(root, 'shared/localPlayRegistry.js'), `${imports}\nconst LOCAL_PLAY_DATA=[${entries}];\nexport default LOCAL_PLAY_DATA;\n`);
  }
  save();
  return { root, sourceFile: fixtureSource, collection, save, cleanup() { fs.rmSync(root, { recursive: true, force: true }); } };
}

test('a complete independently handbuilt structural corpus passes', () => {
  const fixture = makeFixture();
  try {
    const report = validator().validateCollection({ sourceFile: fixture.sourceFile, candidateRoot: fixture.root });
    assert.equal(report.passed, true, JSON.stringify(report.errors.slice(0, 4)));
    assert.equal(report.plays.filter(play => play.passed).length, 38);
  } finally { fixture.cleanup(); }
});

test('classless source paragraphs retain explicit source cue attribution', () => {
  const fixture = makeFixture({ classlessCue: true });
  try {
    const report = validator().validateCollection({ sourceFile: fixture.sourceFile, candidateRoot: fixture.root });
    assert.equal(report.passed, true, JSON.stringify(report.errors.slice(0, 4)));
  } finally { fixture.cleanup(); }
});

test('independent canonicalization preserves whitespace, astral offsets, nested spans, pre and table breaks', () => {
  const fixture = makeFixture({ extraCanonical: true });
  try {
    const report = validator().validateCollection({ sourceFile: fixture.sourceFile, candidateRoot: fixture.root });
    assert.equal(report.passed, true, JSON.stringify(report.errors.slice(0, 4)));
  } finally { fixture.cleanup(); }
});

test('source cues can precede inline directions or prose on their first line', () => {
  const fixture = makeFixture({ cueSuffix: true });
  try {
    const report = validator().validateCollection({ sourceFile: fixture.sourceFile, candidateRoot: fixture.root });
    assert.equal(report.passed, true, JSON.stringify(report.errors.slice(0, 4)));
  } finally { fixture.cleanup(); }
});

test('an uppercase SONG label does not assert a speaker', () => {
  const fixture = makeFixture({ song: true });
  try {
    const report = validator().validateCollection({ sourceFile: fixture.sourceFile, candidateRoot: fixture.root });
    assert.equal(report.passed, true, JSON.stringify(report.errors.slice(0, 4)));
  } finally { fixture.cleanup(); }
});

test('source cue abbreviations and combined labels preserve their complete punctuation', () => {
  const fixture = makeFixture({ collectiveCue: true });
  try {
    const report = validator().validateCollection({ sourceFile: fixture.sourceFile, candidateRoot: fixture.root });
    assert.equal(report.passed, true, JSON.stringify(report.errors.slice(0, 4)));
  } finally { fixture.cleanup(); }
});

for (const fixtureCase of [
  { label: 'GRANDPRÉ.', start: 2021842, end: 2022759 },
  { label: 'ALENÇON.', start: 2102091, end: 2102327 },
  { label: 'MARCADÉ.', start: 3552242, end: 3552301 },
  { label: 'DENNIS', start: 539802, end: 539858 },
  { label: 'BARNARDO', start: 1272147, end: 1272211 },
  { label: 'WOMAN', start: 2752235, end: 2752291, spans: [{ tag: 'i', start: 7, end: 18 }] },
  { label: 'ARIEL', start: 5769522, end: 5769814, spans: [{ tag: 'i', start: 6, end: 225 }] },
  { label: '1 PETITIONER.', start: 2288656, end: 2288835 },
  { label: 'BALTHASAR', start: 4412226, end: 4412598, spans: [{ tag: 'i', start: 11, end: 16 }] },
]) {
  test(`the independently copied source cue ${fixtureCase.label} is explicit Unicode attribution`, () => {
    const fixture = makeFixture({ sourceCue: fixtureCase });
    try {
      const report = validator().validateCollection({ sourceFile: fixture.sourceFile, candidateRoot: fixture.root });
      assert.equal(report.passed, true, JSON.stringify(report.errors.slice(0, 4)));
    } finally { fixture.cleanup(); }
  });
}

test('the copied ARIEL’S SONG. caption does not invent a speaker', () => {
  const fixture = makeFixture({ sourceCue: { label: 'ARIEL’S SONG.', start: 5681754, end: 5681793, caption: true } });
  try {
    const report = validator().validateCollection({ sourceFile: fixture.sourceFile, candidateRoot: fixture.root });
    assert.equal(report.passed, true, JSON.stringify(report.errors.slice(0, 4)));
  } finally { fixture.cleanup(); }
});

const mutations = [
  ['deletion', 'missing-source-occurrence', item => { item.sections[2].content.pop(); }],
  ['alteration', 'text-mismatch', item => { item.sections[2].content[1].text += ' changed'; }],
  ['addition', 'extra-generated-block', item => { const block = structuredClone(item.sections[2].content[2]); block.sourceRef.start = -1; block.id += '/fabricated'; item.sections[2].content.push(block); }],
  ['reordering', 'source-order', item => { item.sections[2].content.reverse(); }],
  ['duplication', 'duplicate-source-occurrence', item => { item.sections[2].content.push(structuredClone(item.sections[2].content[2])); }],
  ['forged provenance', 'source-reference', item => { item.sections[2].content[1].sourceRef.end -= 1; }],
  ['forged inline span', 'formatting-spans', item => { item.sections[2].content[1].spans[0].start += 1; }],
  ['incorrect cue attribution', 'attribution-mismatch', item => { item.sections[2].content[1].speakerLabel = 'OTHER.'; }],
  ['incorrect source block type', 'block-type', item => { item.sections[2].content[1].type = 'stage'; }],
  ['incorrect section ownership', 'section-ownership', item => { item.sections[1].content.push(item.sections[2].content.splice(1, 1)[0]); }],
  ['incorrect section metadata', 'section-ownership', item => { item.sections[2].section.act = 2; }],
  ['forged text reference', 'text-id', item => { item.sections[2].content[1].id = 'invented-id'; }],
  ['incorrect line reference', 'line-reference', item => { item.sections[2].content[1].lines[0].end -= 1; }],
  ['stale section reference', 'section-reference', item => { item.play.sections[2].id = 'stale-section-id'; }],
  ['forged inline class', 'formatting-spans', item => { item.sections[2].content[1].spans[0].className = 'invented'; }],
  ['foreign section source', 'section-schema', item => { item.sections[2].source = { ...item.sections[2].source, chapterId: 'chap03' }; }],
  ['forged play title metadata', 'source-title', item => { item.play.title = 'Altered fixture title'; }],
  ['forged full title metadata', 'source-title', item => { item.play.fullTitle = 'Altered fixture full title'; }],
  ['forged section work title', 'source-title', item => { item.sections[2].work = { ...item.sections[2].work, title: 'Altered fixture work title' }; }],
];

for (const [name, code, mutate] of mutations) {
  test(`independent source comparison rejects ${name} even after refreshing the digest`, () => {
    const fixture = makeFixture();
    try {
      mutate(fixture.collection[0]);
      fixture.save();
      const report = validator().validateCollection({ sourceFile: fixture.sourceFile, candidateRoot: fixture.root });
      assert.equal(report.passed, false, `${name} must fail independently of payload digest`);
      assert.ok(report.errors.some(error => error.code === code), `Expected ${code}; got ${JSON.stringify(report.errors.slice(0, 8))}`);
    } finally { fixture.cleanup(); }
  });
}

test('stale content versions fail before a candidate can be accepted', () => {
  const fixture = makeFixture();
  try {
    const file = path.join(fixture.root, 'data/plays', fixtureIds[0], 'play.json');
    const play = JSON.parse(fs.readFileSync(file, 'utf8'));
    play.contentVersion = 'stale-version';
    fs.writeFileSync(file, JSON.stringify(play));
    const report = validator().validateCollection({ sourceFile: fixture.sourceFile, candidateRoot: fixture.root });
    assert.equal(report.passed, false);
    assert.ok(report.errors.some(error => error.code === 'content-version'));
  } finally { fixture.cleanup(); }
});

test('unreferenced generated section files fail the inventory gate', () => {
  const fixture = makeFixture();
  try {
    const directory = path.join(fixture.root, 'data/plays', fixtureIds[0], 'sections');
    fs.writeFileSync(path.join(directory, 'unreferenced.json'), '{}');
    const report = validator().validateCollection({ sourceFile: fixture.sourceFile, candidateRoot: fixture.root });
    assert.ok(report.errors.some(error => error.code === 'unreferenced-section-file'));
  } finally { fixture.cleanup(); }
});

test('the production source filename remains pinned to the approved raw SHA', () => {
  const fixture = makeFixture();
  try {
    const renamedSource = path.join(fixture.root, 'pg100-images.html');
    fs.copyFileSync(fixture.sourceFile, renamedSource);
    const report = validator().validateCollection({ sourceFile: renamedSource, candidateRoot: fixture.root });
    assert.equal(report.passed, false);
    assert.ok(report.errors.some(error => error.code === 'source-checksum'));
  } finally { fixture.cleanup(); }
});

test('strict CLI writes a reviewable report and exits nonzero on discrepancies', () => {
  const fixture = makeFixture();
  try {
    const file = path.join(fixture.root, 'data/plays', fixtureIds[0], 'play.json');
    fs.unlinkSync(file);
    const reportFile = path.join(fixture.root, 'fidelity-report.json');
    const result = spawnSync(process.execPath, [validatorPath, '--source', fixture.sourceFile, '--candidate', fixture.root, '--report', reportFile, '--strict'], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    assert.equal(report.passed, false);
    assert.ok(report.errors.some(error => error.code === 'missing-play'));
  } finally { fixture.cleanup(); }
});

for (const [name, expectedCode, mutate] of [
  ['a stale manifest work version', 'manifest-content-version', manifest => { manifest.plays[0].contentVersion = 'stale'; }],
  ['a stale manifest section path', 'manifest-reference', manifest => { manifest.plays[0].sections[0].path = './sections/absent.json'; }],
  ['a missing manifest play', 'manifest-inventory', manifest => { manifest.plays.pop(); }],
  ['changed legacy catalog ordering', 'manifest-inventory', manifest => { [manifest.plays[0], manifest.plays[1]] = [manifest.plays[1], manifest.plays[0]]; }],
  ['a stale collection version', 'collection-version', manifest => { manifest.contentVersion = 'stale'; }],
]) {
  test(`strict catalog validation rejects ${name}`, () => {
    const fixture = makeFixture();
    try {
      const file = path.join(fixture.root, 'data/manifest.json');
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
      mutate(manifest);
      fs.writeFileSync(file, JSON.stringify(manifest));
      const report = validator().validateCollection({ sourceFile: fixture.sourceFile, candidateRoot: fixture.root });
      assert.equal(report.passed, false);
      assert.ok(report.errors.some(error => error.code === expectedCode), JSON.stringify(report.errors.slice(0, 4)));
    } finally { fixture.cleanup(); }
  });
}

test('static registry section imports must exactly follow the validated play references', () => {
  const fixture = makeFixture();
  try {
    const file = path.join(fixture.root, 'shared/localPlayRegistry.js');
    const source = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, source.replace('../data/plays/alls-well-that-ends-well/scenes/act-1-scene-1.json', '../data/plays/alls-well-that-ends-well/scenes/act-1-scene-99.json'));
    const report = validator().validateCollection({ sourceFile: fixture.sourceFile, candidateRoot: fixture.root });
    assert.equal(report.passed, false);
    assert.ok(report.errors.some(error => error.code === 'registry-reference'));
  } finally { fixture.cleanup(); }
});

test('an unreferenced registry import cannot pull development source into the runtime bundle', () => {
  const fixture = makeFixture();
  try {
    const file = path.join(fixture.root, 'shared/localPlayRegistry.js');
    fs.appendFileSync(file, '\nconst UNUSED_SOURCE=[require("../data/source/pg100-images.html")];\n');
    const report = validator().validateCollection({ sourceFile: fixture.sourceFile, candidateRoot: fixture.root });
    assert.equal(report.passed, false);
    assert.ok(report.errors.some(error => error.code === 'registry-reference'));
  } finally { fixture.cleanup(); }
});

for (const field of ['mainImage', 'medalImage']) {
  for (const [name, expression] of [
    ['development source require', 'require("../data/source/pg100-images.html")'],
    ['executable expression', '(()=>require("../data/source/pg100-images.html"))()'],
    ['require with an extra executable argument', 'require("../assets/images/AWWimage.png",require("../data/source/pg100-images.html"))'],
    ['another work’s asset', 'require("../assets/images/Hamimage.png")'],
  ]) {
    test(`static registry rejects ${field} containing ${name}`, () => {
      const fixture = makeFixture();
      try {
        const file = path.join(fixture.root, 'shared/localPlayRegistry.js');
        const source = fs.readFileSync(file, 'utf8');
        const matcher = new RegExp(`${field}:require\\("[^"]+"\\)`);
        assert.ok(matcher.test(source));
        fs.writeFileSync(file, source.replace(matcher, `${field}:${expression}`));
        const report = validator().validateCollection({ sourceFile: fixture.sourceFile, candidateRoot: fixture.root });
        assert.equal(report.passed, false);
        assert.ok(report.errors.some(error => error.code === 'registry-reference' && error.message.includes(field)));
      } finally { fixture.cleanup(); }
    });
  }
}

test('five reviewed mixed case cues are independently checked against the pinned raw paragraphs', () => {
  const fixture = makeFixture();
  try {
    const raw = fs.readFileSync(sourceFile, 'utf8');
    const cases = [
      ['hamlet-prince-of-denmark', 1293313, 1293368, 'Both.'],
      ['hamlet-prince-of-denmark', 1395568, 1395630, 'All.'],
      ['hamlet-prince-of-denmark', 1444925, 1444984, 'Danes.'],
      ['hamlet-prince-of-denmark', 1482056, 1482105, 'All.'],
      ['the-merry-wives-of-windsor', 4133324, 4133396, 'SHALLOW, PAGE, etc.'],
    ];
    const blocks = [];
    for (const [id, start, end, label] of cases) {
      const item = fixture.collection.find(item => item.play.id === id);
      const rawParagraph = raw.slice(start, end);
      assert.ok(rawParagraph.includes(`${label}<br>`));
      const text = rawParagraph.replace(/^<p[^>]*>/, '').replace(/<\/p>$/, '').split('<br>').map(part => part.replace(/^[\t\r\n ]+|[\t\r\n ]+$/g, '')).join('\n');
      const block = structuredClone(item.sections[2].content[1]);
      Object.assign(block, { text, spans: [], speakerLabel: label, attribution: { status: 'explicit', cueStart: 0, cueEnd: label.length, evidence: 'reviewed-source-cue' } });
      block.sourceRef.start = start;
      block.sourceRef.end = end;
      item.sections[2].content.push(block);
      blocks.push({ id, start, block });
    }
    fixture.save();
    const report = validator().validateCollection({ sourceFile, candidateRoot: fixture.root });
    // The rest of this small structural candidate intentionally differs from
    // the real corpus. These checks isolate source-backed attribution at each
    // exact independently reviewed raw occurrence.
    for (const { id, start } of blocks) {
      const errors = report.plays.find(play => play.id === id).errors;
      assert.ok(!errors.some(error => error.code === 'attribution-mismatch' && error.location.start === start), `Printed mixed case cue at ${start} must be recognized.`);
    }
    for (const { block } of blocks) block.speakerLabel = 'INCORRECT REVIEWED LABEL.';
    fixture.save();
    const changed = validator().validateCollection({ sourceFile, candidateRoot: fixture.root });
    for (const { id, start } of blocks) assert.ok(changed.plays.find(play => play.id === id).errors.some(error => error.code === 'attribution-mismatch' && error.location.start === start));
  } finally { fixture.cleanup(); }
});
