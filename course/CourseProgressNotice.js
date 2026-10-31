import React from "react";
import { ActivityIndicator } from "react-native";
import { COURSE_COLORS, CourseButton, CourseHeading, CoursePage, CourseText } from "./CourseUI";

export function CourseProgressNotice({ status, onRetry, onBack }) {
  const loading = status === "loading";
  return <CoursePage>
    <CourseHeading title={loading ? "Loading course progress" : status === "signed-out" ? "Sign in to continue" : "Course progress unavailable"} />
    {loading ? <ActivityIndicator color={COURSE_COLORS.gold} accessibilityLabel="Loading course progress" />
      : <CourseText tone="muted">{status === "signed-out"
        ? "Sign in with your account to restore your course progress."
        : "Your progress could not be verified. Try loading it again."}</CourseText>}
    {!loading && status !== "signed-out" && <CourseButton title="Retry loading progress" onPress={() => { onRetry().catch(() => {}); }} />}
    {!!onBack && <CourseButton title="Back to course" variant="quiet" onPress={onBack} />}
  </CoursePage>;
}
