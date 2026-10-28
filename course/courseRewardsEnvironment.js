const { DEMO_PROJECT_ID, createHighlightSyncEmulatorEnvironment, assertIsolatedHighlightEnvironment } = require('../reader/highlightSyncEnvironment');
const { createFirestoreCourseProgressTransport } = require('./firestoreCourseProgress');
const { createCourseProgressSession } = require('./courseProgressSession');
const { bindCourseRuntime } = require('./bindCourseRuntime');

const modes = new Set(['pass', 'save-failed', 'replay', 'incorrect']);
let sequence = 0;

// This boundary can create only short-lived synthetic accounts in the fixed
// local demo backend. It never imports the normal Firebase singleton or store.
async function createCourseRewardsScenario(mode, { host = '10.0.2.2' } = {}) {
  if (!modes.has(mode)) throw new Error('Unknown rewards test scenario.');
  const name = 'course-rewards-' + Date.now().toString(36) + '-' + ++sequence;
  const environment = assertIsolatedHighlightEnvironment(await createHighlightSyncEmulatorEnvironment({
    host, projectId: DEMO_PROJECT_ID, appName: name,
  }));
  let source = null, disposed = false, saveCalls = 0, confirmedSaves = 0;
  try {
    if (environment.projectId !== DEMO_PROJECT_ID) throw new Error('Isolated rewards backend required.');
    await environment.signInSynthetic({ email: name + '@bard-sync.test', password: 'synthetic-course-rewards-only' });
    await environment.assertReady();
    const uid = environment.auth.currentUser?.uid;
    if (!uid) throw new Error('Synthetic sign-in is unavailable.');
    const sdk = environment.sdk, profile = sdk.doc(environment.db, 'users', uid);
    const previous = await sdk.getDocFromServer(profile);
    if (previous.exists()) throw new Error('A fresh isolated rewards profile is required.');
    await sdk.setDoc(profile, { completedLevel: mode === 'replay' ? 1 : 0 });
    const transport = createFirestoreCourseProgressTransport({ db: environment.db,
      doc: sdk.doc, onSnapshot: sdk.onSnapshot, runTransaction: sdk.runTransaction, getDocFromServer: sdk.getDocFromServer });
    source = createCourseProgressSession({
      getUid: () => environment.auth.currentUser?.uid || null,
      subscribeAuth: notify => environment.authSdk.onAuthStateChanged(environment.auth, user => notify(user?.uid || null)),
      transport: {
        observe: transport.observe,
        read: transport.read,
        async save(ownerUid, level, isCurrent) {
          saveCalls++;
          await environment.assertReady();
          if (disposed || environment.auth.currentUser?.uid !== uid || ownerUid !== uid || isCurrent() !== true) {
            throw Object.assign(new Error('Test account changed.'), { code: 'COURSE_CANCELLED' });
          }
          // Only the first test transport call is interrupted. Retry invokes
          // the actual Firestore transaction and its normal acknowledgement.
          if (mode === 'save-failed' && saveCalls === 1) {
            throw Object.assign(new Error('Isolated test save interrupted.'), { code: 'unavailable' });
          }
          const result = await transport.save(ownerUid, level, isCurrent);
          confirmedSaves++;
          return result;
        },
      },
    });
    source.start();
    await source.refresh();
    if (source.getSnapshot().status !== 'ready') throw new Error('Isolated account progress could not be confirmed.');
    const runtime = bindCourseRuntime(source, source.getOwner());
    return Object.freeze({ mode, environment, source, runtime,
      getStats: () => ({ mode, saveCalls, confirmedSaves, completedLevel: source.getSnapshot().completedLevel }),
      async dispose() {
        if (disposed) return;
        disposed = true;
        source.stop();
        await environment.close();
      },
    });
  } catch (error) {
    disposed = true;
    source?.stop();
    await environment.close();
    throw error;
  }
}

module.exports = { createCourseRewardsScenario };
