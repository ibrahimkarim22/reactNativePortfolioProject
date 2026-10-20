import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { AccessibilityInfo, findNodeHandle, Platform } from "react-native";

export default function useReaderModalFocus({ visible }) {
  const triggerRef = useRef(null);
  const visibleRef = useRef(visible);
  const mounted = useRef(true);
  const pending = useRef(false);
  const frame = useRef(null);
  visibleRef.current = visible;

  const cancel = useCallback(() => {
    pending.current = false;
    if (frame.current != null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  const queueRestore = useCallback(function schedule(framesRemaining = 1) {
    if (!mounted.current || !pending.current || frame.current != null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (!mounted.current || !pending.current || visibleRef.current) return;
      if (framesRemaining > 1) {
        schedule(framesRemaining - 1);
        return;
      }
      pending.current = false;
      if (Platform.OS === "web") {
        triggerRef.current?.focus?.();
      } else {
        const target = findNodeHandle(triggerRef.current);
        if (target != null) AccessibilityInfo.setAccessibilityFocus(target);
      }
    });
  }, []);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancel();
    };
  }, [cancel]);

  useLayoutEffect(() => {
    if (visible) cancel();
  }, [visible, cancel]);

  useEffect(() => {
    if (visible || !pending.current) return;
    // RN 0.79 exposes no Android Modal dismissal event, and its Dialog does not
    // reliably produce AppState focus events. Start after the closed React
    // commit, then allow two native frame opportunities before sending focus.
    // This is a bounded scheduling fallback; device TalkBack checks still need
    // to verify that the dismissed window no longer wins accessibility focus.
    if (Platform.OS === "android") queueRestore(2);
    else if (Platform.OS === "web") queueRestore();
  }, [visible, queueRestore]);

  const restoreAfterClose = useCallback(() => {
    cancel();
    if (!mounted.current) return;
    pending.current = true;
    // The caller marks intent before setting visible=false. No focus work is
    // queued from the close handler while the native modal is still visible.
  }, [cancel]);

  const onDismiss = useCallback(() => {
    if (Platform.OS === "ios" && !visibleRef.current) queueRestore();
  }, [queueRestore]);

  return { triggerRef, restoreAfterClose, onDismiss, cancel };
}
