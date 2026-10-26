const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createHighlightSyncEmulatorEnvironment } = require('../../reader/highlightSyncEnvironment');
const { createFirestoreHighlightSyncTransport } = require('../../reader/highlightSyncFirestore');
const { createHighlightSyncStoreManager } = require('../../reader/highlightSyncStore');
const { buildCanonicalDocument, createSelection } = require('../../shared/contentText');
const { cloudKeyFor } = require('../../reader/highlightSyncProtocol');
const canonical = buildCanonicalDocument({ play: { id: 'hamlet', contentVersion: 'b'.repeat(64), canonicalTextVersion: '1', sections: [{ id: 'scene' }] }, sections: [{ work: { id: 'hamlet' }, contentVersion: 'b'.repeat(64), canonicalTextVersion: '1', section: { id: 'scene' }, content: [{ id: 'hamlet/scene/p@0', text: 'Alpha beta gamma Alpha', separatorAfter: '' }] }] });
const reference = (start = 0, end = 5) => createSelection(canonical, start, end);
let sequence = 0;
function memory(initial = {}) { const data = new Map(Object.entries(initial)); return { data, storage: { getAllKeys: async () => [...data.keys()], getItem: async key => data.get(key) ?? null, setItem: async (key, value) => { data.set(key, value); }, removeItem: async key => { data.delete(key); } } }; }
function local(client, fixture = memory()) {
  const namespace = '@bard-test/' + client.name;
  const manager = createHighlightSyncStoreManager(fixture.storage, { namespace, makeId: () => client.name + '_' + ++sequence, now: () => 1000 + sequence });
  return { ...fixture, namespace, manager, store: manager.forWork({ uid: client.uid, canonical }) };
}
async function client(t, email, label, options = {}) {
  const name = label + '_' + Date.now() + '_' + ++sequence;
  const environment = await createHighlightSyncEmulatorEnvironment({ appName: name, ...options });
  t.after(() => environment.close());
  const user = await environment.signInSynthetic({ email, password: 'synthetic-fixture-password' });
  return { name, environment, uid: user.user.uid, transport: createFirestoreHighlightSyncTransport({ environment }) };
}
async function remote(client) {
  const { sdk, db } = client.environment;
  const result = await sdk.getDocsFromServer(sdk.query(sdk.collection(db, 'users', client.uid, 'highlightWorks', canonical.workId, 'highlights'), sdk.limit(1001)));
  return result.docs.map(document => ({ cloudKey: document.id, cloud: document.data() }));
}
async function sync(client, store) {
  for (const operation of store.pendingOperations()) {
    const result = await client.transport.commit(operation); await store.acknowledge(operation.operationId, result);
  }
}
test('two independent authenticated clients and stores synchronize migration, create, recolor, delete and repeated quotations', async t => {
  const email = 'two-devices-' + Date.now() + '@bard-sync.test';
  const a = await client(t, email, 'deviceA'), b = await client(t, email, 'deviceB');
  assert.equal(a.uid, b.uid); assert.notEqual(a.environment.app.name, b.environment.app.name);
  const legacy = { schemaVersion: 1, id: 'legacy-original-id', owner: { kind: 'account', uid: a.uid }, workId: canonical.workId, selectionRef: reference(), colorId: 'yellow', revision: 1, createdAt: 100, updatedAt: 100 };
  const aMemory = memory(), one = local(a, aMemory), legacyKey = one.namespace + '/legacy/' + encodeURIComponent(a.uid) + '/hamlet/legacy-original-id';
  aMemory.data.set(legacyKey, JSON.stringify(legacy)); const legacyBytes = aMemory.data.get(legacyKey);
  await one.store.hydrate(); await sync(a, one.store);
  assert.equal(aMemory.data.get(legacyKey), legacyBytes);
  const two = local(b); await two.store.hydrate(); await two.store.mergeRemote(await remote(b));
  assert.equal(two.store.getSnapshot().records.length, 1);
  const bId = two.store.getSnapshot().records[0].id;
  await two.store.recolor(bId, 'blue'); await sync(b, two.store); await one.store.mergeRemote(await remote(a));
  assert.equal(one.store.getSnapshot().records[0].id, 'legacy-original-id');
  assert.equal(one.store.getSnapshot().records[0].colorId, 'blue');
  await one.store.create(reference(17, 22), 'rose'); await sync(a, one.store); await two.store.mergeRemote(await remote(b));
  assert.equal(two.store.getSnapshot().records.length, 2, 'same quotation at a different range stays distinct');
  assert.notEqual(cloudKeyFor(reference()), cloudKeyFor(reference(17, 22)));
  await two.store.remove(bId); await sync(b, two.store); await one.store.mergeRemote(await remote(a));
  assert.equal(one.store.getSnapshot().records.length, 1);
  assert.equal((await remote(a)).filter(row => row.cloud.deleted).length, 1);
});
test('controlled test-network pause preserves the local journal across a fresh manager and lost acknowledgements replay the same receipt', async t => {
  const a = await client(t, 'offline-' + Date.now() + '@bard-sync.test', 'offline');
  const fixture = memory(), first = local(a, fixture);
  await first.store.create(reference(), 'sage'); const original = first.store.pendingOperations()[0];
  await a.environment.setNetworkEnabled(false);
  await assert.rejects(a.transport.commit(original), { code: 'SYNC_EMULATOR_NETWORK_DISABLED' });
  assert.equal(first.store.getSnapshot().records[0].colorId, 'sage');
  const restarted = local(a, fixture); await restarted.store.hydrate();
  assert.equal(restarted.store.pendingOperations()[0].operationId, original.operationId);
  await a.environment.setNetworkEnabled(true);
  const committedWithoutLocalAck = await a.transport.commit(original);
  await restarted.store.recolor(restarted.store.getSnapshot().records[0].id, 'rose');
  await restarted.store.acknowledge(original.operationId, committedWithoutLocalAck);
  assert.equal(restarted.store.getSnapshot().syncSummary.synced, 0, 'older acknowledgement cannot sync a newer edit');
  const replay = await a.transport.commit(original);
  assert.equal(replay.receipt.resultRevision, 1);
  assert.equal((await remote(a))[0].cloud.serverRevision, 1);
  await sync(a, restarted.store);
  assert.equal((await remote(a))[0].cloud.colorId, 'rose');
  assert.equal(restarted.store.getSnapshot().syncSummary.synced, 1);
});
test('two devices expose recolor conflicts, converge exact duplicates, retain overlaps and obey tombstone generations', async t => {
  const email = 'conflicts-' + Date.now() + '@bard-sync.test';
  const a = await client(t, email, 'conflictA'), b = await client(t, email, 'conflictB');
  const one = local(a), two = local(b);
  await one.store.create(reference(), 'yellow'); await two.store.create(reference(), 'yellow');
  await sync(a, one.store); await sync(b, two.store);
  assert.equal((await remote(a)).length, 1, 'exact duplicates converge at one cloud key');
  await one.store.mergeRemote(await remote(a)); await two.store.mergeRemote(await remote(b));
  await one.store.recolor(one.store.getSnapshot().records[0].id, 'blue');
  await two.store.recolor(two.store.getSnapshot().records[0].id, 'rose');
  await sync(a, one.store);
  await assert.rejects(sync(b, two.store), { code: 'SYNC_CONFLICT' });
  await two.store.mergeRemote(await remote(b));
  assert.equal(two.store.getSnapshot().syncSummary.conflict, 1);
  await two.store.resolveConflict(two.store.getSnapshot().records[0].id, 'use-cloud');
  await one.store.remove(one.store.getSnapshot().records[0].id); await sync(a, one.store);
  await two.store.recolor(two.store.getSnapshot().records[0].id, 'sage');
  await assert.rejects(sync(b, two.store), { code: 'SYNC_DELETED' });
  await two.store.mergeRemote(await remote(b));
  const oldId = two.store.getSnapshot().records[0]?.id || two.store.getSnapshot().tombstones[0]?.id;
  if (two.store.getSnapshot().syncSummary.conflict) await two.store.resolveConflict(oldId, 'use-cloud');
  await two.store.recreate(oldId, 'rose'); await sync(b, two.store);
  const recreated = (await remote(a))[0].cloud; assert.equal(recreated.generation, 2); assert.equal(recreated.deleted, false);
  // New independent stores select overlapping ranges before either sees the other.
  const c = local(a), d = local(b);
  await c.store.create(reference(6, 10), 'sage'); await d.store.create(reference(8, 12), 'blue');
  await sync(a, c.store); await sync(b, d.store);
  await c.store.mergeRemote(await remote(a));
  assert.equal(c.store.getSnapshot().conflicts.length, 2, 'both overlapping records remain; no paint winner');
});
test('actual different Auth accounts cannot read or submit another owner and stale A-to-B-to-A work is rejected', async t => {
  const aEmail = 'owner-a-' + Date.now() + '@bard-sync.test';
  const a = await client(t, aEmail, 'ownerA'), b = await client(t, 'owner-b-' + Date.now() + '@bard-sync.test', 'ownerB');
  const one = local(a); await one.store.create(reference(), 'yellow'); const operation = one.store.pendingOperations()[0];
  await sync(a, one.store);
  assert.notEqual(a.uid, b.uid);
  const { sdk, db } = b.environment;
  await assert.rejects(sdk.getDocFromServer(sdk.doc(db, 'users', a.uid, 'highlightWorks', 'hamlet', 'highlights', operation.cloudKey)), { code: 'permission-denied' });
  await assert.rejects(b.transport.commit(operation), { code: 'SYNC_CANCELLED' });
  let epoch = 1; const oldGuard = () => epoch === 1;
  await a.environment.authSdk.signOut(a.environment.auth); epoch++;
  await a.environment.signInSynthetic({ email: 'owner-c-' + Date.now() + '@bard-sync.test', password: 'synthetic-fixture-password' }); epoch++;
  await a.environment.signInSynthetic({ email: aEmail, password: 'synthetic-fixture-password' });
  assert.equal(a.environment.auth.currentUser.uid, a.uid);
  await assert.rejects(a.transport.commit(operation, { isCurrent: oldGuard }), { code: 'SYNC_CANCELLED' });
  assert.equal(one.store.getSnapshot().records[0].colorId, 'yellow');
});
test('all 38 bundled works accept original canonical references through the rule-enforced transport', async t => {
  const a = await client(t, 'corpus-' + Date.now() + '@bard-sync.test', 'corpus');
  const root = path.resolve(__dirname, '../..'), manifest = JSON.parse(fs.readFileSync(path.join(root, 'data/manifest.json'), 'utf8'));
  assert.equal(manifest.plays.length, 38);
  for (const entry of manifest.plays) {
    const playPath = path.join(root, 'data', entry.play), play = JSON.parse(fs.readFileSync(playPath, 'utf8'));
    const sections = play.sections.map(section => JSON.parse(fs.readFileSync(path.resolve(path.dirname(playPath), section.path), 'utf8')));
    const document = buildCanonicalDocument({ play, sections });
    const selectionRef = createSelection(document, 0, Math.min(200, document.text.length));
    const op = { schemaVersion: 1, operationId: 'corpus_' + entry.id, uid: a.uid, workId: entry.id, cloudKey: cloudKeyFor(selectionRef, document), kind: 'create', selectionRef, colorId: 'yellow', generation: 1, baseRevision: 0 };
    const result = await a.transport.commit(op);
    assert.deepEqual(result.cloud.selectionRef, selectionRef, entry.id);
    assert.equal(result.metadata.activeCount, 1, entry.id);
  }
});
test('real conflicting transactions rerun callbacks without changing operation identities or duplicating accounting', async t => {
  let release, reads = 0, callbacks = 0;
  const barrier = new Promise(resolve => { release = resolve; });
  const real = require('firebase/firestore');
  function instrument() {
    let attempt = 0;
    return { app: require('firebase/app'), auth: require('firebase/auth'), firestore: { ...real,
      runTransaction(db, callback, options) {
        return real.runTransaction(db, async transaction => {
          const firstAttempt = ++attempt === 1; callbacks++;
          return callback({
            async get(ref) {
              const value = await transaction.get(ref);
              if (firstAttempt && ref.path.endsWith('/highlightWorks/hamlet')) {
                if (++reads === 2) release();
                await barrier;
              }
              return value;
            },
            set: (...args) => transaction.set(...args),
          });
        }, options);
      },
    } };
  }
  const email = 'transactions-' + Date.now() + '@bard-sync.test';
  const a = await client(t, email, 'transactionA', { firebaseSdk: instrument() });
  const b = await client(t, email, 'transactionB', { firebaseSdk: instrument() });
  const one = local(a), two = local(b);
  await one.store.create(reference(), 'yellow'); await two.store.create(reference(), 'yellow');
  const first = one.store.pendingOperations()[0], second = two.store.pendingOperations()[0];
  const [resultA, resultB] = await Promise.all([a.transport.commit(first), b.transport.commit(second)]);
  assert.ok(callbacks >= 3, 'the emulator actually retried at least one transaction callback');
  assert.equal(resultA.receipt.operationId, first.operationId); assert.equal(resultB.receipt.operationId, second.operationId);
  await one.store.acknowledge(first.operationId, resultA); await two.store.acknowledge(second.operationId, resultB);
  const rows = await remote(a); assert.equal(rows.length, 1); assert.equal(rows[0].cloud.serverRevision, 2);
  const { sdk, db } = a.environment;
  const metadata = (await sdk.getDocFromServer(sdk.doc(db, 'users', a.uid, 'highlightWorks', 'hamlet'))).data();
  assert.equal(metadata.activeCount, 1); assert.equal(metadata.revision, 2);
  assert.equal(metadata.activeBytes, rows[0].cloud.payloadBytes);
});
test('live rule-enforced listeners deliver another device edits into its independent local store', async t => {
  const email = 'listeners-' + Date.now() + '@bard-sync.test';
  const a = await client(t, email, 'listenerA'), b = await client(t, email, 'listenerB');
  const one = local(a), two = local(b); await one.store.hydrate(); await two.store.hydrate();
  const listeners = [], errors = [], waits = [];
  function observe(client, store) {
    return client.transport.listen(client.uid, 'hamlet', async records => {
      try { await store.mergeRemote(records); for (const signal of waits) signal(); }
      catch (error) { errors.push(error); for (const signal of waits) signal(); }
    }, error => { errors.push(error); for (const signal of waits) signal(); });
  }
  async function waitFor(predicate) {
    if (predicate()) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Listener fixture timed out')), 5000);
      const inspect = () => { if (errors.length) { clearTimeout(timer); reject(errors[0]); } else if (predicate()) { clearTimeout(timer); resolve(); } };
      waits.push(inspect); inspect();
    });
  }
  listeners.push(observe(a, one.store), observe(b, two.store));
  try {
    await one.store.create(reference(), 'yellow'); await sync(a, one.store);
    await waitFor(() => two.store.getSnapshot().records.length === 1);
    await two.store.recolor(two.store.getSnapshot().records[0].id, 'blue'); await sync(b, two.store);
    await waitFor(() => one.store.getSnapshot().records[0]?.colorId === 'blue');
    assert.deepEqual(errors, []);
    assert.equal(one.store.getSnapshot().records.length, 1); assert.equal(two.store.getSnapshot().records.length, 1);
  } finally { for (const unsubscribe of listeners) unsubscribe(); }
});

test('a fresh same-account client discovers multiple plays without canonical reads and observes tombstones and new works', async t => {
  const email = 'discovery-' + Date.now() + '@bard-sync.test';
  const a = await client(t, email, 'discoveryA'), b = await client(t, email, 'discoveryB');
  const one = local(a), two = local(b);
  const tempest = buildCanonicalDocument({ play: { id: 'tempest', contentVersion: 'c'.repeat(64), canonicalTextVersion: '1', sections: [{ id: 's' }] }, sections: [{ work: { id: 'tempest' }, contentVersion: 'c'.repeat(64), canonicalTextVersion: '1', section: { id: 's' }, content: [{ id: 'tempest/s/p@0', text: 'Now my charms are all oerthrown.', separatorAfter: '' }] }] });
  await one.store.create(reference(), 'yellow'); await sync(a, one.store);
  let canonicalReads = 0;
  const coordinator = require('../../reader/highlightSyncCoordinator').createHighlightSyncCoordinator({ manager: two.manager, transport: b.transport,
    resolveCanonical() { canonicalReads++; throw new Error('Account discovery cannot build full plays.'); } });
  t.after(() => coordinator.dispose());
  const waitFor = async predicate => {
    if (predicate()) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { stop(); reject(new Error('Fresh-client discovery timed out')); }, 10000);
      const inspect = () => {
        const error = coordinator.getSnapshot().error || coordinator.getSnapshot().discoveryError;
        if (error) { clearTimeout(timer); stop(); reject(new Error(error.code)); }
        else if (predicate()) { clearTimeout(timer); stop(); resolve(); }
      };
      const stop = coordinator.subscribe(inspect); inspect();
    });
  };
  await coordinator.setOwner(b.uid);
  await waitFor(() => coordinator.getSnapshot().works.length === 1);
  const second = one.manager.forWork({ uid: a.uid, canonical: tempest });
  await second.create(createSelection(tempest, 0, 3), 'blue'); await sync(a, second);
  await waitFor(() => coordinator.getSnapshot().works.length === 2);
  assert.equal(canonicalReads, 0);
  assert.deepEqual(coordinator.getSnapshot().works.map(row => [row.workId, row.metadata.activeCount]), [['hamlet', 1], ['tempest', 1]]);
  const opened = await coordinator.openWork(tempest);
  await waitFor(() => opened.getSnapshot().records.length === 1);
  assert.equal(opened.getSnapshot().records[0].selectionRef.exact, 'Now');
  await second.remove(second.getSnapshot().records[0].id); await sync(a, second);
  await waitFor(() => coordinator.getSnapshot().works.find(row => row.workId === 'tempest')?.metadata.activeCount === 0 && opened.getSnapshot().records.length === 0);
  assert.equal(opened.getSnapshot().tombstones.length, 1);
  const restarted = local(b, memory(Object.fromEntries(two.data)));
  assert.deepEqual(await restarted.manager.readWorkCatalogue(b.uid), coordinator.getSnapshot().works);
  assert.equal(canonicalReads, 0);
});
