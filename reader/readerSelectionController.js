const { parseSelectionMessage, selectionCommandPayload } = require('./readerSelectionProtocol');

let controllerSequence = 0;
const DEFAULT_TIMEOUT_MS = 5000;

function rejection(code) {
  const error = new Error('Reader selection capture failed: ' + code + '.');
  error.code = code;
  return error;
}

function createReaderSelectionController({ identity, canonical, send, onChange, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  // Validate the mounted identity before accepting commands. Copy it so a caller
  // cannot redirect an already created controller to a replacement document.
  const documentIdentity = selectionCommandPayload(identity, 1, 'clear', 'cancel');
  delete documentIdentity.selectionRequestId;
  delete documentIdentity.reason;
  Object.freeze(documentIdentity);
  if (!canonical || typeof canonical.text !== 'string' || !Array.isArray(canonical.units)
      || ['workId', 'contentVersion', 'canonicalTextVersion'].some(key => canonical[key] !== documentIdentity[key])
      || typeof send !== 'function' || (onChange !== undefined && typeof onChange !== 'function')
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error('Invalid reader selection controller.');
  const controllerId = ++controllerSequence;
  let requestId = 0;
  let minimumClearRequest = 0;
  let revision = 0;
  let pending = null;
  let disposed = false;

  function cancelPending(code) {
    if (!pending) return;
    const previous = pending;
    pending = null;
    clearTimeout(previous.timer);
    previous.reject(rejection(code));
  }

  function capture() {
    if (disposed) return Promise.reject(rejection('DISPOSED'));
    cancelPending('CAPTURE_SUPERSEDED');
    const currentId = ++requestId;
    const token = 'reader-selection-' + controllerId + '-' + currentId;
    const payload = selectionCommandPayload(documentIdentity, currentId, 'capture', token);
    return new Promise((resolve, reject) => {
      const current = { requestId: currentId, token, resolve, reject, timer: null };
      pending = current;
      current.timer = setTimeout(() => {
        if (pending === current) cancelPending('CAPTURE_TIMEOUT');
      }, timeoutMs);
      try {
        if (send('capture', payload) === false && pending === current) cancelPending('SURFACE_UNAVAILABLE');
      } catch (_) {
        if (pending === current) cancelPending('SURFACE_UNAVAILABLE');
      }
    });
  }

  function clear(reason) {
    if (disposed) return;
    // Build first so invalid input cannot cancel unrelated valid work. Native
    // cancellation still occurs before a possibly delayed/unavailable JS send.
    const payload = selectionCommandPayload(documentIdentity, requestId + 1, 'clear', reason);
    requestId += 1;
    minimumClearRequest = requestId;
    cancelPending('CANCELLED');
    // Native state clears immediately even if the runtime has not processed its
    // command. The origin distinguishes this local state from positive-revision
    // wire notifications; before any notification its current revision is zero.
    if (onChange) onChange(Object.freeze({
      ...documentIdentity, type: 'selectionChange', selectionRequestId: requestId,
      selectionSeq: revision, state: 'none', code: 'CLEARED', origin: 'native',
    }));
    try { send('clear', payload); } catch (_) { /* The native invalidation already completed. */ }
  }

  function receive(value) {
    if (disposed) return false;
    let raw;
    try { raw = typeof value === 'string' ? value : JSON.stringify(value); } catch (_) { return false; }
    const message = parseSelectionMessage(raw, documentIdentity, canonical);
    if (!message) return false;
    if (message.type === 'selectionChange') {
      if (message.selectionRequestId < minimumClearRequest || message.selectionRequestId > requestId
          || message.selectionSeq <= revision) return false;
      revision = message.selectionSeq;
      if (message.state === 'none' && message.code === 'CLEARED') cancelPending('CANCELLED');
      // A queued notification need not describe the live Range re-read by the
      // capture command. Only the response's revision decides its eligibility.
      if (onChange) onChange(message);
      return true;
    }
    if (!pending || message.selectionRequestId !== pending.requestId || message.captureToken !== pending.token
        || message.selectionSeq < revision) return false;
    revision = message.selectionSeq;
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    if (message.status === 'rejected') current.reject(rejection(message.code));
    else current.resolve(Object.freeze({
      documentId: documentIdentity.documentId, captureToken: message.captureToken,
      selectionSeq: message.selectionSeq, selection: message.selection,
    }));
    return true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    requestId += 1;
    cancelPending('DISPOSED');
  }

  return { capture, clear, receive, dispose };
}

module.exports = { createReaderSelectionController };
