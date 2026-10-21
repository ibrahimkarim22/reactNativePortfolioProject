import React, { useRef } from "react";
import { AccessibilityInfo, findNodeHandle, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HIGHLIGHT_PALETTE } from "./readerHighlights";
import { THEMES } from "./readerConstants";

export default function ReaderHighlightPicker({
  visible, snapshot, colorId = "yellow", theme = THEMES.paper,
  saving = false, error, onColor, onSave, onClose, onDismiss,
  actionLabel = "Save", notice, onRetry,
}) {
  const heading = useRef(null);
  const insets = useSafeAreaInsets();
  const themeId = Object.keys(THEMES).find(id => THEMES[id] === theme) || "paper";
  const focusHeading = () => {
    const handle = findNodeHandle(heading.current);
    if (handle != null) AccessibilityInfo.setAccessibilityFocus(handle);
  };
  const close = () => { if (!saving) onClose?.(); };
  return (
    <Modal visible={!!visible} transparent animationType="none" onRequestClose={close} onShow={focusHeading} onDismiss={onDismiss}>
      <View style={styles.backdrop}>
        <View accessibilityViewIsModal onAccessibilityEscape={close} style={[styles.panel, { backgroundColor: theme.panel, borderColor: theme.border, paddingBottom: Math.max(16, insets.bottom) }]}>
          <Text ref={heading} accessible accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>Highlight passage</Text>
          <ScrollView style={styles.body} nestedScrollEnabled contentContainerStyle={styles.bodyContent}>
          <Text style={[styles.detail, { color: theme.secondary }]}>Saved on this device. Highlights are not synced or guaranteed backed up.</Text>
          {!!notice && <Text style={[styles.detail, { color: theme.secondary }]}>{notice}</Text>}
          <ScrollView style={styles.quotation} nestedScrollEnabled contentContainerStyle={styles.quotationContent}>
            <Text style={[styles.quoteText, { color: theme.text }]}>{snapshot?.selection?.exact || ""}</Text>
          </ScrollView>
          <View accessibilityLabel="Highlight color" style={styles.colors}>
            {Object.entries(HIGHLIGHT_PALETTE).map(([id, choice]) => {
              const selected = colorId === id;
              return (
                <Pressable key={id} accessibilityRole="radio" accessibilityLabel={choice.label}
                  accessibilityState={{ checked: selected, disabled: saving }} disabled={saving}
                  onPress={() => { if (!saving) onColor?.(id); }}
                  style={[styles.choice, { borderColor: selected ? theme.accent : theme.border, backgroundColor: theme.background }]}>
                  <View accessibilityElementsHidden importantForAccessibility="no" style={[styles.swatch, { backgroundColor: choice.background[themeId], borderColor: theme.accent }]} />
                  <Text style={[styles.choiceLabel, { color: theme.text }]}>{choice.label}</Text>
                  <Text style={[styles.selected, { color: theme.accent }]}>{selected ? "Selected" : ""}</Text>
                </Pressable>
              );
            })}
          </View>
          {!!error && <Text accessibilityRole="alert" style={[styles.detail, { color: theme.text }]}>{error}</Text>}
          {!!error && !!onRetry && <Pressable accessibilityRole="button" accessibilityLabel="Retry saving highlight" disabled={saving} onPress={() => { if (!saving) onRetry(); }} style={styles.action}>
            <Text style={[styles.actionLabel, { color: theme.accent }]}>Retry save</Text>
          </Pressable>}
          </ScrollView>
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel highlight" disabled={saving} accessibilityState={{ disabled: saving }} onPress={close} style={[styles.action, { borderColor: theme.border }]}>
              <Text style={[styles.actionLabel, { color: theme.accent }]}>Cancel</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Save highlight" disabled={saving} accessibilityState={{ disabled: saving, busy: saving }} onPress={() => { if (!saving) onSave?.(); }} style={[styles.action, { borderColor: theme.accent, backgroundColor: theme.background }]}>
              <Text style={[styles.actionLabel, { color: theme.accent }]}>{saving ? "Saving…" : actionLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.42)", justifyContent: "center", padding: 16 },
  panel: { borderRadius: 16, borderWidth: 1, maxHeight: "94%", flexShrink: 1, paddingTop: 20, paddingHorizontal: 16 },
  heading: { fontSize: 22, lineHeight: 28, fontWeight: "700", marginBottom: 10 },
  body: { flexShrink: 1 }, bodyContent: { paddingBottom: 8 },
  detail: { fontSize: 14, lineHeight: 20, marginBottom: 12 },
  quotation: { maxHeight: 220, flexShrink: 1, marginBottom: 16 },
  quotationContent: { paddingVertical: 8 },
  quoteText: { fontSize: 18, lineHeight: 27 },
  colors: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  choice: { minHeight: 64, minWidth: "46%", flexGrow: 1, flexBasis: "46%", borderRadius: 10, borderWidth: 2, padding: 10, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  swatch: { width: 22, height: 22, borderRadius: 4, borderWidth: 1 },
  choiceLabel: { fontSize: 16, lineHeight: 22, fontWeight: "600" },
  selected: { fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: "row", gap: 12 },
  action: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 10, borderWidth: 1, padding: 12 },
  actionLabel: { fontSize: 16, lineHeight: 22, fontWeight: "600" },
});
