import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StatusBar, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { getLocalPlayEntry } from "../shared/localPlayService";
import ReaderSurface from "./ReaderSurface";
import ReaderAppearanceModal from "./ReaderAppearanceModal";
import { createReaderDocument } from "./readerDocument";
import { THEMES } from "./readerConstants";
import { createFontSelection } from "./fontSelection";
import { loadReaderFont } from "./readerFonts";
import useReaderPreferences from "./useReaderPreferences";
import useReaderModalFocus from "./useReaderModalFocus";

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
      return { document: createReaderDocument(entry, { documentId: `reader-${++nextDocumentId}` }) };
    } catch (error) {
      return { error: "The local text could not be prepared. Go back and open this play again." };
    }
  }, [entry, entry?.play?.contentVersion, entry?.play?.canonicalTextVersion]);
  const title = entry?.play?.title || entry?.name || "Read play";
  const fontSelection = useMemo(() => createFontSelection(loadReaderFont, setFontStatus), []);

  useEffect(() => {
    if (!hydrated || !result.document) return undefined;
    fontSelection.select(preferences.fontId);
    return () => fontSelection.cancel();
  }, [fontSelection, hydrated, result.document, preferences.fontId, fontRetry]);

  const openAppearance = useCallback(() => {
    cancelFocusReturn();
    setAppearanceOpen(true);
  }, [cancelFocusReturn]);
  const closeAppearance = useCallback(() => {
    restoreAfterClose();
    setAppearanceOpen(false);
    flush();
  }, [flush, restoreAfterClose]);

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
    const status = Platform.OS === "web" ? null : StatusBar.pushStackEntry({
      barStyle: preferences.theme === "night" ? "light-content" : "dark-content",
      backgroundColor: theme.background,
    });
    return () => {
      cancelFocusReturn();
      if (status != null) StatusBar.popStackEntry(status);
    };
  }, [preferences.theme, theme.background, cancelFocusReturn]));

  return (
    <SafeAreaView edges={["bottom"]} style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.container} accessibilityElementsHidden={appearanceOpen} importantForAccessibility={appearanceOpen ? "no-hide-descendants" : "auto"}>
      {result.document && hydrated ? (
        <ReaderSurface document={result.document} preferences={preferences} fontFaces={fontStatus.fontId === preferences.fontId ? fontStatus.faces : undefined} />
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
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 },
  error: { flex: 1, justifyContent: "center", paddingHorizontal: 24 },
  errorTitle: { fontSize: 22, fontWeight: "600", marginBottom: 12 },
  errorDetail: { fontSize: 16, lineHeight: 24 },
});
