const assert = require('node:assert/strict');
const test = require('node:test');

test('shared highlight ownership stays pending until auth confirms and retires A to B to A generations', () => {
  const { createHighlightOwner } = require('../../reader/highlightOwner');
  let auth, failed, subscriptions = 0;
  const owner = createHighlightOwner({ observe: (next, error) => { subscriptions++; auth = next; failed = error; return () => subscriptions--; } });
  assert.deepEqual(owner.getSnapshot(), { uid: null, generation: 0, ready: false });
  const release = owner.acquire();
  const releaseSecond = owner.acquire();
  assert.equal(subscriptions, 1);
  auth({ uid: 'a' }); const a = owner.getSnapshot();
  auth({ uid: 'a' }); assert.equal(owner.getSnapshot(), a, 'duplicate auth notifications preserve one activation');
  auth({ uid: 'b' }); const b = owner.getSnapshot();
  auth({ uid: 'a' }); const returned = owner.getSnapshot();
  assert.ok(a.generation < b.generation && b.generation < returned.generation);
  assert.equal(returned.uid, 'a'); assert.equal(returned.ready, true);
  failed(new Error('auth unavailable'));
  assert.equal(owner.getSnapshot().uid, null);
  assert.equal(owner.getSnapshot().ready, true);
  release(); assert.equal(subscriptions, 1);
  releaseSecond(); assert.equal(subscriptions, 0);
  assert.equal(owner.getSnapshot().ready, false);
  auth({ uid: 'a' }); assert.equal(owner.getSnapshot().ready, false, 'retired callback cannot restore old ownership');
});

test('ownership listeners clear visible state synchronously and unobserved gaps invalidate requests', () => {
  const { createHighlightOwner } = require('../../reader/highlightOwner');
  const callbacks = [];
  const owner = createHighlightOwner({ observe: next => { callbacks.push(next); return () => {}; } });
  let seen;
  const unsubscribe = owner.subscribe(() => { seen = owner.getSnapshot(); });
  const release = owner.acquire(); callbacks[0]({ uid: 'a' }); const initial = seen;
  callbacks[0](null); assert.equal(seen.uid, null);
  release(); const nextRelease = owner.acquire(); callbacks[1]({ uid: 'a' });
  assert.ok(seen.generation > initial.generation);
  assert.ok(Object.isFrozen(seen));
  unsubscribe(); nextRelease();
});
