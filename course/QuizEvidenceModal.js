import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { COURSE_COLORS, CourseText } from "./CourseUI";
import { QuizEvidence } from "./QuizViews";

export function QuizEvidenceModal({ question, sectionLabels, onClose, onShow, onOpenPassage, titleRef }) {
  return <Modal visible animationType="fade" onRequestClose={onClose} onShow={onShow}>
    <SafeAreaView style={styles.page} edges={["top", "left", "right", "bottom"]} accessibilityViewIsModal>
      <View style={styles.header}>
        <CourseText ref={titleRef} accessibilityRole="header" style={styles.title}>Supporting passage</CourseText>
        <Pressable accessibilityRole="button" accessibilityLabel="Close supporting passage"
          onPress={onClose} style={styles.close}>
          <CourseText style={styles.closeGlyph}>{"\u00d7"}</CourseText>
        </Pressable>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <QuizEvidence question={question} sectionLabels={sectionLabels} onOpenPassage={onOpenPassage} />
      </ScrollView>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: COURSE_COLORS.background },
  header: { paddingHorizontal: 20, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 12,
    borderBottomColor: "#333437", borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flex: 1, minWidth: 0, fontSize: 20, lineHeight: 28, fontWeight: "700" },
  close: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center", padding: 6 },
  closeGlyph: { fontSize: 26, lineHeight: 34 },
  scroll: { flex: 1 },
  content: { width: "100%", maxWidth: 720, alignSelf: "center", padding: 20, paddingBottom: 28, gap: 24 },
});
