const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');

function host(platform = 'android') {
  const file = path.resolve(__dirname, '../../reader/useReaderModalFocus.js');
  assert.ok(fs.existsSync(file), 'the modal focus lifecycle hook exists');
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
      if (!slots[index] || !same(slots[index].deps, deps)) effects.push(() => {
        slots[index]?.cleanup?.();
        slots[index] = { deps, cleanup: callback() };
      });
  };
  const React = {
    useRef: initial => memo(() => ({ current: initial }), []),
    useCallback: (callback, deps) => memo(() => callback, deps),
    useLayoutEffect: effect,
    useEffect: effect,
  };
  const nativeFocus = [];
  const frames = new Map();
  let frameId = 0;
  const listeners = new Set();
  const native = {
    Platform: { OS: platform },
    AccessibilityInfo: { setAccessibilityFocus: target => nativeFocus.push(target) },
    findNodeHandle: target => target?.nativeTag ?? null,
    AppState: { addEventListener(type, callback) {
      if (type === 'focus') listeners.add(callback);
      return { remove: () => listeners.delete(callback) };
    } },
  };
  const code = babel.transformFileSync(file, { babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'] }).code;
  const module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports,requestAnimationFrame,cancelAnimationFrame){' + code + '\n})', { filename: file })(
    name => name === 'react' ? React : name === 'react-native' ? native : require(name), module, module.exports,
    callback => { frames.set(++frameId, callback); return frameId; },
    id => frames.delete(id),
  );
  return {
    nativeFocus,
    render(visible) { cursor = 0; effects = []; const api = module.exports.default({ visible }); for (const run of effects) run(); return api; },
    appFocus() { for (const listener of listeners) listener(); },
    frames() { for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test('Android restores after the closed commit and two frames without requiring a missing native event', () => {
  const screen = host();
  let focus = screen.render(true);
  focus.triggerRef.current = { nativeTag: 17 };
  focus.restoreAfterClose();
  screen.frames();
  screen.frames();
  assert.deepEqual(screen.nativeFocus, [], 'closing while still visible must never schedule early focus');
  focus = screen.render(false);
  assert.deepEqual(screen.nativeFocus, []);
  screen.frames();
  assert.deepEqual(screen.nativeFocus, [], 'the first post-commit frame must not restore into the closing window');
  screen.frames();
  assert.deepEqual(screen.nativeFocus, [17]);
  screen.appFocus();
  focus.onDismiss();
  screen.frames();
  assert.deepEqual(screen.nativeFocus, [17], 'later frames or unrelated native events do not steal focus');
});

test('iOS restores only after Modal.onDismiss reports completed native dismissal', () => {
  const screen = host('ios');
  let focus = screen.render(true);
  focus.triggerRef.current = { nativeTag: 27 };
  focus.restoreAfterClose();
  focus = screen.render(false);
  screen.appFocus();
  screen.frames();
  assert.deepEqual(screen.nativeFocus, []);
  focus.onDismiss();
  screen.frames();
  assert.deepEqual(screen.nativeFocus, [27]);
});

test('reopening cancels a queued return so a new modal retains accessibility focus', () => {
  const screen = host();
  let focus = screen.render(true);
  focus.triggerRef.current = { nativeTag: 17 };
  focus.restoreAfterClose();
  screen.render(false);
  screen.frames();
  screen.render(true);
  screen.frames();
  assert.deepEqual(screen.nativeFocus, []);
  screen.render(false);
  screen.appFocus();
  screen.frames();
  assert.deepEqual(screen.nativeFocus, [], 'the cancelled close does not survive a later visibility change');
});

test('cancel and unmount discard pending native events and queued focus frames', () => {
  const screen = host();
  let focus = screen.render(true);
  focus.triggerRef.current = { nativeTag: 17 };
  focus.restoreAfterClose();
  screen.render(false);
  screen.frames();
  focus.cancel();
  screen.appFocus();
  screen.frames();
  assert.deepEqual(screen.nativeFocus, []);
  focus = screen.render(true);
  focus.restoreAfterClose();
  screen.render(false);
  screen.frames();
  screen.unmount();
  screen.frames();
  screen.appFocus();
  assert.deepEqual(screen.nativeFocus, []);
});

test('web focuses the trigger after its modal closes without requiring native events', () => {
  const screen = host('web');
  let calls = 0;
  const focus = screen.render(true);
  focus.triggerRef.current = { focus: () => calls++ };
  focus.restoreAfterClose();
  screen.frames();
  assert.equal(calls, 0, 'the visible modal retains focus until the closed commit');
  screen.render(false);
  screen.frames();
  assert.equal(calls, 1);
  assert.deepEqual(screen.nativeFocus, []);
});
