const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');
const { createQuizAttempt } = require('../../course/quizAttempt');

const root = path.resolve(__dirname, '../..');
const tick = () => new Promise(resolve => setImmediate(resolve));
const quiz = { key: 'rewards-fixture', playId: 'fixture-play', level: 1, questions: [
  { id: 'q1', options: ['one', 'two'], correctAnswer: 'one' },
  { id: 'q2', options: ['three', 'four'], correctAnswer: 'four' },
] };

function factory({ unavailable = false } = {}) {
  const filename = path.join(root, 'course/courseRewardsEnvironment.js');
  assert.ok(fs.existsSync(filename), 'the isolated rewards environment exists');
  const instances = [], imports = [], branded = new WeakSet();
  const isolated = {
    DEMO_PROJECT_ID: 'demo-bard-highlights-sync',
    assertIsolatedHighlightEnvironment(value) { assert.ok(branded.has(value)); return value; },
    async createHighlightSyncEmulatorEnvironment(options) {
      assert.equal(options.projectId, 'demo-bard-highlights-sync');
      assert.ok(['127.0.0.1', 'localhost', '10.0.2.2'].includes(options.host));
      if (unavailable) throw new Error('Emulator unavailable');
      const uid = 'synthetic-course-' + (instances.length + 1), listeners = new Set();
      let profile = null, closed = false;
      const calls = { profileWrites: 0, transactions: 0, closes: 0, ready: 0, emails: [] };
      const auth = { currentUser: null };
      const snapshot = () => ({ exists: () => profile !== null, data: () => profile,
        metadata: { fromCache: false, hasPendingWrites: false } });
      const notify = () => listeners.forEach(fn => fn(snapshot()));
      const env = { projectId: 'demo-bard-highlights-sync', host: options.host, db: {}, auth,
        assertReady: async () => { assert.equal(closed, false); calls.ready++; return true; },
        authSdk: { onAuthStateChanged(actual, fn) { assert.equal(actual, auth); fn(auth.currentUser); return () => {}; } },
        sdk: {
          doc(db, collection, actualUid) { assert.equal(db, env.db); assert.equal(collection, 'users'); assert.equal(actualUid, uid); return { uid }; },
          async setDoc(ref, value) { assert.equal(ref.uid, uid); assert.equal(profile, null, 'only a fresh synthetic account is seeded'); calls.profileWrites++; profile = { ...value }; notify(); },
          onSnapshot(ref, options, next) { assert.equal(ref.uid, uid); listeners.add(next); next(snapshot()); return () => listeners.delete(next); },
          getDocFromServer: async ref => { assert.equal(ref.uid, uid); return snapshot(); },
          async runTransaction(db, callback) { assert.equal(db, env.db); calls.transactions++;
            return callback({ get: async ref => { assert.equal(ref.uid, uid); return snapshot(); },
              update(ref, fields) { assert.equal(ref.uid, uid); profile = { ...profile, ...fields }; notify(); } }); },
        },
        async signInSynthetic({ email }) { assert.match(email, /^[a-z0-9-]+@bard-sync\.test$/); calls.emails.push(email); auth.currentUser = { uid }; },
        async close() { closed = true; calls.closes++; },
      };
      branded.add(env); instances.push({ env, calls, profile: () => profile }); return env;
    },
  };
  const module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + fs.readFileSync(filename, 'utf8') + '\n})', { filename })(name => {
    imports.push(name);
    if (name === '../reader/highlightSyncEnvironment') return isolated;
    return name.startsWith('.') ? require(path.resolve(path.dirname(filename), name)) : require(name);
  }, module, module.exports);
  return { create: module.exports.createCourseRewardsScenario, instances, imports };
}

function answer(scenario, correct = true) {
  const attempt = createQuizAttempt({ ...scenario.runtime, getQuiz: () => quiz });
  const token = attempt.getSnapshot().attemptToken;
  for (const q of quiz.questions) {
    attempt.choose(q.id, correct ? q.correctAnswer : q.options.find(id => id !== q.correctAnswer), token);
    attempt.checkAnswer(q.id, token); attempt.next(q.id, token);
  }
  return attempt;
}

test('course emulator entry requires explicit development opt-in and never imports the normal app', () => {
  const code = babel.transformFileSync(path.join(root, 'App.js'), { babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-modules-commonjs'] }).code;
  for (const options of [{ flag: 'emulator', dev: true }, { flag: 'emulator', dev: false },
    { flag: 'emulator', dev: true, highlight: 'emulator' }]) {
    const imports = [], module = { exports: {} };
    const run = () => vm.runInNewContext(code, { module, exports: module.exports, __DEV__: options.dev,
      process: { env: { EXPO_PUBLIC_BARD_COURSE_UI_TEST: options.flag, EXPO_PUBLIC_BARD_HIGHLIGHT_SYNC_TEST: options.highlight } },
      require(name) { imports.push(name); return { default: name }; } });
    if (options.dev && !options.highlight) { run(); assert.deepEqual(imports, ['./course/CourseRewardsEmulatorHarness']); }
    else { assert.throws(run, /development|isolated|conflict/i); assert.deepEqual(imports, []); }
  }
});

test('new isolated rewards completion uses the actual course controller, session and transaction transport', async () => {
  const h = factory(); const scenario = await h.create('pass', { host: '127.0.0.1' });
  assert.equal(scenario.runtime.getLevel(), 0);
  const attempt = answer(scenario); await attempt.submit(); await tick();
  assert.equal(attempt.getSnapshot().result.outcome, 'saved');
  assert.equal(attempt.getSnapshot().result.correct, 2);
  assert.equal(scenario.runtime.getLevel(), 1);
  assert.equal(h.instances[0].calls.transactions, 1);
  assert.deepEqual(h.instances[0].profile(), { completedLevel: 1 });
  assert.equal(h.imports.some(name => /firebaseConfig|normalCourseProgress|AsyncStorage|redux/.test(name)), false);
  attempt.dispose(); await scenario.dispose(); assert.equal(h.instances[0].calls.closes, 1);
});

test('one isolated save failure has no award and retry confirms the same score through the real transaction', async () => {
  const h = factory(); const scenario = await h.create('save-failed', { host: '127.0.0.1' });
  const attempt = answer(scenario); await attempt.submit();
  const failed = attempt.getSnapshot().result;
  assert.equal(failed.outcome, 'save-failed'); assert.equal(scenario.runtime.getLevel(), 0);
  assert.equal(h.instances[0].calls.transactions, 0);
  await attempt.retrySave(); await attempt.retrySave();
  assert.equal(attempt.getSnapshot().result.outcome, 'saved');
  assert.equal(attempt.getSnapshot().result.answers, failed.answers);
  assert.equal(h.instances[0].calls.transactions, 1);
  assert.equal(scenario.getStats().saveCalls, 2);
  attempt.dispose(); await scenario.dispose();
});

test('replay and incorrect scenarios cannot write completion and each scenario owns a fresh synthetic account', async () => {
  const h = factory();
  for (const mode of ['replay', 'incorrect']) {
    const scenario = await h.create(mode, { host: '127.0.0.1' });
    const attempt = answer(scenario, mode !== 'incorrect'); await attempt.submit();
    assert.equal(attempt.getSnapshot().result.outcome, mode === 'replay' ? 'replay' : 'failed');
    assert.equal(scenario.getStats().saveCalls, 0);
    assert.equal(h.instances.at(-1).calls.transactions, 0);
    attempt.dispose(); await scenario.dispose();
  }
  assert.notEqual(h.instances[0].calls.emails[0], h.instances[1].calls.emails[0]);
});

test('unknown scenarios or unavailable emulators fail without live backend fallback', async () => {
  const h = factory(); await assert.rejects(h.create('live'), /scenario/i); assert.equal(h.instances.length, 0);
  const blocked = factory({ unavailable: true }); await assert.rejects(blocked.create('pass'), /unavailable/i);
  assert.equal(blocked.imports.some(name => /firebaseConfig|normalCourseProgress/.test(name)), false);
});

test('the rewards harness contains only the actual quiz and shared collection inside a separate emulator entry', () => {
  const file = path.join(root, 'course/CourseRewardsEmulatorHarness.js');
  assert.ok(fs.existsSync(file), 'the emulator-only UI entry exists');
  const imports = [], module = { exports: {} };
  const code = babel.transformFileSync(file, { babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
  vm.runInThisContext('(function(require,module,exports,__DEV__,process){' + code + '\n})', { filename: file })(name => {
    imports.push(name);
    if (name === 'react') return {};
    if (name === '@react-navigation/stack') return { createStackNavigator: () => ({}) };
    if (name === './CourseUI') return { COURSE_COLORS: {} };
    if (name === '../shared/localPlayService') return { PLAYS: [] };
    return {};
  }, module, module.exports, true, { env: { EXPO_PUBLIC_BARD_COURSE_UI_TEST: 'emulator' } });
  assert.ok(imports.includes('../screens/QuizScreen'));
  assert.ok(imports.includes('./MedalsCollection'));
  assert.ok(imports.includes('./courseRewardsEnvironment'));
  assert.equal(imports.some(name => /firebaseConfig|normalCourseProgress|AsyncStorage|redux|HomeScreen/.test(name)), false);
});

test('the course emulator configuration uses only the reviewed merged rules and fixed local demo ports', () => {
  const file = path.join(root, 'tests/firestore/firebase.course.demo.json');
  assert.ok(fs.existsSync(file), 'the course emulator fixture exists');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(path.resolve(path.dirname(file), config.firestore.rules), path.join(root, 'docs/reader/production/firestore.rules'));
  assert.deepEqual(config.emulators.auth, { host: '127.0.0.1', port: 9199 });
  assert.deepEqual(config.emulators.firestore, { host: '127.0.0.1', port: 8180 });
  assert.equal(config.emulators.ui.enabled, false);
});
