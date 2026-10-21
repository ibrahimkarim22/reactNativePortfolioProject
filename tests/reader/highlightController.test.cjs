const assert = require('node:assert/strict');
const test = require('node:test');

const identity = { documentId: 'highlight-controller', workId: 'hamlet', contentVersion: 'v1', canonicalTextVersion: '1' };
const canonical = { workId: 'hamlet', contentVersion: 'v1', canonicalTextVersion: '1', text: 'Alpha beta', units: [{ id: 'a', sectionId: 's', start: 0, textEnd: 10, end: 10 }], sections: [{ id: 's', start: 0, end: 10 }] };
const selectionRef = { kind: 'text-range', workId: 'hamlet', contentVersion: 'v1', canonicalTextVersion: '1', offsetUnit: 'utf16', start: 0, end: 5, startRef: { textId: 'a', sectionId: 's', offsetUtf16: 0 }, endRef: { textId: 'a', sectionId: 's', offsetUtf16: 5 }, exact: 'Alpha', prefix: '', suffix: ' beta' };
const record = { id: 'highlight-one', colorId: 'yellow', selectionRef };
function setup(options = {}) {
  const sent = [];
  const controller = require('../../reader/readerHighlightController').createReaderHighlightController({ identity, canonical, send: (kind, payloads) => sent.push({ kind, payloads }), ...options });
  return { controller, sent };
}
function applied(command, changes = {}) {
  const { ownerGeneration, revision } = command.payloads[0];
  return { ...identity, type: 'highlightsApplied', ownerGeneration, revision, status: 'applied', ...changes };
}
function shown(command, changes = {}) {
  const { ownerGeneration, revision, showId, id } = command.payloads[0];
  return { ...identity, type: 'highlightShown', ownerGeneration, revision, showId, id, status: 'applied', ...changes };
}

test('applies only fully resolved references through bounded atomic typed commands', async () => {
  const { controller, sent } = setup();
  const pending = controller.apply([record], 1);
  assert.equal(sent[0].kind, 'apply');
  assert.deepEqual(sent[0].payloads.map(p => p.phase), ['begin', 'chunk', 'commit']);
  assert.deepEqual(sent[0].payloads[1].items, [{ id: record.id, colorId: 'yellow', start: 0, end: 5 }]);
  assert.ok(sent[0].payloads.every(p => JSON.stringify(p).length <= 8192));
  assert.equal(controller.receive(applied(sent[0])), true);
  const ack = await pending;
  assert.equal(ack.status, 'applied');
  assert.equal(Object.isFrozen(ack), true);
  assert.equal(controller.receive(applied(sent[0])), false);
  controller.dispose();
});

test('invalid full reference, color and owner cannot send or supersede valid pending paint', async () => {
  const { controller, sent } = setup();
  const pending = controller.apply([record], 3);
  for (const invalid of [
    { ...record, selectionRef: { ...selectionRef, exact: 'forged' } },
    { ...record, selectionRef: { ...selectionRef, prefix: 'forged' } },
    { ...record, selectionRef: { ...selectionRef, startRef: { ...selectionRef.startRef, textId: 'wrong' } } },
    { ...record, colorId: 'red' }, { ...record, html: '<b>unsafe</b>' },
  ]) await assert.rejects(controller.apply([invalid], 4));
  for (const owner of [0, -1, 1.5, Infinity, '3']) await assert.rejects(controller.apply([], owner));
  assert.equal(sent.length, 1);
  controller.receive(applied(sent[0]));
  await pending; controller.dispose();
});

test('latest apply supersedes pending paint and ignores stale identities, owners, revisions and malformed acks', async () => {
  const { controller, sent } = setup();
  const old = controller.apply([record], 1);
  const cancelled = assert.rejects(old, { code: 'HIGHLIGHT_SUPERSEDED' });
  const pending = controller.apply([], 1);
  await cancelled;
  assert.ok(sent[1].payloads[0].revision > sent[0].payloads[0].revision);
  for (const bad of [applied(sent[0]), applied(sent[1], { documentId: 'old' }), applied(sent[1], { ownerGeneration: 2 }), applied(sent[1], { extra: true }), applied(sent[1], { status: 'success' })]) assert.equal(controller.receive(bad), false);
  assert.equal(controller.receive(JSON.stringify(applied(sent[1]))), true);
  await pending; controller.dispose();
});

test('new owners retire all pending commands and a previous owner cannot return', async () => {
  const { controller, sent } = setup();
  const old = controller.apply([record], 2);
  const cancelled = assert.rejects(old, { code: 'OWNER_CHANGED' });
  const clear = controller.apply([], 3);
  await cancelled;
  assert.equal(controller.receive(applied(sent[0])), false);
  await assert.rejects(controller.apply([record], 2), { code: 'OWNER_STALE' });
  assert.equal(sent.length, 2);
  controller.receive(applied(sent[1])); await clear; controller.dispose();
});

test('show needs acknowledged matching paint and rejects stale or superseded show requests', async () => {
  const { controller, sent } = setup();
  await assert.rejects(controller.show(record, 1), { code: 'HIGHLIGHTS_NOT_APPLIED' });
  const paint = controller.apply([record], 1);
  await assert.rejects(controller.show(record, 1), { code: 'HIGHLIGHTS_NOT_APPLIED' });
  controller.receive(applied(sent[0])); await paint;
  await assert.rejects(controller.show({ ...record, id: 'not-painted' }, 1), { code: 'HIGHLIGHT_NOT_PAINTED' });
  const old = controller.show(record, 1);
  const cancelled = assert.rejects(old, { code: 'HIGHLIGHT_SUPERSEDED' });
  const pending = controller.show(record, 1);
  await cancelled;
  const latest = sent.at(-1);
  assert.equal(latest.kind, 'show');
  assert.ok(latest.payloads[0].showId > sent[1].payloads[0].showId);
  for (const bad of [shown(sent[1]), shown(latest, { id: 'wrong' }), shown(latest, { revision: 999 })]) assert.equal(controller.receive(bad), false);
  controller.receive(shown(latest)); assert.equal((await pending).id, record.id);
  const show = controller.show(record, 1);
  const superseded = assert.rejects(show, { code: 'HIGHLIGHT_SUPERSEDED' });
  const clear = controller.apply([], 1); await superseded;
  controller.receive(applied(sent.at(-1))); await clear; controller.dispose();
});

test('unsupported engines, runtime errors, unavailable sends and bounded timeouts fail explicitly', async () => {
  for (const [status, code] of [['unsupported', 'HIGHLIGHTS_UNSUPPORTED'], ['error', 'HIGHLIGHT_APPLY_FAILED']]) {
    const { controller, sent } = setup();
    const pending = controller.apply([record], 1);
    controller.receive(applied(sent[0], { status }));
    await assert.rejects(pending, { code });
    await assert.rejects(controller.show(record, 1), { code: 'HIGHLIGHTS_NOT_APPLIED' });
    controller.dispose();
  }
  for (const send of [() => false, () => { throw new Error('lost engine'); }]) {
    const { controller } = setup({ send });
    await assert.rejects(controller.apply([], 1), { code: 'SURFACE_UNAVAILABLE' }); controller.dispose();
  }
  const { controller, sent } = setup({ timeoutMs: 10 });
  await assert.rejects(controller.apply([], 1), { code: 'HIGHLIGHT_TIMEOUT' });
  assert.equal(controller.receive(applied(sent[0])), false); controller.dispose();
});

test('dispose rejects pending commands and does not permit late or future work', async () => {
  const { controller, sent } = setup();
  const pending = controller.apply([], 1);
  const cancelled = assert.rejects(pending, { code: 'DISPOSED' });
  controller.dispose(); controller.dispose(); await cancelled;
  assert.equal(controller.receive(applied(sent[0])), false);
  await assert.rejects(controller.apply([], 2), { code: 'DISPOSED' });
  await assert.rejects(controller.show(record, 2), { code: 'DISPOSED' });
  assert.equal(sent.length, 1);
});

test('invalid configuration fails before creating a transport', () => {
  for (const options of [{ identity: { ...identity, documentId: '' } }, { canonical: { ...canonical, contentVersion: 'old' } }, { send: null }, { timeoutMs: 0 }, { timeoutMs: 60001 }, { timeoutMs: Infinity }]) assert.throws(() => setup(options));
});

test('lifecycle invalidation rejects pending work immediately without irreversibly disposing the controller', async () => {
  const { controller, sent } = setup();
  assert.equal(typeof controller.invalidate, 'function');
  const pending = controller.apply([], 1);
  const rejected = assert.rejects(pending, { code: 'DISPOSED' });
  controller.invalidate(); await rejected;
  assert.equal(controller.receive(applied(sent[0])), false);
  const next = controller.apply([], 1);
  assert.ok(sent[1].payloads[0].revision > sent[0].payloads[0].revision);
  controller.receive(applied(sent[1])); await next; controller.dispose();
});
