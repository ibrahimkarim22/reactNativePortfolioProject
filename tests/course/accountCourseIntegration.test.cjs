const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');

const root = path.resolve(__dirname, '../..');
function load(file, dependencies) {
  const code = babel.transformFileSync(path.join(root, file), { babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
  const module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: file })(
    name => Object.hasOwn(dependencies, name) ? dependencies[name] : name.startsWith('.')
      ? require(path.resolve(root, path.dirname(file), name)) : require(name),
    module, module.exports);
  return module.exports;
}

test('legacy unowned course cache is neither restored nor persisted over account authority', () => {
  let config;
  const identity = value => value;
  load('redux/store.js', {
    '@reduxjs/toolkit': { combineReducers: value => value, configureStore: () => ({}) },
    '../folgerLibrary/folgerSlice': { folgerReducer: identity },
    '../completeWorks/MITShakespeareSlice': { MITReducer: identity },
    '../charactersList/FolgerCharacterList': { FolgerCharacterReducer: identity },
    '../Progress/CourseSlice': { courseReducer: identity },
    'redux-persist': { persistReducer: value => { config = value; return identity; }, persistStore: () => ({}) },
    '@react-native-async-storage/async-storage': { __esModule: true, default: {} },
  });
  assert.ok(config.blacklist?.includes('course'), 'Firestore account progress is not a global persisted scalar');
  const reduced = { course: { completedLevel: 0, status: 'loading' }, folger: { fresh: true }, MIT: {} };
  const result = config.stateReconciler({ course: { completedLevel: 39 }, folger: { retained: true } }, reduced, reduced, { debug: false });
  assert.equal(result.course, reduced.course, 'old account progress never becomes initial course authority');
  assert.deepEqual(result.folger, { retained: true }, 'unrelated persisted state retains its existing reconciliation');
});

function normal() {
  const auth = { currentUser: { uid: 'fixture-a' } }, db = {};
  const authListeners = new Set(), observers = [], reads = [], transactions = [];
  let remote = 2;
  const service = load('course/normalCourseProgress.js', {
    '../firebaseConfig': { FIREBASE_AUTH: auth, FIRESTORE_DB: db },
    'firebase/auth': { onAuthStateChanged(actual, notify) { assert.equal(actual, auth); authListeners.add(notify); return () => authListeners.delete(notify); } },
    'firebase/firestore': {
      doc: (actual, collection, uid) => { assert.equal(actual, db); assert.equal(collection, 'users'); return { uid }; },
      onSnapshot(ref, options, next, error) { const observer = { ref, options, next, error, active: true }; observers.push(observer); return () => { observer.active = false; }; },
      getDocFromServer: async ref => { reads.push(ref); return snapshot(remote); },
      runTransaction: async (actual, callback) => {
        assert.equal(actual, db);
        transactions.push(true);
        return callback({ get: async () => snapshot(remote), update: (ref, fields) => { assert.deepEqual(Object.keys(fields), ['completedLevel']); remote = fields.completedLevel; } });
      },
    },
  }).normalCourseProgress;
  function snapshot(level) { return { exists: () => true, data: () => ({ completedLevel: level, profileImage: 'fixture-preserved' }),
    metadata: { fromCache: false, hasPendingWrites: false } }; }
  const emit = level => observers.at(-1).next(snapshot(level));
  return { service, auth, observers, reads, transactions, emit, getRemote: () => remote,
    switchOwner(uid) { auth.currentUser = uid ? { uid } : null; for (const notify of authListeners) notify(auth.currentUser); } };
}

test('normal adapter restores signed-in Firestore progress, observes remote changes, and refreshes without writes', async () => {
  const h = normal(); h.service.start();
  assert.equal(h.service.getSnapshot().status, 'loading');
  assert.equal(h.observers[0].ref.uid, 'fixture-a');
  assert.equal(h.observers[0].options.includeMetadataChanges, true);
  h.emit(2); assert.equal(h.service.getLevel(), 2);
  h.emit(4); assert.equal(h.service.getLevel(), 4);
  await h.service.refresh();
  assert.equal(h.reads.length, 1); assert.equal(h.service.getLevel(), 4);
  assert.equal(h.transactions.length, 0);
  h.service.stop();
});

test('normal adapter uses the current account transaction and rejects a retired bound account', async () => {
  const h = normal(); h.service.start(); h.emit(2);
  const { bindCourseRuntime } = require('../../course/bindCourseRuntime');
  const runtime = bindCourseRuntime(h.service, h.service.getOwner());
  const ack = await runtime.saveProgress('fixture-a', 3);
  assert.deepEqual(ack, { completedLevel: 3, advanced: true });
  runtime.commitLevel(3); assert.equal(h.service.getLevel(), 3); assert.equal(h.getRemote(), 3);
  h.switchOwner('fixture-b'); assert.equal(h.service.getLevel(), null);
  assert.equal(h.service.getSnapshot().completedLevel, 0);
  h.emit(1); assert.equal(h.service.getLevel(), 1);
  await assert.rejects(runtime.saveProgress('fixture-a', 4), error => error.code === 'COURSE_CANCELLED');
  assert.throws(() => runtime.commitLevel(3), error => error.code === 'COURSE_CANCELLED');
  assert.equal(h.transactions.length, 1); assert.equal(h.service.getLevel(), 1);
  h.service.stop();
});

test('normal app bridge mirrors account authority and refreshes on foreground without saving', async () => {
  const h = normal(), effects = [], actions = [];
  let foreground, removed = false;
  const React = { useEffect: factory => effects.push(factory),
    useSyncExternalStore: (subscribe, snapshot) => snapshot() };
  const slice = load('Progress/CourseSlice.js', {});
  let state = slice.courseReducer(undefined, { type: 'fixture/init' });
  const bridge = load('course/AccountCourseProgress.js', {
    react: React, 'react-redux': { useDispatch: () => action => { actions.push(action); state = slice.courseReducer(state, action); } },
    'react-native': { AppState: { addEventListener(event, callback) { assert.equal(event, 'change'); foreground = callback; return { remove() { removed = true; } }; } } },
    '../Progress/CourseSlice': slice, './normalCourseProgress': { normalCourseProgress: h.service },
  });
  const child = {}; assert.equal(bridge.CourseProgressBridge({ children: child }), child);
  const cleanup = effects[0]();
  assert.equal(state.status, 'loading'); assert.equal(state.completedLevel, 0);
  h.emit(2); assert.equal(state.status, 'ready'); assert.equal(state.completedLevel, 2);
  assert.equal(bridge.useAccountCourseProgress().completedLevel, 2);
  foreground('background'); assert.equal(h.reads.length, 0);
  foreground('active'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.reads.length, 1); assert.equal(h.transactions.length, 0);
  h.switchOwner('fixture-b'); assert.equal(state.completedLevel, 0); assert.equal(state.status, 'loading');
  h.emit(1); assert.equal(state.completedLevel, 1);
  assert.ok(actions.every(action => action.type === slice.receiveAccountProgress.type));
  cleanup(); assert.equal(removed, true); assert.equal(h.observers.at(-1).active, false);
});
