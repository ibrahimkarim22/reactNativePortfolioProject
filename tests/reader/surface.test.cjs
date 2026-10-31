const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');
const { buildCanonicalDocument } = require('../../shared/contentText');

const root = path.resolve(__dirname, '../..');
const identity = { documentId: 'surface-fixture', workId: 'hamlet', contentVersion: 'fixture-1', canonicalTextVersion: '1' };
const canonical = buildCanonicalDocument({
  play: { id: 'hamlet', contentVersion: 'fixture-1', canonicalTextVersion: '1', sections: [{ id: 'scene-one' }] },
  sections: [{ work: { id: 'hamlet' }, contentVersion: 'fixture-1', canonicalTextVersion: '1', section: { id: 'scene-one' }, content: [{ id: 'line-one', text: 'Alpha beta', separatorAfter: '' }] }],
});
const document = { html: '<!doctype html><html><body>Alpha beta</body></html>', identity, canonical };
const selection = { kind: 'text-range', workId: 'hamlet', contentVersion: 'fixture-1', canonicalTextVersion: '1', offsetUnit: 'utf16', start: 0, end: 5, startRef: { textId: 'line-one', sectionId: 'scene-one', offsetUtf16: 0 }, endRef: { textId: 'line-one', sectionId: 'scene-one', offsetUtf16: 5 }, exact: 'Alpha', prefix: '', suffix: ' beta' };
const preferences = { schemaVersion: 1, fontId: 'literata', fontSize: 20, lineSpacing: 'comfortable', theme: 'paper' };
const native = { View: 'View', Text: 'Text', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator', AccessibilityInfo: { setAccessibilityFocus() {} }, findNodeHandle: () => null, Platform: { OS: 'android' }, StatusBar: { pushStackEntry() {}, popStackEntry() {} }, StyleSheet: { create: value => value, absoluteFillObject: {} } };

// React Native and WebView need a device. This small hook host executes the real
// component, keeping its memo/effect/state lifetimes while recording its native
// boundary props. It does not duplicate the surface's protocol or update logic.
function host(relativeFile, overrides = {}) {
  const file = path.join(root, relativeFile);
  assert.ok(fs.existsSync(file), 'the shared reader surface exists');
  const slots = [];
  let cursor = 0;
  let effects = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const memo = (factory, deps) => {
    const index = cursor++;
    if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: factory(), deps };
    return slots[index].value;
  };
  const effect = (callback, deps) => {
    const index = cursor++;
    if (!slots[index] || !same(slots[index].deps, deps)) {
      effects.push(() => { slots[index]?.cleanup?.(); slots[index] = { deps, callback, cleanup: callback() }; });
    }
  };
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    forwardRef: component => component,
    useRef: value => memo(() => ({ current: value }), []),
    useMemo: memo,
    useCallback: (callback, deps) => memo(() => callback, deps),
    useEffect: effect,
    useLayoutEffect: effect,
    useImperativeHandle: (ref, factory, deps) => effect(() => { if (ref) ref.current = factory(); }, deps),
    useState: initial => {
      const state = memo(() => ({ value: typeof initial === 'function' ? initial() : initial }), []);
      return [state.value, next => { state.value = typeof next === 'function' ? next(state.value) : next; }];
    },
  };
  let scale = 1;
  const dependencies = {
    react: React,
    'react-native': { ...native, useWindowDimensions: () => ({ fontScale: scale }) },
    'react-native-webview': { WebView: 'WebView' },
    '../Componenets/Loader': 'Loader',
    './ReaderAppearanceModal': 'ReaderAppearanceModal',
    './ReaderContentsModal': 'ReaderContentsModal',
    './ReaderSelectionVerifier': 'ReaderSelectionVerifier',
    './ReaderHighlightControl': 'ReaderHighlightControl',
    './ReaderHighlightPicker': 'ReaderHighlightPicker',
    './ReaderHighlightsModal': 'ReaderHighlightsModal',
    './useMyHighlightsReader': { __esModule: true, default: () => ({ cancel() {}, opening: false, error: null }) },
    './useReaderHighlights': { __esModule: true, default: document => React.useMemo(() => ({ scope: { uid: null, documentId: document?.identity.documentId, ownerGeneration: 1 }, records: [], unresolved: [], unreadable: [], conflicts: [], privacyReady: true, enabled: false }), [document]) },
    // These screen cases isolate surface/header lifetimes. Navigation's real
    // model and screen integration are exercised by their dedicated suites.
    './readerNavigation': { buildReaderNavigation: () => ({ items: [], initialSectionId: null }) },
    './useReaderModalFocus': { __esModule: true, default: () => ({ triggerRef: React.useRef(null), restoreAfterClose() {}, onDismiss() {}, cancel() {} }) },
    './useReaderPreferences': { __esModule: true, default: () => ({ preferences, hydrated: true, error: null, saving: false, update() {}, reset() {}, retry() {}, flush() {} }) },
    './readerFonts': { loadReaderFont: () => new Promise(() => {}) },
    './readerConstants': { DEFAULT_PREFERENCES: preferences, THEMES: { paper: { background: '#faf7ef', text: '#25211d', secondary: '#6d655c' } } },
    ...overrides,
  };
  const compiled = babel.transformFileSync(file, {
    babelrc: false,
    configFile: false,
    plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'],
  }).code;
  const module = { exports: {} };
  const timers = new Map();
  let timerId = 0;
  const requireDependency = specifier => {
    if (specifier in dependencies) return dependencies[specifier];
    if (specifier === './useReaderNavigation') {
      const file = path.join(root, 'reader/useReaderNavigation.js');
      const code = babel.transformFileSync(file, { babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'] }).code;
      const hook = { exports: {} };
      vm.runInThisContext('(function(require,module,exports,requestAnimationFrame,cancelAnimationFrame){' + code + '\n})')(requireDependency, hook, hook.exports,
        callback => { timers.set(++timerId, callback); return timerId; }, id => timers.delete(id));
      return hook.exports;
    }
    return require(path.resolve(path.dirname(file), specifier));
  };
  vm.runInThisContext('(function(require,module,exports,setTimeout,clearTimeout,__DEV__){' + compiled + '\n})', { filename: file })(
    requireDependency, module, module.exports,
    callback => { timers.set(++timerId, callback); return timerId; },
    id => timers.delete(id),
    false,
  );
  return {
    render(props, ref) { cursor = 0; effects = []; const tree = module.exports.default(props, ref); for (const run of effects) run(); return tree; },
    scale(value) { scale = value; },
    expireTimers() { for (const [id, callback] of timers) { timers.delete(id); callback(); } },
    replayEffects() { const active = slots.filter(slot => slot?.callback); active.forEach(slot => slot.cleanup?.()); active.forEach(slot => { slot.cleanup = slot.callback(); }); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

function nodes(tree, type) {
  if (!tree || typeof tree !== 'object') return [];
  return [...(tree.type === type ? [tree] : []), ...(tree.props?.children || []).flat(Infinity).flatMap(child => nodes(child, type))];
}

test('native appearance changes inject into the ready document without replacing its source', () => {
  const surface = host('reader/ReaderSurface.native.js');
  const diagnostics = [];
  const props = { document, preferences, onMessage: message => { if (message.type !== 'selectionChange') diagnostics.push(message); } };
  let tree = surface.render(props);
  let view = nodes(tree, 'WebView')[0];
  const source = view.props.source;
  const scripts = [];
  view.props.ref.current = { injectJavaScript: script => scripts.push(script) };
  view.props.onMessage({ nativeEvent: { data: JSON.stringify({ ...identity, type: 'ready' }) } });
  assert.equal(scripts.filter(script => script.includes('applyAppearance')).length, 1, 'the ready handshake applies initial appearance');
  assert.equal(scripts.filter(script => script.includes('clearSelection')).length, 1, 'appearance explicitly invalidates runtime selection');
  tree = surface.render({ ...props, preferences: { ...preferences, fontSize: 24 } });
  view = nodes(tree, 'WebView')[0];
  assert.equal(view.props.source, source, 'appearance must not reload the reading document');
  assert.equal(scripts.filter(script => script.includes('applyAppearance')).length, 2);
  assert.equal(scripts.filter(script => script.includes('clearSelection')).length, 2);
  surface.scale(1.5);
  tree = surface.render({ ...props, preferences: { ...preferences, fontSize: 24 } });
  assert.equal(nodes(tree, 'WebView')[0].props.source, source);
  assert.equal(scripts.filter(script => script.includes('applyAppearance')).length, 3, 'system font scale also updates the mounted document');
  assert.equal(scripts.filter(script => script.includes('clearSelection')).length, 3);
  assert.equal(view.props.textZoom, 100, 'CSS owns system text scaling exactly once');
  assert.equal(diagnostics[0].type, 'ready');
});

test('native navigation rejects external and file URLs before they can leave the reader', () => {
  const surface = host('reader/ReaderSurface.native.js');
  const view = nodes(surface.render({ document }), 'WebView')[0];
  const allow = url => view.props.onShouldStartLoadWithRequest({ url });
  assert.equal(allow('about:blank'), true);
  assert.equal(allow('about:blank#play'), true);
  for (const url of ['https://example.com/', 'file:///data/local', 'intent://somewhere', 'javascript:alert(1)']) assert.equal(allow(url), false);
  assert.deepEqual(view.props.originWhitelist, ['*']);
  assert.equal(view.props.allowFileAccess, false);
  assert.equal(view.props.allowFileAccessFromFileURLs, false);
  assert.equal(view.props.allowUniversalAccessFromFileURLs, false);
  assert.equal(view.props.javaScriptCanOpenWindowsAutomatically, false);
  assert.equal(view.props.domStorageEnabled, false);
  assert.equal(view.props.webviewDebuggingEnabled, false, 'release surfaces do not expose development inspection');
});

test('native section commands remain typed, mounted and independent of appearance IDs', () => {
  const canonical = { ...identity, text: 'A play', units: [{ id: 'line-one', sectionId: 'scene-one', start: 0, textEnd: 6, end: 6 }], sections: [{ id: 'scene-one', start: 0, end: 6 }] };
  const doc = { ...document, canonical };
  const reference = { kind: 'section', workId: identity.workId, contentVersion: identity.contentVersion, canonicalTextVersion: '1', sectionId: 'scene-one' };
  const received = [], ref = { current: null }, scripts = [];
  let nativeFocusRequests = 0;
  const surface = host('reader/ReaderSurface.native.js');
  const props = { document: doc, preferences, onMessage: message => received.push(message) };
  const view = nodes(surface.render(props, ref), 'WebView')[0];
  view.props.ref.current = { injectJavaScript: script => scripts.push(script), requestFocus: () => nativeFocusRequests++ };
  assert.equal(typeof ref.current.injectJavaScript, 'undefined', 'callers cannot send arbitrary source');
  assert.equal(typeof ref.current.jumpToSection, 'function');
  assert.equal(ref.current.jumpToSection(reference), null, 'wait for the document handshake');
  const send = value => view.props.onMessage({ nativeEvent: { data: JSON.stringify({ ...identity, ...value }) } });
  send({ type: 'ready' });
  assert.equal(ref.current.jumpToSection(reference), 1);
  surface.render({ ...props, preferences: { ...preferences, fontSize: 24 } }, ref);
  send({ type: 'location', sectionId: 'scene-one', locationSeq: 2 });
  send({ type: 'location', sectionId: 'scene-one', locationSeq: 1 });
  send({ type: 'jumped', sectionId: 'scene-one', navigationId: 1 });
  send({ type: 'jumped', sectionId: 'scene-one', navigationId: 99 });
  assert.equal(received.filter(m => m.type === 'location').length, 1);
  assert.equal(received.filter(m => m.type === 'jumped').length, 1);
  assert.equal(nodes(surface.render(props, ref), 'WebView')[0].props.source, view.props.source);
  assert.ok(scripts.some(script => script.includes('jumpToSection')));
  ref.current.focusSection(reference, 1);
  assert.equal(nativeFocusRequests, 0, 'only the runtime may focus after validating the surviving jump intent');
});

test('native messages ignore foreign documents and stale completions while load errors remain visible', () => {
  const surface = host('reader/ReaderSurface.native.js');
  const diagnostics = [];
  const props = { document, onMessage: message => { if (message.type !== 'selectionChange') diagnostics.push(message); } };
  let tree = surface.render(props);
  const view = nodes(tree, 'WebView')[0];
  const scripts = [];
  view.props.ref.current = { injectJavaScript: script => scripts.push(script) };
  const send = message => view.props.onMessage({ nativeEvent: { data: JSON.stringify(message) } });
  send({ ...identity, documentId: 'old', type: 'ready' });
  send({ ...identity, type: 'applied', requestId: 1 });
  assert.equal(diagnostics.length, 0);
  send({ ...identity, type: 'ready' });
  send({ ...identity, type: 'ready' });
  assert.equal(scripts.filter(script => script.includes('applyAppearance')).length, 1, 'duplicate ready messages do not start another request');
  assert.equal(scripts.filter(script => script.includes('clearSelection')).length, 1, 'duplicate ready does not clear selection again');
  tree = surface.render({ ...props, preferences: { ...preferences, fontSize: 24 } });
  send({ ...identity, type: 'applied', requestId: 1 });
  assert.equal(diagnostics.length, 1, 'a prior valid request cannot complete the latest appearance');
  send({ ...identity, type: 'applied', requestId: 2 });
  assert.equal(diagnostics.at(-1).requestId, 2);
  view.props.onError({ nativeEvent: { description: 'Engine unavailable' } });
  tree = surface.render(props);
  assert.ok(nodes(tree, 'Text').some(node => node.props.children.join('').includes('Unable to display this play')));
  assert.equal(diagnostics.at(-1).type, 'error');
});

test('a document that never becomes ready replaces its loader with reopen guidance', () => {
  const surface = host('reader/ReaderSurface.native.js');
  const diagnostics = [];
  const props = { document, onMessage: message => diagnostics.push(message) };
  surface.render(props);
  surface.expireTimers();
  const tree = surface.render(props);
  assert.equal(nodes(tree, 'Loader').length, 0, 'failed bootstrap must not leave an endless loader');
  assert.ok(nodes(tree, 'Text').some(node => node.props.children.join('').includes('Unable to display this play')));
  assert.equal(diagnostics.at(-1).code, 'DOCUMENT_READY_TIMEOUT');
});

test('native clears an appearance error once a newer request applies successfully', () => {
  const surface = host('reader/ReaderSurface.native.js');
  const props = { document, preferences };
  let tree = surface.render(props);
  const view = nodes(tree, 'WebView')[0];
  view.props.ref.current = { injectJavaScript() {} };
  const send = message => view.props.onMessage({ nativeEvent: { data: JSON.stringify({ ...identity, ...message }) } });
  send({ type: 'ready' });
  send({ type: 'error', requestId: 1, code: 'FONT_LOAD_FAILED', message: 'Unable to load the selected font.' });
  tree = surface.render(props);
  assert.ok(nodes(tree, 'Text').some(node => node.props.children.join('').includes('could not be updated')));
  const updatedProps = { ...props, preferences: { ...preferences, fontSize: 24 } };
  surface.render(updatedProps);
  send({ type: 'applied', requestId: 2 });
  tree = surface.render(updatedProps);
  assert.equal(nodes(tree, 'Text').length, 0, 'successful recovery removes the stale error banner');
});

test('the shared screen rejects a missing route id instead of opening the service default', () => {
  let reads = 0;
  const surface = host('reader/ReaderScreen.js', {
    '@react-navigation/native': { useNavigation: () => ({ setOptions() {}, goBack() {} }), useFocusEffect() {} },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
    './ReaderSurface': 'ReaderSurface',
    './readerDocument': { createReaderDocument() { throw new Error('must not build a missing play'); } },
    '../shared/localPlayService': { getLocalPlayEntry() { reads++; return {}; } },
  });
  const tree = surface.render({});
  assert.equal(reads, 0, 'undefined must never reach the service default selection');
  assert.equal(nodes(tree, 'ReaderSurface').length, 0);
  assert.ok(nodes(tree, 'Text').some(node => node.props.children.join('').includes('Unable to open this play')));
});

test('the shared screen builds once per selected work and scopes a usable native header', () => {
  let builds = 0;
  let options;
  const entry = { slug: 'hamlet', name: 'Hamlet', play: { title: 'The Tragedy of Hamlet, Prince of Denmark', contentVersion: 'fixture-1' } };
  const surface = host('reader/ReaderScreen.js', {
    '@react-navigation/native': { useNavigation: () => ({ setOptions(value) { options = value; }, goBack() {} }), useFocusEffect() {} },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
    './ReaderSurface': 'ReaderSurface',
    './readerDocument': { createReaderDocument() { builds++; return document; } },
    '../shared/localPlayService': { getLocalPlayEntry: () => entry },
  });
  let tree = surface.render({ id: 'hamlet' });
  const first = nodes(tree, 'ReaderSurface')[0];
  tree = surface.render({ id: 'hamlet' });
  assert.equal(builds, 1);
  assert.equal(nodes(tree, 'ReaderSurface')[0].props.document, first.props.document);
  assert.equal(options.title, 'The Tragedy of Hamlet, Prince of Denmark');
  const back = options.headerLeft({ tintColor: '#25211d' });
  assert.equal(back.props.accessibilityRole, 'button');
  assert.ok(back.props.accessibilityLabel);
  assert.ok(back.props.style.minHeight >= 48);
  assert.ok(back.props.style.minWidth >= 48);
  assert.deepEqual(nodes(tree, 'SafeAreaView')[0].props.edges, ['bottom']);
});

test('web appearance messages require the owned frame and do not replace srcDoc', () => {
  let receive;
  const previousWindow = global.window;
  global.window = { addEventListener(type, callback) { if (type === 'message') receive = callback; }, removeEventListener() {} };
  try {
    const surface = host('reader/ReaderSurface.web.js');
    const props = { document, preferences };
    let frame = nodes(surface.render(props), 'iframe')[0];
    const srcDoc = frame.props.srcDoc;
    const messages = [];
    const frameWindow = { postMessage: message => messages.push(message) };
    frame.props.ref.current = { contentWindow: frameWindow };
    receive({ source: {}, data: JSON.stringify({ ...identity, type: 'ready' }) });
    assert.equal(messages.length, 0, 'another window cannot initialize this reader');
    receive({ source: frameWindow, data: JSON.stringify({ ...identity, type: 'ready' }) });
    assert.deepEqual(messages.map(message => message.type), ['bard-reader-selection-clear', 'bard-reader-appearance']);
    frame = nodes(surface.render({ ...props, preferences: { ...preferences, theme: 'night' } }), 'iframe')[0];
    assert.equal(frame.props.srcDoc, srcDoc);
    assert.deepEqual(messages.map(message => message.type), ['bard-reader-selection-clear', 'bard-reader-appearance', 'bard-reader-selection-clear', 'bard-reader-appearance']);
    assert.equal(messages[3].payload.preferences.theme, 'night');
    assert.ok(messages[3].payload.requestId > messages[1].payload.requestId);
    assert.equal(frame.props.sandbox, 'allow-scripts');
  } finally {
    global.window = previousWindow;
  }
});

test('web clears an appearance error once a newer request applies successfully', () => {
  let receive;
  const previousWindow = global.window;
  global.window = { addEventListener(type, callback) { if (type === 'message') receive = callback; }, removeEventListener() {} };
  try {
    const surface = host('reader/ReaderSurface.web.js');
    const props = { document, preferences };
    const frame = nodes(surface.render(props), 'iframe')[0];
    const frameWindow = { postMessage() {} };
    frame.props.ref.current = { contentWindow: frameWindow };
    const send = message => receive({ source: frameWindow, data: JSON.stringify({ ...identity, ...message }) });
    send({ type: 'ready' });
    send({ type: 'error', requestId: 1, code: 'FONT_LOAD_FAILED', message: 'Unable to load the selected font.' });
    let tree = surface.render(props);
    assert.ok(nodes(tree, 'Text').some(node => node.props.children.join('').includes('could not be updated')));
    const updatedProps = { ...props, preferences: { ...preferences, fontSize: 24 } };
    surface.render(updatedProps);
    send({ type: 'applied', requestId: 2 });
    tree = surface.render(updatedProps);
    assert.equal(nodes(tree, 'Text').length, 0, 'successful recovery removes the stale error banner');
  } finally {
    global.window = previousWindow;
  }
});

test('web section commands keep the frame, reject foreign senders and ignore old location sequences', () => {
  let receive;
  const previousWindow = global.window;
  global.window = { addEventListener(type, callback) { if (type === 'message') receive = callback; }, removeEventListener() {} };
  try {
    const canonical = { ...identity, text: 'A play', units: [{ id: 'line-one', sectionId: 'scene-one', start: 0, textEnd: 6, end: 6 }], sections: [{ id: 'scene-one', start: 0, end: 6 }] };
    const reference = { kind: 'section', workId: identity.workId, contentVersion: identity.contentVersion, canonicalTextVersion: '1', sectionId: 'scene-one' };
    const doc = { ...document, canonical }, received = [], outbound = [], ref = { current: null };
    const surface = host('reader/ReaderSurface.web.js');
    const props = { document: doc, preferences, onMessage: m => received.push(m) };
    const frame = nodes(surface.render(props, ref), 'iframe')[0];
    const frameWindow = { postMessage: message => outbound.push(message) };
    frame.props.ref.current = { contentWindow: frameWindow };
    assert.equal(ref.current.jumpToSection(reference), null);
    const send = value => receive({ source: frameWindow, data: JSON.stringify({ ...identity, ...value }) });
    send({ type: 'ready' });
    assert.equal(ref.current.jumpToSection(reference), 1);
    assert.equal(outbound.at(-1).type, 'bard-reader-jump');
    assert.equal(outbound.at(-1).payload.sectionId, 'scene-one');
    receive({ source: {}, data: JSON.stringify({ ...identity, type: 'location', locationSeq: 1, sectionId: 'scene-one' }) });
    send({ type: 'location', sectionId: 'scene-one', locationSeq: 2 });
    send({ type: 'location', sectionId: 'scene-one', locationSeq: 1 });
    send({ type: 'jumped', sectionId: 'scene-one', navigationId: 1 });
    assert.equal(received.filter(m => m.type === 'location').length, 1);
    assert.equal(received.filter(m => m.type === 'jumped').length, 1);
    assert.equal(nodes(surface.render(props, ref), 'iframe')[0].props.srcDoc, frame.props.srcDoc);
    assert.throws(() => ref.current.jumpToSection({ ...reference, contentVersion: 'old' }));
  } finally { global.window = previousWindow; }
});

// These tests keep the production controller and protocol. Only the device
// transport is replaced, so forged replies must survive both boundary parsers.
function selectionBoundary(platform, onMessage) {
  let receive;
  const previousWindow = global.window;
  if (platform === 'web') global.window = { addEventListener(type, callback) { if (type === 'message') receive = callback; }, removeEventListener() {} };
  const surface = host(`reader/ReaderSurface.${platform}.js`);
  const ref = { current: null }, commands = [];
  let props = { document, preferences, onMessage };
  let tree = surface.render(props, ref);
  const type = platform === 'web' ? 'iframe' : 'WebView';
  let view = nodes(tree, type)[0];
  let focusRequests = 0;
  const frameWindow = { postMessage(message, target) { assert.equal(target, '*'); commands.push(message); } };
  if (platform === 'web') view.props.ref.current = { contentWindow: frameWindow };
  else view.props.ref.current = {
    requestFocus() { focusRequests++; },
    injectJavaScript(script) {
      const methods = { applyAppearance: 'appearance', jumpToSection: 'jump', focusSection: 'focus', jumpToPassage: 'passage-jump', focusPassage: 'passage-focus', captureSelection: 'selection-capture', clearSelection: 'selection-clear', updateHighlights: 'highlights', showHighlight: 'highlight-show' };
      const BardReader = Object.fromEntries(Object.entries(methods).map(([method, kind]) => [method, payload => commands.push({ type: `bard-reader-${kind}`, payload: JSON.parse(JSON.stringify(payload)) })]));
      vm.runInNewContext(script, { window: { BardReader } });
    },
  };
  return {
    surface, ref, commands, frameWindow,
    get view() { return view; },
    get focusRequests() { return focusRequests; },
    send(message, source = frameWindow) {
      const data = JSON.stringify({ ...identity, ...message });
      if (platform === 'web') receive({ source, data });
      else view.props.onMessage({ nativeEvent: { data } });
    },
    render(update) { props = { ...props, ...update }; tree = surface.render(props, ref); view = nodes(tree, type)[0]; return tree; },
    close() { surface.unmount(); if (platform === 'web') global.window = previousWindow; },
  };
}

function captureReply(command, changes = {}) {
  return { ...command.payload, type: 'selectionCapture', selectionSeq: 1, status: 'captured', selection: structuredClone(selection), ...changes };
}

for (const platform of ['native', 'web']) {
  test(`${platform} exact-passage navigation validates complete references and shares the section navigation sequence`, async () => {
    const received = [], boundary = selectionBoundary(platform, message => received.push(message));
    try {
      const { ref, commands } = boundary;
      assert.equal(typeof ref.current.jumpToPassage, 'function');
      assert.equal(typeof ref.current.focusPassage, 'function');
      assert.equal(ref.current.jumpToPassage(selection), null, 'wait for the mounted source handshake');
      boundary.send({ type: 'ready' });
      const source = boundary.view.props.source || boundary.view.props.srcDoc;
      const pending = ref.current.captureSelection();
      const rejected = assert.rejects(pending, { code: 'CANCELLED' });
      assert.throws(() => ref.current.jumpToPassage({ ...selection, exact: 'forged' }));
      assert.equal(ref.current.jumpToPassage(selection), 1);
      await rejected;
      const command = commands.at(-1);
      assert.equal(command.type, 'bard-reader-passage-jump');
      assert.deepEqual(command.payload, { ...identity, navigationId: 1, sectionId: 'scene-one', start: 0, end: 5 });
      assert.equal(ref.current.focusPassage(selection, 0), false);
      assert.equal(ref.current.focusPassage(selection, 1), true);
      assert.equal(commands.at(-1).type, 'bard-reader-passage-focus');
      const section = { kind: 'section', workId: 'hamlet', contentVersion: 'fixture-1', canonicalTextVersion: '1', sectionId: 'scene-one' };
      assert.equal(ref.current.jumpToSection(section), 2);
      assert.equal(ref.current.focusPassage(selection, 1), false);
      assert.equal(ref.current.jumpToPassage(selection), 3);
      boundary.send({ type: 'jumped', navigationId: 1, sectionId: 'scene-one' });
      assert.equal(received.filter(message => message.type === 'jumped').length, 0);
      if (platform === 'web') {
        boundary.send({ type: 'jumped', navigationId: 3, sectionId: 'scene-one' }, {});
        assert.equal(received.filter(message => message.type === 'jumped').length, 0);
      }
      boundary.send({ type: 'jumped', navigationId: 3, sectionId: 'scene-one' });
      assert.equal(received.filter(message => message.type === 'jumped').length, 1);
      const failure = { type: 'error', navigationId: 3, code: 'PASSAGE_UNAVAILABLE', message: 'The supporting passage could not be located in this play.' };
      boundary.send({ ...failure, navigationId: 1 });
      assert.equal(received.filter(message => message.navigationId === 1 && message.type === 'error').length, 0);
      boundary.send(failure);
      assert.equal(received.filter(message => message.navigationId === 3 && message.type === 'error').length, 1);
      boundary.render({ preferences: { ...preferences, fontSize: 24 } });
      assert.equal(boundary.view.props.source || boundary.view.props.srcDoc, source);
      boundary.surface.unmount();
      assert.equal(ref.current.jumpToPassage(selection), null);
      assert.equal(ref.current.focusPassage(selection, 3), false);
    } finally { boundary.close(); }
  });

  test(`${platform} effect replay retires pending work while keeping live typed controllers and document readiness`, async () => {
    const boundary = selectionBoundary(platform);
    try {
      boundary.send({ type: 'ready' });
      const source = boundary.view.props.source || boundary.view.props.srcDoc;
      const capture = boundary.ref.current.captureSelection();
      const staleCapture = boundary.commands.at(-1);
      const captureRejected = assert.rejects(capture, error => ['CANCELLED', 'DISPOSED'].includes(error.code));
      const paint = boundary.ref.current.applyHighlights([], 1);
      const stalePaint = boundary.commands.at(-1).payload;
      const paintRejected = assert.rejects(paint, { code: 'DISPOSED' });
      boundary.surface.replayEffects();
      await Promise.all([captureRejected, paintRejected]);
      await Promise.resolve();
      boundary.send(captureReply(staleCapture));
      boundary.send({ type: 'highlightsApplied', ownerGeneration: 1, revision: stalePaint.revision, status: 'applied' });
      const nextCapture = boundary.ref.current.captureSelection();
      nextCapture.catch(() => {});
      const command = boundary.commands.at(-1);
      assert.equal(command.type, 'bard-reader-selection-capture');
      boundary.send(captureReply(command));
      assert.deepEqual((await nextCapture).selection, selection);
      const nextPaint = boundary.ref.current.applyHighlights([], 1);
      const payload = boundary.commands.at(-1).payload;
      assert.ok(payload.revision > stalePaint.revision);
      boundary.send({ type: 'highlightsApplied', ownerGeneration: 1, revision: payload.revision, status: 'applied' });
      await nextPaint;
      assert.equal(boundary.view.props.source || boundary.view.props.srcDoc, source);
    } finally { boundary.close(); }
  });

  test(`${platform} highlight painting is typed, acknowledged and keeps the mounted document`, async () => {
    const received = [], boundary = selectionBoundary(platform, message => received.push(message));
    try {
      const { ref, commands } = boundary;
      assert.equal(typeof ref.current.applyHighlights, 'function');
      assert.equal(typeof ref.current.showHighlight, 'function');
      assert.equal(ref.current.injectJavaScript, undefined);
      const record = { id: 'surface-highlight', colorId: 'yellow', selectionRef: selection };
      await assert.rejects(ref.current.applyHighlights([record], 1), { code: 'SURFACE_UNAVAILABLE' });
      boundary.send({ type: 'ready' });
      const source = boundary.view.props.source || boundary.view.props.srcDoc;
      const selectionClears = commands.filter(m => m.type === 'bard-reader-selection-clear').length;
      const pending = ref.current.applyHighlights([record], 1);
      const paint = commands.at(-1).payload;
      assert.equal(commands.at(-1).type, 'bard-reader-highlights');
      assert.equal(paint.phase, 'commit');
      assert.deepEqual(commands.filter(m => m.type === 'bard-reader-highlights').slice(-3).map(m => m.payload.phase), ['begin', 'chunk', 'commit']);
      const ack = { type: 'highlightsApplied', ownerGeneration: 1, revision: paint.revision, status: 'applied' };
      boundary.send({ ...ack, ownerGeneration: 2 });
      boundary.send({ ...ack, extra: true });
      if (platform === 'web') boundary.send(ack, {});
      assert.equal(received.filter(m => m.type === 'highlightsApplied').length, 0);
      boundary.send(ack);
      assert.equal((await pending).revision, paint.revision);
      assert.equal(received.filter(m => m.type === 'highlightsApplied').length, 1);
      const showing = ref.current.showHighlight(record, 1);
      const show = commands.at(-1).payload;
      assert.equal(commands.at(-1).type, 'bard-reader-highlight-show');
      boundary.send({ type: 'highlightShown', ownerGeneration: 1, revision: paint.revision, showId: show.showId, id: record.id, status: 'applied' });
      await showing;
      for (const records of [[{ ...record, colorId: 'sage' }], []]) {
        const update = ref.current.applyHighlights(records, 1);
        const latest = commands.at(-1).payload;
        boundary.send({ type: 'highlightsApplied', ownerGeneration: 1, revision: latest.revision, status: 'applied' });
        await update;
        const commandCount = commands.length;
        boundary.render({ onMessage: message => received.push(message) });
        assert.equal(commands.length, commandCount, 'callback changes do not recreate controllers or replay commands');
        assert.equal(boundary.view.props.source || boundary.view.props.srcDoc, source);
      }
      assert.equal(commands.filter(m => m.type === 'bard-reader-selection-clear').length, selectionClears, 'paint, recolor, Show and clear do not discard live native selection');
      assert.equal(boundary.focusRequests, 0);
    } finally { boundary.close(); }
  });

  for (const action of ['document', 'error', 'unmount']) {
    test(`${platform} ${action} retires pending highlight acknowledgements`, async () => {
      const boundary = selectionBoundary(platform);
      try {
        boundary.send({ type: 'ready' });
        assert.equal(typeof boundary.ref.current.applyHighlights, 'function');
        const pending = boundary.ref.current.applyHighlights([], 1);
        const paint = boundary.commands.at(-1).payload;
        const rejected = assert.rejects(pending, { code: 'DISPOSED' });
        if (action === 'document') boundary.render({ document: { ...document, identity: { ...identity, documentId: 'new-highlights-doc' } } });
        if (action === 'error') boundary.view.props.onError();
        if (action === 'unmount') boundary.surface.unmount();
        boundary.send({ type: 'highlightsApplied', ownerGeneration: 1, revision: paint.revision, status: 'applied' });
        await rejected;
      } finally { boundary.close(); }
    });
  }

  test(`${platform} captures live validated selection through a typed command and keeps latest callbacks`, async () => {
    const received = [], latest = [];
    const boundary = selectionBoundary(platform, message => received.push(message));
    try {
      const { ref, commands } = boundary;
      assert.equal(typeof ref.current.captureSelection, 'function');
      assert.equal(typeof ref.current.injectJavaScript, 'undefined');
      assert.equal(boundary.view.props.menuItems, undefined, 'Android keeps the normal selection and Copy menu');
      await assert.rejects(ref.current.captureSelection(), { code: 'SURFACE_UNAVAILABLE' });
      boundary.send({ type: 'selectionChange', selectionRequestId: 0, selectionSeq: 1, state: 'range' });
      assert.equal(received.filter(message => message.origin !== 'native').length, 0, 'wire selection is ignored before ready');
      boundary.send({ type: 'ready' });
      const source = boundary.view.props.source || boundary.view.props.srcDoc;
      const pending = ref.current.captureSelection();
      const command = commands.at(-1);
      assert.equal(command.type, 'bard-reader-selection-capture');
      assert.equal(command.payload.documentId, identity.documentId);
      assert.ok(command.payload.selectionRequestId > 0);
      boundary.render({ onMessage: message => latest.push(message) });
      assert.equal(commands.at(-1), command, 'callback changes do not recreate the controller or reapply appearance');
      boundary.send({ type: 'selectionChange', selectionRequestId: command.payload.selectionRequestId, selectionSeq: 2, state: 'range' });
      boundary.send(captureReply(command, { selectionSeq: 1 }));
      boundary.send(captureReply(command, { selectionSeq: 2, selection: { ...selection, exact: 'forged' } }));
      if (platform === 'web') boundary.send(captureReply(command, { selectionSeq: 2 }), {});
      boundary.send(captureReply(command, { selectionSeq: 2 }));
      const snapshot = await pending;
      assert.deepEqual(snapshot.selection, selection);
      assert.equal(snapshot.selectionSeq, 2);
      assert.equal(Object.isFrozen(snapshot.selection.startRef), true);
      assert.deepEqual(latest.filter(message => message.origin !== 'native').map(message => message.type), ['selectionChange'], 'captured quotation is delivered only through its Promise');
      assert.equal(received.filter(message => message.origin !== 'native').length, 1, 'stable callback ref directs wire provisional state to the latest listener');
      const second = ref.current.captureSelection();
      const next = commands.at(-1);
      assert.notEqual(next.payload.captureToken, command.payload.captureToken);
      boundary.send(captureReply(command, { selectionSeq: 3 }));
      boundary.send({ ...next.payload, type: 'selectionCapture', selectionSeq: 3, status: 'rejected', code: 'NO_SELECTION' });
      await assert.rejects(second, { code: 'NO_SELECTION' });
      assert.equal(boundary.view.props.source || boundary.view.props.srcDoc, source);
      assert.equal(boundary.focusRequests, 0);
    } finally { boundary.close(); }
  });

  for (const action of ['cancel', 'appearance', 'navigation', 'error', 'appearanceError', 'document', 'unmount']) {
    test(`${platform} ${action} invalidates a pending capture before its late runtime reply`, async () => {
      const received = [];
      const boundary = selectionBoundary(platform, message => received.push(message));
      try {
        boundary.send({ type: 'ready' });
        const pending = boundary.ref.current.captureSelection();
        const command = boundary.commands.at(-1);
        const rejected = assert.rejects(pending, error => ['CANCELLED', 'DISPOSED'].includes(error.code));
        if (action === 'cancel') boundary.ref.current.clearSelection();
        if (action === 'appearance') boundary.ref.current.applyAppearance();
        if (action === 'navigation') boundary.ref.current.jumpToSection({ kind: 'section', workId: 'hamlet', contentVersion: 'fixture-1', canonicalTextVersion: '1', sectionId: 'scene-one' });
        if (action === 'error') boundary.view.props.onError();
        if (action === 'appearanceError') boundary.send({ type: 'error', requestId: 1, code: 'FONT_LOAD_FAILED', message: 'Unable to load the selected font.' });
        if (action === 'document') boundary.render({ document: { ...document, identity: { ...identity, documentId: 'replacement' } } });
        if (action === 'unmount') boundary.surface.unmount();
        boundary.send(captureReply(command));
        await rejected;
        assert.equal(received.some(message => message.type === 'selectionCapture'), false);
        if (['cancel', 'appearance', 'navigation', 'appearanceError'].includes(action)) {
          const clear = boundary.commands.findLast(message => message.type === 'bard-reader-selection-clear');
          assert.equal(clear.payload.reason, action === 'appearanceError' ? 'appearance' : action);
          assert.ok(clear.payload.selectionRequestId > command.payload.selectionRequestId);
        }
        if (action === 'document') {
          await assert.rejects(boundary.ref.current.captureSelection(), { code: 'SURFACE_UNAVAILABLE' });
          boundary.send({ type: 'ready' });
          await assert.rejects(boundary.ref.current.captureSelection(), { code: 'SURFACE_UNAVAILABLE' });
          boundary.send({ type: 'ready', documentId: 'replacement' });
          const next = boundary.ref.current.captureSelection();
          const nextCommand = boundary.commands.at(-1);
          assert.equal(nextCommand.payload.documentId, 'replacement');
          assert.notEqual(nextCommand.payload.captureToken, command.payload.captureToken);
          boundary.send(captureReply(command));
          boundary.send(captureReply(nextCommand));
          assert.equal((await next).documentId, 'replacement');
        }
      } finally { boundary.close(); }
    });
  }
}
