import React from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import MedalArtwork from "./MedalArtwork";
import { getMedalCollection } from "./medalCollection";

export default function MedalsCollection({ plays, completedLevel, onOpenLesson }) {
  const { width, fontScale } = useWindowDimensions();
  const collection = getMedalCollection(plays, completedLevel);
  const singleColumn = width < 360 || fontScale > 1.2;
  const artworkSize = singleColumn ? 140 : Math.max(80, Math.min(140, Math.floor((width - 48) / 2) - 32));
  return <View style={styles.collection}>
    <Text allowFontScaling accessibilityRole="header" style={styles.heading}>Your medal collection</Text>
    <Text allowFontScaling style={styles.count}>{`${collection.earnedCount} of ${collection.total} medals earned`}</Text>
    <View style={styles.grid}>
      {collection.items.map(({ play, earned }) => <Pressable key={play.id}
        accessibilityRole="button" accessibilityLabel={`${play.name} medal, ${earned ? "Earned" : "Locked"}`}
        accessibilityHint={earned ? "Open this play’s lesson." : "Complete this play to add its medal."}
        accessibilityState={{ disabled: !earned }} disabled={!earned}
        onPress={earned && onOpenLesson ? () => onOpenLesson(play) : undefined}
        style={[styles.card, { width: singleColumn ? "100%" : "48%" }, earned ? styles.earnedCard : styles.lockedCard]}>
        <MedalArtwork play={play} size={artworkSize} muted={!earned} />
        <Text allowFontScaling style={styles.name}>{play.name}</Text>
        <View style={[styles.stateBadge, earned && styles.earnedBadge]}>
          <Text allowFontScaling style={[styles.state, earned && styles.earnedState]}>{earned ? "Earned" : "Locked"}</Text>
        </View>
      </Pressable>)}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  collection: { paddingHorizontal: 18, paddingTop: 24, gap: 10 },
  heading: { color: "#f3ecdf", fontSize: 23, lineHeight: 31, fontWeight: "600", letterSpacing: 0.2 },
  count: { color: "#b5ac9d", fontSize: 16, lineHeight: 24 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingTop: 10 },
  card: { minHeight: 48, alignItems: "center", borderRadius: 18, borderWidth: 1,
    paddingHorizontal: 14, paddingTop: 20, paddingBottom: 16, gap: 14 },
  earnedCard: { backgroundColor: "#16181b", borderColor: "#766347" },
  lockedCard: { backgroundColor: "#111316", borderColor: "#383329" },
  name: { alignSelf: "stretch", color: "#f3ecdf", fontSize: 16, lineHeight: 24, fontWeight: "500", textAlign: "center" },
  stateBadge: { borderWidth: 1, borderColor: "#383329", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 3 },
  earnedBadge: { backgroundColor: "#25231e", borderColor: "#5c503d" },
  state: { color: "#b5ac9d", fontSize: 13, lineHeight: 21, textAlign: "center", letterSpacing: 1, textTransform: "uppercase" },
  earnedState: { color: "#cbb58d" },
});
