const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');
const { configureStore } = require('@reduxjs/toolkit');

const root = path.resolve(__dirname, '../..');
const questions = () => [
  { id: 1, question: 'First fixture question?', options: ['Correct A', 'Wrong A'], correctAnswer: 'Correct A' },
  { id: 2, question: 'Second fixture question?', options: ['Wrong B', 'Correct B'], correctAnswer: 'Correct B' },
];
const play = (id = 'fixture-a', quiz = questions(), difficulty = 1) => ({ id, quiz, difficulty, name: 'Fixture play', medalImage: 1 });
const nodes = (tree, type) => !tree || typeof tree !== 'object' ? [] : [
  ...(tree.type === type ? [tree] : []), ...(tree.props?.children || []).flat(Infinity).flatMap(child => nodes(child, type)),
];
const text = tree => typeof tree === 'string' || typeof tree === 'number' ? String(tree) : !tree || typeof tree !== 'object'
  || tree.type === 'Overlay' && !tree.props.isVisible ? '' : (tree.props?.children || []).flat(Infinity).map(text).join(' ');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }

function host({ plays = [play()], params = { id: 'fixture-a' }, level = 0, uid = 'fixture-owner', write = async () => {} } = {}) {
  const calls = [], actions = [], writes = [], slots = [];
  let cursor = 0, effects = [], dirty = false;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const memo = (factory, deps) => { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: factory(), deps }; return slots[i].value; };
  const effect = (factory, deps) => { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: factory() }; }); };
  const React = {
    createElement(type, props, ...children) {
      if (type === 'ScrollView' && props?.ref) props.ref.current = { scrollTo() {} };
      return { type, props: { ...props, children } };
    },
    useRef: value => memo(() => ({ current: value }), []), useEffect: effect, useLayoutEffect: effect,
    useMemo: memo, useCallback: (fn, deps) => memo(() => fn, deps),
    useState: initial => {
      const slot = memo(() => ({ value: typeof initial === 'function' ? initial() : initial }), []);
      return [slot.value, next => { const value = typeof next === 'function' ? next(slot.value) : next; if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; } }];
    },
  };
  function load(file, deps) {
    const code = babel.transformFileSync(file, { babelrc: false, configFile: false,
      plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
    const module = { exports: {} };
    vm.runInThisContext('(function(require,module,exports,console,React){' + code + '\n})', { filename: file })(
      name => Object.hasOwn(deps, name) ? deps[name] : name.startsWith('.') ? require(path.resolve(path.dirname(file), name)) : require(name),
      module, module.exports, { log() {}, warn() {}, error() {} }, React);
    return module.exports;
  }
  const slice = load(path.join(root, 'Progress/CourseSlice.js'), {});
  const store = configureStore({ reducer: { course: slice.courseReducer }, preloadedState: { course: { completedLevel: level } } });
  const route = { params }, auth = { currentUser: uid ? { uid } : null };
  const navigation = { navigate: (...args) => calls.push(['navigate', ...args]), goBack: () => calls.push(['back']) };
  const Card = Object.assign(function Card() {}, { Title: 'CardTitle' });
  const native = { View: 'View', Text: 'Text', Button: 'Button', ActivityIndicator: 'ActivityIndicator',
    StyleSheet: { create: value => value }, Alert: { alert: (...args) => calls.push(['alert', ...args]) } };
  const file = path.join(root, 'screens/QuizScreen.js');
  const Screen = load(file, {
    react: React, 'react-native': native, 'react-native-gesture-handler': { ScrollView: 'ScrollView' },
    'react-native-elements': { Card, Button: 'Button', Overlay: 'Overlay', Image: 'Image' },
    '@react-navigation/native': { useRoute: () => route, useNavigation: () => navigation },
    'react-redux': { useSelector: select => select(store.getState()), useDispatch: () => action => { actions.push(action); return store.dispatch(action); } },
    '../Progress/CourseSlice': slice, '../shared/localPlayService': { PLAYS: plays },
    '../firebaseConfig': { FIRESTORE_DB: 'fixture-db', FIREBASE_AUTH: auth },
    'firebase/firestore': { doc: (...args) => args, updateDoc: async (...args) => { writes.push(args); return write(...args); } },
  }).default;
  const h = { calls, actions, writes, store, route, auth, plays,
    render() {
      let tree, attempts = 0;
      do { assert.ok(++attempts < 20, 'screen state settles'); cursor = 0; effects = []; dirty = false; tree = Screen(); effects.forEach(run => run()); } while (dirty);
      return tree;
    },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    button(title) { return nodes(h.render(), 'Button').find(node => node.props.title === title); },
    answerAll(correct = true) {
      h.button(correct ? 'Correct A' : 'Wrong A').props.onPress();
      h.button(correct ? 'Correct B' : 'Wrong B').props.onPress();
    },
  };
  return h;
}

const malformed = [
  ['empty', []], ['missing', undefined], ['null', null], ['object', {}],
  ['null question', [null]], ['blank prompt', [{ ...questions()[0], question: ' ' }]],
  ['missing ID', [{ ...questions()[0], id: undefined }]], ['duplicate IDs', [questions()[0], { ...questions()[1], id: 1 }]],
  ['bad options', [{ ...questions()[0], options: [null, 'Correct A'] }]],
  ['sparse options', [{ ...questions()[0], options: [, 'Correct A', 'Wrong A'] }]],
  ['duplicate options', [{ ...questions()[0], options: ['Correct A', 'Correct A'] }]],
  ['ambiguous whitespace options', [{ ...questions()[0], options: ['Correct A', ' Correct A '] }]],
  ['absent correct option', [{ ...questions()[0], correctAnswer: 'Absent' }]],
];
for (const [label, quiz] of malformed) test(label + ' quiz is unavailable and cannot award or write progress', () => {
  const candidate = play(); candidate.quiz = quiz;
  const h = host({ plays: [candidate] }); const tree = h.render();
  assert.match(text(tree), /quiz.*unavailable|quiz.*not.*ready/i);
  assert.equal(nodes(tree, 'Button').some(node => node.props.title === 'Submit' && !node.props.disabled), false);
  assert.doesNotMatch(text(tree), /0\/0|earned a medal|next level unlocked/i);
  assert.equal(h.store.getState().course.completedLevel, 0); assert.deepEqual(h.actions, []); assert.deepEqual(h.writes, []);
  h.button('Back to course').props.onPress();
  assert.deepEqual(h.calls.at(-1), ['navigate', 'Main', { screen: 'Course' }]);
});

for (const params of [undefined, null, {}, { id: 'missing' }, { id: {} }]) test('invalid route ' + JSON.stringify(params) + ' is safe and unavailable', () => {
  const h = host(); h.route.params = params;
  const tree = h.render(); assert.match(text(tree), /quiz.*unavailable|quiz.*not.*ready/i);
  assert.equal(h.actions.length, 0); assert.equal(h.writes.length, 0);
});

test('incomplete answers cannot submit even through the callback boundary', async () => {
  const h = host(); h.button('Correct A').props.onPress(); const submit = h.button('Submit');
  assert.equal(submit.props.disabled, true); await submit.props.onPress();
  assert.equal(h.writes.length, 0); assert.equal(h.actions.length, 0);
  assert.doesNotMatch(text(h.render()), /earned a medal|next level unlocked/i);
});

test('a complete failed quiz shows its real score and never awards progress', async () => {
  const h = host(); h.answerAll(false); await h.button('Submit').props.onPress();
  assert.match(text(h.render()), /0\/2/); assert.doesNotMatch(text(h.render()), /earned a medal|next level unlocked/i);
  assert.equal(h.actions.length, 0); assert.equal(h.writes.length, 0);
});

test('valid pass keeps the existing all-correct threshold and awards only after confirmed persistence', async () => {
  const gate = deferred(), h = host({ write: () => gate.promise }); h.answerAll();
  const submit = h.button('Submit'); const pending = submit.props.onPress();
  assert.equal(h.writes.length, 1); assert.deepEqual(h.writes[0], [['fixture-db', 'users', 'fixture-owner'], { completedLevel: 1 }]);
  assert.equal(h.actions.length, 0); assert.doesNotMatch(text(h.render()), /earned a medal|next level unlocked/i);
  await submit.props.onPress(); assert.equal(h.writes.length, 1, 'rapid duplicate submission must not write twice');
  gate.resolve(); await pending;
  assert.equal(h.store.getState().course.completedLevel, 1); assert.equal(h.actions.length, 1);
  assert.match(text(h.render()), /2\/2/); assert.match(text(h.render()), /earned a medal/i);
  await submit.props.onPress(); assert.equal(h.writes.length, 1);
  h.button('Retake Quiz').props.onPress(); assert.equal(h.button('Submit').props.disabled, true);
});

test('one wrong answer does not lower the legitimate pass threshold', async () => {
  const h = host(); h.button('Correct A').props.onPress(); h.button('Wrong B').props.onPress(); await h.button('Submit').props.onPress();
  assert.match(text(h.render()), /1\/2/); assert.equal(h.actions.length, 0); assert.equal(h.writes.length, 0);
});

test('retaking completed work does not claim or write a new medal/unlock', async () => {
  const h = host({ level: 1 }); h.answerAll(); await h.button('Submit').props.onPress();
  assert.match(text(h.render()), /already completed/i); assert.doesNotMatch(text(h.render()), /earned a medal|next level unlocked/i);
  assert.equal(h.actions.length, 0); assert.equal(h.writes.length, 0);
});

test('a final play or existing numbering gap cannot invent a next-play unlock', async () => {
  for (const plays of [[play()], [play('fixture-a', questions(), 33), play('fixture-b', questions(), 35)]]) {
    const h = host({ plays, level: plays[0].difficulty - 1 }); h.answerAll(); await h.button('Submit').props.onPress();
    assert.match(text(h.render()), /earned a medal/i);
    assert.doesNotMatch(text(h.render()), /next level unlocked/i);
  }
});

test('missing authentication cannot change even local progress', async () => {
  const h = host({ uid: null }); h.answerAll(); await h.button('Submit').props.onPress();
  assert.match(text(h.render()), /sign in/i); assert.doesNotMatch(text(h.render()), /earned a medal|next level unlocked/i);
  assert.equal(h.store.getState().course.completedLevel, 0); assert.equal(h.actions.length, 0); assert.equal(h.writes.length, 0);
});

test('failed progress persistence never creates a local award or success claim', async () => {
  const h = host({ write: async () => { throw new Error('fixture offline'); } }); h.answerAll(); await h.button('Submit').props.onPress();
  assert.match(text(h.render()), /progress.*could not be saved/i); assert.doesNotMatch(text(h.render()), /earned a medal|next level unlocked/i);
  assert.equal(h.store.getState().course.completedLevel, 0); assert.equal(h.actions.length, 0); assert.equal(h.writes.length, 1);
});

test('submission revalidates content even when an earlier rendered callback survives', async () => {
  for (const quiz of [[], [{ ...questions()[0], correctAnswer: 'Absent' }]]) {
    const candidate = play(), h = host({ plays: [candidate] }); h.answerAll(); const stale = h.button('Submit');
    candidate.quiz = quiz; await stale.props.onPress();
    assert.equal(h.actions.length, 0); assert.equal(h.writes.length, 0);
    assert.doesNotMatch(text(h.render()), /earned a medal|next level unlocked/i);
  }
});

test('play switches, including A-to-B-to-A with reused IDs, retire answers and captured callbacks', async () => {
  const h = host({ plays: [play(), play('fixture-b', questions(), 2)] }); h.answerAll(); const old = h.button('Submit');
  h.route.params = { id: 'fixture-b' }; assert.equal(h.button('Submit').props.disabled, true); await old.props.onPress();
  h.route.params = { id: 'fixture-a' }; assert.equal(h.button('Submit').props.disabled, true); await old.props.onPress();
  assert.equal(h.actions.length, 0); assert.equal(h.writes.length, 0);
});

test('late save results cannot award or display completion on a different play or account', async () => {
  for (const change of ['play', 'account', 'unmount']) {
    const gate = deferred(), h = host({ plays: [play(), play('fixture-b', questions(), 2)], write: () => gate.promise }); h.answerAll();
    const pending = h.button('Submit').props.onPress();
    if (change === 'play') { h.route.params = { id: 'fixture-b' }; h.render(); }
    else if (change === 'account') h.auth.currentUser = { uid: 'another-fixture-owner' };
    else h.unmount();
    gate.resolve(); await pending; await tick();
    assert.equal(h.actions.length, 0); assert.equal(h.store.getState().course.completedLevel, 0);
    if (change !== 'unmount') assert.doesNotMatch(text(h.render()), /earned a medal|next level unlocked/i);
  }
});
