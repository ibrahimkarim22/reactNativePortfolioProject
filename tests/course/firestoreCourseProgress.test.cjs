const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function factory() {
  const file = path.resolve(__dirname, '../../course/firestoreCourseProgress.js');
  assert.ok(fs.existsSync(file), 'the normal app Firestore progress adapter exists');
  return require(file).createFirestoreCourseProgressTransport;
}
const snapshot = (data = {}, metadata = {}, exists = true) => ({ exists: () => exists, data: () => data, metadata });
function host(options = {}) {
  const h = { value: { completedLevel: 0, untouched: 'fixture-profile' }, paths: [], updates: [], calls: [], ...options };
  const dependencies = {
    db: 'fixture-db',
    doc: (db, ...parts) => { assert.equal(db, 'fixture-db'); h.paths.push(parts); return { path: parts.join('/') }; },
    getDocFromServer: async ref => { h.calls.push(['read', ref.path]); return h.read ? h.read(ref) : snapshot(h.value); },
    onSnapshot: (ref, settings, next, error) => {
      h.calls.push(['observe', ref.path, settings]); h.next = next; h.error = error;
      return () => { h.unsubscribed = true; };
    },
    runTransaction: async (db, callback) => {
      assert.equal(db, 'fixture-db'); h.calls.push(['transaction']);
      if (h.transact) return h.transact(callback);
      const result = await callback({
        get: async ref => { h.calls.push(['get', ref.path]); return h.get ? h.get(ref) : snapshot(h.value); },
        update: (ref, patch) => { h.updates.push({ path: ref.path, patch }); h.value = { ...h.value, ...patch }; },
      });
      return result;
    },
  };
  h.transport = factory()(dependencies);
  return h;
}

test('server reads expose only immutable scalar progress and metadata', async () => {
  const h = host({ value: { completedLevel: 4, privateProfileField: 'not-public' } });
  const result = await h.transport.read('fixture-owner');
  assert.deepEqual(result, { exists: true, completedLevel: 4, fromCache: false, hasPendingWrites: false });
  assert.ok(Object.isFrozen(result));
  assert.deepEqual(h.paths, [['users', 'fixture-owner']]);
  assert.deepEqual(h.calls, [['read', 'users/fixture-owner']]);
});

test('an existing legacy profile without completedLevel reads as zero without writing', async () => {
  const h = host({ value: { otherProfileField: 'keep' } });
  assert.equal((await h.transport.read('fixture-owner')).completedLevel, 0);
  assert.deepEqual(h.updates, []);
});

test('profile listeners request metadata and never forward other profile fields', () => {
  const h = host(), values = [], failures = [];
  const unsubscribe = h.transport.observe('fixture-owner', value => values.push(value), error => failures.push(error));
  assert.deepEqual(h.calls[0], ['observe', 'users/fixture-owner', { includeMetadataChanges: true }]);
  h.next(snapshot({ completedLevel: 7, credentials: { dummy: 'not-forwarded' } }, { fromCache: true, hasPendingWrites: true }));
  assert.deepEqual(values, [{ exists: true, completedLevel: 7, fromCache: true, hasPendingWrites: true }]);
  assert.ok(Object.isFrozen(values[0])); assert.deepEqual(failures, []);
  unsubscribe(); assert.equal(h.unsubscribed, true);
});

test('missing profile is an explicit error and is never created by read or save', async () => {
  const h = host({ read: () => snapshot({}, {}, false), get: () => snapshot({}, {}, false) });
  await assert.rejects(h.transport.read('fixture-owner'), { code: 'COURSE_PROFILE_MISSING' });
  await assert.rejects(h.transport.save('fixture-owner', 1), { code: 'COURSE_PROFILE_MISSING' });
  assert.deepEqual(h.updates, []);
});

for (const value of [null, '1', -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, {}, []]) {
  test('invalid stored progress ' + String(value) + ' is rejected without correction', async () => {
    const h = host({ value: { completedLevel: value } }), observed = [], failures = [];
    await assert.rejects(h.transport.read('fixture-owner'), { code: 'COURSE_PROGRESS_INVALID' });
    await assert.rejects(h.transport.save('fixture-owner', 2), { code: 'COURSE_PROGRESS_INVALID' });
    h.transport.observe('fixture-owner', v => observed.push(v), e => failures.push(e));
    h.next(snapshot(h.value));
    assert.deepEqual(observed, []); assert.equal(failures[0].code, 'COURSE_PROGRESS_INVALID');
    assert.deepEqual(h.updates, []);
  });
}

test('invalid owners and targets are rejected before accessing Firebase', async () => {
  for (const uid of [null, undefined, '', ' ', 'owner/child', 'owner\\child', {}, 4]) {
    const h = host();
    await assert.rejects(h.transport.read(uid), { code: 'COURSE_INVALID_OWNER' });
    await assert.rejects(h.transport.save(uid, 1), { code: 'COURSE_INVALID_OWNER' });
    assert.throws(() => h.transport.observe(uid, () => {}, () => {}), { code: 'COURSE_INVALID_OWNER' });
    assert.deepEqual(h.paths, []); assert.deepEqual(h.calls, []);
  }
  for (const level of [null, '1', -1, 0, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const h = host();
    await assert.rejects(h.transport.save('fixture-owner', level), { code: 'COURSE_INVALID_LEVEL' });
    assert.deepEqual(h.calls, []); assert.deepEqual(h.updates, []);
  }
});

test('a newly earned completion updates only completedLevel and returns the confirmed result', async () => {
  const h = host({ value: { completedLevel: 1, untouched: 'preserved', nested: { value: 2 } } });
  const result = await h.transport.save('fixture-owner', 3);
  assert.deepEqual(result, { completedLevel: 3, advanced: true }); assert.ok(Object.isFrozen(result));
  assert.deepEqual(h.updates, [{ path: 'users/fixture-owner', patch: { completedLevel: 3 } }]);
  assert.deepEqual(h.value, { completedLevel: 3, untouched: 'preserved', nested: { value: 2 } });
});

test('equal or older attempts do not write and return the newer server progress', async () => {
  for (const level of [2, 5]) {
    const h = host({ value: { completedLevel: 5 } });
    assert.deepEqual(await h.transport.save('fixture-owner', level), { completedLevel: 5, advanced: false });
    assert.deepEqual(h.updates, []);
  }
});

test('each transaction retry rereads the authoritative value and can become a replay', async () => {
  const patches = [];
  const h = host({ transact: async callback => {
    await callback({ get: async () => snapshot({ completedLevel: 0 }), update: (_, patch) => patches.push(patch) });
    return callback({ get: async () => snapshot({ completedLevel: 8 }), update: () => assert.fail('retry cannot lower progress') });
  } });
  assert.deepEqual(await h.transport.save('fixture-owner', 3), { completedLevel: 8, advanced: false });
  assert.deepEqual(patches, [{ completedLevel: 3 }], 'aborted attempt has no published local side effects');
});

test('ownership is checked before any work, after reading, and on SDK retries', async () => {
  const before = host();
  await assert.rejects(before.transport.save('fixture-owner', 1, () => false), { code: 'COURSE_CANCELLED' });
  assert.deepEqual(before.calls, []);
  let current = true;
  const during = host({ get: async () => { current = false; return snapshot({ completedLevel: 0 }); } });
  await assert.rejects(during.transport.save('fixture-owner', 1, () => current), { code: 'COURSE_CANCELLED' });
  assert.deepEqual(during.updates, []);
  const retry = host({ transact: async callback => {
    await callback({ get: async () => snapshot({ completedLevel: 0 }), update: () => {} });
    current = false;
    return callback({ get: async () => assert.fail('stale retry must not read'), update: () => assert.fail('stale retry must not write') });
  } });
  current = true;
  await assert.rejects(retry.transport.save('fixture-owner', 1, () => current), { code: 'COURSE_CANCELLED' });
});

test('an account transition at final transaction settlement rejects the stale acknowledgment', async () => {
  let current = true;
  const h = host({ transact: async callback => {
    const result = await callback({ get: async () => snapshot({ completedLevel: 0 }), update: () => {} });
    current = false; return result;
  } });
  await assert.rejects(h.transport.save('fixture-owner', 1, () => current), { code: 'COURSE_CANCELLED' });
});

test('Firebase errors retain only a safe code and generic message', async () => {
  const secret = 'dummy-credential-not-for-output';
  const h = host({ read: () => { throw Object.assign(new Error(secret), { code: 'permission-denied', user: { token: secret } }); },
    transact: () => { throw Object.assign(new Error(secret), { code: 'unavailable', private: secret }); } });
  for (const [action, code] of [[() => h.transport.read('fixture-owner'), 'permission-denied'], [() => h.transport.save('fixture-owner', 1), 'unavailable']]) {
    await assert.rejects(action(), error => {
      assert.equal(error.code, code); assert.doesNotMatch(error.message, /dummy-credential/);
      assert.equal(error.cause, undefined); assert.equal(error.user, undefined); assert.equal(error.private, undefined); return true;
    });
  }
  const errors = []; h.transport.observe('fixture-owner', () => {}, e => errors.push(e));
  h.error(Object.assign(new Error(secret), { code: secret, token: secret }));
  assert.equal(errors[0].code, 'COURSE_UNAVAILABLE'); assert.doesNotMatch(errors[0].message, /dummy-credential/);
});
