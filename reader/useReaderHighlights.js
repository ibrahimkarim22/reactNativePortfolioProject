import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { onAuthStateChanged } from "firebase/auth";
import { FIREBASE_AUTH } from "../firebaseConfig";
import { createHighlightStoreManager } from "./readerHighlightStore";
import { createReaderHighlightSession } from "./readerHighlightSession";

// Both reader routes share one ordered queue for each immutable UID/work key.
const manager = createHighlightStoreManager(AsyncStorage);
const empty = Object.freeze({ scope: null, records: [], unresolved: [], unreadable: [], conflicts: [],
  hydrated: false, loading: false, saving: false, error: null, renderError: null, privacyReady: false, enabled: false });
const subscribeEmpty = () => () => {};
const getEmpty = () => empty;

export default function useReaderHighlights(document, surfaceRef, ready) {
  const surface = useRef(surfaceRef);
  surface.current = surfaceRef;
  const session = useMemo(() => document ? createReaderHighlightSession({
    manager, document, surface: () => surface.current.current,
  }) : null, [document]);
  const mounts = useRef(new Map());
  useEffect(() => {
    if (!session) return undefined;
    const counts = mounts.current;
    counts.set(session, (counts.get(session) || 0) + 1);
    let active = true;
    const unsubscribe = onAuthStateChanged(FIREBASE_AUTH,
      user => { if (active) session.setOwner(user?.uid || null); },
      () => { if (active) session.setOwner(null); });
    return () => {
      active = false;
      unsubscribe();
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
  }, [session]);
  useEffect(() => { session?.setReady(ready); }, [session, ready]);
  const state = useSyncExternalStore(session?.subscribe || subscribeEmpty, session?.getSnapshot || getEmpty, getEmpty);
  return { ...state, session };
}
