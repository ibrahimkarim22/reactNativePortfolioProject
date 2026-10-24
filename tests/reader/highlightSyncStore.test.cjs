const assert = require('node:assert/strict');
const test = require('node:test');
const { canonical, ref, legacyRecord, setup, deferred, accepted } = require('./highlightSyncFixture.cjs');
const writes = fixture => fixture.calls.filter(call => call[0] === 'set');
const tick = () => new Promise(resolve => setImmediate(resolve));

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
