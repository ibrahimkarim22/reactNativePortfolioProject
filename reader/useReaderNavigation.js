import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import useReaderModalFocus from "./useReaderModalFocus";

export default function useReaderNavigation({ document, model }) {
  const surfaceRef = useRef(null);
  const [contentsOpen, setContentsOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [currentSectionId, setCurrentSectionId] = useState(model?.initialSectionId || null);
  const contentsFocus = useReaderModalFocus({ visible: contentsOpen });
  const itemsById = useMemo(() => new Map((model?.items || []).map(item => [item.id, item])), [model]);
  const current = itemsById.get(currentSectionId);
  const active = useRef(true);
  const visible = useRef(contentsOpen);
  const activeDocument = useRef(document);
  const surfaceReady = useRef(false);
  const locationSeq = useRef(0);
  const pending = useRef(null);
  const frame = useRef(null);
  visible.current = contentsOpen;
  activeDocument.current = document;

  const cancel = useCallback(() => {
    pending.current = null;
    if (frame.current != null) cancelAnimationFrame(frame.current);
    frame.current = null;
    contentsFocus.cancel();
  }, [contentsFocus.cancel]);

  const completeFocus = useCallback(() => {
    const intent = pending.current;
    if (!active.current || !intent?.acknowledged || !intent.dismissed || visible.current) return;
    pending.current = null;
    surfaceRef.current?.focusSection(intent.reference, intent.navigationId);
  }, []);

  const scheduleDismissed = useCallback(function schedule(framesRemaining) {
    const intent = pending.current;
    if (!active.current || !intent || frame.current != null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (!active.current || pending.current !== intent || visible.current) return;
      if (framesRemaining > 1) schedule(framesRemaining - 1);
      else {
        intent.dismissed = true;
        completeFocus();
      }
    });
  }, [completeFocus]);

  useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false; cancel(); };
  }, [cancel]);

  useEffect(() => {
    cancel();
    surfaceReady.current = false;
    locationSeq.current = 0;
    setReady(false);
    setCurrentSectionId(model?.initialSectionId || null);
    setContentsOpen(false);
  }, [document, model, cancel]);

  useEffect(() => {
    if (contentsOpen || !pending.current || pending.current.dismissed) return;
    // Start only after the closed React commit. Android has no Modal onDismiss
    // event, so allow the same two native frame opportunities as trigger return.
    if (Platform.OS === "android") scheduleDismissed(2);
    else if (Platform.OS === "web") scheduleDismissed(1);
  }, [contentsOpen, scheduleDismissed]);

  const onMessage = useCallback(message => {
    const identity = activeDocument.current?.identity;
    if (!active.current || !identity || !message || !Object.keys(identity).every(key => message[key] === identity[key])) return;
    if (message.type === "ready") {
      surfaceReady.current = true;
      setReady(true);
    } else if (message.type === "location" && itemsById.has(message.sectionId) && message.locationSeq > locationSeq.current) {
      locationSeq.current = message.locationSeq;
      setCurrentSectionId(message.sectionId);
    } else if (message.type === "jumped") {
      const intent = pending.current;
      if (intent && message.navigationId === intent.navigationId && message.sectionId === intent.reference.sectionId) {
        intent.acknowledged = true;
        completeFocus();
      }
    } else if (message.type === "error") {
      cancel();
      if (message.requestId == null && message.navigationId == null) {
        surfaceReady.current = false;
        setReady(false);
      }
    }
  }, [itemsById, completeFocus, cancel]);

  const jumpToSection = useCallback(sectionId => {
    const item = itemsById.get(sectionId);
    if (!active.current || !surfaceReady.current || !item) return;
    cancel();
    const navigationId = surfaceRef.current?.jumpToSection(item.reference);
    if (navigationId == null) return;
    pending.current = { reference: item.reference, navigationId, acknowledged: false, dismissed: !visible.current };
    setContentsOpen(false);
  }, [itemsById, cancel]);

  const openContents = useCallback(() => {
    cancel();
    setContentsOpen(true);
  }, [cancel]);
  const closeContents = useCallback(() => {
    cancel();
    contentsFocus.restoreAfterClose();
    setContentsOpen(false);
  }, [cancel, contentsFocus.restoreAfterClose]);
  const dismissContents = useCallback(() => {
    cancel();
    setContentsOpen(false);
  }, [cancel]);
  const onDismiss = useCallback(() => {
    contentsFocus.onDismiss();
    if (Platform.OS === "ios" && !visible.current && pending.current) scheduleDismissed(1);
  }, [contentsFocus.onDismiss, scheduleDismissed]);
  const activate = useCallback(() => { active.current = true; }, []);
  const deactivate = useCallback(() => { active.current = false; cancel(); }, [cancel]);

  return {
    surfaceRef, contentsOpen, ready, currentSectionId, current,
    contentsButton: contentsFocus.triggerRef,
    openContents, closeContents, dismissContents, jumpToSection, onMessage, onDismiss, activate, deactivate,
  };
}
