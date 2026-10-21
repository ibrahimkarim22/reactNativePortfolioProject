const { LIMITS, HIGHLIGHT_PALETTE, prefixFor, keyFor, utf8Length, validateSelectionRef, validateHighlightRecord, classifyRecord, findCreateConflict, findStoredConflicts, errorMessage } = require('./readerHighlights');

let nextId = 0;
const defaultId = () => 'highlight-' + Date.now().toString(36) + '-' + (++nextId).toString(36) + '-' + Math.random().toString(36).slice(2, 12);
const own = (value, name) => Object.prototype.hasOwnProperty.call(value, name);
const valueBytes = value => typeof value === 'string' ? utf8Length(value) : value.bytes;
function failure(code) { return Object.assign(new Error(errorMessage(code)), { code }); }
const sourceOrder = (a, b) => a.selectionRef.start - b.selectionRef.start || a.selectionRef.end - b.selectionRef.end || a.id.localeCompare(b.id);

function createHighlightStoreManager(storage, { makeId = defaultId, now = Date.now } = {}) {
  if (typeof makeId !== 'function' || typeof now !== 'function') throw new Error('Invalid highlight store configuration.');
  const scopes = new Map();

  function forWork({ uid, canonical }) {
    if (!canonical || typeof canonical.text !== 'string' || !Array.isArray(canonical.units)) throw failure('INVALID_HIGHLIGHT');
    const prefix = prefixFor(uid, canonical.workId);
    let shared = scopes.get(prefix);
    if (!shared) {
      shared = { tail: Promise.resolve(), values: new Map(), loaded: false, loading: false, saving: false, blocked: false, error: null, failedIntent: null, views: new Map() };
      scopes.set(prefix, shared);
    }
    const viewKey = JSON.stringify([canonical.contentVersion, canonical.canonicalTextVersion]);
    if (shared.views.has(viewKey)) return shared.views.get(viewKey).store;
    const scope = { uid, workId: canonical.workId, canonical };
    const view = { snapshot: null, listeners: new Set(), classify: null, store: null, parsed: new Map() };

    function capacityCode() {
      if (shared.values.size > LIMITS.MAX_RECORDS) return 'HIGHLIGHT_COUNT_LIMIT';
      let bytes = 0;
      for (const value of shared.values.values()) bytes += valueBytes(value);
      if (bytes > LIMITS.MAX_WORK_BYTES) return 'WORK_TOO_LARGE';
      // After a confirmed removal, omitted ranges remain unvalidated until the
      // ordered refill finishes. Keep the entire set unavailable in that gap.
      for (const value of shared.values.values()) if (typeof value !== 'string' && ['HIGHLIGHT_COUNT_LIMIT', 'WORK_TOO_LARGE'].includes(value.code)) return value.code;
      return null;
    }

    function classify() {
      const records = [], unresolved = [], unreadable = [];
      const overCapacity = capacityCode();
      for (const [key, raw] of shared.values) {
        const suffix = key.slice(prefix.length);
        let id; try { id = decodeURIComponent(suffix); } catch (_) { id = suffix; }
        try { if (keyFor(uid, canonical.workId, id) !== key) throw failure('INVALID_HIGHLIGHT'); }
        catch (_) {
          // This transient removal handle cannot alias any valid annotation ID
          // (which is capped at 128 units), even for noncanonical key encoding.
          id = ('unavailable-key:' + key).padEnd(129, '!');
        }
        try {
          // An overflow may conceal a conflicting range. Expose every entry as
          // unavailable until exact removals restore capacity; never paint an
          // arbitrary retained subset of a larger unvalidated set.
          if (overCapacity) { view.parsed.delete(key); throw failure(overCapacity); }
          if (typeof raw !== 'string') { view.parsed.delete(key); throw failure(raw.code); }
          if (utf8Length(raw) > LIMITS.MAX_RECORD_BYTES) throw failure('RECORD_TOO_LARGE');
          let cached = view.parsed.get(key);
          if (!cached || cached.raw !== raw) {
            const value = JSON.parse(raw);
            if (!value || value.id !== id || keyFor(uid, canonical.workId, value.id) !== key) throw failure('INVALID_HIGHLIGHT');
            cached = { raw, result: classifyRecord(value, scope) };
            view.parsed.set(key, cached);
          }
          const result = cached.result;
          if (result.status === 'resolved') records.push(result.record);
          else unresolved.push(Object.freeze({ record: result.record, code: result.code }));
        } catch (error) { unreadable.push(Object.freeze({ id, key, bytes: valueBytes(raw), code: error.code || 'INVALID_HIGHLIGHT' })); }
      }
      for (const key of view.parsed.keys()) if (!shared.values.has(key)) view.parsed.delete(key);
      records.sort(sourceOrder);
      unresolved.sort((a, b) => sourceOrder(a.record, b.record));
      return Object.freeze({
        hydrated: shared.loaded, loading: shared.loading, saving: shared.saving,
        records: Object.freeze(records), unresolved: Object.freeze(unresolved), unreadable: Object.freeze(unreadable),
        conflicts: Object.freeze(findStoredConflicts(records, canonical)), error: shared.error,
      });
    }
    view.classify = classify;
    function publish() {
      for (const current of shared.views.values()) {
        current.snapshot = current.classify();
        for (const listener of current.listeners) { try { listener(); } catch (_) { /* Observers cannot interrupt persisted queue ordering. */ } }
      }
    }
    function setError(error, retryable) {
      shared.error = Object.freeze({ code: error.code || 'WRITE_FAILED', message: error.message, retryable });
      publish();
    }
    function enqueue(run) {
      const task = shared.tail.then(run);
      // A rejection belongs to its caller; it cannot break the shared queue.
      shared.tail = task.catch(() => {});
      return task;
    }
    function assertCurrent(options) {
      if (options && typeof options.isCurrent === 'function' && !options.isCurrent()) throw failure('CANCELLED');
    }
    function storageAvailable() {
      if (!storage || ['getAllKeys', 'getItem', 'setItem', 'removeItem'].some(name => typeof storage[name] !== 'function')) throw failure('STORAGE_UNAVAILABLE');
    }
    async function load() {
      shared.loading = true; publish();
      try {
        storageAvailable();
        const keys = await storage.getAllKeys();
        if (!Array.isArray(keys) || keys.some(key => typeof key !== 'string')) throw failure('READ_FAILED');
        const values = new Map();
        const selected = [...new Set(keys)].filter(key => key.startsWith(prefix) && key.length > prefix.length).sort();
        let retainedBytes = 0;
        for (let index = 0; index < selected.length; index++) {
          const key = selected[index];
          const raw = await storage.getItem(key);
          if (raw !== null) {
            if (typeof raw !== 'string') throw failure('READ_FAILED');
            const bytes = utf8Length(raw);
            const code = bytes > LIMITS.MAX_RECORD_BYTES ? 'RECORD_TOO_LARGE'
              : values.size >= LIMITS.MAX_RECORDS ? 'HIGHLIGHT_COUNT_LIMIT'
                : retainedBytes + bytes > LIMITS.MAX_WORK_BYTES ? 'WORK_TOO_LARGE' : null;
            if (code) values.set(key, Object.freeze({ bytes, code }));
            else { values.set(key, raw); retainedBytes += bytes; }
          }
        }
        shared.values = values; shared.loaded = true; shared.blocked = false; shared.error = null;
      } catch (cause) {
        const error = failure(cause.code === 'STORAGE_UNAVAILABLE' ? cause.code : 'READ_FAILED');
        shared.blocked = true; setError(error, true); throw error;
      } finally { shared.loading = false; publish(); }
    }
    async function ensureLoaded() {
      if (shared.blocked) throw failure('RETRY_REQUIRED');
      if (!shared.loaded) await load();
    }
    const allRecords = () => [...view.snapshot.records, ...view.snapshot.unresolved.map(value => value.record)];
    function confirmed(id) { return allRecords().find(record => record.id === id); }
    function checkCapacity(key, raw) {
      if (utf8Length(raw) > LIMITS.MAX_RECORD_BYTES) throw failure('RECORD_TOO_LARGE');
      if (shared.values.size + (shared.values.has(key) ? 0 : 1) > LIMITS.MAX_RECORDS) throw failure('HIGHLIGHT_COUNT_LIMIT');
      let bytes = utf8Length(raw);
      for (const [otherKey, value] of shared.values) if (otherKey !== key) bytes += valueBytes(value);
      if (bytes > LIMITS.MAX_WORK_BYTES) throw failure('WORK_TOO_LARGE');
    }
    function resultFor(intent) {
      const record = confirmed(intent.id);
      return intent.kind === 'create' ? Object.freeze({ kind: 'created', record }) : intent.kind === 'remove' ? true : record;
    }
    async function persist(intent) {
      assertCurrent(intent.options);
      const actual = shared.values.get(intent.key) ?? null;
      // A rejected storage Promise can still have completed its write. Retry
      // first reloads, then recognizes the exact intended bytes idempotently.
      if (actual === intent.after) return resultFor(intent);
      // Discarded raw bytes are never recreated for a removal. Its explicit
      // intent targets the exact discovered key, including malformed entries.
      if (actual !== intent.before && !(intent.kind === 'remove' && typeof intent.before !== 'string')) throw failure('WRITE_CONFLICT');
      if (intent.after !== null) checkCapacity(intent.key, intent.after);
      shared.saving = true; shared.error = null; publish();
      let result;
      try {
        assertCurrent(intent.options);
        storageAvailable();
        if (intent.after === null) await storage.removeItem(intent.key);
        else await storage.setItem(intent.key, intent.after);
        if (intent.after === null) shared.values.delete(intent.key);
        else shared.values.set(intent.key, intent.after);
        shared.failedIntent = null; shared.blocked = false; shared.error = null;
        publish();
        result = resultFor(intent);
      } catch (cause) {
        if (cause.code === 'CANCELLED') throw cause;
        const error = failure(cause.code === 'STORAGE_UNAVAILABLE' ? cause.code : 'WRITE_FAILED');
        shared.failedIntent = intent; shared.blocked = true; setError(error, true); throw error;
      } finally { shared.saving = false; publish(); }
      // Removing overflow can make a previously omitted record readable. A
      // fresh ordered read refills the bounded cache without changing storage.
      if (intent.kind === 'remove' && [...shared.values.values()].some(value => typeof value !== 'string')) await load();
      return result;
    }
    function mutation(prepare, options) {
      return enqueue(async () => {
        assertCurrent(options); await ensureLoaded(); assertCurrent(options);
        const value = prepare();
        return value.intent ? persist(value.intent) : value.result;
      });
    }
    function intentFor(kind, id, after, options) {
      const key = keyFor(uid, canonical.workId, id);
      return { kind, id, key, before: shared.values.get(key) ?? null, after, options };
    }
    function create(selectionRef, colorId, options) {
      let reference;
      try {
        reference = validateSelectionRef(selectionRef, canonical);
        if (!own(HIGHLIGHT_PALETTE, colorId)) throw failure('INVALID_HIGHLIGHT');
      } catch (error) { return Promise.reject(error); }
      return mutation(() => {
        const conflict = findCreateConflict(view.snapshot.records, reference, canonical);
        if (conflict.kind === 'duplicate') return { result: Object.freeze({ kind: 'duplicate', record: conflict.record }) };
        let id, key;
        for (let attempt = 0; attempt < 32; attempt++) {
          id = makeId(); key = keyFor(uid, canonical.workId, id);
          if (!shared.values.has(key)) break;
          id = null;
        }
        if (id === null) throw failure('ID_COLLISION');
        const timestamp = now();
        const record = validateHighlightRecord({ schemaVersion: 1, id, owner: { kind: 'account', uid }, workId: canonical.workId, selectionRef: reference, colorId, revision: 1, createdAt: timestamp, updatedAt: timestamp }, scope);
        return { intent: intentFor('create', id, JSON.stringify(record), options) };
      }, options);
    }
    function recolor(id, colorId, options) {
      return mutation(() => {
        if (!own(HIGHLIGHT_PALETTE, colorId)) throw failure('INVALID_HIGHLIGHT');
        const old = confirmed(id);
        if (!old) throw failure('NOT_FOUND');
        if (old.colorId === colorId) return { result: old };
        const record = validateHighlightRecord({ ...old, colorId, revision: old.revision + 1, updatedAt: Math.max(now(), old.updatedAt) }, scope);
        return { intent: intentFor('recolor', id, JSON.stringify(record), options) };
      }, options);
    }
    function remove(id, options) {
      return mutation(() => {
        // Only a discovered key may be removed. Corrupt/unknown records remain
        // individually removable without trusting their stored JSON identity.
        const unreadable = view.snapshot.unreadable.find(value => value.id === id);
        const key = unreadable ? unreadable.key : keyFor(uid, canonical.workId, id);
        if (!shared.values.has(key)) throw failure('NOT_FOUND');
        const intent = { kind: 'remove', id, key, before: shared.values.get(key), after: null, options };
        return { intent };
      }, options);
    }
    const store = {
      getSnapshot: () => view.snapshot,
      subscribe(listener) { view.listeners.add(listener); return () => view.listeners.delete(listener); },
      hydrate: () => enqueue(async () => { await ensureLoaded(); return view.snapshot; }),
      create, recolor, remove,
      retry: () => enqueue(async () => {
        const intent = shared.failedIntent;
        await load();
        if (!intent || shared.failedIntent !== intent) return view.snapshot;
        try {
          assertCurrent(intent.options);
          const result = await persist(intent);
          shared.failedIntent = null; shared.blocked = false; shared.error = null; publish();
          return result;
        } catch (error) {
          if (error.code === 'CANCELLED') { shared.failedIntent = null; shared.blocked = false; shared.error = null; publish(); }
          throw error;
        }
      }),
      abandonPendingIntent() { shared.failedIntent = null; },
      flush: () => shared.tail,
    };
    view.store = store;
    shared.views.set(viewKey, view);
    view.snapshot = classify();
    return store;
  }
  return { forWork };
}

module.exports = { createHighlightStoreManager };
