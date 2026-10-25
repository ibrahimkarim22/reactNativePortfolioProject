const assert = require('node:assert/strict');
const test = require('node:test');
const { buildCanonicalDocument, createSelection } = require('../../shared/contentText');
const { createHighlightStoreManager } = require('../../reader/readerHighlightStore');
const { prefixFor, keyFor } = require('../../reader/readerHighlights');

function canonical(workId = 'hamlet') {
  return buildCanonicalDocument({ play: { id: workId, contentVersion: 'v1', canonicalTextVersion: '1', sections: [{ id: 's' }] }, sections: [{ work: { id: workId }, contentVersion: 'v1', canonicalTextVersion: '1', section: { id: 's' }, content: [{ id: 'a', text: 'Alpha beta gamma', separatorAfter: '' }] }] });
}
const ref = value => createSelection(value, 0, 5);
const key = (id, work = 'hamlet', uid = 'account-a') => keyFor(uid, work, id);
function saved(id = 'old', workId = 'hamlet', uid = 'account-a') {
  return { schemaVersion: 1, id, owner: { kind: 'account', uid }, workId, selectionRef: ref(canonical(workId)), colorId: 'yellow', revision: 1, createdAt: 1, updatedAt: 1 };
}
function fixture(initial = {}) {
  const data = new Map(Object.entries(initial)), calls = [];
  const storage = {
    async getAllKeys() { calls.push(['keys']); return [...data.keys()]; },
    async getItem(k) { calls.push(['get', k]); return data.get(k) ?? null; },
    async setItem(k, value) { calls.push(['set', k]); data.set(k, value); },
    async removeItem(k) { calls.push(['remove', k]); data.delete(k); },
  };
  let sequence = 0;
  const manager = createHighlightStoreManager(storage, { makeId: () => 'new-' + ++sequence, now: () => 2 });
  return { data, calls, storage, manager, account: manager.forAccount({ uid: 'account-a' }) };
}
const writes = calls => calls.filter(call => ['set', 'remove'].includes(call[0]));
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

test('account discovery counts normal v1 entries without canonical maps or writes and excludes other owners/namespaces', async () => {
  const f = fixture({ [key('old')]: JSON.stringify(saved()), [key('bad', 'the-tempest')]: '{', [key('foreign', 'hamlet', 'account-b')]: 'private', '@bard/reader-highlights-sync:test/account-a/hamlet/x': '{}' });
  assert.equal(f.account.getSnapshot().hydrated, false);
  await f.account.hydrate();
  assert.deepEqual(f.account.getSnapshot().works.map(({ workKey, workId, count }) => ({ workKey, workId, count })), [
    { workKey: 'hamlet', workId: 'hamlet', count: 1 }, { workKey: 'the-tempest', workId: 'the-tempest', count: 1 },
  ]);
  assert.equal(f.account.getSnapshot().hydrated, true);
  assert.equal(f.calls.filter(c => c[0] === 'get').length, 2);
  assert.equal(writes(f.calls).length, 0);
});

test('unknown and malformed work segments and missing record IDs remain discoverable and individually removable', async () => {
  const owner = prefixFor('account-a', 'x').slice(0, -2);
  const bad = [owner + '%68amlet/entry', owner + '%ZZ/entry', owner + 'future-play/entry', owner + 'hamlet/', owner + 'no-slash'];
  const f = fixture(Object.fromEntries(bad.map(k => [k, '{'])));
  await f.account.hydrate();
  assert.equal(f.account.getSnapshot().works.reduce((n, w) => n + w.count, 0), 5);
  assert.equal(f.account.getSnapshot().works.find(w => w.workKey === '%68amlet').workId, null);
  assert.equal(f.account.getSnapshot().works.find(w => w.workKey === '%ZZ').workId, null);
  for (const group of f.account.getSnapshot().works) {
    const raw = f.manager.forStoredWork({ uid: 'account-a', workKey: group.workKey });
    await raw.hydrate();
    assert.equal(raw.getSnapshot().entries.length, 1);
    const entry = raw.getSnapshot().entries[0];
    assert.equal('record' in entry, false);
    assert.equal('quotation' in entry, false);
    await raw.remove(entry.id);
  }
  assert.equal(f.data.size, 0);
  assert.deepEqual(f.account.getSnapshot().works, []);
});

test('keys which vanish before reading do not count and empty reads never write defaults', async () => {
  const f = fixture();
  f.storage.getAllKeys = async () => [key('vanished')];
  await f.account.hydrate();
  assert.deepEqual(f.account.getSnapshot().works, []);
  assert.equal(f.data.size, 0);
  assert.equal(writes(f.calls).length, 0);
});

test('catalogue subscriptions publish only confirmed first creation, recolor, and final removal', async () => {
  const f = fixture(); await f.account.hydrate();
  const store = f.manager.forWork({ uid: 'account-a', canonical: canonical() });
  const gate = deferred(), set = f.storage.setItem;
  f.storage.setItem = async (...args) => { await gate.promise; return set(...args); };
  let notifications = 0;
  const unsub = f.account.subscribe(() => notifications++);
  const pending = store.create(ref(canonical()), 'rose'); await tick();
  assert.deepEqual(f.account.getSnapshot().works, []);
  gate.resolve(); const result = await pending;
  assert.equal(f.account.getSnapshot().works[0].count, 1);
  const raw = f.manager.forStoredWork({ uid: 'account-a', workKey: 'hamlet' });
  assert.equal(raw.getSnapshot().count, 1);
  await store.recolor(result.record.id, 'blue');
  await raw.remove(raw.getSnapshot().entries[0].id);
  assert.deepEqual(f.account.getSnapshot().works, []);
  assert.equal(store.getSnapshot().records.length, 0);
  assert.ok(notifications > 0); unsub();
});

test('read-only discovery and retry preserve failed create intent and block until explicit write retry', async () => {
  const f = fixture();
  const store = f.manager.forWork({ uid: 'account-a', canonical: canonical() });
  const set = f.storage.setItem;
  f.storage.setItem = async () => { throw new Error('disk'); };
  await assert.rejects(store.create(ref(canonical()), 'sage'), { code: 'WRITE_FAILED' });
  const error = store.getSnapshot().error;
  f.storage.setItem = set;
  await f.account.hydrate(); await f.account.refreshReadOnly(); await store.refreshReadOnly();
  assert.equal(store.getSnapshot().error, error);
  await assert.rejects(store.create(createSelection(canonical(), 6, 10), 'blue'), { code: 'RETRY_REQUIRED' });
  assert.equal(writes(f.calls).length, 0);
  const result = await store.retry();
  assert.equal(result.record.id, 'new-1');
  assert.equal(writes(f.calls).length, 1);
  assert.equal(f.account.getSnapshot().works[0].count, 1);
});

test('read-only refresh preserves failed recolor/remove and read errors without replay or error substitution', async () => {
  for (const operation of ['recolor', 'remove']) {
    const f = fixture({ [key('old')]: JSON.stringify(saved()) });
    const store = f.manager.forWork({ uid: 'account-a', canonical: canonical() }); await store.hydrate();
    const method = operation === 'remove' ? 'removeItem' : 'setItem', original = f.storage[method];
    f.storage[method] = async () => { throw new Error('disk'); };
    await assert.rejects(operation === 'remove' ? store.remove('old') : store.recolor('old', 'blue'), { code: 'WRITE_FAILED' });
    const error = store.getSnapshot().error;
    const get = f.storage.getItem; f.storage.getItem = async () => { throw new Error('read'); };
    await assert.rejects(f.account.refreshReadOnly(), { code: 'READ_FAILED' });
    assert.equal(store.getSnapshot().error, error);
    assert.equal(store.getSnapshot().readError.code, 'READ_FAILED');
    f.storage.getItem = get; f.storage[method] = original;
    await f.account.refreshReadOnly();
    assert.equal(store.getSnapshot().error, error); assert.equal(store.getSnapshot().readError, null);
    assert.equal(store.getSnapshot().records[0].colorId, 'yellow');
    assert.equal(writes(f.calls).length, 0);
    await store.retry();
    assert.equal(writes(f.calls).length, 1);
  }
});

test('an ambiguous failed write can be confirmed by reading without unblocking or losing its retry identity', async () => {
  const f = fixture(); const store = f.manager.forWork({ uid: 'account-a', canonical: canonical() });
  const set = f.storage.setItem;
  f.storage.setItem = async (...args) => { await set(...args); throw new Error('ack lost'); };
  await assert.rejects(store.create(ref(canonical()), 'yellow'), { code: 'WRITE_FAILED' });
  const error = store.getSnapshot().error, before = writes(f.calls).length;
  f.storage.setItem = set; await f.account.refreshReadOnly();
  assert.equal(store.getSnapshot().records[0].id, 'new-1');
  assert.equal(store.getSnapshot().error, error);
  await assert.rejects(store.recolor('new-1', 'blue'), { code: 'RETRY_REQUIRED' });
  await store.retry();
  assert.equal(writes(f.calls).length, before);
});

test('discovery queues behind pending writes and cannot replace a newly created play with a stale key list', async () => {
  const f = fixture(); const store = f.manager.forWork({ uid: 'account-a', canonical: canonical() });
  await store.hydrate();
  const set = f.storage.setItem, gate = deferred();
  f.storage.setItem = async (...args) => { await gate.promise; return set(...args); };
  const create = store.create(ref(canonical()), 'yellow'); await tick();
  let finished = false; const refresh = f.account.refreshReadOnly().then(() => { finished = true; }); await tick();
  assert.equal(finished, false);
  gate.resolve(); await create; await refresh;
  assert.equal(f.account.getSnapshot().works[0].count, 1);
  assert.equal(store.getSnapshot().records.length, 1);
});

test('account read errors are retryable without mutations or inventing an empty confirmed overview', async () => {
  const f = fixture({ [key('old')]: JSON.stringify(saved()) });
  const getKeys = f.storage.getAllKeys; f.storage.getAllKeys = async () => { throw new Error('unavailable'); };
  await assert.rejects(f.account.hydrate(), { code: 'READ_FAILED' });
  assert.equal(f.account.getSnapshot().hydrated, false);
  assert.equal(f.account.getSnapshot().error.code, 'READ_FAILED');
  f.storage.getAllKeys = getKeys; await f.account.refreshReadOnly();
  assert.equal(f.account.getSnapshot().hydrated, true);
  assert.equal(f.account.getSnapshot().error, null);
  assert.equal(f.account.getSnapshot().works[0].count, 1);
  assert.equal(writes(f.calls).length, 0);
});

test('different accounts share no visible counts/entries and obsolete queued raw removals perform no IO', async () => {
  const f = fixture({ [key('old')]: JSON.stringify(saved()), [key('private', 'the-tempest', 'account-b')]: 'private' });
  await f.account.hydrate();
  const b = f.manager.forAccount({ uid: 'account-b' }); await b.hydrate();
  assert.deepEqual(b.getSnapshot().works.map(w => w.workId), ['the-tempest']);
  const raw = f.manager.forStoredWork({ uid: 'account-a', workKey: 'hamlet' });
  await assert.rejects(raw.remove(raw.getSnapshot().entries[0].id, { isCurrent: () => false }), { code: 'CANCELLED' });
  assert.equal(writes(f.calls).length, 0);
  assert.equal(f.data.size, 2);
});

test('raw explicit removal uses the shared failed-write queue and read Retry cannot complete it', async () => {
  const f = fixture({ [key('broken', 'future-play')]: '{' }); await f.account.hydrate();
  const raw = f.manager.forStoredWork({ uid: 'account-a', workKey: 'future-play' });
  const remove = f.storage.removeItem; f.storage.removeItem = async () => { throw new Error('disk'); };
  await assert.rejects(raw.remove(raw.getSnapshot().entries[0].id), { code: 'WRITE_FAILED' });
  f.storage.removeItem = remove; await raw.refreshReadOnly(); await f.account.refreshReadOnly();
  assert.equal(f.data.size, 1); assert.equal(raw.getSnapshot().error.code, 'WRITE_FAILED');
  await raw.retry(); assert.equal(f.data.size, 0);
  assert.deepEqual(f.account.getSnapshot().works, []);
});

test('read-only refresh does not unblock an explicitly abandoned failed write or a storage-unavailable failed write', async () => {
  for (const unavailable of [false, true]) {
    const f = fixture(); const store = f.manager.forWork({ uid: 'account-a', canonical: canonical() });
    await store.hydrate();
    const set = f.storage.setItem;
    if (unavailable) f.storage.setItem = undefined;
    else f.storage.setItem = async () => { throw new Error('disk'); };
    await assert.rejects(store.create(ref(canonical()), 'yellow'), { code: unavailable ? 'STORAGE_UNAVAILABLE' : 'WRITE_FAILED' });
    store.abandonPendingIntent();
    const error = store.getSnapshot().error;
    f.storage.setItem = set;
    await f.account.refreshReadOnly();
    assert.equal(store.getSnapshot().error, error);
    await assert.rejects(store.create(ref(canonical()), 'sage'), { code: 'RETRY_REQUIRED' });
    assert.equal(writes(f.calls).length, 0);
    await store.retry();
    assert.equal(store.getSnapshot().error, null);
    assert.equal(store.getSnapshot().records.length, 0);
  }
});

test('account missing storage reports a read error rather than an empty confirmed catalogue', async () => {
  const account = createHighlightStoreManager(null).forAccount({ uid: 'account-a' });
  await assert.rejects(account.hydrate(), { code: 'STORAGE_UNAVAILABLE' });
  assert.equal(account.getSnapshot().hydrated, false);
  assert.equal(account.getSnapshot().error.code, 'STORAGE_UNAVAILABLE');
});

test('snapshots distinguish pure read failures from retained write blocks without changing retry behavior', async () => {
  const f = fixture({ [key('old')]: JSON.stringify(saved()) });
  const store = f.manager.forWork({ uid: 'account-a', canonical: canonical() });
  const raw = f.manager.forStoredWork({ uid: 'account-a', workKey: 'hamlet' });
  const get = f.storage.getItem;
  f.storage.getItem = async () => { throw new Error('read failure'); };
  await assert.rejects(store.hydrate(), { code: 'READ_FAILED' });
  assert.equal(store.getSnapshot().writeBlocked, false);
  assert.equal(raw.getSnapshot().writeBlocked, false);
  f.storage.getItem = get;
  await store.refreshReadOnly();
  const set = f.storage.setItem;
  f.storage.setItem = undefined;
  await assert.rejects(store.recolor('old', 'blue'), { code: 'STORAGE_UNAVAILABLE' });
  assert.equal(store.getSnapshot().writeBlocked, true);
  assert.equal(raw.getSnapshot().writeBlocked, true);
  f.storage.setItem = set;
  await store.refreshReadOnly();
  assert.equal(store.getSnapshot().writeBlocked, true);
  assert.equal(raw.getSnapshot().writeBlocked, true);
  assert.equal(writes(f.calls).length, 0);
  await store.retry();
  assert.equal(store.getSnapshot().writeBlocked, false);
  assert.equal(raw.getSnapshot().writeBlocked, false);
  assert.equal(store.getSnapshot().records[0].colorId, 'blue');
  assert.equal(writes(f.calls).length, 1);
});

test('exact-key removal handles remain distinct for raw and malformed keys which differ only by a trailing exclamation', async () => {
  for (const malformed of [false, true]) {
    const workId = malformed ? 'hamlet' : 'future-play';
    const prefix = prefixFor('account-a', workId);
    const firstKey = prefix + (malformed ? '%61' : 'a');
    const secondKey = firstKey + '!';
    const f = fixture({ [firstKey]: 'first retained bytes', [secondKey]: 'second retained bytes' });
    const store = malformed ? f.manager.forWork({ uid: 'account-a', canonical: canonical() })
      : f.manager.forStoredWork({ uid: 'account-a', workKey: workId });
    await store.hydrate();
    const entries = malformed ? store.getSnapshot().unreadable : store.getSnapshot().entries;
    const first = entries.find(entry => entry.key === firstKey);
    const second = entries.find(entry => entry.key === secondKey);
    assert.notEqual(first.id, second.id, 'different exact keys must never share a removal handle');
    assert.ok(first.id.length > 128 && second.id.length > 128, 'handles cannot alias valid record IDs');
    await store.remove(second.id);
    assert.equal(f.data.get(firstKey), 'first retained bytes');
    assert.equal(f.data.has(secondKey), false);
    assert.deepEqual(writes(f.calls), [['remove', secondKey]]);
  }
});
