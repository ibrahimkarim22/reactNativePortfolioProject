import React, { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { HIGHLIGHT_PALETTE } from "./readerHighlights";
import { previewQuote } from "./myHighlightsPresentation";

// Presentation only: quotations, eligibility and mutations belong to the
// existing store/session and the caller's established handlers.
export default function HighlightEntry({
  item, index = 0, theme, disabled = false, saving = false, painting = false,
  fullQuotation = false, onShow, onFullQuote, onOptions, onTrigger,
}) {
  const optionsTarget = useRef(null), quotationTarget = useRef(null);
  const exact = typeof item.quotation === "string" ? item.quotation : "";
  const identity = JSON.stringify([item.id, exact]);
  const latest = useRef(identity);
  latest.current = identity;
  const [measurement, setMeasurement] = useState(null);
  const knownLong = exact.length > 800 || exact.split("\n").length > 4;
  const wrapped = measurement?.identity === identity && measurement.long;
  const hasFullQuote = !fullQuotation && item.status !== "unreadable" && (knownLong || wrapped);
  const available = item.status === "resolved" && !disabled && !saving && !painting && typeof onShow === "function";
  const optionsDisabled = disabled || saving || typeof onOptions !== "function";
  const quoteDisabled = saving || typeof onFullQuote !== "function";
  const overlap = item.overlapConflict ?? (item.status === "conflict" && !item.syncConflict);
  const open = (callback, target) => {
    onTrigger?.(target.current);
    callback?.(item.id);
  };
  return (
    <View>
      <View style={styles.headingRow}>
        <Text style={[styles.location, { color: theme.secondary }]}>{item.locationLabel || "Highlight record"}</Text>
        <Pressable ref={optionsTarget} accessibilityRole="button" accessibilityLabel="Highlight options"
          accessibilityHint={item.locationLabel ? `Options for ${item.locationLabel}` : "Edit color or remove this highlight"}
          accessibilityState={{ disabled: optionsDisabled }} disabled={optionsDisabled}
          onPress={() => { if (!optionsDisabled) open(onOptions, optionsTarget); }}
          style={({ pressed }) => [styles.options, { backgroundColor: pressed && !optionsDisabled ? theme.highlightPressed : "transparent" }]}>
          <Text accessibilityElementsHidden importantForAccessibility="no" style={[styles.more, { color: optionsDisabled ? theme.highlightActionDisabled : theme.highlightAction }]}>{"\u22EE"}</Text>
        </Pressable>
      </View>
      {item.status === "unreadable" ? (
        <Text style={[styles.quote, { color: theme.text }]}>This saved record is unavailable. It has been retained on this device.</Text>
      ) : (
        <Text style={[styles.quote, { color: theme.text }]} numberOfLines={fullQuotation ? undefined : 4} ellipsizeMode="tail"
          onTextLayout={fullQuotation ? undefined : event => {
            if (latest.current !== identity) return;
            // Android can return the capped line count. Four visible lines are
            // a conservative cue to offer exact, untruncated inspection.
            const long = (event.nativeEvent?.lines?.length || 0) >= 4;
            setMeasurement(previous => previous?.identity === identity && previous.long === long ? previous : { identity, long });
          }}>{fullQuotation ? exact : previewQuote(exact, 800)}</Text>
      )}
      {!!item.detail && <Text style={[styles.detail, { color: theme.secondary }]}>{item.detail}</Text>}
      {!!item.colorId && <Text style={[styles.detail, { color: theme.secondary }]}>{HIGHLIGHT_PALETTE[item.colorId]?.label || "Unknown color"}</Text>}
      {!!item.syncLabel && <Text style={[styles.detail, { color: theme.secondary }]}>{item.syncLabel}</Text>}
      {item.status === "unresolved" && <Text style={[styles.detail, { color: theme.secondary }]}>This quotation belongs to a different text version or could not be resolved. It has not been moved or painted.</Text>}
      {overlap && <Text style={[styles.detail, { color: theme.secondary }]}>This quotation overlaps another saved highlight. Both records are retained; remove one to display the other.</Text>}
      <View style={styles.actions}>
        {item.status !== "unreadable" && <Pressable accessibilityRole="button" accessibilityLabel={`Show passage ${index + 1}`}
          accessibilityState={{ disabled: !available }} disabled={!available}
          onPress={() => { if (available) onShow?.(item.id); }}
          style={({ pressed }) => [styles.action, { backgroundColor: pressed && available ? theme.highlightPressed : "transparent" }]}>
          <Text style={[styles.primary, { color: available ? theme.highlightPrimary : theme.highlightActionDisabled }]}>Show passage</Text>
        </Pressable>}
        {hasFullQuote && <Pressable ref={quotationTarget} accessibilityRole="button" accessibilityLabel={`View full quote ${index + 1}`}
          accessibilityState={{ disabled: quoteDisabled }} disabled={quoteDisabled}
          onPress={() => { if (!quoteDisabled) open(onFullQuote, quotationTarget); }}
          style={({ pressed }) => [styles.action, { backgroundColor: pressed && !quoteDisabled ? theme.highlightPressed : "transparent" }]}>
          <Text style={[styles.secondaryAction, { color: quoteDisabled ? theme.highlightActionDisabled : theme.highlightSecondary }]}>View full quote</Text>
        </Pressable>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headingRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  location: { flex: 1, minWidth: 0, fontSize: 14, lineHeight: 21, fontWeight: "600" },
  options: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center", flexShrink: 0, borderRadius: 24 },
  more: { fontSize: 28, lineHeight: 32, fontWeight: "600" },
  quote: { fontSize: 17, lineHeight: 25, marginBottom: 12 },
  detail: { fontSize: 14, lineHeight: 21, marginBottom: 8 },
  actions: { flexDirection: "row", flexWrap: "wrap", columnGap: 20, rowGap: 0 },
  action: { minHeight: 48, justifyContent: "center", paddingVertical: 10, paddingHorizontal: 4 },
  primary: { fontSize: 15, lineHeight: 22, fontWeight: "700" },
  secondaryAction: { fontSize: 15, lineHeight: 22, fontWeight: "500" },
});
