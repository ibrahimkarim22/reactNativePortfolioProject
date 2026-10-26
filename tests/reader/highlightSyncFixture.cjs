const { buildCanonicalDocument, createSelection } = require('../../shared/contentText');
const canonical = buildCanonicalDocument({ play: { id: 'hamlet', contentVersion: 'a'.repeat(64), canonicalTextVersion: '1', sections: [{ id: 's' }] }, sections: [{ work: { id: 'hamlet' }, contentVersion: 'a'.repeat(64), canonicalTextVersion: '1', section: { id: 's' }, content: [{ id: 'a', text: 'Alpha beta gamma Alpha beta', separatorAfter: '' }] }] });
const ref = (start = 0, end = 5) => createSelection(canonical, start, end);
const legacyRecord = (changes = {}) => ({ schemaVersion: 1, id: 'legacy-id', owner: { kind: 'account', uid: 'alice' }, workId: 'hamlet', selectionRef: ref(), colorId: 'yellow', revision: 1, createdAt: 100, updatedAt: 100, ...changes });
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function storageFixture(initial = {}) {
  const data = new Map(Object.entries(initial)), calls = [];
  const storage = {
    async getAllKeys() { return [...data.keys()]; },
    async getItem(key) { calls.push(['get', key]); return data.get(key) ?? null; },
    async setItem(key, value) { calls.push(['set', key, value]); data.set(key, value); },
    async removeItem(key) { calls.push(['remove', key]); data.delete(key); },
  };
  return { data, calls, storage };
}
function setup(initial = {}, options = {}) {
  const fixture = storageFixture(initial); let sequence = 0, time = 1000;
  const manager = require('../../reader/highlightSyncStore').createHighlightSyncStoreManager(fixture.storage, { namespace: '@bard-test/client-a', makeId: () => 'id-' + ++sequence, now: () => time++, ...options });
  return { ...fixture, manager, store: manager.forWork({ uid: 'alice', canonical }) };
}
function accepted(operation, changes = {}) {
  const generation = operation.generation, revision = operation.baseRevision + 1, deleted = operation.kind === 'delete';
  const payloadBytes = require('../../reader/highlightSyncProtocol').payloadBytesFor(operation), timestamp = { seconds: 100, nanoseconds: 0 };
  const cloud = { schemaVersion: 1, workId: operation.workId, selectionRef: operation.selectionRef, colorId: operation.colorId, generation, serverRevision: revision, deleted, payloadBytes, lastOperationId: operation.operationId, createdAt: timestamp, updatedAt: timestamp, ...changes };
  if (!Object.prototype.hasOwnProperty.call(changes, 'payloadBytes')) cloud.payloadBytes = require('../../reader/highlightSyncProtocol').payloadBytesFor(cloud);
  const receipt = { ...operation, resultGeneration: generation, resultRevision: revision, resultDeleted: deleted, resultColorId: operation.colorId, resultPayloadBytes: payloadBytes, metadataRevision: revision, createdAt: timestamp };
  return { cloud, receipt, metadata: null };
}
module.exports = { canonical, ref, legacyRecord, storageFixture, setup, deferred, accepted };
