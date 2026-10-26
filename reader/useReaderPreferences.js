import { useEffect, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createReaderPreferenceStore } from "./readerPreferences";

// One reader-only store is shared by both route wrappers. The persisted Redux
// root and authentication/course state are deliberately outside this module.
const readerStore = createReaderPreferenceStore(AsyncStorage);

export default function useReaderPreferences(isolatedStore) {
  const selected = isolatedStore || readerStore;
  const snapshot = useSyncExternalStore(selected.subscribe, selected.getSnapshot, selected.getSnapshot);
  useEffect(() => { selected.hydrate(); }, [selected]);
  return {
    ...snapshot,
    update: selected.update,
    reset: selected.reset,
    retry: selected.retry,
    flush: selected.flush,
  };
}
