import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { StatusBar } from "react-native";
import { NavigationContainer, DarkTheme } from "@react-navigation/native";
import { createStackNavigator } from "@react-navigation/stack";
import { SafeAreaProvider } from "react-native-safe-area-context";
import QuizScreen from "../screens/QuizScreen";
import Lesson from "../screens/LessonScreen";
import { PLAYS } from "../shared/localPlayService";
import MedalsCollection from "./MedalsCollection";
import { createCourseRewardsScenario } from "./courseRewardsEnvironment";
import { COURSE_COLORS, CourseButton, CourseHeading, CoursePage, CoursePanel, CourseText } from "./CourseUI";

const Stack = createStackNavigator(), MainStack = createStackNavigator();
const playId = "a-midsummer-nights-dream";
const allowed = typeof __DEV__ !== "undefined" && __DEV__
  && process.env.EXPO_PUBLIC_BARD_COURSE_UI_TEST === "emulator";
const modes = [["pass", "New confirmed completion"], ["save-failed", "Save fails once"],
  ["replay", "Already completed replay"], ["incorrect", "Incorrect attempt"]];

function ConfirmedProgress({ scenario }) {
  const progress = useSyncExternalStore(scenario.source.subscribe, scenario.source.getSnapshot, scenario.source.getSnapshot);
  return <CourseText tone="muted">Confirmed emulator progress: {progress.completedLevel}</CourseText>;
}

function EmulatorCollection({ navigation, scenario }) {
  const progress = useSyncExternalStore(scenario.source.subscribe, scenario.source.getSnapshot, scenario.source.getSnapshot);
  return <CoursePage>
    <MedalsCollection plays={PLAYS} completedLevel={progress.status === "ready" ? progress.completedLevel : null}
      onOpenLesson={play => navigation.getParent().navigate("Lesson", { id: play.id })} />
  </CoursePage>;
}

function EmulatorCourse({ navigation, scenario, busy, message, onConnect }) {
  return <CoursePage>
    <CourseHeading title="Rewards emulator check" subtitle="Demo Firebase only" />
    <CourseText tone="muted">Normal accounts and progress are disconnected. Every scenario uses a new synthetic account.</CourseText>
    {!!message && <CourseText accessibilityRole="alert">{message}</CourseText>}
    {!!scenario && <CoursePanel>
      <ConfirmedProgress scenario={scenario} />
      <CourseButton title="Open Midsummer lesson" disabled={busy}
        onPress={() => navigation.getParent().navigate("Lesson", { id: playId })} />
    </CoursePanel>}
    {modes.map(([mode, label]) => <CourseButton key={mode} title={label} variant="secondary" busy={busy}
      onPress={() => onConnect(mode)} />)}
  </CoursePage>;
}

export default function CourseRewardsEmulatorHarness() {
  if (!allowed) throw new Error("The rewards emulator entry requires explicit development opt-in.");
  const [scenario, setScenario] = useState(null), [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(null);
  const current = useRef(null), mounted = useRef(true), operation = useRef(0), locked = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false; operation.current++;
      const previous = current.current; current.current = null;
      previous?.dispose().catch(() => {});
      delete globalThis.__bardCourseRewardsTest;
    };
  }, []);
  async function connect(mode) {
    if (!allowed || locked.current) return;
    locked.current = true; setBusy(true); setMessage(null);
    const token = ++operation.current;
    const previous = current.current;
    current.current = null; setScenario(null);
    delete globalThis.__bardCourseRewardsTest;
    let next;
    try {
      await previous?.dispose();
      next = await createCourseRewardsScenario(mode, { host: "10.0.2.2" });
      if (!mounted.current || operation.current !== token) { await next.dispose(); return; }
      current.current = next;
      globalThis.__bardCourseRewardsTest = { environment: next.environment, source: next.source,
        runtime: next.runtime, getStats: next.getStats };
      setScenario(next); setRevision(value => value + 1);
    } catch (error) {
      if (mounted.current && operation.current === token) {
        setMessage(`Isolated test unavailable (${error.code || "EMULATOR_UNAVAILABLE"}). No live backend fallback.`);
      }
    } finally {
      if (mounted.current && operation.current === token) { locked.current = false; setBusy(false); }
    }
  }
  const theme = { ...DarkTheme, colors: { ...DarkTheme.colors, primary: COURSE_COLORS.gold,
    background: COURSE_COLORS.background, card: COURSE_COLORS.background, text: COURSE_COLORS.text, border: COURSE_COLORS.border } };
  function Main() {
    return <MainStack.Navigator initialRouteName="Course" screenOptions={{ headerShown: false }}>
      <MainStack.Screen name="Course">{props => <EmulatorCourse {...props} scenario={scenario} busy={busy} message={message} onConnect={connect} />}</MainStack.Screen>
      <MainStack.Screen name="Home">{props => scenario ? <EmulatorCollection {...props} scenario={scenario} /> : <CoursePage><CourseText>Connect an isolated scenario first.</CourseText></CoursePage>}</MainStack.Screen>
    </MainStack.Navigator>;
  }
  return <SafeAreaProvider>
    <NavigationContainer key={revision} theme={theme}>
      <StatusBar backgroundColor={COURSE_COLORS.background} barStyle="light-content" />
      <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: COURSE_COLORS.background }, headerTintColor: COURSE_COLORS.text,
        cardStyle: { backgroundColor: COURSE_COLORS.background }, headerTitleStyle: { fontWeight: "700" } }}>
        <Stack.Screen name="Main" component={Main} options={{ title: "Emulator course" }} />
        <Stack.Screen name="Lesson" component={Lesson} options={{ title: "Lesson" }} />
        <Stack.Screen name="Quiz">{props => scenario ? <QuizScreen {...props} quizRuntime={scenario.runtime} /> : <CoursePage><CourseText>Connect an isolated scenario first.</CourseText></CoursePage>}</Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
  </SafeAreaProvider>;
}
