import React, { useRef } from "react";
import { AccessibilityInfo, findNodeHandle, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DEFAULT_PREFERENCES, FONTS, LINE_SPACING, THEMES } from "./readerConstants";

const fontDescriptions = {
  literata: "A book serif with open, generous shapes.",
  "source-serif-4": "A traditional serif for a familiar page.",
  "source-sans-3": "A clear sans serif with simple letterforms.",
};
const themeDescriptions = {
  paper: "Soft paper with dark text.",
  sepia: "Warm tones for a gentler page.",
  night: "A dark page with light text.",
};
const labels = { paper: "Paper", sepia: "Sepia", night: "Night", compact: "Compact", comfortable: "Comfortable", spacious: "Spacious" };

export default function ReaderAppearanceModal({
  visible,
  preferences = DEFAULT_PREFERENCES,
  ready = false,
  onChange,
  onReset,
  onClose,
  onDismiss,
  saveError,
  onRetrySave,
  fontStatus = {},
  onRetryFont,
}) {
  const insets = useSafeAreaInsets();
  const heading = useRef(null);
  const closeButton = useRef(null);
  const theme = THEMES[preferences.theme] || THEMES.paper;
  const colors = { color: theme.text };
  const secondary = { color: theme.secondary };
  const changeSize = amount => {
    if (!ready) return;
    const fontSize = Math.max(16, Math.min(30, preferences.fontSize + amount));
    if (fontSize !== preferences.fontSize) onChange?.({ fontSize });
  };
  const focusModal = () => {
    const target = findNodeHandle(heading.current) ?? findNodeHandle(closeButton.current);
    if (target != null) AccessibilityInfo.setAccessibilityFocus(target);
  };
  const option = (field, id, label, description, swatch) => {
    const checked = preferences[field] === id;
    return (
      <Pressable
        key={id}
        accessibilityRole="radio"
        accessibilityLabel={`${label}. ${description}`}
        accessibilityState={{ checked, disabled: !ready }}
        disabled={!ready}
        onPress={() => { if (ready && !checked) onChange?.({ [field]: id }); }}
        style={[
          styles.option,
          { backgroundColor: checked ? theme.background : theme.panel, borderColor: checked ? theme.accent : theme.border },
          !ready && styles.disabled,
        ]}
      >
        {swatch && <View style={[styles.swatch, { backgroundColor: swatch.background, borderColor: swatch.text }]} />}
        <View style={styles.optionCopy}>
          <Text style={[styles.optionLabel, colors]}>{label}</Text>
          <Text style={[styles.description, secondary]}>{description}</Text>
        </View>
        <Text accessibilityElementsHidden importantForAccessibility="no" style={[styles.check, { color: theme.accent }]}>{checked ? "✓" : "○"}</Text>
      </Pressable>
    );
  };
  const retry = (label, display, callback) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !callback }}
      disabled={!callback}
      onPress={callback}
      style={[styles.action, { borderColor: theme.border, backgroundColor: theme.background }]}
    >
      <Text style={[styles.actionLabel, { color: theme.accent }]}>{display}</Text>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} onDismiss={onDismiss} onShow={focusModal}>
      <View style={styles.backdrop}>
        <View
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
          style={[styles.panel, { backgroundColor: theme.panel, borderColor: theme.border, paddingBottom: insets.bottom }]}
        >
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <Text ref={heading} accessible accessibilityRole="header" style={[styles.heading, colors]}>Reading appearance</Text>
            <Pressable
              ref={closeButton}
              accessibilityRole="button"
              accessibilityLabel="Close reading appearance"
              onPress={onClose}
              style={styles.close}
            >
              <Text style={[styles.actionLabel, { color: theme.accent }]}>Close</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {!ready && <Text accessibilityLiveRegion="polite" style={[styles.status, secondary]}>Loading your reading settings…</Text>}
            <Text accessibilityRole="header" style={[styles.sectionTitle, colors]}>Text size</Text>
            <View style={styles.sizeRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Decrease text size"
                accessibilityState={{ disabled: !ready || preferences.fontSize <= 16 }}
                disabled={!ready || preferences.fontSize <= 16}
                onPress={() => changeSize(-2)}
                style={[styles.sizeButton, { borderColor: theme.border }, (!ready || preferences.fontSize <= 16) && styles.disabled]}
              >
                <Text style={[styles.sizeButtonLabel, colors]}>A−</Text>
              </Pressable>
              <Text accessibilityLabel={`Text size, ${preferences.fontSize}`} style={[styles.sizeValue, colors]}>{preferences.fontSize}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Increase text size"
                accessibilityState={{ disabled: !ready || preferences.fontSize >= 30 }}
                disabled={!ready || preferences.fontSize >= 30}
                onPress={() => changeSize(2)}
                style={[styles.sizeButton, { borderColor: theme.border }, (!ready || preferences.fontSize >= 30) && styles.disabled]}
              >
                <Text style={[styles.sizeButtonLabel, colors]}>A+</Text>
              </Pressable>
            </View>
            <Text accessibilityRole="header" style={[styles.sectionTitle, colors]}>Typeface</Text>
            {Object.values(FONTS).map(font => option("fontId", font.id, font.label, fontDescriptions[font.id]))}
            {fontStatus.loading && <Text accessibilityLiveRegion="polite" style={[styles.status, secondary]}>Loading typeface…</Text>}
            {!!fontStatus.error && (
              <View style={styles.recovery}>
                <Text accessibilityRole="alert" style={[styles.description, colors]}>{typeof fontStatus.error === "string" ? fontStatus.error : "The typeface could not load. Using the fallback serif."}</Text>
                {retry("Retry loading typeface", "Retry typeface", onRetryFont)}
              </View>
            )}
            <Text accessibilityRole="header" style={[styles.sectionTitle, colors]}>Page</Text>
            {Object.entries(THEMES).map(([id, swatch]) => option("theme", id, labels[id], themeDescriptions[id], swatch))}
            <Text accessibilityRole="header" style={[styles.sectionTitle, colors]}>Line spacing</Text>
            {Object.entries(LINE_SPACING).map(([id, multiplier]) => option("lineSpacing", id, labels[id], `${multiplier}× line height.`))}
            {!!saveError && (
              <View style={styles.recovery}>
                <Text accessibilityRole="alert" style={[styles.description, colors]}>{typeof saveError === "string" ? saveError : "Your reading settings could not be saved. Changes apply for this session."}</Text>
                {retry("Retry saving reading settings", "Retry save", onRetrySave)}
              </View>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reset reading appearance"
              accessibilityState={{ disabled: !ready }}
              disabled={!ready}
              onPress={() => { if (ready) onReset?.(); }}
              style={[styles.action, styles.reset, { borderColor: theme.border, backgroundColor: theme.background }, !ready && styles.disabled]}
            >
              <Text style={[styles.actionLabel, { color: theme.accent }]}>Reset to defaults</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const systemFont = Platform.OS === "ios" ? "System" : "sans-serif";
const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", alignItems: "center", backgroundColor: "rgba(0, 0, 0, 0.45)" },
  panel: { width: "100%", maxWidth: 560, maxHeight: "85%", borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "center", paddingLeft: 20, paddingRight: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  heading: { flex: 1, fontFamily: systemFont, fontSize: 21, fontWeight: "600", paddingVertical: 8 },
  close: { minWidth: 48, minHeight: 48, paddingHorizontal: 12, paddingVertical: 12, alignItems: "center", justifyContent: "center", marginLeft: 8 },
  scroll: { flexShrink: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 20 },
  sectionTitle: { fontFamily: systemFont, fontSize: 17, fontWeight: "600", marginTop: 24, marginBottom: 12 },
  sizeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sizeButton: { minWidth: 64, minHeight: 48, paddingHorizontal: 16, paddingVertical: 10, borderWidth: 1, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  sizeButtonLabel: { fontFamily: systemFont, fontSize: 21, fontWeight: "600" },
  sizeValue: { flexShrink: 1, fontFamily: systemFont, fontSize: 20, fontWeight: "600", paddingHorizontal: 8, textAlign: "center" },
  option: { minHeight: 64, minWidth: 48, flexDirection: "row", alignItems: "center", padding: 12, borderWidth: 1, borderRadius: 12, marginBottom: 8 },
  optionCopy: { flex: 1, minWidth: 0 },
  optionLabel: { fontFamily: systemFont, fontSize: 17, fontWeight: "600" },
  description: { fontFamily: systemFont, fontSize: 14, lineHeight: 21, marginTop: 4 },
  swatch: { width: 30, height: 30, borderWidth: 1, borderRadius: 15, marginRight: 12 },
  check: { fontFamily: systemFont, fontSize: 22, marginLeft: 12 },
  status: { fontFamily: systemFont, fontSize: 14, lineHeight: 21, paddingTop: 12 },
  recovery: { marginTop: 12 },
  action: { minHeight: 48, minWidth: 48, borderWidth: 1, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, alignItems: "center", justifyContent: "center", marginTop: 12 },
  actionLabel: { fontFamily: systemFont, fontSize: 16, fontWeight: "600", textAlign: "center" },
  reset: { marginTop: 24 },
  disabled: { opacity: 0.5 },
});
