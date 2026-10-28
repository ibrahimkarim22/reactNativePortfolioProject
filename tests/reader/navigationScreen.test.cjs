const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');
const { THEMES } = require('../../reader/readerConstants');

const root = path.resolve(__dirname, '../..');
const defaults = { schemaVersion: 1, fontId: 'literata', fontSize: 20, lineSpacing: 'comfortable', theme: 'paper' };

function fixture() {
  const sections = [
    { id: 'title', kind: 'title' },
    { id: 'act-1', kind: 'act', act: 1 },
    { id: 'scene-1', kind: 'scene', act: 1, scene: 1, parentSectionId: 'act-1' },
    { id: 'scene-2', kind: 'scene', act: 1, scene: 2, parentSectionId: 'act-1' },
  ];
  return {
    slug: 'small-play', name: 'A Small Play',
    play: { id: 'small-play', title: 'A Small Play', schemaVersion: '2.0.0', contentVersion: 'screen-fixture-v1', canonicalTextVersion: '1', sections },
    sections: sections.map(section => ({
      work: { id: 'small-play' }, contentVersion: 'screen-fixture-v1', canonicalTextVersion: '1', section,
      content: [{ id: `${section.id}-opening`, type: 'heading', tag: 'h2', text: section.id, separatorAfter: '\n\n', classes: [], spans: [] }],
    })),
  };
}

// Exercise the production screen and real document/navigation builders. Only
// native views, navigation, font IO, and the mounted surface are host boundaries.
function host({ platform = 'android', selectedEntry = fixture(), openPassage } = {}) {
  const slots = [];
  let cursor = 0, effects = [], dirty = false, options, backs = 0;
  const focusCleanups = new Set(), cancelPassage = () => {};
  let preferences = { ...defaults };
  let preferenceWrites = 0;
  const frames = new Map(), focused = [], jumps = [], sectionFocus = [], selectionClears = [];
  let frameId = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const memo = (factory, deps) => {
    const index = cursor++;
    if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: factory(), deps };
    return slots[index].value;
  };
  const effect = (callback, deps) => {
    const index = cursor++;
    if (!slots[index] || !same(slots[index].deps, deps)) effects.push(() => {
      slots[index]?.cleanup?.();
      slots[index] = { deps, callback, cleanup: callback() };
    });
  };
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useRef: initial => memo(() => ({ current: initial }), []), useMemo: memo,
    useCallback: (callback, deps) => memo(() => callback, deps), useEffect: effect, useLayoutEffect: effect,
    useState: initial => {
      const slot = memo(() => ({ value: typeof initial === 'function' ? initial() : initial }), []);
      return [slot.value, next => {
        const value = typeof next === 'function' ? next(slot.value) : next;
        if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; }
      }];
    },
  };
  const requestFrame = callback => { frames.set(++frameId, callback); return frameId; };
  const cancelFrame = id => frames.delete(id);
  const native = Object.fromEntries(['Pressable', 'Text', 'View', 'ActivityIndicator'].map(name => [name, name]));
  Object.assign(native, {
    Platform: { OS: platform }, StyleSheet: { create: styles => styles, hairlineWidth: 1 },
    AccessibilityInfo: { setAccessibilityFocus: target => focused.push(target) }, findNodeHandle: node => node?.nativeTag ?? null,
    StatusBar: { pushStackEntry: entry => entry, popStackEntry() {} }, useWindowDimensions: () => ({ width: 393, height: 873, fontScale: 2 }),
  });
  const update = change => { preferences = { ...preferences, ...change }; preferenceWrites++; };
  const settings = { hydrated: true, update, reset() {}, retry() {}, flush() {} };
  const dependencies = {
    react: React, 'react-native': native,
    '@react-navigation/native': {
      useNavigation: () => navigation,
      useFocusEffect: callback => effect(() => { const cleanup = callback(); focusCleanups.add(cleanup); return () => { cleanup?.(); focusCleanups.delete(cleanup); }; }, [callback]),
    },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 24, bottom: 24 }) },
    '../shared/localPlayService': { getLocalPlayEntry: id => id === selectedEntry.slug ? selectedEntry : undefined },
    './ReaderSurface': 'ReaderSurface', './ReaderAppearanceModal': 'ReaderAppearanceModal', './ReaderContentsModal': 'ReaderContentsModal', './ReaderSelectionVerifier': 'ReaderSelectionVerifier',
    './ReaderHighlightControl': 'ReaderHighlightControl', './ReaderHighlightPicker': 'ReaderHighlightPicker',
    './ReaderHighlightsModal': 'ReaderHighlightsModal',
    './useMyHighlightsReader': { __esModule: true, default: () => ({ cancel: cancelPassage, opening: false, error: null }) },
    './useReaderHighlights': { __esModule: true, default: document => React.useMemo(() => {
      const state = { scope: { uid: 'test-account', workId: document?.identity.workId, documentId: document?.identity.documentId, ownerGeneration: 1 }, records: [], unresolved: [], unreadable: [], conflicts: [], privacyReady: true, enabled: true };
      return { ...state, session: { getSnapshot: () => state } };
    }, [document]) },
    './useReaderPreferences': { __esModule: true, default: () => ({ ...settings, preferences }) },
    './readerFonts': { loadReaderFont: () => new Promise(() => {}) },
  };
  const navigation = { setOptions: value => { options = value; }, goBack: () => backs++ };
  const cache = new Map();
  const localRequire = specifier => {
    if (specifier in dependencies) return dependencies[specifier];
    if (specifier === './useReaderModalFocus' || specifier === './useReaderNavigation') return load(path.join(root, 'reader', specifier.slice(2) + '.js'));
    return require(path.join(root, 'reader', specifier));
  };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const code = babel.transformFileSync(file, { babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
    const module = { exports: {} };
    vm.runInThisContext('(function(require,module,exports,requestAnimationFrame,cancelAnimationFrame){' + code + '\n})', { filename: file })(localRequire, module, module.exports, requestFrame, cancelFrame);
    cache.set(file, module.exports);
    return module.exports;
  }
  const screen = load(path.join(root, 'reader/ReaderScreen.js')).default;
  const passageJumps = [], passageFocus = [];
  const surface = { jumpToSection: reference => { jumps.push(reference); return jumps.length; }, focusSection: (reference, id) => { sectionFocus.push({ reference, id }); return true; }, clearSelection: reason => selectionClears.push(reason) };
  surface.jumpToPassage = reference => { passageJumps.push(reference); return 100 + passageJumps.length; };
  surface.focusPassage = (reference, id) => { passageFocus.push({ reference, id }); return true; };
  let latest;
  const api = {
    focused, jumps, sectionFocus, update, selectionClears, passageJumps, passageFocus,
    get options() { return options; }, get backs() { return backs; }, get preferenceWrites() { return preferenceWrites; },
    render() {
      let attempts = 0;
      do {
        if (++attempts > 20) throw new Error('Screen did not settle.');
        cursor = 0; effects = []; dirty = false; latest = screen({ id: 'small-play', openPassage });
        const page = nodes(latest, 'ReaderSurface')[0];
        if (page?.props.ref) page.props.ref.current = surface;
        for (const run of effects) run();
      } while (dirty);
      return latest;
    },
    message(message) {
      const page = nodes(latest, 'ReaderSurface')[0];
      assert.equal(typeof page?.props.onMessage, 'function', 'the mounted surface reports validated document messages');
      page.props.onMessage({ ...page.props.document.identity, ...message });
    },
    frame() { for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } },
    blur() { for (const cleanup of focusCleanups) cleanup?.(); focusCleanups.clear(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
    replay() { const active = slots.filter(slot => slot?.callback); active.forEach(slot => slot.cleanup?.()); active.forEach(slot => { slot.cleanup = slot.callback(); }); },
  };
  return api;
}
function nodes(tree, type) {
  if (!tree || typeof tree !== 'object') return [];
  return [...(tree.type === type ? [tree] : []), ...(tree.props?.children || []).flat(Infinity).flatMap(child => nodes(child, type))];
}
const text = tree => nodes(tree, 'Text').map(node => node.props.children.join('')).join(' ');
const style = node => Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean));
function contentsButton(tree) {
  const button = nodes(tree, 'Pressable').find(node => /contents/i.test(node.props.accessibilityLabel || ''));
  assert.ok(button, 'a native Contents control is present below the header');
  return button;
}
function ready(screen) {
  screen.render(); screen.message({ type: 'ready' }); return screen.render();
}
function open(screen, tree) { contentsButton(tree).props.onPress(); return screen.render(); }
function select(screen, tree, sectionId) { nodes(tree, 'ReaderContentsModal')[0].props.onSelect(sectionId); }

function passageFixture() {
  const entry = fixture();
  const { buildCanonicalDocument, createSelection } = require('../../shared/contentText');
  const canonical = buildCanonicalDocument({ play: entry.play, sections: entry.sections });
  const unit = canonical.units.find(unit => unit.sectionId === 'scene-2');
  return { entry, reference: createSelection(canonical, unit.start + 1, unit.textEnd) };
}

test('a source passage opens exactly once after reader readiness and focuses its actual range after acknowledgment', () => {
  const { entry, reference } = passageFixture();
  const screen = host({ selectedEntry: entry, openPassage: reference });
  screen.render(); assert.deepEqual(screen.passageJumps, []);
  let tree = ready(screen);
  assert.deepEqual(screen.passageJumps, [reference]);
  assert.deepEqual(screen.jumps, [], 'do not substitute the scene beginning');
  assert.match(text(tree), /Opening supporting passage/);
  screen.message({ type: 'jumped', navigationId: 100, sectionId: 'scene-2' }); screen.render();
  assert.deepEqual(screen.passageFocus, []);
  screen.message({ type: 'jumped', navigationId: 101, sectionId: 'scene-2' });
  tree = screen.render();
  assert.deepEqual(screen.passageFocus, [{ reference, id: 101 }]);
  assert.doesNotMatch(text(tree), /Opening supporting passage/);
  screen.update({ theme: 'night', fontSize: 24 }); screen.render(); screen.message({ type: 'ready' }); screen.render();
  assert.equal(screen.passageJumps.length, 1, 'appearance changes and repeated ready events do not replay the route');
});

test('a stale or mismatched source passage reports unavailability instead of opening another place', () => {
  const { entry, reference } = passageFixture();
  for (const mutation of [{ contentVersion: 'old' }, { exact: 'Other text' }, { startRef: { ...reference.startRef, offsetUtf16: 0 } }]) {
    const screen = host({ selectedEntry: entry, openPassage: { ...reference, ...mutation } });
    const tree = ready(screen);
    assert.deepEqual(screen.passageJumps, []);
    assert.deepEqual(screen.jumps, []);
    assert.match(text(tree), /supporting passage.*unavailable/i);
  }
});

test('later reader interaction retires a pending passage focus without replaying the request', () => {
  const { entry, reference } = passageFixture();
  const screen = host({ selectedEntry: entry, openPassage: reference });
  ready(screen);
  screen.message({ type: 'interaction', interactionSeq: 1 });
  screen.message({ type: 'jumped', navigationId: 101, sectionId: 'scene-2' });
  const tree = screen.render();
  assert.deepEqual(screen.passageFocus, []);
  assert.doesNotMatch(text(tree), /Opening supporting passage/);
  assert.equal(screen.passageJumps.length, 1);
});

test('the native location row wraps below the existing header and follows theme and validated location events', () => {
  const screen = host();
  let tree = ready(screen);
  const button = contentsButton(tree);
  assert.equal(button.props.accessibilityRole, 'button');
  assert.ok(style(button).minHeight >= 48 && style(button).minWidth >= 48);
  assert.equal(style(button).position, undefined, 'the location row takes layout space');
  assert.match(text(tree), /Title/);
  const initialDocument = nodes(tree, 'ReaderSurface')[0].props.document;
  screen.message({ type: 'location', sectionId: 'scene-2', locationSeq: 1 });
  tree = screen.render();
  assert.match(text(tree), /Act I · Scene II/);
  const locationText = nodes(tree, 'Text').find(node => node.props.children.join('') === 'Act I · Scene II');
  assert.equal(locationText.props.numberOfLines, 2, 'the reserved row bounds visible wrapping while its Contents label retains the complete location');
  assert.match(contentsButton(tree).props.accessibilityLabel, /Act I · Scene II/);
  assert.equal(locationText.props.accessibilityLiveRegion, undefined, 'passive reading changes are not announced');
  assert.equal(locationText.props.accessibilityRole, undefined, 'the passive location is not exposed as a fake control');
  screen.update({ theme: 'night' });
  tree = screen.render();
  assert.equal(nodes(tree, 'ReaderSurface')[0].props.document, initialDocument);
  assert.equal(style(contentsButton(tree)).borderBottomColor, THEMES.night.border);
  assert.equal(style(contentsButton(tree)).backgroundColor, THEMES.night.background);
  assert.equal(style(locationText).position, undefined);
  assert.equal(screen.options.headerLeft({}).props.accessibilityLabel, 'Back');
  screen.options.headerLeft({}).props.onPress();
  assert.equal(screen.backs, 1);
  assert.equal(screen.options.headerRight().props.accessibilityLabel, 'Reading appearance');
});

test('the location row retains Contents and reserves a separate stable highlight control', () => {
  const screen = host();
  const tree = ready(screen);
  const controls = nodes(tree, 'Pressable');
  assert.equal(controls.length, 1, 'the location row has one visible control');
  const row = controls[0];
  assert.equal(row.props.accessibilityLabel, 'Contents, Title');
  assert.match(text(row), /Title/);
  assert.ok(style(row).minHeight >= 48);
  assert.equal(nodes(tree, 'ReaderHighlightControl').length, 1);
  assert.equal(style(row).alignSelf, 'stretch');
  const chevron = nodes(row, 'Text').find(node => node.props.children.join('') === '›');
  assert.ok(chevron, 'a chevron indicates that the location opens Contents');
  assert.equal(chevron.props.accessibilityElementsHidden, true);
  assert.equal(style(chevron).flexShrink, 0, 'the label may wrap without taking the chevron space');
  assert.doesNotMatch(text(tree), /Read from here/);
});

test('live selection changes only the reserved action and a validated action draft opens the native picker', () => {
  const screen = host(); let tree = ready(screen);
  const document = nodes(tree, 'ReaderSurface')[0].props.document;
  assert.equal(nodes(tree, 'ReaderHighlightControl')[0].props.mode, 'list');
  screen.message({ type: 'selectionChange', state: 'range', selectionSeq: 1, selectionRequestId: 0 });
  tree = screen.render();
  const control = nodes(tree, 'ReaderHighlightControl')[0];
  assert.equal(control.props.mode, 'highlight');
  assert.equal(nodes(tree, 'ReaderSurface')[0].props.document, document);
  assert.equal(nodes(tree, 'ReaderHighlightPicker')[0].props.visible, false);
  const { createSelection } = require('../../shared/contentText');
  const snapshot = { documentId: document.identity.documentId, selection: createSelection(document.canonical, 0, 3) };
  control.props.onPicker(snapshot, control.props.getScope());
  tree = screen.render();
  assert.equal(nodes(tree, 'ReaderHighlightPicker')[0].props.snapshot, snapshot);
  assert.equal(nodes(tree, 'ReaderHighlightPicker')[0].props.visible, true);
  assert.equal(screen.selectionClears.at(-1), 'modal');
  nodes(tree, 'ReaderHighlightPicker')[0].props.onClose(); tree = screen.render();
  assert.equal(nodes(tree, 'ReaderHighlightPicker')[0].props.visible, false);
  assert.equal(screen.jumps.length, 0);
});

test('opening and cancelling Contents retains the surface document and restores only its trigger after dismissal', () => {
  const screen = host();
  let tree = ready(screen);
  const document = nodes(tree, 'ReaderSurface')[0].props.document;
  contentsButton(tree).props.ref.current = { nativeTag: 41 };
  tree = open(screen, tree);
  const modal = nodes(tree, 'ReaderContentsModal')[0];
  assert.equal(modal.props.visible, true);
  assert.equal(modal.props.ready, true);
  assert.equal(modal.props.currentSectionId, 'title');
  assert.deepEqual(modal.props.model.items.map(item => item.id), ['title', 'act-1', 'scene-1', 'scene-2']);
  assert.equal(nodes(tree, 'ReaderSurface')[0].props.document, document);
  assert.ok(nodes(tree, 'View').some(node => node.props.accessibilityElementsHidden && node.props.importantForAccessibility === 'no-hide-descendants'));
  modal.props.onClose();
  screen.frame(); screen.frame();
  assert.deepEqual(screen.focused, [], 'the visible modal keeps focus until its closed commit');
  tree = screen.render();
  screen.frame();
  assert.deepEqual(screen.focused, []);
  screen.frame();
  assert.deepEqual(screen.focused, [41]);
  assert.deepEqual(screen.jumps, []);
  assert.equal(nodes(tree, 'ReaderSurface')[0].props.document, document);
  assert.equal(screen.preferenceWrites, 0, 'navigation does not write appearance or reading progress');
});

test('selection jumps the existing mounted surface and focuses only after its matching acknowledgement and closed Android frames', () => {
  const screen = host();
  let tree = ready(screen);
  const document = nodes(tree, 'ReaderSurface')[0].props.document;
  contentsButton(tree).props.ref.current = { nativeTag: 41 };
  tree = open(screen, tree);
  const destination = nodes(tree, 'ReaderContentsModal')[0].props.model.items.find(item => item.id === 'scene-2').reference;
  select(screen, tree, 'scene-2');
  assert.deepEqual(screen.jumps, [destination]);
  screen.message({ type: 'jumped', sectionId: 'scene-2', navigationId: 1 });
  screen.frame(); screen.frame();
  assert.deepEqual(screen.sectionFocus, [], 'acknowledgement cannot focus through the still-visible native modal');
  tree = screen.render();
  assert.equal(nodes(tree, 'ReaderContentsModal')[0].props.visible, false);
  assert.equal(nodes(tree, 'ReaderSurface')[0].props.document, document);
  screen.frame();
  assert.deepEqual(screen.sectionFocus, []);
  screen.frame();
  assert.deepEqual(screen.sectionFocus, [{ reference: destination, id: 1 }]);
  assert.deepEqual(screen.focused, [], 'intentional navigation suppresses trigger focus restoration');
});

test('dismissal alone never focuses a destination, and a later matching acknowledgement completes the handoff once', () => {
  const screen = host();
  let tree = open(screen, ready(screen));
  select(screen, tree, 'scene-1');
  screen.render(); screen.frame(); screen.frame();
  assert.deepEqual(screen.sectionFocus, []);
  screen.message({ type: 'jumped', sectionId: 'scene-2', navigationId: 1 });
  screen.message({ type: 'jumped', sectionId: 'scene-1', navigationId: 99 });
  assert.deepEqual(screen.sectionFocus, []);
  screen.message({ type: 'jumped', sectionId: 'scene-1', navigationId: 1 });
  screen.message({ type: 'jumped', sectionId: 'scene-1', navigationId: 1 });
  assert.equal(screen.sectionFocus.length, 1);
});

test('iOS waits for native onDismiss as well as the matching jump acknowledgement', () => {
  const screen = host({ platform: 'ios' });
  let tree = open(screen, ready(screen));
  select(screen, tree, 'scene-1');
  screen.message({ type: 'jumped', sectionId: 'scene-1', navigationId: 1 });
  tree = screen.render(); screen.frame(); screen.frame();
  assert.deepEqual(screen.sectionFocus, []);
  nodes(tree, 'ReaderContentsModal')[0].props.onDismiss();
  screen.frame();
  assert.equal(screen.sectionFocus.length, 1);
});

test('newer Contents intent supersedes a pending destination and older acknowledgements cannot steal focus', () => {
  const screen = host();
  let tree = open(screen, ready(screen));
  select(screen, tree, 'scene-1');
  tree = screen.render();
  tree = open(screen, tree);
  select(screen, tree, 'scene-2');
  screen.render(); screen.frame(); screen.frame();
  screen.message({ type: 'jumped', sectionId: 'scene-1', navigationId: 1 });
  assert.deepEqual(screen.sectionFocus, []);
  screen.message({ type: 'jumped', sectionId: 'scene-2', navigationId: 2 });
  assert.equal(screen.sectionFocus.length, 1);
  assert.equal(screen.sectionFocus[0].reference.sectionId, 'scene-2');
  assert.equal(screen.sectionFocus[0].id, 2);
});

test('blur and unmount each cancel a pending destination handoff', () => {
  for (const end of ['blur', 'unmount']) {
    const screen = host();
    let tree = open(screen, ready(screen));
    select(screen, tree, 'scene-1');
    screen.message({ type: 'jumped', sectionId: 'scene-1', navigationId: 1 });
    screen.render(); screen.frame(); screen[end](); screen.frame();
    screen.message({ type: 'jumped', sectionId: 'scene-1', navigationId: 1 });
    assert.deepEqual(screen.sectionFocus, [], end);
    assert.deepEqual(screen.focused, [], end);
  }
});

test('appearance and Contents never overlap and opening appearance cancels a pending destination', () => {
  const screen = host();
  let tree = open(screen, ready(screen));
  screen.options.headerRight().props.onPress();
  tree = screen.render();
  assert.equal(nodes(tree, 'ReaderAppearanceModal')[0].props.visible, true);
  assert.equal(nodes(tree, 'ReaderContentsModal')[0].props.visible, false);
  tree = open(screen, tree);
  assert.equal(nodes(tree, 'ReaderAppearanceModal')[0].props.visible, false);
  select(screen, tree, 'scene-1');
  screen.render();
  screen.options.headerRight().props.onPress();
  screen.render(); screen.frame(); screen.frame();
  screen.message({ type: 'jumped', sectionId: 'scene-1', navigationId: 1 });
  assert.deepEqual(screen.sectionFocus, []);
});

test('Read from current section performs a real jump and waits for its matching acknowledgement', () => {
  const screen = host();
  let tree = ready(screen);
  screen.message({ type: 'location', sectionId: 'scene-2', locationSeq: 1 });
  tree = screen.render();
  const location = contentsButton(tree);
  assert.deepEqual(location.props.accessibilityActions, [{ name: 'readCurrentSection', label: 'Read from current section' }]);
  location.props.onAccessibilityAction({ nativeEvent: { actionName: 'unknown' } });
  assert.deepEqual(screen.jumps, []);
  location.props.onAccessibilityAction({ nativeEvent: { actionName: 'readCurrentSection' } });
  assert.equal(screen.jumps[0].sectionId, 'scene-2');
  assert.deepEqual(screen.sectionFocus, []);
  screen.message({ type: 'jumped', sectionId: 'scene-2', navigationId: 1 });
  assert.equal(screen.sectionFocus.length, 1);
});

test('invalid navigation metadata fails visibly before mounting a surface or starting navigation', () => {
  const entry = fixture();
  entry.sections[2].section = { ...entry.sections[2].section, parentSectionId: 'missing' };
  const screen = host({ selectedEntry: entry });
  const tree = screen.render();
  assert.equal(nodes(tree, 'ReaderSurface').length, 0);
  assert.match(text(tree), /Unable to open this play/);
});

test('modal opening and route blur clear live selection before moving focus', () => {
  const screen = host(); let tree = ready(screen);
  screen.options.headerRight().props.onPress();
  assert.equal(screen.selectionClears.at(-1), 'modal');
  tree = screen.render(); open(screen, tree);
  assert.equal(screen.selectionClears.at(-1), 'contents');
  screen.blur();
  assert.equal(screen.selectionClears.at(-1), 'document');
});

test('effect replay preserves acknowledged navigation readiness and location in the same mounted document', () => {
  const screen = host(); let tree = ready(screen);
  screen.message({ type: 'location', sectionId: 'scene-2', locationSeq: 1 }); tree = screen.render();
  const document = nodes(tree, 'ReaderSurface')[0].props.document;
  screen.replay(); tree = screen.render();
  assert.equal(nodes(tree, 'ReaderSurface')[0].props.document, document);
  assert.match(contentsButton(tree).props.accessibilityLabel, /Scene II/);
  contentsButton(tree).props.onAccessibilityAction({ nativeEvent: { actionName: 'readCurrentSection' } });
  assert.equal(screen.jumps.at(-1)?.sectionId, 'scene-2');
});
