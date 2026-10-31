import React, { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, AppState, Easing, StyleSheet, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { SHOWER_DURATION_MS, createConfettiParticles, getConfettiMotion } from "./quizConfetti";

export default function QuizCelebration({ attempt, result, attemptToken, ready = true, children, renderResult }) {
  const focused = useIsFocused();
  const latestResult = useRef(result);
  latestResult.current = result;
  // Saving may replace the result object without creating another performance.
  const session = useMemo(() => ({ progress: new Animated.Value(0), particles: createConfettiParticles(),
    started: false, settled: false }), [attempt, attemptToken]);
  const liveSession = useRef(session);
  liveSession.current = session;
  const [viewport, setViewport] = useState(null);
  const [decision, setDecision] = useState(null);
  const perfect = result?.passed === true && result.total > 0 && result.correct === result.total;

  useEffect(() => {
    const owner = { active: true };
    session.owner = owner;
    liveSession.current = session;
    let motionChanged = false, reduced = true, subscription, appSubscription;
    const settle = () => {
      session.settled = true;
      session.animation?.stop();
      session.progress.setValue(SHOWER_DURATION_MS);
    };
    const cleanup = () => {
      owner.active = false;
      subscription?.remove();
      appSubscription?.remove();
      if (liveSession.current === session) liveSession.current = null;
      if (session.started) settle();
    };
    const consume = () => {
      if (!session.claimed) {
        session.claimed = true;
        session.celebrate = attempt?.claimCelebration?.(latestResult.current, attemptToken) === true;
      }
      return session.celebrate;
    };
    if (!perfect) return cleanup;
    if (!focused || AppState.currentState !== "active") {
      consume();
      settle();
      return cleanup;
    }
    if (session.settled) return cleanup;
    const celebrate = consume();
    const publish = enabled => {
      if (owner.active && session.owner === owner) setDecision({ session, owner, animate: celebrate && !enabled });
    };
    subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", enabled => {
      if (!owner.active) return;
      motionChanged = true;
      reduced = enabled !== false;
      if (reduced && session.started) settle();
      publish(reduced);
    });
    appSubscription = AppState.addEventListener("change", next => {
      if (owner.active && next !== "active") settle();
    });
    const resolved = (enabled, failed = false) => publish(motionChanged ? reduced : failed || enabled !== false);
    try {
      Promise.resolve(AccessibilityInfo.isReduceMotionEnabled()).then(enabled => resolved(enabled), () => resolved(true, true));
    } catch (_) { resolved(true, true); }
    return cleanup;
  }, [attempt, attemptToken, session, focused, perfect]);

  const measured = viewport?.session === session;
  useEffect(() => {
    if (!perfect || !focused || !ready || !measured || session.started || session.settled
        || decision?.session !== session || !decision.owner.active) return;
    session.started = true;
    if (!decision.animate) {
      session.settled = true;
      session.progress.setValue(SHOWER_DURATION_MS);
      return;
    }
    const owner = decision.owner;
    session.animation = Animated.timing(session.progress, { toValue: SHOWER_DURATION_MS,
      duration: SHOWER_DURATION_MS, easing: Easing.linear, useNativeDriver: true });
    session.animation.start(() => {
      if (!owner.active || session.owner !== owner) return;
      session.settled = true;
      session.progress.setValue(SHOWER_DURATION_MS);
    });
  }, [session, decision, ready, measured, focused, perfect]);

  const paper = useMemo(() => !measured ? [] : session.particles.map(piece => {
    const motion = getConfettiMotion(piece, viewport.bounds);
    const interpolate = (inputRange, outputRange) => session.progress.interpolate({ inputRange, outputRange, extrapolate: "clamp" });
    return {
      width: piece.width, height: piece.height, left: motion.leftPx, backgroundColor: piece.color,
      opacity: interpolate(motion.opacityInputRange, motion.opacity),
      transform: [
        { translateX: interpolate(motion.inputRange, motion.translateX) },
        { translateY: interpolate(motion.inputRange, motion.translateY) },
        { rotate: interpolate(motion.inputRange, motion.rotate) },
      ],
    };
  }), [session, viewport, measured]);
  const showPaper = perfect && focused && measured && (ready || session.started) && !session.settled
    && decision?.session === session && decision.owner.active && decision.animate;
  const presentation = <View testID="quiz-performance" style={styles.presentation}>{children}</View>;
  const overlay = perfect ? <View testID="quiz-confetti-viewport" pointerEvents="none" accessible={false}
    accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.viewport}
    onLayout={event => {
      const { width, height } = event.nativeEvent.layout;
      if (liveSession.current !== session || session.viewport || !Number.isFinite(width) || !Number.isFinite(height)
          || width <= 0 || height <= 0) return;
      // Lock this performance's coordinates; reflow must not jump live particles.
      session.viewport = { width, height };
      setViewport({ session, bounds: session.viewport });
    }}>
    {showPaper && <View testID="quiz-confetti" pointerEvents="none" accessible={false}
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.viewport}>
      {paper.map((piece, index) => <Animated.View key={index} style={[styles.paper, piece]} />)}
    </View>}
  </View> : null;
  return renderResult ? renderResult(presentation, overlay)
    : <View style={styles.stage}>{presentation}{overlay}</View>;
}

const styles = StyleSheet.create({
  stage: { flex: 1 },
  presentation: { alignSelf: "stretch", opacity: 1 },
  viewport: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  paper: { position: "absolute", top: 0, borderRadius: 0.5 },
});
