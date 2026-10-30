const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');
const root = path.resolve(__dirname, '../..');

function catalogue() {
  const file = path.join(root, 'shared/localPlayRegistry.js');
  const code = babel.transformFileSync(file, { babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-modules-commonjs'] }).code;
  const module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: file })(name => {
    const resolved = path.resolve(path.dirname(file), name);
    return resolved.endsWith('.json') ? JSON.parse(fs.readFileSync(resolved, 'utf8')) : path.relative(root, resolved).replaceAll('\\', '/');
  }, module, module.exports);
  return module.exports.default.map(entry => ({ id: entry.slug, name: entry.name, difficulty: entry.difficulty,
    genre: entry.play?.genre || entry.genre, medalImage: entry.medalImage }));
}
const plays = catalogue();
const helper = () => require('../../course/medalCollection').getMedalCollection;

test('all 38 catalogue medal mappings use unique existing artwork with exact capitalization', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data/manifest.json'), 'utf8'));
  const files = fs.readdirSync(path.join(root, 'assets/medalCollection'));
  assert.equal(plays.length, 38); assert.equal(files.length, 38);
  assert.deepEqual(plays.map(p => p.id).sort(), manifest.plays.map(p => p.id).sort());
  assert.equal(new Set(plays.map(p => p.medalImage)).size, 38);
  for (const play of plays) {
    assert.match(play.medalImage, /^assets\/medalCollection\/[^/]+\.png$/);
    assert.ok(files.includes(path.basename(play.medalImage)), play.medalImage);
    const bytes = fs.readFileSync(path.join(root, play.medalImage));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  }
  assert.equal(plays.find(p => p.id === 'a-midsummer-nights-dream').medalImage, 'assets/medalCollection/mMND.png');
});

test('earned medals count actual catalogue entries without clamping the confirmed level or inventing level 34', () => {
  const get = helper();
  for (const [level, count] of [[0, 0], [1, 1], [33, 33], [34, 33], [38, 37], [39, 38]]) {
    const collection = get(plays, level);
    assert.equal(collection.earnedCount, count, `confirmed level ${level}`);
    assert.equal(collection.total, 38);
    assert.equal(collection.completion, count / 38);
    assert.equal(collection.items.some(item => item.play.difficulty === 34), false);
    assert.equal(collection.items.find(item => item.play.id === 'king-henry-the-eighth').earned, level >= 39);
  }
  assert.deepEqual(plays.map(p => p.difficulty).sort((a, b) => a - b), [...Array.from({ length: 33 }, (_, i) => i + 1), 35, 36, 37, 38, 39]);
});

test('invalid progress awards nothing and collection derivation does not mutate the catalogue', () => {
  const get = helper(), original = JSON.stringify(plays);
  for (const level of [null, undefined, '39', -1, 1.5, NaN, Infinity]) assert.equal(get(plays, level).earnedCount, 0);
  const collection = get(plays, 39);
  assert.equal(JSON.stringify(plays), original);
  assert.equal(collection.items[0].play.id, 'a-midsummer-nights-dream');
  assert.equal(collection.items.at(-1).play.id, 'king-henry-the-eighth');
  assert.equal(get([], 39).completion, 0);
});

const nodes = (tree, type) => !tree || typeof tree !== 'object' ? [] : [
  ...(tree.type === type ? [tree] : []), ...(tree.props?.children || []).flat(Infinity).flatMap(child => nodes(child, type)),
];
const text = tree => typeof tree === 'string' || typeof tree === 'number' ? String(tree) : !tree || typeof tree !== 'object'
  ? '' : (tree.props?.children || []).flat(Infinity).map(text).join(' ');
const flatten = style => Object.assign({}, ...[style].flat(Infinity).filter(value => value && typeof value === 'object'));
const blurRadius = style => Number(String(flatten(style).filter || '').match(/\bblur\(\s*(\d+(?:\.\d+)?)px\s*\)/)?.[1] || 0);
const cardFor = (tree, play) => nodes(tree, 'Pressable').find(node => node.props.accessibilityLabel.includes(play.name));

function component(file, dimensions = { width: 411, fontScale: 1 }) {
  const React = { createElement(type, props, ...children) { const next = { ...props, children }; return typeof type === 'function' ? type(next) : { type, props: next }; } };
  const native = { View: 'View', Text: 'Text', Pressable: 'Pressable', Image: 'Image', useWindowDimensions: () => dimensions, StyleSheet: { create: value => value } };
  const code = babel.transformFileSync(path.join(root, file), { babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
  const module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: file })(name => {
    if (name === 'react') return React;
    if (name === 'react-native') return native;
    if (name === './MedalArtwork') return { __esModule: true, default: 'MedalArtwork' };
    if (name === './LockedMedal') return { __esModule: true, default: 'LockedMedal' };
    // Keep removed stage decoration observable if it is accidentally mounted again.
    if (name === './MedalStage') return { __esModule: true, default: 'MedalStage' };
    return name.startsWith('.') ? require(path.resolve(root, path.dirname(file), name)) : require(name);
  }, module, module.exports);
  return module.exports.default;
}

test('an unearned collection blurs whole cards while retaining each source and accessible title', () => {
  const Collection = component('course/MedalsCollection.js');
  const tree = Collection({ plays, completedLevel: 0, onOpenLesson() { assert.fail('locked medals cannot open lessons'); } });
  assert.match(text(tree), /0 of 38 medals earned/);
  assert.equal(nodes(tree, 'MedalArtwork').length, 0, 'locked cards never mount clear earned artwork');
  assert.equal(nodes(tree, 'Image').length, 0, 'the collection delegates native previews to LockedMedal');
  assert.equal(nodes(tree, 'LockedMedal').length, 38);
  assert.equal(nodes(tree, 'MedalStage').length, 0, 'locked cards render without a theatre stage');
  for (const play of plays) {
    const card = cardFor(tree, play);
    assert.ok(card, play.name);
    assert.ok(blurRadius(card.props.style) > 0, 'the outer card blurs its artwork, title, and status together');
    assert.equal(card.props.disabled, true);
    assert.equal(card.props.accessibilityState.disabled, true);
    assert.equal(card.props.onPress, undefined);
    assert.ok(card.props.accessibilityLabel.includes(play.name), `${play.name} remains in the accessible card label`);
    assert.match(card.props.accessibilityLabel, /Locked/);
    assert.ok(nodes(card, 'Text').some(node => text(node) === play.name), `${play.name} remains within the blurred card`);
    assert.match(text(card), /Locked/, 'the status remains within the blurred card');
    const lock = nodes(card, 'LockedMedal')[0];
    assert.deepEqual(Object.keys(lock.props).filter(key => key !== 'children').sort(), ['size', 'source'],
      'locks receive only their source and size, with no play, account, or genre');
    assert.equal(lock.props.source, play.medalImage, `${play.name} previews its own original source`);
    assert.ok(lock.props.size >= 80 && lock.props.size <= 140);
    for (const node of nodes(card, 'Text')) {
      assert.notEqual(node.props.allowFontScaling, false);
      assert.equal(node.props.numberOfLines, undefined);
    }
  }
});

test('only completed plays mount clear earned artwork and can open lessons', () => {
  const Collection = component('course/MedalsCollection.js'), opened = [];
  const tree = Collection({ plays, completedLevel: 1, onOpenLesson: play => opened.push(play.id) });
  assert.match(text(tree), /1 of 38 medals earned/);
  assert.equal(nodes(tree, 'MedalArtwork').length, 1);
  assert.equal(nodes(tree, 'LockedMedal').length, 37);
  assert.equal(nodes(tree, 'MedalStage').length, 0, 'earned and locked cards render without a theatre stage');
  const cards = nodes(tree, 'Pressable');
  assert.equal(cards.length, 38);
  const completed = plays.find(play => play.difficulty === 1);
  const earned = cardFor(tree, completed);
  const locked = cardFor(tree, plays.find(play => play.difficulty === 39));
  assert.equal(flatten(earned.props.style).filter, undefined, 'the whole earned card stays clear');
  const artwork = nodes(earned, 'MedalArtwork')[0];
  assert.ok(nodes(earned, 'Text').some(node => text(node) === completed.name));
  assert.ok(nodes(earned, 'Text').some(node => text(node) === completed.genre));
  assert.equal(artwork.props.play, completed, 'earned cards pass the original catalogue play without replacing its source');
  assert.equal(artwork.props.play.medalImage, 'assets/medalCollection/mMND.png');
  assert.notEqual(artwork.props.muted, true);
  assert.match(text(earned), /Earned/); assert.match(text(locked), /Locked/);
  assert.equal(earned.props.disabled, false); assert.equal(earned.props.accessibilityState.disabled, false);
  assert.equal(locked.props.disabled, true); assert.equal(locked.props.accessibilityState.disabled, true);
  earned.props.onPress(); assert.deepEqual(opened, ['a-midsummer-nights-dream']);
  assert.equal(locked.props.onPress, undefined);
  for (const node of nodes(tree, 'Text')) { assert.notEqual(node.props.allowFontScaling, false); assert.equal(node.props.numberOfLines, undefined); }
});

test('the next available play remains locked until it is completed', () => {
  const Collection = component('course/MedalsCollection.js');
  const tree = Collection({ plays, completedLevel: 1, onOpenLesson() { assert.fail('available does not mean earned'); } });
  const nextPlay = plays.find(play => play.difficulty === 2);
  const available = cardFor(tree, nextPlay);
  assert.ok(blurRadius(available.props.style) > 0, 'availability keeps the entire locked card blurred');
  assert.match(available.props.accessibilityLabel, /Locked/);
  assert.equal(available.props.disabled, true);
  assert.equal(available.props.onPress, undefined);
  assert.equal(nodes(available, 'MedalArtwork').length, 0);
  assert.equal(nodes(available, 'Image').length, 0);
  assert.equal(nodes(available, 'LockedMedal').length, 1);
  assert.equal(nodes(available, 'LockedMedal')[0].props.source, nextPlay.medalImage,
    'availability keeps the same heavily blurred source preview until completion');
  assert.equal(nodes(available, 'MedalStage').length, 0, 'the next available card remains a plain locked card');
});

test('earned cards show a quiet truthful genre label and announce the genre with Earned', () => {
  const Collection = component('course/MedalsCollection.js');
  const fixtures = [
    { id: 'comedy', name: 'Comedy fixture', genre: 'Comedy', difficulty: 1, medalImage: 11 },
    { id: 'history', name: 'History fixture', genre: 'History', difficulty: 2, medalImage: 12 },
    { id: 'tragedy', name: 'Tragedy fixture', genre: 'Tragedy', difficulty: 3, medalImage: 13 },
    { id: 'romance', name: 'Romance fixture', genre: 'Romance', difficulty: 4, medalImage: 14 },
    { id: 'problem', name: 'Problem fixture', genre: 'Problem Play', difficulty: 5, medalImage: 15 },
    { id: 'unknown', name: 'Unknown fixture', genre: 'Experimental Chronicle', difficulty: 6, medalImage: 16 },
    { id: 'blank', name: 'Blank fixture', genre: '  ', difficulty: 7, medalImage: 17 },
  ];
  const tree = Collection({ plays: fixtures, completedLevel: 7 });
  for (const play of fixtures) {
    const expected = play.id === 'blank' ? 'Unclassified' : play.genre;
    const card = cardFor(tree, play);
    const title = nodes(card, 'Text').find(node => text(node) === play.name);
    const genre = nodes(card, 'Text').find(node => text(node) === expected);
    assert.ok(genre, `${play.name} shows ${expected}`);
    assert.ok(flatten(genre.props.style).fontSize < flatten(title.props.style).fontSize, 'genre supports the title');
    assert.ok(card.props.accessibilityLabel.includes(expected), `${expected} is announced`);
    assert.match(card.props.accessibilityLabel, /Earned/);
    assert.notEqual(genre.props.allowFontScaling, false);
    assert.equal(genre.props.numberOfLines, undefined);
  }
});

test('shared medal appearances preserve actual genre labels and give unknown genres the neutral strap', () => {
  const file = path.join(root, 'course/medalAppearance.js');
  assert.ok(fs.existsSync(file), 'a shared appearance module defines genre labels and strap palettes');
  const { getMedalAppearance } = require(file);
  assert.equal(typeof getMedalAppearance, 'function');
  const neutral = getMedalAppearance(undefined);
  assert.equal(neutral.genreLabel, 'Unclassified');
  for (const genre of ['Comedy', 'History', 'Tragedy', 'Romance', 'Problem Play']) {
    const appearance = getMedalAppearance(genre);
    assert.equal(appearance.genreLabel, genre, 'catalogue strings are not reclassified');
    for (const field of ['fill', 'edge', 'fold']) assert.match(appearance.strap[field], /^#[0-9a-f]{6}$/i);
  }
  for (const genre of ['Problem Play', 'Experimental Chronicle']) {
    const appearance = getMedalAppearance(genre);
    assert.equal(appearance.genreLabel, genre);
    assert.deepEqual(appearance.strap, neutral.strap, `${genre} uses the neutral palette`);
  }
  for (const genre of [null, '', '  ']) assert.equal(getMedalAppearance(genre).genreLabel, 'Unclassified');
});

test('collection uses a single readable column for narrow viewports or large system text', () => {
  for (const dimensions of [{ width: 340, fontScale: 1 }, { width: 411, fontScale: 1.5 }]) {
    const Collection = component('course/MedalsCollection.js', dimensions);
    const tree = Collection({ plays, completedLevel: 39, onOpenLesson() {} });
    assert.match(text(tree), /38 of 38 medals earned/);
    const cards = nodes(tree, 'Pressable');
    const flattened = flatten(cards[0].props.style);
    assert.equal(flattened.width, '100%');
    assert.ok(flattened.minHeight >= 48);
  }
});

test('collection medals stay within 140 points across normal and enlarged text layouts', () => {
  for (const dimensions of [{ width: 320, fontScale: 1 }, { width: 411, fontScale: 1 },
    { width: 411, fontScale: 1.5 }, { width: 820, fontScale: 1 }]) {
    const Collection = component('course/MedalsCollection.js', dimensions);
    const tree = Collection({ plays, completedLevel: 1, onOpenLesson() {} });
    for (const medal of [...nodes(tree, 'MedalArtwork'), ...nodes(tree, 'LockedMedal')]) {
      assert.ok(medal.props.size >= 80 && medal.props.size <= 140, `${dimensions.width}/${dimensions.fontScale}`);
    }
  }
});
