import React, { useEffect, useMemo, useState } from "react";
import { StatusBar } from "react-native";
import { Provider, useSelector } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { NavigationContainer } from "@react-navigation/native";
import { createStackNavigator } from "@react-navigation/stack";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { courseReducer, setLevel } from "../Progress/CourseSlice";
import Lesson from "../screens/LessonScreen";
import QuizScreen from "../screens/QuizScreen";
import { createQuizRuntime } from "./quizRuntime";
import { COURSE_COLORS, CourseButton, CourseHeading, CoursePage, CoursePanel, CourseText } from "./CourseUI";

const Stack = createStackNavigator();
const HomeStack = createStackNavigator();
const playId = "a-midsummer-nights-dream";
const allowed = typeof __DEV__ !== "undefined" && __DEV__
  && process.env.EXPO_PUBLIC_BARD_COURSE_UI_TEST === "isolated";
const modes = Object.freeze([
  ["pass", "New attempt"],
  ["save-failed", "Save fails once"],
  ["replay", "Already completed"],
  ["signed-out", "Signed out"],
]);

// No persistent storage, normal authentication, or network transport belongs in
// this boundary. Its runtime is passed explicitly to the actual quiz screen.
export function createPilotScenario(mode) {
  if (!modes.some(([id]) => id === mode)) throw new Error("Unknown course preview scenario.");
  const store = configureStore({
    reducer: { course: courseReducer },
    preloadedState: { course: { completedLevel: mode === "replay" ? 1 : 0 } },
  });
  let saveCalls = 0;
  const runtime = createQuizRuntime({
    getUid: () => mode === "signed-out" ? null : "course-preview-owner",
    subscribeAuth: () => () => {},
    getLevel: () => store.getState().course.completedLevel,
    saveProgress: async (uid, level) => {
      if (mode === "signed-out" || uid !== "course-preview-owner" || level !== 1) {
        throw new Error("Invalid isolated preview save.");
      }
      saveCalls++;
      if (mode === "save-failed" && saveCalls === 1) throw new Error("Simulated save interruption.");
      const completedLevel = store.getState().course.completedLevel;
      return Object.freeze({ completedLevel: Math.max(completedLevel, level), advanced: level > completedLevel });
    },
    commitLevel: level => store.dispatch(setLevel(level)),
  });
  return { store, runtime, dispose: () => runtime.dispose(),
    getStats: () => ({ saveCalls, completedLevel: store.getState().course.completedLevel }) };
}

export default function CoursePilotHarness() {
  if (!allowed) throw new Error("The isolated course preview is available only with explicit development opt-in.");
  const [selection, setSelection] = useState({ mode: "pass", revision: 0 });
  const scenario = useMemo(() => createPilotScenario(selection.mode), [selection]);
  useEffect(() => () => scenario.dispose(), [scenario]);

  function Home({ navigation }) {
    const completedLevel = useSelector(state => state.course.completedLevel);
    return <CoursePage>
      <CourseHeading title="Isolated course preview" subtitle="No account writes" />
      <CoursePanel>
        <CourseText>{modes.find(([id]) => id === selection.mode)[1]}</CourseText>
        <CourseText tone="muted">Memory progress: {completedLevel}</CourseText>
        <CourseButton title="Open Midsummer lesson" onPress={() => navigation.getParent().navigate("Lesson", { id: playId })} />
      </CoursePanel>
      {modes.map(([id, label]) => <CourseButton key={id} title={label} variant="secondary"
        onPress={() => setSelection(previous => ({ mode: id, revision: previous.revision + 1 }))} />)}
    </CoursePage>;
  }
  function Main() {
    return <HomeStack.Navigator screenOptions={{ headerShown: false }}>
      <HomeStack.Screen name="Course" component={Home} />
    </HomeStack.Navigator>;
  }
  function Quiz(props) { return <QuizScreen {...props} quizRuntime={scenario.runtime} />; }
  function ReaderBoundary({ navigation }) {
    return <CoursePage>
      <CourseHeading title="Reading preview" subtitle="No account writes" />
      <CourseText>The shared reader is checked in the normal app. This isolated preview keeps account storage disconnected.</CourseText>
      <CourseButton title="Back to lesson" variant="secondary" onPress={() => navigation.goBack()} />
    </CoursePage>;
  }
  return <SafeAreaProvider>
    <Provider store={scenario.store}>
      <NavigationContainer key={selection.revision} theme={{ dark: true, colors: {
        primary: COURSE_COLORS.gold, background: COURSE_COLORS.background, card: COURSE_COLORS.background,
        text: COURSE_COLORS.text, border: COURSE_COLORS.border, notification: COURSE_COLORS.gold,
      }, fonts: { regular: { fontFamily: "sans-serif", fontWeight: "400" }, medium: { fontFamily: "sans-serif-medium", fontWeight: "500" },
        bold: { fontFamily: "sans-serif", fontWeight: "700" }, heavy: { fontFamily: "sans-serif", fontWeight: "900" } } }}>
        <StatusBar backgroundColor={COURSE_COLORS.background} barStyle="light-content" />
        <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: COURSE_COLORS.background }, headerTintColor: COURSE_COLORS.text,
          cardStyle: { backgroundColor: COURSE_COLORS.background }, headerTitleStyle: { fontWeight: "700" } }}>
          <Stack.Screen name="Main" component={Main} options={{ title: "Course preview" }} />
          <Stack.Screen name="Lesson" component={Lesson} options={{ title: "Lesson" }} />
          <Stack.Screen name="Quiz" component={Quiz} options={{ title: "Quiz" }} />
          <Stack.Screen name="MIT" component={ReaderBoundary} options={{ title: "Reading preview" }} />
        </Stack.Navigator>
      </NavigationContainer>
    </Provider>
  </SafeAreaProvider>;
}
