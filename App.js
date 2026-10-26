// Isolated mode never initializes normal Auth, Redux or user data. A failed test
// backend has no live-project fallback. The harness also requires __DEV__.
const testMode = process.env.EXPO_PUBLIC_BARD_HIGHLIGHT_SYNC_TEST;
const App = testMode
  ? require("./reader/HighlightSyncEmulatorHarness").default
  : require("./NormalApp").default;

export default App;
