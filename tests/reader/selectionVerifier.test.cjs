const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function snapshot(exact = 'A horse!', documentId = 'doc-1') {
  return Object.freeze({ documentId, captureToken: 'token-' + exact, selectionSeq: 2, selection: Object.freeze({
    kind: 'selection', workId: 'richard-iii', contentVersion: 'fixture-v1', canonicalTextVersion: '1', offsetUnit: 'utf16',
    exact, start: 5, end: 5 + exact.length, prefix: '     ', suffix: '\n',
    startRef: Object.freeze({ sectionId: 'scene-1', textId: 'line-1', offsetUtf16: 5 }),
    endRef: Object.freeze({ sectionId: 'scene-1', textId: 'line-1', offsetUtf16: 5 + exact.length }),
  }) });
}
function nodes(tree, type) {
  if (!tree || typeof tree !== 'object') return [];
  return [...(tree.type === type ? [tree] : []), ...(tree.props?.children || []).flat(Infinity).flatMap(child => nodes(child, type))];
}
const content = tree => nodes(tree, 'Text').map(node => node.props.children.join('')).join(' ');
const control = tree => nodes(tree, 'Pressable').find(node => node.props.accessibilityLabel === 'Capture selection');

// The production component runs with a small hook host. Navigation focus and
// native views are boundaries; capture is a deferred, already validated surface receipt.
function host({ dev = true, global = {}, capture } = {}) {
  const file = path.resolve(__dirname, '../../reader/ReaderSelectionVerifier.js');
  assert.ok(fs.existsSync(file), 'the opt-in development verifier component exists');
  const slots = [];
  let cursor = 0, effects = [], dirty = false, focusCleanup, focusRuns = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const memo = (factory, deps) => {
    const index = cursor++;
    if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: factory(), deps };
    return slots[index].value;
  };
  const effect = (callback, deps) => {
    const index = cursor++;
    if (!slots[index] || !same(slots[index].deps, deps)) effects.push(() => {
      slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: callback() };
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
  const requests = [], clears = [];
  const surfaceRef = { current: {
    captureSelection() { const request = deferred(); requests.push(request); return capture ? capture(request) : request.promise; },
    clearSelection(reason) { clears.push(reason); },
  } };
  const native = Object.fromEntries(['Pressable', 'Text', 'View', 'ScrollView', 'Modal'].map(name => [name, name]));
  native.StyleSheet = { create: value => value, hairlineWidth: 1 };
  native.Platform = { OS: 'android' };
  const dependencies = {
    react: React, 'react-native': native,
    '@react-navigation/native': { useFocusEffect: callback => effect(() => {
      focusRuns++; focusCleanup = callback(); return () => { focusCleanup?.(); focusCleanup = undefined; };
    }, [callback]) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 24, bottom: 32 }) },
  };
  const code = babel.transformFileSync(file, { babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
  const module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports,__DEV__,globalThis){' + code + '\n})', { filename: file })(
    name => dependencies[name] || require(path.resolve(__dirname, '../../reader', name)), module, module.exports, dev, global,
  );
  const component = module.exports.default;
  let props = { documentId: 'doc-1', surfaceRef }, latest;
  return {
    requests, clears, global, surfaceRef,
    get focusRuns() { return focusRuns; },
    render(change = {}) {
      props = { ...props, ...change };
      let attempts = 0;
      do {
        assert.ok(++attempts <= 20, 'verifier render settles');
        cursor = 0; effects = []; dirty = false; latest = component(props);
        for (const run of effects) run();
      } while (dirty);
      return latest;
    },
    blur() { focusCleanup?.(); focusCleanup = undefined; },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test('production has no verifier UI, hooks, or global registration', () => {
  const screen = host({ dev: false });
  assert.equal(screen.render(), null);
  assert.equal(screen.global.BardSelectionVerification, undefined);
  assert.equal(screen.focusRuns, 0);
  assert.deepEqual(screen.requests, []);
});

test('development starts hidden and opt-in registration remains stable across renders', async () => {
  const screen = host();
  assert.equal(screen.render(), null);
  const api = screen.global.BardSelectionVerification;
  assert.deepEqual(Object.keys(api).sort(), ['capture', 'disable', 'enable']);
  await assert.rejects(api.capture(), { code: 'VERIFIER_DISABLED' });
  api.enable();
  assert.ok(control(screen.render()));
  assert.equal(screen.focusRuns, 1);
  assert.equal(screen.global.BardSelectionVerification, api);
  api.disable();
  assert.equal(screen.render(), null);
  screen.unmount();
  assert.equal(screen.global.BardSelectionVerification, undefined);
});

test('global-only opt-in preserves the reading viewport and still captures fresh selectable modal receipts', async () => {
  const screen = host(); screen.render();
  const api = screen.global.BardSelectionVerification;
  api.enable({ showControl: false });
  assert.equal(screen.render(), null, 'global-only mode contributes no ordinary layout or border');
  const first = api.capture();
  assert.equal(screen.requests.length, 1);
  assert.equal(screen.render(), null, 'pending capture does not introduce a footer or native modal');
  const receipt = snapshot('First global quotation');
  screen.requests[0].resolve(receipt); assert.equal(await first, receipt);
  let tree = screen.render();
  assert.equal(control(tree), undefined);
  assert.equal(nodes(tree, 'Modal').length, 1);
  assert.match(content(tree), /First global quotation/);
  assert.match(content(tree), /line-1/);
  assert.ok(nodes(tree, 'Text').some(node => node.props.selectable && node.props.children.includes('First global quotation')));
  const second = api.capture();
  assert.equal(screen.requests.length, 2);
  assert.equal(screen.render(), null, 'the prior quotation disappears during a fresh global capture');
  screen.requests[1].resolve(snapshot('Second global quotation')); await second;
  tree = screen.render();
  assert.match(content(tree), /Second global quotation/);
  assert.doesNotMatch(content(tree), /First global quotation/);
  nodes(tree, 'Modal')[0].props.onRequestClose();
  assert.equal(screen.render(), null);
  const pending = api.capture(); api.disable();
  screen.requests[2].resolve(snapshot('Cancelled global quotation'));
  await assert.rejects(pending, { code: 'CANCELLED' });
  assert.equal(screen.render(), null);
  api.enable();
  assert.ok(control(screen.render()), 'ordinary enable restores the default native control');
  screen.unmount();
});

test('capture synchronously requests the live surface and opens a selectable receipt only after resolution', async () => {
  const screen = host(); screen.render();
  const api = screen.global.BardSelectionVerification;
  api.enable();
  let tree = screen.render();
  const pending = api.capture();
  assert.equal(screen.requests.length, 1, 'the live capture starts within the initiating call');
  tree = screen.render();
  assert.equal(nodes(tree, 'Modal').length, 0, 'native focus cannot move to a modal before the live snapshot arrives');
  const receipt = snapshot(); screen.requests[0].resolve(receipt);
  assert.equal(await pending, receipt, 'the validated immutable snapshot is returned without rewriting it');
  tree = screen.render();
  assert.equal(nodes(tree, 'Modal').length, 1);
  assert.match(content(tree), /A horse!/);
  assert.match(content(tree), /scene-1/);
  assert.match(content(tree), /line-1/);
  assert.ok(nodes(tree, 'Text').some(node => node.props.selectable && node.props.children.includes('A horse!')));
  const next = api.capture();
  assert.equal(screen.requests.length, 2, 'every invocation requests a fresh Range');
  assert.equal(nodes(screen.render(), 'Modal').length, 0, 'an earlier quotation is hidden while a new capture is pending');
  screen.requests[1].resolve(snapshot('My kingdom!'));
  await next;
  assert.doesNotMatch(content(screen.render()), /A horse!/);
  screen.unmount();
});

test('touch starts capture before focus and onPress does not duplicate it; accessibility onPress requests fresh capture', async () => {
  const screen = host(); screen.render(); const api = screen.global.BardSelectionVerification;
  api.enable(); let button = control(screen.render());
  button.props.onPressIn();
  assert.equal(screen.requests.length, 1);
  button.props.onPressOut();
  button.props.onPress();
  assert.equal(screen.requests.length, 1);
  screen.requests[0].resolve(snapshot()); await Promise.resolve(); await Promise.resolve();
  let tree = screen.render(); nodes(tree, 'Modal')[0].props.onRequestClose();
  button = control(screen.render()); button.props.onPress();
  assert.equal(screen.requests.length, 2);
  screen.requests[1].resolve(snapshot('Another word')); await Promise.resolve(); await Promise.resolve();
  assert.match(content(screen.render()), /Another word/);
  screen.unmount();
});

test('a cancelled touch cannot consume the next keyboard activation', async () => {
  const screen = host(); screen.render(); const api = screen.global.BardSelectionVerification;
  api.enable(); const button = control(screen.render());
  button.props.onPressIn();
  button.props.onPressOut?.();
  await Promise.resolve();
  button.props.onPress();
  assert.equal(screen.requests.length, 2, 'press-out with no press must retire the touch deduplication guard');
  screen.requests[0].resolve(snapshot('Cancelled touch'));
  screen.requests[1].resolve(snapshot('Keyboard quotation'));
  await Promise.resolve(); await Promise.resolve();
  assert.match(content(screen.render()), /Keyboard quotation/);
  screen.unmount();
});

test('disable, document change, and route blur discard late snapshots', async () => {
  for (const action of ['disable', 'document', 'blur']) {
    const screen = host(); screen.render(); const api = screen.global.BardSelectionVerification;
    api.enable(); screen.render(); const pending = api.capture();
    if (action === 'disable') api.disable();
    if (action === 'document') screen.render({ documentId: 'doc-2' });
    if (action === 'blur') screen.blur();
    screen.requests[0].resolve(snapshot('Stale quotation'));
    await assert.rejects(pending, { code: 'CANCELLED' });
    assert.doesNotMatch(content(screen.render()), /Stale quotation/);
    assert.equal(nodes(screen.render(), 'Modal').length, 0);
    if (action === 'blur') {
      assert.equal(screen.global.BardSelectionVerification, undefined);
      await assert.rejects(api.capture(), { code: 'READER_NOT_FOCUSED' });
    }
    screen.unmount();
  }
});

test('a superseded request cannot replace the newer quotation', async () => {
  const screen = host(); screen.render(); const api = screen.global.BardSelectionVerification;
  api.enable(); const first = api.capture(), second = api.capture();
  screen.requests[1].resolve(snapshot('Newest quotation')); await second;
  screen.requests[0].resolve(snapshot('Older quotation'));
  await assert.rejects(first, { code: 'CANCELLED' });
  assert.match(content(screen.render()), /Newest quotation/);
  assert.doesNotMatch(content(screen.render()), /Older quotation/);
  screen.unmount();
});

test('capture rejection displays its code safely and native Back or Close dismisses the receipt', async () => {
  const screen = host(); screen.render(); const api = screen.global.BardSelectionVerification;
  api.enable(); const pending = api.capture();
  screen.requests[0].reject(Object.assign(new Error('private transport details'), { code: 'NO_SELECTION' }));
  await assert.rejects(pending, { code: 'NO_SELECTION' });
  let tree = screen.render();
  assert.match(content(tree), /NO_SELECTION/);
  assert.doesNotMatch(content(tree), /private transport details/);
  nodes(tree, 'Modal')[0].props.onRequestClose();
  assert.equal(nodes(screen.render(), 'Modal').length, 0);
  const second = api.capture(); screen.requests[1].resolve(snapshot()); await second;
  tree = screen.render();
  const close = nodes(tree, 'Pressable').find(node => node.props.accessibilityLabel === 'Close selection verification');
  assert.ok(close); close.props.onPress();
  assert.equal(nodes(screen.render(), 'Modal').length, 0);
  screen.unmount();
});

test('old route cleanup cannot remove or invoke the current reader registration', async () => {
  const global = {}, first = host({ global }), second = host({ global });
  first.render(); const old = global.BardSelectionVerification; old.enable();
  second.render(); const current = global.BardSelectionVerification;
  first.blur(); assert.equal(global.BardSelectionVerification, current);
  old.enable(); assert.equal(control(first.render()), undefined);
  await assert.rejects(old.capture(), { code: 'READER_NOT_FOCUSED' });
  current.enable(); assert.ok(control(second.render()));
  first.unmount(); second.unmount();
});
