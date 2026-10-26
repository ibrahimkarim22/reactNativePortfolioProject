import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, StatusBar, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { getLocalPlayEntry } from "../shared/localPlayService";
import ReaderSurface from "./ReaderSurface";
import ReaderAppearanceModal from "./ReaderAppearanceModal";
import ReaderContentsModal from "./ReaderContentsModal";
import ReaderSelectionVerifier from "./ReaderSelectionVerifier";
import ReaderHighlightControl from "./ReaderHighlightControl";
import ReaderHighlightPicker from "./ReaderHighlightPicker";
import ReaderHighlightsModal from "./ReaderHighlightsModal";
import useReaderHighlights from "./useReaderHighlights";
import useMyHighlightsReader from "./useMyHighlightsReader";
import { errorMessage, findCreateConflict, findStoredConflicts, validateSelectionRef } from "./readerHighlights";
import { syncLabel, syncSummaryText, syncErrorText } from "./highlightSyncPresentation";
import { createReaderDocument } from "./readerDocument";
import { buildReaderNavigation } from "./readerNavigation";
import { THEMES } from "./readerConstants";
import { createFontSelection } from "./fontSelection";
import { loadReaderFont } from "./readerFonts";
import useReaderPreferences from "./useReaderPreferences";
import useReaderModalFocus from "./useReaderModalFocus";
import useReaderNavigation from "./useReaderNavigation";

let nextDocumentId = 0;

export default function ReaderScreen({ id, highlightRuntime, openHighlight }) {
  const navigation = useNavigation();
  const settings = useReaderPreferences(highlightRuntime?.preferences);
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
  const highlights = useReaderHighlights(result.document, readerNavigation.surfaceRef, readerNavigation.ready, highlightRuntime);
  const passageOpening = useMyHighlightsReader({ request: highlightRuntime ? null : openHighlight, document: result.document, session: highlights.session });
  const highlightAccountError = highlights.synchronizationEnabled
    ? syncErrorText(highlights.syncCoordinatorError) || syncSummaryText(highlights.syncSummary) : null;
  const [highlightState, setHighlightState] = useState("none");
  const [surfaceFailure, setSurfaceFailure] = useState(false);
  const [highlightDraft, setHighlightDraft] = useState(null);
  const [highlightColor, setHighlightColor] = useState("yellow");
  const [highlightSaving, setHighlightSaving] = useState(false);
  const [highlightError, setHighlightError] = useState(null);
  const [highlightListScope, setHighlightListScope] = useState(null);
  const [removingHighlight, setRemovingHighlight] = useState(null);
  const highlightOperation = useRef(0);
  const highlightScope = highlights.scope;
  const currentScope = scope => {
    const current = highlights.session?.getSnapshot().scope;
    return !!scope && !!current && ["uid", "workId", "documentId", "ownerGeneration"].every(key => scope[key] === current[key]);
  };
  const activeDraft = highlightDraft?.scope === highlightScope ? highlightDraft : null;
  const highlightsOpen = !!highlightListScope && highlightListScope === highlightScope;
  const highlightFocus = useReaderModalFocus({ visible: !!activeDraft || highlightsOpen });
  const draftContext = useRef(null);
  draftContext.current = { scope: highlightScope, draft: activeDraft, error: highlights.error, session: highlights.session };
  const abandonDraft = useCallback(() => {
    highlightOperation.current++;
    const context = draftContext.current;
    if (context.scope && context.error) context.session?.cancelPending?.(context.scope)?.catch(() => {});
    setHighlightSaving(false);
    setHighlightDraft(null);
  }, []);
  const highlightCount = highlights.records.length + highlights.unresolved.length + highlights.unreadable.length;
  const highlightItems = useMemo(() => {
    const sections = new Map((result.model?.items || []).map(item => [item.id, item.locationLabel]));
    const conflicts = new Set(highlights.conflicts);
    const overlaps = new Set(result.document ? findStoredConflicts(highlights.records, result.document.canonical) : []);
    const item = (record, status) => ({ id: record.id, quotation: record.selectionRef.exact,
      locationLabel: status === "unresolved" ? "Different text version" : sections.get(record.selectionRef.startRef.sectionId) || "Saved quotation", colorId: record.colorId,
      status, start: record.selectionRef.start, overlapConflict: overlaps.has(record.id),
      syncLabel: highlights.synchronizationEnabled ? syncLabel(highlights.syncById?.[record.id], { mode: highlights.synchronizationMode, syncing: highlights.syncRunning }) : undefined,
      syncDeletion: !!highlights.syncById?.[record.id]?.conflict?.cloud?.deleted,
      syncConflict: highlights.syncById?.[record.id]?.status === "conflict" });
    return [...highlights.records.map(record => item(record, conflicts.has(record.id) ? "conflict" : "resolved")),
      ...highlights.unresolved.map(({ record }) => item(record, "unresolved")),
      ...(highlights.tombstones || []).filter(marker => marker.sync?.status === "conflict" && marker.record)
        .map(marker => ({ ...item(marker.record, "conflict"), retainedDeletion: true, syncConflict: true }))]
      .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
      .concat(highlights.unreadable.map(record => ({ id: record.id, status: "unreadable", detail: errorMessage(record.code) })));
  }, [highlights.records, highlights.unresolved, highlights.unreadable, highlights.conflicts, highlights.tombstones, highlights.syncById, highlights.synchronizationEnabled, highlights.synchronizationMode, highlights.syncRunning, result.model, result.document]);
  const highlightMessage = error => error ? errorMessage(error.code) : null;
  const onReaderMessage = useCallback(message => {
    readerNavigation.onMessage(message);
    if (message.documentId !== result.document?.identity.documentId) return;
    if (message.type === "interaction" || (message.type === "selectionChange" && message.state === "range")) passageOpening.cancel();
    if (message.type === "ready") setSurfaceFailure(false);
    if (message.type === "error" && ["DOCUMENT_READY_TIMEOUT", "SURFACE_LOAD_FAILED"].includes(message.code)) setSurfaceFailure(true);
    if (message.type === "selectionChange" && message.documentId === result.document?.identity.documentId) setHighlightState(message.state);
  }, [readerNavigation.onMessage, result.document]);
  const openHighlights = scope => {
    passageOpening.cancel();
    if (!currentScope(scope)) return;
    highlightOperation.current++;
    scope = highlights.session.getSnapshot().scope;
    readerNavigation.surfaceRef.current?.clearSelection?.("modal");
    cancelFocusReturn(); readerNavigation.dismissContents(); setAppearanceOpen(false);
    setHighlightDraft(null); setHighlightError(null); setRemovingHighlight(null); setHighlightListScope(scope);
  };
  const acceptHighlight = (snapshot, scope) => {
    passageOpening.cancel();
    if (!currentScope(scope) || snapshot?.documentId !== scope.documentId || !highlights.enabled) return;
    scope = highlights.session.getSnapshot().scope;
    let duplicate;
    try {
      validateSelectionRef(snapshot.selection, result.document.canonical);
      const conflict = findCreateConflict(highlights.records, snapshot.selection, result.document.canonical);
      if (conflict.kind === "duplicate") duplicate = conflict.record;
    } catch (error) {
      Alert.alert("Unable to highlight passage", errorMessage(error.code), [{ text: "Cancel", style: "cancel" }, { text: "Open highlights", onPress: () => openHighlights(scope) }]);
      return;
    }
    highlightOperation.current++;
    setHighlightDraft(Object.freeze({ snapshot, scope, editingId: duplicate?.id }));
    setHighlightColor(duplicate?.colorId || "yellow");
    setHighlightError(null);
    setHighlightListScope(null); setRemovingHighlight(null);
    cancelFocusReturn(); readerNavigation.dismissContents(); setAppearanceOpen(false);
    readerNavigation.surfaceRef.current?.clearSelection?.("modal");
  };
  const closeHighlight = () => {
    if (highlightSaving) return;
    abandonDraft();
    highlightFocus.restoreAfterClose(); setHighlightListScope(null); setRemovingHighlight(null); setHighlightError(null);
  };
  const saveHighlight = async () => {
    const draft = activeDraft;
    if (!draft || highlightSaving || !currentScope(draft.scope)) return;
    const operation = ++highlightOperation.current;
    const color = highlightColor, session = highlights.session;
    const stillCurrent = () => highlightOperation.current === operation && currentScope(draft.scope) && draftContext.current.draft === draft;
    setHighlightSaving(true); setHighlightError(null);
    try {
      const saved = draft.editingId ? await session.recolor(draft.editingId, color, draft.scope)
        : await session.create(draft.snapshot, color, draft.scope);
      if (!stillCurrent()) return;
      if (saved?.kind === "duplicate") {
        setHighlightDraft({ ...draft, editingId: saved.record.id }); setHighlightColor(saved.record.colorId);
      } else { highlightFocus.restoreAfterClose(); setHighlightDraft(null); }
    } catch (error) {
      if (!stillCurrent()) return;
      if (!draft.editingId && error.code === "RECREATE_CONFIRMATION_REQUIRED" && typeof error.id === "string" && error.id.length) {
        // A confirmation belongs to this captured passage, color and owner.
        // Retire its token on every new draft/cancel and consume it only once.
        const id = error.id;
        Alert.alert("Save a new highlight?", "This passage was previously deleted. Saving it again creates a new highlight after that deletion.", [
          { text: "Cancel", style: "cancel", onPress: () => { if (stillCurrent()) highlightOperation.current++; } },
          { text: "Save new highlight", onPress: async () => {
            if (!stillCurrent()) return;
            const confirmation = ++highlightOperation.current;
            const confirming = () => highlightOperation.current === confirmation && currentScope(draft.scope) && draftContext.current.draft === draft;
            setHighlightSaving(true); setHighlightError(null);
            try {
              await session.recreate(id, color, draft.scope);
              if (confirming()) { highlightFocus.restoreAfterClose(); setHighlightDraft(null); }
            } catch (failure) { if (confirming()) setHighlightError(syncErrorText(failure)); }
            finally { if (highlightOperation.current === confirmation) setHighlightSaving(false); }
          } },
        ], { cancelable: false });
      } else setHighlightError(errorMessage(error.code));
    }
    finally { if (highlightOperation.current === operation) setHighlightSaving(false); }
  };
  const retryHighlights = async () => {
    const scope = highlightScope;
    if (!currentScope(scope) || highlightSaving) return;
    const operation = ++highlightOperation.current;
    const replayingDraft = !!activeDraft && !!highlights.error;
    setHighlightSaving(true); setHighlightError(null);
    try {
      const retried = await highlights.session.retry(scope);
      if (currentScope(scope) && replayingDraft && retried?.kind === "duplicate") {
        setHighlightDraft({ ...activeDraft, editingId: retried.record.id }); setHighlightColor(retried.record.colorId);
      } else if (currentScope(scope) && replayingDraft && !highlights.session.getSnapshot().error) {
        highlightFocus.restoreAfterClose(); setHighlightDraft(null);
      }
      if (currentScope(scope)) setRemovingHighlight(null);
    } catch (error) { if (currentScope(scope)) setHighlightError(errorMessage(error.code)); }
    finally { if (highlightOperation.current === operation) setHighlightSaving(false); }
  };
  const editHighlight = id => {
    const record = highlights.records.find(item => item.id === id);
    if (!record || highlights.conflicts.includes(id) || !currentScope(highlightScope)) return;
    highlightOperation.current++;
    setHighlightDraft({ snapshot: { selection: record.selectionRef, documentId: highlightScope.documentId }, scope: highlightScope, editingId: id });
    setHighlightColor(record.colorId); setHighlightError(null); setHighlightListScope(null);
  };
  const showHighlight = async id => {
    const scope = highlightScope, record = highlights.records.find(item => item.id === id);
    if (!record || !currentScope(scope)) return;
    try {
      await highlights.session.show(record, scope);
      if (currentScope(scope)) { highlightFocus.cancel(); setHighlightListScope(null); }
    } catch (error) { if (currentScope(scope)) setHighlightError(errorMessage(error.code)); }
  };
  const removeHighlight = async () => {
    const scope = highlightScope, id = removingHighlight;
    if (!id || !currentScope(scope) || highlightSaving) return;
    const operation = ++highlightOperation.current;
    setHighlightSaving(true); setHighlightError(null);
    try { await highlights.session.remove(id, scope); if (currentScope(scope)) setRemovingHighlight(null); }
    catch (error) { if (currentScope(scope)) setHighlightError(errorMessage(error.code)); }
    finally { if (highlightOperation.current === operation) setHighlightSaving(false); }
  };
  const resolveHighlightSync = async (id, choice) => {
    const scope = highlightScope;
    if (!currentScope(scope) || highlightSaving) return;
    try { await highlights.session.resolveSyncConflict(id, choice, scope); }
    catch (error) { if (currentScope(scope)) setHighlightError(syncErrorText(error)); }
  };
  useEffect(() => {
    highlightOperation.current++;
    setHighlightSaving(false); setHighlightError(null); setHighlightDraft(null); setHighlightListScope(null); setRemovingHighlight(null);
    highlightFocus.cancel();
  }, [highlightScope]);
  const title = entry?.play?.title || entry?.name || "Read play";
  const fontSelection = useMemo(() => createFontSelection(loadReaderFont, setFontStatus), []);

  useEffect(() => {
    if (!hydrated || !result.document) return undefined;
    fontSelection.select(preferences.fontId);
    return () => fontSelection.cancel();
  }, [fontSelection, hydrated, result.document, preferences.fontId, fontRetry]);

  const openAppearance = useCallback(() => {
    passageOpening.cancel();
    readerNavigation.surfaceRef.current?.clearSelection?.("modal");
    cancelFocusReturn();
    readerNavigation.dismissContents();
    abandonDraft();
    setHighlightListScope(null); highlightFocus.cancel();
    setAppearanceOpen(true);
  }, [cancelFocusReturn, readerNavigation.dismissContents]);
  const closeAppearance = useCallback(() => {
    restoreAfterClose();
    setAppearanceOpen(false);
    setHighlightDraft(null);
    flush();
  }, [flush, restoreAfterClose]);
  const openContents = useCallback(() => {
    passageOpening.cancel();
    cancelFocusReturn();
    setAppearanceOpen(false);
    abandonDraft(); setHighlightListScope(null); highlightFocus.cancel();
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
          onPress={() => { passageOpening.cancel(); navigation.goBack(); }}
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
    return () => {
      passageOpening.cancel();
      readerNavigation.surfaceRef.current?.clearSelection?.("document");
      abandonDraft();
      setHighlightListScope(null); highlightFocus.cancel();
      cancelFocusReturn();
      readerNavigation.deactivate();
    };
  }, [cancelFocusReturn, readerNavigation.activate, readerNavigation.deactivate, passageOpening.cancel]));

  // Restoring a saved theme updates system chrome without retiring a pending
  // passage request. Only a real focus departure runs the cancellation above.
  useFocusEffect(useCallback(() => {
    const status = Platform.OS === "web" ? null : StatusBar.pushStackEntry({
      barStyle: preferences.theme === "night" ? "light-content" : "dark-content",
      backgroundColor: theme.background,
    });
    return () => { if (status != null) StatusBar.popStackEntry(status); };
  }, [preferences.theme, theme.background]));

  return (
    <SafeAreaView edges={["bottom"]} style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.container} accessibilityElementsHidden={appearanceOpen || readerNavigation.contentsOpen || !!activeDraft || highlightsOpen} importantForAccessibility={appearanceOpen || readerNavigation.contentsOpen || !!activeDraft || highlightsOpen ? "no-hide-descendants" : "auto"}>
      {result.document && (
        <View style={[styles.locationControls, { backgroundColor: theme.background, borderBottomColor: theme.border }]}>
        <Pressable
          ref={readerNavigation.contentsButton}
          accessibilityRole="button"
          accessibilityLabel={readerNavigation.current ? `Contents, ${readerNavigation.current.locationLabel}` : "Contents"}
          accessibilityHint="Choose an act, scene or other section"
          accessibilityActions={readerNavigation.ready ? [{ name: "readCurrentSection", label: "Read from current section" }] : []}
          onAccessibilityAction={event => {
            if (event.nativeEvent.actionName === "readCurrentSection") { passageOpening.cancel(); readerNavigation.jumpToSection(readerNavigation.currentSectionId); }
          }}
          onPress={openContents}
          style={[styles.locationRow, { backgroundColor: theme.background, borderBottomColor: theme.border }]}
        >
          <Text numberOfLines={2} style={[styles.locationLabel, { color: theme.secondary }]}>{readerNavigation.current?.locationLabel || "Preparing play contents…"}</Text>
          <Text accessibilityElementsHidden importantForAccessibility="no" style={[styles.locationChevron, { color: theme.accent }]}>›</Text>
        </Pressable>
        <ReaderHighlightControl mode={highlightState === "range" ? "highlight" : "list"} count={highlightCount}
          disabled={!readerNavigation.ready || !highlightScope?.uid || !highlights.privacyReady || (highlightState === "range" && !highlights.enabled)}
          theme={theme} capture={() => readerNavigation.surfaceRef.current.captureSelection()}
          triggerRef={highlightFocus.triggerRef}
          getScope={() => highlightScope} onPicker={acceptHighlight}
          onList={openHighlights}
          onError={() => Alert.alert("Unable to capture selection", "Select the passage again, then choose Highlight.")} />
        </View>
      )}
      {result.document && hydrated ? (
        <View style={styles.container}>
          {(passageOpening.opening || passageOpening.error) && <View pointerEvents="none" accessibilityLiveRegion="polite" style={[styles.passageStatus, { backgroundColor: theme.panel, borderColor: theme.border }]}>
            <Text accessibilityRole={passageOpening.error ? "alert" : undefined} style={{ color: theme.text }}>{passageOpening.error || "Opening saved passage\u2026"}</Text>
          </View>}
          <ReaderSurface ref={readerNavigation.surfaceRef} document={result.document} preferences={preferences} fontFaces={fontStatus.fontId === preferences.fontId ? fontStatus.faces : undefined} onMessage={onReaderMessage} />
          {!highlights.privacyReady && <View accessibilityLabel="Preparing account highlights" style={[StyleSheet.absoluteFillObject, styles.loading, { backgroundColor: theme.background }]}>
            {!surfaceFailure && <ActivityIndicator color={theme.highlightAction} />}
            <Text accessibilityRole={surfaceFailure ? "alert" : undefined} style={[styles.errorDetail, { color: theme.secondary }]}>{surfaceFailure ? "The reading document could not open. Go back and reopen this play." : highlights.renderError ? "Previous highlights could not be cleared." : "Preparing highlights\u2026"}</Text>
            {!surfaceFailure && !!highlights.renderError && <Pressable accessibilityRole="button" onPress={retryHighlights} style={styles.backButton}><Text style={{ color: theme.highlightAction }}>Retry highlights</Text></Pressable>}
          </View>}
        </View>
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
      <ReaderHighlightPicker visible={!!activeDraft} snapshot={activeDraft?.snapshot} colorId={highlightColor} theme={theme}
        onColor={setHighlightColor} onClose={closeHighlight} onSave={saveHighlight} saving={highlightSaving || highlights.saving}
        error={highlightError || highlightMessage(highlights.error)} onRetry={highlights.error ? retryHighlights : undefined} onDismiss={highlightFocus.onDismiss} />
      <ReaderHighlightsModal visible={highlightsOpen} items={highlightsOpen ? highlightItems : []} theme={theme}
        syncError={highlightAccountError} onResolveSync={resolveHighlightSync}
        loading={highlights.loading} saving={highlightSaving || highlights.saving} painting={highlights.rendering} error={highlightsOpen ? highlightError || highlightMessage(highlights.error) : null}
        renderError={highlightsOpen ? highlightMessage(highlights.renderError) : null} onRetry={retryHighlights}
        removingId={removingHighlight} onRequestRemove={setRemovingHighlight} onCancelRemove={() => { abandonDraft(); setRemovingHighlight(null); setHighlightError(null); }} onConfirmRemove={removeHighlight}
        onShow={showHighlight} onEdit={editHighlight} onClose={closeHighlight} onDismiss={highlightFocus.onDismiss} />
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
  passageStatus: { position: "absolute", left: 12, right: 12, bottom: 12, zIndex: 1, padding: 12, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  backButton: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
  backIcon: { fontSize: 36, lineHeight: 40 },
  headerTitle: { fontSize: 17, lineHeight: 22, fontWeight: "600" },
  appearanceButton: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center", marginRight: 8 },
  appearanceLabel: { fontSize: 22, fontWeight: "600" },
  locationControls: { flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth },
  locationRow: { flex: 1, minWidth: 48, minHeight: 48, alignSelf: "stretch", flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8 },
  locationLabel: { flex: 1, fontSize: 15, lineHeight: 22, flexShrink: 1 },
  locationChevron: { flexShrink: 0, marginLeft: 12, fontSize: 24, lineHeight: 28 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 },
  error: { flex: 1, justifyContent: "center", paddingHorizontal: 24 },
  errorTitle: { fontSize: 22, fontWeight: "600", marginBottom: 12 },
  errorDetail: { fontSize: 16, lineHeight: 24 },
});
