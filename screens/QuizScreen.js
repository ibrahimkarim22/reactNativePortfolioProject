import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Alert } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { PLAYS } from "../shared/localPlayService";
import { Card, Button, Overlay, Image } from "react-native-elements";
import { useRoute, useNavigation } from "@react-navigation/native";
import { useSelector, useDispatch } from "react-redux";
import { setLevel } from "../Progress/CourseSlice";
import { evaluateSubmission, validateQuiz } from "../Progress/quizSafety";
import { doc, updateDoc } from "firebase/firestore";
import { FIRESTORE_DB, FIREBASE_AUTH } from "../firebaseConfig";

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

const QuizScreen = () => {
  const dispatch = useDispatch();
  const navigation = useNavigation();
  const route = useRoute();
  const id = route.params?.id;
  const play = typeof id === "string" ? PLAYS.find(candidate => candidate.id === id) : undefined;
  const quiz = validateQuiz(play);
  const uid = FIREBASE_AUTH.currentUser?.uid || null;
  const key = JSON.stringify([quiz?.key || null, typeof id === "string" ? id : null, uid]);
  const scope = useRef(null), inFlight = useRef(null), submitted = useRef(null), mounted = useRef(true);
  if (scope.current?.key !== key) {
    scope.current = { key };
    inFlight.current = null;
    submitted.current = null;
  }
  const token = scope.current;
  const [answer, setAnswer] = useState(() => ({ token, values: {} }));
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const scroll = useRef(null);
  const currentCompletedLevel = useSelector(state => state.course.completedLevel);
  const completed = useRef(currentCompletedLevel);
  completed.current = currentCompletedLevel;
  const values = answer.token === token ? answer.values : {};
  const activeResult = result?.token === token ? result : null;
  const isCurrent = () => mounted.current && scope.current === token && (FIREBASE_AUTH.currentUser?.uid || null) === uid;
  const returnToCourse = () => navigation.navigate("Main", { screen: "Course" });

  useLayoutEffect(() => {
    setAnswer({ token, values: {} }); setResult(null); setSaving(false);
  }, [token]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; inFlight.current = null; };
  }, []);

  const handleAnswer = (questionId, option) => {
    if (!quiz || !isCurrent() || inFlight.current || submitted.current === token) return;
    const question = quiz.questions.find(candidate => candidate.id === questionId);
    if (!question?.options.includes(option)) return;
    setAnswer(previous => {
      if (!isCurrent()) return previous;
      const prior = previous.token === token ? previous.values : {};
      if (own(prior, questionId)) return previous;
      return { token, values: { ...prior, [questionId]: option } };
    });
  };

  const submitQuiz = async () => {
    if (!isCurrent() || inFlight.current || submitted.current === token) return;
    // Re-read and validate content here as well as at render time. A captured
    // callback is never authority to submit an empty or changed quiz.
    const score = evaluateSubmission(play, values, quiz?.key);
    if (score.status === "unavailable") return;
    if (score.status !== "complete") {
      Alert.alert("Please answer all questions before submitting");
      return;
    }
    submitted.current = token;
    if (!score.passed) { setResult({ token, ...score, outcome: "failed" }); return; }
    if (!uid) { setResult({ token, ...score, outcome: "sign-in" }); return; }
    const previousLevel = Number(completed.current);
    if (!Number.isSafeInteger(previousLevel) || previousLevel < 0) {
      setResult({ token, ...score, outcome: "invalid-progress" }); return;
    }
    if (score.level <= previousLevel) {
      setResult({ token, ...score, outcome: "replay" }); return;
    }
    const request = { token, uid };
    inFlight.current = request; setSaving(true);
    try {
      await updateDoc(doc(FIRESTORE_DB, "users", uid), { completedLevel: score.level });
      if (!isCurrent() || inFlight.current !== request) return;
      dispatch(setLevel(Math.max(Number(completed.current) || 0, score.level)));
      setResult({ token, ...score, outcome: "saved" });
    } catch (_) {
      if (isCurrent() && inFlight.current === request) setResult({ token, ...score, outcome: "save-failed" });
    } finally {
      if (inFlight.current === request) {
        inFlight.current = null;
        if (isCurrent()) setSaving(false);
      }
    }
  };

  const handleRetakeQuiz = () => {
    if (!isCurrent() || inFlight.current) return;
    const next = { key };
    scope.current = next; submitted.current = null;
    setAnswer({ token: next, values: {} }); setResult(null); setSaving(false);
    scroll.current?.scrollTo?.({ x: 0, y: 0, animated: true });
  };
  const optionStyle = (question, option) => values[question.id] !== option ? styles.btn
    : option === question.correctAnswer ? styles.correctButton : styles.wrongButton;

  if (!quiz) return (
    <View style={styles.unavailable}>
      <Text accessibilityRole="header" style={styles.unavailableTitle}>Quiz unavailable</Text>
      <Text style={styles.unavailableDetail}>This quiz is not ready yet. It cannot award progress or medals.</Text>
      <Button title="Back to course" onPress={returnToCourse} buttonStyle={styles.unavailableButton} />
    </View>
  );
  const incomplete = quiz.questions.some(question => !own(values, question.id));
  return (
    <ScrollView style={styles.main} ref={scroll}>
      <View>
        {quiz.questions.map(question => (
          <Card key={question.id} containerStyle={styles.card}>
            <Card.Title style={styles.question}>{question.question}</Card.Title>
            {question.options.map(option => (
              <Button key={option} title={option} onPress={() => handleAnswer(question.id, option)}
                disabled={saving || !!activeResult || own(values, question.id)} buttonStyle={optionStyle(question, option)} />
            ))}
          </Card>
        ))}
        <View style={styles.submitBtnContainer}>
          {incomplete && <Text style={styles.unavailableDetail}>Answer every question before submitting.</Text>}
          <Button title="Submit" onPress={submitQuiz} disabled={incomplete || saving || !!activeResult} loading={saving} />
        </View>
        <Overlay overlayStyle={styles.overlay} isVisible={!!activeResult}>
          <View>
            <Text style={styles.totalCorrect}>{activeResult ? activeResult.correct + "/" + activeResult.total : ""}</Text>
            {activeResult?.outcome === "saved" && <>
              <Text style={styles.message}>You've earned a medal!
                {PLAYS.some(candidate => candidate.difficulty === activeResult.level + 1) ? "\nNext Level Unlocked." : ""}
              </Text>
              <Image source={play.medalImage} style={styles.medalImage} />
            </>}
            {activeResult?.outcome === "failed" && <Text style={styles.message}>Answer all questions correctly to unlock the next play.</Text>}
            {activeResult?.outcome === "replay" && <Text style={styles.message}>You already completed this activity. No new medal or unlock was awarded.</Text>}
            {activeResult?.outcome === "sign-in" && <Text accessibilityRole="alert" style={styles.message}>Sign in to save course progress. No completion has been confirmed.</Text>}
            {activeResult?.outcome === "invalid-progress" && <Text accessibilityRole="alert" style={styles.message}>Course progress could not be verified. Return to the course before trying again.</Text>}
            {activeResult?.outcome === "save-failed" && <Text accessibilityRole="alert" style={styles.message}>Progress could not be saved. Completion has not been confirmed.</Text>}
          </View>
          <View style={styles.retakeBtn}>
            <Button buttonStyle={{ backgroundColor: "green" }} title="Retake Quiz" onPress={handleRetakeQuiz} />
          </View>
          <View style={styles.retakeBtn}>
            <Button buttonStyle={{ backgroundColor: "darkred" }} title="Course Menu" onPress={returnToCourse} />
          </View>
        </Overlay>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  unavailable: { flex: 1, justifyContent: "center", backgroundColor: "#050505", padding: 24, gap: 16 },
  unavailableTitle: { color: "#fff8ef", fontSize: 25, lineHeight: 33, fontWeight: "700" },
  unavailableDetail: { color: "#c5bbab", fontSize: 16, lineHeight: 24 },
  unavailableButton: { minHeight: 48, backgroundColor: "#715821", padding: 12, borderRadius: 8 },
  main: {
    backgroundColor: "black",
  },
  card: {
    backgroundColor: "rgba(0, 191, 255, .5)",
    borderRadius: 22,
  },
  question: {
    color: "rgba(255, 250, 240, 1)",
    fontFamily: "sans-serif-light",
    fontSize: 18,
  },
  btn: {
    margin: 8,
  },
  wrongButton: {
    margin: 8,
    backgroundColor: "rgba(139, 0, 0, .9)",
  },
  correctButton: {
    margin: 8,
    backgroundColor: "rgba(127, 255, 0, .6)",
  },
  submitBtnContainer: {
    margin: 44,
    top: -22,
  },
  overlay: {
    backgroundColor: "black",
    padding: 22,
    borderRadius: 22,
  },
  retakeBtn: {
    margin: 10,
  },
  totalCorrect: {
    fontFamily: "monospace",
    fontSize: 38,
    color: "white",
    textAlign: "center",
    backgroundColor: "gold",
  },
  medalImage: {
    width: 255,
    height: 200,
  },
  message: {
    color: "snow",
    textAlign: "center",
    fontSize: 22,
    fontFamily: "sans-serif-light",
  },
});
export default QuizScreen;
