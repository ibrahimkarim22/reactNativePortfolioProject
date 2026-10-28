// Isolated mode never initializes normal Auth, Redux or user data. A failed test
// backend has no live-project fallback. The harness also requires __DEV__.
const testMode = process.env.EXPO_PUBLIC_BARD_HIGHLIGHT_SYNC_TEST;
const courseTestMode = process.env.EXPO_PUBLIC_BARD_COURSE_UI_TEST;
if (courseTestMode && (courseTestMode !== "isolated" || typeof __DEV__ === "undefined" || !__DEV__ || testMode)) {
  throw new Error("The isolated course preview requires development mode and cannot conflict with another test entry.");
}
const App = courseTestMode
  ? require("./course/CoursePilotHarness").default
  : testMode
    ? require("./reader/HighlightSyncEmulatorHarness").default
    : require("./NormalApp").default;

export default App;
