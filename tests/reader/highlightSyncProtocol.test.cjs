const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const modulePath = path.resolve(__dirname, '../../reader/highlightSyncProtocol.js');
const protocol = fs.existsSync(modulePath) ? require(modulePath) : {};
const version = 'a'.repeat(64);
const canonical = { workId: 'hamlet', contentVersion: version, canonicalTextVersion: '1', text: 'Echo\n\nEcho onward', units: [
  { id: 'a', sectionId: 'scene-1', start: 0, textEnd: 4, end: 6 }, { id: 'b', sectionId: 'scene-2', start: 6, textEnd: 17, end: 17 },
] };
function selection(start = 0, end = 4) {
  const first = start < 6 ? canonical.units[0] : canonical.units[1], last = end <= 6 ? canonical.units[0] : canonical.units[1];
  return { kind: 'text-range', workId: 'hamlet', contentVersion: version, canonicalTextVersion: '1', offsetUnit: 'utf16', start, end,
    startRef: { textId: first.id, sectionId: first.sectionId, offsetUtf16: start - first.start }, endRef: { textId: last.id, sectionId: last.sectionId, offsetUtf16: end - last.start },
    exact: canonical.text.slice(start, end), prefix: canonical.text.slice(Math.max(0, start - 32), start), suffix: canonical.text.slice(end, end + 32) };
}
function operation(changes = {}) { return { schemaVersion: 1, operationId: 'op-1', uid: 'account-A', workId: 'hamlet', cloudKey: `h1_${version}_1_0_4`, kind: 'create', selectionRef: selection(), colorId: 'sage', generation: 1, baseRevision: 0, ...changes }; }
const timestamp = { seconds: 100, nanoseconds: 0 };
function plan(op, prior = {}) { return protocol.planServerMutation({ operation: op, cloud: null, metadata: null, receipt: null, serverTimestamp: timestamp, ...prior }); }

test('canonical identity distinguishes repeated quotations and rejects forged immutable endpoints', () => {
  assert.equal(typeof protocol.cloudKeyFor, 'function');
  assert.equal(protocol.cloudKeyFor(selection(), canonical), `h1_${version}_1_0_4`);
  assert.equal(protocol.cloudKeyFor(selection(6, 10), canonical), `h1_${version}_1_6_10`);
  assert.throws(() => protocol.cloudKeyFor({ ...selection(), startRef: { ...selection().startRef, textId: 'b' } }, canonical));
  for (const change of [{ contentVersion: 'v1' }, { canonicalTextVersion: '2' }, { start: -1 }, { end: 0 }, { extra: true }]) assert.throws(() => protocol.cloudKeyFor({ ...selection(), ...change }));
});

test('operations are immutable copies and reject unsafe paths, extras and a key/reference mismatch', () => {
  assert.equal(typeof protocol.validateOperation, 'function');
  const input = operation(), validated = protocol.validateOperation(input, { canonical });
  assert.deepEqual(validated, input); assert.notEqual(validated.selectionRef, input.selectionRef); assert.equal(Object.isFrozen(validated.selectionRef.startRef), true);
  input.selectionRef.exact = 'lost'; assert.equal(validated.selectionRef.exact, 'Echo');
  for (const change of [{ uid: 'account/A' }, { operationId: '../other' }, { workId: 'other' }, { cloudKey: 'collision' }, { localId: 'private' }, { generation: 0 }, { baseRevision: -1 }, { kind: 'merge' }, { colorId: 'purple' }]) assert.throws(() => protocol.validateOperation(operation(change)));
  const getter = operation(); Object.defineProperty(getter, 'colorId', { enumerable: true, get: () => 'sage' }); assert.throws(() => protocol.validateOperation(getter));
});

test('creation and receipt atomically account for one active immutable record', () => {
  assert.equal(typeof protocol.planServerMutation, 'function');
  const result = plan(operation());
  assert.equal(result.writes, true); assert.equal(result.replayed, false);
  assert.deepEqual(result.metadata, { schemaVersion: 1, activeCount: 1, activeBytes: result.cloud.payloadBytes, revision: 1, lastOperationId: 'op-1' });
  assert.equal(result.cloud.serverRevision, 1); assert.equal(result.cloud.generation, 1); assert.equal(result.cloud.deleted, false);
  assert.equal(result.receipt.resultRevision, 1); assert.equal(result.receipt.metadataRevision, 1); assert.equal(result.receipt.operationId, 'op-1');
  assert.deepEqual(result.receipt.selectionRef, operation().selectionRef); assert.deepEqual(result.cloud.createdAt, timestamp);
  const bytes = Buffer.byteLength(JSON.stringify({ schemaVersion: 1, workId: 'hamlet', selectionRef: selection(), colorId: 'sage' }), 'utf8');
  assert.equal(result.cloud.payloadBytes, bytes);
});

test('lost acknowledgement replay cannot overwrite a later recolor and rejects forged receipt reuse', () => {
  assert.equal(typeof protocol.planServerMutation, 'function');
  const first = plan(operation()), recolor = operation({ operationId: 'op-2', kind: 'recolor', colorId: 'rose', baseRevision: 1 });
  const second = plan(recolor, { cloud: first.cloud, metadata: first.metadata }), repeated = plan(operation(), { ...second, receipt: first.receipt });
  assert.equal(repeated.writes, false); assert.equal(repeated.replayed, true); assert.equal(repeated.cloud.colorId, 'rose'); assert.equal(repeated.cloud.serverRevision, 2);
  assert.equal(repeated.receipt.resultRevision, 1); assert.equal(repeated.receipt.resultColorId, 'sage');
  assert.throws(() => plan(operation({ colorId: 'blue' }), { ...second, receipt: first.receipt }), { code: 'SYNC_RECEIPT_MISMATCH' });
});

test('same-range same-color devices converge but differing recolors require explicit resolution', () => {
  assert.equal(typeof protocol.planServerMutation, 'function');
  const first = plan(operation()), duplicate = plan(operation({ operationId: 'op-duplicate' }), { cloud: first.cloud, metadata: first.metadata });
  assert.equal(duplicate.metadata.activeCount, 1); assert.equal(duplicate.cloud.serverRevision, 2);
  assert.throws(() => plan(operation({ operationId: 'op-conflict', colorId: 'blue' }), { cloud: first.cloud, metadata: first.metadata }), { code: 'SYNC_CONFLICT' });
  const rose = plan(operation({ operationId: 'op-rose', kind: 'recolor', colorId: 'rose', baseRevision: 1 }), { cloud: first.cloud, metadata: first.metadata });
  assert.throws(() => plan(operation({ operationId: 'op-blue', kind: 'recolor', colorId: 'blue', baseRevision: 1 }), { cloud: rose.cloud, metadata: rose.metadata }), { code: 'SYNC_CONFLICT' });
});

test('deletion wins against stale recolor and only observed deliberate recreation advances generation', () => {
  assert.equal(typeof protocol.planServerMutation, 'function');
  const first = plan(operation()), rose = plan(operation({ operationId: 'op-rose', kind: 'recolor', colorId: 'rose', baseRevision: 1 }), { cloud: first.cloud, metadata: first.metadata });
  const removed = plan(operation({ operationId: 'op-remove', kind: 'delete', baseRevision: 1 }), { cloud: rose.cloud, metadata: rose.metadata });
  assert.equal(removed.cloud.deleted, true); assert.equal(removed.cloud.colorId, 'rose'); assert.equal(removed.metadata.activeCount, 0); assert.equal(removed.metadata.activeBytes, 0);
  for (const kind of ['create', 'recolor']) assert.throws(() => plan(operation({ operationId: 'op-stale-' + kind, kind, baseRevision: 1 }), { cloud: removed.cloud, metadata: removed.metadata }), { code: 'SYNC_DELETED' });
  assert.throws(() => plan(operation({ operationId: 'op-bad-recreate', kind: 'recreate', generation: 2, baseRevision: 1 }), { cloud: removed.cloud, metadata: removed.metadata }), { code: 'SYNC_CONFLICT' });
  const recreated = plan(operation({ operationId: 'op-recreate', kind: 'recreate', generation: 2, baseRevision: 3, colorId: 'blue' }), { cloud: removed.cloud, metadata: removed.metadata });
  assert.equal(recreated.cloud.generation, 2); assert.equal(recreated.cloud.serverRevision, 4); assert.equal(recreated.metadata.activeCount, 1);
  assert.throws(() => plan(operation({ operationId: 'op-old-delete', kind: 'delete', baseRevision: 1 }), { cloud: recreated.cloud, metadata: recreated.metadata }), { code: 'SYNC_CONFLICT' });
});

test('independent overlapping ranges remain separate and capacity blocks never evict existing records', () => {
  assert.equal(typeof protocol.planServerMutation, 'function');
  const first = plan(operation()), overlapping = selection(1, 4), op = operation({ operationId: 'overlap', selectionRef: overlapping, cloudKey: `h1_${version}_1_1_4` });
  const next = plan(op, { metadata: first.metadata }); assert.equal(next.metadata.activeCount, 2); assert.equal(next.cloud.selectionRef.start, 1);
  const full = { ...first.metadata, activeCount: 200 };
  assert.throws(() => plan(op, { metadata: full }), { code: 'SYNC_COUNT_LIMIT' }); assert.equal(full.activeCount, 200);
  const byteFull = { ...first.metadata, activeBytes: 524288 };
  assert.throws(() => plan(op, { metadata: byteFull }), { code: 'SYNC_WORK_LIMIT' });
});

test('malformed stored state and collisions fail closed before any mutation is planned', () => {
  assert.equal(typeof protocol.planServerMutation, 'function');
  const first = plan(operation());
  assert.throws(() => plan(operation(), { cloud: { ...first.cloud, selectionRef: { ...first.cloud.selectionRef, exact: 'Else' } }, metadata: first.metadata }), { code: 'SYNC_INVALID_STATE' });
  assert.throws(() => plan(operation(), { cloud: first.cloud, metadata: null }), { code: 'SYNC_INVALID_STATE' });
  assert.throws(() => plan(operation(), { metadata: { ...first.metadata, unexpected: true } }), { code: 'SYNC_INVALID_STATE' });
});

test('server receipt validation rejects impossible results and unresolved timestamp sentinels in stored records', () => {
  const first = plan(operation());
  for (const change of [{ resultGeneration: 2 }, { resultRevision: 0 }, { resultDeleted: true }, { resultColorId: 'rose' }, { resultPayloadBytes: 1 }]) {
    assert.throws(() => protocol.validateReceipt({ ...first.receipt, ...change }, operation()), { code: 'SYNC_RECEIPT_MISMATCH' });
  }
  assert.throws(() => protocol.validateCloudRecord({ ...first.cloud, updatedAt: { _methodName: 'serverTimestamp' } }), { code: 'SYNC_INVALID_STATE' });
  assert.throws(() => plan(operation(), { cloud: null, metadata: null, receipt: first.receipt }), { code: 'SYNC_INVALID_STATE' });
});

test('Firestore map-field reordering cannot turn the same immutable reference into a false collision', () => {
  const first = plan(operation());
  const reordered = Object.fromEntries(Object.entries(first.cloud.selectionRef).reverse());
  reordered.startRef = Object.fromEntries(Object.entries(reordered.startRef).reverse());
  reordered.endRef = Object.fromEntries(Object.entries(reordered.endRef).reverse());
  const duplicate = plan(operation({ operationId: 'other-device' }), { cloud: { ...first.cloud, selectionRef: reordered }, metadata: first.metadata });
  assert.equal(duplicate.cloud.serverRevision, 2); assert.equal(duplicate.metadata.activeCount, 1);
});

test('all 38 verified bundled plays have valid full-endpoint deterministic cloud identities', () => {
  const { buildCanonicalDocument, createSelection } = require('../../shared/contentText');
  const root = path.resolve(__dirname, '../..'), manifest = JSON.parse(fs.readFileSync(path.join(root, 'data/manifest.json'), 'utf8'));
  assert.equal(manifest.plays.length, 38);
  for (const entry of manifest.plays) {
    const playPath = path.join(root, 'data', entry.play), play = JSON.parse(fs.readFileSync(playPath, 'utf8'));
    const sections = play.sections.map(item => JSON.parse(fs.readFileSync(path.resolve(path.dirname(playPath), item.path), 'utf8')));
    const document = buildCanonicalDocument({ play, sections }), unit = document.units.find(item => item.textEnd > item.start);
    const reference = createSelection(document, unit.start, Math.min(unit.start + 4, unit.textEnd));
    const key = protocol.cloudKeyFor(reference, document);
    const op = operation({ workId: document.workId, cloudKey: key, selectionRef: reference });
    assert.equal(protocol.validateOperation(op, { canonical: document }).workId, entry.id);
  }
});
