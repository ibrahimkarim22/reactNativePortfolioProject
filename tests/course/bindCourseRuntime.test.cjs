const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function bind(source, owner) {
  const file = path.resolve(__dirname, '../../course/bindCourseRuntime.js');
  assert.ok(fs.existsSync(file), 'the production runtime binding must exist');
  return require(file).bindCourseRuntime(source, owner);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const h = { owner: Object.freeze({ uid: 'fixture-a', generation: 0 }), calls: [], level: 2,
    acknowledgement: Object.freeze({ completedLevel: 3, advanced: true }) };
  h.source = {
    subscribe: listener => { h.calls.push(['subscribe', listener]); return () => h.calls.push(['unsubscribe']); },
    getOwner: () => h.owner,
    getSnapshot: () => ({ owner: h.owner, completedLevel: h.level }),
    getLevel: () => { h.calls.push(['level']); return h.level; },
    saveProgress: async (...args) => { h.calls.push(['save', ...args]); return h.save ? h.save(...args) : h.acknowledgement; },
    commitLevel: level => { h.calls.push(['commit', level]); h.level = level; },
    refresh: () => { h.calls.push(['refresh']); return 'refreshed'; },
  };
  return h;
}
const cancelled = error => error instanceof Error && error.code === 'COURSE_CANCELLED';

test('binding shares source observers without creating or disposing a persistence session', async () => {
  const h = fixture(), runtime = bind(h.source);
  assert.ok(Object.isFrozen(runtime));
  assert.equal(runtime.subscribe, h.source.subscribe);
  assert.equal(runtime.getOwner, h.source.getOwner);
  assert.equal(runtime.getSnapshot, h.source.getSnapshot);
  assert.equal(runtime.getOwner(), h.owner);
  assert.equal(runtime.dispose, undefined);
  const listener = () => {}, unsubscribe = runtime.subscribe(listener); unsubscribe();
  assert.deepEqual(h.calls, [['subscribe', listener], ['unsubscribe']]);
  assert.equal(runtime.getLevel(), 2);
  const acknowledgement = await runtime.saveProgress('fixture-a', 3);
  assert.equal(acknowledgement, h.acknowledgement);
  assert.ok(Object.isFrozen(acknowledgement));
  runtime.commitLevel(3); assert.equal(h.level, 3);
});

test('captured ownership values are immutable even if the caller supplied a mutable object', async () => {
  const h = fixture(), owner = { ...h.owner }, runtime = bind(h.source, owner);
  owner.uid = 'fixture-b'; owner.generation = 9;
  assert.equal(runtime.getLevel(), 2);
  assert.equal(await runtime.saveProgress('fixture-a', 3), h.acknowledgement);
  assert.equal(h.calls.filter(call => call[0] === 'save').length, 1);
});

test('a different requested owner cannot use an otherwise current binding', async () => {
  const h = fixture(), runtime = bind(h.source);
  await assert.rejects(runtime.saveProgress('fixture-b', 3), error => {
    assert.equal(error.code, 'COURSE_CANCELLED');
    assert.doesNotMatch(error.message, /fixture-a|fixture-b/);
    return true;
  });
  assert.deepEqual(h.calls, []);
});

for (const [name, next] of [
  ['account change', { uid: 'fixture-b', generation: 1 }],
  ['same-account new generation', { uid: 'fixture-a', generation: 2 }],
  ['sign out', { uid: null, generation: 1 }],
]) test('a retired binding after ' + name + ' cannot read, commit, save or refresh another session', async () => {
  const h = fixture(), runtime = bind(h.source); h.owner = Object.freeze(next);
  assert.equal(runtime.getLevel(), null);
  assert.throws(() => runtime.commitLevel(3), cancelled);
  assert.throws(() => runtime.refresh(), cancelled);
  await assert.rejects(runtime.saveProgress('fixture-a', 3), cancelled);
  assert.deepEqual(h.calls, []);
  assert.equal(runtime.getOwner(), h.owner, 'the controller can observe the new owner and retire its attempt');
});

test('an A-to-B-to-A transition retires the original binding even when the uid returns', async () => {
  const h = fixture(), runtime = bind(h.source);
  h.owner = { uid: 'fixture-b', generation: 1 };
  h.owner = { uid: 'fixture-a', generation: 2 };
  assert.equal(runtime.getLevel(), null);
  await assert.rejects(runtime.saveProgress('fixture-a', 3), cancelled);
  assert.throws(() => runtime.commitLevel(3), cancelled);
  assert.deepEqual(h.calls, []);
});

for (const [name, next] of [
  ['a different account', { uid: 'fixture-b', generation: 1 }],
  ['a same-account generation cycle', { uid: 'fixture-a', generation: 2 }],
]) test('a late acknowledgement after ' + name + ' cannot escape the retired binding', async () => {
  const h = fixture(), gate = deferred(); h.save = () => gate.promise;
  const runtime = bind(h.source), pending = runtime.saveProgress('fixture-a', 3);
  assert.deepEqual(h.calls, [['save', 'fixture-a', 3]]);
  h.owner = Object.freeze(next); gate.resolve(h.acknowledgement);
  await assert.rejects(pending, cancelled);
  assert.deepEqual(h.calls, [['save', 'fixture-a', 3]]);
});

test('a late error from a retired account becomes generic cancellation', async () => {
  const h = fixture(), gate = deferred(); h.save = () => gate.promise;
  const runtime = bind(h.source), pending = runtime.saveProgress('fixture-a', 3);
  h.owner = { uid: 'fixture-b', generation: 1 };
  gate.reject(new Error('old fixture transport error'));
  await assert.rejects(pending, error => cancelled(error) && !/old fixture/.test(error.message));
});

test('a current account transport error remains a genuine save failure', async () => {
  const h = fixture(), error = new Error('fixture save failed');
  h.save = async () => { throw error; };
  await assert.rejects(bind(h.source).saveProgress('fixture-a', 3), received => received === error);
});

test('refresh delegates only while current and remains optional', () => {
  const h = fixture(), runtime = bind(h.source);
  assert.equal(runtime.refresh(), 'refreshed'); assert.deepEqual(h.calls, [['refresh']]);
  delete h.source.refresh;
  assert.equal(bind(h.source).refresh, undefined);
});
