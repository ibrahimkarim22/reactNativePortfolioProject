const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');

const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
const receipt = (exact = 'A horse!') => Object.freeze({ documentId: 'doc-1', selection: Object.freeze({ exact }) });
function host(platform = 'android') {
  const file = path.resolve(__dirname, '../../reader/ReaderHighlightControl.js');
  assert.ok(fs.existsSync(file), 'the reserved highlight control exists');
  const slots = [];
  let cursor = 0, effects = [], fontScale = 1, viewportWidth = 400;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const memo = (factory, deps) => {
    const index = cursor++;
    if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: factory(), deps };
    return slots[index].value;
  };
  const effect = (callback, deps) => {
    const index = cursor++;
    if (!slots[index] || !same(slots[index].deps, deps)) effects.push(() => {
      slots[index]?.cleanup?.(); slots[index] = { deps, callback, cleanup: callback() };
    });
  };
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useRef: initial => memo(() => ({ current: initial }), []), useMemo: memo,
    useCallback: (callback, deps) => memo(() => callback, deps), useEffect: effect, useLayoutEffect: effect,
  };
  const native = { Pressable: 'Pressable', Text: 'Text', View: 'View', Platform: { OS: platform },
    StyleSheet: { create: value => value, hairlineWidth: 1 }, useWindowDimensions: () => ({ width: viewportWidth, height: 800, fontScale }) };
  const code = babel.transformFileSync(file, { babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
  const module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: file })(
    name => name === 'react' ? React : name === 'react-native' ? native : require(path.resolve(__dirname, '../../reader', name)), module, module.exports,
  );
  const requests = [], opened = [], lists = [], errors = [];
  let scope = { documentId: 'doc-1', ownerGeneration: 1 };
  let props = { mode: 'highlight', count: 0, disabled: false, capture() {
    let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    requests.push({ resolve, reject }); return promise;
  }, getScope: () => scope, onPicker: value => opened.push(value), onList: () => lists.push(true), onError: error => errors.push(error) };
  return {
    requests, opened, lists, errors,
    render(change = {}) { props = { ...props, ...change }; cursor = 0; effects = [];
      const tree = module.exports.default(props); for (const run of effects) run(); return tree; },
    scope(value) { scope = value; }, fontScale(value) { fontScale = value; }, width(value) { viewportWidth = value; },
    replayEffects() { for (const slot of slots) if (slot?.callback) { slot.cleanup?.(); slot.cleanup = slot.callback(); } },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}
function nodes(tree, type) {
  if (!tree || typeof tree !== 'object') return [];
  return [...(tree.type === type ? [tree] : []), ...(tree.props?.children || []).flat(Infinity).flatMap(child => nodes(child, type))];
}
const button = tree => nodes(tree, 'Pressable')[0];
const style = tree => Object.assign({}, ...[button(tree).props.style].flat(Infinity));

test('one stable reserved button retains geometry across selection, counts, and loading at large system text', () => {
  const h = host(); const first = h.render({ mode: 'list', count: 200 });
  const listStyle = style(first), key = button(first).props.key;
  assert.equal(nodes(first, 'Pressable').length, 1);
  assert.equal(button(first).props.accessibilityRole, 'button');
  assert.equal(button(first).props.accessibilityLabel, 'Highlights (200)');
  const selected = h.render({ mode: 'highlight' });
  assert.deepEqual(style(selected), listStyle); assert.equal(button(selected).props.key, key);
  assert.equal(button(selected).props.accessibilityLabel, 'Highlight');
  const loading = h.render({ disabled: true });
  assert.equal(style(loading).width, listStyle.width); assert.equal(style(loading).height, listStyle.height);
  assert.equal(button(loading).props.accessibilityLabel, 'Highlights loading');
  assert.equal(button(loading).props.accessibilityState.disabled, true);
  assert.ok(listStyle.minHeight >= 48); assert.ok(listStyle.width >= 48);
  h.fontScale(2.4); const large = h.render({ disabled: false });
  assert.ok(style(large).width > listStyle.width); assert.ok(style(large).minHeight >= 48 * 2.4);
  assert.deepEqual(style(h.render({ mode: 'list', count: 0 })), style(large), 'same large-text footprint for both labels');
  h.unmount();
});

test('native completed touch captures on press-in and freezes original meaning across rerender/collapse', async () => {
  const h = host(); let control = button(h.render());
  control.props.onPressIn(); assert.equal(h.requests.length, 1); assert.deepEqual(h.opened, []);
  control = button(h.render({ mode: 'list' }));
  control.props.onPressOut(); control.props.onPress();
  assert.equal(h.requests.length, 1); assert.deepEqual(h.lists, []);
  h.requests[0].resolve(receipt()); await settle();
  assert.equal(h.opened.length, 1); assert.deepEqual(h.lists, []); h.unmount();
});

test('preparation cannot open picker before intentional press even when capture already finished', async () => {
  const h = host(); const control = button(h.render()); control.props.onPressIn();
  h.requests[0].resolve(receipt()); await settle(); assert.deepEqual(h.opened, []);
  control.props.onPressOut(); control.props.onPress(); assert.equal(h.opened.length, 1); h.unmount();
});

test('cancelled touch and press-out without activation reject late press and late receipt without becoming list', async () => {
  for (const cancellation of ['onTouchCancel', 'onPressOut']) {
    const h = host(); const control = button(h.render()); control.props.onPressIn();
    control.props[cancellation](); await settle();
    const collapsed = button(h.render({ mode: 'list' })); collapsed.props.onPress();
    h.requests[0].resolve(receipt('Cancelled')); await settle();
    assert.deepEqual(h.opened, [], cancellation); assert.deepEqual(h.lists, [], cancellation);
    h.unmount();
  }
});

test('a list touch remains list despite a new live selection and only opens on completed press', () => {
  const h = host(); let control = button(h.render({ mode: 'list' }));
  control.props.onPressIn(); assert.deepEqual(h.lists, []);
  control = button(h.render({ mode: 'highlight' })); control.props.onPressOut(); control.props.onPress();
  assert.equal(h.lists.length, 1); assert.deepEqual(h.requests, []); h.unmount();
});

test('explicit native accessibility activation obtains a fresh capture without touch and ignores duplicate onPress', async () => {
  const h = host(); let control = button(h.render());
  assert.ok(control.props.accessibilityActions.some(action => action.name === 'activate'));
  control.props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } });
  assert.equal(h.requests.length, 1); control.props.onPress();
  assert.equal(h.requests.length, 1); h.requests[0].resolve(receipt('Accessible')); await settle();
  assert.equal(h.opened.length, 1);
  control = button(h.render({ mode: 'list' })); control.props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } });
  control.props.onPress(); assert.equal(h.lists.length, 1); h.unmount();
});

test('a cancelled touch cannot prevent the next explicit accessibility activation', async () => {
  const h = host(); const control = button(h.render());
  control.props.onPressIn(); control.props.onTouchCancel();
  control.props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } });
  assert.equal(h.requests.length, 2); h.requests[0].resolve(receipt('Old'));
  h.requests[1].resolve(receipt('New accessible')); await settle();
  assert.deepEqual(h.opened.map(value => value.selection.exact), ['New accessible']); h.unmount();
});

test('web keyboard activation freezes mode, handles Enter/Space, and never duplicates the native press fallback', async () => {
  for (const key of ['Enter', ' ']) {
    const h = host('web'); let control = button(h.render()); let prevented = 0;
    control.props.onKeyDown({ nativeEvent: { key, repeat: false }, preventDefault() { prevented++; } });
    assert.equal(h.requests.length, 1, 'keyboard-down prepares capture before focus can move');
    control = button(h.render({ mode: 'list' }));
    control.props.onKeyUp({ nativeEvent: { key }, preventDefault() { prevented++; } });
    control.props.onPress(); h.requests[0].resolve(receipt('Keyboard')); await settle();
    assert.equal(prevented, 2); assert.equal(h.opened.length, 1); assert.deepEqual(h.lists, []); h.unmount();
  }
});

test('RN Web keyboard press-in before custom key-down prepares exactly one fresh capture', async () => {
  const h = host('web'); const control = button(h.render());
  const event = { key: 'Enter', nativeEvent: { key: 'Enter', type: 'keydown' }, preventDefault() {} };
  // Installed RN Web Pressable calls its internal keyboard responder first.
  control.props.onPressIn(event); control.props.onKeyDown(event);
  assert.equal(h.requests.length, 1);
  control.props.onPressOut(event); control.props.onPress(event);
  control.props.onKeyUp(event); h.requests[0].resolve(receipt('One keyboard capture')); await settle();
  assert.equal(h.opened.length, 1); h.unmount();
});

test('320dp viewport with 200% text reserves room for Contents and identical wrapping geometry for all labels', () => {
  const h = host(); h.width(320); h.fontScale(2);
  const list = h.render({ mode: 'list', count: 200 }), listStyle = style(list);
  assert.ok(listStyle.width <= (320 - 40) * 0.48, 'reserved control cannot consume the left location control');
  assert.ok(listStyle.minHeight >= 2 * 20 * 2 + 16, 'reserve scaled multiline label height');
  assert.deepEqual(style(h.render({ mode: 'highlight' })), listStyle);
  assert.deepEqual(style(h.render({ disabled: true })), listStyle);
  h.unmount();
});

test('React effect setup replay cancels old intent while leaving the mounted control usable', async () => {
  const h = host(); let control = button(h.render()); control.props.onPressIn(); control.props.onPress();
  h.replayEffects(); h.requests[0].resolve(receipt('Discarded mount')); await settle();
  assert.deepEqual(h.opened, []);
  control = button(h.render()); control.props.onPressIn(); control.props.onPress();
  assert.equal(h.requests.length, 2); h.requests[1].resolve(receipt('Current mount')); await settle();
  assert.deepEqual(h.opened.map(value => value.selection.exact), ['Current mount']); h.unmount();
});

test('web mouse release retains intent until its click while a release without click retires before later presses', async () => {
  const h = host('web'); let control = button(h.render());
  control.props.onPressIn(); control.props.onPressOut(); await settle();
  // Browser click is a separate dispatch after mouseup; unlike native, a
  // microtask checkpoint may separate RN Web onPressOut from onPress.
  control.props.onPress(); h.requests[0].resolve(receipt('Mouse click')); await settle();
  assert.equal(h.opened.length, 1);
  control = button(h.render()); control.props.onPressIn(); control.props.onPressOut();
  await new Promise(resolve => setTimeout(resolve, 5));
  control = button(h.render({ mode: 'list' })); control.props.onPress();
  h.requests[1].resolve(receipt('Abandoned mouse')); await settle();
  assert.equal(h.opened.length, 1); assert.deepEqual(h.lists, []); h.unmount();
});

test('disable, scope transition, blur, and unmount cancel pending capture and cannot open stale UI', async () => {
  for (const retirement of ['disabled', 'scope', 'blur', 'unmount']) {
    const h = host(); const control = button(h.render()); control.props.onPressIn(); control.props.onPress();
    if (retirement === 'disabled') h.render({ disabled: true });
    if (retirement === 'scope') { h.scope({ documentId: 'doc-1', ownerGeneration: 2 }); h.render(); }
    if (retirement === 'blur') control.props.onBlur();
    if (retirement === 'unmount') h.unmount();
    h.requests[0].resolve(receipt('Stale')); await settle(); assert.deepEqual(h.opened, [], retirement);
    if (retirement !== 'unmount') h.unmount();
  }
});

test('disabled control ignores native, keyboard, and accessibility attempts', () => {
  const h = host('web'); const control = button(h.render({ disabled: true }));
  control.props.onPressIn(); control.props.onPress();
  control.props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } });
  control.props.onKeyDown({ nativeEvent: { key: 'Enter' } }); control.props.onKeyUp({ nativeEvent: { key: 'Enter' } });
  assert.deepEqual(h.requests, []); assert.deepEqual(h.lists, []); h.unmount();
});

test('the modal focus trigger ref stays attached to the same reserved Pressable in every mode', () => {
  const h = host(), triggerRef = { current: null };
  const first = button(h.render({ triggerRef, mode: 'list' }));
  assert.equal(first.props.ref, triggerRef);
  for (const change of [{ mode: 'highlight' }, { disabled: true }, { disabled: false, mode: 'list', count: 200 }]) {
    const next = button(h.render(change)); assert.equal(next.props.ref, triggerRef); assert.equal(next.props.key, first.props.key);
  }
  h.unmount();
});
