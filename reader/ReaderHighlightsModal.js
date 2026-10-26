import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, findNodeHandle, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import HighlightEntry from "./HighlightEntry";
import HighlightOptionsModal from "./HighlightOptionsModal";
import useReaderModalFocus from "./useReaderModalFocus";

export default function ReaderHighlightsModal({
  visible, items = [], theme, loading = false, saving = false, painting = false, error, renderError,
  removingId, onRequestRemove, onCancelRemove, onConfirmRemove,
  onShow, onEdit, onRetry, onClose, onDismiss, fullQuotation = false,
  retryLabel = "Retry highlights", onRetryPending,
  syncError, onResolveSync,
}) {
  const heading = useRef(null);
  const insets = useSafeAreaInsets();
  const [optionsId, setOptionsId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const optionItem = visible ? items.find(item => item.id === optionsId) : null;
  const expandedItem = visible && !fullQuotation ? items.find(item => item.id === expandedId) : null;
  const optionsFocus = useReaderModalFocus({ visible: !!optionItem });
  const quoteFocus = useReaderModalFocus({ visible: !!expandedItem });
  useEffect(() => {
    if (!visible) {
      optionsFocus.cancel(); quoteFocus.cancel();
      setOptionsId(null); setExpandedId(null);
    }
  }, [visible]);
  useEffect(() => {
    if (optionsId && !optionItem) setOptionsId(null);
    if (expandedId && !expandedItem) setExpandedId(null);
  }, [optionsId, optionItem, expandedId, expandedItem]);
  useEffect(() => { if (!expandedItem) quoteFocus.onDismiss(); }, [!!expandedItem]);
  const closeQuote = () => { quoteFocus.restoreAfterClose(); setExpandedId(null); };
  const closeOptions = () => {
    optionsFocus.restoreAfterClose(); setOptionsId(null);
  };
  const close = () => {
    if (optionItem) { closeOptions(); return; }
    if (saving) return;
    if (removingId) onCancelRemove?.();
    else if (expandedItem) closeQuote();
    else onClose?.();
  };
  const button = (label, action, disabled = false) => (
    <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || saving }}
      disabled={disabled || saving} onPress={() => { if (!disabled && !saving) action?.(); }}
      style={({ pressed }) => [styles.button, { borderColor: theme.border, backgroundColor: pressed && !disabled && !saving ? theme.highlightPressed : "transparent" }]}>
      <Text style={[styles.buttonText, { color: disabled || saving ? theme.highlightActionDisabled : label === "Confirm remove highlight" ? theme.highlightDanger : theme.highlightAction }]}>{label.replace(/ \d+$/, "")}</Text>
    </Pressable>
  );
  const focusHeading = () => { const handle = findNodeHandle(heading.current); if (handle != null) AccessibilityInfo.setAccessibilityFocus(handle); };
  useEffect(() => { if (visible && expandedItem) focusHeading(); }, [visible, !!expandedItem]);
  const setTrigger = node => {
    optionsFocus.triggerRef.current = node || heading.current;
    // The full view's options node disappears on Back. Its original list
    // trigger must survive options inspection inside the expanded quotation.
    if (!expandedItem) quoteFocus.triggerRef.current = node || heading.current;
  };
  const openOptions = id => { if (!saving && !error && !renderError && items.some(item => item.id === id)) setOptionsId(id); };
  const openQuote = id => { if (!saving && !fullQuotation && items.some(item => item.id === id && item.status !== "unreadable")) setExpandedId(id); };
  const actOnOptions = action => {
    const item = optionItem;
    if (!item || saving || error || renderError) return;
    optionsFocus.cancel(); setOptionsId(null);
    action(item.id);
  };
  const show = id => {
    const item = items.find(value => value.id === id);
    if (!item || item.status !== "resolved" || saving || painting || error || renderError) return;
    // Showing from a full quotation retires its local return-focus request.
    quoteFocus.cancel();
    onShow?.(id);
  };
  const renderEntry = (item, index, exact) => {
    const confirming = item.id === removingId;
    return <View key={item.id} style={[styles.entry, { borderColor: theme.border }]}>
      <HighlightEntry item={item} index={index} theme={theme} fullQuotation={exact}
        disabled={!!error || !!renderError || confirming} saving={saving} painting={painting}
        onShow={confirming ? undefined : show} onOptions={confirming || item.retainedDeletion ? undefined : openOptions}
        onFullQuote={exact || confirming ? undefined : openQuote} onTrigger={setTrigger} />
      {!!item.syncConflict && <View>
        <Text accessibilityRole="alert" style={[styles.detail, { color: theme.text }]}>{item.syncDeletion
          ? "This highlight was removed on another device. Keep the removal, or select the passage again to save a new highlight."
          : item.retainedDeletion ? "This highlight changed on another device after you removed it. Restore it to review the change before removing it again."
            : "This highlight has a different color on another device. Choose which color to keep."}</Text>
        {button((item.syncDeletion ? "Keep removal " : item.retainedDeletion ? "Restore highlight " : "Use other color ") + (index + 1), () => onResolveSync?.(item.id, "use-cloud"))}
        {!item.syncDeletion && !item.retainedDeletion && button("Keep this color " + (index + 1), () => onResolveSync?.(item.id, "reapply-local"))}
      </View>}
      {confirming && <View>
        <Text accessibilityRole="alert" style={[styles.detail, { color: theme.text }]}>Remove this highlight? This cannot be undone.</Text>
        {button("Cancel removal", onCancelRemove)}
        {button("Confirm remove highlight", onConfirmRemove, !!error)}
      </View>}
    </View>;
  };
  const renderStatus = () => <>
    {!!syncError && <Text accessibilityRole="alert" style={[styles.detail, { color: theme.text }]}>{syncError}</Text>}
    {loading && <ActivityIndicator accessibilityLabel="Loading highlights" color={theme.highlightAction} />}
    {!!error && <Text accessibilityRole="alert" style={[styles.detail, { color: theme.text }]}>{error}</Text>}
    {!!renderError && <Text accessibilityRole="alert" style={[styles.detail, { color: theme.text }]}>{renderError}</Text>}
    {(!!error || !!renderError) && !!onRetry && button(retryLabel, onRetry)}
    {!!onRetryPending && button("Retry pending highlight change", onRetryPending)}
  </>;
  return <>
    <Modal visible={!!visible} transparent animationType="none" onRequestClose={close} onShow={focusHeading} onDismiss={onDismiss}>
      <View style={styles.backdrop}>
        <View accessibilityViewIsModal onAccessibilityEscape={close} accessibilityElementsHidden={!!optionItem}
          importantForAccessibility={optionItem ? "no-hide-descendants" : "auto"}
          style={[styles.panel, { backgroundColor: theme.panel, borderColor: theme.border, paddingBottom: Math.max(16, insets.bottom) }]}>
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            {!!expandedItem && <Pressable accessibilityRole="button" accessibilityLabel="Back to highlights" disabled={saving}
              accessibilityState={{ disabled: saving }} onPress={() => { if (!saving) closeQuote(); }}
              style={({ pressed }) => [styles.close, { backgroundColor: pressed && !saving ? theme.highlightPressed : "transparent" }]}>
              <Text style={[styles.backLabel, { color: saving ? theme.highlightActionDisabled : theme.highlightAction }]}>{"\u2039"}</Text>
            </Pressable>}
            <Text ref={heading} accessible accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>{fullQuotation || expandedItem ? "Full quotation" : "Highlights"}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close highlights" accessibilityState={{ disabled: saving }} disabled={saving}
              onPress={close} style={({ pressed }) => [styles.close, { backgroundColor: pressed && !saving ? theme.highlightPressed : "transparent" }]}>
              <Text accessibilityElementsHidden importantForAccessibility="no" style={[styles.closeLabel, { color: saving ? theme.highlightActionDisabled : theme.highlightAction }]}>{"\u00D7"}</Text>
            </Pressable>
          </View>
          <ScrollView key="highlight-list" style={[styles.scroll, expandedItem && styles.hidden]}
            accessibilityElementsHidden={!!expandedItem} importantForAccessibility={expandedItem ? "no-hide-descendants" : "auto"}
            contentContainerStyle={styles.content}>
            {renderStatus()}
            {!loading && !error && !items.length && <Text style={[styles.detail, { color: theme.secondary }]}>Select a passage in the play, then choose Highlight to save it here.</Text>}
            {items.map((item, index) => renderEntry(item, index, fullQuotation))}
          </ScrollView>
          {!!expandedItem && <ScrollView key="full-quotation" style={styles.scroll} contentContainerStyle={styles.content}>
            {renderStatus()}
            {renderEntry(expandedItem, items.indexOf(expandedItem), true)}
          </ScrollView>}
        </View>
      </View>
    </Modal>
    <HighlightOptionsModal visible={!!optionItem} theme={theme}
      canEdit={optionItem?.status === "resolved" && !error && !renderError} disabled={saving || !!error || !!renderError}
      onEdit={() => { if (optionItem?.status === "resolved") actOnOptions(id => onEdit?.(id)); }}
      onRemove={() => actOnOptions(id => onRequestRemove?.(id))}
      onClose={closeOptions} onDismiss={optionsFocus.onDismiss} />
  </>;
}
const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.42)", justifyContent: "center", padding: 16 },
  panel: { borderRadius: 16, borderWidth: 1, maxHeight: "94%", flexShrink: 1 },
  header: { flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, paddingLeft: 16, paddingRight: 6, paddingVertical: 6, flexShrink: 0 },
  heading: { flex: 1, minWidth: 0, fontSize: 22, lineHeight: 28, fontWeight: "700", paddingVertical: 8 },
  close: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center", padding: 8, flexShrink: 0 },
  closeLabel: { fontSize: 30, lineHeight: 34 }, backLabel: { fontSize: 32, lineHeight: 36 },
  scroll: { flexShrink: 1 }, hidden: { display: "none" }, content: { paddingTop: 16, paddingHorizontal: 16, paddingBottom: 16 },
  detail: { fontSize: 14, lineHeight: 21, marginBottom: 12 },
  entry: { paddingVertical: 12, borderTopWidth: 1 },
  button: { borderWidth: 1, borderRadius: 10, minHeight: 48, padding: 12, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  buttonText: { fontSize: 15, lineHeight: 22, fontWeight: "600" },
});
