import React, { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { COURSE_COLORS as colors, CourseButton, CoursePanel, CourseText } from "./CourseUI";
import MedalArtwork from "./MedalArtwork";
import QuizCelebration from "./QuizCelebration";

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
  failed: ["Keep exploring", "Review the supporting passages, then try again when you're ready."],
  saved: ["Play completed", "Medal added to your collection"],
  replay: ["Already completed", "Already in your collection"],
  "sign-in": ["Sign in required", "Sign in to save course progress. No completion has been confirmed."],
  "invalid-progress": ["Progress unavailable", "Course progress could not be verified. Return to the course before trying again."],
  "save-failed": ["Progress not saved", "Progress could not be saved. Completion has not been confirmed. Retry the save without retaking the quiz."],
};

export function QuizResults({ quiz, play, result, saving, attempt, attemptToken, returnToCourse, onViewMedals, onReviewAnswers, sectionLabels = {}, nextAvailable, renderPage }) {
  const reviewPosition = useRef(0);
  const [title, detail] = outcomes[result.outcome];
  const perfect = result.passed && result.total > 0 && result.correct === result.total;
  const medal = perfect && ["saved", "replay"].includes(result.outcome);
  const artworkRequest = useMemo(() => ({}), [attempt, attemptToken, play?.medalImage, medal]);
  const currentArtwork = useRef(artworkRequest);
  currentArtwork.current = artworkRequest;
  const [readyArtwork, setReadyArtwork] = useState(null);
  const artworkReady = useCallback(() => {
    if (currentArtwork.current === artworkRequest) setReadyArtwork(artworkRequest);
  }, [artworkRequest]);
  const missed = Math.max(0, result.total - result.correct);
  const performance = <View style={styles.performance}>
    <View style={styles.resultSummary}>
      <CourseText accessibilityRole="header" tone="accent" style={styles.resultKicker}>{perfect ? "Perfect performance" : "Quiz results"}</CourseText>
      <View style={styles.scoreLine}>
        <CourseText accessibilityLabel={`${result.correct} of ${result.total} correct`} style={styles.score}>{`${result.correct}/${result.total}`}</CourseText>
      </View>
      {!perfect && <CourseText accessibilityRole="header" style={styles.resultTitle}>{title}</CourseText>}
      {!perfect && <CourseText style={styles.revisit}>{`${missed} ${missed === 1 ? "answer" : "answers"} to revisit`}</CourseText>}
    </View>
    {medal && <View style={styles.reward}>
      <MedalArtwork play={play} size={228} onReady={artworkReady} />
      <CourseText accessibilityRole="header" style={styles.medalName}>{play?.name || "Play medal"}</CourseText>
      <CourseText tone="accent" style={styles.awardMessage}>{detail}</CourseText>
    </View>}
  </View>;
  const content = presentation => <>
    {presentation}
    {!medal && <CoursePanel style={styles.resultNotice} accessibilityRole={perfect ? "alert" : undefined}>
      {perfect && <CourseText style={styles.noticeTitle}>{title}</CourseText>}
      <CourseText tone="muted">{detail}</CourseText>
    </CoursePanel>}
    {result.outcome === "saved" && nextAvailable && <CourseText tone="muted" style={styles.nextPlay}>Next play unlocked</CourseText>}
    {result.outcome === "save-failed" && <CourseButton title="Retry save" busy={saving} onPress={() => attempt.retrySave(attemptToken)} />}
    <View style={styles.actions}>
      {medal && <>
        <CourseButton title="View medals" onPress={onViewMedals} />
        <CourseButton title="Continue course" variant="secondary" onPress={returnToCourse} />
      </>}
      {result.outcome === "failed" && <CourseButton title="Review answers" onPress={() => onReviewAnswers?.(reviewPosition.current)} />}
      <CourseButton title="Retake quiz" variant={medal ? "quiet" : "secondary"} disabled={saving} onPress={() => attempt.retake(attemptToken)} />
      {!medal && <CourseButton title="Back to course" variant="quiet" onPress={returnToCourse} />}
    </View>
    <View onLayout={event => { reviewPosition.current = event.nativeEvent.layout.y; }} style={styles.review}>
    <CourseText accessibilityRole="header" style={styles.reviewTitle}>Answer review</CourseText>
    {quiz.questions.map((question, index) => {
      const chosen = result.answers[question.id];
      const correct = chosen === question.correctAnswer;
      return <CoursePanel key={question.id} style={styles.reviewCard}>
        <CourseText accessibilityRole="header" style={styles.questionTitle}>{index + 1}. {question.question}</CourseText>
        <CourseText tone={correct ? "success" : "danger"}>{correct ? "Correct" : "Incorrect"}</CourseText>
        <CourseText>Your answer: {question.choices.find(choice => choice.id === chosen)?.text}</CourseText>
        <CourseText>Correct answer: {question.choices.find(choice => choice.id === question.correctAnswer)?.text}</CourseText>
        {!!question.explanation && <CourseText>{question.explanation}</CourseText>}
        <QuizEvidence question={question} sectionLabels={sectionLabels} />
      </CoursePanel>;
    })}
    </View>
    <CourseButton title="Back to course" variant="secondary" onPress={returnToCourse} />
  </>;
  const display = (presentation, overlay) => renderPage
    ? renderPage(content(presentation), overlay) : <>{content(presentation)}{overlay}</>;
  return perfect ? <QuizCelebration result={result} attempt={attempt} attemptToken={attemptToken}
    ready={!medal || readyArtwork === artworkRequest} renderResult={display}>{performance}</QuizCelebration>
    : display(performance, null);
}

const styles = StyleSheet.create({
  prompt: { fontSize: 23, lineHeight: 31, fontWeight: "700" },
  helper: { fontSize: 15, lineHeight: 22 },
  progress: { gap: 10 }, position: { fontSize: 13, lineHeight: 20, fontWeight: "600" },
  track: { height: 2, borderRadius: 1, backgroundColor: "#34312b", overflow: "hidden" },
  fill: { height: "100%", backgroundColor: colors.gold },
  choices: { gap: 9 }, actions: { gap: 10 },
  choice: { minHeight: 62, backgroundColor: "#17191c", borderColor: "#343331", borderWidth: 1,
    borderRadius: 12, paddingHorizontal: 15, paddingVertical: 13, gap: 12, flexDirection: "row", alignItems: "center" },
  selected: { borderColor: colors.gold, backgroundColor: "#27241d" },
  pressed: { opacity: 0.8 }, letter: { color: colors.muted, fontSize: 14, lineHeight: 22, fontWeight: "700", width: 20 },
  answer: { flex: 1, minWidth: 0, fontSize: 17, lineHeight: 24 },
  radio: { width: 19, height: 19, borderRadius: 10, borderWidth: 1, borderColor: "#817d73", alignItems: "center", justifyContent: "center" },
  selectedRadio: { borderColor: colors.gold }, radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.gold },
  footerActions: { flexDirection: "row", gap: 12, alignItems: "stretch" }, previousAction: { flex: 1 }, primaryAction: { flex: 2 },
  stackedFooter: { flexDirection: "column", gap: 6 },
  feedback: { padding: 16, gap: 14 },
  feedbackCorrect: { backgroundColor: "#191e1c", borderColor: "#485246" },
  feedbackIncorrect: { backgroundColor: "#211c1e", borderColor: "#5a4645" },
  feedbackTitle: { fontSize: 23, lineHeight: 31, fontWeight: "700" },
  reviewTitle: { fontSize: 25, lineHeight: 33, fontWeight: "700" }, questionTitle: { fontWeight: "700" },
  performance: { gap: 20, paddingTop: 4 },
  resultSummary: { alignItems: "center", gap: 10 },
  resultKicker: { fontSize: 12, lineHeight: 20, letterSpacing: 2, textTransform: "uppercase", textAlign: "center" },
  scoreLine: { alignItems: "center", gap: 0 },
  score: { fontFamily: "serif", fontSize: 60, lineHeight: 72, fontWeight: "400", textAlign: "center", color: colors.text },
  resultTitle: { fontFamily: "serif", fontSize: 30, lineHeight: 38, fontWeight: "400", textAlign: "center" },
  reward: { alignItems: "center", gap: 16, paddingTop: 4 },
  medalName: { maxWidth: 320, fontFamily: "serif", textAlign: "center", fontSize: 21, lineHeight: 29, fontWeight: "400" },
  awardMessage: { textAlign: "center", fontSize: 16, lineHeight: 25 },
  revisit: { color: colors.muted, fontSize: 18, lineHeight: 27, textAlign: "center" },
  resultNotice: { backgroundColor: "#15171a", borderColor: colors.border, padding: 18, gap: 8 },
  noticeTitle: { fontSize: 18, lineHeight: 26, fontWeight: "600" },
  nextPlay: { textAlign: "center", fontSize: 14, lineHeight: 22 },
  review: { gap: 14, paddingTop: 18, borderTopWidth: 1, borderTopColor: colors.border },
  reviewCard: { backgroundColor: "#141619" },
  evidence: { borderLeftWidth: 2, borderLeftColor: colors.gold, paddingLeft: 14, gap: 8 },
});
