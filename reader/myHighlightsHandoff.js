const rejection = code => Object.assign(new Error('Unable to open saved passage: ' + code + '.'), { code });
const fields = ['token', 'uid', 'generation', 'workId', 'recordId', 'expectedRevision'];
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 128;

// The route carries only identifiers. The original validated range stays inside
// this one-use interaction and is never recovered with quotation matching.
function createMyHighlightsHandoff({ getOwner, subscribeOwner }) {
  if (typeof getOwner !== 'function' || typeof subscribeOwner !== 'function') throw new Error('Invalid highlight handoff ownership.');
  let sequence = 0, current = null;
  const owns = intent => {
    const owner = getOwner();
    return current === intent && !!owner?.ready && owner.uid === intent.request.uid && owner.generation === intent.request.generation;
  };
  function cancel() {
    const previous = current;
    current = null;
    previous?.unsubscribe?.();
  }
  subscribeOwner(() => { if (current && !owns(current)) cancel(); });
  function recordFor(intent, snapshot) {
    if (snapshot.readError) throw snapshot.readError;
    if (snapshot.error) throw snapshot.error;
    if (!snapshot.hydrated) throw rejection('HIGHLIGHTS_NOT_READY');
    const record = snapshot.records.find(value => value.id === intent.request.recordId);
    if (!record || snapshot.conflicts.includes(record.id)) throw rejection('HIGHLIGHT_UNAVAILABLE');
    if (record.workId !== intent.request.workId || record.owner?.uid !== intent.request.uid) throw rejection('DOCUMENT_CHANGED');
    if (record.revision !== intent.request.expectedRevision) throw rejection('HIGHLIGHT_CHANGED');
    if (intent.reference && JSON.stringify(record.selectionRef) !== intent.reference) throw rejection('HIGHLIGHT_CHANGED');
    return record;
  }
  async function prepare({ store, workId, recordId, expectedRevision }) {
    cancel();
    const owner = getOwner();
    if (!owner?.ready || !identifier(owner.uid)) throw rejection('AUTH_REQUIRED');
    if (!Number.isSafeInteger(owner.generation) || owner.generation < 1 || !identifier(workId) || !identifier(recordId)
        || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1
        || typeof store?.refreshReadOnly !== 'function' || typeof store?.getSnapshot !== 'function') throw rejection('HIGHLIGHT_UNAVAILABLE');
    const request = Object.freeze({ token: ++sequence, uid: owner.uid, generation: owner.generation, workId, recordId, expectedRevision });
    const intent = { request, store, claimed: false, reference: null, unsubscribe: null };
    current = intent;
    try {
      await store.refreshReadOnly();
      if (!owns(intent)) throw rejection('CANCELLED');
      const record = recordFor(intent, store.getSnapshot());
      intent.reference = JSON.stringify(record.selectionRef);
      return request;
    } catch (error) {
      if (!owns(intent)) throw rejection('CANCELLED');
      cancel();
      throw error;
    }
  }
  function open({ request, store, session, onComplete, onError }) {
    const intent = current;
    if (!intent || intent.claimed || !owns(intent) || !request || fields.some(field => request[field] !== intent.request[field])) throw rejection('CANCELLED');
    // Navigation may deserialize an ordinary mutable object. After matching its
    // identifiers, use only the original immutable intent throughout the wait.
    request = intent.request;
    if (store !== intent.store || typeof session?.getSnapshot !== 'function' || typeof session?.subscribe !== 'function'
        || typeof session?.show !== 'function' || session.getSnapshot().scope?.workId !== request.workId) {
      cancel();
      throw rejection('DOCUMENT_CHANGED');
    }
    intent.claimed = true;
    let refreshed = false, dispatched = false, scopeGeneration = null, scheduled = false;
    function finish(error) {
      if (!owns(intent)) return;
      cancel();
      if (error) onError?.(error);
      else onComplete?.();
    }
    function advance() {
      if (!owns(intent) || dispatched || !refreshed) return;
      try {
        const state = session.getSnapshot(), scope = state.scope;
        if (!scope || scope.workId !== request.workId) throw rejection('DOCUMENT_CHANGED');
        // A newly mounted session starts with a null owner before auth arrives.
        if (scope.uid === null) return;
        if (scope.uid !== request.uid) throw rejection('CANCELLED');
        if (scopeGeneration === null) scopeGeneration = scope.ownerGeneration;
        if (scope.ownerGeneration !== scopeGeneration) throw rejection('CANCELLED');
        if (state.error || state.renderError) throw state.error || state.renderError;
        if (!state.hydrated || !state.privacyReady || !state.enabled || state.loading || state.saving || state.rendering) return;
        const record = recordFor(intent, store.getSnapshot());
        const painted = recordFor(intent, state);
        if (JSON.stringify(painted.selectionRef) !== JSON.stringify(record.selectionRef)) throw rejection('HIGHLIGHT_CHANGED');
        // Consume before dispatch. Session.show remains an immediate operation;
        // it never receives a queued request that can revive after cancellation.
        dispatched = true;
        intent.unsubscribe?.(); intent.unsubscribe = null;
        Promise.resolve(session.show(record, scope)).then(() => finish(), error => finish(error));
      } catch (error) { finish(error); }
    }
    // consume() publishes new records before synchronously starting their paint.
    // Let that publication finish; its transient enabled state is not evidence
    // that the newly read ranges have already reached the mounted document.
    function scheduleAdvance() {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => { scheduled = false; advance(); });
    }
    intent.unsubscribe = session.subscribe(scheduleAdvance);
    Promise.resolve().then(() => {
      if (!owns(intent)) return;
      return store.refreshReadOnly().then(() => {
        if (!owns(intent)) return;
        recordFor(intent, store.getSnapshot());
        refreshed = true;
        advance();
      });
    }).catch(error => finish(error));
    return { cancel() { if (current === intent) cancel(); } };
  }
  return { prepare, open, cancel };
}

module.exports = { createMyHighlightsHandoff };
