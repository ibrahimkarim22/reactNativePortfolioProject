import React, { useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { useDispatch } from "react-redux";
import { receiveAccountProgress } from "../Progress/CourseSlice";
import { normalCourseProgress } from "./normalCourseProgress";

export function CourseProgressBridge({ children }) {
  const dispatch = useDispatch();
  useEffect(() => {
    const publish = () => dispatch(receiveAccountProgress(normalCourseProgress.getSnapshot()));
    const unsubscribe = normalCourseProgress.subscribe(publish);
    normalCourseProgress.start();
    publish();
    const foreground = AppState.addEventListener("change", state => {
      if (state === "active") normalCourseProgress.refresh().catch(() => {});
    });
    return () => {
      foreground.remove();
      unsubscribe();
      normalCourseProgress.stop();
    };
  }, [dispatch]);
  return children;
}

export function useAccountCourseProgress() {
  return useSyncExternalStore(normalCourseProgress.subscribe, normalCourseProgress.getSnapshot, normalCourseProgress.getSnapshot);
}

export const retryAccountProgress = () => normalCourseProgress.refresh();
