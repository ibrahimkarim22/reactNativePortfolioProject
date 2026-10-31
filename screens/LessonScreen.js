import React from "react";
import { StyleSheet, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { getLocalPlayEntry } from "../shared/localPlayService";
import { validateQuiz } from "../Progress/quizSafety";
import { buildCanonicalDocument } from "../shared/contentText";
import { isSourceLinkedQuiz } from "../course/quizContent";
import { getSynopsisContent } from "../shared/synopsisContent";
import { SynopsisProse } from "../synopsis/SynopsisUI";
import {
  CourseButton,
  CourseHeading,
  CoursePage,
  CoursePanel,
  CourseText,
} from "../course/CourseUI";

const nonblank = value => typeof value === "string" && value.trim().length > 0;

function hasUsableQuiz(entry) {
  const play = { id: entry.slug, difficulty: entry.difficulty };
  if (isSourceLinkedQuiz(entry.quiz)) {
    try {
      const canonicalDocument = buildCanonicalDocument({ play: entry.play, sections: entry.sections });
      return !!validateQuiz({ ...play, quizContent: entry.quiz, canonicalDocument });
    } catch (_) { return false; }
  }
  const quiz = Array.isArray(entry.quiz) ? entry.quiz : entry.quiz?.questions;
  return !!validateQuiz({ ...play, quiz });
}

export default function Lesson() {
  const navigation = useNavigation();
  const id = useRoute()?.params?.id;
  const validId = nonblank(id) || Number.isSafeInteger(id);
  const entry = validId ? getLocalPlayEntry(id) : undefined;
  const returnToCourse = () => navigation.navigate("Main", { screen: "Course" });

  if (!entry) return (
    <CoursePage>
      <CourseHeading title="Lesson unavailable" />
      <CourseButton title="Back to course" onPress={returnToCourse} variant="secondary" />
    </CoursePage>
  );

  const synopsis = entry.synopsis || {};
  let structuredSynopsis;
  if (synopsis.schemaVersion === "2.0.0") {
    try { structuredSynopsis = getSynopsisContent(entry); }
    catch (_) { structuredSynopsis = null; }
  }
  const acts = Array.isArray(synopsis.acts) ? synopsis.acts.filter(act => nonblank(act?.summary)) : [];
  const scenes = Array.isArray(synopsis.scenes) ? synopsis.scenes.filter(scene => nonblank(scene?.summary)) : [];
  const quizAvailable = hasUsableQuiz(entry);
  const actCount = Array.isArray(entry.play?.acts) ? entry.play.acts.length : 0;
  const metadata = [
    entry.play?.author,
    entry.play?.genre || entry.genre,
    actCount ? `${actCount} ${actCount === 1 ? "act" : "acts"}` : null,
  ].filter(nonblank).join(" · ");

  return (
    <CoursePage>
      <CourseHeading
        eyebrow={Number.isSafeInteger(entry.difficulty) ? `Lesson ${entry.difficulty}` : undefined}
        title={entry.name || entry.play?.title}
        subtitle={metadata}
      />

      {structuredSynopsis && <CoursePanel>
        <SynopsisProse>{structuredSynopsis.introduction}</SynopsisProse>
        <CourseButton title="Read full synopsis" variant="secondary"
          onPress={() => navigation.navigate("Synopsis", { id: entry.slug })} />
      </CoursePanel>}
      {synopsis.schemaVersion !== "2.0.0" && (nonblank(synopsis.playSummary) || acts.length > 0 || scenes.length > 0) && (
        <CoursePanel>
          {nonblank(synopsis.playSummary) && <CourseText>{synopsis.playSummary}</CourseText>}
          {acts.map((act, index) => (
            <View style={styles.summarySection} key={`act-${act.act}-${index}`}>
              {act.act != null && <CourseText accessibilityRole="header" style={styles.sectionTitle}>Act {act.act}</CourseText>}
              <CourseText>{act.summary}</CourseText>
            </View>
          ))}
          {scenes.map((scene, index) => (
            <View style={styles.summarySection} key={`scene-${scene.id || index}`}>
              {nonblank(scene.label) && <CourseText accessibilityRole="header" style={styles.sectionTitle}>{scene.label}</CourseText>}
              <CourseText>{scene.summary}</CourseText>
            </View>
          ))}
        </CoursePanel>
      )}

      <View style={styles.actions}>
        <CourseButton title="Read play" onPress={() => navigation.navigate("MIT", { id: entry.slug })} />
        <CourseButton
          title="Start quiz"
          onPress={() => navigation.navigate("Quiz", { id: entry.slug })}
          variant="secondary"
          disabled={!quizAvailable}
        />
        {!quizAvailable && <CourseText tone="muted" style={styles.availability}>Quiz unavailable</CourseText>}
        <CourseButton title="Back to course" onPress={returnToCourse} variant="quiet" />
      </View>
    </CoursePage>
  );
}

const styles = StyleSheet.create({
  summarySection: { gap: 8 },
  sectionTitle: { fontSize: 21, lineHeight: 29, fontWeight: "700" },
  actions: { gap: 12 },
  availability: { textAlign: "center", fontSize: 14, lineHeight: 22 },
});
