const { LIMITS, HIGHLIGHT_PALETTE, prefixFor, keyFor, utf8Length, validateSelectionRef, validateHighlightRecord, classifyRecord, findCreateConflict, findStoredConflicts, errorMessage } = require('./readerHighlights');

let nextId = 0;
const defaultId = () => 'highlight-' + Date.now().toString(36) + '-' + (++nextId).toString(36) + '-' + Math.random().toString(36).slice(2, 12);
const own = (value, name) => Object.prototype.hasOwnProperty.call(value, name);
const valueBytes = value => typeof value === 'string' ? utf8Length(value) : value.bytes;
// Padding the fixed prefix before the full key makes this handle injective:
// trailing characters in a stored key can never be confused with the padding.
// Its prefix alone is longer than any permitted persisted record ID.
const unavailableId = key => 'unavailable-key:'.padEnd(129, '!') + key;
function failure(code) { return Object.assign(new Error(errorMessage(code)), { code }); }
const sourceOrder = (a, b) => a.selectionRef.start - b.selectionRef.start || a.selectionRef.end - b.selectionRef.end || a.id.localeCompare(b.id);

function createHighlightStoreManager(storage, { makeId = defaultId, now = Date.now } = {}) {
  if (typeof makeId !== 'function' || typeof now !== 'function') throw new Error('Invalid highlight store configuration.');
  const scopes = new Map();

  const accounts = new Map();
  function ownerPrefix(uid) { return prefixFor(uid, 'x').slice(0, -2); }
  function decodedWork(workKey) {
    try {
      const value = decodeURIComponent(workKey);
      return value.length > 0 && value.length <= 512 && encodeURIComponent(value) === workKey ? value : null;
    } catch (_) { return null; }
  }
  function notify(listeners) {
    for (const listener of listeners) { try { listener(); } catch (_) { /* Observers cannot interrupt persisted queue ordering. */ } }
  }
  function storageAvailable() {
    if (!storage || ['getAllKeys', 'getItem', 'setItem', 'removeItem'].some(name => typeof storage[name] !== 'function')) throw failure('STORAGE_UNAVAILABLE');
  }
  function assertCurrent(options) {
    if (options && typeof options.isCurrent === 'function' && !options.isCurrent()) throw failure('CANCELLED');
  }
  function checkedKeys(keys) {
    if (!Array.isArray(keys) || keys.some(key => typeof key !== 'string')) throw failure('READ_FAILED');
    return [...new Set(keys)];
  }
  function errorValue(error, retryable = true) { return Object.freeze({ code: error.code || 'WRITE_FAILED', message: error.message, retryable }); }

  function publishAccount(account) {
    const works = [];
    let readError = null;
    for (const shared of scopes.values()) {
      if (shared.uid !== account.uid) continue;
      if (shared.readError && !readError) readError = shared.readError;
      if (!shared.loaded || shared.values.size === 0) continue;
      works.push(Object.freeze({ workKey: shared.workKey, workId: decodedWork(shared.workKey), count: shared.values.size,
        saving: shared.saving, error: shared.error, readError: shared.readError }));
    }
    works.sort((a, b) => a.workKey.localeCompare(b.workKey));
    account.snapshot = Object.freeze({ hydrated: account.loaded, loading: account.loading, error: account.error || readError, works: Object.freeze(works) });
    notify(account.listeners);
  }

  function rawScope({ uid, workKey }) {
    const owner = ownerPrefix(uid);
    if (typeof workKey !== 'string' || workKey.includes('/')) throw failure('INVALID_HIGHLIGHT');
    const base = owner + workKey, prefix = base + '/';
    if (scopes.has(prefix)) return scopes.get(prefix);
    const shared = { uid, workKey, prefix, base, tail: Promise.resolve(), values: new Map(), loaded: false, loading: false,
      saving: false, blocked: false, writeBlocked: false, error: null, readError: null, failedIntent: null, views: new Map(), rawListeners: new Set(), rawSnapshot: null, rawStore: null };
    scopes.set(prefix, shared);
    function capacityCode() {
      if (shared.values.size > LIMITS.MAX_RECORDS) return 'HIGHLIGHT_COUNT_LIMIT';
      let bytes = 0;
      for (const value of shared.values.values()) bytes += valueBytes(value);
      if (bytes > LIMITS.MAX_WORK_BYTES) return 'WORK_TOO_LARGE';
      for (const value of shared.values.values()) if (typeof value !== 'string' && ['HIGHLIGHT_COUNT_LIMIT', 'WORK_TOO_LARGE'].includes(value.code)) return value.code;
      return null;
    }
    function publish() {
      const overCapacity = capacityCode();
      const entries = [...shared.values].map(([key, value]) => Object.freeze({
        id: unavailableId(key), key, bytes: valueBytes(value),
        code: overCapacity || (typeof value === 'string' ? 'INVALID_HIGHLIGHT' : value.code),
      }));
      shared.rawSnapshot = Object.freeze({ hydrated: shared.loaded, loading: shared.loading, saving: shared.saving, writeBlocked: shared.writeBlocked, error: shared.error,
        readError: shared.readError, count: shared.values.size, entries: Object.freeze(entries) });
      for (const view of shared.views.values()) { view.snapshot = view.classify(); notify(view.listeners); }
      notify(shared.rawListeners);
      const account = accounts.get(uid);
      if (account) publishAccount(account);
    }
    function setError(error, retryable) { shared.error = errorValue(error, retryable); publish(); }
    function enqueue(run) {
      const task = shared.tail.then(run);
      shared.tail = task.catch(() => {});
      return task;
    }
    async function load({ readOnly = false } = {}) {
      // Discovery/reloading is never permission to replay or discard a failed
      // write. Even an ambiguous successful write remains blocked until the
      // explicit write-retry action reconciles its original stable intent.
      const preserveWrite = readOnly && shared.writeBlocked;
      const priorError = shared.error, priorBlocked = shared.blocked;
      shared.loading = true; publish();
      try {
        storageAvailable();
        const selected = checkedKeys(await storage.getAllKeys()).filter(key => key === base || key.startsWith(prefix)).sort();
        const values = new Map();
        let retainedBytes = 0;
        for (const key of selected) {
          const raw = await storage.getItem(key);
          if (raw === null) continue;
          if (typeof raw !== 'string') throw failure('READ_FAILED');
          const bytes = utf8Length(raw);
          const code = bytes > LIMITS.MAX_RECORD_BYTES ? 'RECORD_TOO_LARGE'
            : values.size >= LIMITS.MAX_RECORDS ? 'HIGHLIGHT_COUNT_LIMIT'
              : retainedBytes + bytes > LIMITS.MAX_WORK_BYTES ? 'WORK_TOO_LARGE' : null;
          if (code) values.set(key, Object.freeze({ bytes, code }));
          else { values.set(key, raw); retainedBytes += bytes; }
        }
        shared.values = values; shared.loaded = true; shared.readError = null;
        shared.blocked = preserveWrite ? priorBlocked : false;
        shared.error = preserveWrite ? priorError : null;
        if (!preserveWrite) shared.writeBlocked = false;
      } catch (cause) {
        const error = failure(cause.code === 'STORAGE_UNAVAILABLE' ? cause.code : 'READ_FAILED');
        shared.readError = errorValue(error);
        shared.blocked = true;
        shared.error = preserveWrite ? priorError : shared.readError;
        throw error;
      } finally { shared.loading = false; publish(); }
    }
    async function ensureLoaded() {
      if (shared.blocked) throw failure('RETRY_REQUIRED');
      if (!shared.loaded) await load();
    }
    function checkCapacity(key, raw) {
      if (utf8Length(raw) > LIMITS.MAX_RECORD_BYTES) throw failure('RECORD_TOO_LARGE');
      if (shared.values.size + (shared.values.has(key) ? 0 : 1) > LIMITS.MAX_RECORDS) throw failure('HIGHLIGHT_COUNT_LIMIT');
      let bytes = utf8Length(raw);
      for (const [otherKey, value] of shared.values) if (otherKey !== key) bytes += valueBytes(value);
      if (bytes > LIMITS.MAX_WORK_BYTES) throw failure('WORK_TOO_LARGE');
    }
    const resultFor = intent => intent.result ? intent.result() : true;
    async function persist(intent) {
      assertCurrent(intent.options);
      const actual = shared.values.get(intent.key) ?? null;
      if (actual === intent.after) return resultFor(intent);
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
        shared.failedIntent = null; shared.blocked = false; shared.writeBlocked = false; shared.error = null;
        publish();
        result = resultFor(intent);
      } catch (cause) {
        if (cause.code === 'CANCELLED') throw cause;
        const error = failure(cause.code === 'STORAGE_UNAVAILABLE' ? cause.code : 'WRITE_FAILED');
        shared.failedIntent = intent; shared.blocked = true; shared.writeBlocked = true; setError(error, true); throw error;
      } finally { shared.saving = false; publish(); }
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
    const retry = (snapshot = () => shared.rawSnapshot) => enqueue(async () => {
      const intent = shared.failedIntent;
      await load();
      if (!intent || shared.failedIntent !== intent) return snapshot();
      try {
        assertCurrent(intent.options);
        const result = await persist(intent);
        shared.failedIntent = null; shared.blocked = false; shared.error = null; publish();
        return result;
      } catch (error) {
        if (error.code === 'CANCELLED') { shared.failedIntent = null; shared.blocked = false; shared.error = null; publish(); }
        throw error;
      }
    });
    const refreshReadOnly = () => enqueue(async () => { await load({ readOnly: true }); return shared.rawSnapshot; });
    Object.assign(shared, { capacityCode, publish, enqueue, load, ensureLoaded, mutation, retry, refreshReadOnly });
    shared.rawStore = {
      getSnapshot: () => shared.rawSnapshot,
      subscribe(listener) { shared.rawListeners.add(listener); return () => shared.rawListeners.delete(listener); },
      hydrate: () => enqueue(async () => { if (!shared.loaded) await load({ readOnly: true }); return shared.rawSnapshot; }),
      refreshReadOnly,
      remove: (id, options) => mutation(() => {
        const entry = shared.rawSnapshot.entries.find(value => value.id === id);
        if (!entry || !shared.values.has(entry.key)) throw failure('NOT_FOUND');
        return { intent: { kind: 'remove', id, key: entry.key, before: shared.values.get(entry.key), after: null, options } };
      }, options),
      retry: () => retry(),
      flush: () => shared.tail,
    };
    publish();
    return shared;
  }

  function forStoredWork(options) { return rawScope(options).rawStore; }
  function forAccount({ uid }) {
    const owner = ownerPrefix(uid);
    if (accounts.has(uid)) return accounts.get(uid).store;
    const account = { uid, loaded: false, loading: false, error: null, snapshot: null, listeners: new Set(), tail: Promise.resolve(), store: null };
    accounts.set(uid, account);
    function refresh(force) {
      const task = account.tail.then(async () => {
        if (!force && account.loaded) return account.snapshot;
        account.loading = true; publishAccount(account);
        try {
          let keys;
          try { storageAvailable(); keys = checkedKeys(await storage.getAllKeys()); }
          catch (cause) { account.error = errorValue(failure(cause.code === 'STORAGE_UNAVAILABLE' ? cause.code : 'READ_FAILED')); throw failure(account.error.code); }
          account.error = null;
          for (const key of keys) {
            if (!key.startsWith(owner)) continue;
            const suffix = key.slice(owner.length);
            rawScope({ uid, workKey: suffix.split('/')[0] });
          }
          // Enumeration discovers groups only. Each raw scope joins its own
          // immutable queue and performs a fresh scan after pending writes;
          // the old account-wide key list never replaces confirmed values.
          for (const shared of scopes.values()) {
            if (shared.uid !== uid) continue;
            if (force || !shared.loaded) await shared.refreshReadOnly();
            else await shared.tail;
          }
          account.loaded = true;
          return account.snapshot;
        } finally { account.loading = false; publishAccount(account); }
      });
      account.tail = task.catch(() => {});
      return task.then(() => account.snapshot);
    }
    account.store = {
      getSnapshot: () => account.snapshot,
      subscribe(listener) { account.listeners.add(listener); return () => account.listeners.delete(listener); },
      hydrate: () => refresh(false), refreshReadOnly: () => refresh(true),
    };
    publishAccount(account);
    return account.store;
  }

  function forWork({ uid, canonical }) {
    if (!canonical || typeof canonical.text !== 'string' || !Array.isArray(canonical.units)) throw failure('INVALID_HIGHLIGHT');
    const prefix = prefixFor(uid, canonical.workId);
    const shared = rawScope({ uid, workKey: encodeURIComponent(canonical.workId) });
    const { enqueue, publish, ensureLoaded, mutation } = shared;
    const viewKey = JSON.stringify([canonical.contentVersion, canonical.canonicalTextVersion]);
    if (shared.views.has(viewKey)) return shared.views.get(viewKey).store;
    const scope = { uid, workId: canonical.workId, canonical };
    const view = { snapshot: null, listeners: new Set(), classify: null, store: null, parsed: new Map() };

    function classify() {
      const records = [], unresolved = [], unreadable = [];
      const overCapacity = shared.capacityCode();
      for (const [key, raw] of shared.values) {
        const suffix = key.slice(prefix.length);
        let id; try { id = decodeURIComponent(suffix); } catch (_) { id = suffix; }
        try { if (keyFor(uid, canonical.workId, id) !== key) throw failure('INVALID_HIGHLIGHT'); }
        catch (_) {
          // This transient removal handle cannot alias any valid annotation ID
          // (which is capped at 128 units), even for noncanonical key encoding.
          id = unavailableId(key);
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
        hydrated: shared.loaded, loading: shared.loading, saving: shared.saving, writeBlocked: shared.writeBlocked,
        records: Object.freeze(records), unresolved: Object.freeze(unresolved), unreadable: Object.freeze(unreadable),
        conflicts: Object.freeze(findStoredConflicts(records, canonical)), error: shared.error, readError: shared.readError,
      });
    }
    view.classify = classify;
    const allRecords = () => [...view.snapshot.records, ...view.snapshot.unresolved.map(value => value.record)];
    function confirmed(id) { return allRecords().find(record => record.id === id); }
    function resultFor(intent) {
      const record = confirmed(intent.id);
      return intent.kind === 'create' ? Object.freeze({ kind: 'created', record }) : intent.kind === 'remove' ? true : record;
    }
    function intentFor(kind, id, after, options) {
      const key = keyFor(uid, canonical.workId, id);
      const intent = { kind, id, key, before: shared.values.get(key) ?? null, after, options };
      intent.result = () => resultFor(intent);
      return intent;
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
      refreshReadOnly: () => shared.refreshReadOnly().then(() => view.snapshot),
      create, recolor, remove,
      retry: () => shared.retry(() => view.snapshot),
      abandonPendingIntent() { shared.failedIntent = null; },
      flush: () => shared.tail,
    };
    view.store = store;
    shared.views.set(viewKey, view);
    view.snapshot = classify();
    return store;
  }
  return { forWork, forStoredWork, forAccount };
}

module.exports = { createHighlightStoreManager };
