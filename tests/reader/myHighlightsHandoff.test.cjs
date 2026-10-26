const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createSelection } = require('../../shared/contentText');
const { createHighlightStoreManager } = require('../../reader/readerHighlightStore');
const { createReaderHighlightSession } = require('../../reader/readerHighlightSession');

const canonical = { workId: 'hamlet', contentVersion: 'v1', canonicalTextVersion: '1', text: 'Again.\nAgain.\nFinal exit.',
  units: [{ id: 'prologue-line', sectionId: 'prologue', start: 0, textEnd: 6, end: 7 },
    { id: 'scene-line', sectionId: 'scene', start: 7, textEnd: 13, end: 14 },
    { id: 'epilogue-line', sectionId: 'epilogue', start: 14, textEnd: 25, end: 25 }],
  sections: [{ id: 'prologue', start: 0, end: 7 }, { id: 'scene', start: 7, end: 14 }, { id: 'epilogue', start: 14, end: 25 }] };
const record = (id = 'second', start = 7, end = 13) => ({ schemaVersion: 1, id, owner: { kind: 'account', uid: 'a' }, workId: 'hamlet',
  selectionRef: createSelection(canonical, start, end), colorId: 'yellow', revision: 1, createdAt: 1, updatedAt: 1 });
const key = id => '@bard/reader-highlights:v1/a/hamlet/' + id;
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }

async function host({ items = [record()], deferPaint = false, workId = 'hamlet' } = {}) {
  const file = path.resolve(__dirname, '../../reader/myHighlightsHandoff.js');
  assert.equal(fs.existsSync(file), true, 'the one-use handoff controller exists');
  const data = new Map(items.map(item => [key(item.id), JSON.stringify(item)]));
  const calls = [], shows = [], paints = [], completed = [], errors = [], ownerListeners = new Set();
  let owner = Object.freeze({ uid: 'a', generation: 1, ready: true });
  const storage = {
    async getAllKeys() { calls.push('keys'); return [...data.keys()]; },
    async getItem(k) { calls.push('read:' + k); return data.get(k) ?? null; },
    async setItem(k, value) { calls.push('write:' + k); data.set(k, value); },
    async removeItem(k) { calls.push('remove:' + k); data.delete(k); },
  };
  const manager = createHighlightStoreManager(storage);
  const store = manager.forWork({ uid: 'a', canonical });
  await store.hydrate();
  const document = { canonical: { ...canonical, workId }, identity: { documentId: 'opened-reader', workId, contentVersion: 'v1', canonicalTextVersion: '1' } };
  const surface = {
    applyHighlights(items, generation) { const gate = deferred(); paints.push({ items, generation, gate }); return deferPaint ? gate.promise : Promise.resolve({}); },
    showHighlight(item, generation) { shows.push({ item, generation }); return Promise.resolve({ status: 'applied' }); },
  };
  const session = createReaderHighlightSession({ manager, document, surface: () => surface });
  const broker = require(file).createMyHighlightsHandoff({ getOwner: () => owner,
    subscribeOwner(listener) { ownerListeners.add(listener); return () => ownerListeners.delete(listener); } });
  const prepare = (changes = {}) => broker.prepare({ store, workId: 'hamlet', recordId: 'second', expectedRevision: 1, ...changes });
  const open = request => broker.open({ request, store, session, onComplete: () => completed.push(true), onError: error => errors.push(error.code) });
  return { data, calls, storage, manager, store, session, broker, prepare, open, shows, paints, completed, errors,
    setOwner(uid) { owner = Object.freeze({ uid, generation: owner.generation + 1, ready: true }); for (const listener of ownerListeners) listener(); },
    async activate() { session.setOwner('a'); await session.setReady(true); },
    dispose() { broker.cancel(); session.dispose(); } };
}

test('prepare returns identifiers only after a read-only refresh, without writes or quotation lookup', async () => {
  const h = await host();
  const before = h.calls.length;
  const request = await h.prepare();
  assert.deepEqual(Object.keys(request).sort(), ['expectedRevision', 'generation', 'recordId', 'token', 'uid', 'workId']);
  assert.equal(request.recordId, 'second'); assert.equal(request.expectedRevision, 1);
  assert.equal(request.generation, 1); assert.equal(Object.isFrozen(request), true);
  assert.ok(h.calls.slice(before).includes('keys'));
  assert.equal(h.calls.some(value => /^(write|remove):/.test(value)), false);
  h.dispose();
});

test('the exact second repeated quotation is shown once after correct reader readiness', async () => {
  const h = await host({ items: [record('first', 0, 6), record()] });
  const request = await h.prepare(); h.open(request); await tick();
  assert.equal(h.shows.length, 0);
  await h.activate(); await tick();
  assert.equal(h.shows.length, 1); assert.equal(h.shows[0].item.id, 'second');
  assert.equal(h.shows[0].item.selectionRef.start, 7);
  assert.deepEqual(h.completed, [true]); assert.deepEqual(h.errors, []);
  assert.throws(() => h.open(request), { code: 'CANCELLED' });
  h.dispose();
});

test('special-section and cross-paragraph ranges retain their complete validated references', async () => {
  for (const [id, start, end] of [['prologue', 0, 6], ['epilogue', 14, 25], ['cross-paragraph', 3, 19]]) {
    const h = await host({ items: [record(id, start, end)] });
    const request = await h.prepare({ recordId: id }); await h.activate(); h.open(request); await tick();
    assert.equal(h.shows[0].item.selectionRef.start, start); assert.equal(h.shows[0].item.selectionRef.end, end);
    assert.equal(h.shows[0].item.selectionRef.exact, canonical.text.slice(start, end)); h.dispose();
  }
});

test('opening waits for highlight painting and never dispatches a queued show through session.show', async () => {
  const h = await host({ deferPaint: true }); const request = await h.prepare();
  h.session.setOwner('a'); const active = h.session.setReady(true); h.open(request); await tick();
  assert.equal(h.shows.length, 0);
  h.paints[0].gate.resolve({}); await tick();
  assert.equal(h.session.getSnapshot().rendering, true); assert.equal(h.shows.length, 0);
  h.paints.at(-1).gate.resolve({}); await active; await tick();
  assert.equal(h.shows.length, 1); h.dispose();
});

test('deletion or recolor between request and opening rejects rather than jumps to a fallback', async () => {
  for (const mutation of ['delete', 'recolor']) {
    const h = await host(); const request = await h.prepare();
    if (mutation === 'delete') h.data.delete(key('second'));
    else { const item = JSON.parse(h.data.get(key('second'))); item.revision++; item.colorId = 'blue'; h.data.set(key('second'), JSON.stringify(item)); }
    await h.activate(); h.open(request); await tick();
    assert.equal(h.shows.length, 0);
    assert.deepEqual(h.errors, [mutation === 'delete' ? 'HIGHLIGHT_UNAVAILABLE' : 'HIGHLIGHT_CHANGED']); h.dispose();
  }
});

test('a changed live range with an unchanged revision is rejected rather than substituted', async () => {
  const h = await host(); const request = await h.prepare();
  const item = record('second', 0, 6); h.data.set(key('second'), JSON.stringify(item));
  await h.activate(); h.open(request); await tick();
  assert.equal(h.shows.length, 0); assert.deepEqual(h.errors, ['HIGHLIGHT_CHANGED']); h.dispose();
});

test('Back or intervening interaction cancellation prevents a later ready or paint callback from jumping', async () => {
  const h = await host(); const request = await h.prepare(); const opening = h.open(request);
  await tick(); opening.cancel(); await h.activate(); await tick();
  assert.equal(h.shows.length, 0); assert.deepEqual(h.completed, []); assert.deepEqual(h.errors, []);
  assert.throws(() => h.open(request), { code: 'CANCELLED' }); h.dispose();
});

test('A to B to A invalidates even an otherwise identical original request', async () => {
  const h = await host(); const request = await h.prepare(); h.open(request);
  h.setOwner('b'); h.setOwner('a'); await h.activate(); await tick();
  assert.equal(h.shows.length, 0); assert.deepEqual(h.completed, []); assert.deepEqual(h.errors, []);
  assert.throws(() => h.open(request), { code: 'CANCELLED' }); h.dispose();
});

test('an account change during a pending prepare read cannot produce a navigation request', async () => {
  const h = await host(); const gate = deferred(), original = h.storage.getAllKeys;
  h.storage.getAllKeys = async () => { await gate.promise; return original(); };
  const request = h.prepare(); const rejected = assert.rejects(request, { code: 'CANCELLED' });
  await tick(); h.setOwner('b'); h.setOwner('a'); gate.resolve(); await rejected;
  assert.equal(h.shows.length, 0); h.dispose();
});

test('a newer intentional Show retires the old waiter, including a late successful acknowledgement', async () => {
  const h = await host(); const request = await h.prepare();
  let ack; h.session.show = () => new Promise(resolve => { ack = resolve; });
  await h.activate(); h.open(request); await tick(); assert.equal(typeof ack, 'function');
  const newer = await h.prepare(); ack({ status: 'applied' }); await tick();
  assert.deepEqual(h.completed, []); assert.deepEqual(h.errors, []);
  h.broker.cancel(); assert.throws(() => h.open(newer), { code: 'CANCELLED' }); h.dispose();
});

test('wrong work, unavailable version, and read errors fail without invoking show or replaying writes', async () => {
  const wrong = await host({ workId: 'the-tempest' }); const request = await wrong.prepare();
  assert.throws(() => wrong.open(request), { code: 'DOCUMENT_CHANGED' }); wrong.dispose();
  const old = record(); old.selectionRef = { ...old.selectionRef, contentVersion: 'old' };
  const unavailable = await host({ items: [old] });
  await assert.rejects(unavailable.prepare(), { code: 'HIGHLIGHT_UNAVAILABLE' }); unavailable.dispose();
  const h = await host(); h.storage.getAllKeys = async () => { throw new Error('unavailable storage'); };
  await assert.rejects(h.prepare(), { code: 'READ_FAILED' }); assert.equal(h.shows.length, 0);
  assert.equal(h.calls.some(value => /^(write|remove):/.test(value)), false); h.dispose();
});

test('a route copy cannot alter the originally claimed request while readiness is pending', async () => {
  const h = await host(); const original = await h.prepare(); const routeCopy = { ...original };
  h.open(routeCopy); routeCopy.uid = 'other'; routeCopy.workId = 'the-tempest'; await h.activate(); await tick();
  assert.equal(h.shows.length, 1); assert.equal(h.shows[0].item.id, 'second');
  assert.deepEqual(h.errors, []); h.dispose();
});

test('confirmed recolor while initial paint is pending cancels the original request', async () => {
  const h = await host({ deferPaint: true }); const request = await h.prepare();
  h.session.setOwner('a'); const activated = h.session.setReady(true); h.open(request); await tick();
  h.paints[0].gate.resolve({}); await tick();
  await h.store.recolor('second', 'rose');
  for (const paint of h.paints) paint.gate.resolve({}); await activated; await tick();
  assert.equal(h.shows.length, 0); assert.deepEqual(h.errors, ['HIGHLIGHT_CHANGED']); h.dispose();
});
