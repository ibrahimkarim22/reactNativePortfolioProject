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
  return module.exports.default.map(entry => ({ id: entry.slug, name: entry.name, difficulty: entry.difficulty, medalImage: entry.medalImage }));
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

function component(file, dimensions = { width: 411, fontScale: 1 }) {
  const React = { createElement(type, props, ...children) { const next = { ...props, children }; return typeof type === 'function' ? type(next) : { type, props: next }; } };
  const native = { View: 'View', Text: 'Text', Pressable: 'Pressable', useWindowDimensions: () => dimensions, StyleSheet: { create: value => value } };
  const code = babel.transformFileSync(path.join(root, file), { babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
  const module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: file })(name => {
    if (name === 'react') return React;
    if (name === 'react-native') return native;
    if (name === './MedalArtwork') return { __esModule: true, default: 'MedalArtwork' };
    return name.startsWith('.') ? require(path.resolve(root, path.dirname(file), name)) : require(name);
  }, module, module.exports);
  return module.exports.default;
}

test('earned and locked cards have explicit labels and only earned medals can open lessons', () => {
  const Collection = component('course/MedalsCollection.js'), opened = [];
  const tree = Collection({ plays, completedLevel: 1, onOpenLesson: play => opened.push(play.id) });
  assert.match(text(tree), /1 of 38 medals earned/);
  assert.equal(nodes(tree, 'MedalArtwork').length, 38);
  const cards = nodes(tree, 'Pressable');
  assert.equal(cards.length, 38);
  const earned = cards.find(n => n.props.accessibilityLabel.includes("A Midsummer Night"));
  const locked = cards.find(n => n.props.accessibilityLabel.includes('Henry VIII'));
  assert.match(text(earned), /Earned/); assert.match(text(locked), /Locked/);
  assert.equal(earned.props.disabled, false); assert.equal(earned.props.accessibilityState.disabled, false);
  assert.equal(locked.props.disabled, true); assert.equal(locked.props.accessibilityState.disabled, true);
  earned.props.onPress(); assert.deepEqual(opened, ['a-midsummer-nights-dream']);
  assert.equal(locked.props.onPress, undefined);
  for (const node of nodes(tree, 'Text')) { assert.notEqual(node.props.allowFontScaling, false); assert.equal(node.props.numberOfLines, undefined); }
});

test('collection uses a single readable column for narrow viewports or large system text', () => {
  for (const dimensions of [{ width: 340, fontScale: 1 }, { width: 411, fontScale: 1.5 }]) {
    const Collection = component('course/MedalsCollection.js', dimensions);
    const tree = Collection({ plays, completedLevel: 39, onOpenLesson() {} });
    assert.match(text(tree), /38 of 38 medals earned/);
    const cards = nodes(tree, 'Pressable');
    const flattened = Object.assign({}, ...[cards[0].props.style].flat(Infinity).filter(s => typeof s === 'object'));
    assert.equal(flattened.width, '100%');
    assert.ok(flattened.minHeight >= 48);
  }
});
