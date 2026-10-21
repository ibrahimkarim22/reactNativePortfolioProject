import React, { useRef } from "react";
import { AccessibilityInfo, ActivityIndicator, findNodeHandle, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HIGHLIGHT_PALETTE } from "./readerHighlights";

export default function ReaderHighlightsModal({
  visible, items = [], theme, loading = false, saving = false, painting = false, error, renderError,
  removingId, onRequestRemove, onCancelRemove, onConfirmRemove,
  onShow, onEdit, onRetry, onClose, onDismiss,
}) {
  const heading = useRef(null);
  const insets = useSafeAreaInsets();
  const close = () => { if (!saving) { if (removingId) onCancelRemove?.(); else onClose?.(); } };
  const button = (label, action, disabled = false, key = label) => (
    <Pressable key={key} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || saving }}
      disabled={disabled || saving} onPress={() => { if (!disabled && !saving) action?.(); }}
      style={[styles.button, { borderColor: theme.border, opacity: disabled ? 0.55 : 1 }]}>
      <Text style={[styles.buttonText, { color: theme.accent }]}>{label.replace(/ \d+$/, "")}</Text>
    </Pressable>
  );
  const focus = () => { const handle = findNodeHandle(heading.current); if (handle != null) AccessibilityInfo.setAccessibilityFocus(handle); };
  return (
    <Modal visible={!!visible} transparent animationType="none" onRequestClose={close} onShow={focus} onDismiss={onDismiss}>
      <View style={styles.backdrop}>
        <View accessibilityViewIsModal onAccessibilityEscape={close} style={[styles.panel, { backgroundColor: theme.panel, borderColor: theme.border, paddingBottom: Math.max(16, insets.bottom) }]}>
          <Text ref={heading} accessible accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>Highlights</Text>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
            <Text style={[styles.detail, { color: theme.secondary }]}>Saved on this device. Highlights are not synced or guaranteed backed up.</Text>
            {loading && <ActivityIndicator accessibilityLabel="Loading highlights" color={theme.accent} />}
            {!!error && <Text accessibilityRole="alert" style={[styles.detail, { color: theme.text }]}>{error}</Text>}
            {!!renderError && <Text accessibilityRole="alert" style={[styles.detail, { color: theme.text }]}>{renderError}</Text>}
            {(!!error || !!renderError) && button("Retry highlights", onRetry)}
            {!loading && !error && !items.length && <Text style={[styles.detail, { color: theme.secondary }]}>Select a passage in the play, then choose Highlight to save it here.</Text>}
            {items.map((item, index) => {
              const available = item.status === "resolved" && !error && !renderError;
              const confirming = item.id === removingId;
              return (
                <View key={item.id} style={[styles.entry, { borderColor: theme.border }]}>
                  <Text style={[styles.location, { color: theme.secondary }]}>{item.locationLabel || "Highlight record"}</Text>
                  {item.status === "unreadable" ? <Text style={[styles.quote, { color: theme.text }]}>This saved record is unavailable. It has been retained on this device.</Text> : <Text style={[styles.quote, { color: theme.text }]}>{item.quotation}</Text>}
                  {!!item.detail && <Text style={[styles.detail, { color: theme.secondary }]}>{item.detail}</Text>}
                  {!!item.colorId && <Text style={[styles.detail, { color: theme.secondary }]}>{HIGHLIGHT_PALETTE[item.colorId]?.label || "Unknown color"}</Text>}
                  {item.status === "unresolved" && <Text style={[styles.detail, { color: theme.secondary }]}>This quotation belongs to a different text version or could not be resolved. It has not been moved or painted.</Text>}
                  {item.status === "conflict" && <Text style={[styles.detail, { color: theme.secondary }]}>This quotation overlaps another saved highlight. Both records are retained; remove one to display the other.</Text>}
                  {confirming ? (
                    <View>
                      <Text accessibilityRole="alert" style={[styles.detail, { color: theme.text }]}>Remove this highlight from this device? This cannot be undone.</Text>
                      {button("Cancel removal", onCancelRemove)}
                      {button("Confirm remove highlight", onConfirmRemove, !!error)}
                    </View>
                  ) : (
                    <View style={styles.actions}>
                      {item.status !== "unreadable" && button(`Show passage ${index + 1}`, () => onShow?.(item.id), !available || painting)}
                      {item.status !== "unreadable" && button(`Edit color ${index + 1}`, () => onEdit?.(item.id), !available)}
                      {button(`Remove highlight ${index + 1}`, () => onRequestRemove?.(item.id), !!error)}
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>
          {button(saving ? "Saving highlights" : "Close highlights", close)}
        </View>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.42)", justifyContent: "center", padding: 16 },
  panel: { borderRadius: 16, borderWidth: 1, maxHeight: "94%", flexShrink: 1, paddingTop: 20, paddingHorizontal: 16 },
  heading: { fontSize: 22, lineHeight: 28, fontWeight: "700", marginBottom: 12 },
  scroll: { flexShrink: 1 }, content: { paddingBottom: 8 },
  detail: { fontSize: 14, lineHeight: 21, marginBottom: 12 },
  location: { fontSize: 14, lineHeight: 21, marginBottom: 8, fontWeight: "600" },
  quote: { fontSize: 17, lineHeight: 25, marginBottom: 12 },
  entry: { paddingVertical: 16, borderTopWidth: 1 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: { borderWidth: 1, borderRadius: 10, minHeight: 48, padding: 12, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  buttonText: { fontSize: 15, lineHeight: 22, fontWeight: "600" },
});
