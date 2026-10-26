// Explicit development-only entry. This module never imports normal Firebase,
// Redux, navigation/auth screens or the user's local highlight manager.
import React, { useEffect, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { createStackNavigator } from "@react-navigation/stack";
import AsyncStorage from "@react-native-async-storage/async-storage";
import MITFullPlayScreen from "../screens/MITFullPlayScreen";
import ReadFolger from "../screens/Read";
import { getLocalPlayEntry } from "../shared/localPlayService";
import { buildCanonicalDocument } from "../shared/contentText";
import { createHighlightSyncEmulatorEnvironment, createIsolatedHighlightStorage } from "./highlightSyncEnvironment";
import { createFirestoreHighlightSyncTransport } from "./highlightSyncFirestore";
import { createHighlightSyncStoreManager } from "./highlightSyncStore";
import { createHighlightSyncCoordinator } from "./highlightSyncCoordinator";
import { createReaderPreferenceStore } from "./readerPreferences";

const Stack = createStackNavigator();
const allowed = typeof __DEV__ !== "undefined" && __DEV__ && process.env.EXPO_PUBLIC_BARD_HIGHLIGHT_SYNC_TEST === "emulator";
const canonicalCache = new Map();
function canonicalFor(workId) {
  if (!canonicalCache.has(workId)) {
    const entry = getLocalPlayEntry(workId);
    if (!entry) throw new Error("The bundled test play is unavailable.");
    canonicalCache.set(workId, buildCanonicalDocument({ play: entry.play, sections: entry.sections }));
  }
  return canonicalCache.get(workId);
}

export default function HighlightSyncEmulatorHarness() {
  const [clients, setClients] = useState([]), [selected, select] = useState(0), [message, setMessage] = useState("Isolated clients are not connected."), [busy, setBusy] = useState(false);
  const current = useRef([]), mounted = useRef(true), lock = useRef(false);
  current.current = clients;
  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener("change", state => { if (state === "active") current.current.forEach(client => client.coordinator.foreground().catch(() => {})); });
    return () => {
      mounted.current = false; subscription.remove();
      current.current.forEach(client => { client.coordinator.dispose(); client.environment.close().catch(() => {}); });
      delete globalThis.__bardHighlightSyncTest;
    };
  }, []);
  async function perform(action) {
    if (!allowed || lock.current) return;
    lock.current = true; setBusy(true);
    try { await action(); }
    catch (error) { if (mounted.current) setMessage(`Test operation failed: ${error.code || error.message}. No live backend fallback.`); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function connect() {
    const made = [];
    try {
      for (let index = 0; index < 2; index++) {
        const environment = await createHighlightSyncEmulatorEnvironment({ host: "10.0.2.2", appName: `android-${index + 1}` });
        const manager = createHighlightSyncStoreManager(AsyncStorage, { namespace: `@bard-test/android-sync-client-${index + 1}` });
        const coordinator = createHighlightSyncCoordinator({ manager, transport: createFirestoreHighlightSyncTransport({ environment }), resolveCanonical: canonicalFor });
        const preferences = createReaderPreferenceStore(createIsolatedHighlightStorage(AsyncStorage, `@bard-test/android-sync-preferences-${index + 1}`));
        made.push({ mode: "emulator", auth: environment.auth, manager, coordinator, environment, preferences });
        await environment.signInSynthetic({ email: "android-a@bard-sync.test", password: "synthetic-only-password" });
        await coordinator.setOwner(environment.auth.currentUser.uid);
      }
      if (!mounted.current) throw new Error("Test entry closed");
      current.current = made; setClients(made); setMessage("Two isolated clients connected to demo-bard-highlights-sync. Production sync is disabled.");
      globalThis.__bardHighlightSyncTest = {
        // Deliberate synthetic test boundary, never mounted in the normal app.
        clients: made, canonicalFor,
        snapshot: () => made.map((client, index) => {
          const uid = client.auth.currentUser?.uid;
          const state = uid ? client.manager.forWork({ uid, canonical: canonicalFor("a-midsummer-nights-dream") }).getSnapshot() : null;
          return { client: index + 1, records: state?.records.map(record => ({ id: record.id, colorId: record.colorId, start: record.selectionRef.start, end: record.selectionRef.end })), syncSummary: state?.syncSummary, error: client.coordinator.getSnapshot().error?.code || null };
        }),
      };
    } catch (error) { for (const client of made) { client.coordinator.dispose(); await client.environment.close(); } throw error; }
  }
  const client = clients[selected];
  const button = (label, action, disabled = false) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} disabled={busy || disabled} onPress={() => perform(action)} style={{ padding: 16, marginVertical: 4, borderWidth: 1, borderRadius: 8, opacity: busy || disabled ? 0.5 : 1 }}><Text>{label}</Text></Pressable>;
  function Home({ navigation }) {
    return <SafeAreaView style={{ flex: 1 }}><ScrollView contentContainerStyle={{ padding: 20 }}>
      <Text accessibilityRole="header" style={{ fontSize: 23 }}>Highlight synchronization test</Text>
      <Text>Demo emulators only · Auth 9199 · Firestore 8180. Normal accounts, highlights and preferences are not used.</Text>
      <Text accessibilityLiveRegion="polite" style={{ marginVertical: 12 }}>{message}</Text>
      {!clients.length && button("Connect isolated clients", connect)}
      {!!clients.length && <View>
        <Text>Selected client {selected + 1}. Local stores are separate.</Text>
        {button("Use client 1", async () => select(0))}{button("Use client 2", async () => select(1))}
        {button("Library test reader", async () => navigation.navigate("Library", { id: "a-midsummer-nights-dream" }))}
        {button("Course test reader", async () => navigation.navigate("Course", { id: "a-midsummer-nights-dream" }))}
        {button("Tempest test reader", async () => navigation.navigate("Library", { id: "the-tempest" }))}
        {button("Pause selected test network", async () => { await client.environment.setNetworkEnabled(false); setMessage("Selected test transport and listener are paused. Local saves remain available."); })}
        {button("Resume selected test network", async () => { await client.environment.setNetworkEnabled(true); await client.coordinator.retry(); setMessage("Selected test network resumed."); })}
        {button("Retry selected synchronization", async () => { await client.coordinator.retry(); setMessage("Retry finished; inspect the highlight status."); })}
        {button("Use synthetic account B", async () => { await client.environment.signInSynthetic({ email: "android-b@bard-sync.test", password: "synthetic-only-password" }); await client.coordinator.setOwner(client.auth.currentUser.uid); setMessage("Selected client now uses isolated synthetic account B."); })}
        {button("Use synthetic account A", async () => { await client.environment.signInSynthetic({ email: "android-a@bard-sync.test", password: "synthetic-only-password" }); await client.coordinator.setOwner(client.auth.currentUser.uid); setMessage("Selected client now uses isolated synthetic account A."); })}
      </View>}
    </ScrollView></SafeAreaView>;
  }
  if (!allowed) return <SafeAreaProvider><SafeAreaView><Text>Isolated highlight test entry is disabled. No backend was initialized.</Text></SafeAreaView></SafeAreaProvider>;
  return <SafeAreaProvider><NavigationContainer><Stack.Navigator>
    <Stack.Screen name="Sync test" component={Home} />
    <Stack.Screen name="Library">{() => client ? <MITFullPlayScreen highlightRuntime={client} /> : <Text>Connect isolated clients before opening a reader.</Text>}</Stack.Screen>
    <Stack.Screen name="Course">{() => client ? <ReadFolger highlightRuntime={client} /> : <Text>Connect isolated clients before opening a reader.</Text>}</Stack.Screen>
  </Stack.Navigator></NavigationContainer></SafeAreaProvider>;
}
