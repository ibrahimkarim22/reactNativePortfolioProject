const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');
const { createReaderPreferenceStore, PREFERENCE_KEY } = require('../../reader/readerPreferences');

const root = path.resolve(__dirname, '../..');
const defaults = { schemaVersion: 1, fontId: 'literata', fontSize: 20, lineSpacing: 'comfortable', theme: 'paper' };

function fixture() {
  return {
    slug: 'small-play', name: 'A Small Play',
    play: { id: 'small-play', title: 'A Small Play', schemaVersion: '2.0.0', contentVersion: 'screen-fixture-v1', canonicalTextVersion: '1', sections: [{ id: 'front', kind: 'frontmatter' }] },
    sections: [{
      work: { id: 'small-play' }, contentVersion: 'screen-fixture-v1', canonicalTextVersion: '1', section: { id: 'front', kind: 'frontmatter' },
      content: [
        { id: 'title', type: 'heading', tag: 'h2', text: 'A SMALL PLAY', separatorAfter: '\n\n', classes: [], spans: [] },
        { id: 'speech', type: 'paragraph', tag: 'p', text: 'SPEAKER.\nA line that remains in place.', separatorAfter: '', classes: [], spans: [] },
      ],
    }],
  };
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const settle = () => new Promise(resolve => setImmediate(resolve));

// Run the production screen, real document generator and real preference store.
// React Native views/navigation/asset IO are the device boundaries; this host
// preserves hook lifetimes and applies state-triggered renders between effects.
async function host({ selectedEntry = fixture(), stored = defaults } = {}) {
  const storage = new Map([[PREFERENCE_KEY, JSON.stringify(stored)]]);
  const store = createReaderPreferenceStore({ getItem: async key => storage.get(key) ?? null, setItem: async (key, value) => storage.set(key, value) });
  await store.hydrate();
  const file = path.join(root, 'reader/ReaderScreen.js');
  const slots = [];
  let cursor = 0;
  let effects = [];
  let dirty = false;
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
    useState: initial => {
      const slot = memo(() => ({ value: typeof initial === 'function' ? initial() : initial }), []);
      return [slot.value, next => { const value = typeof next === 'function' ? next(slot.value) : next; if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; } }];
    },
  };
  const fonts = [];
  const focused = [];
  const frames = [];
  const lookups = [];
  let options;
  let backs = 0;
  let focusCleanup;
  const navigation = { setOptions: value => { options = value; }, goBack: () => backs++ };
  const usePreferences = () => ({ ...store.getSnapshot(), update: store.update, reset: store.reset, retry: store.retry, flush: store.flush });
  const native = Object.fromEntries(['Pressable', 'Text', 'View', 'ActivityIndicator'].map(name => [name, name]));
  Object.assign(native, {
    Platform: { OS: 'android' },
    StyleSheet: { create: styles => styles, absoluteFillObject: {}, hairlineWidth: 1 },
    AccessibilityInfo: { setAccessibilityFocus: target => focused.push(target) },
    findNodeHandle: target => target?.nativeTag ?? null,
    StatusBar: { pushStackEntry: entry => entry, popStackEntry() {} },
    useWindowDimensions: () => ({ width: 393, height: 873, fontScale: 1 }),
  });
  const dependencies = {
    react: React,
    'react-native': native,
    '@react-navigation/native': { useNavigation: () => navigation, useFocusEffect: callback => effect(() => {
      focusCleanup = callback();
      return () => { focusCleanup?.(); focusCleanup = undefined; };
    }, [callback]) },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }) },
    '../Componenets/Loader': 'Loader',
    '../shared/localPlayService': { getLocalPlayEntry: id => { lookups.push(id); return id == null || id === selectedEntry?.slug ? selectedEntry : undefined; } },
    './ReaderSurface': 'ReaderSurface',
    './ReaderAppearanceModal': 'ReaderAppearanceModal',
    './useReaderPreferences': { __esModule: true, default: usePreferences, useReaderPreferences: usePreferences },
    './readerFonts': { loadReaderFont: fontId => { const pending = deferred(); fonts.push({ fontId, ...pending }); return pending.promise; } },
  };
  const code = babel.transformFileSync(file, { babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
  const module = { exports: {} };
  const localRequire = specifier => {
    if (specifier in dependencies) return dependencies[specifier];
    if (specifier === './useReaderModalFocus') {
      const hookFile = path.join(root, 'reader/useReaderModalFocus.js');
      const hookCode = babel.transformFileSync(hookFile, { babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'] }).code;
      const hook = { exports: {} };
      vm.runInThisContext('(function(require,module,exports,requestAnimationFrame,cancelAnimationFrame){' + hookCode + '\n})', { filename: hookFile })(
        localRequire, hook, hook.exports, callback => { frames.push(callback); return frames.length; }, () => {},
      );
      return hook.exports;
    }
    return require(path.resolve(path.dirname(file), specifier));
  };
  vm.runInThisContext('(function(require,module,exports,requestAnimationFrame,cancelAnimationFrame){' + code + '\n})', { filename: file })(
    localRequire, module, module.exports,
    callback => { frames.push(callback); return frames.length; },
    () => {},
  );
  return {
    store, storage, fonts, focused, lookups,
    get options() { return options; },
    get backs() { return backs; },
    blur() { focusCleanup?.(); focusCleanup = undefined; },
    frames() { while (frames.length) frames.shift()(); },
    render(props = { id: 'small-play' }) {
      let tree;
      let attempts = 0;
      do {
        if (++attempts > 20) throw new Error('The screen did not settle after state updates.');
        cursor = 0; effects = []; dirty = false;
        tree = module.exports.default(props);
        for (const run of effects) run();
      } while (dirty);
      return tree;
    },
  };
}

function nodes(tree, type) {
  if (!tree || typeof tree !== 'object') return [];
  return [...(tree.type === type ? [tree] : []), ...(tree.props?.children || []).flat(Infinity).flatMap(child => nodes(child, type))];
}
function appearanceButton(screen) {
  assert.equal(typeof screen.options?.headerRight, 'function', 'the reader header exposes an appearance control');
  const tree = screen.options.headerRight({ tintColor: '#242723' });
  const button = nodes(tree, 'Pressable').find(node => /appearance/i.test(node.props.accessibilityLabel || ''));
  assert.ok(button, 'appearance control has an accessible name');
  assert.equal(button.props.accessibilityRole, 'button');
  const buttonStyle = Object.assign({}, ...[button.props.style].flat(Infinity).filter(Boolean));
  assert.ok(buttonStyle.minHeight >= 48 && buttonStyle.minWidth >= 48, 'the header control has a usable touch target');
  return button;
}

test('appearance choices update the reading document in place and reset restores the page defaults', async () => {
  const screen = await host();
  let tree = screen.render();
  const firstPage = nodes(tree, 'ReaderSurface')[0];
  assert.ok(firstPage.props.document.canonical.text.includes('A line that remains in place.'), 'the screen uses the real canonical document builder');
  appearanceButton(screen).props.onPress();
  tree = screen.render();
  let modal = nodes(tree, 'ReaderAppearanceModal')[0];
  assert.equal(modal.props.visible, true);
  modal.props.onChange({ theme: 'night', fontSize: 24 });
  tree = screen.render();
  let page = nodes(tree, 'ReaderSurface')[0];
  assert.equal(page.props.preferences.theme, 'night');
  assert.equal(page.props.preferences.fontSize, 24);
  assert.equal(page.props.document, firstPage.props.document, 'appearance changes retain the generated document and its identity');
  assert.equal(screen.store.getSnapshot().preferences.theme, 'night', 'changes flow into the real isolated store');
  modal = nodes(tree, 'ReaderAppearanceModal')[0];
  modal.props.onReset();
  tree = screen.render();
  page = nodes(tree, 'ReaderSurface')[0];
  assert.deepEqual(page.props.preferences, defaults);
  assert.equal(page.props.document, firstPage.props.document);
  await screen.store.flush();
  assert.deepEqual(JSON.parse(screen.storage.get(PREFERENCE_KEY)), defaults);
});

test('closing appearance restores the named header control and Back retains native navigation', async () => {
  const screen = await host();
  let tree = screen.render();
  const appearance = appearanceButton(screen);
  appearance.props.ref.current = { nativeTag: 26 };
  appearance.props.onPress();
  tree = screen.render();
  nodes(tree, 'ReaderAppearanceModal')[0].props.onClose();
  screen.frames();
  assert.deepEqual(screen.focused, [], 'Aa must not receive focus before the modal closed commit');
  tree = screen.render();
  screen.frames();
  assert.equal(nodes(tree, 'ReaderAppearanceModal')[0].props.visible, false);
  assert.deepEqual(screen.focused, [26]);
  const back = nodes(screen.options.headerLeft({ tintColor: '#242723' }), 'Pressable')[0];
  assert.equal(back.props.accessibilityRole, 'button');
  assert.match(back.props.accessibilityLabel, /back/i);
  back.props.onPress();
  assert.equal(screen.backs, 1);
});

test('late font completion cannot replace the newly selected family on the mounted page', async () => {
  const screen = await host();
  let tree = screen.render();
  const firstPage = nodes(tree, 'ReaderSurface')[0];
  const older = screen.fonts.find(request => request.fontId === 'literata');
  assert.ok(older, 'the valid local document starts its selected typeface load');
  appearanceButton(screen).props.onPress();
  tree = screen.render();
  nodes(tree, 'ReaderAppearanceModal')[0].props.onChange({ fontId: 'source-sans-3' });
  screen.render();
  const newer = screen.fonts.find(request => request.fontId === 'source-sans-3');
  assert.ok(newer);
  const sansFaces = [{ weight: 400, style: 'normal', data: 'U1NT' }];
  newer.resolve({ fontId: 'source-sans-3', faces: sansFaces });
  await settle();
  tree = screen.render();
  assert.deepEqual(nodes(tree, 'ReaderSurface')[0].props.fontFaces, sansFaces);
  older.resolve({ fontId: 'literata', faces: [{ weight: 400, style: 'normal', data: 'T0xE' }] });
  await settle();
  tree = screen.render();
  const page = nodes(tree, 'ReaderSurface')[0];
  assert.equal(page.props.preferences.fontId, 'source-sans-3');
  assert.deepEqual(page.props.fontFaces, sansFaces, 'an older asset completion cannot replace the new family');
  assert.equal(page.props.document, firstPage.props.document);
});

test('leaving the reader cancels a pending Aa focus return during the native transition', async () => {
  const screen = await host();
  screen.render();
  const appearance = appearanceButton(screen);
  appearance.props.ref.current = { nativeTag: 26 };
  appearance.props.onPress();
  let tree = screen.render();
  nodes(tree, 'ReaderAppearanceModal')[0].props.onClose();
  screen.render();
  screen.blur();
  screen.frames();
  assert.deepEqual(screen.focused, [], 'an outgoing reader must not take focus from the destination');
});

test('missing or unknown route selections show a content error before loading any font', async () => {
  for (const id of [undefined, '', 'missing-play']) {
    const screen = await host();
    const tree = screen.render({ id });
    assert.equal(nodes(tree, 'ReaderSurface').length, 0);
    assert.ok(nodes(tree, 'Text').some(node => node.props.children.join('').includes('Unable to open this play')));
    assert.equal(screen.fonts.length, 0, 'invalid content must not start asset loading');
    if (id == null || id === '') assert.equal(screen.lookups.length, 0, 'invalid ids must not reach the service default');
  }
});

test('a selected play with invalid canonical content fails visibly before loading fonts', async () => {
  const entry = fixture();
  entry.sections[0].content[1].id = 'title';
  const screen = await host({ selectedEntry: entry });
  const tree = screen.render();
  assert.equal(nodes(tree, 'ReaderSurface').length, 0);
  assert.ok(nodes(tree, 'Text').some(node => node.props.children.join('').includes('Unable to open this play')));
  assert.equal(screen.fonts.length, 0, 'a failed canonical document must not start asset loading');
});
