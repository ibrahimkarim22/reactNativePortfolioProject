const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const test = require('node:test');
const babel = require('@babel/core');
const root = path.resolve(__dirname, '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data/manifest.json'), 'utf8'));

function entries() {
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  return manifest.plays.map(entry => {
    const playFile = path.resolve(root, 'data', entry.play), play = read(playFile);
    return { slug: entry.id, legacyId: entry.legacyId, name: entry.displayName,
      play, synopsis: read(path.resolve(root, 'data', entry.synopsis)),
      sections: play.sections.map(section => read(path.resolve(path.dirname(playFile), section.path))) };
  });
}

function service(data) {
  const file = path.join(root, 'shared/localPlayService.js');
  const code = fs.readFileSync(file, 'utf8')
    .replace(/import LOCAL_PLAY_DATA from [^;]+;/, 'const LOCAL_PLAY_DATA = entries;')
    .replace(/export const (\w+)/g, 'const $1');
  return vm.runInThisContext('(function(require,entries){' + code
    + '\nreturn {getLocalSynopsis,getSynopsisHtml};})')(createRequire(file), data);
}

test('missing synopsis IDs cannot silently select the first bundled work', () => {
  const local = service([require('../fixtures/synopsisFixture.cjs')()]);
  for (const invalid of [undefined, null, '', {}, 'unknown-play', NaN]) {
    assert.throws(() => local.getLocalSynopsis(invalid), /unavailable/);
    assert.throws(() => local.getSynopsisHtml(invalid), /unavailable/);
  }
});

test('all 38 IDs and legacy aliases resolve the same authored synopsis through the actual local service', () => {
  const data = entries(), local = service(data);
  for (const entry of data) {
    const canonical = local.getLocalSynopsis(entry.slug);
    const alias = local.getLocalSynopsis(entry.legacyId);
    assert.equal(canonical.workId, entry.slug);
    assert.equal(canonical.title, entry.name);
    assert.deepEqual(alias, canonical);
    assert.equal(canonical.introduction, entry.synopsis.introduction);
    assert.equal(canonical.fullSynopsis, entry.synopsis.fullSynopsis);
    assert.equal(canonical.summarySections.length, entry.synopsis.acts.length + entry.synopsis.framing.length);
    const html = local.getSynopsisHtml(entry.slug);
    assert.equal((html.match(/<h1>/g) || []).length, 1);
    assert.doesNotMatch(html, /not been written|<script|<iframe|https?:\/\//i);
  }
  for (const invalid of [undefined, null, '', {}, 'unknown-play', NaN]) {
    assert.throws(() => local.getLocalSynopsis(invalid), /unavailable/);
  }
});

test('the existing Synopsis list exposes every catalogue work, uses its cover and navigates with its exact ID', () => {
  const { synopsisUIHost, nodes } = require('../fixtures/synopsisUIHost.cjs');
  const plays = manifest.plays.map(entry => ({ id: entry.id, name: entry.displayName, title: entry.title, genre: entry.genre,
    mainImage: 'cover:' + entry.id, medalImage: 'medal:' + entry.id }));
  const h = synopsisUIHost({ screen: 'screens/SynopsisList.js', entries: entries(), plays });
  const buttons = nodes(h.render(), 'Pressable').filter(node => node.props.accessibilityLabel?.endsWith(' synopsis'));
  assert.equal(buttons.length, 38);
  const opened = [];
  buttons.forEach(button => {
    const play = plays.find(p => button.props.accessibilityLabel === p.name + ' synopsis');
    assert.ok(play);
    assert.equal(nodes(button, 'Image')[0].props.source, play.mainImage);
    button.props.onPress(); opened.push(play.id);
  });
  assert.deepEqual(h.calls.filter(call => call[0] === 'Synopsis'), opened.map(id => ['Synopsis', { id }]));
  assert.deepEqual([...new Set(opened)].sort(), manifest.plays.map(p => p.id).sort());
  assert.equal(h.button('All').props.accessibilityState.selected, true);
  nodes(h.render(), 'TextInput')[0].props.onChangeText('macbeth');
  assert.equal(h.button('The Scottish Play synopsis') !== undefined, true, 'the existing source title remains searchable');
});
