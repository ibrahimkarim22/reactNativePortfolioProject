import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { PLAYS, getLocalPlayEntry } from '../shared/localPlayService';
import { buildCanonicalDocument } from '../shared/contentText';
import { buildReaderNavigation } from './readerNavigation';
import { catalogueRows, highlightRows } from './myHighlightsPresentation';
import { normalHighlightManager, normalHighlightRuntime } from './normalHighlightStore';
import { syncLabel, syncSummaryText, syncErrorText } from './highlightSyncPresentation';
import useHighlightOwner, { highlightOwner } from './useHighlightOwner';

const EMPTY = Object.freeze({ hydrated: false, loading: false, saving: false, error: null, readError: null, works: [], records: [], unresolved: [], unreadable: [], conflicts: [] });
const subscribeEmpty = () => () => {};
const getEmpty = () => EMPTY;

// Joining the queue is mandatory even when a previous activation cached A.
// Reading has a separate error/retry path; it never calls store.retry().
function useOwnedStore(owner, store) {
  const [read, setRead] = useState(null);
  const attempt = useRef(0);
  const mounted = useRef(true);
  const isCurrent = useCallback(() => {
    const current = highlightOwner.getSnapshot();
    return mounted.current && !!owner.uid && current.ready && current.uid === owner.uid && current.generation === owner.generation;
  }, [owner.uid, owner.generation]);
  const refreshReadOnly = useCallback(async () => {
    if (!store || !isCurrent()) return false;
    const request = ++attempt.current;
    setRead(previous => ({ store, generation: owner.generation, accepted: previous?.store === store && previous.generation === owner.generation && previous.accepted, loading: true, error: null }));
    try {
      await store.refreshReadOnly({ isCurrent });
      if (!isCurrent() || request !== attempt.current) return false;
      setRead({ store, generation: owner.generation, accepted: true, loading: false, error: null });
      return true;
    } catch (error) {
      if (!isCurrent() || request !== attempt.current) return false;
      setRead(previous => ({ store, generation: owner.generation, accepted: previous?.store === store && previous.generation === owner.generation && previous.accepted, loading: false, error }));
      return false;
    }
  }, [store, owner.generation, isCurrent]);
  useEffect(() => {
    mounted.current = true;
    refreshReadOnly();
    return () => { mounted.current = false; attempt.current++; };
  }, [refreshReadOnly]);
  const snapshot = useSyncExternalStore(store?.subscribe || subscribeEmpty, store?.getSnapshot || getEmpty, getEmpty);
  const matched = read?.store === store && read?.generation === owner.generation;
  const accepted = matched && read.accepted;
  return { snapshot: accepted ? snapshot : EMPTY, loading: !!store && (!matched || !!read.loading || snapshot.loading),
    error: matched ? read.error || snapshot.readError || (Array.isArray(snapshot.works) ? snapshot.error : null) || null : null, refreshReadOnly, isCurrent };
}

function useSynchronization(owner) {
  const state = useSyncExternalStore(normalHighlightRuntime?.subscribe || subscribeEmpty, normalHighlightRuntime?.getSnapshot || getEmpty, getEmpty);
  const enabled = normalHighlightRuntime?.storageMode === 'durable-v2';
  const current = enabled && owner.ready && !!owner.uid && state.uid === owner.uid;
  const retrySync = useCallback(async () => {
    const active = highlightOwner.getSnapshot();
    if (!enabled || !active.ready || active.uid !== owner.uid || active.generation !== owner.generation) return false;
    await normalHighlightRuntime.retry(); return true;
  }, [enabled, owner.uid, owner.generation]);
  const synchronizationError = current ? state.error || state.discoveryError : null;
  const syncRunning = current && !!state.running;
  const syncPaused = enabled && !normalHighlightRuntime.enabled;
  const storageStatus = !enabled ? {} : {
    label: syncPaused ? 'Saved on this device' : syncRunning ? 'Syncing\u2026' : state.pending ? 'Saved on this device \u00b7 Waiting to sync' : null,
    error: synchronizationError ? syncErrorText(synchronizationError) : null,
    onRetry: synchronizationError && !syncPaused ? retrySync : undefined,
  };
  return { synchronizationEnabled: enabled, synchronizationMode: enabled ? 'production' : 'local', synchronizationError,
    syncRunning, syncPaused, retrySync: enabled && !syncPaused ? retrySync : undefined, storageStatus };
}

export function useMyHighlightsCatalogue() {
  const owner = useHighlightOwner();
  const store = useMemo(() => owner.ready && owner.uid ? normalHighlightManager.forAccount({ uid: owner.uid }) : null, [owner.uid, owner.generation, owner.ready]);
  const state = useOwnedStore(owner, store);
  const sync = useSynchronization(owner);
  const rows = useMemo(() => catalogueRows(state.snapshot.works || [], PLAYS), [state.snapshot]);
  return { ...state, ...sync, owner, rows };
}

export function useMyHighlightsWork({ workKey, ownerGeneration } = {}) {
  const owner = useHighlightOwner();
  const validOwner = owner.ready && !!owner.uid && owner.generation === ownerGeneration;
  const prepared = useMemo(() => {
    if (!validOwner || typeof workKey !== 'string') return {};
    let workId;
    try { workId = decodeURIComponent(workKey); if (encodeURIComponent(workId) !== workKey) workId = null; } catch (_) { workId = null; }
    const play = PLAYS.find(item => item.id === workId);
    if (!play) return { workId: null, play: null };
    try {
      const entry = getLocalPlayEntry(play.id);
      const canonical = buildCanonicalDocument(entry);
      return { workId: play.id, play, canonical, model: buildReaderNavigation(entry, canonical) };
    } catch (_) { return { workId: null, play: null }; }
  }, [validOwner, workKey]);
  const store = useMemo(() => {
    if (!validOwner || typeof workKey !== 'string') return null;
    return prepared.canonical ? normalHighlightManager.forWork({ uid: owner.uid, canonical: prepared.canonical })
      : normalHighlightManager.forStoredWork({ uid: owner.uid, workKey });
  }, [owner.uid, owner.generation, validOwner, workKey, prepared]);
  const state = useOwnedStore(owner, store);
  const sync = useSynchronization(owner);
  const activateWork = useCallback(async () => {
    if (!prepared.canonical || !validOwner || !state.isCurrent() || !sync.synchronizationEnabled) return false;
    await normalHighlightRuntime.openWork(prepared.canonical); return state.isCurrent();
  }, [prepared.canonical, validOwner, state.isCurrent, sync.synchronizationEnabled]);
  useEffect(() => { activateWork().catch(() => {}); }, [activateWork]);
  const items = useMemo(() => highlightRows(state.snapshot, prepared.model).map(item => ({ ...item,
    syncLabel: sync.synchronizationEnabled && item.sync ? syncLabel(item.sync, { mode: sync.synchronizationMode, syncing: sync.syncRunning }) : undefined,
  })), [state.snapshot, prepared.model, sync.synchronizationEnabled, sync.synchronizationMode, sync.syncRunning]);
  const mutate = useCallback(async (method, ...args) => {
    if (!validOwner || !store || !state.isCurrent()) throw Object.assign(new Error('This sign-in is no longer active.'), { code: 'CANCELLED' });
    const result = await store[method](...args, { isCurrent: state.isCurrent });
    if (!state.isCurrent()) throw Object.assign(new Error('This sign-in is no longer active.'), { code: 'CANCELLED' });
    return result;
  }, [validOwner, store, state.isCurrent]);
  const retryPending = useCallback(async () => {
    if (!validOwner || !store || !state.isCurrent()) return false;
    const result = await store.retry({ isCurrent: state.isCurrent });
    if (!state.isCurrent()) throw Object.assign(new Error('This sign-in is no longer active.'), { code: 'CANCELLED' });
    return result;
  }, [validOwner, store, state.isCurrent]);
  return { ...state, ...prepared, ...sync, owner, validOwner, store, items, mutate, retryPending, activateWork,
    syncSummary: sync.synchronizationEnabled ? syncSummaryText(state.snapshot.syncSummary, { running: sync.syncRunning }) : '' };
}
