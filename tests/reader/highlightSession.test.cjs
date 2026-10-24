const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createSelection } = require('../../shared/contentText');

const identity = { documentId: 'session-doc', workId: 'hamlet', contentVersion: 'v1', canonicalTextVersion: '1' };
const canonical = { workId: 'hamlet', contentVersion: 'v1', canonicalTextVersion: '1', text: 'Alpha beta gamma',
  units: [{ id: 'a', sectionId: 's', start: 0, textEnd: 16, end: 16 }], sections: [{ id: 's', start: 0, end: 16 }] };
const reference = () => { const value = createSelection(canonical, 0, 5); Object.freeze(value.startRef); Object.freeze(value.endRef); return Object.freeze(value); };
const snapshot = () => Object.freeze({ documentId: identity.documentId, captureToken: 'capture-1', selectionSeq: 1, selection: reference() });
const record = (uid = 'a', id = 'one') => Object.freeze({ schemaVersion: 1, id, owner: Object.freeze({ kind: 'account', uid }), workId: 'hamlet', selectionRef: reference(), colorId: 'yellow', revision: 1, createdAt: 1, updatedAt: 1 });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const rejection = code => Object.assign(new Error(code), { code });

test('sync errors remain separate from local readiness and are cleared across owner generations', async () => {
  const h = host(); await h.activate('a');
  h.storeFor('a').update({ syncById: { one: { status: 'failed' } }, syncSummary: { pending: 1, failed: 1, deleted: 1 } });
  assert.equal(h.session.getSnapshot().syncById.one.status, 'failed');
  assert.equal(h.session.getSnapshot().enabled, true);
  assert.equal(h.session.getSnapshot().error, null);
  await h.session.setOwner('b');
  assert.deepEqual(h.session.getSnapshot().syncById, {});
  assert.equal(h.session.getSnapshot().syncSummary, null);
  h.session.dispose();
});

// Store and native surface are the session's boundaries. The fake store models
// the real shared per-work queue and confirmed-state subscription contract.
function host({ deferPaint = false, seeds = {}, hydrateFailure = null } = {}) {
  const file = path.resolve(__dirname, '../../reader/readerHighlightSession.js');
  assert.ok(fs.existsSync(file), 'the highlight ownership session exists');
  const calls = [], paints = [], shows = [], stores = new Map(), notices = [];
  function storeFor(uid) {
    if (stores.has(uid)) return stores.get(uid);
    let value = { hydrated: false, loading: false, saving: false, records: seeds[uid] || [], unresolved: [], unreadable: [], conflicts: [], error: null };
    const listeners = new Set(), retiredListeners = [];
    let tail = Promise.resolve(), nextId = 0, failure = hydrateFailure;
    const queue = task => { const pending = tail.then(task); tail = pending.catch(() => {}); return pending; };
    const update = change => { value = { ...value, ...change }; for (const listener of listeners) listener(); };
    const store = {
      writes: [], hydrations: 0, retiredListeners,
      getSnapshot: () => value,
      subscribe(listener) { listeners.add(listener); retiredListeners.push(listener); return () => listeners.delete(listener); },
      update,
      hydrate() { return queue(async () => { store.hydrations++; calls.push('hydrate:' + uid); update({ loading: true });
        if (failure) { update({ error: failure, loading: false }); throw failure; }
        update({ hydrated: true, loading: false }); return value;
      }); },
      retry() { failure = null; update({ error: null }); return store.hydrate(); },
      flush: () => tail,
      create(selectionRef, colorId, options) { return queue(async () => {
        if (!options.isCurrent()) throw rejection('CANCELLED');
        update({ saving: true }); const pending = deferred(); store.writes.push({ pending, selectionRef, colorId, uid });
        const item = Object.freeze({ ...record(uid, 'created-' + ++nextId), selectionRef, colorId });
        try { await pending.promise; update({ records: [...value.records, item], saving: false }); return { kind: 'created', record: item }; }
        catch (error) { update({ error, saving: false }); throw error; }
      }); },
      recolor(id, colorId, options) { return queue(async () => {
        if (!options.isCurrent()) throw rejection('CANCELLED');
        calls.push('recolor:' + uid); const found = value.records.find(item => item.id === id);
        const item = Object.freeze({ ...found, colorId, revision: found.revision + 1 });
        update({ records: value.records.map(value => value.id === id ? item : value) }); return item;
      }); },
      remove(id, options) { return queue(async () => {
        if (!options.isCurrent()) throw rejection('CANCELLED');
        calls.push('remove:' + uid); update({ records: value.records.filter(value => value.id !== id), unreadable: value.unreadable.filter(value => value.id !== id), unresolved: value.unresolved.filter(value => value.record.id !== id) });
      }); },
    };
    stores.set(uid, store); return store;
  }
  const manager = { forWork({ uid, canonical: source }) { assert.equal(source, canonical); calls.push('store:' + uid); return storeFor(uid); } };
  const surface = { applyHighlights(records, ownerGeneration) {
    const pending = deferred(); paints.push({ records, ownerGeneration, pending }); calls.push('paint:' + records.length);
    return deferPaint ? pending.promise : Promise.resolve({ status: 'applied', ownerGeneration });
  }, showHighlight(value, ownerGeneration) { const pending = deferred(); shows.push({ value, ownerGeneration, pending }); return pending.promise; } };
  const session = require(file).createReaderHighlightSession({ manager, document: { identity, canonical }, surface: () => surface });
  session.subscribe(() => notices.push(session.getSnapshot()));
  return { session, calls, paints, shows, stores, storeFor, notices, surface,
    async activate(uid = 'a') { session.setOwner(uid); await session.setReady(true); await tick(); return session.getSnapshot(); } };
}

test('an acknowledged empty paint precedes account hydration and a missing UID reads without guest storage', async () => {
  const h = host({ deferPaint: true });
  const initial = h.session.getSnapshot(); assert.ok(initial.scope.ownerGeneration > 0); assert.equal(initial.enabled, false);
  h.session.setOwner('a'); assert.deepEqual(h.calls, []);
  const ready = h.session.setReady(true);
  assert.deepEqual(h.calls, ['paint:0']); assert.equal(h.session.getSnapshot().privacyReady, false);
  h.paints[0].pending.resolve({ status: 'applied' }); await tick();
  assert.ok(h.calls.includes('hydrate:a')); assert.equal(h.session.getSnapshot().privacyReady, true);
  h.paints.at(-1).pending.resolve({ status: 'applied' }); await ready;
  assert.equal(h.session.getSnapshot().enabled, true);
  const signedOut = h.session.setOwner(null); assert.deepEqual(h.session.getSnapshot().records, []);
  assert.equal(h.session.getSnapshot().privacyReady, false); h.paints.at(-1).pending.resolve({ status: 'applied' }); await signedOut;
  assert.equal(h.session.getSnapshot().privacyReady, true); assert.equal(h.session.getSnapshot().enabled, false);
  assert.ok(!h.calls.includes('store:null')); h.session.dispose();
});

test('owner transitions clear counts immediately and ignore old paint acknowledgements and store callbacks', async () => {
  const h = host({ deferPaint: true, seeds: { a: [record('a')] } });
  h.session.setOwner('a'); const first = h.session.setReady(true);
  h.paints[0].pending.resolve({}); await tick(); assert.equal(h.session.getSnapshot().records.length, 1);
  const oldPaint = h.paints.at(-1), oldScope = h.session.getSnapshot().scope, oldStore = h.storeFor('a');
  const switched = h.session.setOwner('b');
  assert.deepEqual(h.session.getSnapshot().records, []); assert.deepEqual(h.session.getSnapshot().unresolved, []);
  assert.equal(h.session.getSnapshot().privacyReady, false); assert.ok(h.session.getSnapshot().scope.ownerGeneration > oldScope.ownerGeneration);
  for (const callback of oldStore.retiredListeners) callback(); oldPaint.pending.resolve({}); await tick();
  assert.deepEqual(h.session.getSnapshot().records, []); assert.equal(h.session.getSnapshot().privacyReady, false);
  h.paints.at(-1).pending.resolve({}); await tick(); h.paints.at(-1).pending.resolve({}); await switched; await first;
  assert.equal(h.session.getSnapshot().scope.uid, 'b'); assert.deepEqual(h.session.getSnapshot().records, []); h.session.dispose();
});

test('ready=false defers clearing and invalidates pending callbacks before the next ready acknowledgement', async () => {
  const h = host({ deferPaint: true }); h.session.setOwner('a'); h.session.setReady(true);
  const oldPaint = h.paints[0]; h.session.setReady(false); const previous = h.paints.length;
  h.session.setOwner('b'); assert.equal(h.paints.length, previous);
  oldPaint.pending.resolve({}); await tick(); assert.equal(h.session.getSnapshot().privacyReady, false); assert.deepEqual(h.stores.size, 0);
  const ready = h.session.setReady(true); h.paints.at(-1).pending.resolve({}); await tick(); h.paints.at(-1).pending.resolve({}); await ready;
  assert.equal(h.session.getSnapshot().scope.uid, 'b'); assert.equal(h.session.getSnapshot().enabled, true); h.session.dispose();
});

test('create preserves the full canonical reference and paints only persistence-confirmed records', async () => {
  const h = host(); await h.activate(); const scope = h.session.getSnapshot().scope;
  const captured = snapshot(), pending = h.session.create(captured, 'sage', scope); await tick();
  assert.equal(h.storeFor('a').writes.length, 1); assert.equal(h.storeFor('a').writes[0].selectionRef, captured.selection);
  assert.deepEqual(h.session.getSnapshot().records, []); assert.ok(h.paints.every(paint => paint.records.length === 0));
  h.storeFor('a').writes[0].pending.resolve(); const saved = await pending; await tick();
  assert.equal(saved.kind, 'created'); assert.equal(h.session.getSnapshot().records.length, 1);
  const paint = h.paints.at(-1); assert.deepEqual(paint.records, [{ id: saved.record.id, colorId: 'sage', selectionRef: captured.selection }]);
  assert.equal(paint.ownerGeneration, scope.ownerGeneration); h.session.dispose();
});

test('stale scopes, document mismatches, and altered canonical references cannot create or mutate', async () => {
  const h = host({ seeds: { a: [record()] } }); await h.activate(); const scope = h.session.getSnapshot().scope;
  const old = { ...scope, ownerGeneration: scope.ownerGeneration - 1 };
  for (const operation of [() => h.session.create(snapshot(), 'yellow', old), () => h.session.recolor('one', 'blue', old), () => h.session.remove('one', old), () => h.session.show(record(), old)]) await assert.rejects(operation(), { code: 'CANCELLED' });
  await assert.rejects(h.session.create({ ...snapshot(), documentId: 'other' }, 'yellow', scope));
  await assert.rejects(h.session.create({ ...snapshot(), selection: { ...reference(), exact: 'Wrong' } }, 'yellow', scope));
  assert.equal(h.storeFor('a').writes.length, 0); h.session.dispose();
});

test('A→B→A hydration queues behind the first A write and its obsolete result cannot leak into B', async () => {
  const h = host(); await h.activate('a'); const firstScope = h.session.getSnapshot().scope;
  const writing = h.session.create(snapshot(), 'blue', firstScope); const rejected = assert.rejects(writing, { code: 'CANCELLED' }); await tick();
  const originalStore = h.storeFor('a'); await h.session.setOwner('b');
  assert.deepEqual(h.session.getSnapshot().records, []);
  const back = h.session.setOwner('a'); await tick(); assert.equal(h.session.getSnapshot().hydrated, false);
  assert.deepEqual(h.session.getSnapshot().records, []); assert.equal(originalStore.hydrations, 1);
  originalStore.writes[0].pending.resolve(); await rejected; await back;
  assert.equal(h.session.getSnapshot().records.length, 1); assert.equal(originalStore.hydrations, 2);
  assert.ok(h.session.getSnapshot().scope.ownerGeneration > firstScope.ownerGeneration); h.session.dispose();
});

test('queued obsolete mutations are cancelled before their storage action starts', async () => {
  const h = host({ seeds: { a: [record()] } }); await h.activate('a'); const scope = h.session.getSnapshot().scope;
  const creating = h.session.create(snapshot(), 'blue', scope); const createdRejection = assert.rejects(creating, { code: 'CANCELLED' });
  // Both intents are submitted while the scope is current; the second waits on
  // the same store queue and must check isCurrent again before touching storage.
  const removing = h.session.remove('one', scope); const removedRejection = assert.rejects(removing, { code: 'CANCELLED' }); await tick();
  await h.session.setOwner('b'); h.storeFor('a').writes[0].pending.resolve();
  await createdRejection; await removedRejection; assert.ok(!h.calls.includes('remove:a')); h.session.dispose();
});

test('hydration failure disables mutations until explicit retry reconciles storage', async () => {
  const error = rejection('STORAGE_READ_FAILED'), h = host({ hydrateFailure: error }); await h.activate();
  assert.equal(h.session.getSnapshot().error, error); assert.equal(h.session.getSnapshot().enabled, false);
  await assert.rejects(h.session.create(snapshot(), 'yellow', h.session.getSnapshot().scope)); assert.equal(h.storeFor('a').writes.length, 0);
  await h.session.retry(); assert.equal(h.session.getSnapshot().error, null); assert.equal(h.session.getSnapshot().enabled, true); h.session.dispose();
});

test('unresolved, unreadable, and conflicting saved records remain visible as metadata but never paint', async () => {
  const h = host({ seeds: { a: [record('a', 'first'), record('a', 'conflict')] } }); await h.activate();
  const unresolved = [{ record: record('a', 'old-version'), code: 'CONTENT_VERSION_MISMATCH' }], unreadable = [{ id: 'broken', code: 'INVALID_HIGHLIGHT' }];
  h.storeFor('a').update({ conflicts: ['conflict'], unresolved, unreadable }); await tick();
  const state = h.session.getSnapshot(); assert.equal(state.records.length, 2); assert.deepEqual(state.unresolved, unresolved); assert.deepEqual(state.unreadable, unreadable);
  assert.deepEqual(h.paints.at(-1).records.map(value => value.id), ['first']);
  await assert.rejects(h.session.show(record('a', 'conflict'), state.scope));
  await h.session.remove('broken', state.scope); assert.deepEqual(h.session.getSnapshot().unreadable, []); h.session.dispose();
});

test('paint failure retains confirmed quotations and retry repaints without replaying a storage mutation', async () => {
  const h = host({ deferPaint: true, seeds: { a: [record()] } }); h.session.setOwner('a'); const ready = h.session.setReady(true);
  h.paints[0].pending.resolve({}); await tick(); const failure = rejection('UNSUPPORTED'); h.paints.at(-1).pending.reject(failure); await ready;
  assert.equal(h.session.getSnapshot().privacyReady, true); assert.equal(h.session.getSnapshot().records.length, 1); assert.equal(h.session.getSnapshot().renderError, failure);
  const retry = h.session.retry(); h.paints.at(-1).pending.resolve({}); await retry;
  assert.equal(h.session.getSnapshot().renderError, null); assert.equal(h.storeFor('a').hydrations, 1); h.session.dispose();
});

test('failed privacy clear keeps the cover until a successful retry acknowledges the current generation', async () => {
  const h = host({ deferPaint: true }); h.session.setOwner('a'); const ready = h.session.setReady(true);
  h.paints[0].pending.reject(rejection('PAINT_FAILED')); await ready;
  assert.equal(h.session.getSnapshot().privacyReady, false); assert.equal(h.stores.size, 0);
  const retry = h.session.retry(); h.paints.at(-1).pending.resolve({}); await tick(); h.paints.at(-1).pending.resolve({}); await retry;
  assert.equal(h.session.getSnapshot().privacyReady, true); assert.equal(h.session.getSnapshot().enabled, true); h.session.dispose();
});

test('Show passage forwards the exact validated saved range and retires stale asynchronous acknowledgements', async () => {
  const item = record(), h = host({ seeds: { a: [item] } }); await h.activate(); const scope = h.session.getSnapshot().scope;
  const show = h.session.show(item, scope); await tick(); assert.equal(h.shows.length, 1);
  assert.deepEqual(h.shows[0].value, { id: item.id, colorId: item.colorId, selectionRef: item.selectionRef });
  assert.equal(h.shows[0].ownerGeneration, scope.ownerGeneration);
  await h.session.setOwner('b'); h.shows[0].pending.resolve({ status: 'applied' }); await assert.rejects(show, { code: 'CANCELLED' }); h.session.dispose();
});

test('dispose clears visible state without issuing a late lower-generation paint clear', async () => {
  const h = host({ seeds: { a: [record()] } }); await h.activate(); const paints = h.paints.length;
  h.session.dispose(); assert.deepEqual(h.session.getSnapshot().records, []); assert.equal(h.session.getSnapshot().enabled, false);
  assert.equal(h.paints.length, paints); h.storeFor('a').update({ records: [record()] });
  assert.deepEqual(h.session.getSnapshot().records, []); await assert.rejects(h.session.create(snapshot(), 'yellow', h.session.getSnapshot().scope));
  const second = host(); assert.ok(second.session.getSnapshot().scope.ownerGeneration > h.session.getSnapshot().scope.ownerGeneration); second.session.dispose();
});

test('unsupported CSS painting leaves reading and retained lists available while disabling paint mutations', async () => {
  const h = host({ deferPaint: true, seeds: { a: [record()] } }); h.session.setOwner('a'); const ready = h.session.setReady(true);
  const unsupported = rejection('UNSUPPORTED'); h.paints[0].pending.reject(unsupported); await tick();
  if (h.paints.length > 1) h.paints.at(-1).pending.reject(unsupported);
  await ready;
  const state = h.session.getSnapshot();
  assert.equal(state.privacyReady, true, 'an engine with no CSS paint support cannot conceal old application paint');
  assert.equal(state.records.length, 1); assert.equal(state.renderError.code, 'UNSUPPORTED'); assert.equal(state.enabled, false);
  await assert.rejects(h.session.create(snapshot(), 'yellow', state.scope));
  await assert.rejects(h.session.recolor('one', 'blue', state.scope));
  await h.session.remove('one', state.scope); assert.deepEqual(h.session.getSnapshot().records, []); h.session.dispose();
});

function integration() {
  const data = new Map(), calls = [], paints = [];
  let writeGate = null, rejectWrite = false;
  const storage = {
    async getAllKeys() { calls.push(['keys']); return [...data.keys()]; },
    async getItem(key) { calls.push(['get', key]); return data.get(key) ?? null; },
    async setItem(key, value) { calls.push(['set', key]); if (writeGate) await writeGate.promise;
      if (rejectWrite) { rejectWrite = false; throw new Error('simulated write failure'); } data.set(key, value); },
    async removeItem(key) { calls.push(['remove', key]); data.delete(key); },
  };
  const manager = require('../../reader/readerHighlightStore').createHighlightStoreManager(storage, { makeId: () => 'integration-1', now: () => 10 });
  const session = require('../../reader/readerHighlightSession').createReaderHighlightSession({ manager, document: { identity, canonical }, surface: () => ({
    applyHighlights(records, ownerGeneration) { paints.push({ records, ownerGeneration }); return Promise.resolve({ status: 'applied' }); },
    showHighlight() { return Promise.resolve({ status: 'applied' }); },
  }) });
  return { session, data, calls, paints, gate(value) { writeGate = value; }, failWrite() { rejectWrite = true; }, async activate() { session.setOwner('a'); await session.setReady(true); } };
}

test('real shared manager/session A→B→A waits for the original fixed-key write without exposing its obsolete acknowledgement', async () => {
  const h = integration(); await h.activate(); const firstScope = h.session.getSnapshot().scope, gate = deferred(); h.gate(gate);
  const creating = h.session.create(snapshot(), 'sage', firstScope), obsolete = assert.rejects(creating, { code: 'CANCELLED' });
  await tick(); assert.equal(h.calls.filter(value => value[0] === 'set').length, 1);
  await h.session.setOwner('b'); assert.deepEqual(h.session.getSnapshot().records, []);
  const back = h.session.setOwner('a'); await tick(); assert.equal(h.session.getSnapshot().hydrated, false); assert.deepEqual(h.session.getSnapshot().records, []);
  gate.resolve(); await obsolete; await back;
  assert.equal(h.data.size, 1); assert.ok([...h.data.keys()][0].includes('/a/hamlet/'));
  const state = h.session.getSnapshot(); assert.equal(state.records[0].colorId, 'sage'); assert.ok(state.scope.ownerGeneration > firstScope.ownerGeneration);
  assert.ok(h.paints.filter(paint => paint.ownerGeneration > firstScope.ownerGeneration && paint.records.length).every(paint => paint.ownerGeneration === state.scope.ownerGeneration));
  h.session.dispose();
});

test('real store retry reconciles and returns its successful original mutation result with no stale retry scope', async () => {
  const h = integration(); await h.activate(); const scope = h.session.getSnapshot().scope; h.failWrite();
  await assert.rejects(h.session.create(snapshot(), 'rose', scope), { code: 'WRITE_FAILED' });
  assert.equal(h.session.getSnapshot().records.length, 0); assert.equal(h.session.getSnapshot().error.code, 'WRITE_FAILED');
  const result = await h.session.retry(scope);
  assert.equal(result.kind, 'created'); assert.equal(result.record.id, 'integration-1'); assert.equal(h.session.getSnapshot().records.length, 1);
  assert.equal(h.session.getSnapshot().error, null); assert.equal(h.data.size, 1);
  await h.session.setOwner('b'); const before = h.calls.length;
  await assert.rejects(h.session.retry(scope), { code: 'CANCELLED' }); assert.equal(h.calls.length, before); h.session.dispose();
});

test('returning A can reconcile a retired failed A intent without replaying it or reporting a false retry failure', async () => {
  const h = integration(); await h.activate(); const gate = deferred(); h.gate(gate); h.failWrite();
  const writing = h.session.create(snapshot(), 'sage', h.session.getSnapshot().scope), obsolete = assert.rejects(writing, { code: 'CANCELLED' });
  await tick(); await h.session.setOwner('b');
  const back = h.session.setOwner('a'); gate.resolve(); await obsolete; await back;
  assert.ok(h.session.getSnapshot().error); const writeCount = h.calls.filter(call => call[0] === 'set').length;
  await h.session.retry(h.session.getSnapshot().scope);
  assert.equal(h.session.getSnapshot().error, null); assert.equal(h.session.getSnapshot().enabled, true);
  assert.deepEqual(h.session.getSnapshot().records, []); assert.equal(h.data.size, 0);
  assert.equal(h.calls.filter(call => call[0] === 'set').length, writeCount); h.session.dispose();
});

test('cancelling a failed create abandons only its replay intent and a later Retry performs no new write', async () => {
  const h = integration(); await h.activate(); const scope = h.session.getSnapshot().scope; h.failWrite();
  await assert.rejects(h.session.create(snapshot(), 'rose', scope), { code: 'WRITE_FAILED' });
  const beforeCancel = h.calls.length, writes = h.calls.filter(call => call[0] === 'set').length;
  await h.session.cancelPending(scope);
  assert.equal(h.calls.length, beforeCancel, 'cancellation performs no storage IO');
  assert.equal(h.session.getSnapshot().error.code, 'WRITE_FAILED', 'the ambiguous state still requires reconciliation');
  await h.session.retry(scope);
  assert.deepEqual(h.session.getSnapshot().records, []); assert.equal(h.data.size, 0);
  assert.equal(h.calls.filter(call => call[0] === 'set').length, writes);
  assert.equal(h.session.getSnapshot().error, null); h.session.dispose();
});

test('a previous owner cannot abandon a failed save belonging to the current scope', async () => {
  const h = integration(); await h.activate(); const old = h.session.getSnapshot().scope;
  await h.session.setOwner('b'); const current = h.session.getSnapshot().scope; h.failWrite();
  await assert.rejects(h.session.create(snapshot(), 'blue', current), { code: 'WRITE_FAILED' });
  await assert.rejects(h.session.cancelPending(old), { code: 'CANCELLED' });
  const retried = await h.session.retry(current);
  assert.equal(retried.kind, 'created'); assert.equal(retried.record.owner.uid, 'b');
  assert.equal(h.session.getSnapshot().records.length, 1); h.session.dispose();
});

test('Show passage rejects immediately during paint and an eventual paint acknowledgement never dispatches that old intent', async () => {
  const item = record(), h = host({ deferPaint: true, seeds: { a: [item] } });
  h.session.setOwner('a'); const ready = h.session.setReady(true); h.paints[0].pending.resolve({}); await tick();
  const pendingPaint = h.paints.at(-1); let outcome;
  const show = h.session.show(item, h.session.getSnapshot().scope).then(() => { outcome = 'shown'; }, error => { outcome = error.code; });
  await tick();
  assert.equal(outcome, 'HIGHLIGHTS_NOT_APPLIED', 'Show cannot wait behind rendering and outlive Cancel, Contents or a new user intent');
  assert.deepEqual(h.shows, []);
  pendingPaint.pending.resolve({}); await ready; await show; await tick();
  assert.deepEqual(h.shows, [], 'later acknowledgement cannot revive the rejected Show'); h.session.dispose();
});

test('a freshly activated Show dispatches immediately once the current paint is acknowledged', async () => {
  const item = record(), h = host({ seeds: { a: [item] } }); await h.activate();
  assert.equal(h.session.getSnapshot().rendering, false);
  const show = h.session.show(item, h.session.getSnapshot().scope);
  assert.equal(h.shows.length, 1, 'there is no asynchronous wait before dispatch of the explicit current intent');
  h.shows[0].pending.resolve({ status: 'applied' }); assert.deepEqual(await show, { status: 'applied' }); h.session.dispose();
});

test('a stale acknowledgement cannot clear rendering for a newer paint in the same owner generation', async () => {
  const item = record(), h = host({ deferPaint: true, seeds: { a: [item] } });
  h.session.setOwner('a'); const ready = h.session.setReady(true); assert.equal(h.session.getSnapshot().rendering, true);
  h.paints[0].pending.resolve({}); await tick(); const older = h.paints.at(-1);
  h.storeFor('a').update({ records: [Object.freeze({ ...item, revision: 2, colorId: 'blue' })] });
  const newer = h.paints.at(-1); assert.notEqual(newer, older); assert.equal(h.session.getSnapshot().rendering, true);
  older.pending.resolve({}); await tick(); assert.equal(h.session.getSnapshot().rendering, true);
  newer.pending.resolve({}); await ready; await tick(); assert.equal(h.session.getSnapshot().rendering, false); h.session.dispose();
});
