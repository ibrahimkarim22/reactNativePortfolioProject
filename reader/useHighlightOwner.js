import { useEffect, useSyncExternalStore } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { createHighlightOwner } from "./highlightOwner";

export const highlightOwner = createHighlightOwner({
  observe: (next, error) => onAuthStateChanged(require("../firebaseConfig").FIREBASE_AUTH, next, error),
});

export default function useHighlightOwner() {
  const owner = useSyncExternalStore(highlightOwner.subscribe, highlightOwner.getSnapshot, highlightOwner.getSnapshot);
  useEffect(() => highlightOwner.acquire(), []);
  return owner;
}
