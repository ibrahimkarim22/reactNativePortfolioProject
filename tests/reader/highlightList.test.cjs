const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');
const { THEMES } = require('../../reader/readerConstants');
function load() {
  const file = path.resolve(__dirname, '../../reader/ReaderHighlightsModal.js');
  assert.ok(fs.existsSync(file), 'production saved-highlights panel exists');
  const React = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), useRef: () => ({ current: null }) };
  const native = Object.fromEntries(['Modal', 'Pressable', 'ScrollView', 'Text', 'View', 'ActivityIndicator'].map(n => [n, n]));
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
function nodes(tree, type) { return !tree || typeof tree !== 'object' ? [] : [...(tree.type === type ? [tree] : []), ...(tree.props?.children || []).flat(Infinity).flatMap(x => nodes(x, type))]; }
function texts(tree) { return typeof tree === 'string' ? tree : !tree || typeof tree !== 'object' ? '' : (tree.props?.children || []).flat(Infinity).map(texts).join(''); }
const items = [
  { id: 'a', quotation: 'FIRST.\nThe exact passage.', locationLabel: 'Act I, Scene II', colorId: 'sage', status: 'resolved' },
  { id: 'b', quotation: 'An older quotation', locationLabel: 'Older text version', colorId: 'blue', status: 'unresolved' },
  { id: 'c', quotation: 'Overlapping quotation', locationLabel: 'Act II', colorId: 'rose', status: 'conflict' },
  { id: 'd', status: 'unreadable' },
];
test('list displays exact quotations and local-only disclosure, with unavailable records retained and disabled', () => {
  const Panel = load(); const shown = [], edited = [], requested = [];
  const tree = Panel({ visible: true, items, theme: THEMES.paper, onShow: id => shown.push(id), onEdit: id => edited.push(id), onRequestRemove: id => requested.push(id) });
  assert.match(texts(tree), /Saved on this device\. Highlights are not synced or guaranteed backed up\./);
  assert.ok(nodes(tree, 'Text').some(n => texts(n) === items[0].quotation));
  const buttons = nodes(tree, 'Pressable');
  buttons.find(n => n.props.accessibilityLabel === 'Show passage 1').props.onPress();
  buttons.find(n => n.props.accessibilityLabel === 'Edit color 1').props.onPress();
  assert.deepEqual(shown, ['a']); assert.deepEqual(edited, ['a']);
  for (const label of ['Show passage 2', 'Show passage 3', 'Edit color 2', 'Edit color 3']) assert.equal(buttons.find(n => n.props.accessibilityLabel === label).props.disabled, true);
  buttons.find(n => n.props.accessibilityLabel === 'Remove highlight 4').props.onPress(); assert.deepEqual(requested, ['d']);
  assert.match(texts(tree), /unavailable/i); assert.match(texts(tree), /overlap/i);
});
test('removal requires explicit confirmation; cancellation and Android Back never mutate a record', () => {
  const Panel = load(); let removed = 0, cancelled = 0, closed = 0;
  let tree = Panel({ visible: true, items, theme: THEMES.night, removingId: 'a', onConfirmRemove: () => removed++, onCancelRemove: () => cancelled++, onClose: () => closed++ });
  assert.equal(removed, 0);
  nodes(tree, 'Modal')[0].props.onRequestClose(); assert.equal(cancelled, 1); assert.equal(closed, 0);
  nodes(tree, 'Pressable').find(n => n.props.accessibilityLabel === 'Confirm remove highlight').props.onPress(); assert.equal(removed, 1);
  tree = Panel({ visible: true, items, theme: THEMES.night, saving: true, removingId: 'a', onConfirmRemove: () => removed++, onCancelRemove: () => cancelled++ });
  const remove = nodes(tree, 'Pressable').find(n => n.props.accessibilityLabel === 'Confirm remove highlight');
  assert.equal(remove.props.disabled, true); remove.props.onPress(); assert.equal(removed, 1);
});
test('storage and paint errors expose Retry, all content remains in a scrollable native modal', () => {
  const Panel = load(); let retries = 0;
  const tree = Panel({ visible: true, items, theme: THEMES.sepia, error: 'Highlights could not be loaded. Retry.', renderError: 'Painting is unavailable.', onRetry: () => retries++ });
  assert.match(texts(tree), /could not be loaded/); assert.match(texts(tree), /Painting is unavailable/);
  nodes(tree, 'Pressable').find(n => n.props.accessibilityLabel === 'Retry highlights').props.onPress(); assert.equal(retries, 1);
  assert.equal(nodes(tree, 'View').some(n => n.props.accessibilityViewIsModal), true);
  assert.ok(nodes(tree, 'ScrollView').length);
});

test('Show passage stays unavailable until current paint is acknowledged, without disabling cancellation', () => {
  const Panel = load(); const tree = Panel({ visible: true, items, theme: THEMES.paper, painting: true });
  assert.equal(nodes(tree, 'Pressable').find(n => n.props.accessibilityLabel === 'Show passage 1').props.disabled, true);
  assert.equal(nodes(tree, 'Pressable').find(n => n.props.accessibilityLabel === 'Close highlights').props.disabled, false);
});
