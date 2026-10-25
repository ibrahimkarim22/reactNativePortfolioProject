// Deliberate source-controlled activation boundary. No environment/test flag
// enables real writes. Deployment + activation + real migration need approval.
const PRODUCTION_HIGHLIGHT_SYNC = Object.freeze({
  enabled: true,
  storageMode: 'durable-v2',
  migrationApproved: true,
  projectId: 'shakespearenativeapp',
  databaseId: '(default)',
  approvedRulesetName: 'projects/shakespearenativeapp/rulesets/77d48f22-3b40-4c5b-8db5-8c3d31c67242',
});
const environments = new WeakSet();
const fail = code => Object.assign(new Error(code), { code });
function validateProductionHighlightBindings({ app, auth, db } = {}) {
  let data;
  try { data = db?.toJSON?.(); } catch (_) { throw fail('SYNC_PRODUCTION_ENVIRONMENT_REQUIRED'); }
  if (app?.options?.projectId !== PRODUCTION_HIGHLIGHT_SYNC.projectId || auth?.app !== app || db?.app !== app
      || auth?.emulatorConfig || data?.databaseId?.projectId !== PRODUCTION_HIGHLIGHT_SYNC.projectId
      || data?.databaseId?.database !== PRODUCTION_HIGHLIGHT_SYNC.databaseId
      || data?.settings?.host !== 'firestore.googleapis.com' || data?.settings?.ssl !== true) {
    throw fail('SYNC_PRODUCTION_ENVIRONMENT_REQUIRED');
  }
  return true;
}
function assertProductionHighlightEnvironment(environment) {
  if (!environment || !environments.has(environment)) throw fail('SYNC_PRODUCTION_ENVIRONMENT_REQUIRED');
  return environment;
}
function createProductionHighlightEnvironment(options = {}) {
  // Check BEFORE any require of the normal Firebase singleton or storage.
  if (options.configuration && options.configuration !== PRODUCTION_HIGHLIGHT_SYNC
      || !PRODUCTION_HIGHLIGHT_SYNC.enabled || PRODUCTION_HIGHLIGHT_SYNC.storageMode !== 'durable-v2'
      || !PRODUCTION_HIGHLIGHT_SYNC.migrationApproved
      || typeof PRODUCTION_HIGHLIGHT_SYNC.approvedRulesetName !== 'string'
      || !PRODUCTION_HIGHLIGHT_SYNC.approvedRulesetName.startsWith(`projects/${PRODUCTION_HIGHLIGHT_SYNC.projectId}/rulesets/`)) {
    throw fail('SYNC_PRODUCTION_DISABLED');
  }
  const { FIREBASE_APP: app, FIREBASE_AUTH: auth, FIRESTORE_DB: db } = require('../firebaseConfig');
  const sdk = require('firebase/firestore');
  validateProductionHighlightBindings({ app, auth, db });
  const environment = Object.freeze({ projectId: PRODUCTION_HIGHLIGHT_SYNC.projectId, app, auth, db, sdk,
    assertReady: async () => {
      if (!PRODUCTION_HIGHLIGHT_SYNC.enabled) throw fail('SYNC_PRODUCTION_DISABLED');
      validateProductionHighlightBindings({ app, auth, db });
      if (!auth.currentUser?.uid) throw fail('unauthenticated');
      return true;
    } });
  environments.add(environment);
  return environment;
}
function createProductionHighlightSyncTransport({ environment } = {}) {
  const verified = assertProductionHighlightEnvironment(environment);
  return require('./highlightSyncFirestore').createHighlightSyncTransportForEnvironment(verified);
}
module.exports = { PRODUCTION_HIGHLIGHT_SYNC, createProductionHighlightEnvironment,
  assertProductionHighlightEnvironment, validateProductionHighlightBindings, createProductionHighlightSyncTransport };
