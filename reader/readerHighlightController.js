const { highlightItemsFromReferences, highlightUpdatePayloads, highlightShowPayload, parseHighlightMessage } = require('./readerHighlightProtocol');

function rejection(code) {
  const error = new Error('Reader highlight command failed: ' + code + '.');
  error.code = code;
  return error;
}

function createReaderHighlightController({ identity, canonical, send, timeoutMs = 5000 }) {
  // Validate and copy the mounted identity; commands never retain mutable caller
  // references or accept compact offsets in place of the complete Stage 2 ref.
  const probe = highlightUpdatePayloads(identity, 1, 1, [], canonical)[0];
  const documentIdentity = Object.freeze(Object.fromEntries(['documentId', 'workId', 'contentVersion', 'canonicalTextVersion'].map(key => [key, probe[key]])));
  if (typeof send !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error('Invalid reader highlight controller.');
  let owner = 0;
  let revision = 0;
  let showId = 0;
  let pendingApply = null;
  let pendingShow = null;
  let painted = null;
  let disposed = false;

  function cancel(kind, code) {
    const current = kind === 'apply' ? pendingApply : pendingShow;
    if (!current) return;
    if (kind === 'apply') pendingApply = null;
    else pendingShow = null;
    clearTimeout(current.timer);
    current.reject(rejection(code));
  }

  function acceptOwner(ownerGeneration) {
    if (!Number.isSafeInteger(ownerGeneration) || ownerGeneration < 1) throw rejection('INVALID_OWNER_GENERATION');
    if (ownerGeneration < owner) throw rejection('OWNER_STALE');
    if (ownerGeneration > owner) {
      cancel('apply', 'OWNER_CHANGED');
      cancel('show', 'OWNER_CHANGED');
      painted = null;
      owner = ownerGeneration;
    }
  }

  function dispatch(kind, payloads, items) {
    return new Promise((resolve, reject) => {
      const current = { payload: payloads[0], items, resolve, reject, timer: null };
      if (kind === 'apply') pendingApply = current;
      else pendingShow = current;
      const isPending = () => current === (kind === 'apply' ? pendingApply : pendingShow);
      current.timer = setTimeout(() => { if (isPending()) cancel(kind, 'HIGHLIGHT_TIMEOUT'); }, timeoutMs);
      try {
        if (send(kind, payloads) === false && isPending()) cancel(kind, 'SURFACE_UNAVAILABLE');
      } catch (_) {
        if (isPending()) cancel(kind, 'SURFACE_UNAVAILABLE');
      }
    });
  }

  function apply(records, ownerGeneration) {
    if (disposed) return Promise.reject(rejection('DISPOSED'));
    let items, payloads;
    try {
      items = highlightItemsFromReferences(records, canonical);
      // Build and validate before invalidating prior work, including the owner.
      payloads = highlightUpdatePayloads(documentIdentity, ownerGeneration, revision + 1, items, canonical);
      acceptOwner(ownerGeneration);
    } catch (error) { return Promise.reject(error); }
    cancel('apply', 'HIGHLIGHT_SUPERSEDED');
    cancel('show', 'HIGHLIGHT_SUPERSEDED');
    painted = null;
    revision += 1;
    return dispatch('apply', payloads, items);
  }

  function show(record, ownerGeneration) {
    if (disposed) return Promise.reject(rejection('DISPOSED'));
    let item, payload;
    try {
      item = highlightItemsFromReferences([record], canonical)[0];
      acceptOwner(ownerGeneration);
      if (!painted || pendingApply) throw rejection('HIGHLIGHTS_NOT_APPLIED');
      if (!painted.some(value => value.id === item.id && value.start === item.start && value.end === item.end && value.colorId === item.colorId)) throw rejection('HIGHLIGHT_NOT_PAINTED');
      payload = highlightShowPayload(documentIdentity, ownerGeneration, revision, showId + 1, item, canonical);
    } catch (error) { return Promise.reject(error); }
    cancel('show', 'HIGHLIGHT_SUPERSEDED');
    showId += 1;
    return dispatch('show', [payload]);
  }

  function receive(value) {
    if (disposed) return false;
    let raw;
    try { raw = typeof value === 'string' ? value : JSON.stringify(value); } catch (_) { return false; }
    const message = parseHighlightMessage(raw, documentIdentity);
    if (!message || message.ownerGeneration !== owner || message.revision !== revision) return false;
    const kind = message.type === 'highlightsApplied' ? 'apply' : 'show';
    const current = kind === 'apply' ? pendingApply : pendingShow;
    if (!current || (kind === 'show' && (message.showId !== current.payload.showId || message.id !== current.payload.id))) return false;
    if (kind === 'apply') pendingApply = null;
    else pendingShow = null;
    clearTimeout(current.timer);
    if (message.status !== 'applied') current.reject(rejection(message.code || (message.status === 'unsupported' ? 'HIGHLIGHTS_UNSUPPORTED' : kind === 'apply' ? 'HIGHLIGHT_APPLY_FAILED' : 'HIGHLIGHT_SHOW_FAILED')));
    else {
      if (kind === 'apply') painted = current.items;
      current.resolve(message);
    }
    return true;
  }

  function invalidate() {
    painted = null;
    cancel('apply', 'DISPOSED');
    cancel('show', 'DISPOSED');
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    invalidate();
  }

  return { apply, show, receive, invalidate, dispose };
}

module.exports = { createReaderHighlightController };
