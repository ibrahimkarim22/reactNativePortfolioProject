import React, { useCallback, useRef, useState } from "react";
import { Modal as NativeModal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { THEMES } from "./readerConstants";

function rejection(code) {
  return Object.assign(new Error("Selection verification: " + code), { code });
}

export default function ReaderSelectionVerifier({ surfaceRef, documentId, theme = THEMES.paper }) {
  // Metro removes the development branch from release behavior. In particular,
  // production does not install a global, focus listener, or native control.
  if (!__DEV__) return null;

  const insets = useSafeAreaInsets();
  const [enabled, setEnabled] = useState(false);
  const [showControl, setShowControl] = useState(true);
  const [focused, setFocused] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const pressed = useRef(false);
  const session = useRef({ focused: false, enabled: false, generation: 0, documentId, surfaceRef });
  const owner = useRef(null);
  const current = session.current;
  if (current.documentId !== documentId || current.surfaceRef !== surfaceRef) {
    current.generation++;
    current.documentId = documentId;
    current.surfaceRef = surfaceRef;
    pressed.current = false;
  }

  const ownsReader = () => session.current.focused && globalThis.BardSelectionVerification === owner.current;
  const cancel = () => {
    session.current.generation++;
    pressed.current = false;
    setReceipt(null);
    try { session.current.surfaceRef.current?.clearSelection?.("cancel"); } catch (_) { /* Native cancellation is best effort. */ }
  };
  if (!owner.current) {
    owner.current = {
      enable(options = {}) {
        if (!ownsReader()) return;
        session.current.enabled = true;
        setShowControl(options.showControl !== false);
        setEnabled(true);
      },
      disable() {
        session.current.enabled = false;
        setEnabled(false);
        cancel();
      },
      async capture() {
        if (!ownsReader()) throw rejection("READER_NOT_FOCUSED");
        if (!session.current.enabled) throw rejection("VERIFIER_DISABLED");
        const state = session.current;
        const generation = ++state.generation;
        const capturedDocument = state.documentId;
        const active = () => ownsReader() && state.enabled && state.generation === generation && state.documentId === capturedDocument;
        try {
          if (!capturedDocument || typeof state.surfaceRef.current?.captureSelection !== "function") throw rejection("SURFACE_UNAVAILABLE");
          // Read the live Range before changing any UI or moving native focus.
          const pending = state.surfaceRef.current.captureSelection();
          setReceipt(null);
          const snapshot = await pending;
          if (!active()) throw rejection("CANCELLED");
          if (snapshot.documentId !== capturedDocument) throw rejection("DOCUMENT_CHANGED");
          setReceipt({ generation, documentId: capturedDocument, snapshot });
          return snapshot;
        } catch (error) {
          if (!active()) throw rejection("CANCELLED");
          const code = typeof error?.code === "string" && /^[A-Z_]{1,64}$/.test(error.code) ? error.code : "CAPTURE_FAILED";
          setReceipt({ generation, documentId: capturedDocument, code });
          throw rejection(code);
        }
      },
    };
  }

  useFocusEffect(useCallback(() => {
    session.current.focused = true;
    setFocused(true);
    globalThis.BardSelectionVerification = owner.current;
    return () => {
      session.current.focused = false;
      setFocused(false);
      if (session.current.enabled) cancel();
      session.current.enabled = false;
      setEnabled(false);
      if (globalThis.BardSelectionVerification === owner.current) delete globalThis.BardSelectionVerification;
    };
  }, []));

  if (!enabled || !focused || !ownsReader()) return null;
  const visibleReceipt = receipt?.documentId === documentId && receipt.generation === current.generation ? receipt : null;
  if (!showControl && !visibleReceipt) return null;
  const selection = visibleReceipt?.snapshot?.selection;
  const initiate = () => { owner.current.capture().catch(() => {}); };
  const close = () => { setReceipt(null); };

  return (
    <React.Fragment>
      {showControl && <View style={[styles.verifier, { backgroundColor: theme.panel, borderColor: theme.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Capture selection"
        onPressIn={() => { pressed.current = {}; initiate(); }}
        onPressOut={() => {
          const gesture = pressed.current;
          // Pressability emits a successful onPress in the same transition as
          // onPressOut. Retire cancelled gestures after that transition, too.
          Promise.resolve().then(() => { if (pressed.current === gesture) pressed.current = false; });
        }}
        onPress={() => {
          if (pressed.current) { pressed.current = false; return; }
          initiate();
        }}
        onTouchCancel={() => { pressed.current = false; }}
        style={styles.capture}
      >
        <Text style={[styles.controlLabel, { color: theme.accent }]}>Capture selection · DEV</Text>
      </Pressable>
      </View>}
      {visibleReceipt && (
        <NativeModal visible transparent animationType="none" onRequestClose={close}>
          <View style={styles.backdrop}>
            <View
              accessibilityViewIsModal
              onAccessibilityEscape={close}
              style={[styles.panel, { backgroundColor: theme.panel, borderColor: theme.border, paddingBottom: insets.bottom }]}
            >
              <View style={[styles.header, { borderBottomColor: theme.border }]}>
                <Text accessible accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>Selection verification</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Close selection verification" onPress={close} style={styles.close}>
                  <Text style={[styles.controlLabel, { color: theme.accent }]}>Close</Text>
                </Pressable>
              </View>
              <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
                {selection ? (
                  <View>
                    <Text selectable style={[styles.quotation, { color: theme.text }]}>{selection.exact}</Text>
                    <Text selectable style={[styles.reference, { color: theme.secondary }]}>{JSON.stringify({
                      documentId: visibleReceipt.snapshot.documentId,
                      captureToken: visibleReceipt.snapshot.captureToken,
                      selectionSeq: visibleReceipt.snapshot.selectionSeq,
                      workId: selection.workId,
                      contentVersion: selection.contentVersion,
                      canonicalTextVersion: selection.canonicalTextVersion,
                      start: selection.start, end: selection.end,
                      startRef: selection.startRef, endRef: selection.endRef,
                      prefix: selection.prefix, suffix: selection.suffix,
                    }, null, 2)}</Text>
                  </View>
                ) : <Text selectable style={[styles.quotation, { color: theme.text }]}>{visibleReceipt.code}</Text>}
              </ScrollView>
            </View>
          </View>
        </NativeModal>
      )}
    </React.Fragment>
  );
}

const systemFont = Platform.OS === "ios" ? "System" : "sans-serif";
const styles = StyleSheet.create({
  verifier: { borderTopWidth: StyleSheet.hairlineWidth },
  capture: { minHeight: 48, paddingHorizontal: 16, paddingVertical: 12, justifyContent: "center", alignItems: "center" },
  controlLabel: { fontFamily: systemFont, fontSize: 15, fontWeight: "600" },
  backdrop: { flex: 1, justifyContent: "flex-end", alignItems: "center", backgroundColor: "rgba(0, 0, 0, 0.45)" },
  panel: { width: "100%", maxWidth: 560, maxHeight: "85%", borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "center", paddingLeft: 20, paddingRight: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  heading: { flex: 1, fontFamily: systemFont, fontSize: 20, fontWeight: "600" },
  close: { minWidth: 48, minHeight: 48, paddingHorizontal: 12, justifyContent: "center", alignItems: "center" },
  scroll: { flexShrink: 1 },
  content: { padding: 20 },
  quotation: { fontFamily: systemFont, fontSize: 17, lineHeight: 25, marginBottom: 16 },
  reference: { fontFamily: systemFont, fontSize: 13, lineHeight: 20 },
});
