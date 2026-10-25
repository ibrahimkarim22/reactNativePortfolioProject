import React, { useRef } from "react";
import { AccessibilityInfo, findNodeHandle, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Actions are supplied by the reader/detail screen. This menu never persists,
// confirms removal, or copies a quotation of its own.
export default function HighlightOptionsModal({
  visible, theme, canEdit = true, disabled = false, onEdit, onRemove, onClose, onDismiss,
}) {
  const heading = useRef(null);
  const insets = useSafeAreaInsets();
  // Dismissing a menu is never a mutation, including when its source store
  // becomes blocked or starts loading while the menu is already open.
  const close = () => { onClose?.(); };
  const focus = () => { const target = findNodeHandle(heading.current); if (target != null) AccessibilityInfo.setAccessibilityFocus(target); };
  const action = (label, callback, unavailable = false) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || unavailable }}
      disabled={disabled || unavailable} onPress={() => { if (!disabled && !unavailable) callback?.(); }}
      style={({ pressed }) => [styles.action, { backgroundColor: pressed && !disabled && !unavailable ? theme.highlightPressed : "transparent" }]}>
      <Text style={[styles.actionText, { color: disabled || unavailable ? theme.highlightActionDisabled : label === "Remove highlight" ? theme.highlightDanger : theme.highlightAction }]}>{label}</Text>
    </Pressable>
  );
  return (
    <Modal visible={!!visible} transparent animationType="none" onRequestClose={close} onShow={focus} onDismiss={onDismiss}>
      <View style={styles.backdrop}>
        <View accessibilityViewIsModal onAccessibilityEscape={close}
          style={[styles.panel, { backgroundColor: theme.panel, borderColor: theme.border, paddingBottom: Math.max(12, insets.bottom) }]}>
          <View style={styles.header}>
            <Text ref={heading} accessible accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>Highlight options</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close highlight options"
              onPress={close} style={({ pressed }) => [styles.close, { backgroundColor: pressed ? theme.highlightPressed : "transparent" }]}>
              <Text accessibilityElementsHidden importantForAccessibility="no" style={[styles.closeText, { color: theme.highlightAction }]}>{"\u00D7"}</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
            {action("Edit color", onEdit, !canEdit)}
            {action("Remove highlight", onRemove)}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "center", padding: 20, backgroundColor: "rgba(0,0,0,0.42)" },
  panel: { width: "100%", maxWidth: 360, maxHeight: "85%", flexShrink: 1, alignSelf: "center", borderRadius: 16, borderWidth: 1, paddingHorizontal: 16, paddingTop: 8 },
  header: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  heading: { flex: 1, fontSize: 19, lineHeight: 27, fontWeight: "700" },
  close: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center", flexShrink: 0, borderRadius: 24 },
  closeText: { fontSize: 28, lineHeight: 34 },
  scroll: { flexShrink: 1 }, content: { paddingBottom: 4 },
  action: { minHeight: 48, justifyContent: "center", paddingVertical: 12, paddingHorizontal: 4 },
  actionText: { fontSize: 16, lineHeight: 24, fontWeight: "600" },
});
