import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, StyleSheet, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";

const PARTICLES = Object.freeze(Array.from({ length: 16 }, (_, index) => Object.freeze({
  color: ["#d8bd73", "#f7edd5", "#bda261", "#eee2c2"][index % 4],
  width: index % 3 === 0 ? 4 : 5,
  height: index % 2 === 0 ? 7 : 5,
  x: (index - 7.5) * 12,
  y: 120 + index % 4 * 12,
  rise: -28 - index % 4 * 13,
  turn: (index % 2 ? 1 : -1) * (50 + index * 7),
})));

export default function QuizCelebration({ attempt, result, attemptToken }) {
  const focused = useIsFocused();
  const progress = useRef(new Animated.Value(0)).current;
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let active = true, animation = null, motionChanged = false, reduceMotion = true;
    setVisible(false);
    if (result?.outcome !== "saved" || !result.passed || result.correct !== result.total || result.total < 1) return undefined;
    if (!focused) {
      attempt?.claimCelebration?.(result, attemptToken);
      return undefined;
    }
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", enabled => {
      motionChanged = true;
      reduceMotion = enabled !== false;
      if (reduceMotion) { animation?.stop(); setVisible(false); }
    });
    const begin = (enabled, lookupFailed = false) => {
      if (!active) return;
      const reduced = lookupFailed || (motionChanged ? reduceMotion : enabled !== false);
      // Claim once even when motion is reduced or its system lookup fails.
      // Returning, remounting or changing the preference cannot replay it.
      if (!attempt?.claimCelebration?.(result, attemptToken) || reduced) return;
      progress.setValue(0);
      setVisible(true);
      animation = Animated.timing(progress, { toValue: 1, duration: 1000, useNativeDriver: true });
      animation.start(() => { if (active) setVisible(false); });
    };
    try {
      Promise.resolve(AccessibilityInfo.isReduceMotionEnabled()).then(begin, () => begin(true, true));
    } catch (_) { begin(true, true); }
    return () => { active = false; animation?.stop(); subscription.remove(); };
  }, [attempt, result, attemptToken, focused, progress]);
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.bounds}>
    {visible && PARTICLES.map((particle, index) => <Animated.View key={index} style={[styles.particle,
      { width: particle.width, height: particle.height, backgroundColor: particle.color,
        opacity: progress.interpolate({ inputRange: [0, 0.15, 0.8, 1], outputRange: [0, 1, 1, 0] }),
        transform: [
          { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-2, particle.x] }) },
          { translateY: progress.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, particle.rise, particle.y] }) },
          { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${particle.turn}deg`] }) },
        ] }]} />)}
  </View>;
}

const styles = StyleSheet.create({
  bounds: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  particle: { position: "absolute", left: "50%", top: "30%", borderRadius: 1 },
});
