import { useEffect, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createReaderPreferenceStore } from "./readerPreferences";

// One reader-only store is shared by both route wrappers. The persisted Redux
// root and authentication/course state are deliberately outside this module.
const readerStore = createReaderPreferenceStore(AsyncStorage);

export default function useReaderPreferences() {
  const snapshot = useSyncExternalStore(readerStore.subscribe, readerStore.getSnapshot, readerStore.getSnapshot);
  useEffect(() => { readerStore.hydrate(); }, []);
  return {
    ...snapshot,
    update: readerStore.update,
    reset: readerStore.reset,
    retry: readerStore.retry,
    flush: readerStore.flush,
  };
}
