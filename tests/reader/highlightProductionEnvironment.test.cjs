const test = require('node:test');
const assert = require('node:assert/strict');
const { PRODUCTION_HIGHLIGHT_SYNC, createProductionHighlightEnvironment, assertProductionHighlightEnvironment,
  validateProductionHighlightBindings } = require('../../reader/highlightProductionEnvironment');

function bindings() {
  const app = { options: { projectId: 'shakespearenativeapp' } };
  const auth = { app, currentUser: { uid: 'fixture-owner' }, emulatorConfig: null };
  const data = { databaseId: { projectId: 'shakespearenativeapp', database: '(default)' }, settings: { host: 'firestore.googleapis.com', ssl: true } };
  const db = { app, toJSON: () => data };
  return { app, auth, db, data };
}
test('production is pinned and disabled before importing Firebase or touching real storage', () => {
  assert.equal(PRODUCTION_HIGHLIGHT_SYNC.enabled, false);
  assert.equal(PRODUCTION_HIGHLIGHT_SYNC.storageMode, 'legacy-v1');
  assert.equal(PRODUCTION_HIGHLIGHT_SYNC.migrationApproved, false);
  assert.equal(PRODUCTION_HIGHLIGHT_SYNC.projectId, 'shakespearenativeapp');
  assert.equal(PRODUCTION_HIGHLIGHT_SYNC.databaseId, '(default)');
  assert.equal(PRODUCTION_HIGHLIGHT_SYNC.approvedRulesetName, null);
  assert.ok(Object.isFrozen(PRODUCTION_HIGHLIGHT_SYNC));
  assert.throws(() => createProductionHighlightEnvironment(), { code: 'SYNC_PRODUCTION_DISABLED' });
  assert.throws(() => createProductionHighlightEnvironment({ configuration: { ...PRODUCTION_HIGHLIGHT_SYNC, enabled: true } }), { code: 'SYNC_PRODUCTION_DISABLED' });
  assert.throws(() => assertProductionHighlightEnvironment({ projectId: 'shakespearenativeapp' }), { code: 'SYNC_PRODUCTION_ENVIRONMENT_REQUIRED' });
});
test('binding validation accepts only the intended same-app default database and live endpoints', () => {
  assert.equal(validateProductionHighlightBindings(bindings()), true);
  for (const change of [
    f => { f.app.options.projectId = 'demo-bard-highlights-sync'; },
    f => { f.auth.app = { options: { projectId: 'shakespearenativeapp' } }; },
    f => { f.db.app = {}; },
    f => { f.data.databaseId.database = 'alternate'; },
    f => { f.data.databaseId.projectId = 'other-project'; },
    f => { f.data.settings.host = '127.0.0.1:8180'; },
    f => { f.data.settings.ssl = false; },
    f => { f.auth.emulatorConfig = { host: 'localhost' }; },
    f => { f.db.toJSON = undefined; },
  ]) {
    const fixture = bindings(); change(fixture);
    assert.throws(() => validateProductionHighlightBindings(fixture), { code: 'SYNC_PRODUCTION_ENVIRONMENT_REQUIRED' });
  }
});
