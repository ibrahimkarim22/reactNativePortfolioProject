const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');

const root = path.resolve(__dirname, '../..');
const defaults = { schemaVersion: 1, fontId: 'literata', fontSize: 20, lineSpacing: 'comfortable', theme: 'paper' };

function host() {
  const file = path.join(root, 'reader/ReaderAppearanceModal.js');
  assert.ok(fs.existsSync(file), 'the native reading appearance sheet exists');
  const refs = [];
  let cursor = 0;
  const focused = [];
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useRef(initial) { const index = cursor++; if (!refs[index]) refs[index] = { current: initial }; return refs[index]; },
    useCallback: callback => callback,
  };
  const native = Object.fromEntries(['Modal', 'Pressable', 'ScrollView', 'Text', 'View'].map(name => [name, name]));
  Object.assign(native, {
    StyleSheet: { create: styles => styles, hairlineWidth: 1 },
    Platform: { OS: 'android' },
    AccessibilityInfo: { setAccessibilityFocus: target => focused.push(target) },
    findNodeHandle: target => target?.nativeTag ?? null,
  });
  const code = babel.transformFileSync(file, {
    babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'],
  }).code;
  const module = { exports: {} };
  const dependencies = {
    react: React,
    'react-native': native,
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 24, left: 0, right: 0 }) },
  };
  const localRequire = specifier => specifier in dependencies ? dependencies[specifier] : require(path.resolve(path.dirname(file), specifier));
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: file })(localRequire, module, module.exports);
  return {
    focused,
    render(props = {}) { cursor = 0; return module.exports.default({ visible: true, ready: true, preferences: defaults, ...props }); },
  };
}

function nodes(tree, type) {
  if (!tree || typeof tree !== 'object') return [];
  return [...(tree.type === type ? [tree] : []), ...(tree.props?.children || []).flat(Infinity).flatMap(child => nodes(child, type))];
}
function control(tree, label) {
  const result = nodes(tree, 'Pressable').find(node => node.props.accessibilityLabel === label);
  assert.ok(result, `the ${label} control is available`);
  return result;
}
function style(value) { return Object.assign({}, ...[value].flat(Infinity).filter(Boolean)); }
function text(tree) { return nodes(tree, 'Text').map(node => node.props.children.flat(Infinity).filter(value => typeof value === 'string' || typeof value === 'number').join('')).join('\n'); }

test('appearance controls send only their selected preference patch and expose selected choices', () => {
  const sheet = host();
  const changes = [];
  const tree = sheet.render({ onChange: patch => changes.push(patch) });
  const radios = nodes(tree, 'Pressable').filter(node => node.props.accessibilityRole === 'radio');
  assert.equal(radios.length, 9, 'three choices each for font, theme and spacing');
  assert.equal(radios.filter(node => node.props.accessibilityState.checked).length, 3);
  const font = radios.find(node => node.props.accessibilityLabel.startsWith('Source Sans 3'));
  font.props.onPress();
  radios.find(node => node.props.accessibilityLabel.startsWith('Night')).props.onPress();
  radios.find(node => node.props.accessibilityLabel.startsWith('Spacious')).props.onPress();
  assert.deepEqual(changes, [{ fontId: 'source-sans-3' }, { theme: 'night' }, { lineSpacing: 'spacious' }]);
  assert.ok(text(tree).includes('1.5'));
  assert.ok(text(tree).includes('1.6'));
  assert.ok(text(tree).includes('1.8'));
});

test('text size changes by two and disabled bounds cannot emit an invalid size', () => {
  const sheet = host();
  const changes = [];
  let tree = sheet.render({ onChange: patch => changes.push(patch) });
  control(tree, 'Decrease text size').props.onPress();
  control(tree, 'Increase text size').props.onPress();
  assert.deepEqual(changes, [{ fontSize: 18 }, { fontSize: 22 }]);
  tree = sheet.render({ preferences: { ...defaults, fontSize: 16 }, onChange: patch => changes.push(patch) });
  const decrease = control(tree, 'Decrease text size');
  assert.equal(decrease.props.disabled, true);
  assert.equal(decrease.props.accessibilityState.disabled, true);
  decrease.props.onPress();
  tree = sheet.render({ preferences: { ...defaults, fontSize: 30 }, onChange: patch => changes.push(patch) });
  const increase = control(tree, 'Increase text size');
  assert.equal(increase.props.disabled, true);
  increase.props.onPress();
  assert.equal(changes.length, 2);
});

test('pending preferences disable changes and reset while close remains usable', () => {
  const sheet = host();
  const changes = [];
  let resets = 0;
  let closes = 0;
  const tree = sheet.render({ ready: false, onChange: patch => changes.push(patch), onReset: () => resets++, onClose: () => closes++ });
  for (const option of nodes(tree, 'Pressable').filter(node => node.props.accessibilityRole === 'radio')) {
    assert.equal(option.props.disabled, true);
    option.props.onPress();
  }
  control(tree, 'Increase text size').props.onPress();
  control(tree, 'Reset reading appearance').props.onPress();
  control(tree, 'Close reading appearance').props.onPress();
  assert.deepEqual(changes, []);
  assert.equal(resets, 0);
  assert.equal(closes, 1);
});

test('Android Back, Close and accessibility escape use the same close action', () => {
  const sheet = host();
  let closes = 0;
  const tree = sheet.render({ onClose: () => closes++ });
  const modal = nodes(tree, 'Modal')[0];
  assert.equal(modal.props.animationType, 'none');
  assert.equal(modal.props.transparent, true);
  modal.props.onRequestClose();
  control(tree, 'Close reading appearance').props.onPress();
  nodes(tree, 'View').find(node => node.props.accessibilityViewIsModal).props.onAccessibilityEscape();
  assert.equal(closes, 3);
});

test('the sheet scrolls all choices, keeps touch targets usable and owns its modal bottom inset', () => {
  const sheet = host();
  const tree = sheet.render();
  assert.equal(nodes(tree, 'ScrollView').length, 1);
  for (const button of nodes(tree, 'Pressable')) {
    assert.ok(style(button.props.style).minHeight >= 48, `${button.props.accessibilityLabel} remains at least 48 high`);
    assert.ok(style(button.props.style).minWidth >= 48, `${button.props.accessibilityLabel} remains at least 48 wide`);
  }
  const panel = nodes(tree, 'View').find(node => node.props.accessibilityViewIsModal);
  assert.equal(style(panel.props.style).maxHeight, '85%');
  assert.equal(style(panel.props.style).maxWidth, 560);
  assert.equal(style(panel.props.style).paddingBottom, 24);
});

test('focus moves into the modal on show and stays put during preference changes', () => {
  const sheet = host();
  let tree = sheet.render();
  const heading = nodes(tree, 'Text').find(node => node.props.accessibilityRole === 'header' && node.props.ref);
  heading.props.ref.current = { nativeTag: 17 };
  assert.deepEqual(sheet.focused, []);
  nodes(tree, 'Modal')[0].props.onShow();
  assert.deepEqual(sheet.focused, [17]);
  tree = sheet.render({ preferences: { ...defaults, fontSize: 24 } });
  assert.deepEqual(sheet.focused, [17], 'selection changes must not refocus the sheet');
});

test('error recovery controls appear only for actual failures and call their own retries', () => {
  const sheet = host();
  let saved = 0;
  let font = 0;
  let reset = 0;
  let tree = sheet.render();
  assert.equal(nodes(tree, 'Pressable').some(node => /Retry/.test(node.props.accessibilityLabel)), false);
  tree = sheet.render({ saveError: 'Unable to save settings.', fontStatus: { loading: false, error: 'The typeface could not load. Using the fallback serif.' }, onRetrySave: () => saved++, onRetryFont: () => font++, onReset: () => reset++ });
  assert.ok(text(tree).includes('fallback serif'));
  control(tree, 'Retry saving reading settings').props.onPress();
  control(tree, 'Retry loading typeface').props.onPress();
  control(tree, 'Reset reading appearance').props.onPress();
  assert.deepEqual([saved, font, reset], [1, 1, 1]);
});
