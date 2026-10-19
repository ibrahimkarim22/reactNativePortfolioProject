const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const cheerio = require('cheerio');
const { createRequire } = require('node:module');

const repository = path.resolve(__dirname, '../..');
const serviceFile = path.join(repository, 'shared/localPlayService.js');
const rawSource = fs.readFileSync(path.join(repository, 'data/source/pg100-images.html'), 'utf8').replace(/\r\n?/g, '\n');

function service(entries) {
  // Run the actual service module without loading React Native or the production registry.
  const source = fs.readFileSync(serviceFile, 'utf8')
    .replace(/import LOCAL_PLAY_DATA from [^;]+;/, 'const LOCAL_PLAY_DATA = injectedEntries;')
    .replace(/export const (\w+)/g, 'const $1');
  const exports = ['PLAYS', 'getLocalPlayEntry', 'getLocalPlay', 'getCharactersHtml', 'getSynopsisHtml', 'getFullPlayHtml'];
  const factory = vm.runInThisContext('(function(require,injectedEntries){' + source + '\nreturn {' + exports.join(',') + '};})');
  return factory(createRequire(serviceFile), entries);
}

function sourceText(text, html) {
  assert.ok(rawSource.includes(html), 'reader fixture must be present in the immutable raw source');
  return text;
}

function block(id, text, tag = 'p', spans = []) {
  return { id, type: 'paragraph', tag, classes: [], text, separatorAfter: '\n\n', spans, lines: [], sourceRef: { fixture: true }, speakerLabel: null, attribution: { status: 'not-applicable' } };
}

function schemaTwoEntry() {
  const workId = 'king-henry-the-fifth';
  const sections = [
    { section: { id: 'front', kind: 'frontmatter', heading: 'ignored metadata heading', orderInPlay: 1 }, content: [
      block('title', sourceText('THE LIFE OF KING HENRY THE FIFTH', 'THE LIFE OF KING HENRY THE FIFTH'), 'h2'),
      block('cast-heading', sourceText('Dramatis Personæ', 'Dramatis Personæ'), 'h3'),
      block('cast', sourceText('CHORUS.', '<p>CHORUS.</p>')),
    ] },
    { section: { id: 'prologue', kind: 'prologue', heading: 'PROLOGUE.', orderInPlay: 2 }, content: [
      block('prologue-heading', sourceText('PROLOGUE.', '<b>PROLOGUE.</b>'), 'h3', [{ tag: 'b', start: 0, end: 9 }]),
      block('prologue-entry', sourceText('Enter Chorus.', 'Enter <span class="charname">Chorus</span>.'), 'p', [{ tag: 'span', className: 'charname', start: 6, end: 12 }]),
      { ...block('prologue-cue', sourceText('CHORUS.\nO for a Muse of fire, that would ascend\nThe brightest heaven of invention,', '<p>CHORUS.<br>\nO for a Muse of fire, that would ascend<br>\nThe brightest heaven of invention,<br>')), speakerLabel: 'CHORUS.', attribution: { status: 'explicit' } },
    ] },
    { section: { id: workId + '-1-1', kind: 'scene', heading: '', act: 1, scene: 1, orderInPlay: 3 }, content: [
      { ...block('scene-cue', sourceText('ELY.\nBut how, my lord, shall we resist it now?', '<p>ELY.<br>\nBut how, my lord, shall we resist it now?\n</p>')), speakerLabel: 'ELY.', attribution: { status: 'explicit' } },
      block('exit', sourceText('[Exit.]', '[<i>Exit.</i>]'), 'p', [{ tag: 'i', start: 1, end: 6 }]),
    ] },
    { section: { id: 'epilogue', kind: 'epilogue', heading: 'EPILOGUE.', orderInPlay: 4 }, content: [
      block('epilogue-heading', sourceText('EPILOGUE.', '<b>EPILOGUE.</b>'), 'h3', [{ tag: 'b', start: 0, end: 9 }]),
      block('epilogue-cue', sourceText('CHORUS.\nThus far, with rough and all-unable pen,', '<p>CHORUS.<br>\nThus far, with rough and all-unable pen,<br>')),
    ] },
  ].map((section) => ({ schemaVersion: '2.0.0', canonicalTextVersion: '1', contentVersion: 'fixture-version', work: { id: workId }, ...section }));
  sections.at(-1).content.at(-1).separatorAfter = '';
  const refs = sections.map(({ section }) => ({ ...section, path: './' + section.id + '.json' }));
  return { slug: workId, legacyId: 10, name: 'Henry V', code: 'H5', difficulty: 14, mainImage: 2, medalImage: 3, play: { id: workId, schemaVersion: '2.0.0', canonicalTextVersion: '1', contentVersion: 'fixture-version', title: 'The Life of King Henry the Fifth', genre: 'History', acts: [{ act: 1, scenes: [{ id: workId + '-1-1' }] }], sections: refs }, characters: { characters: [{ displayName: 'Legacy cast must not prefix schema 2' }] }, quiz: { questions: [{ question: 'Support fixture' }] }, synopsis: {}, sections, scenes: [sections[2]] };
}

function htmlProjection(html) {
  const $ = cheerio.load('<main>' + html + '</main>');
  const blockTags = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'blockquote']);
  const project = node => {
    if (node.type === 'text') return node.data;
    if (node.name === 'br') return '\n';
    const children = (node.children || []).map(project).join('');
    return children + (blockTags.has(node.name) ? '\n\n' : '');
  };
  const children = $('main').contents().toArray();
  const result = children.map(project).join('');
  return blockTags.has(children.at(-1)?.name) ? result.slice(0, -2) : result;
}

test('the combined schema-2 reader output includes every source section once, with raw cues and inline spans', () => {
  const entry = schemaTwoEntry();
  const reader = service([entry]);
  const html = reader.getCharactersHtml('H5') + reader.getFullPlayHtml('H5');
  const expected = 'THE LIFE OF KING HENRY THE FIFTH\n\nDramatis Personæ\n\nCHORUS.\n\nPROLOGUE.\n\nEnter Chorus.\n\nCHORUS.\nO for a Muse of fire, that would ascend\nThe brightest heaven of invention,\n\nELY.\nBut how, my lord, shall we resist it now?\n\n[Exit.]\n\nEPILOGUE.\n\nCHORUS.\nThus far, with rough and all-unable pen,';
  assert.equal(reader.getCharactersHtml('H5'), '', 'the full play owns canonical cast position');
  assert.equal(htmlProjection(html), expected);
  assert.match(html, /<b>PROLOGUE\.<\/b>/);
  assert.match(html, /\[<i>Exit\.<\/i>\]/);
  assert.match(html, /Enter <span class="charname">Chorus<\/span>\./);
  assert.match(html, /ELY\.<br\s*\/?>(?:\n)?But how/);
  assert.equal(html.includes('ignored metadata heading'), false);
  assert.deepEqual(reader.getLocalPlay(10), reader.PLAYS[0]);
  assert.deepEqual([reader.PLAYS[0].id, reader.PLAYS[0].name, reader.PLAYS[0].genre, reader.PLAYS[0].difficulty, reader.PLAYS[0].mainImage, reader.PLAYS[0].medalImage], [entry.slug, 'Henry V', 'History', 14, 2, 3]);
  assert.deepEqual(reader.PLAYS[0].quiz, entry.quiz.questions);
  assert.deepEqual(reader.PLAYS[0].acts, entry.play.acts);
});

test('schema-2 rendering escapes text and retains explicit consecutive and trailing breaks', () => {
  const entry = schemaTwoEntry();
  // Deliberately non-literary input tests markup safety, not a Shakespeare passage.
  entry.sections = [{ schemaVersion: '2.0.0', section: { id: 'safety', kind: 'frontmatter' }, content: [block('safety', '& <fixture> "\'\n\nend\n')] }];
  const html = service([entry]).getFullPlayHtml(entry.slug);
  assert.equal(htmlProjection(html), '& <fixture> "\'\n\nend\n');
  assert.match(html, /&amp; &lt;fixture&gt; &quot;&#39;<br\s*\/?>\s*<br\s*\/?>end<br\s*\/?>/);
  assert.equal(html.includes('<fixture>'), false);
});

test('legacy schema-1 character and scene HTML remains available', () => {
  const play = { id: 'king-henry-the-fifth', schemaVersion: '1.0.0', title: 'The Life of King Henry the Fifth', genre: 'History', acts: [] };
  const scene = { schemaVersion: '1.0.0', scene: { label: 'Act 1, Scene 1' }, content: [{ type: 'speech', speaker: { name: 'ELY', displayName: 'Ely' }, lines: [{ text: sourceText('But how, my lord, shall we resist it now?', 'But how, my lord, shall we resist it now?') }] }] };
  const reader = service([{ slug: play.id, legacyId: 10, name: 'Henry V', code: 'H5', difficulty: 14, play, characters: { characters: [{ displayName: 'Canterbury' }] }, scenes: [scene] }]);
  assert.match(reader.getCharactersHtml(10), /<li>Canterbury<\/li>/);
  assert.match(reader.getFullPlayHtml(10), /<h1>Henry V<\/h1>/);
  assert.match(reader.getFullPlayHtml(10), /<b>Ely<\/b>/);
  assert.match(reader.getFullPlayHtml(10), /But how, my lord, shall we resist it now\?/);
  assert.throws(() => reader.getFullPlayHtml('missing'), /Play not found/);
});

test('source table cells retain tabs, row breaks, and a following paragraph boundary', () => {
  const entry = schemaTwoEntry();
  const first = block('cell-one', sourceText('ACT I', '<td> ACT I</td>'), 'td');
  first.separatorAfter = '\t';
  const second = block('cell-two', sourceText('Chorus.', '>Chorus.</a>'), 'td');
  second.separatorAfter = '\n';
  const third = block('cell-three', sourceText('ACT V', '<td> ACT V</td>'), 'td');
  third.separatorAfter = '\n\n';
  const last = block('last', sourceText('CHORUS.', '<p>CHORUS.</p>'));
  last.separatorAfter = '';
  entry.sections = [{ schemaVersion: '2.0.0', section: { id: 'table', kind: 'frontmatter' }, content: [first, second, third, last] }];
  assert.equal(htmlProjection(service([entry]).getFullPlayHtml(entry.slug)), 'ACT I\tChorus.\nACT V\n\nCHORUS.');
});
