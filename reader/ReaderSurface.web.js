import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Loader from "../Componenets/Loader";
import { DEFAULT_PREFERENCES, THEMES } from "./readerConstants";
import { parseReaderMessage } from "./readerProtocol";

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
  const readinessTimer = useRef(null);
  const activeDocument = useRef(document.identity.documentId);
  const latestAppearance = useRef(null);
  const { fontScale } = useWindowDimensions();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const theme = THEMES[preferences.theme] || THEMES.paper;
  const srcDoc = useMemo(() => document.html, [document.html]);
  latestAppearance.current = { preferences, fontScale, fontFaces };

  const applyAppearance = useCallback(() => {
    if (!ready.current || !frame.current?.contentWindow || activeDocument.current !== document.identity.documentId) return;
    frame.current.contentWindow.postMessage({
      type: "bard-reader-appearance",
      payload: { ...document.identity, requestId: ++requestId.current, ...latestAppearance.current },
    }, "*");
  }, [document.identity]);

  useImperativeHandle(forwardedRef, () => ({ applyAppearance }), [applyAppearance]);

  useLayoutEffect(() => {
    activeDocument.current = document.identity.documentId;
    ready.current = false;
    setLoading(true);
    setError(null);
    readinessTimer.current = setTimeout(() => {
      if (ready.current || activeDocument.current !== document.identity.documentId) return;
      setLoading(false);
      setError("Unable to display this play. Go back and open it again.");
      onMessage?.({ ...document.identity, type: "error", code: "DOCUMENT_READY_TIMEOUT", message: "The reading document did not become ready." });
    }, 15000);
    return () => clearTimeout(readinessTimer.current);
  }, [document.identity.documentId]);

  useLayoutEffect(() => {
    const receiveMessage = event => {
      if (event.source !== frame.current?.contentWindow || activeDocument.current !== document.identity.documentId) return;
      const message = parseReaderMessage(event.data, document.identity);
      if (!message) return;
      if (message.type === "ready") {
        if (ready.current) return;
        ready.current = true;
        clearTimeout(readinessTimer.current);
        setLoading(false);
        setError(null);
        onMessage?.(message);
        applyAppearance();
        return;
      }
      if (message.type === "error" && message.requestId == null && !ready.current) {
        clearTimeout(readinessTimer.current);
        setLoading(false);
        setError("Unable to display this play. Go back and open it again.");
        onMessage?.(message);
        return;
      }
      if (!ready.current || (message.requestId != null && message.requestId !== requestId.current)) return;
      if (message.type === "error") setError("The reading appearance could not be updated. Your play is still open.");
      if (message.type === "applied") setError(null);
      onMessage?.(message);
    };
    window.addEventListener("message", receiveMessage);
    return () => window.removeEventListener("message", receiveMessage);
  }, [applyAppearance, document.identity, onMessage]);

  useEffect(() => {
    applyAppearance();
  }, [applyAppearance, preferences, fontFaces, fontScale]);

  const loadError = useCallback(() => {
    ready.current = false;
    clearTimeout(readinessTimer.current);
    setLoading(false);
    setError("Unable to display this play. Go back and open it again.");
    onMessage?.({ ...document.identity, type: "error", code: "SURFACE_LOAD_FAILED", message: "The reading surface could not load its local document." });
  }, [document.identity, onMessage]);

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
