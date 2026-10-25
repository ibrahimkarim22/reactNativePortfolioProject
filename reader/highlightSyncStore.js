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
  return createHighlightSyncStoreManagerForNamespace(storage, { namespace, makeId, now });
}
// Internal shared implementation. The normal application supplies its namespace
// and legacy prefix only after its separate activation boundary has allowed it.
function createHighlightSyncStoreManagerForNamespace(storage, { namespace, makeId = defaultId, now = Date.now, legacyPrefixFor, migrateLegacy = true } = {}) {
  if (typeof namespace !== 'string' || !namespace.length || namespace.endsWith('/') || (legacyPrefixFor !== undefined && typeof legacyPrefixFor !== 'function')) throw new Error('Invalid synchronization namespace configuration.');
  if (typeof makeId !== 'function' || typeof now !== 'function') throw new Error('Invalid highlight synchronization store configuration.');
  const works = new Map(), catalogueTails = new Map(), catalogueListeners = new Map();
  function notifyCatalogue(uid) { for (const listener of catalogueListeners.get(uid) || []) { try { listener(); } catch (_) { /* Observer only. */ } } }
  const segment = value => { if (typeof value !== 'string' || !value.length || value.length > 512) throw failure('INVALID_HIGHLIGHT'); return encodeURIComponent(value); };
  const prefixFor = (uid, workId, legacy = false) => namespace + (legacy ? '/legacy/' : '/v2/') + segment(uid) + '/' + segment(workId) + '/';
  function sharedFor(uid, workId) {
    return sharedAt(prefixFor(uid, workId));
  }
  function sharedAt(prefix) {
    if (!works.has(prefix)) works.set(prefix, { tail: Promise.resolve(), values: new Map(), originals: new Map(), loaded: false, loading: false, saving: false, blocked: false, needsReload: false, migrationPending: false, error: null, readError: null, failedIntent: null, rawFailedIntent: null, views: new Map() });
    return works.get(prefix);
  }
  function publishShared(uid, shared) {
    for (const view of shared.views.values()) { view.snapshot = view.classify(); for (const listener of view.listeners) { try { listener(); } catch (_) { /* Observer only. */ } } }
    notifyCatalogue(uid);
  }
  function requireRetryInteraction(uid, shared, field, options) {
    const intent = shared[field];
    if (!intent) return;
    try { current(intent.options); }
    catch (error) {
      if (error.code !== 'CANCELLED') throw error;
      // A fresh explicit Retry may reconcile a returning owner's bytes, but
      // cannot revive the gesture captured in an earlier ownership epoch.
      current(options);
      shared[field] = null;
      shared.blocked = !!(shared.failedIntent || shared.rawFailedIntent || shared.readError);
      if (!shared.failedIntent && !shared.rawFailedIntent) shared.error = shared.readError;
      publishShared(uid, shared);
      throw error;
    }
  }

  function forWork({ uid, canonical }) {
    // Reuse the existing owner/work checks without changing their contract.
    policy.prefixFor(uid, canonical && canonical.workId);
    if (!canonical || typeof canonical.text !== 'string' || !Array.isArray(canonical.units)) throw failure('INVALID_HIGHLIGHT');
    const prefix = prefixFor(uid, canonical.workId), legacyPrefix = legacyPrefixFor ? legacyPrefixFor(uid, canonical.workId) : prefixFor(uid, canonical.workId, true);
    const scope = { uid, workId: canonical.workId, canonical };
    const shared = sharedFor(uid, canonical.workId);
    const viewKey = JSON.stringify([canonical.contentVersion, canonical.canonicalTextVersion]);
    if (shared.views.has(viewKey)) return shared.views.get(viewKey).store;
    const view = { snapshot: null, listeners: new Set(), classify: null, store: null };

    function operationFor(record, kind, generation, baseRevision) {
      const targetCanonical = kind === 'delete' ? undefined : canonical;
      return protocol().validateOperation({ schemaVersion: 1, operationId: makeId(), uid, workId: canonical.workId, cloudKey: protocol().cloudKeyFor(record.selectionRef, targetCanonical), kind, selectionRef: record.selectionRef, colorId: record.colorId, generation, baseRevision }, { canonical: targetCanonical });
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
          if (envelope.deleted) tombstones.push(freeze({ id: envelope.record.id, record: result.record, cloudKey: envelope.cloudKey, generation: envelope.generation, serverRevision: envelope.serverRevision, sync }));
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
      return freeze({ hydrated: shared.loaded, loading: shared.loading, saving: shared.saving, records, unresolved, unreadable, conflicts, error: shared.error, readError: shared.readError, writeBlocked: !!(shared.failedIntent || shared.rawFailedIntent), syncById, syncSummary: summary, tombstones });
    }
    view.classify = classify;
    function publish() {
      for (const other of shared.views.values()) { other.snapshot = other.classify(); for (const listener of other.listeners) { try { listener(); } catch (_) { /* Observers cannot interrupt confirmed write ordering. */ } } }
      notifyCatalogue(uid);
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
    async function load(options, readOnly = false) {
      const retainedError = shared.failedIntent || shared.rawFailedIntent ? shared.error : null;
      current(options); shared.loading = true; publish();
      try {
        storageAvailable(); const keys = await storage.getAllKeys(); current(options);
        if (!Array.isArray(keys) || keys.some(key => typeof key !== 'string')) throw failure('READ_FAILED');
        const values = new Map(), originals = new Map(); let retained = 0;
        for (const key of [...new Set(keys)].filter(key => key === prefix.slice(0, -1) || key.startsWith(prefix)).sort()) {
          const raw = await storage.getItem(key); current(options); if (raw === null) continue;
          if (await isRetired(uid, segment(canonical.workId), key, raw, options)) continue;
          if (typeof raw !== 'string') throw failure('READ_FAILED');
          const bytes = utf8Length(raw); retained += bytes;
          values.set(key, bytes > SYNC_STORE_LIMITS.MAX_ENVELOPE_BYTES || retained > SYNC_STORE_LIMITS.MAX_JOURNAL_BYTES ? freeze({ bytes, code: 'SYNC_BACKLOG_LIMIT' }) : raw);
        }
        shared.values = values; shared.originals = originals; shared.migrationPending = false;
        for (const key of [...new Set(keys)].filter(key => key === legacyPrefix.slice(0, -1) || key.startsWith(legacyPrefix)).sort()) {
          const raw = await storage.getItem(key); current(options); if (raw === null) continue;
          if (await isRetired(uid, segment(canonical.workId), key, raw, options)) continue;
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
              if (!existing.localIds.includes(result.record.id)) {
                if (readOnly || !migrateLegacy) shared.migrationPending = migrateLegacy;
                else await persist(destination, { ...existing, localIds: [...existing.localIds, result.record.id] }, options);
              }
            } catch (error) { if (error.code === 'WRITE_FAILED') throw error; originals.set(key, freeze({ bytes, record: result.record, code: 'MIGRATION_CONFLICT' })); }
            continue;
          }
          if (readOnly || !migrateLegacy) { shared.migrationPending = migrateLegacy; originals.set(key, freeze({ bytes, record: result.record, code: 'MIGRATION_PENDING' })); continue; }
          const operation = operationFor(result.record, 'create', 1, 0);
          await persist(destination, newEnvelope(result.record, operation), options);
        }
        shared.loaded = true; shared.needsReload = false; shared.readError = null;
        shared.error = readOnly && retainedError ? retainedError : null; shared.blocked = readOnly && !!(shared.failedIntent || shared.rawFailedIntent);
      } catch (cause) {
        try { current(options); } catch (cancelled) { shared.needsReload = true; throw cancelled; }
        if (cause.code === 'CANCELLED') throw cause;
        const error = failure(['WRITE_FAILED', 'STORAGE_UNAVAILABLE'].includes(cause.code) ? cause.code : 'READ_FAILED');
        shared.readError = freeze({ code: error.code, message: error.message, retryable: true });
        if (readOnly && retainedError) { shared.error = retainedError; shared.blocked = true; publish(); } else setLocalError(error);
        throw error;
      } finally { shared.loading = false; publish(); }
    }
    async function ensureLoaded(options) { current(options); if (shared.blocked) throw failure('RETRY_REQUIRED'); if (!shared.loaded || shared.needsReload || shared.migrationPending) await load(options); current(options); }
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
        const found = envelopeFor(id);
        if (!found) {
          const original = [...shared.originals].find(([key, value]) => value.record?.id === id || 'unavailable:' + key === id);
          const unavailableKey = typeof id === 'string' && id.startsWith('unavailable:') ? id.slice('unavailable:'.length) : null;
          const key = original?.[0] || (unavailableKey && shared.values.has(unavailableKey) ? unavailableKey : null);
          if (!key) throw failure('NOT_FOUND');
          const raw = await storage.getItem(key); current(options);
          await persistRetirement({ uid, workKey: segment(canonical.workId), key, raw }, options, shared); return true;
        }
        const [key, envelope] = found;
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
      refreshReadOnly: options => enqueue(async () => { await load(options, true); return view.snapshot; }),
      create, recolor, remove, pendingOperations, acknowledge, mergeRemote, syncFailed, resolveConflict, recreate,
      retry: options => enqueue(async () => {
        const intent = shared.failedIntent, rawIntent = shared.rawFailedIntent;
        await load(options, !!(intent || rawIntent));
        if (rawIntent && shared.rawFailedIntent === rawIntent) { requireRetryInteraction(uid, shared, 'rawFailedIntent', options); await persistRetirement(rawIntent.input, options, shared); }
        if (intent && shared.failedIntent === intent) {
          requireRetryInteraction(uid, shared, 'failedIntent', options); const actual = shared.values.get(intent.key) ?? null;
          if (actual !== intent.raw && actual !== intent.before) throw failure('WRITE_CONFLICT');
          if (actual !== intent.raw) await persist(intent.key, JSON.parse(intent.raw), intent.options);
          shared.failedIntent = null; shared.blocked = false; shared.error = null;
        }
        if (intent || rawIntent) await load(options);
        for (const [key, envelope] of validEnvelopes()) if (envelope.syncError && !envelope.conflict) await persist(key, { ...envelope, syncError: null }, options);
        publish(); return view.snapshot;
      }),
      abandonPendingIntent() { shared.failedIntent = null; shared.rawFailedIntent = null; },
      flush: () => shared.tail,
    };
    view.store = store; shared.views.set(viewKey, view); view.snapshot = classify(); return store;
  }
  async function discoverWorks(uid) {
    if (!storage || typeof storage.getAllKeys !== 'function') throw failure('STORAGE_UNAVAILABLE');
    const prefixes = [namespace + '/v2/' + segment(uid) + '/', legacyOwnerPrefix(uid)];
    const ids = new Set();
    for (const key of await storage.getAllKeys()) for (const prefix of prefixes) if (key.startsWith(prefix)) { const encoded = key.slice(prefix.length).split('/')[0]; try { const id = decodeURIComponent(encoded); if (encodeURIComponent(id) === encoded) ids.add(id); } catch (_) { /* Invalid namespaces are not promoted into owner state. */ } }
    return [...ids].sort();
  }
  function legacyOwnerPrefix(uid) {
    if (!legacyPrefixFor) return namespace + '/legacy/' + segment(uid) + '/';
    const prefix = legacyPrefixFor(uid, 'x');
    if (typeof prefix !== 'string' || !prefix.endsWith('/x/')) throw failure('INVALID_HIGHLIGHT');
    return prefix.slice(0, -2);
  }
  function rawScope({ uid, workKey }) {
    segment(uid);
    // Raw retained keys are opaque AsyncStorage segments. Match the catalogue
    // policy even for empty/oversized malformed segments; canonical IDs retain
    // their separate validation, and reads/retirement retain byte/count bounds.
    if (typeof workKey !== 'string' || workKey.includes('/')) throw failure('INVALID_HIGHLIGHT');
    let workId = null;
    try { const decoded = decodeURIComponent(workKey); if (decoded.length && decoded.length <= 512 && encodeURIComponent(decoded) === workKey) workId = decoded; } catch (_) { /* Raw unavailable segment stays removable. */ }
    const prefix = namespace + '/v2/' + segment(uid) + '/' + workKey + '/';
    return { workId, shared: sharedAt(prefix), prefixes: [prefix, legacyOwnerPrefix(uid) + workKey + '/'] };
  }
  const retiredPrefix = (uid, workKey) => namespace + '/retired/' + segment(uid) + '/' + workKey + '/';
  const retiredKey = (uid, workKey, key) => retiredPrefix(uid, workKey) + encodeURIComponent(key);
  async function isRetired(uid, workKey, key, raw, options) {
    const marker = await storage.getItem(retiredKey(uid, workKey, key)); current(options);
    if (!marker) return false;
    try { const parsed = JSON.parse(marker); return exactKeys(parsed, ['schemaVersion', 'key', 'raw']) && parsed.schemaVersion === 1 && parsed.key === key && parsed.raw === raw; } catch (_) { return false; }
  }
  function enqueueRaw(shared, run) { const promise = shared.tail.then(run); shared.tail = promise.catch(() => {}); return promise; }
  async function persistRetirement(input, options, shared) {
    const { uid, workKey, key, raw } = input, scope = rawScope(input);
    if (typeof key !== 'string' || !scope.prefixes.some(prefix => key === prefix.slice(0, -1) || key.startsWith(prefix)) || typeof raw !== 'string') throw failure('INVALID_HIGHLIGHT');
    current(options);
    if (!storage || ['getAllKeys', 'getItem', 'setItem'].some(name => typeof storage[name] !== 'function')) throw failure('STORAGE_UNAVAILABLE');
    if (await storage.getItem(key) !== raw) throw failure('WRITE_CONFLICT'); current(options);
    const destination = retiredKey(uid, workKey, key), encoded = JSON.stringify({ schemaVersion: 1, key, raw });
    const retained = (await storage.getAllKeys()).filter(value => value.startsWith(retiredPrefix(uid, workKey))); current(options);
    if (!retained.includes(destination) && retained.length >= SYNC_STORE_LIMITS.MAX_ENVELOPES_PER_WORK) throw failure('SYNC_BACKLOG_LIMIT');
    let bytes = utf8Length(encoded);
    for (const markerKey of retained) if (markerKey !== destination) { const value = await storage.getItem(markerKey); current(options); if (typeof value === 'string') bytes += utf8Length(value); }
    if (bytes > SYNC_STORE_LIMITS.MAX_JOURNAL_BYTES) throw failure('SYNC_BACKLOG_LIMIT');
    shared.saving = true; publishShared(uid, shared);
    try {
      current(options); await storage.setItem(destination, encoded); current(options);
      shared.values.delete(key); shared.originals.delete(key); shared.needsReload = true; shared.rawFailedIntent = null; shared.error = null; shared.blocked = false;
    } catch (cause) {
      current(options);
      const error = failure('WRITE_FAILED'); shared.rawFailedIntent = { input: { ...input }, options }; shared.error = freeze({ code: error.code, message: error.message, retryable: true }); shared.blocked = true; throw error;
    } finally { shared.saving = false; publishShared(uid, shared); }
  }
  function retireRawEntry(input, options) {
    let scope;
    try { scope = rawScope(input); } catch (error) { return Promise.reject(error); }
    return enqueueRaw(scope.shared, async () => { if (scope.shared.failedIntent || scope.shared.rawFailedIntent) throw failure('RETRY_REQUIRED'); await persistRetirement(input, options, scope.shared); return true; });
  }
  function retryRawWork(input, options) {
    const { shared } = rawScope(input);
    return enqueueRaw(shared, async () => {
      current(options);
      if (shared.failedIntent) throw failure('RETRY_REQUIRED');
      if (shared.rawFailedIntent) {
        const { uid, workKey, key } = shared.rawFailedIntent.input;
        // Read both exact original and marker before retiring an old gesture.
        // An ambiguous successful marker remains authoritative; no rewrite is
        // necessary or allowed when the old owner interaction has expired.
        await storage.getItem(key); current(options);
        await storage.getItem(retiredKey(uid, workKey, key)); current(options);
        shared.readError = null;
        requireRetryInteraction(uid, shared, 'rawFailedIntent', options);
        await persistRetirement(shared.rawFailedIntent.input, options, shared);
      }
    });
  }
  function readRawWork(input, options) {
    const { uid, workKey } = input, { shared, prefixes } = rawScope(input);
    return enqueueRaw(shared, async () => {
      current(options);
      try {
        const entries = [], keys = await storage.getAllKeys(); current(options);
        if (!Array.isArray(keys) || keys.some(key => typeof key !== 'string')) throw failure('READ_FAILED');
        let bytes = 0;
        for (const key of [...new Set(keys)].sort()) {
          const sourceIndex = prefixes.findIndex(prefix => key === prefix.slice(0, -1) || key.startsWith(prefix));
          if (sourceIndex < 0) continue;
          const raw = await storage.getItem(key); current(options); if (raw === null || await isRetired(uid, workKey, key, raw, options)) continue;
          if (typeof raw !== 'string') throw failure('READ_FAILED');
          bytes += utf8Length(raw);
          if (entries.length >= SYNC_STORE_LIMITS.MAX_ENVELOPES_PER_WORK || bytes > SYNC_STORE_LIMITS.MAX_JOURNAL_BYTES) throw failure('SYNC_BACKLOG_LIMIT');
          entries.push({ key, raw, source: sourceIndex === 0 ? 'v2' : 'legacy' });
        }
        shared.readError = null;
        return freeze({ entries, saving: shared.saving, error: shared.error, readError: shared.readError, writeBlocked: !!(shared.failedIntent || shared.rawFailedIntent) });
      } catch (cause) {
        current(options); shared.readError = freeze({ code: cause.code || 'READ_FAILED', message: cause.message, retryable: true }); throw cause;
      }
    });
  }
  function summaryEnvelope(raw, uid, workId, cloudKey) {
    if (typeof raw !== 'string' || utf8Length(raw) > SYNC_STORE_LIMITS.MAX_ENVELOPE_BYTES) throw failure('INVALID_HIGHLIGHT');
    const value = JSON.parse(raw), record = value.record;
    if (!exactKeys(value, ENVELOPE_KEYS) || value.schemaVersion !== 2 || value.cloudKey !== cloudKey || typeof value.deleted !== 'boolean'
      || !Number.isSafeInteger(value.generation) || value.generation < 1 || !integer(value.serverRevision)
      || !Array.isArray(value.localIds) || !value.localIds.length || value.localIds.length > 32 || new Set(value.localIds).size !== value.localIds.length
      || value.localIds.some(id => typeof id !== 'string' || !id.length || id.length > 128)
      || !exactKeys(record, ['schemaVersion', 'id', 'owner', 'workId', 'selectionRef', 'colorId', 'revision', 'createdAt', 'updatedAt'])
      || record.schemaVersion !== 1 || record.id !== value.localIds[0] || !exactKeys(record.owner, ['kind', 'uid']) || record.owner.kind !== 'account' || record.owner.uid !== uid || record.workId !== workId
      || !Number.isSafeInteger(record.revision) || record.revision < 1 || !integer(record.createdAt) || !integer(record.updatedAt) || record.updatedAt < record.createdAt
      || !Array.isArray(value.pending) || value.pending.length > SYNC_STORE_LIMITS.MAX_PENDING_PER_RECORD) throw failure('INVALID_HIGHLIGHT');
    protocol().validateOperation({ schemaVersion: 1, operationId: 'catalogue-validation', uid, workId, cloudKey, kind: 'create', selectionRef: record.selectionRef, colorId: record.colorId, generation: 1, baseRevision: 0 });
    for (const operation of value.pending) {
      protocol().validateOperation(operation);
      if (operation.uid !== uid || operation.workId !== workId || operation.cloudKey !== cloudKey || !equal(operation.selectionRef, record.selectionRef)) throw failure('INVALID_HIGHLIGHT');
    }
    if (value.serverRecord) protocol().validateCloudRecord(value.serverRecord, { workId, cloudKey });
    return value;
  }
  async function readLocalWorkCatalogue(uid, options) {
    current(options);
    if (!storage || typeof storage.getAllKeys !== 'function' || typeof storage.getItem !== 'function') throw failure('STORAGE_UNAVAILABLE');
    const keys = await storage.getAllKeys(); current(options);
    if (!Array.isArray(keys) || keys.some(key => typeof key !== 'string')) throw failure('READ_FAILED');
    const v2 = namespace + '/v2/' + segment(uid) + '/', legacy = legacyOwnerPrefix(uid), rows = new Map();
    const decoded = value => { try { const id = decodeURIComponent(value); return encodeURIComponent(id) === value && id.length > 0 && id.length <= 512 ? id : null; } catch (_) { return null; } };
    for (const key of [...new Set(keys)].sort()) {
      const base = key.startsWith(v2) ? v2 : key.startsWith(legacy) ? legacy : null;
      if (!base) continue;
      const suffix = key.slice(base.length), slash = suffix.indexOf('/');
      const workKey = slash < 0 ? suffix : suffix.slice(0, slash), workId = decoded(workKey);
      let row = rows.get(workKey);
      if (!row) { if (rows.size >= 128) throw failure('SYNC_LISTENER_LIMIT'); row = { workId, workKey, count: 0, pendingCount: 0, unavailableCount: 0, localOnlyCount: 0, envelopes: [], originals: [] }; rows.set(workKey, row); }
      const raw = await storage.getItem(key); current(options); if (raw == null) continue;
      if (await isRetired(uid, workKey, key, raw, options)) continue;
      if (base === legacy) { row.originals.push({ raw, id: slash < 0 ? null : decoded(suffix.slice(slash + 1)) }); continue; }
      try {
        const envelope = summaryEnvelope(raw, uid, workId, slash < 0 ? '' : suffix.slice(slash + 1)); row.envelopes.push(envelope);
        if (!envelope.deleted) row.count++;
        row.pendingCount += envelope.pending.length;
      } catch (_) { row.count++; row.unavailableCount++; }
    }
    return freeze([...rows.values()].map(row => {
      for (const original of row.originals) {
        let matched = false, valid = false;
        try {
          const record = JSON.parse(original.raw);
          valid = original.id === record.id && record.owner?.uid === uid && record.workId === row.workId;
          if (valid) matched = row.envelopes.some(envelope => envelope.localIds.includes(record.id) && equal(envelope.record.selectionRef, record.selectionRef));
        } catch (_) { /* Count retained unavailable originals. */ }
        if (!matched) { row.count++; row.localOnlyCount++; if (!valid) row.unavailableCount++; }
      }
      const shared = works.get(v2 + row.workKey + '/');
      return { workId: row.workId, workKey: row.workKey, count: row.count, pendingCount: row.pendingCount, unavailableCount: row.unavailableCount, localOnlyCount: row.localOnlyCount,
        saving: !!shared?.saving, error: shared?.error || null, readError: shared?.readError || null, writeBlocked: !!(shared?.failedIntent || shared?.rawFailedIntent) };
    }).sort((a, b) => a.workKey.localeCompare(b.workKey)));
  }
  async function discoverPendingWorks(uid, options) { return (await readLocalWorkCatalogue(uid, options)).filter(row => row.workId && (row.pendingCount || migrateLegacy && row.localOnlyCount)).map(row => row.workId); }
  function catalogueRows(rows) {
    if (!Array.isArray(rows) || rows.length > 128) throw failure('SYNC_LISTENER_LIMIT');
    const seen = new Set();
    return freeze(rows.map(row => {
      if (!exactKeys(row, ['workId', 'metadata']) || typeof row.workId !== 'string' || !row.workId.length || row.workId.length > 128 || /[\/\u0000-\u001f]/.test(row.workId) || seen.has(row.workId)) throw failure('SYNC_INVALID_STATE');
      seen.add(row.workId);
      return { workId: row.workId, metadata: { ...protocol().validateMetadata(row.metadata) } };
    }).sort((a, b) => a.workId.localeCompare(b.workId)));
  }
  const catalogueKey = uid => namespace + '/catalogue/' + segment(uid);
  async function readWorkCatalogue(uid, options) {
    current(options);
    if (!storage || typeof storage.getItem !== 'function') throw failure('STORAGE_UNAVAILABLE');
    const raw = await storage.getItem(catalogueKey(uid)); current(options);
    if (raw == null) return freeze([]);
    if (typeof raw !== 'string' || utf8Length(raw) > 131072) throw failure('READ_FAILED');
    try { return catalogueRows(JSON.parse(raw)); } catch (_) { throw failure('READ_FAILED'); }
  }
  function writeWorkCatalogue(uid, rows, options) {
    const before = catalogueTails.get(uid) || Promise.resolve();
    const promise = before.then(async () => {
      current(options); const validated = catalogueRows(rows);
      if (!storage || typeof storage.setItem !== 'function') throw failure('STORAGE_UNAVAILABLE');
      try { await storage.setItem(catalogueKey(uid), JSON.stringify(validated)); } catch (_) { current(options); throw failure('WRITE_FAILED'); }
      current(options); return validated;
    });
    catalogueTails.set(uid, promise.catch(() => {})); return promise;
  }
  return { forWork, discoverWorks, discoverPendingWorks, readLocalWorkCatalogue, readWorkCatalogue, writeWorkCatalogue, readRawWork, retireRawEntry, retryRawWork, namespace,
    abandonRawIntent(scope) { rawScope(scope).shared.rawFailedIntent = null; },
    subscribeCatalogue(uid, listener) { let set = catalogueListeners.get(uid); if (!set) { set = new Set(); catalogueListeners.set(uid, set); } set.add(listener); return () => set.delete(listener); } };
}

module.exports = { createHighlightSyncStoreManager, createHighlightSyncStoreManagerForNamespace, SYNC_STORE_LIMITS };
