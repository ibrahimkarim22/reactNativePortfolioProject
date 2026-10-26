const { LIMITS, HIGHLIGHT_PALETTE, validateSelectionRef, utf8Length } = require('./readerHighlights');

const OPERATION_FIELDS = ['schemaVersion', 'operationId', 'uid', 'workId', 'cloudKey', 'kind', 'selectionRef', 'colorId', 'generation', 'baseRevision'];
const CLOUD_FIELDS = ['schemaVersion', 'workId', 'selectionRef', 'colorId', 'generation', 'serverRevision', 'deleted', 'payloadBytes', 'lastOperationId', 'createdAt', 'updatedAt'];
const METADATA_FIELDS = ['schemaVersion', 'activeCount', 'activeBytes', 'revision', 'lastOperationId'];
const RECEIPT_FIELDS = [...OPERATION_FIELDS, 'resultGeneration', 'resultRevision', 'resultDeleted', 'resultColorId', 'resultPayloadBytes', 'metadataRevision', 'createdAt'];
const SELECTION_FIELDS = ['kind', 'workId', 'contentVersion', 'canonicalTextVersion', 'offsetUnit', 'start', 'end', 'startRef', 'endRef', 'exact', 'prefix', 'suffix'];
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const natural = value => Number.isSafeInteger(value) && value >= 0;
const positive = value => natural(value) && value > 0;
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const pathPart = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\/\u0000-\u001f]/.test(value) && value !== '.' && value !== '..';
const operationId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const color = value => typeof value === 'string' && Object.prototype.hasOwnProperty.call(HIGHLIGHT_PALETTE, value);
function exact(value, keys) { return record(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && descriptor.enumerable && Object.prototype.hasOwnProperty.call(descriptor, 'value');
}); }
function syncError(code) { const error = new Error('Highlight synchronization could not complete: ' + code + '.'); error.code = code; return error; }
function reject(code = 'SYNC_INVALID_OPERATION') { throw syncError(code); }
function selectionShape(value) {
  if (!exact(value, SELECTION_FIELDS) || value.kind !== 'text-range' || !pathPart(value.workId)
      || typeof value.contentVersion !== 'string' || !/^[a-f0-9]{64}$/.test(value.contentVersion) || value.canonicalTextVersion !== '1' || value.offsetUnit !== 'utf16'
      || !natural(value.start) || !positive(value.end) || value.end <= value.start || value.end - value.start > LIMITS.MAX_SELECTION_UTF16
      || typeof value.exact !== 'string' || value.exact.length !== value.end - value.start || typeof value.prefix !== 'string' || value.prefix.length > 32
      || typeof value.suffix !== 'string' || value.suffix.length > 32) reject();
  for (const endpoint of [value.startRef, value.endRef]) {
    if (!exact(endpoint, ['textId', 'sectionId', 'offsetUtf16']) || !identifier(endpoint.textId) || !identifier(endpoint.sectionId) || !natural(endpoint.offsetUtf16)) reject();
  }
  const endpoint = ref => Object.freeze({ textId: ref.textId, sectionId: ref.sectionId, offsetUtf16: ref.offsetUtf16 });
  return Object.freeze({ kind: value.kind, workId: value.workId, contentVersion: value.contentVersion, canonicalTextVersion: value.canonicalTextVersion, offsetUnit: value.offsetUnit,
    start: value.start, end: value.end, startRef: endpoint(value.startRef), endRef: endpoint(value.endRef), exact: value.exact, prefix: value.prefix, suffix: value.suffix });
}
function cloudKeyFor(value, canonical) {
  const selection = selectionShape(value);
  if (canonical) validateSelectionRef(selection, canonical);
  return 'h1_' + selection.contentVersion + '_' + selection.canonicalTextVersion + '_' + selection.start + '_' + selection.end;
}
function validateOperation(value, { canonical } = {}) {
  if (!exact(value, OPERATION_FIELDS) || value.schemaVersion !== 1 || !operationId(value.operationId) || !pathPart(value.uid) || !pathPart(value.workId)
      || !['create', 'recolor', 'delete', 'recreate'].includes(value.kind) || !color(value.colorId) || !positive(value.generation) || !natural(value.baseRevision)) reject();
  const selectionRef = selectionShape(value.selectionRef);
  if (selectionRef.workId !== value.workId || cloudKeyFor(selectionRef, canonical) !== value.cloudKey) reject();
  return Object.freeze({ ...value, selectionRef });
}
function payloadBytesFor(value) {
  return utf8Length(JSON.stringify({ schemaVersion: 1, workId: value.workId, selectionRef: value.selectionRef, colorId: value.colorId }));
}
function timestamp(value) {
  return record(value) && Number.isSafeInteger(value.seconds) && natural(value.nanoseconds) && value.nanoseconds < 1000000000;
}
function validateCloudRecord(value, { cloudKey, workId, canonical } = {}) {
  try {
    if (!exact(value, CLOUD_FIELDS) || value.schemaVersion !== 1 || !pathPart(value.workId) || (workId && value.workId !== workId) || !color(value.colorId)
        || !positive(value.generation) || !positive(value.serverRevision) || typeof value.deleted !== 'boolean' || !positive(value.payloadBytes)
        || value.payloadBytes > LIMITS.MAX_RECORD_BYTES || !operationId(value.lastOperationId) || !timestamp(value.createdAt) || !timestamp(value.updatedAt)) reject();
    const selectionRef = selectionShape(value.selectionRef), key = cloudKeyFor(selectionRef, canonical);
    if (selectionRef.workId !== value.workId || (cloudKey && key !== cloudKey) || payloadBytesFor({ ...value, selectionRef }) !== value.payloadBytes) reject();
    return Object.freeze({ ...value, selectionRef });
  } catch (_) { return reject('SYNC_INVALID_STATE'); }
}
function validateMetadata(value) {
  if (!exact(value, METADATA_FIELDS) || value.schemaVersion !== 1 || !natural(value.activeCount) || value.activeCount > LIMITS.MAX_RECORDS
      || !natural(value.activeBytes) || value.activeBytes > LIMITS.MAX_WORK_BYTES || !positive(value.revision) || !operationId(value.lastOperationId)) reject('SYNC_INVALID_STATE');
  return Object.freeze({ ...value });
}
function validateReceipt(value, operation) {
  if (!exact(value, RECEIPT_FIELDS)) reject('SYNC_RECEIPT_MISMATCH');
  let echoed;
  try { echoed = validateOperation(Object.fromEntries(OPERATION_FIELDS.map(key => [key, value[key]]))); } catch (_) { reject('SYNC_RECEIPT_MISMATCH'); }
  if (OPERATION_FIELDS.some(key => JSON.stringify(echoed[key]) !== JSON.stringify(operation[key]))
      || !positive(value.resultGeneration) || !positive(value.resultRevision) || typeof value.resultDeleted !== 'boolean' || !color(value.resultColorId)
      || value.resultGeneration !== operation.generation || value.resultRevision <= operation.baseRevision || value.resultDeleted !== (operation.kind === 'delete')
      || (operation.kind !== 'delete' && value.resultColorId !== operation.colorId)
      || !positive(value.resultPayloadBytes) || value.resultPayloadBytes > LIMITS.MAX_RECORD_BYTES
      || value.resultPayloadBytes !== payloadBytesFor({ ...operation, colorId: value.resultColorId })
      || !positive(value.metadataRevision) || value.metadataRevision < value.resultRevision || !timestamp(value.createdAt)) reject('SYNC_RECEIPT_MISMATCH');
  return Object.freeze({ ...value, selectionRef: echoed.selectionRef });
}

// A retryable Firestore callback calls only this pure planner. It creates no IDs,
// publishes no state and performs no local writes. The caller supplies one server
// timestamp sentinel and writes all three planned documents atomically.
function planServerMutation({ operation: input, cloud: rawCloud = null, metadata: rawMetadata = null, receipt: rawReceipt = null, serverTimestamp }) {
  const operation = validateOperation(input);
  const cloud = rawCloud && validateCloudRecord(rawCloud, { cloudKey: operation.cloudKey, workId: operation.workId });
  const metadata = rawMetadata && validateMetadata(rawMetadata);
  if (cloud && !metadata) reject('SYNC_INVALID_STATE');
  if (cloud && JSON.stringify(cloud.selectionRef) !== JSON.stringify(operation.selectionRef)) reject('SYNC_INVALID_STATE');
  if (rawReceipt) {
    if (!cloud || !metadata) reject('SYNC_INVALID_STATE');
    return Object.freeze({ cloud, metadata, receipt: validateReceipt(rawReceipt, operation), writes: false, replayed: true });
  }
  if (!timestamp(serverTimestamp) && !(record(serverTimestamp) && serverTimestamp._methodName === 'serverTimestamp')) reject('SYNC_INVALID_STATE');
  if (cloud && operation.baseRevision > cloud.serverRevision) reject('SYNC_CONFLICT');
  let deleted = false, colorId = operation.colorId;
  if (!cloud) {
    if (operation.kind !== 'create' || operation.generation !== 1 || operation.baseRevision !== 0) reject('SYNC_CONFLICT');
  } else if (operation.kind === 'recreate') {
    if (!cloud.deleted || operation.generation !== cloud.generation + 1 || operation.baseRevision !== cloud.serverRevision) reject('SYNC_CONFLICT');
  } else {
    if (operation.generation !== cloud.generation) reject('SYNC_CONFLICT');
    if (operation.kind === 'delete') { deleted = true; colorId = cloud.colorId; }
    else {
      if (cloud.deleted) reject('SYNC_DELETED');
      if ((operation.kind === 'create' || operation.baseRevision !== cloud.serverRevision) && operation.colorId !== cloud.colorId) reject('SYNC_CONFLICT');
    }
  }
  const nextCloud = Object.freeze({ schemaVersion: 1, workId: operation.workId, selectionRef: operation.selectionRef, colorId, generation: operation.generation,
    serverRevision: cloud ? cloud.serverRevision + 1 : 1, deleted, payloadBytes: payloadBytesFor({ ...operation, colorId }), lastOperationId: operation.operationId,
    createdAt: cloud ? cloud.createdAt : serverTimestamp, updatedAt: serverTimestamp });
  if (nextCloud.payloadBytes > LIMITS.MAX_RECORD_BYTES) reject('SYNC_RECORD_LIMIT');
  const previousActive = cloud && !cloud.deleted ? 1 : 0, nextActive = deleted ? 0 : 1;
  const activeCount = (metadata ? metadata.activeCount : 0) - previousActive + nextActive;
  const activeBytes = (metadata ? metadata.activeBytes : 0) - (previousActive ? cloud.payloadBytes : 0) + (nextActive ? nextCloud.payloadBytes : 0);
  if (!natural(activeCount) || !natural(activeBytes)) reject('SYNC_INVALID_STATE');
  if (activeCount > LIMITS.MAX_RECORDS) reject('SYNC_COUNT_LIMIT');
  if (activeBytes > LIMITS.MAX_WORK_BYTES) reject('SYNC_WORK_LIMIT');
  const nextMetadata = Object.freeze({ schemaVersion: 1, activeCount, activeBytes, revision: metadata ? metadata.revision + 1 : 1, lastOperationId: operation.operationId });
  const receipt = Object.freeze({ ...operation, resultGeneration: nextCloud.generation, resultRevision: nextCloud.serverRevision, resultDeleted: nextCloud.deleted,
    resultColorId: nextCloud.colorId, resultPayloadBytes: nextCloud.payloadBytes, metadataRevision: nextMetadata.revision, createdAt: serverTimestamp });
  return Object.freeze({ cloud: nextCloud, metadata: nextMetadata, receipt, writes: true, replayed: false });
}

module.exports = { cloudKeyFor, canonicalKey: cloudKeyFor, validateOperation, validateCloudRecord, validateMetadata, validateReceipt, payloadBytesFor, planServerMutation, syncError };
