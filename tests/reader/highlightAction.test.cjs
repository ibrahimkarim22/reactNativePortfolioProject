const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function snapshot(exact = 'A horse!', documentId = 'doc-1') {
  return Object.freeze({ documentId, captureToken: 'capture-1', selectionSeq: 2, selection: Object.freeze({
    kind: 'selection', workId: 'richard-iii', contentVersion: 'fixture-v1', canonicalTextVersion: '1', offsetUnit: 'utf16',
    exact, start: 5, end: 5 + exact.length, prefix: '     ', suffix: '\n',
    startRef: Object.freeze({ sectionId: 'scene-1', textId: 'line-1', offsetUtf16: 5 }),
    endRef: Object.freeze({ sectionId: 'scene-1', textId: 'line-1', offsetUtf16: 5 + exact.length }),
  }) });
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
function host() {
  const file = path.resolve(__dirname, '../../reader/readerHighlightAction.js');
  assert.ok(fs.existsSync(file), 'the highlight activation controller exists');
  const { createHighlightAction } = require(file);
  const requests = [], opened = [], lists = [], errors = [];
  let scope = { documentId: 'doc-1', ownerGeneration: 1, uid: 'reader-a', workId: 'richard-iii' };
  const action = createHighlightAction({
    capture() { const pending = deferred(); requests.push(pending); return pending.promise; },
    getScope: () => scope,
    onPicker: (value, owner) => opened.push({ value, owner }),
    onList: owner => lists.push(owner), onError: error => errors.push(error),
  });
  return { action, requests, opened, lists, errors, scope: value => { scope = value; }, getScope: () => scope };
}

test('press-in synchronously captures but opens only after intentional activation and validated receipt', async () => {
  const h = host(); const token = h.action.begin('highlight');
  assert.equal(h.requests.length, 1, 'capture precedes any UI/focus callback');
  assert.deepEqual(h.opened, []);
  const receipt = snapshot(); h.requests[0].resolve(receipt); await settle();
  assert.deepEqual(h.opened, [], 'resolved preparation is not an activation');
  h.action.activate('highlight', token);
  assert.equal(h.opened.length, 1);
  assert.equal(h.opened[0].value, receipt, 'the complete validated Stage 2 snapshot survives unchanged');
  assert.ok(Object.isFrozen(h.opened[0].value.selection.startRef));
  assert.ok(Object.isFrozen(h.opened[0].owner));
  h.action.activate('highlight', token);
  assert.equal(h.opened.length, 1, 'one gesture delivers once');
});

test('activation waits for its fresh receipt and freezes Highlight meaning across selection collapse', async () => {
  const h = host(); const token = h.action.begin('highlight');
  h.action.activate('list', token);
  assert.deepEqual(h.lists, []);
  assert.deepEqual(h.opened, []);
  h.requests[0].resolve(snapshot()); await settle();
  assert.equal(h.opened.length, 1);
  assert.deepEqual(h.lists, []);
});

test('list mode also requires activation and cannot turn into Highlight during the gesture', () => {
  const h = host(); const token = h.action.begin('list');
  assert.deepEqual(h.lists, []); assert.deepEqual(h.requests, []);
  h.action.activate('highlight', token);
  assert.equal(h.lists.length, 1); assert.deepEqual(h.requests, []);
});

test('cancelled, invalidated, disposed, or superseded captures and late activations open nothing', async () => {
  for (const operation of ['cancel', 'invalidate', 'dispose', 'supersede']) {
    const h = host(); const token = h.action.begin('highlight');
    if (operation === 'supersede') h.action.begin('list'); else h.action[operation]();
    h.action.activate('list', token);
    h.requests[0].resolve(snapshot('Stale quotation')); await settle();
    assert.deepEqual(h.opened, [], operation); assert.deepEqual(h.lists, [], operation); assert.deepEqual(h.errors, [], operation);
  }
});

test('late activation without a live begin cannot capture or open the list', () => {
  const h = host(); h.action.activate('list');
  const token = h.action.begin('highlight'); h.action.cancel(token); h.action.activate('list');
  assert.deepEqual(h.lists, []); assert.equal(h.requests.length, 1);
});

test('each document, owner generation, account, or work change retires old captures and lists', async () => {
  for (const change of [{ documentId: 'doc-2' }, { ownerGeneration: 2 }, { uid: 'reader-b' }, { workId: 'hamlet' }]) {
    for (const mode of ['highlight', 'list']) {
      const h = host(); const token = h.action.begin(mode);
      h.scope({ ...h.getScope(), ...change }); h.action.activate(mode, token);
      if (mode === 'highlight') h.requests[0].resolve(snapshot());
      await settle(); assert.deepEqual(h.opened, []); assert.deepEqual(h.lists, []); assert.deepEqual(h.errors, []);
    }
  }
});

test('a receipt for a replacement document fails without opening or reusing an older quotation', async () => {
  const h = host(); h.action.accessibilityActivate('highlight');
  h.requests[0].resolve(snapshot()); await settle(); assert.equal(h.opened.length, 1);
  h.action.accessibilityActivate('highlight');
  h.requests[1].resolve(snapshot('Wrong document', 'doc-2')); await settle();
  assert.equal(h.opened.length, 1); assert.equal(h.errors[0].code, 'DOCUMENT_CHANGED');
});

test('capture errors are reported only for an intentional current activation and never fall back to a stale quote', async () => {
  const h = host(); const token = h.action.begin('highlight');
  const error = Object.assign(new Error('No live selection'), { code: 'NO_SELECTION' });
  h.requests[0].reject(error); await settle(); assert.deepEqual(h.errors, []);
  h.action.activate('highlight', token); assert.equal(h.errors[0], error); assert.deepEqual(h.opened, []);
  h.action.accessibilityActivate('highlight'); h.action.cancel();
  h.requests[1].reject(error); await settle(); assert.equal(h.errors.length, 1);
});

test('accessibility activation captures synchronously without any touch dependency and supersedes old preparation', async () => {
  const h = host(); h.action.begin('highlight'); h.action.accessibilityActivate('highlight');
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve(snapshot('Accessible selection')); await settle();
  h.requests[0].resolve(snapshot('Old touch')); await settle();
  assert.deepEqual(h.opened.map(entry => entry.value.selection.exact), ['Accessible selection']);
  h.action.accessibilityActivate('list'); assert.equal(h.lists.length, 1);
});

test('synchronous capture failure is buffered until activation and disposed controllers cannot restart', () => {
  const file = path.resolve(__dirname, '../../reader/readerHighlightAction.js');
  assert.ok(fs.existsSync(file), 'the highlight activation controller exists');
  const error = new Error('Capture unavailable'), errors = [];
  const action = require(file).createHighlightAction({ capture() { throw error; }, getScope: () => ({ documentId: 'doc', ownerGeneration: 1 }), onError: value => errors.push(value) });
  const token = action.begin('highlight'); assert.deepEqual(errors, []);
  action.activate('highlight', token); assert.deepEqual(errors, [error]);
  action.dispose(); assert.equal(action.begin('highlight'), null); action.accessibilityActivate('list');
});

test('empty rejection reasons still fail closed and cannot be mistaken for a successful empty receipt', async () => {
  for (const reason of [undefined, null, false]) {
    const h = host(); h.action.accessibilityActivate('highlight'); h.requests[0].reject(reason); await settle();
    assert.deepEqual(h.opened, []); assert.equal(h.errors.length, 1); assert.equal(h.errors[0].code, 'CAPTURE_FAILED');
  }
});
