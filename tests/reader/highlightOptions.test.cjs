const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');
const { THEMES } = require('../../reader/readerConstants');
const nodes = (tree, type) => !tree || typeof tree !== 'object' ? [] : [...(tree.type === type ? [tree] : []), ...(tree.props?.children || []).flat(Infinity).flatMap(child => nodes(child, type))];
function load() {
  const file = path.resolve(__dirname, '../../reader/HighlightOptionsModal.js');
  assert.ok(fs.existsSync(file), 'the shared production options menu exists');
  const focused = [];
  const React = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), useRef: () => ({ current: { nativeTag: 7 } }) };
  const native = Object.fromEntries(['Modal', 'Pressable', 'Text', 'View', 'ScrollView'].map(name => [name, name]));
  Object.assign(native, { StyleSheet: { create: value => value }, AccessibilityInfo: { setAccessibilityFocus: value => focused.push(value) }, findNodeHandle: value => value?.nativeTag });
  const module = { exports: {} };
  const code = babel.transformFileSync(file, { babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: file })(name => name === 'react' ? React : name === 'react-native' ? native : name === 'react-native-safe-area-context' ? { useSafeAreaInsets: () => ({ bottom: 24 }) } : require(path.resolve(path.dirname(file), name)), module, module.exports);
  return { Menu: module.exports.default, focused };
}
test('options expose existing edit/remove actions with comfortable targets, while Back and close only cancel', () => {
  const { Menu, focused } = load(), calls = [];
  for (const theme of Object.values(THEMES)) {
    const tree = Menu({ visible: true, theme, onEdit: () => calls.push('edit'), onRemove: () => calls.push('remove'), onClose: () => calls.push('close') });
    const modal = nodes(tree, 'Modal')[0]; modal.props.onShow(); assert.ok(focused.includes(7));
    const buttons = nodes(tree, 'Pressable');
    for (const button of buttons) {
      const expected = button.props.accessibilityLabel === 'Remove highlight' ? theme.highlightDanger : theme.highlightAction;
      assert.equal(nodes(button, 'Text')[0].props.style[1].color, expected);
    }
    for (const button of buttons.filter(node => ['Edit color', 'Remove highlight', 'Close highlight options'].includes(node.props.accessibilityLabel))) {
      const style = Object.assign({}, ...[typeof button.props.style === 'function' ? button.props.style({ pressed: false }) : button.props.style].flat(Infinity).filter(Boolean));
      assert.ok(style.minHeight >= 48); assert.equal(button.props.accessibilityRole, 'button');
    }
    modal.props.onRequestClose(); buttons.find(node => node.props.accessibilityLabel === 'Close highlight options').props.onPress();
    buttons.find(node => node.props.accessibilityLabel === 'Edit color').props.onPress();
    buttons.find(node => node.props.accessibilityLabel === 'Remove highlight').props.onPress();
  }
  assert.deepEqual(calls, ['close', 'close', 'edit', 'remove', 'close', 'close', 'edit', 'remove', 'close', 'close', 'edit', 'remove']);
});
test('an unresolved entry disables recolor but retains explicit removal; blocked actions never trap Back or close', () => {
  const { Menu } = load(), calls = [];
  let tree = Menu({ visible: true, theme: THEMES.paper, canEdit: false, onEdit: () => calls.push('edit'), onRemove: () => calls.push('remove') });
  let buttons = nodes(tree, 'Pressable');
  assert.equal(buttons.find(node => node.props.accessibilityLabel === 'Edit color').props.disabled, true);
  buttons.find(node => node.props.accessibilityLabel === 'Edit color').props.onPress();
  buttons.find(node => node.props.accessibilityLabel === 'Remove highlight').props.onPress();
  assert.deepEqual(calls, ['remove']);
  tree = Menu({ visible: true, theme: THEMES.night, disabled: true, onEdit: () => calls.push('edit'), onRemove: () => calls.push('remove'), onClose: () => calls.push('close') });
  buttons = nodes(tree, 'Pressable'); for (const button of buttons) button.props.onPress();
  assert.equal(buttons.find(node => node.props.accessibilityLabel === 'Close highlight options').props.disabled, undefined);
  nodes(tree, 'Modal')[0].props.onRequestClose(); assert.deepEqual(calls, ['remove', 'close', 'close']);
});
