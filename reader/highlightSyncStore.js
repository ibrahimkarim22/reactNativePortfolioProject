const policy = require('./readerHighlights');
const { LIMITS, HIGHLIGHT_PALETTE, validateSelectionRef, validateHighlightRecord, classifyRecord, findCreateConflict, findStoredConflicts, utf8Length } = policy;

// This store is deliberately opt-in. Production still uses readerHighlightStore.
const SYNC_STORE_LIMITS = Object.freeze({ MAX_PENDING_PER_RECORD: 16, MAX_PENDING_PER_WORK: 400, MAX_ENVELOPES_PER_WORK: 1000, MAX_ENVELOPE_BYTES: 1048576, MAX_JOURNAL_BYTES: 4194304 });
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const exactKeys = (value, keys) => plain(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && descriptor.enumerable && own(descriptor, 'value');
});
function freeze(value) { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (plain(value)) {
    // Firestore Timestamp.toJSON adds a type tag that is absent from live
    // Timestamp own fields. Compare the exact instant, not that transport tag.
    if (Number.isSafeInteger(value.seconds) && integer(value.nanoseconds) && value.nanoseconds < 1000000000 && Object.keys(value).every(key => ['seconds', 'nanoseconds', 'type'].includes(key)) && (!own(value, 'type') || value.type === 'firestore/timestamp/1.0')) return { seconds: value.seconds, nanoseconds: value.nanoseconds };
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}
const equal = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
function failure(code, message) { return Object.assign(new Error(message || policy.errorMessage(code)), { code }); }
function current(options) { if (options && typeof options.isCurrent === 'function' && !options.isCurrent()) throw failure('CANCELLED'); }
const order = (a, b) => a.selectionRef.start - b.selectionRef.start || a.selectionRef.end - b.selectionRef.end || a.id.localeCompare(b.id);
let sequence = 0;
const defaultId = () => 'hs-' + Date.now().toString(36) + '-' + (++sequence).toString(36) + '-' + Math.random().toString(36).slice(2, 12);
const protocol = () => require('./highlightSyncProtocol');
const ENVELOPE_KEYS = ['schemaVersion', 'cloudKey', 'localIds', 'record', 'deleted', 'generation', 'serverRevision', 'serverRecord', 'pending', 'syncError', 'conflict'];
const CLOUD_PERMANENT = new Set(['permission-denied', 'unauthenticated', 'invalid-argument', 'CONFLICT', 'DELETED', 'CAPACITY', 'COUNT_LIMIT', 'WORK_BYTES_LIMIT', 'INVALID_REMOTE', 'SYNC_CONFLICT', 'SYNC_DELETED', 'SYNC_COUNT_LIMIT', 'SYNC_WORK_LIMIT', 'SYNC_RECORD_LIMIT', 'SYNC_LISTENER_LIMIT', 'SYNC_INVALID_STATE', 'SYNC_INVALID_OPERATION', 'SYNC_RECEIPT_MISMATCH']);

function createHighlightSyncStoreManager(storage, { namespace, makeId = defaultId, now = Date.now } = {}) {
  if (typeof namespace !== 'string' || !/^@bard(?:-test\/|\/reader-highlights-sync:isolated\/)[A-Za-z0-9._/-]+$/.test(namespace) || namespace.endsWith('/')) throw new Error('An explicit isolated namespace is required for highlight synchronization.');
  if (typeof makeId !== 'function' || typeof now !== 'function') throw new Error('Invalid highlight synchronization store configuration.');
  const works = new Map();
  const segment = value => { if (typeof value !== 'string' || !value.length || value.length > 512) throw failure('INVALID_HIGHLIGHT'); return encodeURIComponent(value); };
  const prefixFor = (uid, workId, legacy = false) => namespace + (legacy ? '/legacy/' : '/v2/') + segment(uid) + '/' + segment(workId) + '/';

  function forWork({ uid, canonical }) {
    // Reuse the existing owner/work checks without changing their contract.
    policy.prefixFor(uid, canonical && canonical.workId);
    if (!canonical || typeof canonical.text !== 'string' || !Array.isArray(canonical.units)) throw failure('INVALID_HIGHLIGHT');
    const prefix = prefixFor(uid, canonical.workId), legacyPrefix = prefixFor(uid, canonical.workId, true);
    const scope = { uid, workId: canonical.workId, canonical };
    let shared = works.get(prefix);
    if (!shared) {
      shared = { tail: Promise.resolve(), values: new Map(), originals: new Map(), loaded: false, loading: false, saving: false, blocked: false, needsReload: false, error: null, failedIntent: null, views: new Map() };
      works.set(prefix, shared);
    }
    const viewKey = JSON.stringify([canonical.contentVersion, canonical.canonicalTextVersion]);
    if (shared.views.has(viewKey)) return shared.views.get(viewKey).store;
    const view = { snapshot: null, listeners: new Set(), classify: null, store: null };

    function operationFor(record, kind, generation, baseRevision) {
      return protocol().validateOperation({ schemaVersion: 1, operationId: makeId(), uid, workId: canonical.workId, cloudKey: protocol().cloudKeyFor(record.selectionRef, canonical), kind, selectionRef: record.selectionRef, colorId: record.colorId, generation, baseRevision }, { canonical });
    }
    function validateEnvelope(value, key) {
      if (!exactKeys(value, ENVELOPE_KEYS) || value.schemaVersion !== 2 || typeof value.cloudKey !== 'string' || key !== prefix + value.cloudKey || !Array.isArray(value.localIds) || value.localIds.length < 1 || value.localIds.length > 32 || new Set(value.localIds).size !== value.localIds.length || typeof value.deleted !== 'boolean' || !Number.isSafeInteger(value.generation) || value.generation < 1 || !integer(value.serverRevision) || !Array.isArray(value.pending) || value.pending.length > SYNC_STORE_LIMITS.MAX_PENDING_PER_RECORD) throw failure('INVALID_HIGHLIGHT');
      const record = validateHighlightRecord(value.record, scope);
      if (value.localIds[0] !== record.id || value.localIds.some(id => typeof id !== 'string' || !id.length || id.length > 128) || value.cloudKey !== protocol().cloudKeyFor(record.selectionRef)) throw failure('INVALID_HIGHLIGHT');
      const ids = new Set();
      const pending = value.pending.map(operation => {
        const validated = protocol().validateOperation(operation);
        if (validated.uid !== uid || validated.workId !== canonical.workId || validated.cloudKey !== value.cloudKey || !equal(validated.selectionRef, record.selectionRef) || ids.has(validated.operationId)) throw failure('INVALID_HIGHLIGHT');
        ids.add(validated.operationId); return validated;
      });
      if (value.syncError !== null && (!exactKeys(value.syncError, ['operationId', 'code', 'message', 'retryable']) || typeof value.syncError.operationId !== 'string' || typeof value.syncError.code !== 'string' || typeof value.syncError.message !== 'string' || typeof value.syncError.retryable !== 'boolean')) throw failure('INVALID_HIGHLIGHT');
      if (value.conflict !== null && (!plain(value.conflict) || typeof value.conflict.code !== 'string')) throw failure('INVALID_HIGHLIGHT');
      if (value.serverRecord !== null) {
        protocol().validateCloudRecord(value.serverRecord, { cloudKey: value.cloudKey, workId: canonical.workId });
        if (!equal(value.serverRecord.selectionRef, record.selectionRef)) throw failure('INVALID_HIGHLIGHT');
      }
      if (value.conflict?.cloud) {
        protocol().validateCloudRecord(value.conflict.cloud, { cloudKey: value.cloudKey, workId: canonical.workId });
        if (!equal(value.conflict.cloud.selectionRef, record.selectionRef)) throw failure('INVALID_HIGHLIGHT');
      }
      return freeze({ ...value, record, localIds: value.localIds.slice(), pending });
    }
    function readEnvelope(key, raw) {
      if (typeof raw !== 'string' || utf8Length(raw) > SYNC_STORE_LIMITS.MAX_ENVELOPE_BYTES) throw failure('RECORD_TOO_LARGE');
      return validateEnvelope(JSON.parse(raw), key);
    }
    function validEnvelopes() {
      const values = [];
      for (const [key, raw] of shared.values) { try { values.push([key, readEnvelope(key, raw)]); } catch (_) { /* Retained unavailable metadata is classified below. */ } }
      return values;
    }
    function capacityCode() {
      if (shared.values.size + shared.originals.size > SYNC_STORE_LIMITS.MAX_ENVELOPES_PER_WORK) return 'SYNC_BACKLOG_LIMIT';
      let bytes = 0, recordBytes = 0, active = 0, pending = 0;
      for (const [key, raw] of shared.values) {
        bytes += typeof raw === 'string' ? utf8Length(raw) : raw.bytes;
        try { const envelope = readEnvelope(key, raw); pending += envelope.pending.length; if (!envelope.deleted) { active++; recordBytes += utf8Length(JSON.stringify(envelope.record)); } } catch (_) { active++; recordBytes += typeof raw === 'string' ? utf8Length(raw) : raw.bytes; }
      }
      for (const value of shared.originals.values()) { active++; recordBytes += value.bytes; }
      if (active > LIMITS.MAX_RECORDS) return 'HIGHLIGHT_COUNT_LIMIT';
      if (recordBytes > LIMITS.MAX_WORK_BYTES) return 'WORK_TOO_LARGE';
      if (bytes > SYNC_STORE_LIMITS.MAX_JOURNAL_BYTES || pending > SYNC_STORE_LIMITS.MAX_PENDING_PER_WORK) return 'SYNC_BACKLOG_LIMIT';
      return null;
    }
    function classify() {
      const records = [], unresolved = [], unreadable = [], tombstones = [], syncById = {}, over = capacityCode();
      for (const [key, raw] of shared.values) {
        try {
          if (over) throw failure(over);
          const envelope = readEnvelope(key, raw), result = classifyRecord(envelope.record, scope);
          const status = envelope.conflict ? 'conflict' : envelope.syncError && !envelope.syncError.retryable ? 'failed' : envelope.pending.length ? 'pending' : envelope.serverRevision > 0 ? 'synced' : 'local';
          const sync = freeze({ status, pendingCount: envelope.pending.length, deleted: envelope.deleted, cloudKey: envelope.cloudKey, generation: envelope.generation, serverRevision: envelope.serverRevision, error: envelope.syncError, conflict: envelope.conflict });
          for (const id of envelope.localIds) syncById[id] = sync;
          if (envelope.deleted) tombstones.push(freeze({ id: envelope.record.id, cloudKey: envelope.cloudKey, generation: envelope.generation, serverRevision: envelope.serverRevision, sync }));
          else if (result.status === 'resolved') records.push(result.record);
          else unresolved.push(freeze({ record: result.record, code: result.code }));
        } catch (error) { unreadable.push(freeze({ id: 'unavailable:' + key, key, bytes: typeof raw === 'string' ? utf8Length(raw) : raw.bytes, code: error.code || 'INVALID_HIGHLIGHT' })); }
      }
      for (const [key, value] of shared.originals) {
        if (value.record && !over) unresolved.push(freeze({ record: value.record, code: value.code }));
        else unreadable.push(freeze({ id: 'unavailable:' + key, key, bytes: value.bytes, code: over || value.code }));
      }
      records.sort(order); unresolved.sort((a, b) => order(a.record, b.record));
      const summary = { local: 0, pending: 0, synced: 0, failed: 0, conflict: 0, pendingOperations: 0, deleted: tombstones.length, pendingDeletions: 0, failedDeletions: 0 };
      for (const [, envelope] of validEnvelopes()) { const status = syncById[envelope.record.id]?.status; if (status) summary[status]++; summary.pendingOperations += envelope.pending.length; }
      for (const marker of tombstones) { if (marker.sync.pendingCount) summary.pendingDeletions++; if (['failed', 'conflict'].includes(marker.sync.status)) summary.failedDeletions++; }
      const conflicts = [...new Set([...findStoredConflicts(records, canonical), ...records.filter(record => syncById[record.id]?.status === 'conflict').map(record => record.id)])];
      return freeze({ hydrated: shared.loaded, loading: shared.loading, saving: shared.saving, records, unresolved, unreadable, conflicts, error: shared.error, syncById, syncSummary: summary, tombstones });
    }
    view.classify = classify;
    function publish() {
      for (const other of shared.views.values()) { other.snapshot = other.classify(); for (const listener of other.listeners) { try { listener(); } catch (_) { /* Observers cannot interrupt confirmed write ordering. */ } } }
    }
    function enqueue(run) { const promise = shared.tail.then(run); shared.tail = promise.catch(() => {}); return promise; }
    function storageAvailable() { if (!storage || ['getAllKeys', 'getItem', 'setItem'].some(name => typeof storage[name] !== 'function')) throw failure('STORAGE_UNAVAILABLE'); }
    function setLocalError(error) { shared.error = freeze({ code: error.code || 'WRITE_FAILED', message: error.message, retryable: true }); shared.blocked = true; publish(); }
    function checkCapacity(key, raw) {
      if (utf8Length(raw) > SYNC_STORE_LIMITS.MAX_ENVELOPE_BYTES) throw failure('SYNC_BACKLOG_LIMIT', 'The local synchronization journal for this highlight is full. Connect and retry synchronization before editing it again.');
      const previous = shared.values.get(key); shared.values.set(key, raw); const code = capacityCode();
      if (previous === undefined) shared.values.delete(key); else shared.values.set(key, previous);
      if (code) throw failure(code, code === 'SYNC_BACKLOG_LIMIT' ? 'The local highlight synchronization journal is full. Connect and retry synchronization; no highlights have been removed.' : undefined);
    }
    async function persist(key, envelope, options, { retryIntent = true, capacity = true } = {}) {
      current(options); storageAvailable();
      const raw = JSON.stringify(validateEnvelope(envelope, key));
      if (shared.values.get(key) === raw) return envelope;
      if (capacity) checkCapacity(key, raw);
      shared.saving = true; publish();
      try {
        current(options); await storage.setItem(key, raw);
        try { current(options); } catch (error) { shared.needsReload = true; throw error; }
        shared.values.set(key, raw); shared.error = null; shared.blocked = false; shared.failedIntent = null; publish();
        return readEnvelope(key, raw);
      } catch (cause) {
        try { current(options); } catch (cancelled) { shared.needsReload = true; throw cancelled; }
        if (cause.code === 'CANCELLED') throw cause;
        const error = failure(cause.code === 'STORAGE_UNAVAILABLE' ? cause.code : 'WRITE_FAILED');
        if (retryIntent) shared.failedIntent = { key, raw, before: shared.values.get(key) ?? null, options };
        setLocalError(error); throw error;
      } finally { shared.saving = false; publish(); }
    }
    function newEnvelope(record, operation) { return { schemaVersion: 2, cloudKey: operation.cloudKey, localIds: [record.id], record, deleted: false, generation: operation.generation, serverRevision: 0, serverRecord: null, pending: [operation], syncError: null, conflict: null }; }
    async function load(options) {
      current(options); shared.loading = true; publish();
      try {
        storageAvailable(); const keys = await storage.getAllKeys(); current(options);
        if (!Array.isArray(keys) || keys.some(key => typeof key !== 'string')) throw failure('READ_FAILED');
        const values = new Map(), originals = new Map(); let retained = 0;
        for (const key of [...new Set(keys)].filter(key => key.startsWith(prefix) && key.length > prefix.length).sort()) {
          const raw = await storage.getItem(key); current(options); if (raw === null) continue;
          if (typeof raw !== 'string') throw failure('READ_FAILED');
          const bytes = utf8Length(raw); retained += bytes;
          values.set(key, bytes > SYNC_STORE_LIMITS.MAX_ENVELOPE_BYTES || retained > SYNC_STORE_LIMITS.MAX_JOURNAL_BYTES ? freeze({ bytes, code: 'SYNC_BACKLOG_LIMIT' }) : raw);
        }
        shared.values = values; shared.originals = originals;
        for (const key of [...new Set(keys)].filter(key => key.startsWith(legacyPrefix) && key.length > legacyPrefix.length).sort()) {
          const raw = await storage.getItem(key); current(options); if (raw === null) continue;
          if (typeof raw !== 'string') throw failure('READ_FAILED'); const bytes = utf8Length(raw);
          let result;
          try {
            if (bytes > LIMITS.MAX_RECORD_BYTES) throw failure('RECORD_TOO_LARGE');
            const value = JSON.parse(raw), id = decodeURIComponent(key.slice(legacyPrefix.length));
            if (encodeURIComponent(id) !== key.slice(legacyPrefix.length) || value.id !== id) throw failure('INVALID_HIGHLIGHT');
            result = classifyRecord(value, scope);
            if (result.status !== 'resolved') { originals.set(key, freeze({ bytes, record: result.record, code: result.code })); continue; }
          } catch (error) { originals.set(key, freeze({ bytes, code: error.code || 'INVALID_HIGHLIGHT' })); continue; }
          const cloudKey = protocol().cloudKeyFor(result.record.selectionRef, canonical), destination = prefix + cloudKey;
          if (shared.values.has(destination)) {
            // A valid v2 envelope is the migration checkpoint. Its local alias
            // list retains legacy IDs without ever rewriting the source bytes.
            try {
              const existing = readEnvelope(destination, shared.values.get(destination));
              if (!existing.localIds.includes(result.record.id)) await persist(destination, { ...existing, localIds: [...existing.localIds, result.record.id] }, options);
            } catch (error) { if (error.code === 'WRITE_FAILED') throw error; originals.set(key, freeze({ bytes, record: result.record, code: 'MIGRATION_CONFLICT' })); }
            continue;
          }
          const operation = operationFor(result.record, 'create', 1, 0);
          await persist(destination, newEnvelope(result.record, operation), options);
        }
        shared.loaded = true; shared.needsReload = false; shared.error = null; shared.blocked = false;
      } catch (cause) {
        try { current(options); } catch (cancelled) { shared.needsReload = true; throw cancelled; }
        if (cause.code === 'CANCELLED') throw cause;
        const error = failure(['WRITE_FAILED', 'STORAGE_UNAVAILABLE'].includes(cause.code) ? cause.code : 'READ_FAILED');
        setLocalError(error); throw error;
      } finally { shared.loading = false; publish(); }
    }
    async function ensureLoaded(options) { current(options); if (shared.blocked) throw failure('RETRY_REQUIRED'); if (!shared.loaded || shared.needsReload) await load(options); current(options); }
    function envelopeFor(id) { return validEnvelopes().find(([, envelope]) => envelope.localIds.includes(id)); }
    function nextRevision(envelope) { return envelope.pending.length ? Math.max(envelope.serverRevision, envelope.pending.at(-1).baseRevision + 1) : envelope.serverRevision; }
    function append(envelope, operation, record, deleted) {
      if (envelope.pending.length >= SYNC_STORE_LIMITS.MAX_PENDING_PER_RECORD) throw failure('SYNC_BACKLOG_LIMIT', 'This highlight has too many pending edits. Synchronize or resolve its failed operation before editing again.');
      return { ...envelope, record, deleted, generation: operation.generation, pending: [...envelope.pending, operation] };
    }
    function mutation(run, options) { return enqueue(async () => { await ensureLoaded(options); return run(); }); }
    async function create(selectionRef, colorId, options) {
      const reference = validateSelectionRef(selectionRef, canonical);
      if (!own(HIGHLIGHT_PALETTE, colorId)) throw failure('INVALID_HIGHLIGHT');
      return mutation(async () => {
        const cloudKey = protocol().cloudKeyFor(reference, canonical), stored = shared.values.get(prefix + cloudKey);
        if (stored) { const envelope = readEnvelope(prefix + cloudKey, stored); if (envelope.deleted) throw Object.assign(failure('RECREATE_CONFIRMATION_REQUIRED', 'This passage was deleted. Recreate it only after reviewing the confirmed deletion.'), { id: envelope.record.id }); }
        const conflict = findCreateConflict(view.snapshot.records, reference, canonical);
        if (conflict.kind === 'duplicate') return freeze({ kind: 'duplicate', record: conflict.record });
        const id = makeId(); if (validEnvelopes().some(([, envelope]) => envelope.localIds.includes(id))) throw failure('ID_COLLISION');
        const timestamp = now(), record = validateHighlightRecord({ schemaVersion: 1, id, owner: { kind: 'account', uid }, workId: canonical.workId, selectionRef: reference, colorId, revision: 1, createdAt: timestamp, updatedAt: timestamp }, scope);
        const operation = operationFor(record, 'create', 1, 0);
        const envelope = await persist(prefix + cloudKey, newEnvelope(record, operation), options);
        return freeze({ kind: 'created', record: envelope.record });
      }, options);
    }
    function recolor(id, colorId, options) {
      return mutation(async () => {
        if (!own(HIGHLIGHT_PALETTE, colorId)) throw failure('INVALID_HIGHLIGHT');
        const found = envelopeFor(id); if (!found || found[1].deleted) throw failure('NOT_FOUND');
        const [key, envelope] = found; if (envelope.record.colorId === colorId) return envelope.record;
        const record = validateHighlightRecord({ ...envelope.record, colorId, revision: envelope.record.revision + 1, updatedAt: Math.max(now(), envelope.record.updatedAt) }, scope);
        const operation = operationFor(record, 'recolor', envelope.generation, nextRevision(envelope));
        return (await persist(key, append(envelope, operation, record, false), options)).record;
      }, options);
    }
    function remove(id, options) {
      return mutation(async () => {
        const found = envelopeFor(id); if (!found) throw failure('NOT_FOUND'); const [key, envelope] = found;
        if (envelope.deleted) return true;
        const knownGeneration = envelope.serverRevision > 0 && envelope.serverRecord?.generation === envelope.generation;
        const operation = operationFor(envelope.record, 'delete', envelope.generation, knownGeneration ? envelope.serverRevision : nextRevision(envelope));
        // An explicit deletion supersedes older local color intents once the
        // server generation is known. An already-started old write may finish,
        // but its acknowledgement no longer matches this durable queue.
        const next = knownGeneration ? { ...envelope, deleted: true, pending: [operation], syncError: null, conflict: null } : append(envelope, operation, envelope.record, true);
        await persist(key, next, options); return true;
      }, options);
    }
    function remoteRecord(cloud, local, cloudKey) {
      // Strict cloud schemas are validated by the protocol. The local copy is
      // then independently checked against the bundled canonical data.
      protocol().validateCloudRecord(cloud, { cloudKey, workId: canonical.workId });
      const timestamp = now();
      const record = validateHighlightRecord({ schemaVersion: 1, id: local ? local.id : makeId(), owner: { kind: 'account', uid }, workId: canonical.workId, selectionRef: cloud.selectionRef, colorId: cloud.colorId, revision: local ? local.revision + 1 : 1, createdAt: local ? local.createdAt : timestamp, updatedAt: Math.max(timestamp, local ? local.updatedAt : 0) }, scope);
      return record;
    }
    function pendingOperations() {
      const result = [];
      for (const [, envelope] of validEnvelopes()) if (envelope.pending.length && !envelope.conflict && (!envelope.syncError || envelope.syncError.retryable)) result.push(envelope.pending[0]);
      return Object.freeze(result);
    }
    function acknowledge(operationId, result, options) {
      return mutation(async () => {
        const found = validEnvelopes().find(([, envelope]) => envelope.pending.some(operation => operation.operationId === operationId));
        if (!found) return false;
        const [key, envelope] = found, operation = envelope.pending.find(value => value.operationId === operationId), receipt = result && result.receipt;
        if (envelope.pending[0] !== operation) throw failure('INVALID_ACK', 'An unrelated synchronization acknowledgement was rejected.');
        protocol().validateReceipt(receipt, operation);
        const pending = envelope.pending.slice(1), receivedCloud = result.cloud;
        if (receivedCloud) remoteRecord(receivedCloud, envelope.record, operation.cloudKey);
        const shadow = envelope.serverRecord;
        const newer = (a, b) => a && (!b || a.generation > b.generation || a.generation === b.generation && a.serverRevision > b.serverRevision);
        const cloud = newer(shadow, receivedCloud) ? shadow : receivedCloud || shadow;
        let record = envelope.record, deleted = envelope.deleted;
        if (!pending.length) { record = validateHighlightRecord({ ...record, colorId: cloud ? cloud.colorId : receipt.resultColorId }, scope); deleted = cloud ? cloud.deleted : receipt.resultDeleted; }
        const conflict = pending.length && cloud && cloud.lastOperationId !== operationId && !pending.some(value => value.operationId === cloud.lastOperationId) && (cloud.deleted || cloud.colorId !== record.colorId) ? { code: cloud.deleted ? 'DELETED' : 'CONFLICT', cloud } : null;
        await persist(key, { ...envelope, record, deleted, pending, serverRevision: Math.max(envelope.serverRevision, receipt.resultRevision, cloud?.serverRevision || 0), generation: Math.max(envelope.generation, receipt.resultGeneration, cloud?.generation || 0), serverRecord: cloud || envelope.serverRecord, syncError: null, conflict }, options);
        return true;
      }, options);
    }
    function mergeRemote(cloudRecords, options) {
      return mutation(async () => {
        if (!Array.isArray(cloudRecords) || cloudRecords.length > SYNC_STORE_LIMITS.MAX_ENVELOPES_PER_WORK) throw failure('SYNC_BACKLOG_LIMIT');
        for (const row of cloudRecords) {
          const { cloudKey, cloud } = row;
          current(options); const key = prefix + cloudKey, raw = shared.values.get(key), envelope = raw ? readEnvelope(key, raw) : null;
          const record = remoteRecord(cloud, envelope?.record, cloudKey);
          if (envelope && !equal(envelope.record.selectionRef, record.selectionRef)) throw failure('INVALID_REMOTE');
          if (envelope && (cloud.generation < envelope.generation || cloud.generation === envelope.generation && cloud.serverRevision < envelope.serverRevision)) continue;
          if (envelope?.serverRecord && cloud.generation === envelope.serverRecord.generation && cloud.serverRevision === envelope.serverRecord.serverRevision) {
            if (!equal(cloud, envelope.serverRecord)) throw failure('INVALID_REMOTE', 'The server returned inconsistent data for an unchanged highlight revision.');
            continue;
          }
          if (envelope?.pending.length) {
            const ownEcho = envelope.pending.some(operation => operation.operationId === cloud.lastOperationId);
            const sameGenerationDelete = envelope.deleted && cloud.generation === envelope.generation && envelope.pending.at(-1).kind === 'delete';
            const pending = sameGenerationDelete && envelope.pending[0].kind !== 'delete' ? [operationFor(envelope.record, 'delete', envelope.generation, cloud.serverRevision)] : envelope.pending;
            const conflict = sameGenerationDelete ? null : cloud.generation !== envelope.generation ? { code: 'CONFLICT', cloud } : ownEcho ? envelope.conflict && { ...envelope.conflict, cloud } : cloud.deleted ? { code: 'DELETED', cloud } : envelope.record.colorId !== cloud.colorId ? { code: 'CONFLICT', cloud } : envelope.conflict && { ...envelope.conflict, cloud };
            await persist(key, { ...envelope, pending, serverRecord: cloud, serverRevision: cloud.serverRevision, conflict }, options);
          } else {
            const next = envelope ? { ...envelope, record, deleted: cloud.deleted, generation: cloud.generation, serverRevision: cloud.serverRevision, serverRecord: cloud, syncError: null, conflict: null }
              : { schemaVersion: 2, cloudKey, localIds: [record.id], record, deleted: cloud.deleted, generation: cloud.generation, serverRevision: cloud.serverRevision, serverRecord: cloud, pending: [], syncError: null, conflict: null };
            await persist(key, next, options);
          }
        }
        return view.snapshot;
      }, options);
    }
    function syncFailed(operationId, error, options) {
      return mutation(async () => {
        const found = validEnvelopes().find(([, envelope]) => envelope.pending.some(operation => operation.operationId === operationId));
        if (!found) return false; const [key, envelope] = found;
        const code = typeof error?.code === 'string' ? error.code.replace(/^firestore\//, '') : 'unavailable';
        const message = code === 'permission-denied' ? 'Highlights are saved on this device, but synchronization was denied. Retry after access is resolved.' : ['CONFLICT', 'SYNC_CONFLICT'].includes(code) ? 'This highlight changed on another device. Choose which color to keep.' : ['DELETED', 'SYNC_DELETED'].includes(code) ? 'This highlight was deleted on another device. Keep the deletion or explicitly recreate it.' : 'Highlights are saved on this device. Synchronization has not been confirmed; retry when available.';
        const syncError = { operationId, code, message, retryable: !CLOUD_PERMANENT.has(code) };
        const conflict = ['CONFLICT', 'DELETED', 'SYNC_CONFLICT', 'SYNC_DELETED'].includes(code) ? { code, cloud: error.cloud || envelope.serverRecord } : envelope.conflict;
        await persist(key, { ...envelope, syncError, conflict }, options); return true;
      }, options);
    }
    function resolveConflict(id, decision, options) {
      return mutation(async () => {
        const found = envelopeFor(id); if (!found) throw failure('NOT_FOUND'); const [key, envelope] = found;
        const cloud = envelope.serverRecord || envelope.conflict?.cloud; if (!cloud) throw failure('CONFLICT', 'Load the server highlight before resolving this conflict.');
        if (!['use-cloud', 'reapply-local'].includes(decision)) throw failure('INVALID_HIGHLIGHT');
        const server = remoteRecord(cloud, envelope.record, envelope.cloudKey);
        if (decision === 'use-cloud') await persist(key, { ...envelope, record: server, deleted: cloud.deleted, generation: cloud.generation, serverRevision: cloud.serverRevision, serverRecord: cloud, pending: [], syncError: null, conflict: null }, options);
        else {
          if (cloud.deleted) throw failure('DELETED', 'The server has a deletion marker. Re-creation requires a separate explicit action.');
          const operation = operationFor(envelope.record, envelope.deleted ? 'delete' : 'recolor', cloud.generation, cloud.serverRevision);
          await persist(key, { ...envelope, generation: cloud.generation, serverRevision: cloud.serverRevision, pending: [operation], syncError: null, conflict: null }, options);
        }
        return view.snapshot;
      }, options);
    }
    function recreate(id, colorId, options) {
      return mutation(async () => {
        const found = envelopeFor(id); if (!found) throw failure('NOT_FOUND'); const [key, envelope] = found;
        const cloud = envelope.serverRecord || envelope.conflict?.cloud;
        if (!cloud?.deleted || envelope.pending.length && !envelope.conflict || !own(HIGHLIGHT_PALETTE, colorId)) throw failure('DELETED', 'Observe the confirmed server deletion before explicitly recreating this highlight.');
        const record = validateHighlightRecord({ ...envelope.record, colorId, revision: envelope.record.revision + 1, updatedAt: Math.max(now(), envelope.record.updatedAt) }, scope);
        const operation = operationFor(record, 'recreate', cloud.generation + 1, cloud.serverRevision);
        await persist(key, { ...envelope, record, deleted: false, generation: cloud.generation + 1, serverRevision: cloud.serverRevision, pending: [operation], syncError: null, conflict: null }, options);
        return record;
      }, options);
    }
    const store = {
      getSnapshot: () => view.snapshot,
      subscribe(listener) { view.listeners.add(listener); return () => view.listeners.delete(listener); },
      hydrate: options => enqueue(async () => { await ensureLoaded(options); return view.snapshot; }),
      create, recolor, remove, pendingOperations, acknowledge, mergeRemote, syncFailed, resolveConflict, recreate,
      retry: options => enqueue(async () => {
        const intent = shared.failedIntent; await load(options);
        if (intent && shared.failedIntent === intent) {
          current(intent.options); const actual = shared.values.get(intent.key) ?? null;
          if (actual !== intent.raw && actual !== intent.before) throw failure('WRITE_CONFLICT');
          if (actual !== intent.raw) await persist(intent.key, JSON.parse(intent.raw), intent.options);
          shared.failedIntent = null; shared.blocked = false; shared.error = null;
        }
        for (const [key, envelope] of validEnvelopes()) if (envelope.syncError && !envelope.conflict) await persist(key, { ...envelope, syncError: null }, options);
        publish(); return view.snapshot;
      }),
      abandonPendingIntent() { shared.failedIntent = null; },
      flush: () => shared.tail,
    };
    view.store = store; shared.views.set(viewKey, view); view.snapshot = classify(); return store;
  }
  async function discoverWorks(uid) {
    if (!storage || typeof storage.getAllKeys !== 'function') throw failure('STORAGE_UNAVAILABLE');
    const prefixes = [namespace + '/v2/' + segment(uid) + '/', namespace + '/legacy/' + segment(uid) + '/'];
    const ids = new Set();
    for (const key of await storage.getAllKeys()) for (const prefix of prefixes) if (key.startsWith(prefix)) { const encoded = key.slice(prefix.length).split('/')[0]; try { const id = decodeURIComponent(encoded); if (encodeURIComponent(id) === encoded) ids.add(id); } catch (_) { /* Invalid namespaces are not promoted into owner state. */ } }
    return [...ids].sort();
  }
  return { forWork, discoverWorks, namespace };
}

module.exports = { createHighlightSyncStoreManager, SYNC_STORE_LIMITS };
