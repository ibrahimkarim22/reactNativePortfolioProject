const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, getDocs, collection, query, limit, writeBatch, serverTimestamp, setDoc, deleteDoc } = require('firebase/firestore');
const { planServerMutation, cloudKeyFor } = require('../../reader/highlightSyncProtocol');
const { buildCanonicalDocument, createSelection } = require('../../shared/contentText');
const PROJECT = 'demo-bard-highlights-sync';
let environment;
const runId = Date.now().toString(36);
test.before(async () => {
  assert.equal(process.env.GCLOUD_PROJECT, PROJECT, 'Run through the fixed demo emulator runner');
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8180');
  environment = await initializeTestEnvironment({ projectId: PROJECT, firestore: { host: '127.0.0.1', port: 8180, rules: fs.readFileSync(path.join(__dirname, 'firestore.rules'), 'utf8') } });
});
test.after(async () => { if (environment) await environment.cleanup(); });
function fixture(uid) {
  uid += '-' + runId;
  const db = environment.authenticatedContext(uid).firestore();
  const canonical = buildCanonicalDocument({ play: { id: 'hamlet', contentVersion: 'a'.repeat(64), canonicalTextVersion: '1', sections: [{ id: 'scene' }] }, sections: [{ work: { id: 'hamlet' }, contentVersion: 'a'.repeat(64), canonicalTextVersion: '1', section: { id: 'scene' }, content: [{ id: 'hamlet/scene/p@0', text: 'Alpha beta gamma Alpha', separatorAfter: '' }] }] });
  const selectionRef = createSelection(canonical, 0, 5), cloudKey = cloudKeyFor(selectionRef), base = `users/${uid}/highlightWorks/hamlet`;
  let counter = 0;
  const operation = changes => ({ schemaVersion: 1, operationId: uid + '_op_' + ++counter, uid, workId: 'hamlet', cloudKey, kind: 'create', selectionRef, colorId: 'yellow', generation: 1, baseRevision: 0, ...changes });
  const paths = op => ({ cloud: doc(db, base + '/highlights/' + op.cloudKey), metadata: doc(db, base), receipt: doc(db, base + '/operations/' + op.operationId) });
  async function plan(op) {
    const refs = paths(op), values = await Promise.all(Object.values(refs).map(ref => getDoc(ref)));
    return { refs, plan: planServerMutation({ operation: op, cloud: values[0].exists() ? values[0].data() : null, metadata: values[1].exists() ? values[1].data() : null, receipt: values[2].exists() ? values[2].data() : null, serverTimestamp: serverTimestamp() }) };
  }
  async function commit(op, change = value => value, omitted = []) {
    const planned = await plan(op), values = change({ cloud: planned.plan.cloud, metadata: planned.plan.metadata, receipt: planned.plan.receipt });
    const batch = writeBatch(db);
    for (const key of ['cloud', 'metadata', 'receipt']) if (!omitted.includes(key)) batch.set(planned.refs[key], values[key]);
    return batch.commit();
  }
  return { db, canonical, selectionRef, cloudKey, operation, paths, plan, commit, base };
}
test('owner can atomically create/recolor/delete/recreate and bounded-list while default access is denied', async () => {
  const f = fixture('rule-owner');
  const created = f.operation(); await assertSucceeds(f.commit(created));
  await assertSucceeds(getDoc(f.paths(created).cloud));
  await assertSucceeds(getDocs(query(collection(f.db, f.base + '/highlights'), limit(1001))));
  await assertFails(getDocs(collection(f.db, f.base + '/highlights')));
  await assertFails(getDocs(query(collection(f.db, f.base + '/highlights'), limit(1002))));
  await assertFails(getDocs(query(collection(f.db, f.base + '/operations'), limit(1))));
  await assertSucceeds(f.commit(f.operation({ kind: 'recolor', colorId: 'blue', baseRevision: 1 })));
  await assertSucceeds(f.commit(f.operation({ kind: 'delete', baseRevision: 1 })));
  await assertSucceeds(f.commit(f.operation({ kind: 'recreate', colorId: 'rose', baseRevision: 3, generation: 2 })));
  const cloud = (await getDoc(f.paths(created).cloud)).data();
  assert.equal(cloud.serverRevision, 4); assert.equal(cloud.generation, 2); assert.equal(cloud.colorId, 'rose');
  const metadata = (await getDoc(f.paths(created).metadata)).data(); assert.equal(metadata.activeCount, 1);
});
test('unauthenticated and cross-account clients cannot read or write owner records', async () => {
  const f = fixture('rule-private'), op = f.operation(); await f.commit(op);
  for (const context of [environment.unauthenticatedContext(), environment.authenticatedContext('rule-stranger')]) {
    const db = context.firestore(), cloud = doc(db, f.paths(op).cloud.path);
    await assertFails(getDoc(cloud));
    await assertFails(setDoc(cloud, { arbitrary: true }));
    await assertFails(deleteDoc(cloud));
    await assertFails(getDoc(doc(db, f.paths(op).receipt.path)));
    await assertFails(getDoc(doc(db, f.paths(op).metadata.path)));
  }
});
test('all three related writes are required; counters and receipts cannot be forged independently', async () => {
  const f = fixture('rule-atomic');
  for (const omitted of [['cloud'], ['metadata'], ['receipt'], ['cloud', 'receipt']]) await assertFails(f.commit(f.operation(), value => value, omitted));
  for (const change of [
    v => ({ ...v, metadata: { ...v.metadata, activeCount: 0 } }),
    v => ({ ...v, metadata: { ...v.metadata, activeBytes: 1 } }),
    v => ({ ...v, metadata: { ...v.metadata, revision: 4 } }),
    v => ({ ...v, metadata: { ...v.metadata, activeCount: 201 } }),
    v => ({ ...v, metadata: { ...v.metadata, activeBytes: 524289 } }),
    v => ({ ...v, receipt: { ...v.receipt, uid: 'other' } }),
    v => ({ ...v, receipt: { ...v.receipt, resultRevision: 99 } }),
    v => ({ ...v, receipt: { ...v.receipt, resultPayloadBytes: 1 } }),
    v => ({ ...v, receipt: { ...v.receipt, metadataRevision: 99 } }),
    v => ({ ...v, receipt: { ...v.receipt, operationId: 'forged' } }),
  ]) await assertFails(f.commit(f.operation(), change));
  await assertSucceeds(f.commit(f.operation()));
  await assertFails(f.commit(f.operation({ kind: 'recolor', colorId: 'blue', baseRevision: 1 }), value => value, ['metadata']));
});
test('malformed records, references, revisions and immutable receipt reuse are rejected by rules', async () => {
  const f = fixture('rule-malformed');
  for (const change of [
    v => ({ ...v, cloud: { ...v.cloud, extra: 'forbidden' } }),
    v => ({ ...v, cloud: { ...v.cloud, colorId: 'orange' } }),
    v => ({ ...v, cloud: { ...v.cloud, generation: 0 } }),
    v => ({ ...v, cloud: { ...v.cloud, serverRevision: 9 } }),
    v => ({ ...v, cloud: { ...v.cloud, payloadBytes: 131073 } }),
    v => ({ ...v, cloud: { ...v.cloud, updatedAt: new Date(0) } }),
    v => ({ ...v, cloud: { ...v.cloud, createdAt: new Date(0) } }),
    v => ({ ...v, cloud: { ...v.cloud, selectionRef: { ...v.cloud.selectionRef, extra: 'bad' } } }),
    v => ({ ...v, receipt: { ...v.receipt, baseRevision: 100 } }),
  ]) await assertFails(f.commit(f.operation(), change));
  const op = f.operation(); await f.commit(op);
  const existing = await f.plan(op);
  await assertFails(setDoc(existing.refs.receipt, existing.plan.receipt));
  const reused = writeBatch(f.db);
  reused.set(existing.refs.cloud, { ...existing.plan.cloud, serverRevision: 2, updatedAt: serverTimestamp() });
  reused.set(existing.refs.metadata, { ...existing.plan.metadata, revision: 2 });
  reused.set(existing.refs.receipt, { ...existing.plan.receipt, resultRevision: 2, metadataRevision: 2, createdAt: serverTimestamp() });
  await assertFails(reused.commit());
  const forged = f.operation({ kind: 'recolor', colorId: 'blue', baseRevision: 1 });
  await assertFails(f.commit(forged, v => ({ ...v, cloud: { ...v.cloud, selectionRef: { ...v.cloud.selectionRef, exact: 'Other' } }, receipt: { ...v.receipt, selectionRef: { ...v.receipt.selectionRef, exact: 'Other' } } })));
  await assertFails(f.commit(forged, v => ({ ...v, cloud: { ...v.cloud, serverRevision: 3 }, receipt: { ...v.receipt, resultRevision: 3 } })));
  await assertFails(f.commit(forged, v => ({ ...v, cloud: { ...v.cloud, generation: 2 }, receipt: { ...v.receipt, generation: 2, resultGeneration: 2 } })));
});
test('stale recolor cannot resurrect tombstones and all hard deletion is forbidden', async () => {
  const f = fixture('rule-deletion'), op = f.operation(); await f.commit(op);
  await f.commit(f.operation({ kind: 'delete', baseRevision: 1 }));
  const before = (await getDoc(f.paths(op).cloud)).data();
  const stale = f.operation({ kind: 'recolor', colorId: 'rose', baseRevision: 1 });
  const refs = f.paths(stale), metadata = (await getDoc(refs.metadata)).data();
  const batch = writeBatch(f.db);
  batch.set(refs.cloud, { ...before, deleted: false, colorId: 'rose', serverRevision: 3, lastOperationId: stale.operationId, updatedAt: serverTimestamp() });
  batch.set(refs.metadata, { ...metadata, activeCount: 1, activeBytes: before.payloadBytes, revision: metadata.revision + 1, lastOperationId: stale.operationId });
  batch.set(refs.receipt, { ...stale, resultGeneration: 1, resultRevision: 3, resultDeleted: false, resultColorId: 'rose', resultPayloadBytes: before.payloadBytes, metadataRevision: metadata.revision + 1, createdAt: serverTimestamp() });
  await assertFails(batch.commit());
  for (const ref of Object.values(f.paths(op))) await assertFails(deleteDoc(ref));
});
