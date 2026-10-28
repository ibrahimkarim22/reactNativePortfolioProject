import React from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import MedalArtwork from "./MedalArtwork";
import { getMedalCollection } from "./medalCollection";

export default function MedalsCollection({ plays, completedLevel, onOpenLesson }) {
  const { width, fontScale } = useWindowDimensions();
  const collection = getMedalCollection(plays, completedLevel);
  const singleColumn = width < 360 || fontScale > 1.2;
  const artworkSize = singleColumn ? 144 : Math.max(80, Math.min(144, Math.floor((width - 48) / 2) - 32));
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
        <Text allowFontScaling style={[styles.state, earned && styles.earnedState]}>{earned ? "Earned" : "Locked"}</Text>
      </Pressable>)}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  collection: { paddingHorizontal: 18, paddingTop: 20, gap: 12 },
  heading: { color: "#fff8ef", fontSize: 23, lineHeight: 31, fontWeight: "700" },
  count: { color: "#b5ab9b", fontSize: 16, lineHeight: 24 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingTop: 6 },
  card: { minHeight: 48, alignItems: "center", borderRadius: 14, borderWidth: 1, padding: 14, gap: 12 },
  earnedCard: { backgroundColor: "#18160f", borderColor: "#645532" },
  lockedCard: { backgroundColor: "#101011", borderColor: "#29292a" },
  name: { color: "#fff8ef", fontSize: 16, lineHeight: 24, fontWeight: "600", textAlign: "center" },
  state: { color: "#a5a3a0", fontSize: 14, lineHeight: 22, textAlign: "center" },
  earnedState: { color: "#d8bd73" },
});
