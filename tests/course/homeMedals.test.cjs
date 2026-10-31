const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');
const root = path.resolve(__dirname, '../..');
const nodes = (tree, type) => !tree || typeof tree !== 'object' ? [] : [
  ...(tree.type === type ? [tree] : []), ...(tree.props?.children || []).flat(Infinity).flatMap(child => nodes(child, type)),
];
const text = tree => typeof tree === 'string' || typeof tree === 'number' ? String(tree) : !tree || typeof tree !== 'object'
  ? '' : (tree.props?.children || []).flat(Infinity).map(text).join(' ');

function host({ tab, level = 1, initialProgress } = {}) {
  const route = { key: 'home-fixture', params: { tab } }, calls = [], writes = [], slots = [];
  let cursor = 0, effects = [], dirty = false;
  let progress = initialProgress || { status: 'ready', completedLevel: level };
  const equal = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const memo = (factory, deps) => { const i = cursor++; if (!slots[i] || !equal(slots[i].deps, deps)) slots[i] = { deps, value: factory() }; return slots[i].value; };
  const React = {
    createElement(type, props, ...children) { const next = { ...props, children }; return typeof type === 'function' ? type(next) : { type, props: next }; },
    useMemo: memo,
    useState: initial => { const slot = memo(() => ({ value: typeof initial === 'function' ? initial() : initial }), []); return [slot.value, next => { const value = typeof next === 'function' ? next(slot.value) : next; if (slot.value !== value) { slot.value = value; dirty = true; } }]; },
    useEffect: (factory, deps) => { const i = cursor++; if (!slots[i] || !equal(slots[i].deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: factory() }; }); },
  };
  const plays = [{ id: 'midsummer', name: 'Midsummer', difficulty: 1, medalImage: 11 }, { id: 'henry-viii', name: 'Henry VIII', difficulty: 39, medalImage: 12 }];
  const native = Object.fromEntries(['View', 'Text', 'Pressable', 'ScrollView', 'Image', 'Modal', 'StatusBar', 'ActivityIndicator'].map(s => [s, s]));
  Object.assign(native, { useWindowDimensions: () => ({ width: 411, fontScale: 1 }), StyleSheet: { create: value => value } });
  const deps = {
    react: React, 'react-native': native,
    '@fortawesome/react-native-fontawesome': { FontAwesomeIcon: 'Icon' }, '@fortawesome/free-solid-svg-icons': {},
    'firebase/auth': { updateProfile: () => writes.push('profile') }, 'firebase/firestore': { doc() {}, updateDoc: () => writes.push('document') },
    '../course/AccountCourseProgress': { useAccountCourseProgress: () => progress, retryAccountProgress() {} },
    '../course/CourseProgressNotice': { CourseProgressNotice: 'CourseProgressNotice' },
    '../course/MedalsCollection': { __esModule: true, default: 'MedalsCollection' },
    'expo-image-manipulator': {}, 'expo-image-picker': {}, 'expo-media-library': {},
    '../firebaseConfig': { FIREBASE_AUTH: { currentUser: { displayName: 'Synthetic reader' } }, FIRESTORE_DB: {} },
    '../shared/localPlayService': { PLAYS: plays },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ bottom: 0 }) },
  };
  const file = path.join(root, 'screens/HomeScreen.js');
  const code = babel.transformFileSync(file, { babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
  const module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports,React){' + code + '\n})', { filename: file })(name => {
    if (Object.hasOwn(deps, name)) return deps[name];
    return name.startsWith('.') ? require(path.resolve(path.dirname(file), name)) : require(name);
  }, module, module.exports, React);
  const navigation = { navigate: (...args) => calls.push(args), setParams: next => { route.params = { ...route.params, ...next }; dirty = true; } };
  const h = {
    calls, writes, route, plays,
    render() { let tree, passes = 0; do { assert.ok(++passes < 20); cursor = 0; effects = []; dirty = false; tree = module.exports.default({ navigation, route }); effects.forEach(run => run()); } while (dirty); return tree; },
    selectTab(label) { const button = nodes(h.render(), 'Pressable').find(n => text(n) === label); assert.ok(button, label); button.props.onPress(); return h.render(); },
    setProgress(next) { progress = next; },
  };
  return h;
}

test('View medals route opens the existing Home tab and consumes its request so later manual tab selection persists', () => {
  const h = host({ tab: 'Medals' });
  let tree = h.render();
  assert.equal(nodes(tree, 'MedalsCollection').length, 1);
  assert.equal(h.route.params.tab, undefined, 'consume the one-time navigation request');
  tree = h.selectTab('Overview'); assert.equal(nodes(tree, 'MedalsCollection').length, 0);
  h.route.params = { tab: 'Medals' }; tree = h.render();
  assert.equal(nodes(tree, 'MedalsCollection').length, 1, 'a later View medals request is honored again');
  const tab = nodes(tree, 'Pressable').find(n => n.props.accessibilityRole === 'tab' && n.props.accessibilityLabel === 'Medals');
  assert.equal(tab.props.accessibilityState.selected, true);
  assert.deepEqual(h.writes, []);
});

test('Home collection receives raw confirmed level 39 and earned actions use the existing lesson route', () => {
  const h = host({ tab: 'Medals', level: 39 });
  const collection = nodes(h.render(), 'MedalsCollection')[0];
  assert.ok(collection);
  assert.equal(collection.props.completedLevel, 39);
  assert.equal(collection.props.plays.length, 2);
  collection.props.onOpenLesson(h.plays[1]);
  assert.deepEqual(h.calls, [['Lesson', { id: 'henry-viii' }]]);
  h.setProgress({ status: 'loading', completedLevel: 0 });
  assert.equal(nodes(h.render(), 'MedalsCollection').length, 0, 'unconfirmed or changed-account progress cannot expose earned state');
  assert.deepEqual(h.writes, []);
});

test('Home never renders medals from a non-ready account snapshot even when it contains a stale earned level', () => {
  for (const status of ['loading', 'error', 'signed-out']) {
    const h = host({ tab: 'Medals', initialProgress: { status, completedLevel: 39 } });
    const tree = h.render();
    assert.equal(nodes(tree, 'MedalsCollection').length, 0, `${status} cannot expose an earned collection`);
    const notice = nodes(tree, 'CourseProgressNotice')[0];
    assert.ok(notice, `${status} retains the existing account progress notice`);
    assert.equal(notice.props.status, status);
    assert.deepEqual(h.calls, []);
    assert.deepEqual(h.writes, []);
  }
});

test('switching accounts hides the old earned collection until the new account is ready', () => {
  const h = host({ tab: 'Medals', level: 39 });
  assert.equal(nodes(h.render(), 'MedalsCollection')[0].props.completedLevel, 39);
  h.setProgress({ status: 'loading', completedLevel: 39 });
  let tree = h.render();
  assert.equal(nodes(tree, 'MedalsCollection').length, 0, 'a stale previous-account level cannot flash while loading');
  assert.equal(nodes(tree, 'CourseProgressNotice')[0].props.status, 'loading');
  h.setProgress({ status: 'ready', completedLevel: 0 });
  tree = h.render();
  assert.equal(nodes(tree, 'MedalsCollection').length, 1);
  assert.equal(nodes(tree, 'MedalsCollection')[0].props.completedLevel, 0, 'only the newly confirmed account level reaches the collection');
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.writes, []);
});
