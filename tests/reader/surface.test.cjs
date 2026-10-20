const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');

const root = path.resolve(__dirname, '../..');
const identity = { documentId: 'surface-fixture', workId: 'hamlet', contentVersion: 'fixture-1', canonicalTextVersion: '1' };
const document = { html: '<!doctype html><html><body>A play</body></html>', identity, canonical: {} };
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
      effects.push(() => { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: callback() }; });
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
  };
}

function nodes(tree, type) {
  if (!tree || typeof tree !== 'object') return [];
  return [...(tree.type === type ? [tree] : []), ...(tree.props?.children || []).flat(Infinity).flatMap(child => nodes(child, type))];
}

test('native appearance changes inject into the ready document without replacing its source', () => {
  const surface = host('reader/ReaderSurface.native.js');
  const diagnostics = [];
  const props = { document, preferences, onMessage: message => diagnostics.push(message) };
  let tree = surface.render(props);
  let view = nodes(tree, 'WebView')[0];
  const source = view.props.source;
  const scripts = [];
  view.props.ref.current = { injectJavaScript: script => scripts.push(script) };
  view.props.onMessage({ nativeEvent: { data: JSON.stringify({ ...identity, type: 'ready' }) } });
  assert.equal(scripts.length, 1, 'the ready handshake applies initial appearance');
  tree = surface.render({ ...props, preferences: { ...preferences, fontSize: 24 } });
  view = nodes(tree, 'WebView')[0];
  assert.equal(view.props.source, source, 'appearance must not reload the reading document');
  assert.equal(scripts.length, 2);
  surface.scale(1.5);
  tree = surface.render({ ...props, preferences: { ...preferences, fontSize: 24 } });
  assert.equal(nodes(tree, 'WebView')[0].props.source, source);
  assert.equal(scripts.length, 3, 'system font scale also updates the mounted document');
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

test('native messages ignore foreign documents and stale completions while load errors remain visible', () => {
  const surface = host('reader/ReaderSurface.native.js');
  const diagnostics = [];
  const props = { document, onMessage: message => diagnostics.push(message) };
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
  assert.equal(scripts.length, 1, 'duplicate ready messages do not start another request');
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
    assert.equal(messages.length, 1);
    frame = nodes(surface.render({ ...props, preferences: { ...preferences, theme: 'night' } }), 'iframe')[0];
    assert.equal(frame.props.srcDoc, srcDoc);
    assert.equal(messages.length, 2);
    assert.equal(messages[1].payload.preferences.theme, 'night');
    assert.ok(messages[1].payload.requestId > messages[0].payload.requestId);
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
