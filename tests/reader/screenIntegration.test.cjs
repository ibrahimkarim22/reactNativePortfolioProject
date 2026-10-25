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
async function host({ selectedEntry = fixture(), stored = defaults, createHighlight, passageStatus = { opening: false, error: null }, delayPreferences = false } = {}) {
  const storage = new Map([[PREFERENCE_KEY, JSON.stringify(stored)]]);
  const store = createReaderPreferenceStore({ getItem: async key => storage.get(key) ?? null, setItem: async (key, value) => storage.set(key, value) });
  if (!delayPreferences) await store.hydrate();
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
  const focusCleanups = new Set();
  let highlightSnapshot;
  const highlightCalls = [];
  const alerts = [];
  let passageCancellations = 0;
  const cancelPassage = () => { passageCancellations++; };
  const highlightSession = {
    getSnapshot: () => highlightSnapshot,
    create: async (...args) => { highlightCalls.push(['create', ...args]); return createHighlight ? createHighlight(...args) : { kind: 'created', record: { id: 'new-highlight' } }; },
    recreate: async (...args) => { highlightCalls.push(['recreate', ...args]); },
    recolor: async (...args) => { highlightCalls.push(['recolor', ...args]); },
    remove: async (...args) => { highlightCalls.push(['remove', ...args]); },
    show: async (...args) => { highlightCalls.push(['show', ...args]); },
    retry: async (...args) => { highlightCalls.push(['retry', ...args]); },
    cancelPending: async (...args) => { highlightCalls.push(['cancelPending', ...args]); },
    resolveSyncConflict: async (...args) => { highlightCalls.push(['resolveSyncConflict', ...args]); },
  };
  const navigation = { setOptions: value => { options = value; }, goBack: () => backs++ };
  const usePreferences = () => ({ ...store.getSnapshot(), update: store.update, reset: store.reset, retry: store.retry, flush: store.flush });
  const native = Object.fromEntries(['Pressable', 'Text', 'View', 'ActivityIndicator'].map(name => [name, name]));
  Object.assign(native, {
    Alert: { alert: (title, message, buttons, options) => alerts.push({ title, message, buttons, options }) },
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
      const cleanup = callback(); focusCleanups.add(cleanup);
      return () => { cleanup?.(); focusCleanups.delete(cleanup); };
    }, [callback]) },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }) },
    '../Componenets/Loader': 'Loader',
    '../shared/localPlayService': { getLocalPlayEntry: id => { lookups.push(id); return id == null || id === selectedEntry?.slug ? selectedEntry : undefined; } },
    './ReaderSurface': 'ReaderSurface',
    './ReaderAppearanceModal': 'ReaderAppearanceModal',
    './ReaderContentsModal': 'ReaderContentsModal',
    './ReaderHighlightControl': 'ReaderHighlightControl',
    './ReaderHighlightPicker': 'ReaderHighlightPicker',
    './ReaderHighlightsModal': 'ReaderHighlightsModal',
    './useMyHighlightsReader': { __esModule: true, default: () => ({ cancel: cancelPassage, ...passageStatus }) },
    './useReaderHighlights': { __esModule: true, default: document => {
      if (!highlightSnapshot) highlightSnapshot = { scope: { uid: 'test-account', workId: document?.identity.workId, documentId: document?.identity.documentId, ownerGeneration: 1 }, records: [], unresolved: [], unreadable: [], conflicts: [], privacyReady: true, enabled: true };
      return { ...highlightSnapshot, session: highlightSession };
    } },
    './ReaderSelectionVerifier': 'ReaderSelectionVerifier',
    './useReaderPreferences': { __esModule: true, default: usePreferences, useReaderPreferences: usePreferences },
    './readerFonts': { loadReaderFont: fontId => { const pending = deferred(); fonts.push({ fontId, ...pending }); return pending.promise; } },
  };
  const code = babel.transformFileSync(file, { babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
  const module = { exports: {} };
  const localRequire = specifier => {
    if (specifier in dependencies) return dependencies[specifier];
    if (specifier === './useReaderModalFocus' || specifier === './useReaderNavigation') {
      const hookFile = path.join(root, 'reader', specifier.slice(2) + '.js');
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
    store, storage, fonts, focused, lookups, highlightCalls, alerts,
    get highlightSnapshot() { return highlightSnapshot; },
    setHighlights(change) { highlightSnapshot = { ...highlightSnapshot, ...change }; },
    get options() { return options; },
    get backs() { return backs; },
    get passageCancellations() { return passageCancellations; },
    blur() { for (const cleanup of focusCleanups) cleanup?.(); focusCleanups.clear(); },
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

test('restoring persisted Night or Sepia preferences cannot retire the initial saved-passage request', async () => {
  for (const theme of ['night', 'sepia']) {
    const screen = await host({ stored: { ...defaults, theme }, delayPreferences: true, passageStatus: { opening: true } });
    screen.render(); const before = screen.passageCancellations;
    await screen.store.hydrate();
    const tree = screen.render();
    assert.equal(nodes(tree, 'ReaderSurface')[0].props.preferences.theme, theme);
    assert.equal(screen.passageCancellations, before, 'preference restoration is not a reader departure');
    screen.blur(); assert.equal(screen.passageCancellations, before + 1, 'actual Back/blur still cancels');
  }
});

test('direct accessibility section navigation retires deferred Show passage before the jump', async () => {
  const screen = await host(); const tree = screen.render();
  const location = nodes(tree, 'Pressable').find(node => typeof node.props.onAccessibilityAction === 'function');
  const before = screen.passageCancellations;
  location.props.onAccessibilityAction({ nativeEvent: { actionName: 'readCurrentSection' } });
  assert.equal(screen.passageCancellations, before + 1);
});

test('opening or failed Show status uses an overlay so its removal cannot resize the reading surface', async () => {
  for (const passageStatus of [{ opening: true, error: null }, { opening: false, error: 'Unavailable passage' }]) {
    const screen = await host({ passageStatus }); const tree = screen.render();
    const status = nodes(tree, 'View').find(node => node.props.accessibilityLiveRegion === 'polite');
    assert.ok(status);
    assert.equal(status.props.pointerEvents, 'none');
    const style = Object.assign({}, ...[status.props.style].flat(Infinity).filter(Boolean));
    assert.equal(style.position, 'absolute');
    assert.ok(nodes(tree, 'ReaderSurface')[0], 'the source-generated document remains mounted');
  }
});

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

test('highlight panel exposes only the current owner and keeps the same mounted reading document', async () => {
  const screen = await host(); let tree = screen.render();
  const document = nodes(tree, 'ReaderSurface')[0].props.document;
  nodes(tree, 'ReaderHighlightControl')[0].props.onList(Object.freeze({ ...screen.highlightSnapshot.scope }));
  tree = screen.render(); assert.equal(nodes(tree, 'ReaderHighlightsModal')[0].props.visible, true);
  screen.setHighlights({ scope: { ...screen.highlightSnapshot.scope, uid: 'other-account', ownerGeneration: 2 }, privacyReady: false });
  tree = screen.render(); assert.equal(nodes(tree, 'ReaderHighlightsModal')[0].props.visible, false);
  assert.equal(nodes(tree, 'ReaderHighlightControl')[0].props.count, 0);
  assert.equal(nodes(tree, 'ReaderSurface')[0].props.document, document);
  assert.ok(nodes(tree, 'View').some(n => n.props.accessibilityLabel === 'Preparing account highlights'));
});

test('confirmed Remove uses the original scope and Show passage receives the actual record', async () => {
  const screen = await host(); let tree = screen.render();
  const selectionRef = require('../../shared/contentText').createSelection(nodes(tree, 'ReaderSurface')[0].props.document.canonical, 1, 8);
  const record = { id: 'saved', colorId: 'sage', revision: 1, selectionRef };
  screen.setHighlights({ records: [record] }); tree = screen.render();
  nodes(tree, 'ReaderHighlightControl')[0].props.onList(screen.highlightSnapshot.scope); tree = screen.render();
  let panel = nodes(tree, 'ReaderHighlightsModal')[0];
  panel.props.onRequestRemove('saved'); assert.deepEqual(screen.highlightCalls, []);
  tree = screen.render(); panel = nodes(tree, 'ReaderHighlightsModal')[0];
  panel.props.onCancelRemove(); tree = screen.render();
  assert.deepEqual(screen.highlightCalls, []);
  panel = nodes(tree, 'ReaderHighlightsModal')[0]; await panel.props.onShow('saved');
  assert.deepEqual(screen.highlightCalls[0], ['show', record, screen.highlightSnapshot.scope]);
  nodes(screen.render(), 'ReaderHighlightControl')[0].props.onList(screen.highlightSnapshot.scope);
  panel = nodes(screen.render(), 'ReaderHighlightsModal')[0]; panel.props.onRequestRemove('saved');
  panel = nodes(screen.render(), 'ReaderHighlightsModal')[0]; await panel.props.onConfirmRemove();
  assert.deepEqual(screen.highlightCalls[1], ['remove', 'saved', screen.highlightSnapshot.scope]);
});

test('highlight privacy cover exposes bounded document failure guidance rather than an endless spinner', async () => {
  for (const code of ['DOCUMENT_READY_TIMEOUT', 'SURFACE_LOAD_FAILED']) {
    const screen = await host(); let tree = screen.render();
    const page = nodes(tree, 'ReaderSurface')[0];
    page.props.onMessage({ ...page.props.document.identity, type: 'error', code });
    screen.setHighlights({ privacyReady: false }); tree = screen.render();
    assert.ok(nodes(tree, 'Text').some(n => n.props.children.join('').includes('Go back and reopen this play.')), code);
  }
});

test('real activation preserves a cloned scope and original passage through selection collapse, then Save uses that draft', async () => {
  const { createHighlightAction } = require('../../reader/readerHighlightAction');
  const { createSelection } = require('../../shared/contentText');
  const screen = await host(); let tree = screen.render();
  const page = nodes(tree, 'ReaderSurface')[0], document = page.props.document;
  const snapshot = Object.freeze({ documentId: document.identity.documentId, selection: require('../../reader/readerHighlights').validateSelectionRef(createSelection(document.canonical, 0, 7), document.canonical) });
  page.props.ref.current = { captureSelection: async () => snapshot, clearSelection() {} };
  page.props.onMessage({ ...document.identity, type: 'selectionChange', state: 'range' });
  tree = screen.render(); const props = nodes(tree, 'ReaderHighlightControl')[0].props;
  const action = createHighlightAction(props); const token = action.begin('highlight');
  page.props.onMessage({ ...document.identity, type: 'selectionChange', state: 'none' }); screen.render();
  action.activate('list', token); await settle(); tree = screen.render();
  assert.equal(nodes(tree, 'ReaderHighlightsModal')[0].props.visible, false);
  let picker = nodes(tree, 'ReaderHighlightPicker')[0]; assert.equal(picker.props.visible, true);
  assert.equal(picker.props.snapshot, snapshot); picker.props.onColor('rose');
  picker = nodes(screen.render(), 'ReaderHighlightPicker')[0]; await picker.props.onSave();
  assert.deepEqual(screen.highlightCalls, [['create', snapshot, 'rose', screen.highlightSnapshot.scope]]);
  assert.equal(nodes(screen.render(), 'ReaderHighlightPicker')[0].props.visible, false);
  assert.equal(nodes(screen.render(), 'ReaderSurface')[0].props.document, document);
});

test('duplicate capture edits the existing color and Cancel performs no storage mutation', async () => {
  const { createSelection } = require('../../shared/contentText');
  const screen = await host(); let tree = screen.render();
  const page = nodes(tree, 'ReaderSurface')[0], document = page.props.document;
  page.props.ref.current = { clearSelection() {} };
  const selectionRef = createSelection(document.canonical, 0, 7);
  screen.setHighlights({ records: [{ id: 'existing', colorId: 'blue', selectionRef }] }); tree = screen.render();
  const props = nodes(tree, 'ReaderHighlightControl')[0].props;
  props.onPicker(Object.freeze({ documentId: document.identity.documentId, selection: selectionRef }), Object.freeze({ ...props.getScope() }));
  let picker = nodes(screen.render(), 'ReaderHighlightPicker')[0]; assert.equal(picker.props.colorId, 'blue');
  picker.props.onClose(); screen.render(); assert.deepEqual(screen.highlightCalls, []);
  props.onPicker(Object.freeze({ documentId: document.identity.documentId, selection: selectionRef }), props.getScope());
  picker = nodes(screen.render(), 'ReaderHighlightPicker')[0]; picker.props.onColor('yellow');
  picker = nodes(screen.render(), 'ReaderHighlightPicker')[0]; await picker.props.onSave();
  assert.deepEqual(screen.highlightCalls, [['recolor', 'existing', 'yellow', screen.highlightSnapshot.scope]]);
});

test('cancelling a failed removal abandons replay without hiding the storage error or deleting a record', async () => {
  const screen = await host(); let tree = screen.render();
  const selectionRef = require('../../shared/contentText').createSelection(nodes(tree, 'ReaderSurface')[0].props.document.canonical, 1, 8);
  const record = { id: 'saved', colorId: 'sage', selectionRef };
  screen.setHighlights({ records: [record] }); tree = screen.render();
  nodes(tree, 'ReaderHighlightControl')[0].props.onList(screen.highlightSnapshot.scope);
  let panel = nodes(screen.render(), 'ReaderHighlightsModal')[0]; panel.props.onRequestRemove('saved');
  screen.setHighlights({ error: { code: 'WRITE_FAILED' } }); panel = nodes(screen.render(), 'ReaderHighlightsModal')[0];
  panel.props.onCancelRemove(); panel = nodes(screen.render(), 'ReaderHighlightsModal')[0];
  assert.deepEqual(screen.highlightCalls, [['cancelPending', screen.highlightSnapshot.scope]]);
  assert.equal(panel.props.removingId, null); assert.ok(panel.props.error); assert.equal(panel.props.items.length, 1);
});

test('unresolved versions never acquire a location label from the current text version', async () => {
  const screen = await host(); let tree = screen.render();
  const record = { id: 'older', colorId: 'blue', selectionRef: { exact: 'Earlier quotation', startRef: { sectionId: 'front' }, start: 1, end: 8 } };
  screen.setHighlights({ unresolved: [{ record, code: 'CONTENT_VERSION_MISMATCH' }] }); tree = screen.render();
  nodes(tree, 'ReaderHighlightControl')[0].props.onList(screen.highlightSnapshot.scope);
  const item = nodes(screen.render(), 'ReaderHighlightsModal')[0].props.items[0];
  assert.equal(item.status, 'unresolved'); assert.equal(item.quotation, 'Earlier quotation');
  assert.equal(item.locationLabel, 'Different text version');
});

test('isolated sync status reaches the existing panel and conflict decisions retain owner scope', async () => {
  const screen = await host(); let tree = screen.render();
  const selectionRef = require('../../shared/contentText').createSelection(nodes(tree, 'ReaderSurface')[0].props.document.canonical, 1, 8);
  const record = { id: 'saved', colorId: 'sage', selectionRef };
  screen.setHighlights({ records: [record], synchronizationEnabled: true, synchronizationMode: 'emulator', syncById: { saved: { status: 'conflict' } }, syncSummary: { pending: 1, deleted: 1 } });
  tree = screen.render(); nodes(tree, 'ReaderHighlightControl')[0].props.onList(screen.highlightSnapshot.scope);
  const panel = nodes(screen.render(), 'ReaderHighlightsModal')[0];
  assert.match(panel.props.storageNotice, /Production synchronization is disabled/);
  assert.equal(panel.props.items[0].syncLabel, 'Saved on this device · Changes need review');
  assert.equal(panel.props.items[0].syncConflict, true);
  await panel.props.onResolveSync('saved', 'use-cloud');
  assert.deepEqual(screen.highlightCalls, [['resolveSyncConflict', 'saved', 'use-cloud', screen.highlightSnapshot.scope]]);
});

test('cloud color conflicts are distinguished from canonical overlaps while both reasons can coexist', async () => {
  const screen = await host(), document = nodes(screen.render(), 'ReaderSurface')[0].props.document;
  const { createSelection } = require('../../shared/contentText');
  const record = (id, start, end) => ({ id, colorId: 'sage', selectionRef: createSelection(document.canonical, start, end) });
  screen.setHighlights({ records: [record('color-only', 0, 7)], conflicts: ['color-only'], synchronizationEnabled: true,
    syncById: { 'color-only': { status: 'conflict' } } });
  nodes(screen.render(), 'ReaderHighlightControl')[0].props.onList(screen.highlightSnapshot.scope);
  let panel = nodes(screen.render(), 'ReaderHighlightsModal')[0];
  assert.equal(panel.props.items[0].syncConflict, true);
  assert.equal(panel.props.items[0].overlapConflict, false);
  screen.setHighlights({ records: [record('color-only', 0, 7), record('overlap', 4, 10)], conflicts: ['color-only', 'overlap'] });
  panel = nodes(screen.render(), 'ReaderHighlightsModal')[0];
  assert.equal(panel.props.items[0].syncConflict, true);
  assert.equal(panel.props.items[0].overlapConflict, true);
  assert.equal(panel.props.items[1].syncConflict, false);
  assert.equal(panel.props.items[1].overlapConflict, true);
});

test('normal sync presentation is quiet after acknowledgement and keeps isolated-backend labels explicit', async () => {
  const screen = await host(), document = nodes(screen.render(), 'ReaderSurface')[0].props.document;
  const record = { id: 'confirmed', colorId: 'sage', selectionRef: require('../../shared/contentText').createSelection(document.canonical, 0, 7) };
  screen.setHighlights({ records: [record], synchronizationEnabled: true, synchronizationMode: 'production',
    syncById: { confirmed: { status: 'synced' } }, syncSummary: { synced: 1, pending: 0 }, retrySync() {} });
  nodes(screen.render(), 'ReaderHighlightControl')[0].props.onList(screen.highlightSnapshot.scope);
  let panel = nodes(screen.render(), 'ReaderHighlightsModal')[0];
  assert.equal(panel.props.storageNotice, undefined);
  assert.equal(panel.props.items[0].syncLabel, '');
  assert.equal(panel.props.syncNotice, '');
  assert.equal(panel.props.onRetrySync, undefined, 'quiet healthy state has no unnecessary Retry');
  screen.setHighlights({ synchronizationMode: 'emulator' });
  panel = nodes(screen.render(), 'ReaderHighlightsModal')[0];
  assert.match(panel.props.storageNotice, /Isolated emulator/);
  assert.match(panel.props.items[0].syncLabel, /isolated test backend/);
  screen.setHighlights({ synchronizationMode: 'production', syncById: { confirmed: { status: 'pending' } },
    syncSummary: { pending: 1 }, syncRunning: true });
  panel = nodes(screen.render(), 'ReaderHighlightsModal')[0];
  assert.equal(panel.props.syncNotice, 'Syncing…');
  assert.equal(panel.props.items[0].syncLabel, 'Syncing…');
});

test('reader management exposes a retained deletion conflict without treating it as an active painted highlight', async () => {
  const screen = await host(), document = nodes(screen.render(), 'ReaderSurface')[0].props.document;
  const record = { id: 'retained-deletion', colorId: 'blue', selectionRef: require('../../shared/contentText').createSelection(document.canonical, 0, 7) };
  const sync = { status: 'conflict', conflict: { cloud: { deleted: false } } };
  screen.setHighlights({ synchronizationEnabled: true, tombstones: [{ id: record.id, record, sync }], syncById: { [record.id]: sync } });
  const control = nodes(screen.render(), 'ReaderHighlightControl')[0];
  assert.equal(control.props.count, 0);
  control.props.onList(screen.highlightSnapshot.scope);
  const panel = nodes(screen.render(), 'ReaderHighlightsModal')[0];
  assert.equal(panel.props.items.length, 1);
  assert.equal(panel.props.items[0].quotation, record.selectionRef.exact);
  assert.equal(panel.props.items[0].retainedDeletion, true);
  assert.equal(panel.props.items[0].status, 'conflict');
});

test('account-highlight recovery uses the same neutral management token', async () => {
  const screen = await host(); screen.render();
  screen.setHighlights({ privacyReady: false, renderError: { code: 'HIGHLIGHT_APPLY_FAILED' } });
  const tree = screen.render(), { THEMES } = require('../../reader/readerConstants');
  const retry = nodes(tree, 'Pressable').find(node => nodes(node, 'Text').some(text => text.props.children.includes('Retry highlights')));
  assert.ok(retry);
  assert.equal(nodes(retry, 'Text')[0].props.style.color, THEMES.paper.highlightAction);
});

test('an old account panel cannot retry synchronization for a newer account', async () => {
  const screen = await host(); screen.render(); let retries = 0;
  screen.setHighlights({ synchronizationEnabled: true, syncCoordinatorError: { code: 'unavailable' }, retrySync: async () => { retries++; } });
  nodes(screen.render(), 'ReaderHighlightControl')[0].props.onList(screen.highlightSnapshot.scope);
  const oldPanel = nodes(screen.render(), 'ReaderHighlightsModal')[0];
  assert.equal(typeof oldPanel.props.onRetrySync, 'function');
  await oldPanel.props.onRetrySync(); assert.equal(retries, 1);
  screen.setHighlights({ scope: { ...screen.highlightSnapshot.scope, uid: 'different-account', ownerGeneration: 2 } }); screen.render();
  await oldPanel.props.onRetrySync(); assert.equal(retries, 1, 'retired panel activation must not retry the new owner queue');
});

async function recreationPrompt() {
  const screen = await host({ createHighlight: async () => { throw Object.assign(new Error('Deleted passage'), { code: 'RECREATE_CONFIRMATION_REQUIRED', id: 'deleted-highlight' }); } });
  const tree = screen.render(), document = nodes(tree, 'ReaderSurface')[0].props.document;
  screen.setHighlights({ synchronizationEnabled: true });
  const capture = (start = 0, end = 7) => {
    const selection = require('../../shared/contentText').createSelection(document.canonical, start, end);
    const snapshot = Object.freeze({ documentId: document.identity.documentId, selection });
    nodes(screen.render(), 'ReaderHighlightControl')[0].props.onPicker(snapshot, screen.highlightSnapshot.scope);
    return snapshot;
  };
  const snapshot = capture(), scope = screen.highlightSnapshot.scope;
  nodes(screen.render(), 'ReaderHighlightPicker')[0].props.onColor('rose');
  await nodes(screen.render(), 'ReaderHighlightPicker')[0].props.onSave();
  assert.equal(screen.alerts.length, 1, 'a deleted passage requires an explicit confirmation');
  const alert = screen.alerts[0];
  assert.match(alert.message, /delet/i);
  const cancel = alert.buttons.find(button => button.text === 'Cancel');
  const confirm = alert.buttons.find(button => button.text === 'Save new highlight');
  assert.ok(cancel && confirm, 'the user can cancel or explicitly save a new highlight');
  return { screen, document, snapshot, scope, capture, cancel: cancel.onPress, confirm: confirm.onPress };
}

test('a deleted passage is recreated only after confirmation using the original color and owner scope once', async () => {
  const h = await recreationPrompt();
  assert.deepEqual(h.screen.highlightCalls, [['create', h.snapshot, 'rose', h.scope]]);
  nodes(h.screen.render(), 'ReaderHighlightPicker')[0].props.onColor('blue');
  await h.confirm(); await h.confirm();
  assert.deepEqual(h.screen.highlightCalls, [['create', h.snapshot, 'rose', h.scope], ['recreate', 'deleted-highlight', 'rose', h.scope]]);
  assert.equal(nodes(h.screen.render(), 'ReaderHighlightPicker')[0].props.visible, false);
  assert.equal(nodes(h.screen.render(), 'ReaderSurface')[0].props.document, h.document);
});

test('cancelling recreation invalidates its saved confirmation without writing a new highlight', async () => {
  const h = await recreationPrompt();
  h.cancel(); await h.confirm();
  assert.equal(h.screen.highlightCalls.length, 1);
  assert.equal(nodes(h.screen.render(), 'ReaderHighlightPicker')[0].props.visible, true);
});

test('closing a picker or capturing another passage invalidates an earlier recreation confirmation immediately', async () => {
  for (const action of ['close', 'new-draft', 'blur']) {
    const h = await recreationPrompt();
    if (action === 'close') nodes(h.screen.render(), 'ReaderHighlightPicker')[0].props.onClose();
    else if (action === 'new-draft') h.capture(14, 21);
    else h.screen.blur();
    await h.confirm();
    assert.equal(h.screen.highlightCalls.length, 1, action);
  }
});

test('a recreation confirmation cannot act after A to B to A even before the new owner renders', async () => {
  const h = await recreationPrompt();
  h.screen.setHighlights({ scope: { ...h.scope, uid: 'other-account', ownerGeneration: h.scope.ownerGeneration + 1 } });
  h.screen.setHighlights({ scope: { ...h.scope, ownerGeneration: h.scope.ownerGeneration + 2 } });
  await h.confirm();
  assert.equal(h.screen.highlightCalls.length, 1);
});
