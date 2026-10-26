const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { createHighlightSyncEmulatorEnvironment } = require('../../reader/highlightSyncEnvironment');
const { createFirestoreHighlightSyncTransport } = require('../../reader/highlightSyncFirestore');
const { createNormalHighlightRuntime } = require('../../reader/normalHighlightRuntime');
const { buildCanonicalDocument, createSelection } = require('../../shared/contentText');
const { keyFor } = require('../../reader/readerHighlights');

// Exercise the actual normal-app adapter with real authenticated emulator
// transports. No mocked coordinator, catalogue, journal, or listener is used.
const PROJECT = 'demo-bard-highlights-sync';
const configuration = Object.freeze({ enabled: true, storageMode: 'durable-v2', migrationApproved: true });
let rulesEnvironment, sequence = 0;
test.before(async () => {
  assert.equal(process.env.GCLOUD_PROJECT, PROJECT, 'Run through the fixed demo emulator runner');
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8180');
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9199');
  rulesEnvironment = await initializeTestEnvironment({ projectId: PROJECT,
    firestore: { host: '127.0.0.1', port: 8180, rules: fs.readFileSync(path.join(__dirname, 'firestore.rules'), 'utf8') } });
});
test.after(async () => { if (rulesEnvironment) await rulesEnvironment.cleanup(); });

function canonicalFor(workId, version, text) {
  return buildCanonicalDocument({ play: { id: workId, contentVersion: version.repeat(64), canonicalTextVersion: '1', sections: [{ id: 'scene' }] },
    sections: [{ work: { id: workId }, contentVersion: version.repeat(64), canonicalTextVersion: '1', section: { id: 'scene' }, content: [{ id: workId + '/scene/p@0', text, separatorAfter: '' }] }] });
}
const hamlet = canonicalFor('hamlet', 'd', 'Alpha beta gamma Alpha beta');
const tempest = canonicalFor('tempest', 'e', 'Now my charms are all oerthrown.');
const documents = new Map([[hamlet.workId, hamlet], [tempest.workId, tempest]]);
function memory(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { data, storage: { getAllKeys: async () => [...data.keys()], getItem: async key => data.get(key) ?? null,
    setItem: async (key, value) => { data.set(key, value); }, removeItem: async key => { data.delete(key); } } };
}
async function client(t, email, label) {
  const name = label + '_' + Date.now() + '_' + ++sequence;
  const environment = await createHighlightSyncEmulatorEnvironment({ appName: name });
  t.after(() => environment.close());
  const signedIn = await environment.signInSynthetic({ email, password: 'synthetic-normal-app-password' });
  return { name, uid: signedIn.user.uid, environment, transport: createFirestoreHighlightSyncTransport({ environment }) };
}
function application(t, client, disk = memory()) {
  const reads = [];
  const runtime = createNormalHighlightRuntime({ storage: disk.storage, configuration, createBackend: () => client.transport,
    resolveCanonical(workId) { reads.push(workId); return documents.get(workId) || null; },
    storeOptions: { makeId: () => client.name + '_normal_' + ++sequence } });
  t.after(() => runtime.dispose());
  return { ...disk, runtime, reads, account: runtime.manager.forAccount({ uid: client.uid }) };
}
async function waitFor(predicate, description) {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out: ' + description);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
const countFor = (account, workId) => account.getSnapshot().works.find(row => row.workId === workId)?.count || 0;

test('normal app migration and two-client overview/detail/reader views share incoming create, recolor, and deletion', async t => {
  const email = 'normal-app-' + Date.now() + '@bard-sync.test';
  const a = await client(t, email, 'normalA'), b = await client(t, email, 'normalB');
  assert.equal(a.uid, b.uid); assert.notEqual(a.environment.app.name, b.environment.app.name);
  const legacy = { schemaVersion: 1, id: 'original-normal-local-id', owner: { kind: 'account', uid: a.uid }, workId: hamlet.workId,
    selectionRef: createSelection(hamlet, 0, 5), colorId: 'yellow', revision: 1, createdAt: 100, updatedAt: 100 };
  const originalKey = keyFor(a.uid, hamlet.workId, legacy.id), originalBytes = JSON.stringify(legacy);
  const one = application(t, a, memory({ [originalKey]: originalBytes }));
  await one.runtime.setOwner(a.uid); await one.runtime.flush();
  const aHamlet = one.runtime.manager.forWork({ uid: a.uid, canonical: hamlet }); await aHamlet.hydrate();
  assert.equal(aHamlet.getSnapshot().records[0].id, legacy.id);
  assert.deepEqual(aHamlet.getSnapshot().records[0].selectionRef, legacy.selectionRef);
  assert.equal(one.data.get(originalKey), originalBytes);
  assert.equal(aHamlet.getSnapshot().syncById[legacy.id].status, 'synced');
  const aTempest = await one.runtime.openWork(tempest);
  await aTempest.create(createSelection(tempest, 0, 3), 'blue'); await one.runtime.flush();
  await one.account.hydrate();
  await waitFor(() => countFor(one.account, 'hamlet') === 1 && countFor(one.account, 'tempest') === 1, 'first client overview counts');

  const two = application(t, b);
  await two.runtime.setOwner(b.uid); await two.account.hydrate();
  await waitFor(() => countFor(two.account, 'hamlet') === 1 && countFor(two.account, 'tempest') === 1, 'fresh normal account discovers both plays');
  assert.deepEqual(two.reads, [], 'overview does not construct or resolve full play documents');
  const detail = two.runtime.manager.forWork({ uid: b.uid, canonical: hamlet });
  const reader = await two.runtime.openWork(hamlet);
  assert.equal(detail, reader, 'drawer detail and reader receive the same account/work store');
  await waitFor(() => reader.getSnapshot().records.length === 1, 'fresh client receives exact stored passage');
  const bId = reader.getSnapshot().records[0].id;
  assert.deepEqual(reader.getSnapshot().records[0].selectionRef, legacy.selectionRef);
  await one.runtime.openWork(hamlet);
  await aHamlet.recolor(legacy.id, 'rose'); await one.runtime.flush();
  await waitFor(() => reader.getSnapshot().records[0]?.colorId === 'rose', 'incoming recolor appears in shared detail/reader');
  assert.equal(reader.getSnapshot().records[0].id, bId);
  await aHamlet.create(createSelection(hamlet, 17, 22), 'sage'); await one.runtime.flush();
  await waitFor(() => reader.getSnapshot().records.length === 2 && countFor(two.account, 'hamlet') === 2, 'incoming create updates both surfaces');
  await aHamlet.remove(legacy.id); await one.runtime.flush();
  await waitFor(() => reader.getSnapshot().records.length === 1 && reader.getSnapshot().tombstones.length === 1 && countFor(two.account, 'hamlet') === 1, 'incoming tombstone and overview deletion count');
  assert.equal(reader.getSnapshot().records[0].selectionRef.start, 17);
  assert.equal(one.data.get(originalKey), originalBytes, 'real normal-v1 source bytes remain recoverable');
});

test('normal app offline restart reuses durable operations and different authenticated accounts stay isolated', async t => {
  const email = 'normal-restart-' + Date.now() + '@bard-sync.test';
  const a = await client(t, email, 'restartA'), b = await client(t, email, 'restartB');
  const one = application(t, a), two = application(t, b);
  await one.runtime.setOwner(a.uid); await two.runtime.setOwner(b.uid);
  const aStore = await one.runtime.openWork(hamlet), bStore = await two.runtime.openWork(hamlet);
  const created = await aStore.create(createSelection(hamlet, 0, 5), 'yellow'); await one.runtime.flush();
  await waitFor(() => bStore.getSnapshot().records.length === 1, 'second client observes initial normal creation');
  await a.environment.setNetworkEnabled(false);
  await aStore.recolor(created.record.id, 'blue'); await one.runtime.flush();
  const operation = aStore.pendingOperations()[0];
  assert.ok(operation); assert.equal(operation.kind, 'recolor'); assert.equal(aStore.getSnapshot().records[0].colorId, 'blue');
  assert.equal(bStore.getSnapshot().records[0].colorId, 'yellow');
  one.runtime.dispose();
  const restarted = application(t, a, memory(Object.fromEntries(one.data)));
  await restarted.runtime.setOwner(a.uid); await restarted.runtime.flush();
  const reopened = restarted.runtime.manager.forWork({ uid: a.uid, canonical: hamlet }); await reopened.hydrate();
  assert.equal(reopened.pendingOperations()[0].operationId, operation.operationId);
  assert.equal(reopened.getSnapshot().records[0].id, created.record.id);
  await a.environment.setNetworkEnabled(true); await restarted.runtime.foreground(); await restarted.runtime.flush();
  await waitFor(() => reopened.pendingOperations().length === 0 && bStore.getSnapshot().records[0]?.colorId === 'blue', 'reconnected normal runtime acknowledges same operation');
  const sdk = a.environment.sdk;
  const receipt = await sdk.getDocFromServer(sdk.doc(a.environment.db, 'users', a.uid, 'highlightWorks', 'hamlet', 'operations', operation.operationId));
  assert.equal(receipt.exists(), true); assert.equal(receipt.data().operationId, operation.operationId);
  assert.equal(receipt.data().resultRevision, 2, 'restart does not duplicate the operation or advance revision twice');

  const c = await client(t, 'normal-other-' + Date.now() + '@bard-sync.test', 'otherAccount');
  assert.notEqual(c.uid, a.uid);
  const other = application(t, c); await other.runtime.setOwner(c.uid); await other.account.hydrate();
  await waitFor(() => !other.runtime.getSnapshot().discoveryLoading, 'different account discovery completes');
  await other.account.refreshReadOnly(); assert.deepEqual(other.account.getSnapshot().works, []);
  const otherWork = await other.runtime.openWork(hamlet); await otherWork.hydrate();
  assert.equal(otherWork.getSnapshot().records.length, 0);
  await assert.rejects(c.environment.sdk.getDocFromServer(c.environment.sdk.doc(c.environment.db, 'users', a.uid, 'highlightWorks', 'hamlet')), { code: 'permission-denied' });
  assert.equal(reopened.getSnapshot().records[0].colorId, 'blue');
});
