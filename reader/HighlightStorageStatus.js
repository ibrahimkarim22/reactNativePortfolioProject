import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { THEMES } from "./readerConstants";

// The caller supplies synchronization state. Local-only is the safe default;
// a local write never becomes a cloud confirmation inside this view.
export default function HighlightStorageStatus({
  theme = THEMES.night, label = "Saved on this device",
  error = null, onRetry,
}) {
  if (!label && !error) return null;
  return <>
    <View testID="highlight-storage-summary" style={styles.summary}>
      {!!label && <Text style={[styles.status, { color: theme.secondary }]}>{label}</Text>}
    </View>
    {!!error && <View style={styles.failure}>
      <Text accessibilityRole="alert" style={[styles.status, { color: theme.highlightDanger }]}>{error}</Text>
      {!!onRetry && <Pressable accessibilityRole="button" accessibilityLabel="Retry highlight synchronization" onPress={onRetry}
        style={({ pressed }) => [styles.action, { backgroundColor: pressed ? theme.highlightPressed : "transparent" }]}>
        <Text style={[styles.actionText, { color: theme.highlightAction }]}>Retry</Text>
      </Pressable>}
    </View>}
  </>;
}
const styles = StyleSheet.create({
  summary: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4 },
  status: { fontSize: 13, lineHeight: 20, flexShrink: 1 },
  failure: { marginBottom: 8 }, action: { minHeight: 48, alignSelf: "flex-start", justifyContent: "center", paddingHorizontal: 4, paddingVertical: 10 },
  actionText: { fontSize: 15, lineHeight: 22, fontWeight: "600" },
});
