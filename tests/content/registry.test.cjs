const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');

const repository = path.resolve(__dirname, '../..');
const scriptFile = path.join(repository, 'scripts/generateLocalPlayRegistry.js');

test('importing the registry generator does not write generated files', () => {
  const writes = [];
  const source = fs.readFileSync(scriptFile, 'utf8');
  const module = { exports: {} };
  const protectedFs = { ...fs, writeFileSync: (...args) => writes.push(args[0]) };
  const fromScript = createRequire(scriptFile);
  const localRequire = (name) => name === 'fs' ? protectedFs : fromScript(name);
  localRequire.main = {};
  const run = vm.runInThisContext('(function(require,module,exports,__dirname){' + source + '\n})');
  run(localRequire, module, module.exports, path.dirname(scriptFile));
  assert.deepEqual(writes, [], 'imports must leave production data and registry untouched');
});

function makeCandidate(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bard-registry-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataRoot = path.join(root, 'data');
  const output = path.join(root, 'review/shared/localPlayRegistry.js');
  const copiedScript = path.join(root, 'scripts/generateLocalPlayRegistry.js');
  fs.mkdirSync(path.dirname(copiedScript), { recursive: true });
  fs.mkdirSync(path.join(root, 'shared'), { recursive: true });
  fs.copyFileSync(scriptFile, copiedScript);
  // This isolates legacy default writes too, so the red CLI test cannot touch production.
  for (const helper of ['contentVersion.js']) {
    if (fs.existsSync(path.join(repository, 'scripts', helper))) {
      fs.copyFileSync(path.join(repository, 'scripts', helper), path.join(root, 'scripts', helper));
    }
  }
  const slugs = fs.readdirSync(path.join(repository, 'data/plays')).sort();
  for (const slug of slugs) {
    const original = path.join(repository, 'data/plays', slug);
    const target = path.join(dataRoot, 'plays', slug);
    fs.mkdirSync(path.join(target, 'scenes'), { recursive: true });
    fs.mkdirSync(path.join(target, 'sections'), { recursive: true });
    for (const name of ['characters.json', 'synopsis.json', 'quiz.json']) {
      fs.copyFileSync(path.join(original, name), path.join(target, name));
    }
    const play = JSON.parse(fs.readFileSync(path.join(original, 'play.json'), 'utf8'));
    play.schemaVersion = '2.0.0';
    play.canonicalTextVersion = '1';
    play.contentVersion = crypto.createHash('sha256').update(slug).digest('hex');
    play.acts = [{ act: 1, scenes: [{ id: slug + '-1-1', scene: 1, path: './scenes/act-1-scene-1.json' }] }];
    play.sections = [
      { id: slug + '-prologue', kind: 'prologue', path: './sections/z-prologue.json', act: null, scene: null, parentSectionId: null, orderInPlay: 1, heading: 'PROLOGUE.' },
      { id: slug + '-1-1', kind: 'scene', path: './scenes/act-1-scene-1.json', act: 1, scene: 1, parentSectionId: null, orderInPlay: 2, heading: '' },
      { id: slug + '-epilogue', kind: 'epilogue', path: './sections/a-epilogue.json', act: null, scene: null, parentSectionId: null, orderInPlay: 3, heading: 'EPILOGUE.' },
    ];
    for (const ref of play.sections) {
      fs.writeFileSync(path.join(target, ref.path), JSON.stringify({ schemaVersion: '2.0.0', canonicalTextVersion: '1', contentVersion: play.contentVersion, work: { id: slug }, section: ref, content: [] }));
    }
    fs.writeFileSync(path.join(target, 'play.json'), JSON.stringify(play));
    fs.writeFileSync(path.join(target, 'scenes/act-99-scene-99.json'), '{}');
  }
  return { root, dataRoot, output, copiedScript };
}

function runCandidate(candidate, extra = []) {
  return spawnSync(process.execPath, [candidate.copiedScript, '--data-root', candidate.dataRoot, '--output', candidate.output, '--assets-root', path.join(repository, 'assets'), ...extra], { encoding: 'utf8' });
}

function readRegistry(file, dataRoot) {
  const source = fs.readFileSync(file, 'utf8').replace(/export default LOCAL_PLAY_DATA;/, 'module.exports = LOCAL_PLAY_DATA;');
  const module = { exports: {} };
  const loaded = [];
  const read = (request) => {
    loaded.push(request);
    if (request.startsWith('../assets/')) return request;
    assert.ok(request.startsWith('../data/'), 'portable runtime data paths');
    return JSON.parse(fs.readFileSync(path.join(dataRoot, request.slice('../data/'.length)), 'utf8'));
  };
  vm.runInThisContext('(function(require,module){' + source + '\n})')(read, module);
  return { entries: module.exports, loaded, source };
}

test('candidate CLI imports authoritative section refs once in source order and preserves reader metadata', (t) => {
  const candidate = makeCandidate(t);
  const result = runCandidate(candidate);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(candidate.output), 'explicit --output must receive the registry');
  const registry = readRegistry(candidate.output, candidate.dataRoot);
  assert.equal(registry.entries.length, 38);
  const henry = registry.entries.find((entry) => entry.slug === 'king-henry-the-fifth');
  assert.deepEqual(henry.sections.map((item) => item.section.kind), ['prologue', 'scene', 'epilogue']);
  assert.equal(henry.scenes.length, 1);
  assert.equal(henry.scenes[0], henry.sections[1], 'scene projection reuses its section import');
  assert.equal(registry.loaded.filter((ref) => ref.endsWith('/king-henry-the-fifth/scenes/act-1-scene-1.json')).length, 1);
  assert.equal(registry.loaded.some((ref) => ref.includes('act-99-scene-99')), false, 'unreferenced stale files never enter the app');
  assert.deepEqual([henry.legacyId, henry.name, henry.code, henry.difficulty], [10, 'Henry V', 'H5', 14]);
  assert.ok(registry.loaded.includes('../assets/medalCollection/mANT.png'), 'runtime asset path matches tracked case');
  assert.equal(registry.source.includes(candidate.root), false, 'temp paths never enter runtime imports');
  const manifest = JSON.parse(fs.readFileSync(path.join(candidate.dataRoot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, '2.0.0');
  assert.equal(manifest.canonicalTextVersion, '1');
  assert.match(manifest.contentVersion, /^[a-f0-9]{64}$/);
  const ref = manifest.plays.find((play) => play.id === henry.slug);
  assert.equal(ref.contentVersion, henry.play.contentVersion);
  assert.deepEqual(ref.sections, henry.play.sections);
  const pairs = manifest.plays.map(play => [play.id, play.contentVersion]);
  assert.equal(manifest.contentVersion, crypto.createHash('sha256').update(JSON.stringify(pairs)).digest('hex'), 'collection version covers ordered work/version pairs');
  const firstBytes = fs.readFileSync(candidate.output);
  const firstManifest = fs.readFileSync(path.join(candidate.dataRoot, 'manifest.json'));
  assert.equal(runCandidate(candidate).status, 0);
  assert.deepEqual(fs.readFileSync(candidate.output), firstBytes);
  assert.deepEqual(fs.readFileSync(path.join(candidate.dataRoot, 'manifest.json')), firstManifest);
  for (const entry of registry.entries) {
    for (const file of ['characters.json', 'synopsis.json', 'quiz.json']) {
      assert.deepEqual(fs.readFileSync(path.join(candidate.dataRoot, 'plays', entry.slug, file)), fs.readFileSync(path.join(repository, 'data/plays', entry.slug, file)), 'support bytes remain unchanged');
    }
  }
});

test('candidate CLI fails before writing when a section reference is missing or unsafe', (t) => {
  const candidate = makeCandidate(t);
  fs.unlinkSync(path.join(candidate.dataRoot, 'plays/king-henry-the-fifth/sections/z-prologue.json'));
  const missing = runCandidate(candidate);
  assert.notEqual(missing.status, 0, 'missing source-ordered section imports are rejected');
  assert.match(missing.stderr, /king-henry-the-fifth.*z-prologue|z-prologue.*king-henry-the-fifth/);
  assert.equal(fs.existsSync(candidate.output), false);
  const playFile = path.join(candidate.dataRoot, 'plays/king-henry-the-fifth/play.json');
  const play = JSON.parse(fs.readFileSync(playFile, 'utf8'));
  play.sections[0].path = '../outside.json';
  fs.writeFileSync(playFile, JSON.stringify(play));
  const unsafe = runCandidate(candidate);
  assert.notEqual(unsafe.status, 0, 'a play cannot import content outside its folder');
  assert.match(unsafe.stderr, /outside|unsafe|path/i);
});

test('candidate CLI rejects stale section identity and ordinary scene aliases', (t) => {
  const candidate = makeCandidate(t);
  const folder = path.join(candidate.dataRoot, 'plays/king-henry-the-fifth');
  const sectionFile = path.join(folder, 'sections/z-prologue.json');
  const section = JSON.parse(fs.readFileSync(sectionFile, 'utf8'));
  section.contentVersion = 'stale';
  fs.writeFileSync(sectionFile, JSON.stringify(section));
  const stale = runCandidate(candidate);
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /Stale section reference/);
  const playFile = path.join(folder, 'play.json');
  const play = JSON.parse(fs.readFileSync(playFile, 'utf8'));
  section.contentVersion = play.contentVersion;
  fs.writeFileSync(sectionFile, JSON.stringify(section));
  play.acts[0].scenes[0].id = 'stale-scene-alias';
  fs.writeFileSync(playFile, JSON.stringify(play));
  const alias = runCandidate(candidate);
  assert.notEqual(alias.status, 0);
  assert.match(alias.stderr, /Stale ordinary scene reference/);
  assert.equal(fs.existsSync(candidate.output), false);
});

test('external asset roots enforce exact import case on case-insensitive hosts', (t) => {
  const candidate = makeCandidate(t);
  const assets = path.join(candidate.root, 'external-assets');
  for (const folder of ['images', 'medalCollection']) {
    fs.mkdirSync(path.join(assets, folder), { recursive: true });
    for (const file of fs.readdirSync(path.join(repository, 'assets', folder))) {
      if (fs.statSync(path.join(repository, 'assets', folder, file)).isFile()) fs.writeFileSync(path.join(assets, folder, file), '');
    }
  }
  const medalFolder = path.join(assets, 'medalCollection');
  const actual = fs.readdirSync(medalFolder).find(name => name.toLowerCase() === 'mant.png');
  fs.renameSync(path.join(medalFolder, actual), path.join(medalFolder, 'antony-case.tmp'));
  fs.renameSync(path.join(medalFolder, 'antony-case.tmp'), path.join(medalFolder, 'mAnt.png'));
  const wrong = runCandidate(candidate, ['--assets-root', assets]);
  assert.notEqual(wrong.status, 0);
  assert.match(wrong.stderr, /incorrect path case.*mANT\.png/);
  fs.renameSync(path.join(medalFolder, 'mAnt.png'), path.join(medalFolder, 'antony-case.tmp'));
  fs.renameSync(path.join(medalFolder, 'antony-case.tmp'), path.join(medalFolder, 'mANT.png'));
  const corrected = runCandidate(candidate, ['--assets-root', assets]);
  assert.equal(corrected.status, 0, corrected.stderr);
});

test('legacy plays keep ordinary scenes from explicit acts rather than directory scanning', (t) => {
  const candidate = makeCandidate(t);
  for (const slug of fs.readdirSync(path.join(candidate.dataRoot, 'plays'))) {
    const file = path.join(candidate.dataRoot, 'plays', slug, 'play.json');
    const play = JSON.parse(fs.readFileSync(file, 'utf8'));
    play.schemaVersion = '1.0.0';
    delete play.sections;
    delete play.contentVersion;
    delete play.canonicalTextVersion;
    fs.writeFileSync(file, JSON.stringify(play));
  }
  const result = runCandidate(candidate);
  assert.equal(result.status, 0, result.stderr);
  const registry = readRegistry(candidate.output, candidate.dataRoot);
  assert.ok(registry.entries.every(entry => entry.scenes.length === 1));
  assert.equal(registry.loaded.some(ref => ref.includes('act-99-scene-99')), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(candidate.dataRoot, 'manifest.json'), 'utf8')).version, 'v1');
});
