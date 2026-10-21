const assert = require('node:assert/strict');
const test = require('node:test');
const { buildCanonicalDocument, createSelection } = require('../../shared/contentText');

const canonical = buildCanonicalDocument({ play: { id: 'hamlet', contentVersion: 'v1', canonicalTextVersion: '1', sections: [{ id: 's' }] }, sections: [{ work: { id: 'hamlet' }, contentVersion: 'v1', canonicalTextVersion: '1', section: { id: 's' }, content: [{ id: 'a', text: 'Alpha beta gamma', separatorAfter: '' }] }] });
const reference = (start = 0, end = 5) => createSelection(canonical, start, end);
const prefix = uid => '@bard/reader-highlights:v1/' + encodeURIComponent(uid) + '/hamlet/';
const key = (id, uid = 'account-a') => prefix(uid) + encodeURIComponent(id);
function record(id = 'existing', changes = {}) { return { schemaVersion: 1, id, owner: { kind: 'account', uid: 'account-a' }, workId: 'hamlet', selectionRef: reference(), colorId: 'yellow', revision: 1, createdAt: 100, updatedAt: 100, ...changes }; }
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function storageFixture(initial = {}) {
  const data = new Map(Object.entries(initial)), calls = [];
  const storage = {
    async getAllKeys() { calls.push(['keys']); return [...data.keys()]; },
    async getItem(k) { calls.push(['get', k]); return data.get(k) ?? null; },
    async setItem(k, v) { calls.push(['set', k, v]); data.set(k, v); },
    async removeItem(k) { calls.push(['remove', k]); data.delete(k); },
  };
  return { storage, data, calls };
}
function setup(initial = {}, options = {}) {
  const fixture = storageFixture(initial);
  let sequence = 0, time = 1000;
  const manager = require('../../reader/readerHighlightStore').createHighlightStoreManager(fixture.storage, { makeId: () => 'generated-' + ++sequence, now: () => time++, ...options });
  const store = manager.forWork({ uid: 'account-a', canonical });
  return { ...fixture, manager, store };
}
const writes = calls => calls.filter(c => c[0] === 'set' || c[0] === 'remove');

test('hydrates only exact account/work keys without writing empty defaults', async () => {
  const malformedKey = prefix('account-a') + 'nested/path';
  const { store, calls, data } = setup({ [key('existing')]: JSON.stringify(record()), [key('foreign', 'account-b')]: 'private', [malformedKey]: 'unrelated' });
  assert.equal(store.getSnapshot().hydrated, false);
  await store.hydrate();
  assert.deepEqual(store.getSnapshot().records.map(r => r.id), ['existing']);
  assert.deepEqual(calls.filter(c => c[0] === 'get').map(c => c[1]), [key('existing'), malformedKey]);
  const malformed = store.getSnapshot().unreadable[0];
  assert.equal(malformed.key, malformedKey);
  assert.equal(writes(calls).length, 0);
  await store.remove(malformed.id);
  assert.equal(data.has(malformedKey), false);
  assert.equal(data.has(key('foreign', 'account-b')), true);
  const empty = setup(); await empty.store.hydrate(); assert.equal(writes(empty.calls).length, 0);
});

test('create hydrates first and exposes only successfully persisted immutable full records', async () => {
  const { store, storage, calls, data } = setup();
  const gate = deferred(), original = storage.setItem;
  storage.setItem = async (...args) => { await gate.promise; return original(...args); };
  const pending = store.create(reference(), 'sage');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.getSnapshot().hydrated, true);
  assert.equal(store.getSnapshot().saving, true);
  assert.equal(store.getSnapshot().records.length, 0);
  gate.resolve(); const result = await pending;
  assert.equal(result.kind, 'created');
  assert.deepEqual(result.record, record('generated-1', { colorId: 'sage', createdAt: 1000, updatedAt: 1000 }));
  assert.equal(Object.isFrozen(result.record.selectionRef.startRef), true);
  assert.deepEqual(JSON.parse(data.get(key('generated-1'))), result.record);
  assert.equal(store.getSnapshot().records[0], result.record);
  assert.equal(store.getSnapshot().saving, false);
  assert.equal(calls[0][0], 'keys');
});

test('duplicates and unchanged color do not write; recolor preserves identity and full reference metadata', async () => {
  const original = record();
  const { store, calls } = setup({ [key(original.id)]: JSON.stringify(original) });
  const duplicate = await store.create(reference(), 'rose');
  assert.equal(duplicate.kind, 'duplicate'); assert.equal(duplicate.record.id, original.id);
  await store.recolor(original.id, 'yellow'); assert.equal(writes(calls).length, 0);
  const updated = await store.recolor(original.id, 'blue');
  assert.equal(updated.revision, 2); assert.equal(updated.createdAt, 100);
  assert.equal(updated.updatedAt, 1000); assert.deepEqual(updated.selectionRef, original.selectionRef);
  assert.equal(updated.id, original.id); assert.equal(writes(calls).length, 1);
});

test('adjacent records remain independent while partial and nested overlaps reject without writes', async () => {
  const { store, calls } = setup();
  const first = await store.create(reference(), 'yellow');
  const adjacent = await store.create(reference(5, 10), 'blue');
  for (const ref of [reference(1, 4), reference(4, 7), reference(0, 10)]) await assert.rejects(store.create(ref, 'rose'), { code: 'HIGHLIGHT_OVERLAP' });
  assert.equal(writes(calls).length, 2);
  await store.remove(first.record.id);
  assert.deepEqual(store.getSnapshot().records.map(r => r.id), [adjacent.record.id]);
});

test('retains corrupt, unknown and incompatible records, flags conflicts and removes only the chosen key', async () => {
  const old = record('old', { selectionRef: { ...reference(), contentVersion: 'old' } });
  const overlap = record('overlap', { selectionRef: reference(3, 7) });
  const initial = { [key('existing')]: JSON.stringify(record()), [key('overlap')]: JSON.stringify(overlap), [key('old')]: JSON.stringify(old), [key('corrupt')]: '{', [key('future')]: JSON.stringify({ ...record('future'), schemaVersion: 99 }) };
  const { store, data, calls } = setup(initial); await store.hydrate();
  const snapshot = store.getSnapshot();
  assert.deepEqual(snapshot.records.map(r => r.id), ['existing', 'overlap']);
  assert.deepEqual(new Set(snapshot.conflicts), new Set(['existing', 'overlap']));
  assert.equal(snapshot.unresolved[0].record.id, 'old');
  assert.deepEqual(snapshot.unreadable.map(r => r.id).sort(), ['corrupt', 'future']);
  assert.ok(snapshot.unreadable.every(r => !('record' in r)));
  assert.equal(writes(calls).length, 0);
  await store.remove('corrupt');
  assert.equal(data.has(key('corrupt')), false);
  for (const id of ['existing', 'overlap', 'old', 'future']) assert.equal(data.get(key(id)), initial[key(id)]);
});

test('discovery and single-record read failures block mutations until explicit retry', async () => {
  for (const fail of ['getAllKeys', 'getItem']) {
    const { store, storage, calls } = setup({ [key('existing')]: JSON.stringify(record()) });
    const original = storage[fail]; storage[fail] = async () => { throw new Error('offline'); };
    await assert.rejects(store.hydrate(), { code: 'READ_FAILED' });
    assert.equal(store.getSnapshot().records.length, 0);
    await assert.rejects(store.create(reference(6, 10), 'sage'), { code: 'RETRY_REQUIRED' });
    assert.equal(writes(calls).length, 0);
    storage[fail] = original; await store.retry();
    assert.deepEqual(store.getSnapshot().records.map(r => r.id), ['existing']);
    await store.create(reference(6, 10), 'sage'); assert.equal(writes(calls).length, 1);
  }
});

test('failed writes retain confirmed state and retry reconciles before replaying the same stable id', async () => {
  for (const ambiguous of [false, true]) {
    const { store, storage, calls, data } = setup();
    const original = storage.setItem;
    storage.setItem = async (k, v) => { calls.push(['attempt', k, v]); if (ambiguous) data.set(k, v); throw new Error('write rejected'); };
    await assert.rejects(store.create(reference(), 'rose'), { code: 'WRITE_FAILED' });
    assert.equal(store.getSnapshot().records.length, 0);
    await assert.rejects(store.create(reference(6, 10), 'sage'), { code: 'RETRY_REQUIRED' });
    storage.setItem = original;
    const before = calls.length; const result = await store.retry();
    assert.equal(result.record.id, 'generated-1');
    assert.equal(store.getSnapshot().records.length, 1);
    assert.ok(calls.slice(before).some(c => c[0] === 'keys'));
    assert.equal(writes(calls).length, ambiguous ? 0 : 1);
    assert.equal(data.size, 1);
  }
});

test('failed recolor and remove retain old confirmation and support idempotent ambiguous retry', async () => {
  for (const operation of ['recolor', 'remove']) {
    const { store, storage, data } = setup({ [key('existing')]: JSON.stringify(record()) });
    await store.hydrate();
    const method = operation === 'remove' ? 'removeItem' : 'setItem', original = storage[method];
    storage[method] = async (...args) => { await original(...args); throw new Error('ack lost'); };
    await assert.rejects(operation === 'remove' ? store.remove('existing') : store.recolor('existing', 'blue'), { code: 'WRITE_FAILED' });
    assert.equal(store.getSnapshot().records[0].colorId, 'yellow');
    storage[method] = async () => { throw new Error('retry must not repeat completed IO'); };
    await store.retry();
    assert.equal(store.getSnapshot().records.length, operation === 'remove' ? 0 : 1);
    if (operation === 'recolor') assert.equal(JSON.parse(data.get(key('existing'))).colorId, 'blue');
  }
});

test('A to B to A waits for the original account queue and obsolete queued actions perform no IO', async () => {
  const { manager, store, storage, calls, data } = setup();
  await store.hydrate();
  const gate = deferred(), original = storage.setItem;
  storage.setItem = async (...args) => { await gate.promise; return original(...args); };
  let current = true;
  const writing = store.create(reference(), 'yellow', { isCurrent: () => current });
  await new Promise(resolve => setImmediate(resolve));
  const obsolete = store.create(reference(6, 10), 'blue', { isCurrent: () => current });
  const cancelled = assert.rejects(obsolete, { code: 'CANCELLED' });
  current = false;
  const b = manager.forWork({ uid: 'account-b', canonical }); await b.hydrate();
  assert.equal(b.getSnapshot().records.length, 0);
  const returned = manager.forWork({ uid: 'account-a', canonical });
  assert.equal(returned, store);
  let hydrated = false; const hydration = returned.hydrate().then(() => { hydrated = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(hydrated, false);
  gate.resolve(); await writing; await cancelled; await hydration;
  assert.deepEqual(returned.getSnapshot().records.map(r => r.id), ['generated-1']);
  assert.equal(data.size, 1); assert.equal(writes(calls).length, 1);
  assert.equal(writes(calls)[0][1], key('generated-1'));
});

test('subscriptions share confirmed ordering across readers and queue survives unsubscribe', async () => {
  const { manager, store } = setup();
  const other = manager.forWork({ uid: 'account-a', canonical }); assert.equal(other, store);
  let updates = 0; const unsubscribe = store.subscribe(() => updates++);
  const first = store.create(reference(), 'yellow'), second = other.create(reference(6, 10), 'blue');
  unsubscribe(); await Promise.all([first, second]); await store.flush();
  assert.equal(store.getSnapshot().records.length, 2);
  assert.ok(updates <= 1);
});

test('capacity includes retained unreadable records and UTF-8 work bytes without evicting anything', async () => {
  const countInitial = Object.fromEntries(Array.from({ length: 200 }, (_, n) => [key('broken-' + n), '{']));
  const counted = setup(countInitial);
  await assert.rejects(counted.store.create(reference(), 'yellow'), { code: 'HIGHLIGHT_COUNT_LIMIT' });
  assert.equal(counted.data.size, 200); assert.equal(writes(counted.calls).length, 0);
  const bytes = setup({ [key('large-one')]: '界'.repeat(90000), [key('large-two')]: '界'.repeat(90000) });
  await assert.rejects(bytes.store.create(reference(), 'yellow'), { code: 'WORK_TOO_LARGE' });
  assert.equal(bytes.data.size, 2); assert.equal(writes(bytes.calls).length, 0);
});

test('collision-checked ids and invalid references never overwrite an existing record', async () => {
  let id = 0;
  const { store, calls, data } = setup({ [key('existing')]: JSON.stringify(record()) }, { makeId: () => ++id === 1 ? 'existing' : 'unique' });
  await assert.rejects(store.create({ ...reference(), exact: 'forged' }, 'yellow'));
  const created = await store.create(reference(6, 10), 'blue'); assert.equal(created.record.id, 'unique');
  assert.equal(JSON.parse(data.get(key('existing'))).colorId, 'yellow');
  assert.equal(writes(calls).length, 1);
});

test('malformed key identities remain individually removable without aliasing a valid entry', async () => {
  const alias = prefix('account-a') + '%65xisting';
  const long = prefix('account-a') + 'x'.repeat(140);
  const { store, data } = setup({ [key('existing')]: JSON.stringify(record()), [alias]: '{', [long]: '{' });
  await store.hydrate();
  assert.equal(store.getSnapshot().unreadable.length, 2);
  assert.ok(store.getSnapshot().unreadable.every(item => item.id !== 'existing'));
  const longEntry = store.getSnapshot().unreadable.find(item => item.key === long);
  await store.remove(longEntry.id);
  assert.equal(data.has(long), false);
  assert.equal(data.has(alias), true);
  await store.remove('existing');
  assert.equal(data.has(key('existing')), false);
  assert.equal(data.has(alias), true);
});

test('retry read failures retain both last confirmation and the original failed intent', async () => {
  const { store, storage } = setup({ [key('existing')]: JSON.stringify(record()) });
  await store.hydrate();
  const set = storage.setItem, get = storage.getItem;
  storage.setItem = async () => { throw new Error('cannot write'); };
  await assert.rejects(store.recolor('existing', 'blue'), { code: 'WRITE_FAILED' });
  storage.getItem = async () => { throw new Error('cannot read'); };
  await assert.rejects(store.retry(), { code: 'READ_FAILED' });
  assert.equal(store.getSnapshot().records[0].colorId, 'yellow');
  storage.getItem = get; storage.setItem = set;
  const result = await store.retry();
  assert.equal(result.colorId, 'blue'); assert.equal(result.revision, 2);
});

test('retry cancels an obsolete failed intent after reconciling storage without writing', async () => {
  const { store, storage, calls } = setup();
  let current = true;
  const original = storage.setItem;
  storage.setItem = async () => { throw new Error('offline'); };
  await assert.rejects(store.create(reference(), 'rose', { isCurrent: () => current }), { code: 'WRITE_FAILED' });
  current = false; storage.setItem = original;
  await assert.rejects(store.retry(), { code: 'CANCELLED' });
  assert.equal(store.getSnapshot().error, null);
  assert.equal(writes(calls).length, 0);
  const next = await store.create(reference(), 'sage');
  assert.equal(next.record.id, 'generated-2');
});

test('a fresh manager reloads full persisted references and another content version stays unresolved', async () => {
  const { store, storage, calls } = setup();
  const first = await store.create(reference(), 'yellow');
  await store.create(reference(6, 10), 'sage');
  await store.recolor(first.record.id, 'blue');
  const expected = store.getSnapshot().records;
  const { createHighlightStoreManager } = require('../../reader/readerHighlightStore');
  const manager = createHighlightStoreManager(storage);
  const reloaded = manager.forWork({ uid: 'account-a', canonical });
  const before = writes(calls).length;
  await reloaded.hydrate();
  assert.deepEqual(reloaded.getSnapshot().records, expected);
  const nextEdition = manager.forWork({ uid: 'account-a', canonical: { ...canonical, contentVersion: 'v2' } });
  await nextEdition.hydrate();
  assert.equal(nextEdition.getSnapshot().records.length, 0);
  assert.deepEqual(nextEdition.getSnapshot().unresolved.map(item => item.record), expected);
  assert.ok(nextEdition.getSnapshot().unresolved.every(item => item.code === 'CONTENT_VERSION_MISMATCH'));
  assert.equal(writes(calls).length, before);
});

test('missing storage fails explicitly without inventing empty confirmed data', async () => {
  const { createHighlightStoreManager } = require('../../reader/readerHighlightStore');
  const store = createHighlightStoreManager(null).forWork({ uid: 'account-a', canonical });
  await assert.rejects(store.hydrate(), { code: 'STORAGE_UNAVAILABLE' });
  assert.equal(store.getSnapshot().hydrated, false);
  assert.equal(store.getSnapshot().error.code, 'STORAGE_UNAVAILABLE');
  await assert.rejects(store.create(reference(), 'yellow'), { code: 'RETRY_REQUIRED' });
});

test('over-capacity hydration exposes only unavailable metadata and exact removals refill readable records', async () => {
  const initial = { [key('existing')]: JSON.stringify(record()), ...Object.fromEntries(Array.from({ length: 200 }, (_, i) => [key('broken-' + i), '{'])) };
  const { store, data } = setup(initial);
  await store.hydrate();
  assert.equal(store.getSnapshot().records.length, 0, 'unknown discarded ranges cannot introduce a paint winner');
  assert.equal(store.getSnapshot().unreadable.length, 201);
  assert.ok(store.getSnapshot().unreadable.every(item => item.code === 'HIGHLIGHT_COUNT_LIMIT' && Number.isSafeInteger(item.bytes)));
  const kept = store.getSnapshot().unreadable.find(item => item.id === 'existing');
  assert.equal(kept.bytes, Buffer.byteLength(initial[key('existing')], 'utf8'));
  await store.remove('broken-0');
  assert.equal(data.size, 200);
  assert.deepEqual(store.getSnapshot().records.map(item => item.id), ['existing']);
});

test('oversized raw records retain byte metadata and count toward the work limit without a paint subset', async () => {
  const big = '界'.repeat(180000);
  const { store, data } = setup({ [key('existing')]: JSON.stringify(record()), [key('oversized')]: big });
  await store.hydrate();
  assert.equal(store.getSnapshot().records.length, 0);
  assert.equal(store.getSnapshot().unreadable.find(item => item.id === 'oversized').bytes, 540000);
  assert.ok(store.getSnapshot().unreadable.every(item => item.code === 'WORK_TOO_LARGE'));
  await assert.rejects(store.create(reference(6, 10), 'rose'), { code: 'WORK_TOO_LARGE' });
  assert.equal(data.get(key('oversized')), big);
  await store.remove('oversized');
  assert.deepEqual(store.getSnapshot().records.map(item => item.id), ['existing']);
});

test('abandoning a failed intent performs no IO and retry reconciles without saving the discarded draft', async () => {
  const { store, storage, calls } = setup();
  const original = storage.setItem;
  storage.setItem = async () => { throw new Error('offline'); };
  await assert.rejects(store.create(reference(), 'yellow'), { code: 'WRITE_FAILED' });
  const before = calls.length;
  store.abandonPendingIntent();
  assert.equal(calls.length, before);
  assert.equal(store.getSnapshot().error.code, 'WRITE_FAILED');
  storage.setItem = original;
  await store.retry();
  assert.equal(store.getSnapshot().records.length, 0);
  assert.equal(writes(calls).length, 0);
});

test('abandoning during a retry read cancels replay after reconciliation has already started', async () => {
  const { store, storage, calls } = setup();
  const originalSet = storage.setItem, originalKeys = storage.getAllKeys;
  storage.setItem = async () => { throw new Error('offline'); };
  await assert.rejects(store.create(reference(), 'yellow'), { code: 'WRITE_FAILED' });
  const gate = deferred();
  storage.setItem = originalSet;
  storage.getAllKeys = async () => { await gate.promise; return originalKeys(); };
  const retry = store.retry(); await new Promise(resolve => setImmediate(resolve));
  store.abandonPendingIntent(); gate.resolve(); await retry;
  assert.equal(store.getSnapshot().records.length, 0);
  assert.equal(writes(calls).length, 0);
});

test('overflow removal never publishes a partial validated paint set while its cache refills', async () => {
  const initial = Object.fromEntries(Array.from({ length: 201 }, (_, i) => {
    const id = 'entry-' + String(i).padStart(3, '0');
    return [key(id), JSON.stringify(record(id))];
  }));
  const { store } = setup(initial); await store.hydrate();
  const counts = [];
  const unsubscribe = store.subscribe(() => counts.push(store.getSnapshot().records.length));
  await store.remove('entry-000'); unsubscribe();
  assert.ok(counts.every(count => count === 0 || count === 200), 'unvalidated discarded ranges must stay concealed until the refill completes');
  assert.equal(store.getSnapshot().records.length, 200);
  assert.equal(store.getSnapshot().conflicts.length, 200);
});

test('a key that disappeared before its read does not consume retained-record capacity', async () => {
  const initial = Object.fromEntries(Array.from({ length: 200 }, (_, i) => {
    const id = 'entry-' + String(i).padStart(3, '0');
    return [key(id), JSON.stringify(record(id))];
  }));
  const { store, storage } = setup(initial);
  const getKeys = storage.getAllKeys;
  storage.getAllKeys = async () => [key('aaa-disappeared'), ...await getKeys()];
  await store.hydrate();
  assert.equal(store.getSnapshot().records.length, 200);
  assert.equal(store.getSnapshot().unreadable.length, 0);
});
