const assert = require('node:assert/strict');
const test = require('node:test');
const { canonical, ref, legacyRecord, setup, deferred, accepted } = require('./highlightSyncFixture.cjs');
const writes = fixture => fixture.calls.filter(call => call[0] === 'set');
const tick = () => new Promise(resolve => setImmediate(resolve));

for (const outcome of ['before', 'after']) {
  test('returning owner explicitly retires a failed old-epoch recolor ' + outcome + ' persistence without replay', async () => {
    const h = setup(), created = await h.store.create(ref(), 'yellow');
    const operation = h.store.pendingOperations()[0]; await h.store.acknowledge(operation.operationId, accepted(operation));
    let epoch = 1; const oldOptions = { isCurrent: () => epoch === 1 }, set = h.storage.setItem;
    h.storage.setItem = async (key, raw) => { if (outcome === 'after') await set(key, raw); throw new Error('disk'); };
    await assert.rejects(h.store.recolor(created.record.id, 'blue', oldOptions), { code: 'WRITE_FAILED' });
    epoch = 3; h.storage.setItem = set; const currentOptions = { isCurrent: () => epoch === 3 }, before = writes(h).length;
    await h.store.refreshReadOnly(currentOptions); assert.equal(h.store.getSnapshot().writeBlocked, true); assert.equal(h.store.getSnapshot().error.code, 'WRITE_FAILED');
    await assert.rejects(h.store.retry(currentOptions), { code: 'CANCELLED' });
    assert.equal(writes(h).length, before, 'retired interaction is never rewritten');
    assert.equal(h.store.getSnapshot().writeBlocked, false); assert.equal(h.store.getSnapshot().error, null);
    assert.equal(h.store.getSnapshot().records[0].colorId, outcome === 'after' ? 'blue' : 'yellow');
    await h.store.retry(currentOptions); assert.equal(h.store.getSnapshot().writeBlocked, false);
  });
}

test('returning owner raw retry retires stale in-memory removal only after exact read, without writing a marker', async () => {
  const key = '@bard-test/client-a/legacy/alice/unknown/broken', h = setup({ [key]: 'bad' }), scope = { uid: 'alice', workKey: 'unknown' };
  let epoch = 1; const set = h.storage.setItem;
  h.storage.setItem = async () => { throw new Error('disk'); };
  await assert.rejects(h.manager.retireRawEntry({ ...scope, key, raw: 'bad' }, { isCurrent: () => epoch === 1 }), { code: 'WRITE_FAILED' });
  epoch = 3; h.storage.setItem = set; const options = { isCurrent: () => epoch === 3 }, before = writes(h).length;
  assert.equal((await h.manager.readRawWork(scope, options)).writeBlocked, true);
  await assert.rejects(h.manager.retryRawWork(scope, options), { code: 'CANCELLED' });
  const snapshot = await h.manager.readRawWork(scope, options);
  assert.equal(snapshot.writeBlocked, false); assert.equal(snapshot.error, null); assert.equal(snapshot.entries.length, 1);
  assert.equal(writes(h).length, before); assert.equal(h.data.get(key), 'bad');
  await h.manager.retryRawWork(scope, options);
});

test('known canonical detail retains legacy and v2 base-key corruption and explicit retirement preserves bytes', async () => {
  const legacyBase = '@bard/reader-highlights:v1/alice/hamlet', v2Base = '@bard/reader-highlights-sync:account-v2/v2/alice/hamlet';
  const h = setup({ [legacyBase]: '{', [v2Base]: '{' });
  const manager = require('../../reader/highlightSyncStore').createHighlightSyncStoreManagerForNamespace(h.storage, {
    namespace: '@bard/reader-highlights-sync:account-v2', legacyPrefixFor: require('../../reader/readerHighlights').prefixFor, migrateLegacy: false,
  });
  assert.equal((await manager.readLocalWorkCatalogue('alice'))[0].count, 2);
  const store = manager.forWork({ uid: 'alice', canonical }); await store.hydrate();
  assert.equal(store.getSnapshot().unreadable.length, 2);
  for (const entry of store.getSnapshot().unreadable) await store.remove(entry.id);
  await store.refreshReadOnly(); assert.equal(store.getSnapshot().unreadable.length, 0);
  assert.equal(h.data.get(legacyBase), '{'); assert.equal(h.data.get(v2Base), '{');
});

test('a pending deletion conflicted by remote recreation exposes its original validated quotation without painting it', async () => {
  const h = setup(), created = await h.store.create(ref(), 'yellow');
  const operation = h.store.pendingOperations()[0]; await h.store.acknowledge(operation.operationId, accepted(operation));
  await h.store.remove(created.record.id);
  const recreated = accepted({ ...operation, operationId: 'remote-recreation' }, { generation: 2, serverRevision: 3, colorId: 'blue', deleted: false }).cloud;
  await h.store.mergeRemote([{ cloudKey: operation.cloudKey, cloud: recreated }]);
  const snapshot = h.store.getSnapshot();
  assert.equal(snapshot.records.length, 0);
  assert.equal(snapshot.tombstones.length, 1);
  const tombstone = snapshot.tombstones[0];
  assert.equal(tombstone.sync.status, 'conflict');
  assert.equal(tombstone.record.id, created.record.id);
  assert.deepEqual(tombstone.record, created.record);
  assert.deepEqual(tombstone.record.selectionRef, operation.selectionRef);
  assert.equal(Object.isFrozen(tombstone.record), true);
  assert.equal(tombstone.sync.conflict.cloud.generation, 2);
});

test('work discovery cache is durable owner-scoped metadata without opening canonicals and rejects invalid or cancelled replacement', async () => {
  const h = setup(), rows = [{ workId: 'tempest', metadata: { schemaVersion: 1, activeCount: 2, activeBytes: 100, revision: 3, lastOperationId: 'op3' } }];
  await h.manager.writeWorkCatalogue('alice', rows);
  assert.deepEqual(await setup(Object.fromEntries(h.data)).manager.readWorkCatalogue('alice'), rows);
  assert.deepEqual(await h.manager.readWorkCatalogue('bob'), []);
  await assert.rejects(h.manager.writeWorkCatalogue('alice', [], { isCurrent: () => false }), { code: 'CANCELLED' });
  await assert.rejects(h.manager.writeWorkCatalogue('alice', [{ ...rows[0], metadata: { ...rows[0].metadata, activeCount: -1 } }]), { code: 'SYNC_INVALID_STATE' });
  assert.deepEqual(await h.manager.readWorkCatalogue('alice'), rows);
  assert.deepEqual(await h.manager.discoverWorks('alice'), [], 'metadata does not construct or migrate every discovered play');
});

test('trusted namespace migration retains actual legacy bytes and read-only refresh cannot migrate or replay a failed write', async () => {
  const h = setup(), core = require('../../reader/highlightSyncStore');
  const originalKey = '@bard/reader-highlights:v1/alice/hamlet/legacy-id', original = JSON.stringify(legacyRecord()); h.data.set(originalKey, original);
  const manager = core.createHighlightSyncStoreManagerForNamespace(h.storage, { namespace: '@bard/reader-highlights-sync:v2', legacyPrefixFor: (uid, workId) => '@bard/reader-highlights:v1/' + uid + '/' + workId + '/' });
  const store = manager.forWork({ uid: 'alice', canonical });
  await store.refreshReadOnly(); assert.equal(writes(h).length, 0); assert.equal(h.data.get(originalKey), original);
  await store.hydrate(); assert.equal(store.getSnapshot().records[0].id, 'legacy-id'); assert.equal(h.data.get(originalKey), original);
  const originalSet = h.storage.setItem; h.storage.setItem = async () => { throw new Error('disk'); };
  await assert.rejects(store.recolor('legacy-id', 'blue'), { code: 'WRITE_FAILED' });
  const previousWrites = writes(h).length; h.storage.setItem = originalSet;
  await store.refreshReadOnly(); assert.equal(writes(h).length, previousWrites); assert.equal(store.getSnapshot().writeBlocked, true);
  assert.equal(store.getSnapshot().records[0].colorId, 'yellow');
  await store.retry(); assert.equal(store.getSnapshot().records[0].colorId, 'blue');
});

test('local catalogue merges retained originals with envelopes without duplicate aliases or tombstones and only discovers pending work', async () => {
  const h = setup({ '@bard-test/client-a/legacy/alice/hamlet/legacy-id': JSON.stringify(legacyRecord()) }), notifications = [];
  const unsubscribe = h.manager.subscribeCatalogue('alice', () => notifications.push('changed'));
  await h.store.hydrate();
  let rows = await h.manager.readLocalWorkCatalogue('alice');
  assert.equal(rows[0].count, 1); assert.equal(rows[0].pendingCount, 1); assert.ok(notifications.length);
  let operation = h.store.pendingOperations()[0]; await h.store.acknowledge(operation.operationId, accepted(operation));
  assert.deepEqual(await h.manager.discoverPendingWorks('alice'), []);
  await h.store.remove('legacy-id'); rows = await h.manager.readLocalWorkCatalogue('alice');
  assert.equal(rows[0].count, 0); assert.equal(rows[0].pendingCount, 1);
  assert.deepEqual(await h.manager.discoverPendingWorks('alice'), ['hamlet']);
  operation = h.store.pendingOperations()[0]; await h.store.acknowledge(operation.operationId, accepted(operation));
  h.data.set('@bard-test/client-a/legacy/alice/hamlet/broken', 'invalid');
  rows = await h.manager.readLocalWorkCatalogue('alice'); assert.equal(rows[0].count, 1); assert.equal(rows[0].unavailableCount, 1);
  assert.equal(h.data.has('@bard-test/client-a/legacy/alice/hamlet/legacy-id'), true); unsubscribe();
});

test('paused durable mode does not migrate original highlights and exact raw retirement retains bytes through restart', async () => {
  const h = setup(), key = '@bard-test/raw/legacy/alice/unknown/broken', raw = '{broken'; h.data.set(key, raw);
  const create = () => require('../../reader/highlightSyncStore').createHighlightSyncStoreManagerForNamespace(h.storage, { namespace: '@bard-test/raw', migrateLegacy: false });
  let manager = create(), scope = { uid: 'alice', workKey: 'unknown' };
  let snapshot = await manager.readRawWork(scope); assert.equal(snapshot.entries[0].raw, raw);
  await assert.rejects(manager.retireRawEntry({ ...scope, key: key.replace('/alice/', '/bob/'), raw }), { code: 'INVALID_HIGHLIGHT' });
  await assert.rejects(manager.retireRawEntry({ ...scope, key, raw: 'different' }), { code: 'WRITE_CONFLICT' });
  await manager.retireRawEntry({ ...scope, key, raw }); assert.equal(h.data.get(key), raw);
  manager = create(); snapshot = await manager.readRawWork(scope); assert.equal(snapshot.entries.length, 0);
  assert.equal((await manager.readLocalWorkCatalogue('alice'))[0].count, 0);
  h.data.set(key, 'replacement'); assert.equal((await manager.readRawWork(scope)).entries.length, 1, 'a changed original is not hidden by the retired marker');
  const legacyKey = '@bard-test/raw/legacy/alice/hamlet/legacy-id'; h.data.set(legacyKey, JSON.stringify(legacyRecord()));
  const store = manager.forWork({ uid: 'alice', canonical }); const before = writes(h).length;
  await store.hydrate(); assert.equal(writes(h).length, before); assert.equal(store.pendingOperations().length, 0);
});

test('failed raw retirement remains blocked through read-only refresh and explicit retry reuses exact bytes', async () => {
  const h = setup(), scope = { uid: 'alice', workKey: 'hamlet' }, key = '@bard-test/client-a/legacy/alice/hamlet/broken'; h.data.set(key, 'bad');
  const set = h.storage.setItem; h.storage.setItem = async () => { throw new Error('disk'); };
  await assert.rejects(h.manager.retireRawEntry({ ...scope, key, raw: 'bad' }), { code: 'WRITE_FAILED' });
  h.storage.setItem = set;
  let snapshot = await h.manager.readRawWork(scope); assert.equal(snapshot.writeBlocked, true); assert.equal(snapshot.entries.length, 1);
  await h.manager.retryRawWork(scope); snapshot = await h.manager.readRawWork(scope); assert.equal(snapshot.writeBlocked, false); assert.equal(snapshot.entries.length, 0);
  assert.equal(h.data.get(key), 'bad');
});

test('malformed stored work segments stay discoverable and can only retire exact same-account raw entries', async () => {
  const h = setup(), workKey = '%ZZ', key = '@bard-test/client-a/legacy/alice/' + workKey + '/broken'; h.data.set(key, 'bad');
  const rows = await h.manager.readLocalWorkCatalogue('alice');
  assert.equal(rows[0].workKey, workKey); assert.equal(rows[0].workId, null); assert.equal(rows[0].count, 1);
  assert.deepEqual(await h.manager.discoverPendingWorks('alice'), []);
  const scope = { uid: 'alice', workKey };
  assert.equal((await h.manager.readRawWork(scope)).entries.length, 1);
  await h.manager.retireRawEntry({ ...scope, key, raw: 'bad' }); assert.equal((await h.manager.readRawWork(scope)).entries.length, 0);
  assert.equal(h.data.get(key), 'bad');
});

for (const [label, workKey] of [['empty', ''], ['oversized', 'x'.repeat(2048)]]) {
  test('retained ' + label + ' normal-v1 work segment remains inspectable and exactly retireable without canonical promotion', async () => {
    const key = '@bard/reader-highlights:v1/alice/' + workKey + '/bad', h = setup({ [key]: '{' });
    const manager = require('../../reader/highlightSyncStore').createHighlightSyncStoreManagerForNamespace(h.storage, {
      namespace: '@bard/reader-highlights-sync:account-v2', legacyPrefixFor: require('../../reader/readerHighlights').prefixFor, migrateLegacy: false,
    });
    const rows = await manager.readLocalWorkCatalogue('alice');
    assert.equal(rows.length, 1); assert.equal(rows[0].workKey, workKey); assert.equal(rows[0].count, 1);
    const scope = { uid: 'alice', workKey };
    const inspected = await manager.readRawWork(scope); assert.equal(inspected.entries[0].key, key); assert.equal(inspected.entries[0].raw, '{');
    assert.equal(rows[0].workId, null);
    await manager.retireRawEntry({ ...scope, key, raw: '{' });
    assert.equal((await manager.readRawWork(scope)).entries.length, 0);
    assert.equal((await manager.readLocalWorkCatalogue('alice'))[0].count, 0);
    assert.equal(h.data.get(key), '{');
  });
}

test('raw catalogue retains malformed base and nested record keys without treating storage keys as filesystem paths', async () => {
  const h = setup(), base = '@bard-test/client-a/legacy/alice/hamlet', keys = [base, base + '/a/b'];
  for (const key of keys) h.data.set(key, 'bad');
  const scope = { uid: 'alice', workKey: 'hamlet' };
  assert.equal((await h.manager.readLocalWorkCatalogue('alice'))[0].count, 2);
  assert.equal((await h.manager.readRawWork(scope)).entries.length, 2);
  for (const key of keys) await h.manager.retireRawEntry({ ...scope, key, raw: 'bad' });
  assert.equal((await h.manager.readRawWork(scope)).entries.length, 0);
  for (const key of keys) assert.equal(h.data.get(key), 'bad');
});

test('explicit deletion of a retained older-version envelope uses its exact stored reference', async () => {
  const h = setup(); const created = await h.store.create(ref(), 'yellow');
  const operation = h.store.pendingOperations()[0]; await h.store.acknowledge(operation.operationId, accepted(operation));
  const newer = { ...canonical, contentVersion: 'b'.repeat(64) }, store = h.manager.forWork({ uid: 'alice', canonical: newer });
  await store.hydrate(); assert.equal(store.getSnapshot().unresolved.length, 1);
  await store.remove(created.record.id);
  assert.equal(store.pendingOperations()[0].kind, 'delete');
  assert.deepEqual(store.pendingOperations()[0].selectionRef, operation.selectionRef);
  assert.equal(store.getSnapshot().tombstones.length, 1);
});

test('abandoning a failed unavailable removal prevents later retry from hiding its retained original', async () => {
  const key = '@bard-test/client-a/legacy/alice/hamlet/broken', h = setup({ [key]: 'bad' }); await h.store.hydrate();
  const unavailable = h.store.getSnapshot().unreadable[0], set = h.storage.setItem;
  h.storage.setItem = async () => { throw new Error('disk'); };
  await assert.rejects(h.store.remove(unavailable.id), { code: 'WRITE_FAILED' });
  h.store.abandonPendingIntent(); h.storage.setItem = set;
  await h.store.retry(); assert.equal(h.store.getSnapshot().unreadable.length, 1); assert.equal(h.data.get(key), 'bad');
});

test('sync store requires an explicit isolated namespace and never discovers normal highlight storage', async () => {
  const { createHighlightSyncStoreManager } = require('../../reader/highlightSyncStore');
  assert.throws(() => createHighlightSyncStoreManager({}, {}), /isolated namespace/i);
  const fixture = setup({ '@bard/reader-highlights:v1/alice/hamlet/private': 'private' });
  await fixture.store.hydrate(); assert.equal(fixture.store.getSnapshot().records.length, 0);
  assert.ok(!fixture.calls.some(call => call[1]?.includes('/private')));
});

test('a mutation publishes only after a single durable record-plus-intent write', async () => {
  const fixture = setup(), gate = deferred(), original = fixture.storage.setItem;
  fixture.storage.setItem = async (...args) => { await gate.promise; return original(...args); };
  const pending = fixture.store.create(ref(), 'sage'); await tick();
  assert.equal(fixture.store.getSnapshot().records.length, 0);
  gate.resolve(); const result = await pending;
  assert.equal(writes(fixture).length, 1);
  const envelope = JSON.parse(writes(fixture)[0][2]);
  assert.deepEqual(envelope.record, result.record); assert.equal(envelope.pending.length, 1);
  assert.deepEqual(envelope.pending[0], fixture.store.pendingOperations()[0]);
  assert.equal(fixture.store.getSnapshot().syncById[result.record.id].status, 'pending');
});

test('restart retains stable operation IDs and deletion intents without losing local confirmation', async () => {
  const first = setup(); const created = await first.store.create(ref(), 'yellow');
  const op = first.store.pendingOperations()[0];
  const restarted = setup(Object.fromEntries(first.data)); await restarted.store.hydrate();
  assert.deepEqual(restarted.store.pendingOperations(), [op]);
  await restarted.store.remove(created.record.id);
  assert.equal(restarted.store.getSnapshot().records.length, 0);
  const raw = [...restarted.data.values()].map(value => JSON.parse(value));
  assert.equal(raw[0].deleted, true); assert.equal(raw[0].pending.at(-1).kind, 'delete');
  const again = setup(Object.fromEntries(restarted.data)); await again.store.hydrate();
  assert.equal(again.store.getSnapshot().syncSummary.pending, 1);
  assert.equal(again.store.getSnapshot().tombstones.length, 1);
});

test('failed local writes are not pending sync and ambiguous retry uses exact original envelope', async () => {
  for (const ambiguous of [false, true]) {
    const fixture = setup(), original = fixture.storage.setItem;
    fixture.storage.setItem = async (key, value) => { if (ambiguous) fixture.data.set(key, value); throw new Error('disk'); };
    await assert.rejects(fixture.store.create(ref(), 'rose'), { code: 'WRITE_FAILED' });
    assert.equal(fixture.store.getSnapshot().records.length, 0); assert.equal(fixture.store.pendingOperations().length, 0);
    fixture.storage.setItem = original; await fixture.store.retry();
    assert.equal(fixture.store.getSnapshot().records.length, 1); assert.equal(fixture.store.pendingOperations().length, 1);
    assert.equal(writes(fixture).length, ambiguous ? 0 : 1);
  }
});

test('an old acknowledgement cannot sync a newer local edit and exact replay is harmless', async () => {
  const fixture = setup(), created = await fixture.store.create(ref(), 'yellow');
  const first = fixture.store.pendingOperations()[0]; await fixture.store.recolor(created.record.id, 'blue');
  await fixture.store.acknowledge(first.operationId, accepted(first));
  assert.equal(fixture.store.getSnapshot().records[0].colorId, 'blue');
  assert.equal(fixture.store.getSnapshot().syncById[created.record.id].status, 'pending');
  const second = fixture.store.pendingOperations()[0]; assert.notEqual(second.operationId, first.operationId);
  await fixture.store.acknowledge(first.operationId, accepted(first));
  assert.equal(fixture.store.pendingOperations()[0].operationId, second.operationId);
  await fixture.store.acknowledge(second.operationId, accepted(second));
  assert.equal(fixture.store.getSnapshot().syncById[created.record.id].status, 'synced');
});

test('cloud failure is durable separate metadata and does not disable another confirmed local edit', async () => {
  const fixture = setup(), created = await fixture.store.create(ref(), 'yellow');
  const first = fixture.store.pendingOperations()[0];
  await fixture.store.syncFailed(first.operationId, { code: 'permission-denied', message: 'Denied' });
  assert.equal(fixture.store.getSnapshot().error, null);
  assert.equal(fixture.store.getSnapshot().syncById[created.record.id].status, 'failed');
  await fixture.store.recolor(created.record.id, 'blue');
  assert.equal(fixture.store.getSnapshot().records[0].colorId, 'blue');
  const restarted = setup(Object.fromEntries(fixture.data)); await restarted.store.hydrate();
  assert.equal(restarted.store.getSnapshot().syncById[created.record.id].status, 'failed');
});

test('fixture migration preserves original raw bytes and IDs and resumes after interruption without duplicates', async () => {
  const key = '@bard-test/client-a/legacy/alice/hamlet/legacy-id';
  const original = ' \n' + JSON.stringify(legacyRecord()) + ' \r\n';
  const fixture = setup({ [key]: original }); let fail = true; const set = fixture.storage.setItem;
  fixture.storage.setItem = async (...args) => { if (fail) throw new Error('power'); return set(...args); };
  await assert.rejects(fixture.store.hydrate(), { code: 'WRITE_FAILED' });
  assert.equal(fixture.data.get(key), original); fail = false; await fixture.store.retry();
  assert.deepEqual(fixture.store.getSnapshot().records.map(record => record.id), ['legacy-id']);
  assert.equal(fixture.data.get(key), original);
  const restarted = setup(Object.fromEntries(fixture.data)); await restarted.store.hydrate();
  assert.equal(restarted.store.getSnapshot().records.length, 1); assert.equal(restarted.store.pendingOperations().length, 1);
  assert.equal(restarted.data.get(key), original);
});

test('incoming same-account records preserve aliases and mark all overlaps without arbitrary paint winner', async () => {
  const a = setup(), b = setup({}, { namespace: '@bard-test/client-b' });
  const first = await a.store.create(ref(), 'yellow'), second = await b.store.create(ref(3, 8), 'blue');
  const firstOp = a.store.pendingOperations()[0], secondOp = b.store.pendingOperations()[0];
  await a.store.acknowledge(firstOp.operationId, accepted(firstOp));
  await a.store.mergeRemote([{ cloudKey: secondOp.cloudKey, cloud: accepted(secondOp).cloud }]);
  assert.equal(a.store.getSnapshot().records.length, 2); assert.equal(a.store.getSnapshot().conflicts.length, 2);
  assert.equal(a.store.getSnapshot().records.find(record => record.id === first.record.id).colorId, 'yellow');
  assert.ok(second.record.id);
});

test('remote tombstones block automatic resurrection and recreation advances the observed generation explicitly', async () => {
  const fixture = setup(), created = await fixture.store.create(ref(), 'yellow');
  const first = fixture.store.pendingOperations()[0]; await fixture.store.acknowledge(first.operationId, accepted(first));
  await fixture.store.mergeRemote([{ cloudKey: first.cloudKey, cloud: { ...accepted(first).cloud, deleted: true, serverRevision: 2 } }]);
  assert.equal(fixture.store.getSnapshot().records.length, 0);
  await assert.rejects(fixture.store.create(ref(), 'blue'), { code: 'RECREATE_CONFIRMATION_REQUIRED', id: created.record.id });
  await fixture.store.recreate(created.record.id, 'blue');
  const op = fixture.store.pendingOperations()[0]; assert.equal(op.kind, 'recreate'); assert.equal(op.generation, 2); assert.equal(op.baseRevision, 2);
});

test('owner guards reject delayed acknowledgements after A to B to A and queue rejects cancelled local writes', async () => {
  const fixture = setup(), created = await fixture.store.create(ref(), 'yellow'), operation = fixture.store.pendingOperations()[0];
  let current = false;
  await assert.rejects(fixture.store.acknowledge(operation.operationId, accepted(operation), { isCurrent: () => current }), { code: 'CANCELLED' });
  await assert.rejects(fixture.store.recolor(created.record.id, 'blue', { isCurrent: () => current }), { code: 'CANCELLED' });
  const b = fixture.manager.forWork({ uid: 'bob', canonical }); await b.hydrate(); assert.equal(b.getSnapshot().records.length, 0);
  assert.equal(fixture.store.pendingOperations().length, 1);
});

test('corrupt and incompatible fixtures are retained without migration writes or guessed reference relocation', async () => {
  const prefix = '@bard-test/client-a/legacy/alice/hamlet/';
  const old = legacyRecord({ id: 'old', selectionRef: { ...ref(), contentVersion: 'b'.repeat(64) } });
  const initial = { [prefix + 'bad']: '{', [prefix + 'old']: JSON.stringify(old) };
  const fixture = setup(initial); await fixture.store.hydrate();
  assert.equal(fixture.store.getSnapshot().unreadable.length, 1); assert.equal(fixture.store.getSnapshot().unresolved.length, 1);
  assert.equal(writes(fixture).length, 0); assert.deepEqual(Object.fromEntries(fixture.data), initial);
});

test('durable backlog is bounded and capacity rejection never evicts or changes confirmed records', async () => {
  const fixture = setup(), created = await fixture.store.create(ref(), 'yellow');
  const { SYNC_STORE_LIMITS } = require('../../reader/highlightSyncStore');
  for (let i = 1; i < SYNC_STORE_LIMITS.MAX_PENDING_PER_RECORD; i++) await fixture.store.recolor(created.record.id, i % 2 ? 'blue' : 'yellow');
  const before = [...fixture.data.entries()];
  await assert.rejects(fixture.store.recolor(created.record.id, 'rose'), { code: 'SYNC_BACKLOG_LIMIT' });
  assert.deepEqual([...fixture.data.entries()], before); assert.equal(fixture.store.getSnapshot().records.length, 1);
});

test('a listener that delivered a newer server revision is not rolled back by an older operation acknowledgement', async () => {
  const fixture = setup(), created = await fixture.store.create(ref(), 'yellow'), first = fixture.store.pendingOperations()[0];
  await fixture.store.acknowledge(first.operationId, accepted(first));
  await fixture.store.recolor(created.record.id, 'blue'); const second = fixture.store.pendingOperations()[0];
  const newest = accepted(second, { colorId: 'rose', serverRevision: 3, lastOperationId: 'remote-3' });
  await fixture.store.mergeRemote([{ cloudKey: second.cloudKey, cloud: newest.cloud }]);
  await fixture.store.acknowledge(second.operationId, accepted(second));
  assert.equal(fixture.store.getSnapshot().records[0].colorId, 'rose');
  assert.equal(fixture.store.getSnapshot().syncById[created.record.id].serverRevision, 3);
  const restarted = setup(Object.fromEntries(fixture.data)); await restarted.store.hydrate();
  assert.equal(restarted.store.getSnapshot().records[0].colorId, 'rose');
});

test('local queued edits are not falsely conflicted by a listener echo of the previous operation', async () => {
  const fixture = setup(), created = await fixture.store.create(ref(), 'yellow'), first = fixture.store.pendingOperations()[0];
  await fixture.store.recolor(created.record.id, 'blue');
  await fixture.store.mergeRemote([{ cloudKey: first.cloudKey, cloud: accepted(first).cloud }]);
  assert.equal(fixture.store.getSnapshot().syncById[created.record.id].status, 'pending');
  assert.equal(fixture.store.getSnapshot().conflicts.length, 0);
  await fixture.store.acknowledge(first.operationId, accepted(first));
  assert.equal(fixture.store.pendingOperations()[0].kind, 'recolor');
});

test('a pending local edit conflicted by a remote deletion is retained but excluded from painting', async () => {
  const fixture = setup(), created = await fixture.store.create(ref(), 'yellow'), first = fixture.store.pendingOperations()[0];
  await fixture.store.acknowledge(first.operationId, accepted(first)); await fixture.store.recolor(created.record.id, 'blue');
  await fixture.store.mergeRemote([{ cloudKey: first.cloudKey, cloud: { ...accepted(first).cloud, deleted: true, serverRevision: 2, lastOperationId: 'remote-delete' } }]);
  assert.equal(fixture.store.getSnapshot().records[0].colorId, 'blue');
  assert.ok(fixture.store.getSnapshot().conflicts.includes(created.record.id));
  assert.equal(fixture.store.pendingOperations().length, 0);
});

test('migration converges duplicate ranges with all local ID aliases while repeated quotations stay distinct', async () => {
  const prefix = '@bard-test/client-a/legacy/alice/hamlet/';
  const entries = [legacyRecord({ id: 'first' }), legacyRecord({ id: 'alias' }), legacyRecord({ id: 'repeat', selectionRef: ref(17, 22) })];
  const initial = Object.fromEntries(entries.map(record => [prefix + record.id, JSON.stringify(record)]));
  const fixture = setup(initial); await fixture.store.hydrate();
  assert.equal(fixture.store.getSnapshot().records.length, 2);
  assert.equal(fixture.store.pendingOperations().length, 2);
  assert.equal(fixture.store.getSnapshot().syncById.first.cloudKey, fixture.store.getSnapshot().syncById.alias.cloudKey);
  assert.notEqual(fixture.store.getSnapshot().syncById.first.cloudKey, fixture.store.getSnapshot().syncById.repeat.cloudKey);
  for (const [key, value] of Object.entries(initial)) assert.equal(fixture.data.get(key), value);
  await fixture.store.recolor('first', 'blue');
  assert.equal(fixture.store.getSnapshot().records.find(record => record.selectionRef.start === 0).colorId, 'blue');
});

test('forged acknowledgements and invalid remote records cannot mutate confirmed local records', async () => {
  const fixture = setup(); await fixture.store.create(ref(), 'yellow'); const operation = fixture.store.pendingOperations()[0];
  const before = [...fixture.data.entries()], result = accepted(operation);
  await assert.rejects(fixture.store.acknowledge(operation.operationId, { ...result, receipt: { ...result.receipt, operationId: 'other' } }));
  await assert.rejects(fixture.store.mergeRemote([{ cloudKey: operation.cloudKey, cloud: { ...result.cloud, selectionRef: { ...ref(), exact: 'faked' } } }]));
  assert.deepEqual([...fixture.data.entries()], before);
});

test('a failed journal acknowledgement is reconciled locally without losing its original cloud operation', async () => {
  const fixture = setup(); await fixture.store.create(ref(), 'yellow'); const operation = fixture.store.pendingOperations()[0], set = fixture.storage.setItem;
  fixture.storage.setItem = async () => { throw new Error('disk'); };
  await assert.rejects(fixture.store.acknowledge(operation.operationId, accepted(operation)), { code: 'WRITE_FAILED' });
  assert.equal(fixture.store.pendingOperations()[0].operationId, operation.operationId);
  fixture.storage.setItem = set; await fixture.store.retry();
  assert.equal(fixture.store.getSnapshot().syncSummary.synced, 1);
  assert.equal(fixture.store.pendingOperations().length, 0);
});

test('abandoning a failed local draft never replays it during later reconciliation', async () => {
  const fixture = setup(), set = fixture.storage.setItem;
  fixture.storage.setItem = async () => { throw new Error('disk'); };
  await assert.rejects(fixture.store.create(ref(), 'yellow'), { code: 'WRITE_FAILED' });
  fixture.store.abandonPendingIntent(); fixture.storage.setItem = set; await fixture.store.retry();
  assert.equal(fixture.store.getSnapshot().records.length, 0); assert.equal(fixture.store.pendingOperations().length, 0);
});

test('unchanged reconnect snapshots do not conflict with an offline recolor based on that known server revision', async () => {
  const fixture = setup(), created = await fixture.store.create(ref(), 'yellow'), operation = fixture.store.pendingOperations()[0], result = accepted(operation);
  await fixture.store.acknowledge(operation.operationId, result); await fixture.store.recolor(created.record.id, 'blue');
  await fixture.store.mergeRemote([{ cloudKey: operation.cloudKey, cloud: result.cloud }]);
  assert.equal(fixture.store.getSnapshot().syncById[created.record.id].status, 'pending');
  assert.equal(fixture.store.pendingOperations().length, 1);
});

test('an acknowledgement completing after its owner epoch retires cannot publish a stale synced result', async () => {
  const fixture = setup(); await fixture.store.create(ref(), 'yellow'); const operation = fixture.store.pendingOperations()[0];
  const gate = deferred(), set = fixture.storage.setItem; let active = true, syncedPublished = false;
  fixture.store.subscribe(() => { if (!active && fixture.store.getSnapshot().syncSummary.synced) syncedPublished = true; });
  fixture.storage.setItem = async (...args) => { await gate.promise; return set(...args); };
  const acknowledgement = fixture.store.acknowledge(operation.operationId, accepted(operation), { isCurrent: () => active });
  await tick(); active = false; gate.resolve();
  await assert.rejects(acknowledgement, { code: 'CANCELLED' });
  assert.equal(syncedPublished, false); assert.equal(fixture.store.getSnapshot().syncSummary.pending, 1);
  // The old fixed-owner write may already be on disk. A fresh queued owner
  // hydration reconciles those bytes rather than replaying stale callbacks.
  fixture.storage.setItem = set; await fixture.store.hydrate();
  assert.equal(fixture.store.getSnapshot().syncSummary.synced, 1);
});

test('conflict resolution always uses the newest observed cloud revision instead of an older conflict shadow', async () => {
  const fixture = setup(), created = await fixture.store.create(ref(), 'yellow'), operation = fixture.store.pendingOperations()[0];
  await fixture.store.acknowledge(operation.operationId, accepted(operation)); await fixture.store.recolor(created.record.id, 'blue');
  const rose = accepted(operation, { colorId: 'rose', serverRevision: 2, lastOperationId: 'remote-rose' }).cloud;
  const blue = accepted(operation, { colorId: 'blue', serverRevision: 3, lastOperationId: 'remote-blue' }).cloud;
  await fixture.store.mergeRemote([{ cloudKey: operation.cloudKey, cloud: rose }]);
  await fixture.store.mergeRemote([{ cloudKey: operation.cloudKey, cloud: blue }]);
  await fixture.store.resolveConflict(created.record.id, 'use-cloud');
  assert.equal(fixture.store.getSnapshot().records[0].colorId, 'blue');
  assert.equal(fixture.store.getSnapshot().syncById[created.record.id].serverRevision, 3);
});

test('Firestore Timestamp serialization metadata does not turn an unchanged snapshot into inconsistent data', async () => {
  const { Timestamp } = require('firebase/firestore'), fixture = setup(); await fixture.store.create(ref(), 'yellow');
  const operation = fixture.store.pendingOperations()[0], result = accepted(operation), stamp = new Timestamp(100, 2);
  result.cloud.createdAt = stamp; result.cloud.updatedAt = stamp; result.receipt.createdAt = stamp;
  await fixture.store.acknowledge(operation.operationId, result);
  await fixture.store.mergeRemote([{ cloudKey: operation.cloudKey, cloud: result.cloud }]);
  assert.equal(fixture.store.getSnapshot().syncSummary.synced, 1);
});

test('a local deletion stays eligible after a concurrent same-generation recolor arrives', async () => {
  const fixture = setup(), created = await fixture.store.create(ref(), 'yellow'), operation = fixture.store.pendingOperations()[0];
  await fixture.store.acknowledge(operation.operationId, accepted(operation)); await fixture.store.remove(created.record.id);
  const cloud = accepted(operation, { colorId: 'blue', serverRevision: 2, lastOperationId: 'remote-recolor' }).cloud;
  await fixture.store.mergeRemote([{ cloudKey: operation.cloudKey, cloud }]);
  assert.equal(fixture.store.pendingOperations()[0]?.kind, 'delete');
  assert.equal(fixture.store.getSnapshot().syncSummary.conflict, 0);
});

test('retired-owner acknowledgement write rejection cannot block a later owner hydration', async () => {
  const fixture = setup(); await fixture.store.create(ref(), 'yellow'); const operation = fixture.store.pendingOperations()[0], gate = deferred(); let active = true;
  const set = fixture.storage.setItem; fixture.storage.setItem = async () => { await gate.promise; throw new Error('disk'); };
  const pending = fixture.store.acknowledge(operation.operationId, accepted(operation), { isCurrent: () => active });
  await tick(); active = false; gate.resolve(); await assert.rejects(pending, { code: 'CANCELLED' });
  fixture.storage.setItem = set; await fixture.store.hydrate();
  assert.equal(fixture.store.getSnapshot().error, null); assert.equal(fixture.store.pendingOperations().length, 1);
});

test('deleting an unsent recreation retains its generation-advancing prerequisite before the deletion', async () => {
  const fixture = setup(), created = await fixture.store.create(ref(), 'yellow'), first = fixture.store.pendingOperations()[0];
  await fixture.store.acknowledge(first.operationId, accepted(first));
  await fixture.store.mergeRemote([{ cloudKey: first.cloudKey, cloud: accepted(first, { deleted: true, serverRevision: 2, lastOperationId: 'remote-delete' }).cloud }]);
  await fixture.store.recreate(created.record.id, 'blue'); const recreation = fixture.store.pendingOperations()[0];
  await fixture.store.remove(created.record.id);
  assert.equal(fixture.store.pendingOperations()[0].operationId, recreation.operationId);
  await fixture.store.acknowledge(recreation.operationId, accepted(recreation));
  const deletion = fixture.store.pendingOperations()[0];
  assert.equal(deletion.kind, 'delete'); assert.equal(deletion.generation, 2); assert.equal(deletion.baseRevision, 3);
  await fixture.store.acknowledge(deletion.operationId, accepted(deletion));
  assert.equal(fixture.store.getSnapshot().syncSummary.synced, 1); assert.equal(fixture.store.getSnapshot().records.length, 0);
});
