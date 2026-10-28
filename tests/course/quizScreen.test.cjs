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

function host({ plays = [play()], entries = [], params = { id: 'fixture-a' }, level = 0, uid = 'fixture-owner', write = async () => {}, quizRuntime } = {}) {
  const calls = [], actions = [], writes = [], slots = [], loaded = [], frames = [], focus = [], scrollCalls = [], timers = new Map(), backListeners = new Set(), navigationFocus = new Set();
  let nativeTag = 0, timerId = 0;
  let cursor = 0, effects = [], dirty = false;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const memo = (factory, deps) => { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: factory(), deps }; return slots[i].value; };
  const effect = (factory, deps) => { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: factory() }; }); };
  const React = {
    createElement(type, props, ...children) {
      if (type === 'ScrollView' && props?.ref) props.ref.current = { scrollTo: value => scrollCalls.push(value) };
      else if (typeof type === 'string' && props?.ref) props.ref.current = { nativeTag: ++nativeTag };
      const next = { ...props, children };
      return typeof type === 'function' ? type(next) : { type, props: next };
    },
    useRef: value => memo(() => ({ current: value }), []), useEffect: effect, useLayoutEffect: effect,
    useMemo: memo, useCallback: (fn, deps) => memo(() => fn, deps),
    useSyncExternalStore(subscribe, getSnapshot) {
      effect(() => subscribe(() => { dirty = true; }), [subscribe]);
      return getSnapshot();
    },
    useState: initial => {
      const slot = memo(() => ({ value: typeof initial === 'function' ? initial() : initial }), []);
      return [slot.value, next => { const value = typeof next === 'function' ? next(slot.value) : next; if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; } }];
    },
  };
  const cache = new Map();
  function load(file, deps) {
    if (cache.has(file)) return cache.get(file);
    const code = babel.transformFileSync(file, { babelrc: false, configFile: false,
      plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
    const module = { exports: {} };
    vm.runInThisContext('(function(require,module,exports,console,React,requestAnimationFrame,setTimeout,clearTimeout){' + code + '\n})', { filename: file })(
      name => {
        loaded.push(name);
        if (name === '../course/normalCourseProgress') {
          if (!normalSource) {
            const source = load(path.join(root, 'course/normalCourseProgress.js'), deps).normalCourseProgress;
            source.subscribe(() => store.dispatch(slice.receiveAccountProgress(source.getSnapshot())));
            source.start();
            store.dispatch(slice.receiveAccountProgress(source.getSnapshot()));
            normalSource = { ...source, commitLevel: level => {
              const confirmed = source.commitLevel(level);
              if (confirmed) actions.push(slice.setLevel(level));
              return confirmed;
            } };
          }
          return { normalCourseProgress: normalSource };
        }
        return Object.hasOwn(deps, name) ? deps[name] : name.startsWith('.') ? load(path.resolve(path.dirname(file), name + (path.extname(name) ? '' : '.js')), deps) : require(name);
      },
      module, module.exports, { log() {}, warn() {}, error() {} }, React, callback => frames.push(callback),
      callback => { const id = ++timerId; timers.set(id, callback); return id; }, id => timers.delete(id));
    cache.set(file, module.exports); return module.exports;
  }
  const slice = load(path.join(root, 'Progress/CourseSlice.js'), {});
  const store = configureStore({ reducer: { course: slice.courseReducer }, preloadedState: { course: { completedLevel: level } } });
  const route = { params }, auth = { currentUser: uid ? { uid } : null };
  const profiles = new Map([[uid, level]]);
  let normalSource;
  const profileSnapshot = ref => ({ exists: () => true, data: () => ({ completedLevel: profiles.get(ref[2]) || 0 }),
    metadata: { fromCache: false, hasPendingWrites: false } });
  const firestore = {
    doc: (...args) => args,
    onSnapshot: (ref, options, next) => { next(profileSnapshot(ref)); return () => {}; },
    getDocFromServer: async ref => profileSnapshot(ref),
    runTransaction: async (db, callback) => {
      const pending = [];
      const result = await callback({ get: async ref => profileSnapshot(ref), update: (ref, fields) => pending.push([ref, fields]) });
      for (const args of pending) { writes.push(args); await write(...args); profiles.set(args[0][2], args[1].completedLevel); }
      return result;
    },
  };
  const navigation = { navigate: (...args) => calls.push(['navigate', ...args]), push: (...args) => calls.push(['push', ...args]), goBack: () => calls.push(['back']),
    addListener: (event, listener) => { if (event === 'focus') navigationFocus.add(listener); return () => navigationFocus.delete(listener); } };
  const Card = Object.assign(function Card() {}, { Title: 'CardTitle' });
  const dispatch = action => { actions.push(action); return store.dispatch(action); };
  const native = { View: 'View', Text: 'Text', Button: 'Button', Pressable: 'Pressable', ScrollView: 'ScrollView', Modal: 'Modal', StatusBar: 'StatusBar', ActivityIndicator: 'ActivityIndicator',
    Image: Object.assign(props => ({ type: 'Image', props }), { resolveAssetSource: source => source ? { uri: 'asset:' + source } : null }),
    Animated: { View: 'AnimatedView', Value: class { setValue() {} interpolate(value) { return value; } }, timing: () => ({ start() {}, stop() {} }) },
    findNodeHandle: value => value?.nativeTag, AccessibilityInfo: { setAccessibilityFocus: value => focus.push(value), isReduceMotionEnabled: async () => true, addEventListener: () => ({ remove() {} }) },
    useWindowDimensions: () => ({ width: 411, height: 914, fontScale: 1 }),
    BackHandler: { addEventListener: (event, callback) => { backListeners.add(callback); return { remove: () => backListeners.delete(callback) }; } },
    StyleSheet: { create: value => value }, Alert: { alert: (...args) => calls.push(['alert', ...args]) } };
  const file = path.join(root, 'screens/QuizScreen.js');
  const Screen = load(file, {
    react: React, 'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, 'react-native-gesture-handler': { ScrollView: 'ScrollView' },
    'react-native-elements': { Card, Button: 'Button', Overlay: 'Overlay', Image: 'Image' },
    '@react-navigation/native': { useRoute: () => route, useNavigation: () => navigation, useIsFocused: () => true },
    'react-redux': { useSelector: select => select(store.getState()), useDispatch: () => dispatch },
    '../Progress/CourseSlice': slice, '../shared/localPlayService': { PLAYS: plays, getLocalPlayEntry: id => entries.find(entry => entry.slug === id) },
    '../firebaseConfig': { FIRESTORE_DB: 'fixture-db', FIREBASE_AUTH: auth },
    'firebase/firestore': firestore,
    'firebase/auth': { onAuthStateChanged: () => () => {} },
  }).default;
  const h = { calls, actions, writes, store, route, auth, plays, loaded, frames, focus, scrollCalls,
    returnFocus() { navigationFocus.forEach(listener => listener()); },
    hardwareBack() { return [...backListeners].reverse().some(callback => callback()); },
    render() {
      let tree, attempts = 0;
      do { assert.ok(++attempts < 20, 'screen state settles'); cursor = 0; effects = []; dirty = false; tree = Screen({ quizRuntime }); effects.forEach(run => run()); } while (dirty);
      return tree;
    },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    flushTimers() { h.render(); const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(run => run()); h.render(); },
    check() { h.button('Check answer').props.onPress(); h.render(); h.flushTimers(); },
    button(title) {
      const label = ({ Submit: 'Finish quiz', 'Retake Quiz': 'Retake quiz', Next: 'Continue' })[title] || title;
      return nodes(h.render(), 'Pressable').find(node => node.props.accessibilityLabel === label);
    },
    answerAll(correct = true) {
      h.button(correct ? 'Correct A' : 'Wrong A').props.onPress();
      h.check();
      h.button('Next').props.onPress();
      h.button(correct ? 'Correct B' : 'Wrong B').props.onPress();
      h.check();
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
  assert.equal(nodes(tree, 'Pressable').some(node => ['Check answer', 'Finish quiz'].includes(node.props.accessibilityLabel) && !node.props.disabled), false);
  assert.doesNotMatch(text(tree), /0\/0|(?:earned a medal|medal added to your collection)|next level unlocked/i);
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
  const h = host(); const next = h.button('Check answer');
  assert.equal(next.props.disabled, true); assert.equal(next.props.onPress, undefined);
  h.button('Correct A').props.onPress(); h.check(); h.button('Next').props.onPress();
  assert.equal(h.button('Check answer').props.disabled, true); assert.equal(h.button('Check answer').props.onPress, undefined);
  assert.equal(h.button('Submit'), undefined);
  assert.equal(h.writes.length, 0); assert.equal(h.actions.length, 0);
  assert.doesNotMatch(text(h.render()), /(?:earned a medal|medal added to your collection)|next level unlocked/i);
});

test('a complete failed quiz shows its real score and never awards progress', async () => {
  const h = host(); h.answerAll(false); await h.button('Submit').props.onPress();
  assert.match(text(h.render()), /0\/2/); assert.doesNotMatch(text(h.render()), /(?:earned a medal|medal added to your collection)|next level unlocked/i);
  assert.equal(h.actions.length, 0); assert.equal(h.writes.length, 0);
});

test('valid pass keeps the existing all-correct threshold and awards only after confirmed persistence', async () => {
  const gate = deferred(), h = host({ write: () => gate.promise }); h.answerAll();
  const submit = h.button('Submit'); const pending = submit.props.onPress();
  await tick(); // The transaction reads the profile before attempting its write.
  assert.equal(h.writes.length, 1); assert.deepEqual(h.writes[0], [['fixture-db', 'users', 'fixture-owner'], { completedLevel: 1 }]);
  assert.equal(h.actions.length, 0); assert.doesNotMatch(text(h.render()), /(?:earned a medal|medal added to your collection)|next level unlocked/i);
  await submit.props.onPress(); assert.equal(h.writes.length, 1, 'rapid duplicate submission must not write twice');
  gate.resolve(); await pending;
  assert.equal(h.store.getState().course.completedLevel, 1); assert.equal(h.actions.length, 1);
  assert.match(text(h.render()), /2\/2/); assert.match(text(h.render()), /medal added to your collection/i);
  await submit.props.onPress(); assert.equal(h.writes.length, 1);
  h.button('Retake Quiz').props.onPress(); assert.equal(h.button('Check answer').props.disabled, true);
});

test('one wrong answer does not lower the legitimate pass threshold', async () => {
  const h = host(); h.button('Correct A').props.onPress(); h.check(); h.button('Next').props.onPress();
  h.button('Wrong B').props.onPress(); h.check(); await h.button('Submit').props.onPress();
  assert.match(text(h.render()), /1\/2/); assert.equal(h.actions.length, 0); assert.equal(h.writes.length, 0);
});

test('unchecked answers stay editable while checked review cannot unlock recorded answers', () => {
  const h = host();
  assert.equal(h.button('Wrong B'), undefined, 'only the current question is rendered');
  h.button('Wrong A').props.onPress();
  assert.doesNotMatch(text(h.render()), /correct answer|incorrect|(?:earned a medal|medal added to your collection)/i);
  h.button('Correct A').props.onPress();
  h.check();
  h.button('Next').props.onPress();
  h.button('Correct B').props.onPress();
  h.button('Previous').props.onPress();
  h.flushTimers();
  assert.equal(h.button('Correct A'), undefined);
  assert.match(text(h.render()), /Correct/);
  h.button('Next').props.onPress();
  assert.equal(h.button('Correct B').props.accessibilityState.checked, true);
  h.button('Wrong B').props.onPress(); h.check();
  assert.match(text(h.render()), /Not quite/);
  assert.equal(h.button('Correct B'), undefined);
});

test('retaking completed work does not claim or write a new medal/unlock', async () => {
  const h = host({ level: 1 }); h.answerAll(); await h.button('Submit').props.onPress();
  assert.match(text(h.render()), /already completed/i); assert.doesNotMatch(text(h.render()), /(?:earned a medal|medal added to your collection)|next level unlocked/i);
  assert.equal(h.actions.length, 0); assert.equal(h.writes.length, 0);
});

test('a final play or existing numbering gap cannot invent a next-play unlock', async () => {
  for (const plays of [[play()], [play('fixture-a', questions(), 33), play('fixture-b', questions(), 35)]]) {
    const h = host({ plays, level: plays[0].difficulty - 1 }); h.answerAll(); await h.button('Submit').props.onPress();
    assert.match(text(h.render()), /medal added to your collection/i);
    assert.doesNotMatch(text(h.render()), /next level unlocked/i);
  }
});

test('missing authentication cannot change even local progress', async () => {
  const h = host({ uid: null });
  assert.equal(h.button('Correct A'), undefined);
  assert.match(text(h.render()), /sign in/i); assert.doesNotMatch(text(h.render()), /(?:earned a medal|medal added to your collection)|next level unlocked/i);
  assert.equal(h.store.getState().course.completedLevel, 0); assert.equal(h.actions.length, 0); assert.equal(h.writes.length, 0);
});

test('failed progress persistence never creates a local award or success claim', async () => {
  const h = host({ write: async () => { throw new Error('fixture offline'); } }); h.answerAll(); await h.button('Submit').props.onPress();
  assert.match(text(h.render()), /progress.*could not be saved/i); assert.doesNotMatch(text(h.render()), /(?:earned a medal|medal added to your collection)|next level unlocked/i);
  assert.equal(h.store.getState().course.completedLevel, 0); assert.equal(h.actions.length, 0); assert.equal(h.writes.length, 1);
});

test('submission revalidates content even when an earlier rendered callback survives', async () => {
  for (const quiz of [[], [{ ...questions()[0], correctAnswer: 'Absent' }]]) {
    const candidate = play(), h = host({ plays: [candidate] }); h.answerAll(); const stale = h.button('Submit');
    candidate.quiz = quiz; await stale.props.onPress();
    assert.equal(h.actions.length, 0); assert.equal(h.writes.length, 0);
    assert.doesNotMatch(text(h.render()), /(?:earned a medal|medal added to your collection)|next level unlocked/i);
  }
});

test('play switches, including A-to-B-to-A with reused IDs, retire answers and captured callbacks', async () => {
  const h = host({ plays: [play(), play('fixture-b', questions(), 2)] }); h.answerAll(); const old = h.button('Submit');
  h.route.params = { id: 'fixture-b' }; assert.equal(h.button('Check answer').props.disabled, true); await old.props.onPress();
  h.route.params = { id: 'fixture-a' }; assert.equal(h.button('Check answer').props.disabled, true); await old.props.onPress();
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
    if (change !== 'unmount') assert.doesNotMatch(text(h.render()), /(?:earned a medal|medal added to your collection)|next level unlocked/i);
  }
});

test('retry save retains the submitted score and does not repeat quiz actions', async () => {
  let attempts = 0;
  const h = host({ write: async () => { if (++attempts === 1) throw new Error('fixture interruption'); } });
  h.answerAll(); await h.button('Submit').props.onPress();
  assert.match(text(h.render()), /2\/2/);
  const retry = h.button('Retry save'); assert.ok(retry);
  await retry.props.onPress(); await retry.props.onPress();
  assert.equal(attempts, 2); assert.equal(h.actions.length, 1);
  assert.match(text(h.render()), /medal added to your collection/i);
  assert.equal(h.button('Retry save'), undefined);
});

test('injected preview runtime never imports normal authentication or Firestore', async () => {
  const { createQuizRuntime } = require('../../course/quizRuntime');
  let memoryLevel = 0, memoryWrites = 0;
  const runtime = createQuizRuntime({ getUid: () => 'preview-only', getLevel: () => memoryLevel,
    saveProgress: async () => { memoryWrites++; return Object.freeze({ completedLevel: 1, advanced: true }); }, commitLevel: level => { memoryLevel = level; } });
  const h = host({ quizRuntime: runtime }); h.answerAll(); await h.button('Submit').props.onPress();
  assert.equal(memoryWrites, 1); assert.equal(memoryLevel, 1);
  assert.equal(h.loaded.some(name => /firebaseConfig|firebase\//.test(name)), false);
  assert.equal(h.writes.length, 0); assert.equal(h.actions.length, 0);
});

function midsummerHost() {
  const folder = path.join(root, 'data/plays/a-midsummer-nights-dream');
  const read = file => JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8'));
  const sourcePlay = read('play.json'), content = read('quiz.json');
  const entry = { slug: content.workId, play: sourcePlay, quiz: content,
    sections: sourcePlay.sections.map(section => read(section.path)) };
  const h = host({ plays: [play(content.workId, content.questions)], entries: [entry], params: { id: content.workId } });
  return { h, content };
}

test('actual ten-question pilot reaches results with exact supporting quotations and source labels', async () => {
  const { h, content } = midsummerHost();
  for (const [index, question] of content.questions.entries()) {
    assert.match(text(h.render()), new RegExp(`Question ${index + 1} of 10`));
    assert.doesNotMatch(text(h.render()), /Correct answer:|Answer review/);
    h.button(question.options.find(option => option.id === question.correctOptionId).text).props.onPress();
    h.check();
    if (index < content.questions.length - 1) h.button('Next').props.onPress();
  }
  await h.button('Submit').props.onPress();
  const tree = h.render(); assert.match(text(tree), /10\/10 correct/);
  assert.match(text(tree), /Act I \u00b7 Scene I/);
  const selectable = nodes(tree, 'Text').filter(node => node.props.selectable).map(text);
  assert.deepEqual(selectable, content.questions.flatMap(question => question.evidence.map(selection => selection.exact)));
  assert.equal(selectable.length, 16);
});

test('supporting passage opens only after checking and returns to the same locked feedback', () => {
  const { h, content } = midsummerHost();
  const first = content.questions[0];
  assert.equal(h.button('Read supporting passage'), undefined);
  h.button(first.options[1].text).props.onPress(); h.check();
  assert.match(text(h.render()), /Not quite/);
  const open = h.button('Read supporting passage'); open.props.onPress();
  let modal = nodes(h.render(), 'Modal')[0]; assert.ok(modal);
  assert.match(text(modal), /Act I \u00b7 Scene I/);
  assert.deepEqual(nodes(modal, 'Text').filter(n => n.props.selectable).map(text), first.evidence.map(e => e.exact));
  const oldClose = modal.props.onRequestClose;
  oldClose(); assert.equal(nodes(h.render(), 'Modal').length, 0);
  assert.match(text(h.render()), /Not quite/); assert.equal(h.button(first.options[0].text), undefined);
  h.button('Continue').props.onPress(); open.props.onPress(); assert.equal(nodes(h.render(), 'Modal').length, 0);
  const second = content.questions[1];
  h.button(second.options[0].text).props.onPress(); h.check();
  h.button('Read supporting passage').props.onPress(); oldClose();
  modal = nodes(h.render(), 'Modal')[0]; assert.ok(modal, 'late prior modal dismissal cannot close a newer passage');
  h.button('Close supporting passage').props.onPress(); assert.equal(nodes(h.render(), 'Modal').length, 0);
  assert.equal(h.writes.length, 0); assert.equal(h.actions.length, 0);
});

test('retained same-question check handlers cannot lock an answer after a new retake', async () => {
  const h = host(); h.button('Correct A').props.onPress(); const oldCheck = h.button('Check answer');
  h.answerAll(); await h.button('Finish quiz').props.onPress(); h.button('Retake quiz').props.onPress();
  h.button('Wrong A').props.onPress(); oldCheck.props.onPress();
  assert.ok(h.button('Correct A'), 'new attempt is still editable');
  assert.doesNotMatch(text(h.render()), /Not quite|Correct answer:/);
});

test('late evidence focus restoration cannot target a later question', () => {
  const { h, content } = midsummerHost();
  h.button(content.questions[0].options[0].text).props.onPress(); h.check();
  h.button('Read supporting passage').props.onPress(); h.button('Close supporting passage').props.onPress();
  assert.equal(h.frames.length, 1);
  h.button('Continue').props.onPress();
  h.button(content.questions[1].options[0].text).props.onPress(); h.check();
  h.render(); h.frames[0]();
  assert.deepEqual(h.focus, []);
});

test('rapid repeated activation cannot change Check answer into an immediate Continue', () => {
  const h = host(); h.button('Correct A').props.onPress();
  const check = h.button('Check answer'); check.props.onPress(); check.props.onPress();
  assert.equal(h.button('Continue').props.disabled, true);
  assert.equal(h.button('Continue').props.onPress, undefined);
  assert.match(text(h.render()), /Question 1 of 2/);
  h.flushTimers();
  assert.equal(h.button('Continue').props.disabled, false);
  assert.match(text(h.render()), /Question 1 of 2/, 'timer only enables the action and never advances');
  h.button('Continue').props.onPress(); assert.match(text(h.render()), /Question 2 of 2/);
});

test('Android Back cancels a passage opening before its modal commits and keeps feedback', () => {
  const { h, content } = midsummerHost();
  h.button(content.questions[0].options[0].text).props.onPress(); h.check();
  h.button('Read supporting passage').props.onPress();
  assert.equal(h.hardwareBack(), true);
  assert.equal(nodes(h.render(), 'Modal').length, 0);
  assert.match(text(h.render()), /Correct/);
  assert.match(text(h.render()), /Question 1 of 10/);
  assert.equal(h.hardwareBack(), false, 'ordinary Back still belongs to the navigator');
  assert.deepEqual(h.writes, []);
});

test('a passage opened during a question transition cannot reopen on later review', () => {
  const { h, content } = midsummerHost();
  h.button(content.questions[0].options[0].text).props.onPress(); h.check();
  const continueAction = h.button('Continue');
  h.button('Read supporting passage').props.onPress(); continueAction.props.onPress();
  assert.equal(nodes(h.render(), 'Modal').length, 0);
  h.button('Previous').props.onPress();
  assert.equal(nodes(h.render(), 'Modal').length, 0);
  assert.match(text(h.render()), /Question 1 of 10/);
});

test('authored metadata without schemaVersion cannot fall back to legacy screen questions', () => {
  for (const marker of ['quizContentVersion', 'workId', 'contentVersion', 'canonicalTextVersion']) {
    const candidate = play();
    const entry = { slug: candidate.id, quiz: { [marker]: 'stale-authored-marker', questions: candidate.quiz } };
    const h = host({ plays: [candidate], entries: [entry] });
    assert.match(text(h.render()), /Quiz unavailable/, marker);
    assert.equal(h.button('Correct A'), undefined);
    assert.equal(h.actions.length, 0); assert.equal(h.writes.length, 0);
  }
});

function flushFrames(h) {
  for (let n = 0; n < 4 && h.frames.length; n++) h.frames.splice(0).forEach(run => run());
}

test('each supporting excerpt opens its exact full-play reference once after the modal closes', () => {
  for (const index of [0, 1]) {
    const { h, content } = midsummerHost();
    h.button(content.questions[0].options[1].text).props.onPress(); h.check();
    h.button('Read supporting passage').props.onPress();
    const modal = nodes(h.render(), 'Modal')[0];
    const buttons = nodes(modal, 'Pressable').filter(n => /^Open supporting passage \d+ in full play$/.test(n.props.accessibilityLabel));
    assert.equal(buttons.length, 2, 'each distinct quotation has its own destination');
    buttons[index].props.onPress(); buttons[index].props.onPress();
    assert.equal(nodes(h.render(), 'Modal').length, 0, 'close before covering the quiz with the reader');
    assert.deepEqual(h.calls, [], 'navigation waits for the closed modal commit');
    flushFrames(h);
    assert.deepEqual(h.calls, [['push', 'MIT', { id: content.workId, openPassage: content.questions[0].evidence[index] }]]);
    assert.match(text(h.render()), /Not quite/);
    assert.equal(h.button(content.questions[0].options[0].text), undefined, 'the original checked answer remains locked for Back');
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.focus, [], 'closing for a reader jump must not focus the covered quiz');
  }
});

test('a deferred full-play jump is cancelled by newer quiz or account state', () => {
  for (const change of ['question', 'account', 'unmount']) {
    const { h, content } = midsummerHost();
    h.button(content.questions[0].options[0].text).props.onPress(); h.check();
    const next = h.button('Continue');
    h.button('Read supporting passage').props.onPress();
    h.button('Open supporting passage 1 in full play').props.onPress(); h.render();
    if (change === 'question') { next.props.onPress(); h.render(); }
    if (change === 'account') h.auth.currentUser = { uid: 'another-fixture-owner' };
    if (change === 'unmount') h.unmount();
    flushFrames(h);
    assert.deepEqual(h.calls, [], change);
    assert.deepEqual(h.writes, [], change);
  }
});

test('Back during the modal-to-reader handoff cancels the jump and keeps the checked feedback', () => {
  for (const cancel of ['hardware', 'native-modal']) {
    const { h, content } = midsummerHost();
    h.button(content.questions[0].options[0].text).props.onPress(); h.check();
    h.button('Read supporting passage').props.onPress();
    const closeModal = nodes(h.render(), 'Modal')[0].props.onRequestClose;
    h.button('Open supporting passage 1 in full play').props.onPress(); h.render();
    if (cancel === 'hardware') assert.equal(h.hardwareBack(), true, 'Back cancels the pending reader before the navigator can pop Quiz');
    else closeModal();
    h.render(); flushFrames(h);
    assert.deepEqual(h.calls, []);
    assert.match(text(h.render()), /Question 1 of 10/);
    assert.match(text(h.render()), /Correct/);
    assert.equal(h.button(content.questions[0].options[0].text), undefined);
    assert.equal(h.hardwareBack(), false, 'the cancelled transfer does not keep intercepting ordinary Back');
    h.button('Read supporting passage').props.onPress();
    assert.equal(nodes(h.render(), 'Modal').length, 1, 'supporting passages can be reopened normally');
  }
});

test('View medals pushes the existing Home collection once and can reopen after Back without another award', async () => {
  const h = host(); h.answerAll(); await h.button('Finish quiz').props.onPress();
  const tree = h.render(); assert.equal(nodes(tree, 'Image')[0].props.source, 1);
  const open = h.button('View medals'); assert.ok(open);
  open.props.onPress(); open.props.onPress();
  assert.deepEqual(h.calls, [['push', 'Main', { screen: 'Home', params: { tab: 'Medals' } }]]);
  h.returnFocus(); h.button('View medals').props.onPress();
  assert.equal(h.calls.length, 2); assert.equal(h.writes.length, 1);
  h.button('Retake quiz').props.onPress(); open.props.onPress(); assert.equal(h.calls.length, 2, 'a stale result cannot open the collection after Retake');
});

test('incorrect results prioritize the actual missed count and scroll Review answers without a reward', async () => {
  const h = host(); h.answerAll(false); await h.button('Finish quiz').props.onPress();
  const tree = h.render(); assert.match(text(tree), /2 answers to revisit/); assert.equal(nodes(tree, 'Image').length, 0); assert.equal(h.button('View medals'), undefined);
  const reviewGroup = nodes(tree, 'View').find(n => n.props.onLayout);
  reviewGroup.props.onLayout({ nativeEvent: { layout: { y: 420 } } });
  h.button('Review answers').props.onPress(); assert.deepEqual(h.scrollCalls.at(-1), { y: 420, animated: true });
  assert.deepEqual(h.writes, []); assert.deepEqual(h.actions, []);
});
