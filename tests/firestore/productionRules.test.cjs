const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, getDocs, collection, query, limit, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp } = require('firebase/firestore');
const { planServerMutation, cloudKeyFor } = require('../../reader/highlightSyncProtocol');
const { canonical, ref } = require('../reader/highlightSyncFixture.cjs');
let environment;
const run = Date.now().toString(36);
test.before(async () => {
  assert.equal(process.env.GCLOUD_PROJECT, 'demo-bard-highlights-sync');
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8180');
  environment = await initializeTestEnvironment({ projectId: 'demo-bard-highlights-sync', firestore: { host: '127.0.0.1', port: 8180,
    rules: fs.readFileSync(path.join(__dirname, '../../docs/reader/production/firestore.rules'), 'utf8') } });
});
test.after(async () => { await environment?.cleanup(); });
test('candidate preserves deployed profile/course and quiz owner access with cross-owner denial', async () => {
  const uid = 'production-profile-' + run, db = environment.authenticatedContext(uid).firestore();
  const profile = doc(db, 'users', uid), quiz = doc(db, 'users', uid, 'quizzes', 'fixture');
  await assertSucceeds(setDoc(profile, { fixture: true, courseProgress: { fixtureCourse: 0 } }));
  await assertSucceeds(updateDoc(profile, { courseProgress: { fixtureCourse: 1 } }));
  assert.equal((await getDoc(profile)).data().courseProgress.fixtureCourse, 1);
  await assertSucceeds(setDoc(quiz, { fixture: true }));
  await assertSucceeds(getDoc(quiz));
  for (const context of [environment.unauthenticatedContext(), environment.authenticatedContext('different-' + run)]) {
    const other = context.firestore();
    await assertFails(getDoc(doc(other, profile.path)));
    await assertFails(setDoc(doc(other, quiz.path), { fixture: false }));
  }
  await assertFails(getDocs(query(collection(db, 'users'), limit(1))));
  await assertFails(setDoc(doc(db, 'users', uid, 'unexpected', 'fixture'), { forbidden: true }));
});
test('candidate adds atomic highlight lifecycle and bounded discovery without profile-grant bypass', async () => {
  const uid = 'production-highlights-' + run, db = environment.authenticatedContext(uid).firestore();
  const cloudKey = cloudKeyFor(ref()), work = doc(db, 'users', uid, 'highlightWorks', canonical.workId);
  const cloudRef = doc(db, work.path, 'highlights', cloudKey);
  let seq = 0;
  async function commit(kind, colorId, baseRevision, generation = 1) {
    const operation = { schemaVersion: 1, operationId: uid + '-' + ++seq, uid, workId: canonical.workId, cloudKey,
      kind, colorId, baseRevision, generation, selectionRef: ref() };
    const receiptRef = doc(db, work.path, 'operations', operation.operationId);
    const oldCloud = await getDoc(cloudRef), oldMetadata = await getDoc(work);
    const plan = planServerMutation({ operation, cloud: oldCloud.exists() ? oldCloud.data() : null,
      metadata: oldMetadata.exists() ? oldMetadata.data() : null, receipt: null, serverTimestamp: serverTimestamp() });
    const batch = writeBatch(db);
    batch.set(cloudRef, plan.cloud); batch.set(work, plan.metadata); batch.set(receiptRef, plan.receipt);
    return batch.commit();
  }
  await assertSucceeds(commit('create', 'yellow', 0));
  await assertSucceeds(commit('recolor', 'blue', 1));
  await assertSucceeds(commit('delete', 'blue', 2));
  assert.equal((await getDoc(cloudRef)).data().deleted, true);
  await assertSucceeds(commit('recreate', 'sage', 3, 2));
  assert.equal((await getDoc(work)).data().activeCount, 1);
  const works = collection(db, 'users', uid, 'highlightWorks');
  assert.equal((await assertSucceeds(getDocs(query(works, limit(129))))).size, 1);
  await assertFails(getDocs(works));
  await assertFails(setDoc(cloudRef, { arbitrary: true }));
  await assertFails(deleteDoc(cloudRef));
  await assertFails(getDocs(query(collection(db, work.path, 'operations'), limit(1))));
  const stranger = environment.authenticatedContext('stranger-' + run).firestore();
  await assertFails(getDocs(query(collection(stranger, 'users', uid, 'highlightWorks'), limit(129))));
  await assertFails(getDoc(doc(stranger, cloudRef.path)));
});
