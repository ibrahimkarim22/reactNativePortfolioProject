import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { createReaderHighlightSession } from "./readerHighlightSession";
import { normalHighlightManager, normalHighlightRuntime } from "./normalHighlightStore";

// Both reader routes share one ordered queue for each immutable UID/work key.
const manager = normalHighlightManager;
const empty = Object.freeze({ scope: null, records: [], unresolved: [], unreadable: [], conflicts: [],
  hydrated: false, loading: false, saving: false, error: null, renderError: null, privacyReady: false, enabled: false });
const subscribeEmpty = () => () => {};
const getEmpty = () => empty;
const emptySync = Object.freeze({ error: null });
const getEmptySync = () => emptySync;

export default function useReaderHighlights(document, surfaceRef, ready, runtime) {
  if (runtime && (runtime.mode !== "emulator" || !runtime.auth || !runtime.manager || !runtime.coordinator)) throw new Error("Invalid isolated highlight runtime.");
  const selectedManager = runtime?.manager || manager;
  const selectedCoordinator = runtime?.coordinator || normalHighlightRuntime?.coordinator;
  const surface = useRef(surfaceRef);
  surface.current = surfaceRef;
  const session = useMemo(() => document ? createReaderHighlightSession({
    manager: selectedManager, document, surface: () => surface.current.current,
  }) : null, [document, selectedManager]);
  const mounts = useRef(new Map());
  useEffect(() => {
    if (!session) return undefined;
    const counts = mounts.current;
    counts.set(session, (counts.get(session) || 0) + 1);
    let active = true, authEpoch = 0;
    const releaseOwner = !runtime ? normalHighlightRuntime?.acquireOwner?.() : undefined;
    const auth = runtime?.auth || require("../firebaseConfig").FIREBASE_AUTH;
    const unsubscribe = onAuthStateChanged(auth,
      user => {
        if (!active) return;
        const epoch = ++authEpoch;
        const uid = user?.uid || null;
        const activation = runtime ? runtime.coordinator.setOwner(uid) : normalHighlightRuntime?.setOwner(uid);
        session.setOwner(uid);
        Promise.resolve(activation).then(() => {
          if (active && epoch === authEpoch && uid && auth.currentUser?.uid === uid) return selectedCoordinator?.openWork(document.canonical);
        }).catch(() => {});
      },
      () => { if (active) session.setOwner(null); });
    return () => {
      active = false;
      unsubscribe();
      releaseOwner?.();
      // Retire queued actions synchronously; only irreversible disposal waits
      // for a possible StrictMode replay.
      session.setReady(false);
      counts.set(session, counts.get(session) - 1);
      // React's development effect replay must not irreversibly dispose the
      // session it immediately remounts. Different documents retain separate
      // counts, so a replacement cannot keep an old session alive.
      queueMicrotask(() => {
        if (counts.get(session) === 0) { session.dispose(); counts.delete(session); }
      });
    };
  }, [session, runtime]);
  useEffect(() => { session?.setReady(ready); }, [session, ready]);
  const state = useSyncExternalStore(session?.subscribe || subscribeEmpty, session?.getSnapshot || getEmpty, getEmpty);
  const sync = useSyncExternalStore(selectedCoordinator?.subscribe || subscribeEmpty, selectedCoordinator?.getSnapshot || getEmptySync, getEmptySync);
  const durable = !!runtime || normalHighlightRuntime?.storageMode === "durable-v2";
  return { ...state, session, synchronizationEnabled: durable,
    synchronizationMode: runtime ? "emulator" : durable ? "production" : "local",
    syncRunning: !!sync.running, syncPaused: durable && !runtime && !normalHighlightRuntime.enabled,
    syncCoordinatorError: sync.error || sync.discoveryError, retrySync: selectedCoordinator ? () => selectedCoordinator.retry() : undefined };
}
