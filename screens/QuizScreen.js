import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AccessibilityInfo, BackHandler, findNodeHandle, useWindowDimensions } from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import { PLAYS, getLocalPlayEntry } from "../shared/localPlayService";
import { validateQuiz } from "../Progress/quizSafety";
import { buildCanonicalDocument, resolveSelection } from "../shared/contentText";
import { isSourceLinkedQuiz } from "../course/quizContent";
import { buildReaderNavigation } from "../reader/readerNavigation";
import { createQuizAttempt } from "../course/quizAttempt";
import { bindCourseRuntime } from "../course/bindCourseRuntime";
import { CourseProgressNotice } from "../course/CourseProgressNotice";
import { CourseActivityPage, CourseButton, CourseHeading, CoursePage, CourseText } from "../course/CourseUI";
import { QuizQuestion, QuizFooter, QuizResults } from "../course/QuizViews";
import { QuizEvidenceModal } from "../course/QuizEvidenceModal";

function prepare(id) {
  const play = typeof id === "string" ? PLAYS.find(candidate => candidate.id === id) : undefined;
  if (!play) return null;
  const entry = getLocalPlayEntry?.(id);
  if (isSourceLinkedQuiz(entry?.quiz)) {
    try {
      const canonicalDocument = buildCanonicalDocument({ play: entry.play, sections: entry.sections });
      const quiz = validateQuiz({ ...play, quizContent: entry.quiz, canonicalDocument });
      return quiz && { quiz, play, canonical: canonicalDocument, labels: Object.fromEntries(buildReaderNavigation(entry, canonicalDocument).items.map(item => [item.id, item.locationLabel])) };
    } catch (_) { return null; }
  }
  const quiz = validateQuiz(play);
  return quiz && { quiz, play, labels: {} };
}

// Firebase is loaded only for the normal application. The isolated course
// preview supplies a runtime backed by memory and never initializes Auth.
export default function QuizScreen({ quizRuntime } = {}) {
  const navigation = useNavigation(), route = useRoute();
  const { width, fontScale } = useWindowDimensions();
  const source = useMemo(() => quizRuntime || require("../course/normalCourseProgress").normalCourseProgress, [quizRuntime]);
  const owner = useSyncExternalStore(source.subscribe, source.getOwner, source.getOwner);
  const snapshot = source.getSnapshot || source.getOwner;
  const progress = useSyncExternalStore(source.subscribe, snapshot, snapshot);
  const runtime = useMemo(() => quizRuntime || bindCourseRuntime(source, owner), [source, owner, quizRuntime]);
  const id = route.params?.id;
  const prepared = prepare(id);
  const attempt = useMemo(() => createQuizAttempt({
    getQuiz: () => prepare(id)?.quiz || null,
    getOwner: runtime.getOwner, getLevel: runtime.getLevel,
    saveProgress: runtime.saveProgress, commitLevel: runtime.commitLevel,
  }), [id, prepared?.quiz.key, runtime, owner]);
  useEffect(() => () => attempt.dispose(), [attempt]);
  const state = useSyncExternalStore(attempt.subscribe, attempt.getSnapshot, attempt.getSnapshot);
  const scroll = useRef(null);
  const medalsOpening = useRef(false);
  useEffect(() => navigation.addListener?.("focus", () => { medalsOpening.current = false; }), [navigation]);
  const [evidence, setEvidence] = useState(null);
  const [readerTransfer, setReaderTransfer] = useState(null);
  const pendingReader = useRef(null);
  const [feedbackActivation, setFeedbackActivation] = useState(null);
  const evidenceButton = useRef(null), evidenceTitle = useRef(null), pendingEvidence = useRef(null), live = useRef(null);
  const question = prepared?.quiz.questions[state.index];
  const checked = question && Object.prototype.hasOwnProperty.call(state.checked, question.id);
  const shownEvidence = evidence && evidence === pendingEvidence.current && evidence.attempt === attempt && evidence.token === state.attemptToken
    && evidence.questionId === question?.id && checked && state.phase === "answering" ? evidence : null;
  live.current = { attempt, token: state.attemptToken, index: state.index, evidence: shownEvidence };
  const feedbackReady = feedbackActivation?.attempt === attempt && feedbackActivation.token === state.attemptToken
    && feedbackActivation.index === state.index;
  useEffect(() => {
    setFeedbackActivation(null);
    if (!checked) return;
    // A rapid double tap must not check and then immediately continue at the
    // same position. This timer only enables a new, deliberate activation.
    const timer = setTimeout(() => {
      if (live.current.attempt === attempt && live.current.token === state.attemptToken && live.current.index === state.index) {
        setFeedbackActivation({ attempt, token: state.attemptToken, index: state.index });
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [attempt, state.attemptToken, state.index, checked]);
  useEffect(() => {
    const obsolete = request => request && (request.attempt !== attempt || request.token !== state.attemptToken || request.index !== state.index);
    if (obsolete(pendingEvidence.current)) pendingEvidence.current = null;
    setEvidence(previous => obsolete(previous) ? null : previous);
  }, [attempt, state.attemptToken, state.index]);
  useEffect(() => { scroll.current?.scrollTo?.({ x: 0, y: 0, animated: false }); }, [attempt, state.index, state.phase, checked]);
  const focus = ref => {
    const node = typeof findNodeHandle === "function" ? findNodeHandle(ref.current) : null;
    if (typeof node === "number") AccessibilityInfo?.setAccessibilityFocus?.(node);
  };
  const openEvidence = () => {
    const current = attempt.getSnapshot();
    if (pendingReader.current || live.current.attempt !== attempt || current.attemptToken !== state.attemptToken
        || current.index !== state.index || !current.checked[question.id]) return;
    const request = { attempt, token: state.attemptToken, index: state.index, questionId: question.id };
    pendingEvidence.current = request;
    setEvidence(request);
  };
  const dismissEvidence = request => {
    const transfer = pendingReader.current;
    const cancellingTransfer = !!request && transfer?.origin === request;
    if (!request || pendingEvidence.current !== request && !cancellingTransfer) return;
    if (cancellingTransfer) {
      pendingReader.current = null;
      setReaderTransfer(previous => previous === transfer ? null : previous);
    }
    pendingEvidence.current = null;
    setEvidence(previous => previous === request ? null : previous);
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => {
      if (live.current.attempt === request.attempt && live.current.token === request.token
          && live.current.index === request.index && !pendingEvidence.current) focus(evidenceButton);
    });
  };
  const closeEvidence = () => dismissEvidence(shownEvidence);
  const openPassage = selection => {
    const request = shownEvidence;
    const current = attempt.getSnapshot();
    if (!request || pendingEvidence.current !== request || pendingReader.current
        || live.current.attempt !== request.attempt || current.attemptToken !== request.token
        || current.index !== request.index || current.phase !== "answering" || !current.checked[request.questionId]
        || !question.evidence.includes(selection)) return;
    try { resolveSelection(prepared.canonical, selection); } catch (_) { return; }
    const copy = Object.freeze({ ...selection, startRef: Object.freeze({ ...selection.startRef }), endRef: Object.freeze({ ...selection.endRef }) });
    const transfer = { ...request, origin: request, selection: copy };
    pendingReader.current = transfer;
    // Dismiss without restoring focus to a quiz that is about to be covered.
    pendingEvidence.current = null;
    setEvidence(null);
    setReaderTransfer(transfer);
  };
  useEffect(() => {
    if (!readerTransfer) return;
    let active = true;
    // Start after the closed Modal commit and two native frame opportunities.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!active || pendingReader.current !== readerTransfer) return;
      const current = readerTransfer.attempt.getSnapshot();
      pendingReader.current = null;
      if (live.current.attempt !== readerTransfer.attempt || current.attemptToken !== readerTransfer.token
          || current.index !== readerTransfer.index || current.phase !== "answering") return;
      navigation.push("MIT", { id, openPassage: readerTransfer.selection });
    }));
    return () => { active = false; };
  }, [readerTransfer, navigation, id]);
  useEffect(() => {
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      const request = pendingReader.current?.origin || pendingEvidence.current;
      if (!request || request.attempt !== attempt || request.token !== state.attemptToken || request.index !== state.index) return false;
      const current = attempt.getSnapshot();
      if (current.attemptToken !== request.token || current.index !== request.index) return false;
      dismissEvidence(request);
      return true;
    });
    return () => listener.remove();
  }, [attempt, state.attemptToken, state.index]);
  const returnToCourse = () => navigation.navigate("Main", { screen: "Course" });
  const viewMedals = () => {
    const current = attempt.getSnapshot();
    if (medalsOpening.current || current.attemptToken !== state.attemptToken || current.result !== state.result
        || current.phase !== "results" || !["saved", "replay"].includes(current.result?.outcome)) return;
    medalsOpening.current = true;
    navigation.push("Main", { screen: "Home", params: { tab: "Medals" } });
  };
  if (!prepared || state.phase === "unavailable") return <CoursePage>
    <CourseHeading title="Quiz unavailable" />
    <CourseText tone="muted">This quiz is not ready yet. It cannot award progress or medals.</CourseText>
    <CourseButton title="Back to course" variant="secondary" onPress={returnToCourse} />
  </CoursePage>;
  if (!quizRuntime && state.phase === "answering" && !state.saving && progress.status !== "ready") {
    return <CourseProgressNotice status={progress.status} onRetry={source.refresh} onBack={returnToCourse} />;
  }
  if (state.phase === "results") return <CoursePage scrollRef={scroll}>
    <QuizResults quiz={prepared.quiz} play={prepared.play} result={state.result} saving={state.saving} attemptToken={state.attemptToken}
      onViewMedals={viewMedals} onReviewAnswers={y => scroll.current?.scrollTo?.({ y, animated: true })}
      attempt={attempt} returnToCourse={returnToCourse} sectionLabels={prepared.labels}
      nextAvailable={PLAYS.some(play => play.difficulty === prepared.quiz.level + 1)} />
  </CoursePage>;
  return <>
    <CourseActivityPage scrollRef={scroll} footer={<QuizFooter quiz={prepared.quiz} state={state} attempt={attempt}
      feedbackReady={feedbackReady} stacked={width < 360 || fontScale > 1.2} />}>
      <QuizQuestion quiz={prepared.quiz} state={state} attempt={attempt} onEvidence={openEvidence} evidenceButtonRef={evidenceButton} />
    </CourseActivityPage>
    {!!shownEvidence && <QuizEvidenceModal question={question} sectionLabels={prepared.labels} onClose={closeEvidence}
      onOpenPassage={openPassage}
      titleRef={evidenceTitle} onShow={() => { if (live.current.evidence === shownEvidence) focus(evidenceTitle); }} />}
  </>;
}
