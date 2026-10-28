const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const sdk = require('firebase/firestore');
const { createFirestoreCourseProgressTransport } = require('../../course/firestoreCourseProgress');

let environment;
let sequence = 0;
const run = Date.now().toString(36);
const fixtureUid = () => 'course-fixture-' + run + '-' + ++sequence;
const transport = (db, overrides = {}) => createFirestoreCourseProgressTransport({
  db, doc: sdk.doc, onSnapshot: sdk.onSnapshot, runTransaction: sdk.runTransaction,
  getDocFromServer: sdk.getDocFromServer, ...overrides,
});
const profile = (db, uid) => sdk.doc(db, 'users', uid);
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
async function waitFor(predicate, label) {
  const until = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() >= until) throw new Error('Timed out waiting for ' + label);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test.before(async () => {
  assert.equal(process.env.GCLOUD_PROJECT, 'demo-bard-highlights-sync');
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8180');
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9199');
  environment = await initializeTestEnvironment({
    projectId: 'demo-bard-highlights-sync',
    firestore: { host: '127.0.0.1', port: 8180,
      rules: fs.readFileSync(path.join(__dirname, '../../docs/reader/production/firestore.rules'), 'utf8') },
  });
});
test.after(async () => { await environment?.cleanup(); });

test('independent same-account clients restore and observe confirmed progress without changing other profile fields', async t => {
  const uid = fixtureUid();
  const a = environment.authenticatedContext(uid).firestore();
  const b = environment.authenticatedContext(uid).firestore();
  assert.notEqual(a, b);
  const original = { completedLevel: 1, displayName: 'Synthetic course fixture', unrelated: { preserved: true } };
  await sdk.setDoc(profile(a, uid), original);
  const one = transport(a), two = transport(b), observed = [], errors = [];
  const restored = await two.read(uid);
  assert.deepEqual(restored, { exists: true, completedLevel: 1, fromCache: false, hasPendingWrites: false });
  t.after(two.observe(uid, value => observed.push(value), error => errors.push(error)));
  await waitFor(() => observed.some(value => value.completedLevel === 1 && !value.fromCache && !value.hasPendingWrites), 'initial server progress');
  assert.deepEqual(await one.save(uid, 5), { completedLevel: 5, advanced: true });
  await waitFor(() => observed.some(value => value.completedLevel === 5 && !value.fromCache && !value.hasPendingWrites), 'second-client server update');
  assert.equal((await two.read(uid)).completedLevel, 5);
  assert.deepEqual((await sdk.getDocFromServer(profile(a, uid))).data(), { ...original, completedLevel: 5 });
  assert.deepEqual(errors, []);
  for (const value of observed) assert.deepEqual(Object.keys(value).sort(), ['completedLevel', 'exists', 'fromCache', 'hasPendingWrites']);
});

test('concurrent duplicate completions advance the shared profile once', async () => {
  const uid = fixtureUid();
  const a = environment.authenticatedContext(uid).firestore();
  const b = environment.authenticatedContext(uid).firestore();
  await sdk.setDoc(profile(a, uid), { completedLevel: 0, untouched: 'keep' });
  const results = await Promise.all([transport(a).save(uid, 1), transport(b).save(uid, 1)]);
  assert.equal(results.filter(result => result.advanced).length, 1);
  assert.ok(results.every(result => result.completedLevel === 1));
  assert.deepEqual((await sdk.getDocFromServer(profile(a, uid))).data(), { completedLevel: 1, untouched: 'keep' });
});

test('an older lower completion delayed across a newer commit cannot overwrite it', async () => {
  const uid = fixtureUid();
  const a = environment.authenticatedContext(uid).firestore();
  const b = environment.authenticatedContext(uid).firestore();
  await sdk.setDoc(profile(a, uid), { completedLevel: 0 });
  const release = deferred();
  let reads = 0;
  const older = transport(a, { runTransaction: (db, callback) => sdk.runTransaction(db, transaction => callback({
    get: async ref => {
      const value = await transaction.get(ref);
      if (++reads === 1) await release.promise;
      return value;
    },
    update: (ref, value) => transaction.update(ref, value),
  })) });
  const pending = older.save(uid, 2);
  try {
    await waitFor(() => reads === 1, 'older transaction read');
    assert.deepEqual(await transport(b).save(uid, 7), { completedLevel: 7, advanced: true });
  } finally { release.resolve(); }
  assert.deepEqual(await pending, { completedLevel: 7, advanced: false });
  assert.ok(reads >= 2, 'the real SDK retries the stale read basis');
  assert.equal((await transport(b).read(uid)).completedLevel, 7);
});

test('owner-only rules reject another account and unauthenticated profile access', async t => {
  const uid = fixtureUid(), owner = environment.authenticatedContext(uid).firestore();
  await sdk.setDoc(profile(owner, uid), { completedLevel: 3 });
  for (const context of [environment.authenticatedContext(fixtureUid()), environment.unauthenticatedContext()]) {
    const other = transport(context.firestore()), errors = [];
    await assert.rejects(other.read(uid), { code: 'permission-denied' });
    await assert.rejects(other.save(uid, 4), { code: 'permission-denied' });
    t.after(other.observe(uid, () => assert.fail('a denied listener must not expose progress'), error => errors.push(error)));
    await waitFor(() => errors.length === 1, 'denied profile listener');
    assert.equal(errors[0].code, 'permission-denied');
    assert.equal(errors[0].cause, undefined);
  }
  assert.equal((await transport(owner).read(uid)).completedLevel, 3);
});

test('an account transition during a real transaction read cancels before its write', async () => {
  const uid = fixtureUid(), db = environment.authenticatedContext(uid).firestore();
  await sdk.setDoc(profile(db, uid), { completedLevel: 0 });
  let current = true;
  const adapter = transport(db, { runTransaction: (firestore, callback) => sdk.runTransaction(firestore, transaction => callback({
    get: async ref => { const value = await transaction.get(ref); current = false; return value; },
    update: (ref, value) => transaction.update(ref, value),
  })) });
  await assert.rejects(adapter.save(uid, 1, () => current), { code: 'COURSE_CANCELLED' });
  assert.equal((await transport(db).read(uid)).completedLevel, 0);
});

test('server restoration refuses offline cache and succeeds again after network recovery', async () => {
  const uid = fixtureUid(), db = environment.authenticatedContext(uid).firestore();
  const adapter = transport(db);
  await sdk.setDoc(profile(db, uid), { completedLevel: 2 });
  assert.equal((await adapter.read(uid)).completedLevel, 2);
  await sdk.disableNetwork(db);
  try {
    await assert.rejects(adapter.read(uid), { code: 'unavailable' });
  } finally { await sdk.enableNetwork(db); }
  assert.equal((await adapter.read(uid)).completedLevel, 2);
  assert.deepEqual(await adapter.save(uid, 4), { completedLevel: 4, advanced: true });
  assert.equal((await adapter.read(uid)).completedLevel, 4);
});
