const MAX_AUTOMATIC_DELAY_MS = 60000;
const MAX_WORKS = 128;
const PERMANENT = new Set(['permission-denied', 'unauthenticated', 'invalid-argument', 'SYNC_CONFLICT', 'SYNC_DELETED', 'SYNC_COUNT_LIMIT', 'SYNC_WORK_LIMIT', 'SYNC_RECORD_LIMIT', 'SYNC_LISTENER_LIMIT', 'SYNC_INVALID_STATE', 'SYNC_INVALID_OPERATION', 'SYNC_RECEIPT_MISMATCH', 'INVALID_REMOTE']);
const codeFor = error => typeof error?.code === 'string' ? error.code.replace(/^firestore\//, '') : 'unavailable';
const { validateMetadata, syncError } = require('./highlightSyncProtocol');

// One owner-scoped worker for the whole collection. No terminated-process or
// background execution is promised: the durable store is the retry boundary.
function createHighlightSyncCoordinator({ manager, transport, resolveCanonical, schedule = (run, delay) => { const timer = setTimeout(run, delay); if (timer && typeof timer.unref === 'function') timer.unref(); return timer; }, cancelSchedule = clearTimeout, random = Math.random } = {}) {
  if (!manager || typeof manager.forWork !== 'function' || !transport || typeof (transport.commit || transport.submit) !== 'function' || typeof transport.listen !== 'function' || typeof resolveCanonical !== 'function') throw new Error('Invalid highlight synchronization coordinator configuration.');
  let owner = null, generation = 0, disposed = false, timer = null, attempt = 0, nextRetryAt = null, lastError = null, runningGeneration = null, listenerUnsubscribe = null, listenerGeneration = 0, listenerNeedsRetry = false, openCanonical = null, microtaskQueued = false;
  const subscribers = new Set(), activeStores = new Map(), drains = new Map(), foregrounds = new Map();
  let works = Object.freeze([]), discoveryLoading = false, discoveryError = null, discoveryUnsubscribe = null, discoveryGeneration = 0, discoveryNeedsRetry = false;
  let ready = Promise.resolve(), snapshot, pendingDiscoveryNeedsRetry = false;
  const isCurrent = (uid, epoch) => !disposed && owner === uid && generation === epoch;
  const eligibleStore = store => { const state = store.getSnapshot(); return !state.error && !state.writeBlocked; };
  function publish() {
    let pending = 0;
    for (const { store } of activeStores.values()) pending += store.getSnapshot().syncSummary?.pendingOperations || 0;
    snapshot = Object.freeze({ uid: owner, ownerGeneration: generation, running: runningGeneration === generation, pending, error: lastError, nextRetryAt, works, discoveryLoading, discoveryError });
    for (const observer of subscribers) { try { observer(); } catch (_) { /* Observers cannot interfere with worker ownership. */ } }
  }
  function errorState(error) { return Object.freeze({ code: codeFor(error), message: typeof error?.message === 'string' ? error.message : 'Highlight synchronization is unavailable.', retryable: !PERMANENT.has(codeFor(error)) }); }
  function clearTimer() { if (timer !== null) cancelSchedule(timer); timer = null; nextRetryAt = null; }
  function retryLater(uid, epoch) {
    if (!isCurrent(uid, epoch) || timer !== null) return;
    const delay = Math.min(MAX_AUTOMATIC_DELAY_MS, 1000 * (2 ** Math.min(attempt++, 6)) * (0.8 + Math.max(0, Math.min(1, random())) * 0.4));
    nextRetryAt = Date.now() + delay;
    timer = schedule(() => {
      if (!isCurrent(uid, epoch)) return;
      timer = null; nextRetryAt = null;
      if (discoveryNeedsRetry) startDiscovery(uid, epoch);
      if (listenerNeedsRetry && openCanonical) {
        const entry = activeStores.get(openCanonical.workId);
        if (entry) startListening(openCanonical, entry.store, uid, epoch);
      }
      if (pendingDiscoveryNeedsRetry) ready = initializePending(uid, epoch).catch(error => initializationFailed(error, uid, epoch));
      void drain(uid, epoch);
    }, delay);
    publish();
  }
  function queueDrain() {
    publish();
    if (disposed || !owner || timer !== null || microtaskQueued || drains.has(generation)) return;
    microtaskQueued = true;
    Promise.resolve().then(() => { microtaskQueued = false; if (!disposed && owner && timer === null) void drain(owner, generation); });
  }
  async function attach(canonical, uid, epoch) {
    if (!isCurrent(uid, epoch)) return null;
    let entry = activeStores.get(canonical.workId);
    if (entry) return entry.store;
    if (activeStores.size >= MAX_WORKS) throw Object.assign(new Error('The synchronization work limit was reached. Existing local highlights are retained.'), { code: 'SYNC_LISTENER_LIMIT' });
    const store = manager.forWork({ uid, canonical });
    entry = { store, unsubscribe: store.subscribe(queueDrain) }; activeStores.set(canonical.workId, entry);
    await store.hydrate({ isCurrent: () => isCurrent(uid, epoch) });
    if (!isCurrent(uid, epoch)) return null;
    return store;
  }
  async function attachPending(uid, epoch) {
    const guard = () => isCurrent(uid, epoch);
    const previousDiscoveryError = pendingDiscoveryNeedsRetry ? lastError : null;
    let workIds;
    try {
      workIds = typeof manager.discoverPendingWorks === 'function' ? await manager.discoverPendingWorks(uid, { isCurrent: guard })
        : typeof manager.discoverWorks === 'function' ? await manager.discoverWorks(uid) : [];
    } catch (error) { if (guard()) pendingDiscoveryNeedsRetry = !PERMANENT.has(codeFor(error)); throw error; }
    if (!guard()) return;
    pendingDiscoveryNeedsRetry = false;
    if (previousDiscoveryError && lastError === previousDiscoveryError) lastError = null;
    if (workIds.length > MAX_WORKS) throw Object.assign(new Error('Too many highlight works are retained for automatic synchronization.'), { code: 'SYNC_LISTENER_LIMIT' });
    for (const workId of workIds) {
      const canonical = await resolveCanonical(workId); if (!guard()) return;
      if (!canonical) continue;
      if (canonical.workId !== workId) throw Object.assign(new Error('The bundled play needed for synchronization is unavailable.'), { code: 'SYNC_INVALID_STATE' });
      try { await attach(canonical, uid, epoch); }
      catch (error) {
        if (!guard()) return;
        if (!['WRITE_FAILED', 'READ_FAILED', 'RETRY_REQUIRED', 'STORAGE_UNAVAILABLE'].includes(codeFor(error))) throw error;
        // This work keeps its local Save/Read recovery state. A blocked local
        // intent must not prevent independent durable works from attaching.
        lastError = errorState(error); publish();
      }
    }
  }
  async function recoverAccess(uid, epoch) {
    const guard = () => isCurrent(uid, epoch);
    for (const { store } of activeStores.values()) {
      if (!guard()) return;
      if (typeof store.retrySyncAccess === 'function') await store.retrySyncAccess({ isCurrent: guard });
    }
  }
  async function initializePending(uid, epoch) { await attachPending(uid, epoch); if (isCurrent(uid, epoch)) await recoverAccess(uid, epoch); }
  function initializationFailed(error, uid, epoch) {
    if (!isCurrent(uid, epoch) || ['CANCELLED', 'SYNC_CANCELLED'].includes(codeFor(error))) return;
    lastError = errorState(error);
    if (pendingDiscoveryNeedsRetry) retryLater(uid, epoch);
    publish();
  }
  function stopListening() { listenerGeneration++; if (listenerUnsubscribe) listenerUnsubscribe(); listenerUnsubscribe = null; }
  function stopDiscovery() { discoveryGeneration++; if (discoveryUnsubscribe) discoveryUnsubscribe(); discoveryUnsubscribe = null; }
  async function mergeCatalogue(rows, uid, guard) {
    if (!guard()) return;
    if (!Array.isArray(rows) || rows.length > MAX_WORKS) throw syncError('SYNC_LISTENER_LIMIT');
    const merged = new Map(works.map(row => [row.workId, row])), seen = new Set();
    for (const row of rows) {
      if (!row || typeof row.workId !== 'string' || !row.workId.length || row.workId.length > 128 || /[\/\u0000-\u001f]/.test(row.workId) || seen.has(row.workId)) throw syncError('SYNC_INVALID_STATE');
      seen.add(row.workId);
      const metadata = validateMetadata(row.metadata), previous = merged.get(row.workId)?.metadata;
      if (previous && metadata.revision < previous.revision) continue;
      if (previous && metadata.revision === previous.revision) {
        if (['activeCount', 'activeBytes', 'lastOperationId'].some(key => metadata[key] !== previous[key])) throw syncError('SYNC_INVALID_STATE');
        continue;
      }
      merged.set(row.workId, Object.freeze({ workId: row.workId, metadata }));
    }
    if (merged.size > MAX_WORKS) throw syncError('SYNC_LISTENER_LIMIT');
    // Work documents cannot be hard-deleted by this protocol. Missing rows or
    // older listener snapshots therefore cannot erase an acknowledged work.
    works = Object.freeze([...merged.values()].sort((a, b) => a.workId.localeCompare(b.workId)));
    publish();
    // The manager serializes owner catalogue writes. Do not republish the
    // returned earlier snapshot after a newer merge has advanced memory.
    if (typeof manager.writeWorkCatalogue === 'function') {
      try { await manager.writeWorkCatalogue(uid, works, { isCurrent: guard }); }
      catch (error) { if (guard()) { discoveryError = errorState(error); publish(); } throw error; }
    }
  }
  function startDiscovery(uid, epoch) {
    stopDiscovery();
    if (!isCurrent(uid, epoch) || typeof transport.listenWorks !== 'function') return;
    const token = discoveryGeneration, guard = () => isCurrent(uid, epoch) && token === discoveryGeneration;
    discoveryLoading = true; publish();
    const fail = error => {
      if (!guard() || ['CANCELLED', 'SYNC_CANCELLED'].includes(codeFor(error))) return;
      discoveryLoading = false; discoveryError = errorState(error); discoveryNeedsRetry = discoveryError.retryable;
      if (discoveryNeedsRetry) retryLater(uid, epoch); publish();
    };
    try {
      discoveryUnsubscribe = transport.listenWorks(uid, async rows => {
        if (!guard()) return;
        try {
          // The catalogue is metadata only. Discovering a remote work does not
          // build its canonical document, hydrate its journal or migrate data.
          await mergeCatalogue(rows, uid, guard);
          if (!guard()) return;
          discoveryLoading = false; discoveryError = null; discoveryNeedsRetry = false; publish();
        } catch (error) { fail(error); }
      }, fail, { isCurrent: guard });
    } catch (error) { fail(error); }
  }
  function startListening(canonical, store, uid, epoch) {
    stopListening(); if (!isCurrent(uid, epoch)) return;
    const listenerEpoch = listenerGeneration;
    listenerUnsubscribe = transport.listen(uid, canonical.workId, async records => {
      if (!isCurrent(uid, epoch) || openCanonical !== canonical || listenerEpoch !== listenerGeneration) return;
      try { await store.mergeRemote(records, { isCurrent: () => isCurrent(uid, epoch) && openCanonical === canonical && listenerEpoch === listenerGeneration }); if (isCurrent(uid, epoch) && listenerEpoch === listenerGeneration) { listenerNeedsRetry = false; attempt = 0; lastError = null; publish(); } }
      catch (error) { if (isCurrent(uid, epoch) && codeFor(error) !== 'CANCELLED') { lastError = errorState(error); publish(); } }
    }, error => {
      if (!isCurrent(uid, epoch) || openCanonical !== canonical || listenerEpoch !== listenerGeneration) return;
      listenerNeedsRetry = !PERMANENT.has(codeFor(error)); lastError = errorState(error); if (listenerNeedsRetry) retryLater(uid, epoch); publish();
    });
  }
  async function runDrain(uid, epoch) {
    runningGeneration = epoch; publish();
    try {
      await ready;
      if (!isCurrent(uid, epoch)) return;
      // At most the bounded journal size can be acknowledged in one run. A
      // store notification schedules another run if later work remains.
      let processed = 0;
      while (isCurrent(uid, epoch) && processed < 400) {
        let target;
        for (const entry of activeStores.values()) {
          if (!eligibleStore(entry.store)) continue;
          const operation = entry.store.pendingOperations()[0];
          if (operation) { target = { store: entry.store, operation }; break; }
        }
        if (!target) break;
        const { store, operation } = target, guard = () => isCurrent(uid, epoch);
        try {
          const submit = transport.commit || transport.submit;
          const result = await submit.call(transport, operation, { isCurrent: guard });
          if (!guard()) return;
          const acknowledged = await store.acknowledge(operation.operationId, result, { isCurrent: guard });
          if (!guard()) return;
          if (acknowledged !== false && result.metadata) {
            const metadata = validateMetadata(result.metadata);
            if (metadata.revision < result.receipt.metadataRevision || metadata.revision === result.receipt.metadataRevision && metadata.lastOperationId !== operation.operationId) throw syncError('SYNC_RECEIPT_MISMATCH');
            await mergeCatalogue([{ workId: operation.workId, metadata }], uid, guard);
            if (!guard()) return;
          }
          if (!listenerNeedsRetry) { attempt = 0; lastError = null; } processed++;
        } catch (error) {
          if (!guard() || codeFor(error) === 'CANCELLED') return;
          lastError = errorState(error);
          // A local acknowledgement failure already has a durable local error
          // path. Do not relabel it as a cloud failure or discard the journal.
          if (!['WRITE_FAILED', 'READ_FAILED', 'RETRY_REQUIRED', 'STORAGE_UNAVAILABLE'].includes(codeFor(error))) {
            try { await store.syncFailed(operation.operationId, error, { isCurrent: guard }); }
            catch (localError) { if (guard()) lastError = errorState(localError); }
          }
          // A permanently blocked passage must not starve unrelated records.
          // Its durable error removes it from eligible queue heads until an
          // explicit retry or conflict decision, so other heads can continue.
          if (guard() && PERMANENT.has(codeFor(error)) && !store.getSnapshot().error) { processed++; continue; }
          if (guard() && !PERMANENT.has(codeFor(error)) && !['WRITE_FAILED', 'READ_FAILED', 'RETRY_REQUIRED', 'STORAGE_UNAVAILABLE'].includes(codeFor(error))) retryLater(uid, epoch);
          return;
        }
      }
    } catch (error) {
      if (isCurrent(uid, epoch) && codeFor(error) !== 'CANCELLED') { lastError = errorState(error); if (!PERMANENT.has(codeFor(error))) retryLater(uid, epoch); }
    } finally {
      if (runningGeneration === epoch) runningGeneration = null;
      if (isCurrent(uid, epoch)) publish();
    }
  }
  function drain(uid = owner, epoch = generation) {
    if (!uid || !isCurrent(uid, epoch)) return Promise.resolve();
    if (drains.has(epoch)) return drains.get(epoch);
    const promise = runDrain(uid, epoch).finally(() => {
      drains.delete(epoch);
      if (isCurrent(uid, epoch) && timer === null && !lastError && [...activeStores.values()].some(({ store }) => eligibleStore(store) && store.pendingOperations().length)) queueDrain();
    });
    drains.set(epoch, promise); return promise;
  }
  function setOwner(uid) {
    if (disposed) return Promise.resolve();
    if (uid !== null && (typeof uid !== 'string' || !uid.length || uid.length > 128)) return Promise.reject(new Error('Invalid synchronization account.'));
    if (owner === uid) return ready;
    generation++; owner = uid; clearTimer(); stopListening(); stopDiscovery(); listenerNeedsRetry = false; pendingDiscoveryNeedsRetry = false; attempt = 0; lastError = null; openCanonical = null;
    works = Object.freeze([]); discoveryLoading = !!uid && typeof transport.listenWorks === 'function'; discoveryError = null; discoveryNeedsRetry = false;
    for (const entry of activeStores.values()) entry.unsubscribe(); activeStores.clear();
    const epoch = generation; publish();
    ready = (async () => {
      if (!uid) return;
      if (typeof manager.readWorkCatalogue === 'function') {
        try { const cached = await manager.readWorkCatalogue(uid, { isCurrent: () => isCurrent(uid, epoch) }); if (isCurrent(uid, epoch)) { works = cached; publish(); } }
        catch (error) { if (isCurrent(uid, epoch)) { discoveryError = errorState(error); publish(); } }
      }
      if (!isCurrent(uid, epoch)) return;
      startDiscovery(uid, epoch);
      await initializePending(uid, epoch);
    })().catch(error => initializationFailed(error, uid, epoch));
    ready.then(() => { if (isCurrent(uid, epoch)) queueDrain(); });
    return ready;
  }
  async function openWork(canonical) {
    const uid = owner, epoch = generation; await ready;
    if (!uid || !isCurrent(uid, epoch)) return null;
    const store = await attach(canonical, uid, epoch); if (!store || !isCurrent(uid, epoch)) return null;
    openCanonical = canonical; startListening(canonical, store, uid, epoch); queueDrain(); return store;
  }
  async function retry() {
    const uid = owner, epoch = generation; if (!uid || !isCurrent(uid, epoch)) return;
    clearTimer(); attempt = 0; lastError = null; await ready;
    for (const { store } of activeStores.values()) { if (!isCurrent(uid, epoch)) return; await store.retry({ isCurrent: () => isCurrent(uid, epoch) }); }
    if (!isCurrent(uid, epoch)) return;
    startDiscovery(uid, epoch);
    if (openCanonical) startListening(openCanonical, activeStores.get(openCanonical.workId).store, uid, epoch);
    await drain(uid, epoch);
  }
  function foreground() {
    const uid = owner, epoch = generation;
    if (!uid || !isCurrent(uid, epoch)) return Promise.resolve();
    if (foregrounds.has(epoch)) return foregrounds.get(epoch);
    const recovery = (async () => {
      await ready; await drains.get(epoch);
      if (!isCurrent(uid, epoch)) return;
      clearTimer(); attempt = 0;
      if (lastError?.retryable || ['permission-denied', 'unauthenticated'].includes(lastError?.code)) lastError = null;
      await initializePending(uid, epoch);
      if (!isCurrent(uid, epoch)) return;
      startDiscovery(uid, epoch);
      if (openCanonical) startListening(openCanonical, activeStores.get(openCanonical.workId).store, uid, epoch);
      await drain(uid, epoch);
    })().catch(error => initializationFailed(error, uid, epoch)).finally(() => foregrounds.delete(epoch));
    foregrounds.set(epoch, recovery); return recovery;
  }
  async function refreshReadOnly() {
    const uid = owner, epoch = generation; await ready;
    if (!uid || !isCurrent(uid, epoch)) return;
    startDiscovery(uid, epoch);
    for (const { store } of activeStores.values()) {
      if (!isCurrent(uid, epoch)) return;
      if (typeof store.refreshReadOnly === 'function') await store.refreshReadOnly({ isCurrent: () => isCurrent(uid, epoch) });
    }
    if (isCurrent(uid, epoch) && openCanonical) startListening(openCanonical, activeStores.get(openCanonical.workId).store, uid, epoch);
  }
  function dispose() { if (disposed) return; disposed = true; generation++; owner = null; clearTimer(); stopListening(); stopDiscovery(); for (const entry of activeStores.values()) entry.unsubscribe(); activeStores.clear(); works = Object.freeze([]); discoveryLoading = false; discoveryError = null; lastError = null; publish(); }
  publish();
  return { setOwner, openWork, retry, refreshReadOnly, foreground, flush: async () => { await ready; await drain(); }, getSnapshot: () => snapshot, subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener); }, dispose };
}

module.exports = { createHighlightSyncCoordinator, MAX_AUTOMATIC_DELAY_MS };
