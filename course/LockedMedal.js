import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";

export default function LockedMedal({ source, size = 140 }) {
  const diameter = Number.isFinite(size) && size >= 64 ? size : 140;
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants" style={[styles.frame, { width: diameter, height: diameter }]}>
    {source ? <Image key={source} source={source} blurRadius={48} resizeMode="contain" fadeDuration={0}
      accessible={false} style={[styles.preview, { width: diameter, height: diameter }]} />
      : <Text allowFontScaling style={[styles.question, { fontSize: diameter * 0.29, lineHeight: diameter * 0.38 }]}>?</Text>}
  </View>;
}

const styles = StyleSheet.create({
  frame: { alignSelf: "center", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  preview: { opacity: 0.8 },
  question: { color: "#c7b182", fontWeight: "300", textAlign: "center" },
});
