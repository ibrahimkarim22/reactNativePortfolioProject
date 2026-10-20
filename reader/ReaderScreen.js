import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StatusBar, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { getLocalPlayEntry } from "../shared/localPlayService";
import ReaderSurface from "./ReaderSurface";
import ReaderAppearanceModal from "./ReaderAppearanceModal";
import ReaderContentsModal from "./ReaderContentsModal";
import ReaderSelectionVerifier from "./ReaderSelectionVerifier";
import { createReaderDocument } from "./readerDocument";
import { buildReaderNavigation } from "./readerNavigation";
import { THEMES } from "./readerConstants";
import { createFontSelection } from "./fontSelection";
import { loadReaderFont } from "./readerFonts";
import useReaderPreferences from "./useReaderPreferences";
import useReaderModalFocus from "./useReaderModalFocus";
import useReaderNavigation from "./useReaderNavigation";

let nextDocumentId = 0;

export default function ReaderScreen({ id }) {
  const navigation = useNavigation();
  const settings = useReaderPreferences();
  const { preferences, hydrated, update, reset, retry, flush } = settings;
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [fontStatus, setFontStatus] = useState({ fontId: null, faces: undefined, loading: false, error: null });
  const [fontRetry, setFontRetry] = useState(0);
  const { triggerRef: appearanceButton, restoreAfterClose, onDismiss, cancel: cancelFocusReturn } = useReaderModalFocus({ visible: appearanceOpen });
  const { fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const theme = THEMES[preferences.theme];
  const validId = (typeof id === "string" && id.trim().length > 0) || (typeof id === "number" && Number.isFinite(id));
  // The legacy service intentionally defaults undefined to the first play. A
  // reader route must select its own play explicitly instead of using that rule.
  const entry = useMemo(() => validId ? getLocalPlayEntry(id) : undefined, [id, validId]);
  const result = useMemo(() => {
    if (!entry) return { error: "This play could not be found in the local library." };
    try {
      const document = createReaderDocument(entry, { documentId: `reader-${++nextDocumentId}` });
      return { document, model: buildReaderNavigation(entry, document.canonical) };
    } catch (error) {
      return { error: "The local text could not be prepared. Go back and open this play again." };
    }
  }, [entry, entry?.play?.contentVersion, entry?.play?.canonicalTextVersion]);
  const readerNavigation = useReaderNavigation(result);
  const title = entry?.play?.title || entry?.name || "Read play";
  const fontSelection = useMemo(() => createFontSelection(loadReaderFont, setFontStatus), []);

  useEffect(() => {
    if (!hydrated || !result.document) return undefined;
    fontSelection.select(preferences.fontId);
    return () => fontSelection.cancel();
  }, [fontSelection, hydrated, result.document, preferences.fontId, fontRetry]);

  const openAppearance = useCallback(() => {
    readerNavigation.surfaceRef.current?.clearSelection?.("modal");
    cancelFocusReturn();
    readerNavigation.dismissContents();
    setAppearanceOpen(true);
  }, [cancelFocusReturn, readerNavigation.dismissContents]);
  const closeAppearance = useCallback(() => {
    restoreAfterClose();
    setAppearanceOpen(false);
    flush();
  }, [flush, restoreAfterClose]);
  const openContents = useCallback(() => {
    cancelFocusReturn();
    setAppearanceOpen(false);
    readerNavigation.openContents();
  }, [cancelFocusReturn, readerNavigation.openContents]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title,
      headerShown: true,
      headerStyle: { backgroundColor: theme.background, height: insets.top + Math.max(56, 44 * fontScale + 12) },
      headerTintColor: theme.text,
      headerTitle: () => <Text accessibilityRole="header" numberOfLines={2} style={[styles.headerTitle, { color: theme.text }]}>{title}</Text>,
      headerLeft: ({ tintColor }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Text style={[styles.backIcon, { color: tintColor || theme.text }]}>{"‹"}</Text>
        </Pressable>
      ),
      headerRight: () => (
        <Pressable
          ref={appearanceButton}
          accessibilityRole="button"
          accessibilityLabel="Reading appearance"
          accessibilityHint="Choose text size, typeface, page color and line spacing"
          onPress={openAppearance}
          style={styles.appearanceButton}
        >
          <Text style={[styles.appearanceLabel, { color: theme.accent }]}>Aa</Text>
        </Pressable>
      ),
    });
  }, [navigation, theme, title, fontScale, insets.top, openAppearance]);

  useFocusEffect(useCallback(() => {
    readerNavigation.activate();
    const status = Platform.OS === "web" ? null : StatusBar.pushStackEntry({
      barStyle: preferences.theme === "night" ? "light-content" : "dark-content",
      backgroundColor: theme.background,
    });
    return () => {
      readerNavigation.surfaceRef.current?.clearSelection?.("document");
      cancelFocusReturn();
      readerNavigation.deactivate();
      if (status != null) StatusBar.popStackEntry(status);
    };
  }, [preferences.theme, theme.background, cancelFocusReturn, readerNavigation.activate, readerNavigation.deactivate]));

  return (
    <SafeAreaView edges={["bottom"]} style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.container} accessibilityElementsHidden={appearanceOpen || readerNavigation.contentsOpen} importantForAccessibility={appearanceOpen || readerNavigation.contentsOpen ? "no-hide-descendants" : "auto"}>
      {result.document && (
        <Pressable
          ref={readerNavigation.contentsButton}
          accessibilityRole="button"
          accessibilityLabel={readerNavigation.current ? `Contents, ${readerNavigation.current.locationLabel}` : "Contents"}
          accessibilityHint="Choose an act, scene or other section"
          accessibilityActions={readerNavigation.ready ? [{ name: "readCurrentSection", label: "Read from current section" }] : []}
          onAccessibilityAction={event => {
            if (event.nativeEvent.actionName === "readCurrentSection") readerNavigation.jumpToSection(readerNavigation.currentSectionId);
          }}
          onPress={openContents}
          style={[styles.locationRow, { backgroundColor: theme.background, borderBottomColor: theme.border }]}
        >
          <Text style={[styles.locationLabel, { color: theme.secondary }]}>{readerNavigation.current?.locationLabel || "Preparing play contents…"}</Text>
          <Text accessibilityElementsHidden importantForAccessibility="no" style={[styles.locationChevron, { color: theme.accent }]}>›</Text>
        </Pressable>
      )}
      {result.document && hydrated ? (
        <ReaderSurface ref={readerNavigation.surfaceRef} document={result.document} preferences={preferences} fontFaces={fontStatus.fontId === preferences.fontId ? fontStatus.faces : undefined} onMessage={readerNavigation.onMessage} />
      ) : result.document ? (
        <View style={styles.loading} accessibilityLabel="Loading reading settings">
          <ActivityIndicator color={theme.accent} />
          <Text style={[styles.errorDetail, { color: theme.secondary }]}>Loading reading settings…</Text>
        </View>
      ) : (
        <View style={styles.error} accessibilityRole="alert">
          <Text style={[styles.errorTitle, { color: theme.text }]}>Unable to open this play</Text>
          <Text style={[styles.errorDetail, { color: theme.secondary }]}>{result.error}</Text>
        </View>
      )}
      </View>
      <ReaderSelectionVerifier surfaceRef={readerNavigation.surfaceRef} documentId={result.document?.identity.documentId} theme={theme} />
      <ReaderContentsModal
        visible={readerNavigation.contentsOpen}
        model={result.model}
        currentSectionId={readerNavigation.currentSectionId}
        theme={theme}
        ready={hydrated && readerNavigation.ready}
        onSelect={readerNavigation.jumpToSection}
        onClose={readerNavigation.closeContents}
        onDismiss={readerNavigation.onDismiss}
      />
      <ReaderAppearanceModal
        visible={appearanceOpen}
        preferences={preferences}
        ready={hydrated}
        onChange={update}
        onReset={reset}
        onClose={closeAppearance}
        onDismiss={onDismiss}
        saveError={settings.error === "read" ? "Reading settings could not be loaded. Changes apply for this session; retry to restore and save them." : settings.error ? "Reading settings could not be saved. Changes apply for this session." : null}
        onRetrySave={retry}
        fontStatus={fontStatus.fontId === preferences.fontId ? fontStatus : { loading: hydrated && !!result.document }}
        onRetryFont={() => setFontRetry(value => value + 1)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  backButton: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
  backIcon: { fontSize: 36, lineHeight: 40 },
  headerTitle: { fontSize: 17, lineHeight: 22, fontWeight: "600" },
  appearanceButton: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center", marginRight: 8 },
  appearanceLabel: { fontSize: 22, fontWeight: "600" },
  locationRow: { minWidth: 48, minHeight: 48, alignSelf: "stretch", flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 20, paddingVertical: 12 },
  locationLabel: { flex: 1, fontSize: 15, lineHeight: 22, flexShrink: 1 },
  locationChevron: { flexShrink: 0, marginLeft: 12, fontSize: 24, lineHeight: 28 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 },
  error: { flex: 1, justifyContent: "center", paddingHorizontal: 24 },
  errorTitle: { fontSize: 22, fontWeight: "600", marginBottom: 12 },
  errorDetail: { fontSize: 16, lineHeight: 24 },
});
