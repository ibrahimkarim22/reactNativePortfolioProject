const assert = require('node:assert/strict');
const test = require('node:test');

const identity = { documentId: 'doc-controller', workId: 'hamlet', contentVersion: 'v1', canonicalTextVersion: '1' };
const canonical = { workId: 'hamlet', contentVersion: 'v1', canonicalTextVersion: '1', text: 'Alpha beta', units: [{ id: 'a', sectionId: 's', start: 0, textEnd: 10, end: 10 }], sections: [{ id: 's', start: 0, end: 10 }] };
const selection = { kind: 'text-range', workId: 'hamlet', contentVersion: 'v1', canonicalTextVersion: '1', offsetUnit: 'utf16', start: 0, end: 5, startRef: { textId: 'a', sectionId: 's', offsetUtf16: 0 }, endRef: { textId: 'a', sectionId: 's', offsetUtf16: 5 }, exact: 'Alpha', prefix: '', suffix: ' beta' };
function setup(options = {}) {
  const sent = []; const changes = [];
  const controller = require('../../reader/readerSelectionController').createReaderSelectionController({ identity, canonical, send: (kind, payload) => sent.push({ kind, payload }), onChange: message => changes.push(message), ...options });
  return { controller, sent, changes };
}
const response = (command, changes = {}) => ({ ...command.payload, type: 'selectionCapture', selectionSeq: 1, status: 'captured', selection: structuredClone(selection), ...changes });
const provisional = (selectionSeq, state = 'range', selectionRequestId = 0) => ({ ...identity, type: 'selectionChange', selectionRequestId, selectionSeq, state });

test('each action requests a fresh immutable validated capture without caching a previous quotation', async () => {
  const { controller, sent } = setup();
  const first = controller.capture();
  assert.equal(sent[0].kind, 'capture');
  const reply = response(sent[0]);
  assert.equal(controller.receive(reply), true);
  const snapshot = await first;
  assert.deepEqual(snapshot, { documentId: identity.documentId, captureToken: sent[0].payload.captureToken, selectionSeq: 1, selection });
  for (const value of [snapshot, snapshot.selection, snapshot.selection.startRef, snapshot.selection.endRef]) assert.equal(Object.isFrozen(value), true);
  reply.selection.exact = 'changed'; assert.equal(snapshot.selection.exact, 'Alpha');
  const second = controller.capture();
  assert.equal(sent[1].payload.selectionRequestId, 2);
  assert.notEqual(sent[1].payload.captureToken, sent[0].payload.captureToken);
  controller.receive(response(sent[1], { selectionSeq: 2, status: 'rejected', selection: undefined, code: 'NO_SELECTION' }));
  await assert.rejects(second, { code: 'NO_SELECTION' });
  controller.dispose();
});

test('queued provisional notifications do not cancel a synchronous capture of the current live range', async () => {
  const { controller, sent, changes } = setup();
  const pending = controller.capture();
  assert.equal(controller.receive(provisional(3)), true);
  assert.equal(controller.receive(provisional(2)), false);
  assert.equal(controller.receive(response(sent[0], { selectionSeq: 4 })), true);
  assert.equal((await pending).selectionSeq, 4);
  assert.equal(changes.length, 1);
  assert.equal(Object.isFrozen(changes[0]), true);
  controller.dispose();
});

test('responses older than an observed selection revision never resolve the pending capture', async () => {
  const { controller, sent } = setup();
  const pending = controller.capture();
  controller.receive(provisional(5));
  assert.equal(controller.receive(response(sent[0], { selectionSeq: 4 })), false);
  assert.equal(controller.receive(response(sent[0], { selectionSeq: 5 })), true);
  assert.equal((await pending).selectionSeq, 5);
  controller.dispose();
});

test('runtime clear notifications immediately cancel pending captures before stale responses arrive', async () => {
  const { controller, sent, changes } = setup();
  const pending = controller.capture();
  const cancelled = assert.rejects(pending, { code: 'CANCELLED' });
  assert.equal(controller.receive({ ...provisional(2, 'none'), code: 'CLEARED' }), true);
  const staleAccepted = controller.receive(response(sent[0], { selectionSeq: 2 }));
  await cancelled;
  assert.equal(staleAccepted, false);
  assert.equal(changes[0].state, 'none');
  assert.equal(changes[0].code, 'CLEARED');
  controller.dispose();
});

test('new capture cancels old pending work and rejects stale request identifiers and tokens', async () => {
  const { controller, sent } = setup();
  const old = controller.capture(); const rejected = assert.rejects(old, { code: 'CAPTURE_SUPERSEDED' });
  const pending = controller.capture(); await rejected;
  assert.equal(controller.receive(response(sent[0])), false);
  assert.equal(controller.receive(response(sent[1], { captureToken: sent[0].payload.captureToken })), false);
  assert.equal(controller.receive(response(sent[1])), true);
  await pending; controller.dispose();
});

test('clear invalidates native pending requests synchronously before the runtime processes its command', async () => {
  const { controller, sent } = setup();
  const pending = controller.capture(); const rejected = assert.rejects(pending, { code: 'CANCELLED' });
  controller.clear('modal');
  assert.deepEqual(sent[1], { kind: 'clear', payload: { ...identity, selectionRequestId: 2, reason: 'modal' } });
  assert.equal(controller.receive(response(sent[0])), false);
  await rejected;
  const next = controller.capture(); assert.equal(sent[2].payload.selectionRequestId, 3);
  controller.receive(response(sent[2])); await next; controller.dispose();
});

test('native clear immediately publishes immutable empty state and blocks queued ranges from older requests', () => {
  const { controller, changes } = setup();
  assert.equal(controller.receive(provisional(1)), true);
  controller.clear('modal');
  assert.deepEqual(changes[1], {
    ...identity, type: 'selectionChange', selectionRequestId: 1, selectionSeq: 1,
    state: 'none', code: 'CLEARED', origin: 'native',
  });
  assert.equal(Object.isFrozen(changes[1]), true);
  assert.equal(controller.receive(provisional(100, 'range', 0)), false);
  assert.equal(controller.receive(provisional(101, 'range', 2)), false);
  assert.equal(changes.length, 2);
  assert.equal(controller.receive(provisional(2, 'range', 1)), true);
  assert.equal(changes[2].state, 'range');
  controller.clear('contents');
  assert.equal(controller.receive(provisional(3, 'range', 1)), false);
  controller.dispose();
});

test('native clear publishes its own initial empty state even when the runtime is unavailable', () => {
  const { controller, changes } = setup({ send: () => { throw new Error('unavailable'); } });
  controller.clear('appearance');
  assert.deepEqual(changes[0], {
    ...identity, type: 'selectionChange', selectionRequestId: 1, selectionSeq: 0,
    state: 'none', code: 'CLEARED', origin: 'native',
  });
  assert.equal(Object.isFrozen(changes[0]), true);
  assert.equal(controller.receive(provisional(1, 'range', 0)), false);
  assert.equal(controller.receive(provisional(1, 'none', 1)), true);
  controller.dispose();
});

test('document replacement uses a new controller and tokens cannot collide or cross its identity', async () => {
  const first = setup(); const second = setup();
  const old = first.controller.capture(); const oldRejected = assert.rejects(old, { code: 'DISPOSED' });
  first.controller.dispose(); await oldRejected;
  const pending = second.controller.capture();
  assert.notEqual(first.sent[0].payload.captureToken, second.sent[0].payload.captureToken);
  assert.equal(second.controller.receive(response(first.sent[0])), false);
  assert.equal(second.controller.receive(response(second.sent[0], { documentId: 'replaced' })), false);
  second.controller.receive(response(second.sent[0])); await pending; second.controller.dispose();
});

test('dispose cancels captures, ignores late messages and prevents future commands', async () => {
  const { controller, sent } = setup();
  const pending = controller.capture(); const rejected = assert.rejects(pending, { code: 'DISPOSED' });
  controller.dispose(); controller.dispose(); await rejected;
  assert.equal(controller.receive(response(sent[0])), false);
  await assert.rejects(controller.capture(), { code: 'DISPOSED' });
  controller.clear('cancel'); assert.equal(sent.length, 1);
});

test('controller independently rejects forged references, unknown keys and revision identities', async () => {
  const { controller, sent, changes } = setup();
  const pending = controller.capture();
  for (const malformed of [
    response(sent[0], { selection: { ...selection, exact: 'beta' } }),
    response(sent[0], { selection: { ...selection, prefix: 'forged' } }),
    response(sent[0], { workId: 'other' }), response(sent[0], { extra: true }),
    response(sent[0], { selection: { ...selection, startRef: { textId: 'wrong', sectionId: 's', offsetUtf16: 0 } } }),
  ]) assert.equal(controller.receive(malformed), false);
  assert.equal(controller.receive({ ...provisional(20), exact: 'leaked' }), false);
  assert.equal(changes.length, 0);
  controller.receive(response(sent[0])); await pending; controller.dispose();
});

test('capture timeout fails closed and late responses cannot resurrect a snapshot', async () => {
  const { controller, sent } = setup({ timeoutMs: 10 });
  await assert.rejects(controller.capture(), { code: 'CAPTURE_TIMEOUT' });
  assert.equal(controller.receive(response(sent[0])), false);
  controller.dispose();
});

test('unavailable surface and synchronous command failures reject instead of retaining pending captures', async () => {
  for (const send of [() => false, () => { throw new Error('webview lost'); }]) {
    const { controller } = setup({ send });
    await assert.rejects(controller.capture(), { code: 'SURFACE_UNAVAILABLE' }); controller.dispose();
  }
});

test('invalid controller configuration and clear reasons fail before issuing commands', () => {
  for (const options of [{ canonical: { ...canonical, contentVersion: 'old' } }, { identity: { ...identity, documentId: '' } }, { timeoutMs: 0 }, { timeoutMs: Infinity }, { timeoutMs: 60001 }, { send: undefined }, { onChange: 1 }]) assert.throws(() => setup(options));
  const { controller, sent } = setup();
  assert.throws(() => controller.clear('unbounded arbitrary reason'));
  assert.equal(sent.length, 0); controller.dispose();
});
