const assert = require('node:assert/strict');
const test = require('node:test');
const { canonical, ref, setup, deferred, accepted } = require('./highlightSyncFixture.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('durable create/delete acknowledgements advance catalogue before delayed metadata echoes and never roll back', async () => {
  const h = setup(), events = [];
  let metadata = { schemaVersion: 1, activeCount: 0, activeBytes: 0, revision: 1, lastOperationId: 'earlier-delete' };
  const coordinator = require('../../reader/highlightSyncCoordinator').createHighlightSyncCoordinator({ manager: h.manager,
    transport: {
      async commit(operation) {
        const result = accepted(operation);
        metadata = { ...metadata, activeCount: operation.kind === 'delete' ? 0 : 1, activeBytes: operation.kind === 'delete' ? 0 : result.cloud.payloadBytes, revision: metadata.revision + 1, lastOperationId: operation.operationId };
        return { ...result, metadata, receipt: { ...result.receipt, metadataRevision: metadata.revision } };
      },
      listen() { return () => {}; }, listenWorks(uid, next) { events.push(next); return () => {}; },
    }, resolveCanonical: () => canonical });
  await coordinator.setOwner('alice'); await coordinator.openWork(canonical);
  const staleEmpty = [{ workId: 'hamlet', metadata }]; await events[0](staleEmpty);
  const created = await h.store.create(ref(), 'yellow'); await coordinator.flush();
  assert.equal(h.store.pendingOperations().length, 0);
  assert.equal(coordinator.getSnapshot().works[0].metadata.activeCount, 1, 'confirmed creation must not disappear while metadata listener lags');
  const confirmedCreate = coordinator.getSnapshot().works;
  await events[0](staleEmpty); await events[0]([]);
  assert.deepEqual(coordinator.getSnapshot().works, confirmedCreate);
  assert.deepEqual(await h.manager.readWorkCatalogue('alice'), confirmedCreate);
  await h.store.remove(created.record.id); await coordinator.flush();
  assert.equal(coordinator.getSnapshot().works[0].metadata.activeCount, 0, 'confirmed deletion must not reappear while metadata listener lags');
  const confirmedDelete = coordinator.getSnapshot().works;
  await events[0](confirmedCreate); await events[0](staleEmpty); await events[0]([]);
  assert.deepEqual(coordinator.getSnapshot().works, confirmedDelete);
  assert.deepEqual(await h.manager.readWorkCatalogue('alice'), confirmedDelete);
  coordinator.dispose();
});

test('failed local acknowledgement cannot promote server response metadata to the confirmed local catalogue', async () => {
  const h = setup(), events = [], created = await h.store.create(ref(), 'yellow');
  const operation = h.store.pendingOperations()[0], result = accepted(operation);
  const metadata = { schemaVersion: 1, activeCount: 1, activeBytes: result.cloud.payloadBytes, revision: 1, lastOperationId: operation.operationId };
  const coordinator = require('../../reader/highlightSyncCoordinator').createHighlightSyncCoordinator({ manager: h.manager,
    transport: { async commit() { h.storage.setItem = async () => { throw new Error('disk'); }; return { ...result, metadata }; }, listen() {}, listenWorks(uid, next) { events.push(next); return () => {}; } },
    resolveCanonical: () => canonical });
  await coordinator.setOwner('alice'); await coordinator.flush();
  assert.equal(h.store.getSnapshot().syncById[created.record.id].status, 'pending');
  assert.deepEqual(coordinator.getSnapshot().works, []);
  coordinator.dispose();
});

test('catalogue persistence failure retains acknowledged counts in memory and remains an explicit discovery error', async () => {
  const h = setup(), set = h.storage.setItem;
  h.storage.setItem = async (key, value) => { if (key.includes('/catalogue/')) throw new Error('catalogue disk failure'); return set(key, value); };
  const coordinator = require('../../reader/highlightSyncCoordinator').createHighlightSyncCoordinator({ manager: h.manager,
    transport: { async commit(operation) { const result = accepted(operation); return { ...result, metadata: { schemaVersion: 1, activeCount: 1, activeBytes: result.cloud.payloadBytes, revision: 1, lastOperationId: operation.operationId } }; }, listen() {} },
    resolveCanonical: () => canonical });
  await h.store.create(ref(), 'yellow'); await coordinator.setOwner('alice'); await coordinator.flush();
  assert.equal(h.store.pendingOperations().length, 0);
  assert.equal(coordinator.getSnapshot().works[0].metadata.activeCount, 1);
  assert.equal(coordinator.getSnapshot().discoveryError.code, 'WRITE_FAILED');
  coordinator.dispose();
});

test('fresh account discovers multiple plays without resolving canonicals, persists counts and rejects old account deliveries', async () => {
  const h = setup(), events = [], resolved = [];
  const coordinator = require('../../reader/highlightSyncCoordinator').createHighlightSyncCoordinator({ manager: h.manager,
    transport: { commit() {}, listen() {}, listenWorks(uid, next, error, options) { const entry = { uid, next, error, options, stopped: false }; events.push(entry); return () => { entry.stopped = true; }; } },
    resolveCanonical(id) { resolved.push(id); throw new Error('Discovery must not open a play'); } });
  await coordinator.setOwner('alice');
  assert.equal(events.length, 1);
  const rows = ['hamlet', 'tempest'].map((workId, index) => ({ workId, metadata: { schemaVersion: 1, activeCount: index + 1, activeBytes: 100, revision: 1, lastOperationId: 'op' + index } }));
  await events[0].next(rows);
  assert.deepEqual(coordinator.getSnapshot().works, rows); assert.deepEqual(resolved, []);
  assert.deepEqual(await h.manager.readWorkCatalogue('alice'), rows);
  const deleted = rows.map(row => ({ ...row, metadata: { ...row.metadata, activeCount: 0, activeBytes: 0, revision: 2 } }));
  await events[0].next(deleted); assert.equal(coordinator.getSnapshot().works[0].metadata.activeCount, 0);
  await coordinator.setOwner('bob'); assert.equal(events[0].stopped, true);
  await events[0].next(rows); assert.deepEqual(coordinator.getSnapshot().works, []);
  coordinator.dispose();
});

test('discovery failures retain offline metadata and retry on bounded schedule without replaying writes', async () => {
  const h = setup(), events = [], schedules = [], rows = [{ workId: 'hamlet', metadata: { schemaVersion: 1, activeCount: 1, activeBytes: 100, revision: 1, lastOperationId: 'op' } }];
  await h.manager.writeWorkCatalogue('alice', rows);
  const coordinator = require('../../reader/highlightSyncCoordinator').createHighlightSyncCoordinator({ manager: h.manager,
    transport: { commit() { throw new Error('No writes'); }, listen() {}, listenWorks(uid, next, error) { events.push({ next, error }); return () => {}; } },
    resolveCanonical() { throw new Error('No canonical load'); }, schedule: fn => { schedules.push(fn); return fn; }, cancelSchedule() {} });
  await coordinator.setOwner('alice'); assert.deepEqual(coordinator.getSnapshot().works, rows);
  events[0].error({ code: 'unavailable' }); assert.equal(coordinator.getSnapshot().discoveryError.code, 'unavailable');
  assert.equal(schedules.length, 1); schedules[0](); await tick(); assert.equal(events.length, 2);
  await events[1].next(rows); assert.equal(coordinator.getSnapshot().discoveryError, null);
  coordinator.dispose();
});

test('read-only coordinator refresh reattaches discovery without retrying a blocked local write', async () => {
  const h = harness(), discovery = [];
  h.transport.listenWorks = (uid, next) => { discovery.push(next); return () => {}; };
  await h.coordinator.setOwner('alice'); await h.coordinator.openWork(canonical);
  const set = h.storage.setItem; h.storage.setItem = async () => { throw new Error('disk'); };
  await assert.rejects(h.store.create(ref(), 'yellow'), { code: 'WRITE_FAILED' }); h.storage.setItem = set;
  await h.coordinator.refreshReadOnly(); await h.coordinator.flush();
  assert.equal(h.store.getSnapshot().writeBlocked, true); assert.equal(h.calls.length, 0); assert.equal(discovery.length, 2);
  h.coordinator.dispose();
});

test('an unavailable retained play cannot starve another work durable pending operations', async () => {
  const h = setup({ '@bard-test/client-a/legacy/alice/a-missing/broken': 'bad' }); await h.store.create(ref(), 'yellow');
  const calls = [], coordinator = require('../../reader/highlightSyncCoordinator').createHighlightSyncCoordinator({ manager: h.manager,
    transport: { async commit(operation) { calls.push(operation); return accepted(operation); }, listen() { return () => {}; } },
    resolveCanonical: id => id === 'hamlet' ? canonical : null });
  await coordinator.setOwner('alice'); await coordinator.flush();
  assert.equal(calls.length, 1); assert.equal(calls[0].workId, 'hamlet');
  assert.equal(h.data.get('@bard-test/client-a/legacy/alice/a-missing/broken'), 'bad'); coordinator.dispose();
});

function harness(fixture = setup(), overrides = {}) {
  const calls = [], listeners = [], scheduled = [];
  const transport = {
    async commit(operation, options) { calls.push(operation); assert.equal(options.isCurrent(), true); return accepted(operation); },
    listen(uid, workId, onRecords, onError) { const listener = { uid, workId, onRecords, onError, closed: false }; listeners.push(listener); return () => { listener.closed = true; }; },
    ...overrides,
  };
  const { createHighlightSyncCoordinator } = require('../../reader/highlightSyncCoordinator');
  const coordinator = createHighlightSyncCoordinator({ manager: fixture.manager, transport, resolveCanonical: workId => { assert.equal(workId, 'hamlet'); return canonical; }, schedule: (fn, delay) => { const value = { fn, delay, cancelled: false }; scheduled.push(value); return value; }, cancelSchedule: handle => { handle.cancelled = true; }, random: () => 0.5 });
  return { ...fixture, coordinator, calls, listeners, scheduled, transport };
}

test('coordinator sends confirmed durable operations and acknowledges without changing annotation identity', async () => {
  const h = harness(); const created = await h.store.create(ref(), 'sage');
  await h.coordinator.setOwner('alice'); await h.coordinator.openWork(canonical); await h.coordinator.flush();
  assert.equal(h.calls.length, 1); assert.equal(h.store.getSnapshot().syncById[created.record.id].status, 'synced');
  assert.equal(h.store.getSnapshot().records[0].id, created.record.id);
  assert.equal(h.listeners.length, 1); h.coordinator.dispose();
});

test('offline journal survives coordinator and process restart then reconnects with stable operation identity', async () => {
  const original = setup(); await original.store.create(ref(), 'yellow'); const operationId = original.store.pendingOperations()[0].operationId;
  const offline = harness(original, { async commit() { throw Object.assign(new Error('offline'), { code: 'unavailable' }); } });
  await offline.coordinator.setOwner('alice'); await offline.coordinator.flush();
  assert.equal(offline.store.pendingOperations()[0].operationId, operationId);
  assert.equal(offline.store.getSnapshot().error, null); assert.ok(offline.scheduled[0].delay >= 1000);
  offline.coordinator.dispose();
  const restored = harness(setup(Object.fromEntries(original.data)));
  await restored.coordinator.setOwner('alice'); await restored.coordinator.flush();
  assert.equal(restored.calls[0].operationId, operationId); assert.equal(restored.store.getSnapshot().syncSummary.synced, 1);
  restored.coordinator.dispose();
});

test('permission failures stop automatic rapid retry and explicit retry preserves the exact pending operation', async () => {
  const h = harness(undefined, { async commit(operation) { h.calls.push(operation); throw Object.assign(new Error('denied'), { code: 'permission-denied' }); } });
  await h.store.create(ref(), 'yellow'); await h.coordinator.setOwner('alice'); await h.coordinator.flush();
  assert.equal(h.calls.length, 1); assert.equal(h.scheduled.length, 0); assert.equal(h.store.getSnapshot().syncSummary.failed, 1);
  await tick(); assert.equal(h.calls.length, 1);
  h.transport.commit = async operation => { h.calls.push(operation); return accepted(operation); };
  await h.coordinator.retry(); assert.equal(h.calls.length, 2); assert.equal(h.calls[0].operationId, h.calls[1].operationId);
  assert.equal(h.store.getSnapshot().syncSummary.synced, 1); h.coordinator.dispose();
});

test('A to B to A rejects an old acknowledgement and an old listener even after returning to the same UID', async () => {
  const gate = deferred(), h = harness(undefined, { async commit(operation) { h.calls.push(operation); if (h.calls.length === 1) return gate.promise; return accepted(operation); } });
  await h.store.create(ref(), 'yellow'); await h.coordinator.setOwner('alice'); await h.coordinator.openWork(canonical); await tick();
  const oldListener = h.listeners[0], operation = h.calls[0];
  await h.coordinator.setOwner('bob'); await h.coordinator.openWork(canonical);
  assert.equal(h.coordinator.getSnapshot().uid, 'bob');
  const bob = h.manager.forWork({ uid: 'bob', canonical }); assert.equal(bob.getSnapshot().records.length, 0);
  await h.coordinator.setOwner('alice'); await h.coordinator.openWork(canonical); await h.coordinator.flush();
  const writes = h.calls.length; gate.resolve(accepted(operation)); await tick();
  const newCloud = accepted(operation, { colorId: 'rose', serverRevision: 100 });
  await oldListener.onRecords([{ cloudKey: operation.cloudKey, cloud: newCloud.cloud }]); await tick();
  assert.equal(h.calls.length, writes); assert.equal(h.store.getSnapshot().records[0].colorId, 'yellow');
  assert.equal(oldListener.closed, true); assert.equal(h.coordinator.getSnapshot().uid, 'alice'); h.coordinator.dispose();
});

test('bounded listener capacity errors retain local data and never schedule automatic retries', async () => {
  const h = harness(); await h.store.create(ref(), 'yellow'); await h.coordinator.setOwner('alice'); await h.coordinator.openWork(canonical); await h.coordinator.flush();
  h.listeners[0].onError(Object.assign(new Error('too many retained markers'), { code: 'SYNC_LISTENER_LIMIT' })); await tick();
  assert.equal(h.coordinator.getSnapshot().error.code, 'SYNC_LISTENER_LIMIT');
  assert.equal(h.store.getSnapshot().records.length, 1); assert.equal(h.scheduled.length, 0); h.coordinator.dispose();
});

test('same-account remote snapshots enter only the opened work and disposal rejects delayed delivery', async () => {
  const h = harness(), foreign = setup({}, { namespace: '@bard-test/client-b' }); await foreign.store.create(ref(17, 22), 'blue');
  const operation = foreign.store.pendingOperations()[0]; await h.coordinator.setOwner('alice'); await h.coordinator.openWork(canonical);
  await h.listeners[0].onRecords([{ cloudKey: operation.cloudKey, cloud: accepted(operation).cloud }]); await h.store.flush();
  assert.equal(h.store.getSnapshot().records[0].selectionRef.start, 17);
  const before = [...h.data.entries()]; h.coordinator.dispose();
  await h.listeners[0].onRecords([{ cloudKey: operation.cloudKey, cloud: accepted(operation, { colorId: 'rose' }).cloud }]);
  assert.deepEqual([...h.data.entries()], before);
});

test('a permanent conflict blocks only its own operation and does not stop other passages from synchronizing', async () => {
  const h = harness(undefined, { async commit(operation) { h.calls.push(operation); if (operation.selectionRef.start === 0) throw Object.assign(new Error('conflict'), { code: 'SYNC_CONFLICT' }); return accepted(operation); } });
  const first = await h.store.create(ref(), 'yellow'), next = await h.store.create(ref(17, 22), 'blue');
  await h.coordinator.setOwner('alice'); await h.coordinator.flush();
  assert.equal(h.store.getSnapshot().syncById[first.record.id].status, 'conflict');
  assert.equal(h.store.getSnapshot().syncById[next.record.id].status, 'synced');
  assert.equal(h.scheduled.length, 0); h.coordinator.dispose();
});

test('transient listener startup failure automatically reattaches with bounded delay even with no outgoing operations', async () => {
  const h = harness(); await h.coordinator.setOwner('alice'); await h.coordinator.openWork(canonical); await h.coordinator.flush();
  const first = h.listeners[0]; first.onError(Object.assign(new Error('emulator not ready'), { code: 'SYNC_EMULATOR_UNAVAILABLE' }));
  assert.equal(h.scheduled.length, 1); h.scheduled[0].fn(); await tick();
  assert.equal(h.listeners.length, 2); assert.equal(first.closed, true);
  const scheduled = h.scheduled.length; first.onError(Object.assign(new Error('late closed failure'), { code: 'unavailable' }));
  assert.equal(h.scheduled.length, scheduled);
  await h.listeners[1].onRecords([]); assert.equal(h.coordinator.getSnapshot().error, null);
  h.coordinator.dispose();
});

test('initial pending-work discovery read failure retries automatically without opening the work', async () => {
  const h = setup(), scheduled = [], calls = [];
  const discover = h.manager.discoverPendingWorks; let readable = false;
  h.manager.discoverPendingWorks = async (...args) => { if (!readable) throw Object.assign(new Error('storage not ready'), { code: 'READ_FAILED' }); return discover(...args); };
  await h.store.create(ref(), 'yellow'); const operation = h.store.pendingOperations()[0];
  const coordinator = require('../../reader/highlightSyncCoordinator').createHighlightSyncCoordinator({ manager: h.manager,
    transport: { async commit(value) { calls.push(value); return accepted(value); }, listen() { return () => {}; } }, resolveCanonical: () => canonical,
    schedule(fn, delay) { scheduled.push({ fn, delay }); return fn; }, cancelSchedule() {}, random: () => 0.5 });
  await coordinator.setOwner('alice'); await coordinator.flush();
  assert.equal(coordinator.getSnapshot().error.code, 'READ_FAILED');
  assert.equal(scheduled.length, 1, 'a transient catalogue read must have an automatic recovery');
  assert.equal(scheduled[0].delay, 1000); readable = true; scheduled[0].fn(); await tick(); await coordinator.flush();
  assert.equal(calls.length, 1); assert.equal(calls[0].operationId, operation.operationId);
  assert.equal(h.store.getSnapshot().syncSummary.synced, 1); assert.equal(coordinator.getSnapshot().error, null);
  coordinator.dispose();
});

test('successful pending-work rediscovery clears its read error even when no operations remain', async () => {
  const h = setup(), scheduled = []; let readable = false;
  h.manager.discoverPendingWorks = async () => { if (!readable) throw Object.assign(new Error('read'), { code: 'READ_FAILED' }); return []; };
  const coordinator = require('../../reader/highlightSyncCoordinator').createHighlightSyncCoordinator({ manager: h.manager,
    transport: { commit() { throw Error('No outgoing operation'); }, listen() { return () => {}; } }, resolveCanonical: () => canonical,
    schedule(fn) { scheduled.push(fn); return fn; }, cancelSchedule() {} });
  await coordinator.setOwner('alice'); readable = true; scheduled[0](); await tick(); await coordinator.flush();
  assert.equal(coordinator.getSnapshot().error, null); coordinator.dispose();
});

test('foreground recovery keeps conflict, capacity and validation failures blocked without polling', async () => {
  for (const code of ['SYNC_CONFLICT', 'SYNC_COUNT_LIMIT', 'invalid-argument']) {
    const h = harness(undefined, { async commit(operation) { h.calls.push(operation); throw Object.assign(new Error(code), { code }); } });
    await h.store.create(ref(), 'yellow'); await h.coordinator.setOwner('alice'); await h.coordinator.flush();
    await h.coordinator.foreground(); await h.coordinator.foreground();
    assert.equal(h.calls.length, 1, code); assert.equal(h.scheduled.length, 0, code);
    assert.equal(h.store.pendingOperations().length, 0, code); h.coordinator.dispose();
  }
});

test('pending-work discovery retry cannot attach or submit for a retired owner generation', async () => {
  const h = setup(), scheduled = [], calls = [], gate = deferred(); let reads = 0;
  await h.store.create(ref(), 'yellow');
  const discover = h.manager.discoverPendingWorks;
  h.manager.discoverPendingWorks = async (uid, options) => { if (uid === 'alice' && ++reads === 1) throw Object.assign(new Error('read'), { code: 'READ_FAILED' }); if (uid === 'alice') await gate.promise; return discover(uid, options); };
  const coordinator = require('../../reader/highlightSyncCoordinator').createHighlightSyncCoordinator({ manager: h.manager,
    transport: { async commit(value) { calls.push(value.uid); return accepted(value); }, listen() { return () => {}; } }, resolveCanonical: () => canonical,
    schedule(fn) { scheduled.push(fn); return fn; }, cancelSchedule() {} });
  await coordinator.setOwner('alice'); assert.equal(scheduled.length, 1);
  scheduled[0](); await tick(); await coordinator.setOwner('bob'); gate.resolve(); await tick(); await coordinator.flush();
  assert.deepEqual(calls, []); assert.equal(coordinator.getSnapshot().uid, 'bob'); coordinator.dispose();
});

test('a late cancelled retry cannot remove the current owner backoff', async () => {
  const h = harness(undefined, { async commit(operation) { h.calls.push(operation); throw Object.assign(new Error('offline'), { code: 'unavailable' }); } });
  await h.store.create(ref(), 'yellow'); const bob = h.manager.forWork({ uid: 'bob', canonical }); await bob.create(ref(), 'blue');
  await h.coordinator.setOwner('alice'); await tick(); assert.equal(h.scheduled.length, 1); const old = h.scheduled[0];
  await h.coordinator.setOwner('bob'); await tick(); assert.equal(h.scheduled.length, 2); assert.equal(old.cancelled, true);
  old.fn(); await h.coordinator.openWork(canonical); await tick();
  assert.equal(h.calls.filter(operation => operation.uid === 'bob').length, 1, 'old callback must preserve the new owner scheduled backoff');
  assert.equal(h.scheduled.length, 2); h.coordinator.dispose();
});

for (const code of ['permission-denied', 'unauthenticated']) {
  test('a fresh owner session retries durable ' + code + ' operations once without polling', async () => {
    const original = setup(); await original.store.create(ref(), 'yellow'); const operation = original.store.pendingOperations()[0];
    await original.store.syncFailed(operation.operationId, { code });
    const h = harness(setup(Object.fromEntries(original.data)));
    await h.coordinator.setOwner('alice'); await h.coordinator.flush();
    assert.equal(h.calls.length, 1); assert.equal(h.calls[0].operationId, operation.operationId);
    assert.equal(h.store.getSnapshot().syncSummary.synced, 1); assert.equal(h.scheduled.length, 0); h.coordinator.dispose();
  });
}

test('foreground retries access failures once per event and coalesces simultaneous events', async () => {
  const h = harness(); let allowed = false;
  h.transport.commit = async operation => { h.calls.push(operation); if (!allowed) throw Object.assign(new Error('denied'), { code: 'permission-denied' }); return accepted(operation); };
  await h.store.create(ref(), 'yellow'); const operation = h.store.pendingOperations()[0];
  await h.coordinator.setOwner('alice'); await h.coordinator.flush();
  await Promise.all([h.coordinator.foreground(), h.coordinator.foreground()]); await tick();
  assert.equal(h.calls.length, 2, 'one foreground event does not loop on denied access'); assert.equal(h.scheduled.length, 0);
  allowed = true; await h.coordinator.foreground();
  assert.equal(h.calls.length, 3); assert.ok(h.calls.every(value => value.operationId === operation.operationId));
  assert.equal(h.store.getSnapshot().syncSummary.synced, 1); h.coordinator.dispose();
});

test('automatic foreground never replays a failed local edit or raw retirement intent', async () => {
  const h = harness(); await h.coordinator.setOwner('alice'); await h.coordinator.openWork(canonical);
  const created = await h.store.create(ref(), 'yellow'); await h.coordinator.flush();
  const rawKey = '@bard-test/client-a/legacy/alice/hamlet/broken'; h.data.set(rawKey, 'bad');
  const set = h.storage.setItem; h.storage.setItem = async () => { throw new Error('disk'); };
  await assert.rejects(h.store.recolor(created.record.id, 'blue'), { code: 'WRITE_FAILED' });
  h.storage.setItem = set; const before = [...h.data.entries()]; await h.coordinator.foreground();
  assert.deepEqual([...h.data.entries()], before); assert.equal(h.store.getSnapshot().records[0].colorId, 'yellow');
  assert.equal(h.store.getSnapshot().writeBlocked, true); assert.equal(h.calls.length, 1);
  h.store.abandonPendingIntent(); await h.store.refreshReadOnly();
  h.storage.setItem = async () => { throw new Error('disk'); };
  await assert.rejects(h.manager.retireRawEntry({ uid: 'alice', workKey: 'hamlet', key: rawKey, raw: 'bad' }), { code: 'WRITE_FAILED' });
  h.storage.setItem = set; const rawBefore = [...h.data.entries()]; await h.coordinator.foreground();
  assert.deepEqual([...h.data.entries()], rawBefore); assert.equal(h.data.get(rawKey), 'bad');
  assert.equal(h.store.getSnapshot().writeBlocked, true); h.coordinator.dispose();
});

test('a failed local save cannot be submitted automatically or starve another retained work', async () => {
  const h = setup(), { buildCanonicalDocument, createSelection } = require('../../shared/contentText');
  const tempest = buildCanonicalDocument({ play: { id: 'tempest', contentVersion: 'b'.repeat(64), canonicalTextVersion: '1', sections: [{ id: 's' }] },
    sections: [{ work: { id: 'tempest' }, contentVersion: 'b'.repeat(64), canonicalTextVersion: '1', section: { id: 's' }, content: [{ id: 't', text: 'Another play', separatorAfter: '' }] }] });
  const second = h.manager.forWork({ uid: 'alice', canonical: tempest }), calls = [];
  const made = await h.store.create(ref(), 'yellow');
  const set = h.storage.setItem; h.storage.setItem = async () => { throw Error('disk'); };
  await assert.rejects(h.store.recolor(made.record.id, 'blue'), { code: 'WRITE_FAILED' }); h.storage.setItem = set;
  await second.create(createSelection(tempest, 0, 7), 'blue');
  const coordinator = require('../../reader/highlightSyncCoordinator').createHighlightSyncCoordinator({ manager: h.manager,
    transport: { async commit(operation) { calls.push(operation.workId); return accepted(operation); }, listen() { return () => {}; } },
    resolveCanonical: id => id === 'hamlet' ? canonical : tempest });
  let publications = 0;
  const unsubscribe = coordinator.subscribe(() => { if (++publications === 100) coordinator.dispose(); });
  await coordinator.setOwner('alice'); await coordinator.flush(); await coordinator.foreground(); await coordinator.flush();
  await tick();
  assert.deepEqual(calls, ['tempest']); assert.equal(second.getSnapshot().syncSummary.synced, 1);
  assert.equal(h.store.getSnapshot().records[0].colorId, 'yellow'); assert.equal(h.store.getSnapshot().writeBlocked, true);
  assert.ok(publications < 100, 'only blocked durable operations must not cause zero-progress drain loops');
  unsubscribe(); coordinator.dispose();
});
