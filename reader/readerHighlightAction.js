function rejection(code) {
  return Object.assign(new Error('Reader highlight action failed: ' + code + '.'), { code });
}

function readScope(getScope) {
  const scope = getScope();
  if (!scope || typeof scope.documentId !== 'string' || !scope.documentId
      || !Number.isSafeInteger(scope.ownerGeneration) || scope.ownerGeneration < 1) return null;
  return Object.freeze({ ...scope });
}

function sameScope(first, second) {
  return first && second && Object.keys(first).length === Object.keys(second).length
    && Object.keys(first).every(key => Object.is(first[key], second[key]));
}

// capture is the Stage 2 surface API: it validates the complete canonical
// reference and returns an immutable snapshot. This controller owns intent and
// scope, and never keeps a previous quotation as a capture fallback.
function createHighlightAction({ capture, getScope, onPicker, onList, onError }) {
  if (typeof capture !== 'function' || typeof getScope !== 'function') throw new Error('Invalid highlight action.');
  let current = null;
  let disposed = false;

  function active(action) {
    if (disposed || current !== action) return false;
    let scope;
    try { scope = readScope(getScope); } catch (_) { scope = null; }
    if (!sameScope(action.scope, scope)) {
      current = null;
      return false;
    }
    return true;
  }

  function deliver(action) {
    if (!active(action) || !action.activated || !action.settled) return;
    // Retire before calling into UI so reentrant callbacks cannot deliver twice.
    current = null;
    if (action.error) {
      onError?.(action.error, action.scope);
    } else if (action.mode === 'list') {
      onList?.(action.scope);
    } else {
      onPicker?.(action.snapshot, action.scope);
    }
  }

  function begin(mode) {
    if (disposed) return null;
    if (mode !== 'highlight' && mode !== 'list') throw new Error('Invalid highlight action mode.');
    current = null;
    let scope;
    try { scope = readScope(getScope); } catch (_) { scope = null; }
    if (!scope) return null;
    const action = { token: Object.freeze({}), mode, scope, activated: false, settled: mode === 'list' };
    current = action;
    if (mode === 'highlight') {
      let pending;
      try {
        // Intentionally synchronous: read the live Range before focus or UI moves.
        pending = capture();
      } catch (error) {
        action.error = error || rejection('CAPTURE_FAILED');
        action.settled = true;
        return action.token;
      }
      Promise.resolve(pending).then(snapshot => {
        if (!active(action)) return;
        if (!snapshot || snapshot.documentId !== action.scope.documentId) {
          action.error = rejection('DOCUMENT_CHANGED');
        } else if (!Object.isFrozen(snapshot) || !snapshot.selection || !Object.isFrozen(snapshot.selection)) {
          action.error = rejection('CAPTURE_FAILED');
        } else {
          action.snapshot = snapshot;
        }
        action.settled = true;
        deliver(action);
      }, error => {
        if (!active(action)) return;
        action.error = error || rejection('CAPTURE_FAILED');
        action.settled = true;
        deliver(action);
      });
    }
    return action.token;
  }

  function activate(_mode, token = current?.token) {
    const action = current;
    if (!action || action.token !== token || !active(action)) return;
    // The mode belongs to begin, not to selection-state changes during a press.
    action.activated = true;
    deliver(action);
  }

  function cancel(token) {
    if (token === undefined || current?.token === token) current = null;
  }

  return {
    begin,
    activate,
    cancel,
    invalidate() { current = null; },
    accessibilityActivate(mode) { const token = begin(mode); if (token) activate(mode, token); },
    dispose() { current = null; disposed = true; },
  };
}

module.exports = { createHighlightAction };
