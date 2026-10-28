import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { COURSE_COLORS as colors, CourseButton, CourseHeading, CoursePanel, CourseText } from "./CourseUI";

export function QuizQuestion({ quiz, state, attempt, onEvidence, evidenceButtonRef }) {
  const question = quiz.questions[state.index];
  const selected = state.answers[question.id];
  const checked = Object.prototype.hasOwnProperty.call(state.checked, question.id);
  const chosen = checked ? state.checked[question.id] : selected;
  const correct = chosen === question.correctAnswer;
  const choiceText = id => question.choices.find(choice => choice.id === id)?.text;
  const displayedChoices = (state.choiceOrder?.[question.id] || question.options)
    .map(id => question.choices.find(choice => choice.id === id));
  return <>
    <View style={styles.progress}>
      <CourseText tone="muted" style={styles.position}>{`Question ${state.index + 1} of ${quiz.questions.length}`}</CourseText>
      <View style={styles.track} accessible={false}>
        <View style={[styles.fill, { width: `${(state.index + 1) / quiz.questions.length * 100}%` }]} />
      </View>
    </View>
    <CourseText accessibilityRole="header" style={styles.prompt}>{question.question}</CourseText>
    {checked ? <CoursePanel style={[styles.feedback, correct ? styles.feedbackCorrect : styles.feedbackIncorrect]}>
      <CourseText accessibilityRole="header" accessibilityLiveRegion="polite" tone={correct ? "success" : "danger"}
        style={styles.feedbackTitle}>{correct ? "Correct" : "Not quite"}</CourseText>
      {!correct && <CourseText tone="muted">Your answer: {choiceText(chosen)}</CourseText>}
      <CourseText>{correct ? "Your answer: " : "Correct answer: "}{choiceText(question.correctAnswer)}</CourseText>
      <CourseText>{question.explanation}</CourseText>
      {question.evidence.length > 0 && <CourseButton title="Read supporting passage" variant="quiet"
        buttonRef={evidenceButtonRef} onPress={onEvidence} />}
    </CoursePanel> : <>
      <CourseText tone="muted" style={styles.helper}>Choose one answer</CourseText>
      <View accessibilityRole="radiogroup" style={styles.choices}>
        {displayedChoices.map((choice, index) => <Pressable key={choice.id}
          accessibilityRole="radio" accessibilityLabel={choice.text}
          accessibilityState={{ checked: selected === choice.id, disabled: state.saving }}
          disabled={state.saving} onPress={() => attempt.choose(question.id, choice.id, state.attemptToken)}
          style={({ pressed }) => [styles.choice, selected === choice.id && styles.selected, pressed && styles.pressed]}>
          <CourseText style={styles.letter}>{String.fromCharCode(65 + index)}</CourseText>
          <CourseText style={styles.answer}>{choice.text}</CourseText>
          <View accessible={false} style={[styles.radio, selected === choice.id && styles.selectedRadio]}>
            {selected === choice.id && <View style={styles.radioDot} />}
          </View>
        </Pressable>)}
      </View>
    </>}
  </>;
}

export function QuizFooter({ quiz, state, attempt, feedbackReady = true, stacked = false }) {
  const question = quiz.questions[state.index];
  const checked = Object.prototype.hasOwnProperty.call(state.checked, question.id);
  const selected = question.options.includes(state.answers[question.id]);
  const last = state.index === quiz.questions.length - 1;
  const title = !checked ? "Check answer" : last ? "Finish quiz" : "Continue";
  const activate = () => !checked ? attempt.checkAnswer(question.id, state.attemptToken)
    : last ? attempt.submit(question.id, state.attemptToken) : attempt.next(question.id, state.attemptToken);
  return <View testID="quiz-footer" style={[styles.footerActions, stacked && styles.stackedFooter]}>
    <View style={!stacked && styles.previousAction}>
      <CourseButton title="Previous" variant="quiet" disabled={state.index === 0 || state.saving}
        onPress={() => attempt.previous(question.id, state.attemptToken)} />
    </View>
    <View style={!stacked && styles.primaryAction}>
      <CourseButton title={title} disabled={checked ? !feedbackReady : !selected} busy={state.saving} onPress={activate} />
    </View>
  </View>;
}

export function QuizEvidence({ question, sectionLabels = {}, onOpenPassage }) {
  return <>{question.evidence.map((selection, index) => <View key={index} style={styles.evidence}>
    <CourseText tone="accent">{sectionLabels[selection.startRef.sectionId] || "Supporting passage"}</CourseText>
    <CourseText selectable>{selection.exact}</CourseText>
    {!!onOpenPassage && <CourseButton title="Open in full play" accessibilityLabel={`Open supporting passage ${index + 1} in full play`}
      variant="quiet" onPress={() => onOpenPassage(selection)} />}
  </View>)}</>;
}
const outcomes = {
  failed: ["Not passed yet", "Answer all questions correctly to complete this lesson. Review the passages, then try again."],
  saved: ["Lesson completed", "Your progress is saved. You've earned a medal!"],
  replay: ["Already completed", "You already completed this activity. No new medal or unlock was awarded."],
  "sign-in": ["Sign in required", "Sign in to save course progress. No completion has been confirmed."],
  "invalid-progress": ["Progress unavailable", "Course progress could not be verified. Return to the course before trying again."],
  "save-failed": ["Progress not saved", "Progress could not be saved. Completion has not been confirmed. Retry the save without retaking the quiz."],
};

export function QuizResults({ quiz, result, saving, attempt, attemptToken, returnToCourse, sectionLabels = {}, nextAvailable }) {
  const [title, detail] = outcomes[result.outcome];
  return <>
    <CourseHeading eyebrow="Quiz results" title={title} subtitle={`${result.correct}/${result.total} correct`} />
    <CourseText accessibilityRole={result.outcome === "save-failed" ? "alert" : undefined}
      tone={result.outcome === "saved" ? "success" : "body"}>{detail}</CourseText>
    {result.outcome === "saved" && nextAvailable && <CourseText tone="success">Next Level Unlocked.</CourseText>}
    {result.outcome === "save-failed" && <CourseButton title="Retry save" busy={saving} onPress={() => attempt.retrySave(attemptToken)} />}
    <View style={styles.actions}>
      <CourseButton title="Retake quiz" variant="secondary" disabled={saving} onPress={() => attempt.retake(attemptToken)} />
      <CourseButton title="Back to course" variant="quiet" onPress={returnToCourse} />
    </View>
    <CourseText accessibilityRole="header" style={styles.reviewTitle}>Answer review</CourseText>
    {quiz.questions.map((question, index) => {
      const chosen = result.answers[question.id];
      const correct = chosen === question.correctAnswer;
      return <CoursePanel key={question.id}>
        <CourseText accessibilityRole="header" style={styles.questionTitle}>{index + 1}. {question.question}</CourseText>
        <CourseText tone={correct ? "success" : "danger"}>{correct ? "Correct" : "Incorrect"}</CourseText>
        <CourseText>Your answer: {question.choices.find(choice => choice.id === chosen)?.text}</CourseText>
        <CourseText>Correct answer: {question.choices.find(choice => choice.id === question.correctAnswer)?.text}</CourseText>
        {!!question.explanation && <CourseText>{question.explanation}</CourseText>}
        <QuizEvidence question={question} sectionLabels={sectionLabels} />
      </CoursePanel>;
    })}
    <CourseButton title="Back to course" variant="secondary" onPress={returnToCourse} />
  </>;
}

const styles = StyleSheet.create({
  prompt: { fontSize: 23, lineHeight: 31, fontWeight: "700" },
  helper: { fontSize: 15, lineHeight: 22 },
  progress: { gap: 10 }, position: { fontSize: 13, lineHeight: 20, fontWeight: "600" },
  track: { height: 3, borderRadius: 2, backgroundColor: "#303133", overflow: "hidden" },
  fill: { height: "100%", backgroundColor: colors.gold },
  choices: { gap: 10 }, actions: { gap: 12 },
  choice: { minHeight: 64, backgroundColor: "#171819", borderColor: "#333437", borderWidth: 1,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, gap: 10, flexDirection: "row", alignItems: "center" },
  selected: { borderColor: colors.gold, backgroundColor: "#25231c" },
  pressed: { opacity: 0.8 }, letter: { color: colors.muted, fontSize: 14, lineHeight: 22, fontWeight: "700", width: 20 },
  answer: { flex: 1, minWidth: 0, fontSize: 17, lineHeight: 24 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, borderColor: "#77797c", alignItems: "center", justifyContent: "center" },
  selectedRadio: { borderColor: colors.gold }, radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.gold },
  footerActions: { flexDirection: "row", gap: 12, alignItems: "stretch" }, previousAction: { flex: 1 }, primaryAction: { flex: 2 },
  stackedFooter: { flexDirection: "column", gap: 6 },
  feedback: { padding: 16, gap: 14 },
  feedbackCorrect: { backgroundColor: "#18291f", borderColor: "#3d6048" },
  feedbackIncorrect: { backgroundColor: "#29191b", borderColor: "#684047" },
  feedbackTitle: { fontSize: 23, lineHeight: 31, fontWeight: "700" },
  reviewTitle: { fontSize: 25, lineHeight: 33, fontWeight: "700" }, questionTitle: { fontWeight: "700" },
  evidence: { borderLeftWidth: 2, borderLeftColor: colors.gold, paddingLeft: 14, gap: 8 },
});
