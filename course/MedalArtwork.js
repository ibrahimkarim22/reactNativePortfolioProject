import React, { useMemo, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";

export default function MedalArtwork({ play, size = 216, muted = false }) {
  const source = play?.medalImage;
  const [failedSource, setFailedSource] = useState(null);
  const available = useMemo(() => {
    if (!source || typeof Image.resolveAssetSource !== "function") return false;
    try {
      const resolved = Image.resolveAssetSource(source);
      return typeof resolved?.uri === "string" && resolved.uri.length > 0;
    } catch (_) { return false; }
  }, [source]);
  const label = `${play?.name || "Play"} medal`;
  const diameter = Number.isFinite(size) && size >= 64 ? size : 216;
  if (!available || failedSource === source) return <View style={[styles.unavailable, { maxWidth: diameter }]}>
    <Text allowFontScaling accessibilityLabel={`${label} artwork unavailable`} accessibilityLiveRegion="polite"
      style={styles.unavailableText}>Medal artwork unavailable</Text>
  </View>;
  return <View style={[styles.rim, { width: diameter, height: diameter, borderRadius: diameter / 2,
    padding: diameter * 0.11, opacity: muted ? 0.32 : 1 }]}>
    <View style={[styles.innerRim, { borderRadius: diameter / 2, padding: diameter * 0.04 }]}>
      <Image source={source} resizeMode="contain" accessibilityLabel={label} accessible
        onError={() => setFailedSource(source)} style={styles.artwork} />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  rim: { backgroundColor: "#272217", borderWidth: 2, borderColor: "#d8bd73", alignSelf: "center",
    shadowColor: "#d8bd73", shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  innerRim: { flex: 1, borderWidth: 1, borderColor: "#8c7849", backgroundColor: "#18160f", alignItems: "center", justifyContent: "center" },
  artwork: { width: "100%", height: "100%" },
  unavailable: { minHeight: 64, alignSelf: "center", justifyContent: "center", paddingVertical: 12 },
  unavailableText: { color: "#b5ab9b", fontSize: 15, lineHeight: 23, textAlign: "center" },
});
