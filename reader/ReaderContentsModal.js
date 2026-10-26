import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, findNodeHandle, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { THEMES } from "./readerConstants";

export default function ReaderContentsModal({
  visible,
  model,
  currentSectionId,
  theme = THEMES.paper,
  ready = false,
  onSelect,
  onClose,
  onDismiss,
}) {
  const insets = useSafeAreaInsets();
  const items = model?.items || [];
  const currentIsFrontMatter = items.some(item => item.id === currentSectionId && item.frontMatter);
  const [frontMatterExpanded, setFrontMatterExpanded] = useState(currentIsFrontMatter);
  const heading = useRef(null);
  const closeButton = useRef(null);
  const scroll = useRef(null);
  const rowRefs = useRef(new Map());
  const rowLayouts = useRef(new Map());
  const viewportLaidOut = useRef(false);
  const pendingScroll = useRef(true);
  const byId = new Map(items.map(item => [item.id, item]));

  const scrollToCurrent = () => {
    const layout = rowLayouts.current.get(currentSectionId);
    if (!visible || !ready || !pendingScroll.current || !viewportLaidOut.current || !layout || !scroll.current) return;
    scroll.current.scrollTo({ y: Math.max(0, layout.y - 12), animated: false });
    pendingScroll.current = false;
  };

  useEffect(() => {
    if (visible) setFrontMatterExpanded(currentIsFrontMatter);
  }, [visible]);

  useEffect(() => {
    pendingScroll.current = !!visible;
    if (!visible) {
      viewportLaidOut.current = false;
      rowLayouts.current.clear();
    } else {
      scrollToCurrent();
    }
  }, [visible, currentSectionId, ready]);

  const focusModal = () => {
    scrollToCurrent();
    const currentRow = ready && rowLayouts.current.has(currentSectionId) ? rowRefs.current.get(currentSectionId) : null;
    const target = currentRow || heading.current || closeButton.current;
    if (Platform.OS === "web") {
      target?.focus?.();
    } else {
      const handle = findNodeHandle(target);
      if (handle != null) AccessibilityInfo.setAccessibilityFocus(handle);
    }
  };

  const depthOf = item => {
    let depth = item.frontMatter ? 1 : 0;
    let parent = item.parentSectionId;
    const seen = new Set([item.id]);
    while (parent && byId.has(parent) && !seen.has(parent)) {
      seen.add(parent);
      depth++;
      parent = byId.get(parent).parentSectionId;
    }
    return depth;
  };

  const row = item => {
    const selected = item.id === currentSectionId;
    const label = item.locationLabel && item.locationLabel !== item.label ? `${item.label}. ${item.locationLabel}` : item.label;
    return (
      <Pressable
        key={item.id}
        ref={node => {
          if (node) rowRefs.current.set(item.id, node);
          else rowRefs.current.delete(item.id);
        }}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected, disabled: !ready }}
        disabled={!ready}
        onPress={() => { if (ready) onSelect?.(item.id); }}
        onLayout={event => {
          rowLayouts.current.set(item.id, event.nativeEvent.layout);
          if (selected) scrollToCurrent();
        }}
        style={({ pressed, focused }) => [
          styles.row,
          {
            marginLeft: depthOf(item) * 16,
            backgroundColor: selected || pressed ? theme.background : theme.panel,
            borderColor: selected || focused ? theme.accent : theme.border,
          },
          !ready && styles.disabled,
        ]}
      >
        <Text style={[styles.label, item.kind === "act" && styles.actLabel, { color: theme.text }]}>{item.label}</Text>
      </Pressable>
    );
  };

  let frontMatterShown = false;
  const contents = [];
  for (const item of items) {
    if (!item.frontMatter) {
      contents.push(row(item));
      continue;
    }
    if (!frontMatterShown) {
      frontMatterShown = true;
      contents.push(
        <Pressable
          key="front-matter-disclosure"
          accessibilityRole="button"
          accessibilityLabel="Front matter"
          accessibilityState={{ expanded: frontMatterExpanded }}
          onPress={() => setFrontMatterExpanded(expanded => !expanded)}
          style={({ pressed, focused }) => [styles.disclosure, { backgroundColor: pressed ? theme.background : theme.panel, borderColor: focused ? theme.accent : theme.border }]}
        >
          <Text style={[styles.disclosureLabel, { color: theme.text }]}>Front matter</Text>
          <Text accessibilityElementsHidden importantForAccessibility="no" style={[styles.disclosureIcon, { color: theme.accent }]}>{frontMatterExpanded ? "−" : "+"}</Text>
        </Pressable>,
      );
    }
    if (frontMatterExpanded) contents.push(row(item));
  }

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} onDismiss={onDismiss} onShow={focusModal}>
      <View style={styles.backdrop}>
        <View
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
          style={[styles.panel, { backgroundColor: theme.panel, borderColor: theme.border, paddingBottom: insets.bottom }]}
        >
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <Text ref={heading} accessible accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>Contents</Text>
            <Pressable
              ref={closeButton}
              accessibilityRole="button"
              accessibilityLabel="Close contents"
              onPress={onClose}
              style={styles.close}
            >
              <Text style={[styles.closeLabel, { color: theme.accent }]}>Close</Text>
            </Pressable>
          </View>
          <ScrollView
            ref={scroll}
            style={styles.scroll}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            onLayout={() => { viewportLaidOut.current = true; scrollToCurrent(); }}
            onContentSizeChange={scrollToCurrent}
          >
            {!ready && <Text accessibilityLiveRegion="polite" style={[styles.status, { color: theme.secondary }]}>Preparing play contents…</Text>}
            {contents}
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
  closeLabel: { fontFamily: systemFont, fontSize: 16, fontWeight: "600", textAlign: "center" },
  scroll: { flexShrink: 1 },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 },
  row: { minWidth: 48, minHeight: 48, paddingHorizontal: 12, paddingVertical: 12, borderWidth: 1, borderRadius: 10, justifyContent: "center", marginBottom: 8 },
  label: { fontFamily: systemFont, fontSize: 17, lineHeight: 25, flexShrink: 1 },
  actLabel: { fontWeight: "600" },
  disclosure: { minWidth: 48, minHeight: 48, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 12, borderWidth: 1, borderRadius: 10, marginBottom: 8 },
  disclosureLabel: { flex: 1, fontFamily: systemFont, fontSize: 17, lineHeight: 25, fontWeight: "600" },
  disclosureIcon: { fontFamily: systemFont, fontSize: 22, marginLeft: 12 },
  status: { fontFamily: systemFont, fontSize: 14, lineHeight: 21, paddingBottom: 12 },
  disabled: { opacity: 0.5 },
});
