const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function create(options = {}) {
  const file = path.resolve(__dirname, '../../course/courseProgressSession.js');
  assert.ok(fs.existsSync(file), 'production account-scoped course session exists');
  const h = { uid: 'owner-a', observers: [], reads: [], saves: [], authStops: 0, notices: [], ...options };
  const transport = {
    observe(uid, next, error) {
      const observer = { uid, next, error, stopped: false };
      h.observers.push(observer);
      h.observe?.(observer);
      return () => { observer.stopped = true; };
    },
    read(uid) { h.reads.push(uid); return h.read ? h.read(uid) : Promise.resolve(server(1)); },
    save(uid, level, current) {
      h.saves.push({ uid, level, current });
      return h.save ? h.save(uid, level, current) : Promise.resolve(ack(level));
    },
  };
  h.session = require(file).createCourseProgressSession({
    getUid: () => h.uid,
    subscribeAuth(notify) { h.auth = notify; return () => { h.authStops++; }; },
    transport,
  });
  h.session.subscribe(() => h.notices.push(h.session.getSnapshot()));
  h.ready = (level = 1) => { h.session.start(); h.observers.at(-1).next(server(level)); };
  h.switch = uid => { h.uid = uid; h.auth(uid); };
  return h;
}
const server = (completedLevel, changes = {}) => ({ exists: true, completedLevel, fromCache: false, hasPendingWrites: false, ...changes });
const ack = (completedLevel, advanced = true) => Object.freeze({ completedLevel, advanced });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('a restored signed-in session starts one profile observer and needs confirmed server progress', () => {
  const h = create(), before = h.session.getSnapshot();
  assert.equal(before.status, 'loading'); assert.equal(before.completedLevel, 0); assert.equal(h.session.getLevel(), null);
  assert.equal(before, h.session.getSnapshot()); assert.ok(Object.isFrozen(before)); assert.ok(Object.isFrozen(before.owner));
  h.session.start(); h.session.start();
  assert.equal(h.observers.length, 1); assert.equal(h.observers[0].uid, 'owner-a');
  h.observers[0].next(server(7));
  const confirmed = h.session.getSnapshot();
  assert.equal(confirmed.status, 'ready'); assert.equal(confirmed.completedLevel, 7); assert.equal(h.session.getLevel(), 7);
  assert.equal(confirmed, h.session.getSnapshot()); assert.equal(h.session.getOwner(), confirmed.owner);
  assert.deepEqual(h.reads, []); assert.deepEqual(h.saves, []);
});

test('signed-out sessions neither observe profiles nor expose completion authority', () => {
  const h = create({ uid: null }); h.session.start();
  assert.equal(h.session.getSnapshot().status, 'signed-out'); assert.equal(h.session.getOwner().uid, null);
  assert.equal(h.observers.length, 0); assert.equal(h.session.getLevel(), null); assert.equal(h.session.commitLevel(1), false);
});

test('cached or pending snapshots never establish progress and a later confirmed value recovers', () => {
  for (const metadata of [{ fromCache: true }, { hasPendingWrites: true }, { fromCache: true, hasPendingWrites: true }]) {
    const h = create(); h.session.start(); h.observers[0].next(server(8, metadata));
    assert.equal(h.session.getLevel(), null); assert.equal(h.session.getSnapshot().status, 'error');
    assert.equal(h.session.getSnapshot().error, 'UNVERIFIED_PROGRESS'); assert.equal(h.session.getSnapshot().completedLevel, 0);
    h.observers[0].next(server(2)); assert.equal(h.session.getLevel(), 2);
    const stable = h.session.getSnapshot(); h.observers[0].next(server(99, metadata));
    assert.equal(h.session.getSnapshot(), stable); assert.equal(h.session.getLevel(), 2);
  }
});

test('confirmed metadata repeats do not notify and lower observations cannot reduce progress', () => {
  const h = create(); h.ready(9); const stable = h.session.getSnapshot(), count = h.notices.length;
  h.observers[0].next(server(9)); h.observers[0].next(server(4));
  assert.equal(h.session.getSnapshot(), stable); assert.equal(h.notices.length, count); assert.equal(h.session.getLevel(), 9);
  h.observers[0].next(server(39)); assert.equal(h.session.getLevel(), 39, 'existing scalar levels are not clamped or renumbered');
});

test('an existing legacy profile without completedLevel starts at zero without writing it', () => {
  const h = create(); h.session.start();
  h.observers[0].next({ exists: true, fromCache: false, hasPendingWrites: false });
  assert.equal(h.session.getLevel(), 0); assert.deepEqual(h.saves, []);
});

for (const value of [-1, 0.5, '2', null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  test('malformed server completion ' + String(value) + ' cannot unlock course progress', () => {
    const h = create(); h.session.start(); h.observers[0].next(server(value));
    assert.equal(h.session.getSnapshot().status, 'error'); assert.equal(h.session.getSnapshot().error, 'INVALID_PROGRESS');
    assert.equal(h.session.getLevel(), null); assert.deepEqual(h.saves, []);
  });
}

test('missing profile and observation errors remain unavailable instead of inventing a completion', () => {
  const h = create(); h.session.start(); h.observers[0].next(server(undefined, { exists: false }));
  assert.equal(h.session.getSnapshot().error, 'PROFILE_MISSING'); assert.equal(h.session.getLevel(), null);
  h.observers[0].error(Object.assign(new Error('private fixture detail'), { code: 'permission-denied' }));
  assert.equal(h.session.getSnapshot().error, 'PROGRESS_READ_FAILED');
  assert.equal(JSON.stringify(h.session.getSnapshot()).includes('private fixture detail'), false);
});

test('account changes immediately hide prior progress and retire old values and errors', () => {
  const h = create(); h.ready(8); const original = h.observers[0], firstOwner = h.session.getOwner();
  h.uid = 'owner-b'; const changed = h.session.getSnapshot();
  assert.equal(changed.owner.uid, 'owner-b'); assert.notEqual(changed.owner, firstOwner);
  assert.equal(changed.completedLevel, 0); assert.equal(changed.status, 'loading'); assert.equal(h.session.getLevel(), null);
  assert.equal(original.stopped, true); assert.equal(h.observers.at(-1).uid, 'owner-b');
  original.next(server(15)); original.error(new Error('old error'));
  assert.equal(h.session.getSnapshot(), changed);
  h.observers.at(-1).next(server(2)); assert.equal(h.session.getLevel(), 2);
  h.switch(null); assert.equal(h.session.getSnapshot().completedLevel, 0); assert.equal(h.session.getSnapshot().status, 'signed-out');
});

test('A-to-B-to-A auth transitions retain distinct generations and retire original A callbacks', () => {
  const h = create(); h.ready(5); const original = h.observers[0], first = h.session.getOwner();
  h.switch('owner-b'); h.switch('owner-a'); const restored = h.session.getOwner();
  assert.equal(restored.uid, first.uid); assert.ok(restored.generation > first.generation);
  assert.equal(h.session.getLevel(), null); original.next(server(99)); assert.equal(h.session.getLevel(), null);
  h.observers.at(-1).next(server(6)); assert.equal(h.session.getLevel(), 6);
});

test('queued intermediate auth events retire A even if current auth already returned to A', () => {
  const h = create(); h.ready(4); const first = h.session.getOwner(), original = h.observers[0];
  h.auth('owner-b'); h.auth('owner-a');
  assert.equal(h.session.getOwner().uid, 'owner-a'); assert.ok(h.session.getOwner().generation > first.generation);
  assert.equal(h.session.getLevel(), null); original.next(server(99)); assert.equal(h.session.getLevel(), null);
  assert.equal(h.observers.some(observer => observer.uid === 'owner-b'), false, 'stale auth notifications do not observe another current account');
});

test('refresh retries an errored observer using server reads and never writes', async () => {
  const h = create(); h.session.start(); h.observers[0].error(new Error('fixture failure'));
  assert.equal(h.session.getSnapshot().status, 'error');
  assert.equal(await h.session.refresh(), true); assert.equal(h.session.getLevel(), 1);
  assert.deepEqual(h.reads, ['owner-a']); assert.equal(h.observers.length, 2); assert.equal(h.observers[0].stopped, true);
  assert.deepEqual(h.saves, []);
});

test('older foreground reads and their errors cannot override newer live observations', async () => {
  for (const reject of [false, true]) {
    const gate = deferred(), h = create({ read: () => gate.promise }); h.ready(1);
    const refresh = h.session.refresh(); h.observers.at(-1).next(server(7));
    if (reject) gate.reject(new Error('older read failed')); else gate.resolve(server(2));
    await refresh; assert.equal(h.session.getLevel(), 7); assert.equal(h.session.getSnapshot().status, 'ready');
  }
});

test('a malformed older refresh cannot replace a newer confirmed observation with an error', async () => {
  for (const value of [server(null), server(-1), server('8'), server(undefined, { exists: false })]) {
    const gate = deferred(), h = create({ read: () => gate.promise }); h.ready(1);
    const refresh = h.session.refresh(); h.observers.at(-1).next(server(7)); gate.resolve(value);
    assert.equal(await refresh, false); assert.equal(h.session.getSnapshot().status, 'ready'); assert.equal(h.session.getLevel(), 7);
  }
});

test('a delayed refresh cannot apply values or errors after an account change', async () => {
  for (const reject of [false, true]) {
    const gate = deferred(), h = create({ read: () => gate.promise }); h.ready(8);
    const refresh = h.session.refresh(); h.switch('owner-b');
    if (reject) gate.reject(new Error('late A')); else gate.resolve(server(12));
    assert.equal(await refresh, false); assert.equal(h.session.getSnapshot().owner.uid, 'owner-b');
    assert.equal(h.session.getSnapshot().status, 'loading'); assert.equal(h.session.getLevel(), null);
  }
});

test('save rejects unknown progress, wrong owners and invalid earned levels before transport', async () => {
  const h = create(); h.session.start();
  await assert.rejects(h.session.saveProgress('owner-a', 1), { code: 'COURSE_PROGRESS_NOT_READY' });
  h.observers[0].next(server(0));
  await assert.rejects(h.session.saveProgress('owner-b', 1), { code: 'COURSE_CANCELLED' });
  for (const level of [0, -1, '1', 1.5]) await assert.rejects(h.session.saveProgress('owner-a', level), { code: 'COURSE_INVALID_LEVEL' });
  assert.deepEqual(h.saves, []);
});

test('a confirmed save acknowledgment is required before committing completion', async () => {
  const gate = deferred(), h = create({ save: () => gate.promise }); h.ready(0);
  const pending = h.session.saveProgress('owner-a', 1);
  assert.equal(h.session.commitLevel(1), false); assert.equal(h.session.getLevel(), 0);
  gate.resolve(ack(1)); const confirmed = await pending;
  assert.ok(Object.isFrozen(confirmed)); assert.deepEqual(confirmed, ack(1)); assert.equal(h.session.getLevel(), 0);
  assert.equal(h.session.commitLevel(1), true); assert.equal(h.session.getLevel(), 1);
  assert.equal(h.session.commitLevel(99), false); assert.equal(h.session.getLevel(), 1);
});

test('save acknowledgment can recover read failure and never lower newer confirmed progress', async () => {
  const gate = deferred(), h = create({ save: () => gate.promise }); h.ready(0);
  const pending = h.session.saveProgress('owner-a', 1);
  h.observers[0].next(server(5)); h.observers[0].error(new Error('fixture interruption'));
  gate.resolve(ack(1)); await pending;
  assert.equal(h.session.commitLevel(1), true); assert.equal(h.session.getLevel(), 5);
});

test('failed or malformed acknowledgments cannot grant local authority', async () => {
  for (const value of [undefined, null, {}, ack(0), ack(3), ack(1, 'true'), { completedLevel: '1', advanced: true }]) {
    const h = create({ save: async () => value }); h.ready(0);
    await assert.rejects(h.session.saveProgress('owner-a', 1), { code: 'COURSE_INVALID_ACKNOWLEDGMENT' });
    assert.equal(h.session.commitLevel(1), false); assert.equal(h.session.getLevel(), 0);
  }
  const h = create({ save: async () => { throw new Error('fixture failure'); } }); h.ready(0);
  await assert.rejects(h.session.saveProgress('owner-a', 1)); assert.equal(h.session.commitLevel(1), false);
});

test('transaction predicates and delayed acknowledgments lose authority on ownership changes', async () => {
  const gate = deferred(), h = create({ save: () => gate.promise }); h.ready(0);
  const pending = h.session.saveProgress('owner-a', 1), current = h.saves[0].current;
  assert.equal(current(), true); h.switch('owner-b'); assert.equal(current(), false);
  h.switch('owner-a'); h.observers.at(-1).next(server(0)); assert.equal(current(), false);
  gate.resolve(ack(1)); await assert.rejects(pending, { code: 'COURSE_CANCELLED' });
  assert.equal(h.session.commitLevel(1), false); assert.equal(h.session.getLevel(), 0);
});

test('stop is idempotent and retires observers, refreshes and saves before restart', async () => {
  const readGate = deferred(), saveGate = deferred(), h = create({ read: () => readGate.promise, save: () => saveGate.promise }); h.ready(0);
  const oldOwner = h.session.getOwner(), observer = h.observers[0];
  const refresh = h.session.refresh(), save = h.session.saveProgress('owner-a', 1);
  h.session.stop(); h.session.stop();
  assert.equal(h.authStops, 1); assert.equal(observer.stopped, true); assert.equal(h.session.getLevel(), null);
  observer.next(server(99)); readGate.resolve(server(99)); saveGate.resolve(ack(1));
  assert.equal(await refresh, false); await assert.rejects(save, { code: 'COURSE_CANCELLED' });
  h.session.start(); assert.ok(h.session.getOwner().generation > oldOwner.generation);
  h.observers.at(-1).next(server(2)); assert.equal(h.session.getLevel(), 2);
});

test('synchronous observer callbacks changing ownership cannot retain an obsolete observer', () => {
  const h = create({ observe(observer) { if (observer.uid === 'owner-a') { h.uid = 'owner-b'; observer.next(server(99)); } } });
  h.session.start();
  assert.equal(h.session.getOwner().uid, 'owner-b'); assert.equal(h.session.getLevel(), null);
  assert.equal(h.observers[0].stopped, true); assert.equal(h.observers.at(-1).uid, 'owner-b');
});
