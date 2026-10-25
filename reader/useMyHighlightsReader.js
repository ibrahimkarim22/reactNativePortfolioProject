import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { normalHighlightManager, normalMyHighlightsHandoff } from "./normalHighlightStore";
import { highlightOwner } from "./useHighlightOwner";

export default function useMyHighlightsReader({ request, document, session }) {
  const operation = useRef(null);
  const [state, setState] = useState({ request: null, opening: false, error: null });
  // The list owns the normal auth observation. This adapter only observes its
  // generation so a cancelled broker cannot leave an old status on screen.
  const owner = useSyncExternalStore(highlightOwner.subscribe, highlightOwner.getSnapshot, highlightOwner.getSnapshot);
  const ownsRequest = !!request && owner.ready && owner.uid === request.uid && owner.generation === request.generation;
  const cancel = useCallback(() => {
    const current = operation.current;
    operation.current = null;
    current?.handle?.cancel();
    setState(previous => previous.opening || previous.error ? { request: null, opening: false, error: null } : previous);
  }, []);
  useEffect(() => {
    if (!ownsRequest || !document || !session) { cancel(); return undefined; }
    const current = { handle: null };
    operation.current = current;
    setState({ request, opening: true, error: null });
    const active = () => operation.current === current;
    // A development effect replay retires this start before it claims the token.
    queueMicrotask(() => {
      if (!active()) return;
      const complete = error => {
        if (!active()) return;
        operation.current = null;
        setState({ request, opening: false, error: error ? "This saved passage changed or is unavailable. Return to My Highlights and try again. It has not been moved to another location." : null });
      };
      try {
        const store = normalHighlightManager.forWork({ uid: request.uid, canonical: document.canonical });
        current.handle = normalMyHighlightsHandoff.open({ request, store, session,
          onComplete: () => complete(), onError: complete });
      } catch (error) { complete(error); }
    });
    return () => { if (active()) cancel(); };
  }, [request, document, session, cancel, ownsRequest]);
  const visible = ownsRequest && state.request === request;
  return { opening: visible && state.opening, error: visible ? state.error : null, cancel };
}
