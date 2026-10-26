const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');
const { THEMES } = require('../../reader/readerConstants');
const nodes = (tree, type) => !tree || typeof tree !== 'object' ? [] : [...(tree.type === type ? [tree] : []), ...(tree.props?.children || []).flat(Infinity).flatMap(child => nodes(child, type))];
const text = tree => typeof tree === 'string' ? tree : !tree || typeof tree !== 'object' ? '' : (tree.props?.children || []).flat(Infinity).map(text).join('');
function host() {
  const file = path.resolve(__dirname, '../../reader/HighlightStorageStatus.js');
  assert.ok(fs.existsSync(file), 'the compact production storage status exists');
  let cursor = 0, restored = 0;
  const slots = [];
  const React = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useRef: value => { const i = cursor++; return slots[i] || (slots[i] = { current: value }); },
    useState: value => { const i = cursor++; if (!slots[i]) slots[i] = { value }; return [slots[i].value, next => { slots[i].value = next; }]; } };
  const native = Object.fromEntries(['Modal', 'Pressable', 'Text', 'View', 'ScrollView'].map(name => [name, name]));
  Object.assign(native, { StyleSheet: { create: value => value }, AccessibilityInfo: { setAccessibilityFocus() {} }, findNodeHandle: () => null });
  const module = { exports: {} };
  const deps = { react: React, 'react-native': native, './useReaderModalFocus': { __esModule: true, default: () => ({ triggerRef: { current: null }, restoreAfterClose: () => restored++, onDismiss() {} }) } };
  const code = babel.transformFileSync(file, { babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: file })(name => deps[name] || require(path.resolve(path.dirname(file), name)), module, module.exports);
  return { render(props = {}) { cursor = 0; return module.exports.default({ theme: THEMES.night, ...props }); }, get restored() { return restored; } };
}

test('routine storage and synchronization information never interrupts the overview', () => {
  const h = host();
  for (const props of [{}, { information: 'Saved on this device. Highlights are not synced or guaranteed backed up.' }]) {
    const tree = h.render(props);
    assert.equal(tree, null);
    assert.equal(nodes(tree, 'Modal').length, 0);
    assert.equal(nodes(tree, 'Pressable').length, 0);
    assert.doesNotMatch(text(tree), /not synced|backed up|Highlight storage/);
  }
});

test('genuine failure remains accessible without a synchronization control or false confirmation', () => {
  const h = host(); let retries = 0;
  let tree = h.render({ label: 'Saved on this device · Waiting to sync', error: 'Synchronization failed.', onRetry: () => retries++ });
  assert.doesNotMatch(text(tree), /Waiting to sync|Saved on this device/); assert.match(text(tree), /Synchronization failed/);
  assert.equal(nodes(tree, 'Pressable').length, 0);
  assert.equal(retries, 0);
  assert.ok(nodes(tree, 'Text').some(node => node.props.accessibilityRole === 'alert'));
  tree = h.render({ label: null }); assert.equal(tree, null, 'confirmed quiet state is controlled by the caller');
});
