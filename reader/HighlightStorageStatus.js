import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { THEMES } from "./readerConstants";

// Routine persistence is automatic. Only a genuine failure interrupts reading;
// this view never turns a pending write into a confirmation.
export default function HighlightStorageStatus({
  theme = THEMES.night, error = null,
}) {
  if (!error) return null;
  return <View style={styles.failure}>
      <Text accessibilityRole="alert" style={[styles.status, { color: theme.highlightDanger }]}>{error}</Text>
    </View>;
}
const styles = StyleSheet.create({
  status: { fontSize: 13, lineHeight: 20, flexShrink: 1 },
  failure: { marginBottom: 8 },
});
