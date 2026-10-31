const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const babel = require('@babel/core');

const root = path.resolve(__dirname, '../..');
const appearance = genre => require('../../course/medalAppearance').getMedalAppearance(genre);
const palettes = [
  ['Comedy', { fill: '#275341', edge: '#4d7760', fold: '#3f6b53' }],
  ['Tragedy', { fill: '#642d3c', edge: '#8c5360', fold: '#854455' }],
  ['History', { fill: '#3e536a', edge: '#65798c', fold: '#536b82' }],
  ['Romance', { fill: '#644864', edge: '#896a89', fold: '#7b5c7b' }],
];
const neutral = { fill: '#3b3f43', edge: '#61666b', fold: '#51565b' };

test('the four catalogue genre labels select distinct fabric palettes', () => {
  for (const [genreLabel, strap] of palettes) {
    assert.deepEqual(appearance(genreLabel), { genreLabel, strap });
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data/manifest.json'), 'utf8'));
  assert.equal(manifest.plays.length, 38);
  assert.deepEqual([...new Set(manifest.plays.map(play => play.genre))].sort(), ['Comedy', 'History', 'Problem Play', 'Romance', 'Tragedy']);
  for (const play of manifest.plays) {
    const metadata = JSON.parse(fs.readFileSync(path.resolve(root, 'data', play.play), 'utf8'));
    const expected = metadata.genre === 'Problem Play' ? ['Problem Play', neutral] : palettes.find(([genre]) => genre === metadata.genre);
    assert.ok(expected, `${play.id} retains its exact catalogue genre`);
    assert.deepEqual(appearance(metadata.genre), { genreLabel: expected[0], strap: expected[1] }, play.id);
  }
});

test('unknown genre labels remain visible while using neutral fabric', () => {
  for (const genreLabel of ['Problem Play', 'comedy', 'Tragicomedy', '__proto__', 'constructor', 'toString']) {
    assert.deepEqual(appearance(genreLabel), { genreLabel, strap: neutral });
  }
});

test('missing or invalid genre metadata uses an explicit Unclassified label and neutral fabric', () => {
  for (const genre of [undefined, null, '', '   ', 0, 7, false, true, [], {}, new String('Comedy')]) {
    assert.deepEqual(appearance(genre), { genreLabel: 'Unclassified', strap: neutral });
  }
});

test('shared appearance results and nested fabric colors cannot be mutated by a consumer', () => {
  for (const genre of ['Comedy', 'Tragedy', 'History', 'Romance', 'Problem Play', undefined]) {
    const result = appearance(genre);
    assert.equal(Object.isFrozen(result), true, String(genre));
    assert.equal(Object.isFrozen(result.strap), true, String(genre));
    const before = JSON.stringify(result);
    assert.equal(Reflect.set(result, 'genreLabel', 'Changed'), false);
    assert.equal(Reflect.set(result.strap, 'fill', '#ffffff'), false);
    assert.equal(JSON.stringify(appearance(genre)), before);
  }
});

function lockedComponent() {
  const React = { createElement(type, props, ...children) {
    const next = { ...props, children };
    return typeof type === 'function' ? type(next) : { type, props: next };
  } };
  const native = { View: 'View', Text: 'Text', Image: 'Image', StyleSheet: { create: value => value } };
  Object.defineProperty(native, 'Animated', { get() { throw new Error('locked medal previews must never animate into clear artwork'); } });
  const file = path.join(root, 'course/LockedMedal.js');
  const code = babel.transformFileSync(file, { babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
  const module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: file })(name => {
    if (name === 'react') return React;
    if (name === 'react-native') return native;
    throw new Error('locked medal previews must use only the native Image: ' + name);
  }, module, module.exports);
  return module.exports.default;
}

const nodes = (tree, type) => !tree || typeof tree !== 'object' ? [] : [
  ...(tree.type === type ? [tree] : []), ...(tree.props?.children || []).flat(Infinity).flatMap(child => nodes(child, type)),
];
const flatten = style => Object.assign({}, ...[style].flat(Infinity).filter(value => value && typeof value === 'object'));

test('locked medals always heavily blur their actual source and use a question mark only when the source is missing', () => {
  const LockedMedal = lockedComponent();
  for (const size of [140, 228]) {
    for (const source of [17, { uri: 'actual-medal.png' }]) {
      const locked = LockedMedal({ size, source });
      const images = nodes(locked, 'Image');
      assert.equal(images.length, 1, 'each locked medal shows exactly one native preview without a raw alternative');
      const preview = images[0];
      assert.equal(preview.props.source, source, 'the actual source passes through unchanged');
      assert.ok(Number.isFinite(preview.props.blurRadius) && preview.props.blurRadius >= 24,
        'the initial native image is already very heavily blurred');
      assert.equal(preview.props.fadeDuration, 0, 'no image fade can reveal an unblurred intermediate frame');
      assert.equal(preview.props.resizeMode, 'contain');
      assert.equal(flatten(preview.props.style).width, size);
      assert.equal(flatten(preview.props.style).height, size);
      assert.equal(nodes(locked, 'Text').length, 0, 'a valid source never uses the question-mark fallback');
      assert.equal(flatten(locked.props.style).width, size);
      assert.equal(flatten(locked.props.style).height, size);
      assert.equal(locked.props.pointerEvents, 'none');
      assert.equal(locked.props.accessible, false, 'the card carries the Locked accessibility label');
      assert.equal(locked.props.accessibilityElementsHidden, true);
      assert.equal(locked.props.importantForAccessibility, 'no-hide-descendants');
    }
    for (const source of [undefined, null]) {
      const fallback = LockedMedal({ size, source });
      assert.equal(nodes(fallback, 'Image').length, 0, 'a missing source does not mount a native image');
      assert.deepEqual(nodes(fallback, 'Text').map(node => node.props.children.flat(Infinity).join('')), ['?']);
    }
  }
});
