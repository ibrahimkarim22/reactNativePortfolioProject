import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { WebView } from "react-native-webview";
import Loader from "../Componenets/Loader";
import { DEFAULT_PREFERENCES, THEMES } from "./readerConstants";
import { buildAppearanceScript, buildNavigationScript, buildSectionFocusScript, isAllowedReaderNavigation, parseReaderMessage } from "./readerProtocol";
import { createReaderSelectionController } from "./readerSelectionController";
import { buildSelectionScript } from "./readerSelectionProtocol";

const ReaderSurface = forwardRef(function ReaderSurface({
  document,
  preferences = DEFAULT_PREFERENCES,
  fontFaces,
  onMessage,
}, forwardedRef) {
  const webView = useRef(null);
  const ready = useRef(false);
  const requestId = useRef(0);
  const navigationId = useRef(0);
  const locationSeq = useRef(0);
  const readinessTimer = useRef(null);
  const activeDocument = useRef(document.identity.documentId);
  const latestAppearance = useRef(null);
  const latestOnMessage = useRef(onMessage);
  const { fontScale } = useWindowDimensions();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const theme = THEMES[preferences.theme] || THEMES.paper;
  // Appearance is deliberately absent: changing it must keep this WebView and
  // its reading position alive. Only a different reading document changes HTML.
  const source = useMemo(() => ({ html: document.html, baseUrl: "about:blank" }), [document.html]);
  latestAppearance.current = { preferences, fontScale, fontFaces };
  latestOnMessage.current = onMessage;

  const report = useCallback(message => { latestOnMessage.current?.(message); }, []);
  const selectionController = useMemo(() => createReaderSelectionController({
    identity: document.identity,
    canonical: document.canonical,
    onChange: report,
    send: (kind, payload) => {
      if (!ready.current || !webView.current || activeDocument.current !== document.identity.documentId) {
        throw Object.assign(new Error("The reading surface is unavailable."), { code: "SURFACE_UNAVAILABLE" });
      }
      webView.current.injectJavaScript(buildSelectionScript(document.identity, payload.selectionRequestId, kind, kind === "capture" ? payload.captureToken : payload.reason));
    },
  }), [document.identity, document.canonical, report]);
  useLayoutEffect(() => () => {
    selectionController.clear("document");
    selectionController.dispose();
  }, [selectionController]);

  const applyAppearance = useCallback(() => {
    selectionController.clear("appearance");
    if (!ready.current || !webView.current || activeDocument.current !== document.identity.documentId) return;
    const nextRequest = ++requestId.current;
    webView.current.injectJavaScript(buildAppearanceScript(document.identity, nextRequest, latestAppearance.current));
  }, [document.identity, selectionController]);

  useImperativeHandle(forwardedRef, () => ({
    applyAppearance,
    captureSelection: () => selectionController.capture(),
    clearSelection: (reason = "cancel") => selectionController.clear(reason),
    jumpToSection: reference => {
      selectionController.clear("navigation");
      if (!ready.current || !webView.current || activeDocument.current !== document.identity.documentId) return null;
      const next = navigationId.current + 1;
      const script = buildNavigationScript(document.identity, next, reference, document.canonical);
      navigationId.current = next;
      webView.current.injectJavaScript(script);
      return next;
    },
    focusSection: (reference, expectedId) => {
      if (!ready.current || expectedId !== navigationId.current || activeDocument.current !== document.identity.documentId) return false;
      webView.current?.injectJavaScript(buildSectionFocusScript(document.identity, expectedId, reference, document.canonical));
      return true;
    },
  }), [applyAppearance, document.identity, document.canonical, selectionController]);

  useLayoutEffect(() => {
    activeDocument.current = document.identity.documentId;
    ready.current = false;
    navigationId.current = 0;
    locationSeq.current = 0;
    setLoading(true);
    setError(null);
    readinessTimer.current = setTimeout(() => {
      if (ready.current || activeDocument.current !== document.identity.documentId) return;
      selectionController.clear("document");
      setLoading(false);
      setError("Unable to display this play. Go back and open it again.");
      report({ ...document.identity, type: "error", code: "DOCUMENT_READY_TIMEOUT", message: "The reading document did not become ready." });
    }, 15000);
    return () => clearTimeout(readinessTimer.current);
  }, [document.identity.documentId]);

  useEffect(() => {
    applyAppearance();
  }, [applyAppearance, preferences, fontFaces, fontScale]);

  const receiveMessage = useCallback(event => {
    if (activeDocument.current !== document.identity.documentId) return;
    const message = parseReaderMessage(event.nativeEvent?.data, document.identity, document.canonical);
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
      clearTimeout(readinessTimer.current);
      setLoading(false);
      setError("Unable to display this play. Go back and open it again.");
      report(message);
      return;
    }
    if (!ready.current) return;
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
      setLoading(false);
      setError("The reading appearance could not be updated. Your play is still open.");
    }
    if (message.type === "applied") setError(null);
    report(message);
  }, [applyAppearance, document.identity, document.canonical, report, selectionController]);

  const loadError = useCallback(() => {
    ready.current = false;
    selectionController.clear("document");
    clearTimeout(readinessTimer.current);
    setLoading(false);
    setError("Unable to display this play. Go back and open it again.");
    report({ ...document.identity, type: "error", code: "SURFACE_LOAD_FAILED", message: "The reading surface could not load its local document." });
  }, [document.identity, report, selectionController]);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {error && (
        <View accessibilityRole="alert" style={[styles.error, { backgroundColor: theme.panel, borderColor: theme.border }]}>
          <Text style={{ color: theme.text }}>{error}</Text>
        </View>
      )}
      <WebView
        ref={webView}
        source={source}
        style={[styles.document, { backgroundColor: theme.background }]}
        onMessage={receiveMessage}
        onError={loadError}
        onHttpError={loadError}
        onContentProcessDidTerminate={loadError}
        onRenderProcessGone={loadError}
        onOpenWindow={() => { /* Local reading documents never open another window. */ }}
        onShouldStartLoadWithRequest={request => isAllowedReaderNavigation(request.url)}
        // WebView opens URLs outside originWhitelist in the OS. Matching every
        // origin ensures every attempted navigation reaches our rejecting policy.
        originWhitelist={["*"]}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        mixedContentMode="never"
        javaScriptEnabled
        // Local development inspection measures the real Android viewport and
        // font metrics. Release documents never expose a debugging endpoint.
        webviewDebuggingEnabled={typeof __DEV__ !== "undefined" && __DEV__}
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows={false}
        sharedCookiesEnabled={false}
        thirdPartyCookiesEnabled={false}
        domStorageEnabled={false}
        textZoom={100}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
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
  container: { flex: 1 },
  document: { flex: 1 },
  error: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 24, paddingVertical: 12 },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  loadingPanel: { backgroundColor: "#050505", borderRadius: 12, marginHorizontal: 24 },
});

export default ReaderSurface;
