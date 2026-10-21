const { validateSelectionRef } = require('./readerHighlights');

let nextOwnerGeneration = 0;
const EMPTY = Object.freeze([]);
const rejection = code => Object.assign(new Error('Reader highlights: ' + code + '.'), { code });
const unsupported = error => ['UNSUPPORTED', 'HIGHLIGHTS_UNSUPPORTED'].includes(error?.code);

function createReaderHighlightSession({ manager, document, surface }) {
  const { identity, canonical } = document || {};
  if (!manager || typeof manager.forWork !== 'function' || typeof surface !== 'function'
      || !identity || !canonical || typeof identity.documentId !== 'string'
      || ['workId', 'contentVersion', 'canonicalTextVersion'].some(key => identity[key] !== canonical[key])) throw new Error('Invalid reader highlight session.');
  const listeners = new Set();
  let disposed = false, ready = false, store = null, unsubscribe = null;
  let bootstrapId = 0, renderId = 0, renderSignature = null;
  let pendingRender = Promise.resolve(false), running = Promise.resolve();
  const makeScope = uid => Object.freeze({ uid, workId: identity.workId, documentId: identity.documentId, ownerGeneration: ++nextOwnerGeneration });
  let scope = makeScope(null);
  const blank = () => ({ scope, records: EMPTY, unresolved: EMPTY, unreadable: EMPTY, conflicts: EMPTY,
    hydrated: false, loading: false, saving: false, rendering: false, error: null, renderError: null, privacyReady: false, enabled: false });
  let state = Object.freeze(blank());

  function publish(change) {
    const next = { ...state, ...change, scope };
    next.enabled = !disposed && ready && !!scope.uid && next.privacyReady && next.hydrated && !next.loading && !next.saving && !next.error && !next.renderError;
    state = Object.freeze(next);
    for (const listener of listeners) listener();
  }
  const owns = owner => !disposed && ready && scope === owner;
  function assertCurrent(expected) {
    if (disposed || !expected || ['uid', 'workId', 'documentId', 'ownerGeneration'].some(key => expected[key] !== scope[key])) throw rejection('CANCELLED');
    if (!scope.uid) throw rejection('AUTH_REQUIRED');
    if (!ready || !state.privacyReady || !state.hydrated || state.loading || state.error) throw state.error || rejection('HIGHLIGHTS_NOT_READY');
    return scope;
  }
  const compact = item => ({ id: item.id, colorId: item.colorId, selectionRef: item.selectionRef });
  function paintable() {
    const excluded = new Set(state.conflicts);
    return state.records.filter(item => !excluded.has(item.id)).map(compact);
  }

  function paint(records, owner, force = false) {
    const signature = JSON.stringify(records);
    if (!force && signature === renderSignature) return pendingRender;
    renderSignature = signature;
    const request = ++renderId;
    publish({ rendering: true });
    let pending;
    try {
      const target = surface();
      if (typeof target?.applyHighlights !== 'function') throw rejection('SURFACE_UNAVAILABLE');
      pending = target.applyHighlights(records, owner.ownerGeneration);
    } catch (error) { pending = Promise.reject(error); }
    pendingRender = Promise.resolve(pending).then(() => {
      if (!owns(owner) || renderId !== request) return false;
      publish({ rendering: false, renderError: null });
      return true;
    }, error => {
      if (!owns(owner) || renderId !== request) return false;
      publish({ rendering: false, renderError: error || rejection('HIGHLIGHT_APPLY_FAILED') });
      return false;
    });
    return pendingRender;
  }

  function consume(source, owner) {
    if (!owns(owner) || !state.privacyReady) return pendingRender;
    publish({ records: Object.freeze([...(source.records || EMPTY)]), unresolved: Object.freeze([...(source.unresolved || EMPTY)]),
      unreadable: Object.freeze([...(source.unreadable || EMPTY)]), conflicts: Object.freeze([...(source.conflicts || EMPTY)]),
      hydrated: !!source.hydrated, loading: !!source.loading, saving: !!source.saving, error: source.error || null });
    return paint(paintable(), owner);
  }

  async function bootstrap(owner) {
    const attempt = ++bootstrapId;
    const active = () => owns(owner) && bootstrapId === attempt;
    publish({ loading: !!owner.uid, renderError: null });
    // No new account's quotations or paint are exposed until this clear has
    // been acknowledged. The source document stays mounted behind the cover.
    const cleared = await paint([], owner, true);
    if (!active()) return state;
    if (!cleared && !unsupported(state.renderError)) { publish({ loading: false }); return state; }
    // An explicit unsupported-engine response proves there is no CSS Custom
    // Highlight registry to conceal. Keep ordinary reading and retained lists
    // available; paint-dependent actions remain disabled by renderError.
    publish({ privacyReady: true });
    if (!owner.uid) { publish({ loading: false }); return state; }
    let selected;
    let accepted = false;
    try {
      selected = manager.forWork({ uid: owner.uid, canonical });
      store = selected;
      unsubscribe?.();
      unsubscribe = selected.subscribe(() => {
        if (active() && accepted) consume(selected.getSnapshot(), owner);
      });
      // Even cached A must join A's shared queue after an outstanding old A
      // write. Do not consume its cached subscription before hydration returns.
      await selected.hydrate();
      if (!active()) return state;
      accepted = true;
      await consume(selected.getSnapshot(), owner);
    } catch (error) {
      if (!active()) return state;
      accepted = true;
      if (selected) consume(selected.getSnapshot(), owner);
      publish({ loading: false, error: error || rejection('STORAGE_READ_FAILED') });
    }
    return state;
  }

  function retire(uid) {
    bootstrapId++;
    renderId++;
    unsubscribe?.(); unsubscribe = null; store = null;
    renderSignature = null;
    pendingRender = Promise.resolve(false);
    scope = makeScope(uid);
    publish(blank());
    running = ready && !disposed ? bootstrap(scope) : Promise.resolve(state);
    return running;
  }

  async function mutate(method, args, expected) {
    const owner = assertCurrent(expected), selected = store;
    if (!selected) throw rejection('HIGHLIGHTS_NOT_READY');
    try {
      const result = await selected[method](...args, { isCurrent: () => owns(owner) && state.privacyReady });
      if (!owns(owner)) throw rejection('CANCELLED');
      consume(selected.getSnapshot(), owner);
      return result;
    } catch (error) {
      if (!owns(owner)) throw rejection('CANCELLED');
      consume(selected.getSnapshot(), owner);
      throw error;
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setOwner(uid) {
      if (disposed) return Promise.resolve(state);
      if (uid !== null && (typeof uid !== 'string' || !uid.length || uid.length > 128)) throw rejection('INVALID_OWNER');
      return uid === scope.uid ? running : retire(uid);
    },
    setReady(value) {
      if (disposed || ready === !!value) return running;
      ready = !!value;
      return ready ? (running = bootstrap(scope)) : retire(scope.uid);
    },
    async create(snapshot, colorId, expected) {
      assertCurrent(expected);
      if (state.renderError) throw state.renderError;
      if (!snapshot || snapshot.documentId !== identity.documentId) throw rejection('DOCUMENT_CHANGED');
      validateSelectionRef(snapshot.selection, canonical);
      if (!Object.isFrozen(snapshot) || !Object.isFrozen(snapshot.selection)
          || !Object.isFrozen(snapshot.selection.startRef) || !Object.isFrozen(snapshot.selection.endRef)) throw rejection('INVALID_HIGHLIGHT');
      return mutate('create', [snapshot.selection, colorId], expected);
    },
    async recolor(id, colorId, expected) {
      assertCurrent(expected);
      if (state.renderError) throw state.renderError;
      return mutate('recolor', [id, colorId], expected);
    },
    remove(id, expected) { return mutate('remove', [id], expected); },
    async cancelPending(expected) {
      // Cancelling a failed picker is allowed while storage remains blocked.
      // Validate ownership without requiring an error-free/hydrated store, and
      // delegate synchronously so a later owner can never lose its own intent.
      if (disposed || !expected || ['uid', 'workId', 'documentId', 'ownerGeneration'].some(key => expected[key] !== scope[key])) throw rejection('CANCELLED');
      if (!scope.uid || !store) return false;
      return store.abandonPendingIntent();
    },
    async retry(expected) {
      if (disposed || !ready) throw rejection('CANCELLED');
      if (expected && ['uid', 'workId', 'documentId', 'ownerGeneration'].some(key => expected[key] !== scope[key])) throw rejection('CANCELLED');
      const owner = scope;
      if (!state.privacyReady || (state.error && !store)) return (running = bootstrap(owner));
      if (state.error && store) {
        const selected = store;
        try {
          const result = await selected.retry();
          if (!owns(owner)) throw rejection('CANCELLED');
          await consume(selected.getSnapshot(), owner);
          return result;
        } catch (error) {
          if (!owns(owner)) throw rejection('CANCELLED');
          const reconciled = selected.getSnapshot();
          await consume(reconciled, owner);
          // Returning A may discover a failed intent created by an older A
          // generation. The shared store reconciles the bytes and intentionally
          // cancels that retired replay; its cleared error is a successful read.
          if (error?.code === 'CANCELLED' && reconciled.hydrated && !reconciled.error) return state;
          throw error;
        }
      } else {
        const applied = await paint(paintable(), owner, true);
        if (!owns(owner)) throw rejection('CANCELLED');
        if (!applied) throw state.renderError || rejection('HIGHLIGHT_APPLY_FAILED');
      }
      return state;
    },
    async show(record, expected) {
      const owner = assertCurrent(expected);
      // A Show intent must dispatch in this activation, never wait behind paint
      // and revive after the user closes the list or chooses another action.
      if (state.rendering) throw rejection('HIGHLIGHTS_NOT_APPLIED');
      const found = state.records.find(item => item.id === record?.id);
      if (!found || state.conflicts.includes(found.id)) throw rejection('HIGHLIGHT_UNAVAILABLE');
      validateSelectionRef(record.selectionRef, canonical);
      if (found.revision !== record.revision || JSON.stringify(found.selectionRef) !== JSON.stringify(record.selectionRef)) throw rejection('CANCELLED');
      if (state.renderError) throw state.renderError;
      const target = surface();
      if (typeof target?.showHighlight !== 'function') throw rejection('SURFACE_UNAVAILABLE');
      try {
        const result = await target.showHighlight(compact(found), owner.ownerGeneration);
        if (!owns(owner)) throw rejection('CANCELLED');
        return result;
      } catch (error) { if (!owns(owner)) throw rejection('CANCELLED'); throw error; }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      // An old session must never issue a delayed lower-generation clear into
      // the surface now controlled by a replacement session.
      retire(null);
      listeners.clear();
    },
  };
}

module.exports = { createReaderHighlightSession };
