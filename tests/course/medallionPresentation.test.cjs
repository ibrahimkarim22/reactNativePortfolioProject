const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');
const root = path.resolve(__dirname, '../..');

const nodes = (tree, type) => !tree || typeof tree !== 'object' ? [] : [
  ...(tree.type === type ? [tree] : []), ...(tree.props?.children || []).flat(Infinity).flatMap(child => nodes(child, type)),
];
const flatten = style => Object.assign({}, ...[style].flat(Infinity).filter(value => value && typeof value === 'object'));
const medalFiles = fs.readdirSync(path.join(root, 'assets/medalCollection')).filter(name => name.endsWith('.png')).sort();
const medalSources = new Map(medalFiles.map((name, i) => [name, name === 'mMND.png' ? 123 : name === 'mHam.png' ? 456 : 1000 + i]));
const assetDimensions = new Map(medalFiles.map(name => {
  const png = fs.readFileSync(path.join(root, 'assets/medalCollection', name));
  return [medalSources.get(name), { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }];
}));
const decoration = (tree, id) => nodes(tree, 'View').find(node => node.props.testID === id);
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.01, `${message}: ${actual} vs ${expected}`);

function artworkHost({ dimensions = {} } = {}) {
  const slots = []; let cursor = 0, effects = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const memo = (fn, deps) => {
    const slot = cursor++;
    if (!slots[slot] || !same(slots[slot].deps, deps)) slots[slot] = { value: fn(), deps };
    return slots[slot].value;
  };
  const React = {
    createElement(type, props, ...children) {
      const { key, ...ordinaryProps } = props || {};
      const next = { ...ordinaryProps, children };
      const element = typeof type === 'function' ? type(next) : { type, props: next };
      return key === undefined ? element : { ...element, key: String(key) };
    },
    useMemo: memo,
    useRef: initial => memo(() => ({ current: initial }), []),
    useState(initial) {
      const state = memo(() => ({ value: typeof initial === 'function' ? initial() : initial }), []);
      return [state.value, next => { state.value = typeof next === 'function' ? next(state.value) : next; }];
    },
    useEffect(fn, deps) {
      const slot = cursor++;
      if (!slots[slot] || !same(slots[slot].deps, deps)) effects.push(() => {
        slots[slot]?.cleanup?.();
        slots[slot] = { deps, setup: fn, cleanup: fn() };
      });
    },
  };
  const Image = Object.assign(props => ({ type: 'Image', props }), {
    resolveAssetSource: source => assetDimensions.has(source) || source === 99999
      ? { uri: 'asset:' + source, ...(assetDimensions.get(source) || { width: 400, height: 400 }), scale: 1, ...dimensions }
      : null,
  });
  const native = { Image, View: 'View', Text: 'Text', StyleSheet: { create: value => value } };
  const file = path.join(root, 'course/MedalArtwork.js');
  const code = babel.transformFileSync(file, { babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
  const module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: file })(name => {
    if (name === 'react') return React;
    if (name === 'react-native') return native;
    if (name === './medalAppearance') return require('../../course/medalAppearance');
    if (name.startsWith('../assets/medalCollection/')) {
      const source = medalSources.get(path.basename(name));
      assert.notEqual(source, undefined, `only existing original medals may be mounted: ${name}`);
      return source;
    }
    throw new Error('Unexpected dependency: ' + name);
  }, module, module.exports);
  const render = props => {
    cursor = 0; effects = [];
    const tree = module.exports.default(props);
    effects.forEach(fn => fn());
    return tree;
  };
  render.unmount = () => slots.forEach(slot => slot?.cleanup?.());
  render.replayEffects = () => {
    slots.forEach(slot => slot?.cleanup?.());
    slots.forEach(slot => { if (slot?.setup) slot.cleanup = slot.setup(); });
  };
  return render;
}

const play = { id: 'fixture', name: 'Fixture Play', medalImage: 123 };

test('the default result medal has a 228 point square footprint and invalid sizes use that readable default', () => {
  const render = artworkHost();
  for (const size of [undefined, NaN, Infinity, 0, 63]) {
    const tree = render({ play, size });
    const frame = flatten(tree.props.style);
    assert.equal(frame.width, 228, String(size));
    assert.equal(frame.height, 228, String(size));
  }
  assert.equal(flatten(render({ play, size: 140 }).props.style).width, 140);
});

test('framing keeps the original artwork fully contained, labelled, and unobscured at result and collection sizes', () => {
  const render = artworkHost();
  for (const size of [140, 228]) {
    const tree = render({ play, size });
    const images = nodes(tree, 'Image');
    assert.equal(images.length, 1);
    const image = images[0];
    assert.equal(image.props.source, 123);
    assert.equal(image.props.resizeMode, 'contain');
    assert.equal(image.props.accessibilityLabel, 'Fixture Play medal');
    assert.equal(image.props.accessible, true);
    for (const view of nodes(tree, 'View')) assert.notEqual(flatten(view.props.style).overflow, 'hidden');
  }
});

test('runtime artwork failures stay readable and a different mapped source can recover', () => {
  const render = artworkHost();
  nodes(render({ play }), 'Image')[0].props.onError();
  const unavailable = render({ play });
  assert.equal(nodes(unavailable, 'Image').length, 0);
  const notice = nodes(unavailable, 'Text')[0];
  assert.equal(notice.props.accessibilityLabel, 'Fixture Play medal artwork unavailable');
  assert.equal(notice.props.accessibilityLiveRegion, 'polite');
  assert.notEqual(flatten(unavailable.props.style).opacity, 0.32);
  assert.equal(nodes(render({ play: { ...play, medalImage: 456 } }), 'Image')[0].props.source, 456);
});

test('the hanger preserves the full original image without a circular frame or cropped artwork', () => {
  for (const size of [140, 228]) {
    const render = artworkHost();
    nodes(render({ play, size }), 'Image')[0].props.onLoad?.();
    const tree = render({ play, size });
    const frame = flatten(tree.props.style);
    assert.equal(frame.borderWidth || 0, 0, 'the original artwork has no surrounding circular outline');
    assert.equal(frame.padding || 0, 0, 'ornaments do not shrink the contained image');
    assert.ok(frame.backgroundColor === undefined || frame.backgroundColor === 'transparent');
    assert.ok(!frame.shadowOpacity && !frame.elevation, 'the frame has no shadow disc');
    const image = nodes(tree, 'Image')[0];
    assert.equal(image.props.source, 123);
    assert.equal(image.props.resizeMode, 'contain');
    assert.equal(flatten(image.props.style).width, '100%');
    assert.equal(flatten(image.props.style).height, '100%');
    assert.equal(flatten(image.props.style).transform, undefined);
    assert.equal(image.props.fadeDuration, 0, 'native image fading cannot trail the parent reveal');
    render.unmount();
  }
});

test('every original medal has a short strap and finished cap covering its original hole', () => {
  assert.equal(medalFiles.length, 38);
  for (const name of medalFiles) for (const size of [140, 228]) {
    const render = artworkHost();
    const props = { play: { ...play, medalImage: medalSources.get(name) }, size };
    nodes(render(props), 'Image')[0].props.onLoad();
    const tree = render(props);
    const mount = decoration(tree, 'medal-mount');
    assert.ok(mount, `${name} gets an intentional fastening point`);
    const capView = decoration(tree, 'medal-cap');
    assert.ok(capView, `${name} has finished hardware covering the original hole`);
    const cap = flatten(capView.props.style);
    const connector = flatten(decoration(tree, 'medal-connector').props.style);
    const strapView = decoration(tree, 'medal-strap');
    assert.ok(strapView, `${name} has a short fabric strap above its hole`);
    const strap = flatten(strapView.props.style);
    const fold = decoration(strapView, 'medal-strap-fold');
    assert.ok(fold, `${name} has a restrained fabric fold`);
    assert.equal(strap.backgroundColor, '#3b3f43', `${name} without a genre uses neutral fabric`);
    assert.equal(strap.borderColor, '#61666b', `${name} without a genre uses a neutral fabric edge`);
    assert.equal(flatten(fold.props.style).backgroundColor, '#51565b', `${name} without a genre uses a neutral fabric fold`);
    assert.equal(decoration(tree, 'medal-loop'), undefined, `${name} has no exposed oval through its hole`);
    assert.equal(decoration(tree, 'medal-pin'), undefined, `${name} has no extra pin`);
    assert.equal(nodes(mount, 'View').length, 5, `${name} has only the cap, connector, strap, and fold`);
    assert.equal(cap.backgroundColor, '#b59b65', `${name} cap is solid aged gold`);
    assert.equal(connector.backgroundColor, '#bca16b', `${name} connector retains the existing gold`);
    // Independently measured source-pixel hole centers, including the three exceptions.
    const [x, y, holeWidth, holeHeight] = name === 'mMND.png' ? [200, 83, 39, 39]
      : name === 'mRom.png' ? [200, 81, 39, 39]
      : name === 'mAWW.png' ? [204.5, 102.5, 44, 40] : [204.5, 111.5, 40, 40];
    const square = name === 'mMND.png' || name === 'mRom.png';
    const scale = size / (square ? 400 : 503);
    const centerX = square ? x * scale : (size - 411 * scale) / 2 + x * scale;
    const centerY = y * scale;
    near(cap.left + cap.width / 2, centerX, `${name} cap aligns horizontally`);
    near(connector.left + connector.width / 2, centerX, `${name} connector aligns horizontally`);
    near(strap.left + strap.width / 2, centerX, `${name} strap stays centered over the connector`);
    assert.ok(connector.width >= holeWidth * scale * 0.35 && connector.width <= holeWidth * scale * 0.5,
      `${name} connector remains small`);
    assert.ok(strap.width >= holeWidth * scale * 0.8 && strap.width <= holeWidth * scale,
      `${name} strap is readable without becoming an oversized ribbon`);
    assert.ok(strap.height >= holeHeight * scale * 0.8 && strap.height <= holeHeight * scale * 1.1,
      `${name} strap stays short`);
    assert.ok(strap.top >= 0, `${name} strap stays within the reserved footprint`);
    assert.ok(strap.top + strap.height > connector.top, `${name} strap visibly joins the connector`);
    assert.ok(strap.top + strap.height < cap.top, `${name} short connector remains visible above the cap`);
    assert.ok(strap.top + strap.height <= centerY - holeHeight * scale / 2,
      `${name} fabric stays above the original hole`);
    assert.ok(strap.width > connector.width, `${name} fabric reads separately from the connector`);
    assert.ok(connector.top + connector.height > cap.top, `${name} connector joins the cap without a gap`);
    assert.ok(cap.width >= holeWidth * scale * 1.2 && cap.width <= holeWidth * scale * 1.5,
      `${name} cap covers the hole without becoming bulky`);
    assert.ok(cap.top <= centerY - holeHeight * scale * 0.7, `${name} cap overlaps the medal's upper edge`);
    assert.ok(cap.top + cap.height >= centerY + holeHeight * scale * 0.6,
      `${name} cap covers the bottom of the hole`);
    assert.equal(cap.opacity ?? 1, 1, `${name} cap cannot reveal the hole through transparency`);
    for (let step = 0; step < 64; step++) {
      const angle = step / 64 * Math.PI * 2;
      const px = centerX + Math.cos(angle) * holeWidth * scale / 2 - cap.left;
      const py = centerY + Math.sin(angle) * holeHeight * scale / 2 - cap.top;
      assert.ok(px >= 0 && px <= cap.width && py >= 0 && py <= cap.height, `${name} hole stays under the cap`);
      for (const [cx, cy, radius, corner] of [
        [cap.borderTopLeftRadius, cap.borderTopLeftRadius, cap.borderTopLeftRadius, 'top-left'],
        [cap.width - cap.borderTopRightRadius, cap.borderTopRightRadius, cap.borderTopRightRadius, 'top-right'],
        [cap.borderBottomLeftRadius, cap.height - cap.borderBottomLeftRadius, cap.borderBottomLeftRadius, 'bottom-left'],
        [cap.width - cap.borderBottomRightRadius, cap.height - cap.borderBottomRightRadius, cap.borderBottomRightRadius, 'bottom-right'],
      ]) {
        const inCorner = (corner.endsWith('left') ? px < cx : px > cx)
          && (corner.startsWith('top') ? py < cy : py > cy);
        if (inCorner) assert.ok((px - cx) ** 2 + (py - cy) ** 2 <= radius ** 2, `${name} rounded cap covers its ${corner} hole edge`);
      }
    }
    assert.equal(mount.props.children.at(-1), capView, `${name} cap is drawn over the original hole`);
    assert.equal(flatten(mount.props.style).position, 'absolute', 'decoration does not change layout');
    assert.equal(mount.props.pointerEvents, 'none');
    assert.equal(mount.props.accessible, false);
    assert.equal(mount.props.accessibilityElementsHidden, true);
    assert.equal(mount.props.importantForAccessibility, 'no-hide-descendants');
    assert.equal(nodes(tree, 'Image').length, 1, 'the mount uses native views and no replacement artwork');
    assert.ok(nodes(tree, 'View').every(node => flatten(node.props.style).overflow !== 'hidden'));
    render.unmount();
  }
});

test('genre changes color only the fabric while preserving the loaded original artwork and hanger geometry', () => {
  const fixtures = [
    { genre: 'Comedy', fill: '#275341', edge: '#4d7760', fold: '#3f6b53' },
    { genre: 'Tragedy', fill: '#642d3c', edge: '#8c5360', fold: '#854455' },
    { genre: 'History', fill: '#3e536a', edge: '#65798c', fold: '#536b82' },
    { genre: 'Romance', fill: '#644864', edge: '#896a89', fold: '#7b5c7b' },
    { genre: 'Problem Play', fill: '#3b3f43', edge: '#61666b', fold: '#51565b' },
  ];
  const geometry = tree => ['medal-mount', 'medal-connector', 'medal-strap', 'medal-strap-fold', 'medal-cap'].map(id => {
    const style = { ...flatten(decoration(tree, id).props.style) };
    if (id === 'medal-strap') { delete style.backgroundColor; delete style.borderColor; }
    if (id === 'medal-strap-fold') delete style.backgroundColor;
    return [id, style];
  });
  for (const size of [140, 228]) {
    const render = artworkHost(); let ready = 0;
    const props = { play: { ...play, genre: 'Comedy' }, size, onReady: () => { ready++; } };
    const pending = render(props);
    assert.equal(flatten(pending.props.style).opacity, 0);
    nodes(pending, 'Image')[0].props.onLoad();
    const original = render(props);
    for (const fixture of fixtures) {
      const tree = render({ ...props, play: { ...play, genre: fixture.genre } });
      const strap = flatten(decoration(tree, 'medal-strap').props.style);
      const fold = flatten(decoration(tree, 'medal-strap-fold').props.style);
      assert.equal(strap.backgroundColor, fixture.fill, fixture.genre);
      assert.equal(strap.borderColor, fixture.edge, fixture.genre);
      assert.equal(fold.backgroundColor, fixture.fold, fixture.genre);
      assert.deepEqual(geometry(tree), geometry(original), `${fixture.genre} preserves the fastening geometry and gold hardware`);
      assert.equal(flatten(tree.props.style).width, size);
      assert.equal(flatten(tree.props.style).height, size);
      assert.equal(flatten(tree.props.style).opacity, 1, 'loaded earned artwork stays fully visible');
      const image = nodes(tree, 'Image')[0];
      assert.equal(image.props.source, 123, `${fixture.genre} preserves the original artwork`);
      assert.equal(image.key, '123');
      assert.equal(image.props.resizeMode, 'contain');
      assert.equal(ready, 1, 'genre metadata does not restart or repeat native readiness');
    }
    render.unmount();
  }
});

test('unknown assets and mismatched original dimensions retain full artwork without a guessed hanger', () => {
  for (const fixture of [
    { source: 99999 },
    { source: 123, dimensions: { width: 411, height: 503 } },
    { source: 456, dimensions: { width: 400, height: 400 } },
    { source: 456, dimensions: { width: 0, height: 503 } },
  ]) {
    const render = artworkHost({ dimensions: fixture.dimensions });
    const props = { play: { ...play, medalImage: fixture.source } };
    nodes(render(props), 'Image')[0].props.onLoad();
    const tree = render(props);
    assert.equal(decoration(tree, 'medal-mount'), undefined);
    assert.equal(nodes(tree, 'Image')[0].props.source, fixture.source);
    assert.equal(nodes(tree, 'Image')[0].props.resizeMode, 'contain');
    assert.equal(flatten(tree.props.style).opacity, 1);
    render.unmount();
  }
});

test('metadata resolution keeps the hanger and image hidden until a native successful load', () => {
  const render = artworkHost(); let ready = 0;
  const props = { play, onReady: () => { ready++; } };
  let tree = render(props);
  assert.equal(ready, 0, 'a resolved asset URI is not a decoded native image');
  assert.equal(flatten(tree.props.style).opacity, 0, 'frame and artwork share the pending opacity');
  assert.ok(decoration(tree, 'medal-mount'), 'the hanger shares the hidden artwork parent');
  const image = nodes(tree, 'Image')[0];
  assert.equal(image.props.onLoadEnd, undefined, 'load-end also follows failures');
  assert.equal(typeof image.props.onLoad, 'function');
  image.props.onLoad();
  tree = render(props);
  assert.equal(flatten(tree.props.style).opacity, 1);
  assert.equal(ready, 1);
  image.props.onLoad(); image.props.onError();
  tree = render(props);
  assert.equal(ready, 1, 'only the first terminal native event signals readiness');
  assert.equal(nodes(tree, 'Image').length, 1, 'late errors cannot replace successfully loaded artwork');
  render({ ...props, onReady: () => { ready++; } });
  assert.equal(ready, 1, 'a changed callback does not repeat readiness');
  render.unmount();
});

test('pending artwork and every terminal fallback reserve the full diameter square', () => {
  for (const size of [140, 228]) {
    const render = artworkHost(); let ready = 0;
    const props = { play, size, onReady: () => { ready++; } };
    const pending = render(props);
    nodes(pending, 'Image')[0].props.onError();
    const failed = render(props);
    for (const tree of [pending, failed]) {
      assert.equal(flatten(tree.props.style).width, size);
      assert.equal(flatten(tree.props.style).height, size);
    }
    assert.equal(ready, 1);
    assert.equal(nodes(failed, 'Image').length, 0);
    assert.ok(flatten(failed.props.style).opacity === undefined || flatten(failed.props.style).opacity === 1,
      'terminal fallback text remains readable');
    const missing = render({ ...props, play: { name: 'Missing Play' } });
    assert.equal(flatten(missing.props.style).width, size);
    assert.equal(flatten(missing.props.style).height, size);
    assert.equal(nodes(missing, 'Text')[0].props.accessibilityLabel, 'Missing Play medal artwork unavailable');
    assert.equal(ready, 2, 'a missing mapping is a ready terminal fallback');
    render.unmount();
  }
});

test('A to B to A source transitions ignore native callbacks from both superseded requests', () => {
  for (const terminal of ['onLoad', 'onError']) {
    const render = artworkHost(); let ready = 0;
    const props = { play, onReady: () => { ready++; } };
    const firstA = nodes(render(props), 'Image')[0];
    const oldB = nodes(render({ ...props, play: { ...play, medalImage: 456 } }), 'Image')[0];
    const currentA = nodes(render(props), 'Image')[0];
    for (const old of [firstA, oldB]) {
      for (const event of ['onLoad', 'onError']) {
        old.props[event]?.();
        const pending = render(props);
        assert.equal(ready, 0, 'superseded requests cannot release the current reveal');
        assert.equal(nodes(pending, 'Image').length, 1, 'superseded errors cannot fail the current request');
      }
    }
    let tree = render(props);
    assert.equal(ready, 0, 'superseded requests cannot release the current reveal');
    assert.equal(nodes(tree, 'Image').length, 1, 'superseded errors cannot fail the current request');
    assert.equal(flatten(tree.props.style).opacity, 0);
    assert.equal(typeof currentA.props[terminal], 'function');
    currentA.props[terminal]();
    tree = render(props);
    assert.equal(ready, 1);
    assert.equal(nodes(tree, 'Image').length, terminal === 'onLoad' ? 1 : 0);
    render.unmount();
  }
});

test('source changes remount the native image before loading another mapped artwork', () => {
  const render = artworkHost();
  const keys = [123, 456, 123].map(medalImage => {
    const tree = render({ play: { ...play, medalImage } });
    return nodes(tree, 'Image')[0].key;
  });
  assert.deepEqual(keys, ['123', '456', '123'], 'each adjacent source transition has a different native image key');
  render.unmount();
});

test('callbacks after unmount cannot signal readiness or change a request', () => {
  const render = artworkHost(); let ready = 0;
  const props = { play, onReady: () => { ready++; } };
  const image = nodes(render(props), 'Image')[0];
  render.unmount();
  image.props.onLoad?.(); image.props.onError();
  assert.equal(ready, 0);
});

test('development effect replay keeps the current native request active', () => {
  const render = artworkHost(); let ready = 0;
  const props = { play, onReady: () => { ready++; } };
  const image = nodes(render(props), 'Image')[0];
  render.replayEffects();
  image.props.onLoad();
  const tree = render(props);
  assert.equal(flatten(tree.props.style).opacity, 1);
  assert.equal(ready, 1);
  render.unmount();
});
