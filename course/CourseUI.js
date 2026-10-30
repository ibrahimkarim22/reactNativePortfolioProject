import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export const COURSE_COLORS = Object.freeze({
  background: "#0b0d10",
  panel: "#16181b",
  border: "#383329",
  text: "#f3ecdf",
  muted: "#b5ac9d",
  gold: "#b9a177",
  onGold: "#17140e",
  success: "#b5c4ad",
  danger: "#d3a69f",
});

export function CoursePage({ children, scrollRef, contentContainerStyle, overlay }) {
  return (
    <SafeAreaView style={styles.page} edges={["left", "right", "bottom"]}>
      <StatusBar barStyle="light-content" backgroundColor={COURSE_COLORS.background} />
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[styles.content, contentContainerStyle]}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
      {overlay}
    </SafeAreaView>
  );
}

export function CourseText({ children, tone = "body", style, ...props }) {
  return (
    <Text allowFontScaling {...props} style={[styles.body, styles[tone], style]}>
      {children}
    </Text>
  );
}

export function CourseActivityPage({ children, footer, scrollRef }) {
  return <SafeAreaView style={styles.page} edges={["left", "right", "bottom"]}>
    <StatusBar barStyle="light-content" backgroundColor={COURSE_COLORS.background} />
    <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.activityContent}
      keyboardShouldPersistTaps="handled">{children}</ScrollView>
    <View style={styles.activityFooter}>{footer}</View>
  </SafeAreaView>;
}

export function CourseHeading({ eyebrow, title, subtitle, titleStyle }) {
  return (
    <View style={styles.heading}>
      {!!eyebrow && <CourseText tone="accent" style={styles.eyebrow}>{eyebrow}</CourseText>}
      <CourseText accessibilityRole="header" style={[styles.title, titleStyle]}>{title}</CourseText>
      {!!subtitle && <CourseText tone="muted">{subtitle}</CourseText>}
    </View>
  );
}

export function CoursePanel({ children, style, ...props }) {
  return <View {...props} style={[styles.panel, style]}>{children}</View>;
}

export function CourseButton({
  title,
  onPress,
  variant = "primary",
  disabled = false,
  busy = false,
  accessibilityLabel,
  testID,
  buttonRef,
}) {
  const inactive = disabled || busy;
  return (
    <Pressable
      ref={buttonRef}
      onPress={inactive ? undefined : onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityState={{ disabled: inactive, busy }}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        styles[variant],
        pressed && styles.pressed,
        inactive && styles.disabled,
      ]}
    >
      {busy && <ActivityIndicator color={variant === "primary" ? COURSE_COLORS.onGold : COURSE_COLORS.gold} />}
      <CourseText style={[styles.buttonLabel, variant === "primary" && styles.primaryLabel]}>{title}</CourseText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: COURSE_COLORS.background },
  scroll: { flex: 1 },
  content: { width: "100%", maxWidth: 720, alignSelf: "center", padding: 24, paddingBottom: 32, gap: 24 },
  activityContent: { width: "100%", maxWidth: 720, alignSelf: "center", padding: 20, paddingBottom: 24, gap: 16 },
  activityFooter: { width: "100%", maxWidth: 720, alignSelf: "center", paddingHorizontal: 20, paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COURSE_COLORS.border, backgroundColor: COURSE_COLORS.background },
  heading: { gap: 10 },
  title: { fontSize: 32, lineHeight: 41, fontWeight: "700" },
  eyebrow: { fontSize: 13, lineHeight: 20, fontWeight: "700", letterSpacing: 1 },
  body: { color: COURSE_COLORS.text, fontSize: 17, lineHeight: 26 },
  muted: { color: COURSE_COLORS.muted },
  accent: { color: COURSE_COLORS.gold },
  success: { color: COURSE_COLORS.success },
  danger: { color: COURSE_COLORS.danger },
  panel: { backgroundColor: COURSE_COLORS.panel, borderColor: COURSE_COLORS.border, borderWidth: 1, borderRadius: 14, padding: 20, gap: 16 },
  button: { minHeight: 52, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 10 },
  primary: { backgroundColor: COURSE_COLORS.gold, borderColor: "#d0b88b" },
  secondary: { backgroundColor: "#191a1c", borderColor: "#514735" },
  quiet: { backgroundColor: "transparent", borderColor: "transparent" },
  buttonLabel: { flexShrink: 1, fontSize: 16, lineHeight: 24, fontWeight: "700", textAlign: "center" },
  primaryLabel: { color: COURSE_COLORS.onGold },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
});
