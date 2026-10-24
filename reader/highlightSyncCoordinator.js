const MAX_AUTOMATIC_DELAY_MS = 60000;
const MAX_WORKS = 128;
const PERMANENT = new Set(['permission-denied', 'unauthenticated', 'invalid-argument', 'SYNC_CONFLICT', 'SYNC_DELETED', 'SYNC_COUNT_LIMIT', 'SYNC_WORK_LIMIT', 'SYNC_RECORD_LIMIT', 'SYNC_LISTENER_LIMIT', 'SYNC_INVALID_STATE', 'SYNC_INVALID_OPERATION', 'SYNC_RECEIPT_MISMATCH', 'INVALID_REMOTE']);
const codeFor = error => typeof error?.code === 'string' ? error.code.replace(/^firestore\//, '') : 'unavailable';

// One owner-scoped worker for the whole collection. No terminated-process or
// background execution is promised: the durable store is the retry boundary.
function createHighlightSyncCoordinator({ manager, transport, resolveCanonical, schedule = (run, delay) => { const timer = setTimeout(run, delay); if (timer && typeof timer.unref === 'function') timer.unref(); return timer; }, cancelSchedule = clearTimeout, random = Math.random } = {}) {
  if (!manager || typeof manager.forWork !== 'function' || !transport || typeof (transport.commit || transport.submit) !== 'function' || typeof transport.listen !== 'function' || typeof resolveCanonical !== 'function') throw new Error('Invalid highlight synchronization coordinator configuration.');
  let owner = null, generation = 0, disposed = false, timer = null, attempt = 0, nextRetryAt = null, lastError = null, runningGeneration = null, listenerUnsubscribe = null, listenerGeneration = 0, listenerNeedsRetry = false, openCanonical = null, microtaskQueued = false;
  const subscribers = new Set(), activeStores = new Map(), drains = new Map();
  let ready = Promise.resolve(), snapshot;
  const isCurrent = (uid, epoch) => !disposed && owner === uid && generation === epoch;
  function publish() {
    let pending = 0;
    for (const { store } of activeStores.values()) pending += store.getSnapshot().syncSummary?.pendingOperations || 0;
    snapshot = Object.freeze({ uid: owner, ownerGeneration: generation, running: runningGeneration === generation, pending, error: lastError, nextRetryAt });
    for (const observer of subscribers) { try { observer(); } catch (_) { /* Observers cannot interfere with worker ownership. */ } }
  }
  function errorState(error) { return Object.freeze({ code: codeFor(error), message: typeof error?.message === 'string' ? error.message : 'Highlight synchronization is unavailable.', retryable: !PERMANENT.has(codeFor(error)) }); }
  function clearTimer() { if (timer !== null) cancelSchedule(timer); timer = null; nextRetryAt = null; }
  function retryLater(uid, epoch) {
    if (!isCurrent(uid, epoch) || timer !== null) return;
    const delay = Math.min(MAX_AUTOMATIC_DELAY_MS, 1000 * (2 ** Math.min(attempt++, 6)) * (0.8 + Math.max(0, Math.min(1, random())) * 0.4));
    nextRetryAt = Date.now() + delay;
    timer = schedule(() => {
      timer = null; nextRetryAt = null;
      if (!isCurrent(uid, epoch)) return;
      if (listenerNeedsRetry && openCanonical) {
        const entry = activeStores.get(openCanonical.workId);
        if (entry) startListening(openCanonical, entry.store, uid, epoch);
      }
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
  function stopListening() { listenerGeneration++; if (listenerUnsubscribe) listenerUnsubscribe(); listenerUnsubscribe = null; }
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
          const operation = entry.store.pendingOperations()[0];
          if (operation) { target = { store: entry.store, operation }; break; }
        }
        if (!target) break;
        const { store, operation } = target, guard = () => isCurrent(uid, epoch);
        try {
          const submit = transport.commit || transport.submit;
          const result = await submit.call(transport, operation, { isCurrent: guard });
          if (!guard()) return;
          await store.acknowledge(operation.operationId, result, { isCurrent: guard });
          if (!guard()) return;
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
      if (isCurrent(uid, epoch) && timer === null && !lastError && [...activeStores.values()].some(({ store }) => store.pendingOperations().length)) queueDrain();
    });
    drains.set(epoch, promise); return promise;
  }
  function setOwner(uid) {
    if (disposed) return Promise.resolve();
    if (uid !== null && (typeof uid !== 'string' || !uid.length || uid.length > 128)) return Promise.reject(new Error('Invalid synchronization account.'));
    if (owner === uid) return ready;
    generation++; owner = uid; clearTimer(); stopListening(); listenerNeedsRetry = false; attempt = 0; lastError = null; openCanonical = null;
    for (const entry of activeStores.values()) entry.unsubscribe(); activeStores.clear();
    const epoch = generation; publish();
    ready = (async () => {
      if (!uid) return;
      const workIds = typeof manager.discoverWorks === 'function' ? await manager.discoverWorks(uid) : [];
      if (!isCurrent(uid, epoch)) return;
      if (workIds.length > MAX_WORKS) throw Object.assign(new Error('Too many highlight works are retained for automatic synchronization.'), { code: 'SYNC_LISTENER_LIMIT' });
      for (const workId of workIds) {
        const canonical = await resolveCanonical(workId); if (!isCurrent(uid, epoch)) return;
        if (!canonical || canonical.workId !== workId) throw Object.assign(new Error('The bundled play needed for synchronization is unavailable.'), { code: 'SYNC_INVALID_STATE' });
        await attach(canonical, uid, epoch);
      }
    })().catch(error => { if (isCurrent(uid, epoch) && codeFor(error) !== 'CANCELLED') { lastError = errorState(error); publish(); } });
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
    if (openCanonical) startListening(openCanonical, activeStores.get(openCanonical.workId).store, uid, epoch);
    await drain(uid, epoch);
  }
  function dispose() { if (disposed) return; disposed = true; generation++; owner = null; clearTimer(); stopListening(); for (const entry of activeStores.values()) entry.unsubscribe(); activeStores.clear(); lastError = null; publish(); }
  publish();
  return { setOwner, openWork, retry, foreground: retry, flush: async () => { await ready; await drain(); }, getSnapshot: () => snapshot, subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener); }, dispose };
}

module.exports = { createHighlightSyncCoordinator, MAX_AUTOMATIC_DELAY_MS };
