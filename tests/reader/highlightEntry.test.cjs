const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');
const { THEMES } = require('../../reader/readerConstants');
const nodes = (tree, type) => !tree || typeof tree !== 'object' ? [] : [...(tree.type === type ? [tree] : []), ...(tree.props?.children || []).flat(Infinity).flatMap(child => nodes(child, type))];
const text = tree => typeof tree === 'string' ? tree : !tree || typeof tree !== 'object' ? '' : (tree.props?.children || []).flat(Infinity).map(text).join('');
const style = node => Object.assign({}, ...[typeof node.props.style === 'function' ? node.props.style({ pressed: false }) : node.props.style].flat(Infinity).filter(Boolean));
function host() {
  const file = path.resolve(__dirname, '../../reader/HighlightEntry.js');
  assert.ok(fs.existsSync(file), 'the shared production highlight entry exists');
  let cursor = 0;
  const slots = [];
  const React = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useRef: initial => { const i = cursor++; if (!slots[i]) slots[i] = { current: initial }; return slots[i]; },
    useState: initial => { const i = cursor++; if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }]; } };
  const native = Object.fromEntries(['View', 'Text', 'Pressable'].map(name => [name, name]));
  native.StyleSheet = { create: value => value };
  const module = { exports: {} };
  const code = babel.transformFileSync(file, { babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: file })(name => name === 'react' ? React : name === 'react-native' ? native : require(path.resolve(path.dirname(file), name)), module, module.exports);
  return { render(props) { cursor = 0; return module.exports.default({ theme: THEMES.paper, ...props }); } };
}
const item = { id: 'first', quotation: 'A short exact quotation.', locationLabel: 'Act I · Scene II', colorId: 'sage', status: 'resolved' };

test('short quotations stay fully visible with a light primary action and only an accessible options trigger beside location', () => {
  const h = host(), shown = [], options = [], triggers = [];
  const tree = h.render({ item, onShow: id => shown.push(id), onOptions: id => options.push(id), onTrigger: node => triggers.push(node) });
  assert.ok(nodes(tree, 'Text').some(node => text(node) === item.quotation));
  assert.match(text(tree), /Act I · Scene II/); assert.match(text(tree), /Sage/);
  const buttons = nodes(tree, 'Pressable');
  assert.deepEqual(buttons.map(node => node.props.accessibilityLabel).sort(), ['Highlight options', 'Show passage 1']);
  const show = buttons.find(node => node.props.accessibilityLabel === 'Show passage 1');
  assert.ok(style(show).minHeight >= 48); assert.ok(!style(show).borderWidth);
  show.props.onPress(); assert.deepEqual(shown, ['first']);
  const more = buttons.find(node => node.props.accessibilityLabel === 'Highlight options');
  assert.ok(style(more).minHeight >= 48 && style(more).minWidth >= 48);
  more.props.ref.current = { nativeTag: 9 }; more.props.onPress();
  assert.deepEqual(options, ['first']); assert.deepEqual(triggers, [{ nativeTag: 9 }]);
});
test('long quotes use four visible lines and open the exact parent quotation without changing original data', () => {
  const h = host(), original = 'FIRST.\nSecond line\nThird line\nFourth line\nFinal exact line.', quoted = { ...item, quotation: original }, opened = [];
  let tree = h.render({ item: quoted, onFullQuote: id => opened.push(id) });
  const quote = nodes(tree, 'Text').find(node => text(node) === original);
  assert.equal(quote.props.numberOfLines, 4);
  nodes(tree, 'Pressable').find(node => node.props.accessibilityLabel === 'View full quote 1').props.onPress();
  assert.deepEqual(opened, ['first']); assert.equal(quoted.quotation, original);
  tree = h.render({ item: quoted, fullQuotation: true });
  assert.equal(nodes(tree, 'Text').find(node => text(node) === original).props.numberOfLines, undefined);
  assert.ok(!nodes(tree, 'Pressable').some(node => /View full quote/.test(node.props.accessibilityLabel)));
});
test('native wrapping reveals full-quote access, reflow may hide it and an obsolete layout cannot affect a replacement record', () => {
  const h = host();
  let tree = h.render({ item });
  const layout = nodes(tree, 'Text').find(node => text(node) === item.quotation).props.onTextLayout;
  layout({ nativeEvent: { lines: [{}, {}, {}, {}] } });
  tree = h.render({ item }); assert.ok(nodes(tree, 'Pressable').some(node => /View full quote/.test(node.props.accessibilityLabel)));
  nodes(tree, 'Text').find(node => text(node) === item.quotation).props.onTextLayout({ nativeEvent: { lines: [{}, {}] } });
  tree = h.render({ item }); assert.ok(!nodes(tree, 'Pressable').some(node => /View full quote/.test(node.props.accessibilityLabel)));
  const next = { ...item, id: 'second', quotation: 'New short quotation.' };
  h.render({ item: next }); layout({ nativeEvent: { lines: [{}, {}, {}, {}, {}] } });
  tree = h.render({ item: next }); assert.ok(!nodes(tree, 'Pressable').some(node => /View full quote/.test(node.props.accessibilityLabel)));
});
test('unavailable entries retain options without a Show action, while saving and painting cannot dispatch disabled controls', () => {
  const h = host(), calls = [];
  let tree = h.render({ item: { id: 'broken', status: 'unreadable' }, onShow: () => calls.push('show') });
  assert.match(text(tree), /unavailable/); assert.ok(!nodes(tree, 'Pressable').some(node => /Show passage/.test(node.props.accessibilityLabel)));
  assert.doesNotMatch(text(tree), /on this device|synced|backed up/);
  for (const props of [{ saving: true }, { disabled: true }, { painting: true }, { item: { ...item, status: 'unresolved' } }]) {
    tree = h.render({ item, onShow: () => calls.push('show'), ...props });
    const show = nodes(tree, 'Pressable').find(node => /Show passage/.test(node.props.accessibilityLabel));
    assert.equal(show.props.disabled, true); show.props.onPress();
  }
  assert.deepEqual(calls, []);
});

test('a confirmation-only entry cannot activate absent Show, options or full-quote handlers', () => {
  const h = host();
  const tree = h.render({ item: { ...item, quotation: 'one\ntwo\nthree\nfour\nfive' } });
  for (const button of nodes(tree, 'Pressable')) assert.equal(button.props.disabled, true);
});

test('passage and full-quotation actions use distinct theme colors without opacity loss or smaller targets', () => {
  const h = host();
  for (const theme of Object.values(THEMES)) {
    const quoted = { ...item, quotation: 'one\ntwo\nthree\nfour\nfive' };
    const tree = h.render({ item: quoted, theme, onShow() {}, onOptions() {}, onFullQuote() {} });
    const show = nodes(tree, 'Pressable').find(node => node.props.accessibilityLabel === 'Show passage 1');
    const full = nodes(tree, 'Pressable').find(node => node.props.accessibilityLabel === 'View full quote 1');
    assert.equal(nodes(show, 'Text')[0].props.style[1].color, theme.highlightPrimary);
    assert.equal(nodes(full, 'Text')[0].props.style[1].color, theme.highlightSecondary);
    assert.notEqual(nodes(show, 'Text')[0].props.style[1].color, nodes(full, 'Text')[0].props.style[1].color);
    for (const action of [show, full]) {
      assert.equal(typeof action.props.style, 'function');
      assert.ok(style(action).minHeight >= 48);
      assert.equal(Object.assign({}, ...action.props.style({ pressed: true }).filter(Boolean)).backgroundColor, theme.highlightPressed);
      assert.equal(Object.assign({}, ...action.props.style({ pressed: false }).filter(Boolean)).opacity, undefined);
    }
    const more = nodes(tree, 'Pressable').find(node => node.props.accessibilityLabel === 'Highlight options');
    assert.equal(nodes(more, 'Text')[0].props.style[1].color, theme.highlightAction);
    const blocked = h.render({ item: quoted, theme, saving: true, onShow() {}, onOptions() {}, onFullQuote() {} });
    for (const action of nodes(blocked, 'Pressable')) {
      assert.equal(action.props.disabled, true);
      assert.equal(nodes(action, 'Text')[0].props.style[1].color, theme.highlightActionDisabled);
      assert.equal(Object.assign({}, ...action.props.style({ pressed: true }).filter(Boolean)).backgroundColor, 'transparent');
      assert.equal(Object.assign({}, ...action.props.style({ pressed: false }).filter(Boolean)).opacity, undefined);
    }
  }
});
