const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');
const { THEMES } = require('../../reader/readerConstants');

function load() {
  const file = path.resolve(__dirname, '../../reader/ReaderHighlightPicker.js');
  assert.ok(fs.existsSync(file), 'real quotation/color picker exists');
  const React = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), useRef: () => ({ current: null }) };
  const native = Object.fromEntries(['Modal', 'Pressable', 'ScrollView', 'Text', 'View'].map(n => [n, n]));
  Object.assign(native, { StyleSheet: { create: s => s }, AccessibilityInfo: { setAccessibilityFocus() {} }, findNodeHandle: () => null });
  const module = { exports: {} };
  const code = babel.transformFileSync(file, { babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: file })(name => {
    if (name === 'react') return React;
    if (name === 'react-native') return native;
    if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ bottom: 24 }) };
    return require(path.join(path.dirname(file), name));
  }, module, module.exports);
  return module.exports.default;
}
function nodes(tree, type) {
  if (!tree || typeof tree !== 'object') return [];
  return [...(tree.type === type ? [tree] : []), ...(tree.props?.children || []).flat(Infinity).flatMap(x => nodes(x, type))];
}
function texts(tree) {
  if (typeof tree === 'string') return tree;
  if (!tree || typeof tree !== 'object') return '';
  return (tree.props?.children || []).flat(Infinity).map(texts).join('');
}
const snapshot = { documentId: 'doc', selection: { exact: 'CUE.\n  Café\u00a0and grief,\n\n' } };

test('picker shows exact full quotation and four named checked color choices without saving on color choice', () => {
  const Picker = load(); let saves = 0, selected;
  const tree = Picker({ visible: true, snapshot, colorId: 'sage', theme: THEMES.paper, onColor: id => { selected = id; }, onSave: () => saves++ });
  assert.ok(nodes(tree, 'Text').some(n => texts(n) === snapshot.selection.exact));
  const radios = nodes(tree, 'Pressable').filter(n => n.props.accessibilityRole === 'radio');
  assert.deepEqual(radios.map(n => n.props.accessibilityLabel), ['Yellow', 'Sage', 'Blue', 'Rose']);
  assert.deepEqual(radios.map(n => n.props.accessibilityState.checked), [false, true, false, false]);
  radios[2].props.onPress(); assert.equal(selected, 'blue'); assert.equal(saves, 0);
  nodes(tree, 'Pressable').find(n => n.props.accessibilityLabel === 'Save highlight').props.onPress(); assert.equal(saves, 1);
});

test('Cancel and Android Back discard the draft through the same callback and saving disables duplicate mutation', () => {
  const Picker = load(); let closes = 0, saves = 0;
  let tree = Picker({ visible: true, snapshot, colorId: 'yellow', theme: THEMES.night, onClose: () => closes++, onSave: () => saves++ });
  nodes(tree, 'Modal')[0].props.onRequestClose();
  nodes(tree, 'Pressable').find(n => n.props.accessibilityLabel === 'Cancel highlight').props.onPress();
  assert.equal(closes, 2); assert.equal(saves, 0);
  tree = Picker({ visible: true, snapshot, colorId: 'yellow', saving: true, theme: THEMES.night, onClose: () => closes++, onSave: () => saves++ });
  const save = nodes(tree, 'Pressable').find(n => n.props.accessibilityLabel === 'Save highlight');
  assert.equal(save.props.disabled, true); save.props.onPress(); assert.equal(saves, 0);
  assert.ok(nodes(tree, 'Pressable').filter(n => n.props.accessibilityRole === 'radio').every(n => n.props.disabled));
});

test('picker explains local-only persistence, reports safe errors and keeps quotation outside the source document', () => {
  const Picker = load();
  const tree = Picker({ visible: true, snapshot, colorId: 'rose', theme: THEMES.sepia, error: 'Storage is full. Remove a highlight or free device space.' });
  assert.match(texts(tree), /Saved on this device\. Highlights are not synced or guaranteed backed up\./);
  assert.match(texts(tree), /Storage is full/);
  assert.equal(nodes(tree, 'View').some(n => n.props.accessibilityViewIsModal), true);
  assert.equal(nodes(tree, 'iframe').length, 0);
});
