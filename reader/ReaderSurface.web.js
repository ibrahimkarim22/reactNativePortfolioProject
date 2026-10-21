import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Loader from "../Componenets/Loader";
import { DEFAULT_PREFERENCES, THEMES } from "./readerConstants";
import { parseReaderMessage, sectionCommandPayload } from "./readerProtocol";
import { createReaderSelectionController } from "./readerSelectionController";
import { selectionCommandPayload } from "./readerSelectionProtocol";
import { createReaderHighlightController } from "./readerHighlightController";

// The web target uses the same app-owned document in a script-only sandbox.
// Its opaque origin prevents access to the parent app; messages are scoped to
// the exact frame window and the same document identity as the native bridge.
const ReaderSurface = forwardRef(function ReaderSurface({
  document,
  preferences = DEFAULT_PREFERENCES,
  fontFaces,
  onMessage,
}, forwardedRef) {
  const frame = useRef(null);
  const ready = useRef(false);
  const requestId = useRef(0);
  const navigationId = useRef(0);
  const locationSeq = useRef(0);
  const readinessTimer = useRef(null);
  const activeDocument = useRef(document.identity.documentId);
  const surfaceActive = useRef(true);
  const initializedDocument = useRef(null);
  const controllerLifetimes = useRef(new Map());
  const latestAppearance = useRef(null);
  const latestOnMessage = useRef(onMessage);
  const { fontScale } = useWindowDimensions();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const theme = THEMES[preferences.theme] || THEMES.paper;
  const srcDoc = useMemo(() => document.html, [document.html]);
  latestAppearance.current = { preferences, fontScale, fontFaces };
  latestOnMessage.current = onMessage;

  const report = useCallback(message => { latestOnMessage.current?.(message); }, []);
  const selectionController = useMemo(() => createReaderSelectionController({
    identity: document.identity,
    canonical: document.canonical,
    onChange: report,
    send: (kind, payload) => {
      if (!surfaceActive.current || !ready.current || !frame.current?.contentWindow || activeDocument.current !== document.identity.documentId) {
        throw Object.assign(new Error("The reading surface is unavailable."), { code: "SURFACE_UNAVAILABLE" });
      }
      frame.current.contentWindow.postMessage({
        type: kind === "capture" ? "bard-reader-selection-capture" : "bard-reader-selection-clear",
        payload: selectionCommandPayload(document.identity, payload.selectionRequestId, kind, kind === "capture" ? payload.captureToken : payload.reason),
      }, "*");
    },
  }), [document.identity, document.canonical, report]);
  const highlightController = useMemo(() => createReaderHighlightController({
    identity: document.identity,
    canonical: document.canonical,
    send: (kind, payloads) => {
      if (!surfaceActive.current || !ready.current || !frame.current?.contentWindow || activeDocument.current !== document.identity.documentId) {
        throw Object.assign(new Error("The reading surface is unavailable."), { code: "SURFACE_UNAVAILABLE" });
      }
      for (const payload of payloads) frame.current.contentWindow.postMessage({
        type: kind === "apply" ? "bard-reader-highlights" : "bard-reader-highlight-show", payload,
      }, "*");
    },
  }), [document.identity, document.canonical]);
  useLayoutEffect(() => {
    const lifetimes = controllerLifetimes.current;
    const lifetime = lifetimes.get(highlightController) || { mounts: 0 };
    lifetimes.set(highlightController, lifetime);
    lifetime.mounts++;
    surfaceActive.current = true;
    return () => {
      selectionController.clear("document");
      highlightController.invalidate();
      surfaceActive.current = false;
      lifetime.mounts--;
      // Effect replay reuses the same controllers. Pending work is retired
      // immediately; only irreversible disposal waits for a replayed setup.
      queueMicrotask(() => {
        if (lifetime.mounts === 0) {
          selectionController.dispose(); highlightController.dispose();
          lifetimes.delete(highlightController);
        }
      });
    };
  }, [selectionController, highlightController]);

  const applyAppearance = useCallback(() => {
    selectionController.clear("appearance");
    if (!ready.current || !frame.current?.contentWindow || activeDocument.current !== document.identity.documentId) return;
    frame.current.contentWindow.postMessage({
      type: "bard-reader-appearance",
      payload: { ...document.identity, requestId: ++requestId.current, ...latestAppearance.current },
    }, "*");
  }, [document.identity, selectionController]);

  useImperativeHandle(forwardedRef, () => ({
    applyAppearance,
    captureSelection: () => selectionController.capture(),
    clearSelection: (reason = "cancel") => selectionController.clear(reason),
    applyHighlights: (records, ownerGeneration) => highlightController.apply(records, ownerGeneration),
    showHighlight: (record, ownerGeneration) => highlightController.show(record, ownerGeneration),
    jumpToSection: reference => {
      selectionController.clear("navigation");
      if (!ready.current || !frame.current?.contentWindow || activeDocument.current !== document.identity.documentId) return null;
      const next = navigationId.current + 1;
      const payload = sectionCommandPayload(document.identity, next, reference, document.canonical);
      navigationId.current = next;
      frame.current.contentWindow.postMessage({ type: "bard-reader-jump", payload }, "*");
      return next;
    },
    focusSection: (reference, expectedId) => {
      if (!ready.current || expectedId !== navigationId.current || activeDocument.current !== document.identity.documentId) return false;
      frame.current?.contentWindow?.postMessage({ type: "bard-reader-focus", payload: sectionCommandPayload(document.identity, expectedId, reference, document.canonical) }, "*");
      return true;
    },
  }), [applyAppearance, document.identity, document.canonical, selectionController, highlightController]);

  useLayoutEffect(() => {
    if (initializedDocument.current !== document.identity.documentId) {
      initializedDocument.current = document.identity.documentId;
      activeDocument.current = document.identity.documentId;
      ready.current = false;
      navigationId.current = 0;
      locationSeq.current = 0;
      setLoading(true);
      setError(null);
    }
    if (ready.current) return undefined;
    readinessTimer.current = setTimeout(() => {
      if (ready.current || activeDocument.current !== document.identity.documentId) return;
      selectionController.clear("document");
      highlightController.dispose();
      setLoading(false);
      setError("Unable to display this play. Go back and open it again.");
      report({ ...document.identity, type: "error", code: "DOCUMENT_READY_TIMEOUT", message: "The reading document did not become ready." });
    }, 15000);
    return () => clearTimeout(readinessTimer.current);
  }, [document.identity.documentId]);

  useLayoutEffect(() => {
    const receiveMessage = event => {
      if (!surfaceActive.current || event.source !== frame.current?.contentWindow || activeDocument.current !== document.identity.documentId) return;
      const message = parseReaderMessage(event.data, document.identity, document.canonical);
      if (!message) return;
      if (message.type === "ready") {
        if (ready.current) return;
        ready.current = true;
        clearTimeout(readinessTimer.current);
        setLoading(false);
        setError(null);
        report(message);
        applyAppearance();
        return;
      }
      if (message.type === "error" && message.requestId == null && !ready.current) {
        selectionController.clear("document");
        highlightController.dispose();
        clearTimeout(readinessTimer.current);
        setLoading(false);
        setError("Unable to display this play. Go back and open it again.");
        report(message);
        return;
      }
      if (!ready.current) return;
      if (message.type === "highlightsApplied" || message.type === "highlightShown") {
        if (highlightController.receive(message)) report(message);
        return;
      }
      if (message.type === "selectionChange" || message.type === "selectionCapture") {
        selectionController.receive(message);
        return;
      }
      if (message.type === "location") {
        if (message.locationSeq <= locationSeq.current) return;
        locationSeq.current = message.locationSeq;
        report(message);
        return;
      }
      if (message.type === "jumped") {
        if (message.navigationId === navigationId.current) report(message);
        return;
      }
      if (message.requestId != null && message.requestId !== requestId.current) return;
      if (message.type === "error") {
        selectionController.clear("appearance");
        setError("The reading appearance could not be updated. Your play is still open.");
      }
      if (message.type === "applied") setError(null);
      report(message);
    };
    window.addEventListener("message", receiveMessage);
    return () => window.removeEventListener("message", receiveMessage);
  }, [applyAppearance, document.identity, document.canonical, report, selectionController, highlightController]);

  useEffect(() => {
    applyAppearance();
  }, [applyAppearance, preferences, fontFaces, fontScale]);

  const loadError = useCallback(() => {
    ready.current = false;
    selectionController.clear("document");
    highlightController.dispose();
    clearTimeout(readinessTimer.current);
    setLoading(false);
    setError("Unable to display this play. Go back and open it again.");
    report({ ...document.identity, type: "error", code: "SURFACE_LOAD_FAILED", message: "The reading surface could not load its local document." });
  }, [document.identity, report, selectionController, highlightController]);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {error && (
        <View accessibilityRole="alert" style={[styles.error, { backgroundColor: theme.panel, borderColor: theme.border }]}>
          <Text style={{ color: theme.text }}>{error}</Text>
        </View>
      )}
      <iframe
        ref={frame}
        title="Complete play text"
        srcDoc={srcDoc}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        onError={loadError}
        style={{ flex: 1, width: "100%", height: "100%", minHeight: 0, border: 0, display: "block", backgroundColor: theme.background }}
      />
      {loading && (
        <View style={styles.loading} pointerEvents="none">
          <View style={styles.loadingPanel}>
            <Loader label="Opening play" detail="Preparing the complete local text" />
          </View>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0 },
  error: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 24, paddingVertical: 12 },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  loadingPanel: { backgroundColor: "#050505", borderRadius: 12, marginHorizontal: 24 },
});

export default ReaderSurface;
