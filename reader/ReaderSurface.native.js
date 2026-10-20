import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { WebView } from "react-native-webview";
import Loader from "../Componenets/Loader";
import { DEFAULT_PREFERENCES, THEMES } from "./readerConstants";
import { buildAppearanceScript, isAllowedReaderNavigation, parseReaderMessage } from "./readerProtocol";

const ReaderSurface = forwardRef(function ReaderSurface({
  document,
  preferences = DEFAULT_PREFERENCES,
  fontFaces,
  onMessage,
}, forwardedRef) {
  const webView = useRef(null);
  const ready = useRef(false);
  const requestId = useRef(0);
  const readinessTimer = useRef(null);
  const activeDocument = useRef(document.identity.documentId);
  const latestAppearance = useRef(null);
  const { fontScale } = useWindowDimensions();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const theme = THEMES[preferences.theme] || THEMES.paper;
  // Appearance is deliberately absent: changing it must keep this WebView and
  // its reading position alive. Only a different reading document changes HTML.
  const source = useMemo(() => ({ html: document.html, baseUrl: "about:blank" }), [document.html]);
  latestAppearance.current = { preferences, fontScale, fontFaces };

  const report = useCallback(message => { onMessage?.(message); }, [onMessage]);
  const applyAppearance = useCallback(() => {
    if (!ready.current || !webView.current || activeDocument.current !== document.identity.documentId) return;
    const nextRequest = ++requestId.current;
    webView.current.injectJavaScript(buildAppearanceScript(document.identity, nextRequest, latestAppearance.current));
  }, [document.identity]);

  useImperativeHandle(forwardedRef, () => ({
    applyAppearance,
    injectJavaScript: script => webView.current?.injectJavaScript(script),
  }), [applyAppearance]);

  useLayoutEffect(() => {
    activeDocument.current = document.identity.documentId;
    ready.current = false;
    setLoading(true);
    setError(null);
    readinessTimer.current = setTimeout(() => {
      if (ready.current || activeDocument.current !== document.identity.documentId) return;
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
    const message = parseReaderMessage(event.nativeEvent?.data, document.identity);
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
      clearTimeout(readinessTimer.current);
      setLoading(false);
      setError("Unable to display this play. Go back and open it again.");
      report(message);
      return;
    }
    if (!ready.current || (message.requestId != null && message.requestId !== requestId.current)) return;
    if (message.type === "error") {
      setLoading(false);
      setError("The reading appearance could not be updated. Your play is still open.");
    }
    if (message.type === "applied") setError(null);
    report(message);
  }, [applyAppearance, document.identity, report]);

  const loadError = useCallback(() => {
    ready.current = false;
    clearTimeout(readinessTimer.current);
    setLoading(false);
    setError("Unable to display this play. Go back and open it again.");
    report({ ...document.identity, type: "error", code: "SURFACE_LOAD_FAILED", message: "The reading surface could not load its local document." });
  }, [document.identity, report]);

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
