// This factory is deliberately separate from Bard's normal Firebase singleton.
// No caller can select a live project or silently fall back from an emulator.
const DEMO_PROJECT_ID = 'demo-bard-highlights-sync';
const AUTH_PORT = 9199;
const FIRESTORE_PORT = 8180;
const HOSTS = new Set(['127.0.0.1', 'localhost', '10.0.2.2']);
const environments = new WeakSet();
let sequence = 0;
function failure(code, cause) { return Object.assign(new Error(code), { code, ...(cause ? { cause } : {}) }); }
function assertIsolatedHighlightEnvironment(environment) {
  if (!environment || !environments.has(environment)) throw failure('SYNC_ENVIRONMENT_REQUIRED');
  return environment;
}
async function createHighlightSyncEmulatorEnvironment(options = {}) {
  const host = options.host || '127.0.0.1';
  if (!HOSTS.has(host) || (options.projectId !== undefined && options.projectId !== DEMO_PROJECT_ID)
      || (options.authPort !== undefined && options.authPort !== AUTH_PORT)
      || (options.firestorePort !== undefined && options.firestorePort !== FIRESTORE_PORT)) throw failure('SYNC_ENVIRONMENT_REQUIRED');
  const sdk = options.firebaseSdk || { app: require('firebase/app'), auth: require('firebase/auth'), firestore: require('firebase/firestore') };
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw failure('SYNC_EMULATOR_UNAVAILABLE');
  const suffix = options.appName || options.appNameSuffix || 'client-' + ++sequence;
  if (typeof suffix !== 'string' || !/^[A-Za-z0-9_-]{1,96}$/.test(suffix)) throw failure('SYNC_ENVIRONMENT_REQUIRED');
  const app = sdk.app.initializeApp({ projectId: DEMO_PROJECT_ID, apiKey: 'demo-bard-highlights-sync-key', authDomain: DEMO_PROJECT_ID + '.invalid', appId: '1:1234567890:web:demo-bard-highlights-sync' }, 'bard-highlights-sync-' + suffix);
  let auth, db, closed = false, networkEnabled = true, networkRevision = 0, networkTail = Promise.resolve();
  try {
    auth = sdk.auth.initializeAuth(app, { persistence: sdk.auth.inMemoryPersistence });
    sdk.auth.connectAuthEmulator(auth, 'http://' + host + ':' + AUTH_PORT, { disableWarnings: true });
    db = sdk.firestore.initializeFirestore(app, { experimentalForceLongPolling: true });
    sdk.firestore.connectFirestoreEmulator(db, host, FIRESTORE_PORT);
  } catch (cause) { await sdk.app.deleteApp(app); throw failure('SYNC_ENVIRONMENT_REQUIRED', cause); }
  async function assertReady() {
    if (closed || app.options.projectId !== DEMO_PROJECT_ID || auth.app !== app || db.app !== app) throw failure('SYNC_EMULATOR_UNAVAILABLE');
    if (!networkEnabled) throw failure('SYNC_EMULATOR_NETWORK_DISABLED');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 3000);
    try {
      for (const port of [AUTH_PORT, FIRESTORE_PORT]) {
        if (!networkEnabled) throw failure('SYNC_EMULATOR_NETWORK_DISABLED');
        const response = await fetchImpl('http://' + host + ':' + port + '/', { signal: controller.signal });
        if (!response || !response.ok) throw new Error('Emulator health failed');
      }
    } catch (cause) { if (cause.code === 'SYNC_EMULATOR_NETWORK_DISABLED') throw cause; throw failure('SYNC_EMULATOR_UNAVAILABLE', cause); }
    finally { clearTimeout(timer); }
    if (!networkEnabled) throw failure('SYNC_EMULATOR_NETWORK_DISABLED');
    return true;
  }
  function setNetworkEnabled(enabled) {
    if (typeof enabled !== 'boolean') return Promise.reject(failure('SYNC_ENVIRONMENT_REQUIRED'));
    if (closed) return Promise.reject(failure('SYNC_EMULATOR_UNAVAILABLE'));
    const revision = ++networkRevision;
    // This is an explicit test transport gate, not a claim that disableNetwork
    // cancels transaction RPCs on every platform or changes the device radio.
    networkEnabled = false;
    const result = networkTail.then(async () => {
      if (closed) throw failure('SYNC_EMULATOR_UNAVAILABLE');
      await sdk.firestore[enabled ? 'enableNetwork' : 'disableNetwork'](db);
      if (revision === networkRevision && !closed) networkEnabled = enabled;
      return revision === networkRevision && networkEnabled;
    });
    networkTail = result.catch(() => {});
    return result;
  }
  async function close() {
    if (closed) return;
    closed = true;
    try { await sdk.firestore.terminate(db); }
    finally { await sdk.app.deleteApp(app); }
  }
  const environment = Object.freeze({ projectId: DEMO_PROJECT_ID, host, app, auth, db, sdk: sdk.firestore, authSdk: sdk.auth, assertReady, setNetworkEnabled, close, dispose: close,
    async signInSynthetic({ email, password, create = true }) {
      if (typeof email !== 'string' || !/^[a-z0-9._+-]+@bard-sync\.test$/.test(email) || typeof password !== 'string' || password.length < 8) throw failure('SYNC_SYNTHETIC_ACCOUNT_REQUIRED');
      await assertReady();
      if (create) {
        try { return await sdk.auth.createUserWithEmailAndPassword(auth, email, password); }
        catch (cause) { if (cause.code !== 'auth/email-already-in-use') throw cause; }
      }
      return sdk.auth.signInWithEmailAndPassword(auth, email, password);
    } });
  environments.add(environment);
  try { await assertReady(); return environment; }
  catch (cause) { await close(); throw cause; }
}
function createIsolatedHighlightStorage(storage, namespace) {
  if (!storage || typeof namespace !== 'string' || !/^@bard-test\/[A-Za-z0-9_-]{1,96}$/.test(namespace)) throw failure('SYNC_TEST_STORAGE_REQUIRED');
  const prefix = namespace + '/';
  const key = value => { if (typeof value !== 'string' || !value.length) throw failure('SYNC_TEST_STORAGE_REQUIRED'); return prefix + value; };
  return Object.freeze({
    async getAllKeys() { return (await storage.getAllKeys()).filter(value => value.startsWith(prefix)).map(value => value.slice(prefix.length)); },
    getItem: value => storage.getItem(key(value)),
    setItem: (value, data) => storage.setItem(key(value), data),
    removeItem: value => storage.removeItem(key(value)),
  });
}
module.exports = { DEMO_PROJECT_ID, AUTH_PORT, FIRESTORE_PORT, createHighlightSyncEmulatorEnvironment, createHighlightSyncEnvironment: createHighlightSyncEmulatorEnvironment, assertIsolatedHighlightEnvironment, createIsolatedHighlightStorage };
