import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { useEffect, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-native-fontawesome";
import { faFeather } from "@fortawesome/free-solid-svg-icons";

const Loader = ({
  label = "Loading",
  detail = "Preparing your Shakespeare library",
  compact = false,
  overlay = false,
}) => {
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const spinLoop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 760,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 760,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ])
    );

    spinLoop.start();
    pulseLoop.start();

    return () => {
      spinLoop.stop();
      pulseLoop.stop();
    };
  }, [pulse, spin]);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });
  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.92, 1.08],
  });
  const pulseOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.55, 1],
  });

  return (
    <View
      pointerEvents="none"
      style={[styles.wrap, overlay && styles.overlay, compact && styles.compact]}
    >
      <View style={[styles.mark, compact && styles.compactMark]}>
        <Animated.View
          style={[
            styles.ring,
            compact && styles.compactRing,
            { transform: [{ rotate }] },
          ]}
        />
        <Animated.View
          style={[
            styles.innerGlow,
            compact && styles.compactInnerGlow,
            {
              opacity: pulseOpacity,
              transform: [{ scale: pulseScale }],
            },
          ]}
        />
        <FontAwesomeIcon
          icon={faFeather}
          size={compact ? 13 : 20}
          color="#130f0b"
        />
      </View>
      {!!label && (
        <Text style={[styles.label, compact && styles.compactLabel]}>
          {label}
        </Text>
      )}
      {!compact && !!detail && <Text style={styles.detail}>{detail}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 180,
    padding: 22,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(5, 5, 5, 0.74)",
    minHeight: 0,
    zIndex: 4,
  },
  compact: {
    padding: 8,
  },
  mark: {
    alignItems: "center",
    backgroundColor: "#d8bd73",
    borderRadius: 28,
    height: 56,
    justifyContent: "center",
    width: 56,
  },
  compactMark: {
    borderRadius: 20,
    height: 40,
    width: 40,
  },
  ring: {
    ...StyleSheet.absoluteFillObject,
    borderColor: "rgba(244, 223, 154, 0.18)",
    borderRadius: 28,
    borderRightColor: "#fff1bd",
    borderTopColor: "#fff1bd",
    borderWidth: 2,
  },
  compactRing: {
    borderRadius: 20,
  },
  innerGlow: {
    backgroundColor: "rgba(255, 248, 239, 0.5)",
    borderRadius: 18,
    height: 36,
    position: "absolute",
    width: 36,
  },
  compactInnerGlow: {
    borderRadius: 13,
    height: 26,
    width: 26,
  },
  label: {
    color: "#fff8ef",
    fontSize: 16,
    fontWeight: "900",
    marginTop: 14,
    textAlign: "center",
  },
  compactLabel: {
    color: "#f4df9a",
    fontSize: 10,
    marginTop: 7,
  },
  detail: {
    color: "#a9a190",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
    marginTop: 6,
    textAlign: "center",
  },
});

export default Loader;
