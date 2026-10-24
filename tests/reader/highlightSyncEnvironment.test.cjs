const assert = require('node:assert/strict');
const test = require('node:test');
const { createHighlightSyncEmulatorEnvironment, assertIsolatedHighlightEnvironment, createIsolatedHighlightStorage } = require('../../reader/highlightSyncEnvironment');

function fixture() {
  const calls = [], app = { name: 'test', options: { projectId: 'demo-bard-highlights-sync' } };
  const auth = { app }, db = { app };
  const firebaseSdk = { app: { initializeApp: (config, name) => { calls.push(['app', config, name]); return app; }, deleteApp: async () => calls.push(['delete']) },
    auth: { inMemoryPersistence: {}, initializeAuth: () => auth, connectAuthEmulator: (_, url) => calls.push(['auth', url]), createUserWithEmailAndPassword: async () => {}, signInWithEmailAndPassword: async () => {}, signOut: async () => {} },
    firestore: { initializeFirestore: () => db, connectFirestoreEmulator: (_, host, port) => calls.push(['firestore', host, port]), terminate: async () => {}, disableNetwork: async () => calls.push(['disable']), enableNetwork: async () => calls.push(['enable']) } };
  const fetchImpl = async url => { calls.push(['fetch', url]); return { ok: true }; };
  return { calls, firebaseSdk, fetchImpl };
}
test('fixed demo clients connect both emulators before any health request and remain branded', async () => {
  const f = fixture(), env = await createHighlightSyncEmulatorEnvironment({ host: '10.0.2.2', appName: 'android-fixture', ...f });
  assert.equal(env.projectId, 'demo-bard-highlights-sync');
  assert.deepEqual(f.calls.slice(1, 3), [['auth', 'http://10.0.2.2:9199'], ['firestore', '10.0.2.2', 8180]]);
  assert.ok(f.calls.slice(3).every(call => call[0] === 'fetch'));
  assert.equal(assertIsolatedHighlightEnvironment(env), env);
  assert.throws(() => assertIsolatedHighlightEnvironment({ ...env }), { code: 'SYNC_ENVIRONMENT_REQUIRED' });
  await env.close();
  await assert.rejects(env.assertReady(), { code: 'SYNC_EMULATOR_UNAVAILABLE' });
});
test('rejects nonlocal hosts, alternate project/ports and unavailable emulators without fallback', async () => {
  for (const options of [{ host: 'firebase.googleapis.com' }, { projectId: 'bard-production' }, { authPort: 9099 }, { firestorePort: 8080 }]) {
    const f = fixture();
    await assert.rejects(createHighlightSyncEmulatorEnvironment({ ...f, ...options }), { code: 'SYNC_ENVIRONMENT_REQUIRED' });
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  await assert.rejects(createHighlightSyncEmulatorEnvironment({ ...f, fetchImpl: async () => { throw new Error('offline'); } }), { code: 'SYNC_EMULATOR_UNAVAILABLE' });
  assert.ok(f.calls.some(call => call[0] === 'delete'));
});
test('synthetic login only and a separate storage namespace protect the normal session/data', async () => {
  const f = fixture(), env = await createHighlightSyncEmulatorEnvironment(f);
  await assert.rejects(env.signInSynthetic({ email: 'real@example.com', password: 'fixture-password' }), { code: 'SYNC_SYNTHETIC_ACCOUNT_REQUIRED' });
  const data = new Map([['real-key', 'untouched']]);
  const base = { getAllKeys: async () => [...data.keys()], getItem: async k => data.get(k) ?? null, setItem: async (k, v) => data.set(k, v), removeItem: async k => data.delete(k) };
  assert.throws(() => createIsolatedHighlightStorage(base, '@bard/reader-highlights:v1'), { code: 'SYNC_TEST_STORAGE_REQUIRED' });
  const storage = createIsolatedHighlightStorage(base, '@bard-test/client-a');
  await storage.setItem('fixture', 'test');
  assert.deepEqual(await storage.getAllKeys(), ['fixture']);
  await storage.removeItem('fixture');
  assert.deepEqual([...data], [['real-key', 'untouched']]);
  await env.close();
});
test('controlled test-network pause gates transaction readiness before RPC and resumes only after SDK enable', async () => {
  const f = fixture(), env = await createHighlightSyncEmulatorEnvironment(f);
  await env.setNetworkEnabled(false);
  const count = f.calls.length;
  await assert.rejects(env.assertReady(), { code: 'SYNC_EMULATOR_NETWORK_DISABLED' });
  assert.equal(f.calls.length, count, 'paused readiness does not even contact a health endpoint');
  assert.deepEqual(f.calls.at(-1), ['disable']);
  await env.setNetworkEnabled(true); assert.equal(await env.assertReady(), true);
  assert.ok(f.calls.some(call => call[0] === 'enable'));
  await env.close();
});
test('a late SDK enable cannot reopen the network gate after a newer pause', async () => {
  const f = fixture(); let release;
  const gate = new Promise(resolve => { release = resolve; });
  f.firebaseSdk.firestore.enableNetwork = async () => { f.calls.push(['enable-start']); await gate; f.calls.push(['enable-finish']); };
  const env = await createHighlightSyncEmulatorEnvironment(f);
  await env.setNetworkEnabled(false);
  const enabling = env.setNetworkEnabled(true);
  await new Promise(resolve => setImmediate(resolve));
  const pausedAgain = env.setNetworkEnabled(false);
  await assert.rejects(env.assertReady(), { code: 'SYNC_EMULATOR_NETWORK_DISABLED' });
  release(); await enabling; await pausedAgain;
  await assert.rejects(env.assertReady(), { code: 'SYNC_EMULATOR_NETWORK_DISABLED' });
  assert.deepEqual(f.calls.filter(call => /enable|disable/.test(call[0])).map(call => call[0]), ['disable', 'enable-start', 'enable-finish', 'disable']);
  await env.close();
});
