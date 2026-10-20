const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');
const { THEMES } = require('../../reader/readerConstants');

const model = { items: [
  { id: 'title', kind: 'title', label: 'Title', locationLabel: 'Front matter', frontMatter: true },
  { id: 'cast', kind: 'cast', label: 'Dramatis Personae', locationLabel: 'Front matter', frontMatter: true },
  { id: 'act-i', kind: 'act', act: 1, label: 'Act I', locationLabel: 'Act I' },
  { id: 'prologue', kind: 'prologue', act: 1, parentSectionId: 'act-i', label: 'Prologue', locationLabel: 'Act I, Prologue' },
  { id: 'scene-i', kind: 'scene', act: 1, scene: 1, parentSectionId: 'act-i', label: 'Scene I. A very long place name that must wrap instead of being truncated.', locationLabel: 'Act I, Scene I' },
  { id: 'chorus', kind: 'chorus', act: 1, scene: 1, parentSectionId: 'scene-i', label: 'Chorus', locationLabel: 'Act I, Scene I, Chorus' },
  { id: 'act-ii', kind: 'act', act: 2, label: 'Act II', locationLabel: 'Act II' },
  { id: 'scene-ii', kind: 'scene', act: 2, scene: 1, parentSectionId: 'act-ii', label: 'Scene I', locationLabel: 'Act II, Scene I' },
  { id: 'epilogue', kind: 'epilogue', label: 'Epilogue', locationLabel: 'Epilogue' },
] };

function host(platform = 'android') {
  const file = path.resolve(__dirname, '../../reader/ReaderContentsModal.js');
  assert.ok(fs.existsSync(file), 'the native play contents sheet exists');
  const slots = [];
  let cursor = 0;
  let dirty = false;
  let effects = [];
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const memo = (factory, deps) => {
    const index = cursor++;
    if (!slots[index] || !equal(slots[index].deps, deps)) slots[index] = { value: factory(), deps };
    return slots[index].value;
  };
  const effect = (callback, deps) => {
    const index = cursor++;
    if (!slots[index] || !equal(slots[index].deps, deps)) effects.push(() => {
      slots[index]?.cleanup?.();
      slots[index] = { deps, cleanup: callback() };
    });
  };
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useRef: initial => memo(() => ({ current: initial }), []),
    useMemo: memo,
    useCallback: (callback, deps) => memo(() => callback, deps),
    useEffect: effect,
    useLayoutEffect: effect,
    useState(initial) {
      const state = memo(() => ({ value: typeof initial === 'function' ? initial() : initial }), []);
      return [state.value, next => {
        const value = typeof next === 'function' ? next(state.value) : next;
        if (!Object.is(value, state.value)) { state.value = value; dirty = true; }
      }];
    },
  };
  const focused = [];
  const scrolled = [];
  const native = Object.fromEntries(['Modal', 'Pressable', 'ScrollView', 'Text', 'View'].map(name => [name, name]));
  Object.assign(native, {
    Platform: { OS: platform },
    StyleSheet: { create: styles => styles, hairlineWidth: 1 },
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
    focused, scrolled,
    render(props = {}) {
      let tree;
      let attempts = 0;
      do {
        assert.ok(++attempts < 20, 'contents state settles');
        cursor = 0; effects = []; dirty = false;
        tree = module.exports.default({ visible: true, model, currentSectionId: 'scene-i', theme: THEMES.paper, ready: true, ...props });
        for (const run of effects) run();
      } while (dirty);
      return tree;
    },
    attachScroll(tree) {
      const scroll = nodes(tree, 'ScrollView')[0];
      assignRef(scroll.props.ref, { scrollTo: value => scrolled.push(value) });
      scroll.props.onLayout?.({ nativeEvent: { layout: { y: 0, height: 300 } } });
      return scroll;
    },
  };
}

function nodes(tree, type) {
  if (!tree || typeof tree !== 'object') return [];
  return [...(tree.type === type ? [tree] : []), ...(tree.props?.children || []).flat(Infinity).flatMap(child => nodes(child, type))];
}
function assignRef(ref, value) { if (typeof ref === 'function') ref(value); else ref.current = value; }
function text(tree) { return nodes(tree, 'Text').map(node => node.props.children.flat(Infinity).filter(value => typeof value === 'string' || typeof value === 'number').join('')).join('\n'); }
function control(tree, label) {
  const found = nodes(tree, 'Pressable').find(node => node.props.accessibilityLabel === label);
  assert.ok(found, `the ${label} control is available`);
  return found;
}
function rows(tree) { return nodes(tree, 'Pressable').filter(node => typeof node.props.accessibilityState?.selected === 'boolean'); }
function row(tree, id) {
  const item = model.items.find(item => item.id === id);
  const found = rows(tree).find(node => text(node) === item.label);
  assert.ok(found, `section ${id} has a contents row`);
  return found;
}
function style(value) { return Object.assign({}, ...[typeof value === 'function' ? value({ pressed: false, focused: false }) : value].flat(Infinity).filter(Boolean)); }

test('contents preserves source order, exposes current context and selects exact act or section IDs', () => {
  const sheet = host();
  const selected = [];
  const tree = sheet.render({ onSelect: id => selected.push(id) });
  assert.deepEqual(rows(tree).map(node => text(node)), model.items.filter(item => !item.frontMatter).map(item => item.label));
  assert.equal(row(tree, 'scene-i').props.accessibilityState.selected, true);
  assert.equal(rows(tree).filter(node => node.props.accessibilityState.selected).length, 1);
  assert.match(row(tree, 'scene-i').props.accessibilityLabel, /Act I, Scene I/);
  assert.match(row(tree, 'scene-ii').props.accessibilityLabel, /Act II, Scene I/);
  for (const id of ['act-i', 'prologue', 'chorus', 'epilogue']) row(tree, id).props.onPress();
  assert.deepEqual(selected, ['act-i', 'prologue', 'chorus', 'epilogue']);
  assert.ok(style(row(tree, 'scene-i').props.style).marginLeft > style(row(tree, 'act-i').props.style).marginLeft);
  assert.ok(style(row(tree, 'chorus').props.style).marginLeft > style(row(tree, 'scene-i').props.style).marginLeft);
  assert.equal(style(row(tree, 'prologue').props.style).marginLeft, style(row(tree, 'scene-i').props.style).marginLeft);
  assert.equal(style(row(tree, 'epilogue').props.style).marginLeft, style(row(tree, 'act-i').props.style).marginLeft);
});

test('one front matter disclosure is initially collapsed and expands the original source rows', () => {
  const sheet = host();
  let tree = sheet.render();
  let disclosure = control(tree, 'Front matter');
  assert.equal(disclosure.props.accessibilityState.expanded, false);
  assert.equal(rows(tree).some(node => text(node).includes('Dramatis Personae')), false);
  disclosure.props.onPress();
  tree = sheet.render();
  disclosure = control(tree, 'Front matter');
  assert.equal(disclosure.props.accessibilityState.expanded, true);
  assert.equal(nodes(tree, 'Pressable').filter(node => node.props.accessibilityLabel === 'Front matter').length, 1);
  assert.deepEqual(rows(tree).map(node => text(node)), model.items.map(item => item.label));
  disclosure.props.onPress();
  tree = sheet.render();
  assert.equal(control(tree, 'Front matter').props.accessibilityState.expanded, false);
});

test('opening on front matter expands it and reopening on an act starts collapsed', () => {
  const sheet = host();
  let tree = sheet.render({ visible: false });
  tree = sheet.render({ currentSectionId: 'cast' });
  assert.equal(control(tree, 'Front matter').props.accessibilityState.expanded, true);
  assert.equal(row(tree, 'cast').props.accessibilityState.selected, true);
  sheet.render({ visible: false, currentSectionId: 'cast' });
  tree = sheet.render({ currentSectionId: 'act-i' });
  assert.equal(control(tree, 'Front matter').props.accessibilityState.expanded, false);
});

test('current rows scroll into view after layout and receive modal focus only on show', () => {
  const sheet = host();
  let tree = sheet.render();
  sheet.attachScroll(tree);
  const selected = row(tree, 'scene-i');
  assignRef(selected.props.ref, { nativeTag: 29 });
  selected.props.onLayout({ nativeEvent: { layout: { y: 880, height: 90 } } });
  assert.ok(sheet.scrolled.length >= 1);
  assert.ok(sheet.scrolled.at(-1).y <= 880 && sheet.scrolled.at(-1).y >= 600);
  assert.equal(sheet.scrolled.at(-1).animated, false);
  assert.deepEqual(sheet.focused, []);
  nodes(tree, 'Modal')[0].props.onShow();
  assert.deepEqual(sheet.focused, [29]);
  tree = sheet.render({ theme: THEMES.night });
  assert.deepEqual(sheet.focused, [29], 'theme changes keep accessibility focus in place');
});

test('modal show focuses the heading while the selected row is unavailable or not ready', () => {
  for (const ready of [true, false]) {
    const sheet = host();
    const tree = sheet.render({ ready });
    const heading = nodes(tree, 'Text').find(node => node.props.accessibilityRole === 'header');
    assignRef(heading.props.ref, { nativeTag: 17 });
    assignRef(row(tree, 'scene-i').props.ref, { nativeTag: 29 });
    if (!ready) row(tree, 'scene-i').props.onLayout({ nativeEvent: { layout: { y: 100, height: 70 } } });
    nodes(tree, 'Modal')[0].props.onShow();
    assert.deepEqual(sheet.focused, [17]);
  }
});

test('pending document readiness prevents row selection while Close, Back and escape remain usable', () => {
  const sheet = host();
  const selected = [];
  let closes = 0;
  let dismisses = 0;
  const tree = sheet.render({ ready: false, onSelect: id => selected.push(id), onClose: () => closes++, onDismiss: () => dismisses++ });
  for (const section of rows(tree)) {
    assert.equal(section.props.disabled, true);
    assert.equal(section.props.accessibilityState.disabled, true);
    section.props.onPress();
  }
  assert.deepEqual(selected, []);
  const modal = nodes(tree, 'Modal')[0];
  assert.equal(modal.props.transparent, true);
  assert.equal(modal.props.animationType, 'none');
  modal.props.onRequestClose();
  control(tree, 'Close contents').props.onPress();
  nodes(tree, 'View').find(node => node.props.accessibilityViewIsModal).props.onAccessibilityEscape();
  modal.props.onDismiss();
  assert.equal(closes, 3);
  assert.equal(dismisses, 1);
});

test('heading and Close are pinned above scrollable rows, with safe insets, themed wrapping and large targets', () => {
  const sheet = host();
  const tree = sheet.render({ theme: THEMES.night });
  const scroll = nodes(tree, 'ScrollView')[0];
  assert.equal(nodes(scroll, 'Text').some(node => node.props.accessibilityRole === 'header'), false);
  assert.equal(nodes(scroll, 'Pressable').some(node => node.props.accessibilityLabel === 'Close contents'), false);
  const panel = nodes(tree, 'View').find(node => node.props.accessibilityViewIsModal);
  assert.equal(style(panel.props.style).paddingBottom, 24);
  assert.equal(style(panel.props.style).backgroundColor, THEMES.night.panel);
  assert.equal(style(panel.props.style).maxHeight, '85%');
  assert.equal(style(panel.props.style).maxWidth, 560);
  for (const button of nodes(tree, 'Pressable')) {
    assert.ok(style(button.props.style).minHeight >= 48);
    assert.ok(style(button.props.style).minWidth >= 48);
    assert.equal(style(button.props.style).height, undefined);
    for (const label of nodes(button, 'Text')) {
      assert.equal(label.props.numberOfLines, undefined, 'contents labels can grow with font scaling');
      assert.equal(style(label.props.style).height, undefined);
    }
  }
  assert.equal(style(nodes(row(tree, 'scene-i'), 'Text')[0].props.style).color, THEMES.night.text);
});
