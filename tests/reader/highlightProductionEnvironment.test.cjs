const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { PRODUCTION_HIGHLIGHT_SYNC, validateProductionHighlightBindings } = require('../../reader/highlightProductionEnvironment');
const activeConfiguration = Object.freeze({ enabled: true, storageMode: 'durable-v2', migrationApproved: true,
  projectId: 'shakespearenativeapp', databaseId: '(default)',
  approvedRulesetName: 'projects/shakespearenativeapp/rulesets/77d48f22-3b40-4c5b-8db5-8c3d31c67242' });

function bindings() {
  const app = { options: { projectId: 'shakespearenativeapp' } };
  const auth = { app, currentUser: { uid: 'fixture-owner' }, emulatorConfig: null };
  const data = { databaseId: { projectId: 'shakespearenativeapp', database: '(default)' }, settings: { host: 'firestore.googleapis.com', ssl: true } };
  const db = { app, toJSON: () => data };
  return { app, auth, db, data };
}
// Compile only an in-memory configuration variant. Every external dependency is
// intercepted: enabled factory tests cannot initialize a real Firebase client.
function loadEnvironment(configuration = activeConfiguration) {
  const filename = path.resolve(__dirname, '../../reader/highlightProductionEnvironment.js');
  const original = fs.readFileSync(filename, 'utf8');
  const declaration = /const PRODUCTION_HIGHLIGHT_SYNC = Object\.freeze\(\{[\s\S]*?\}\);/;
  assert.equal([...original.matchAll(new RegExp(declaration.source, 'g'))].length, 1);
  const source = original.replace(declaration, `const PRODUCTION_HIGHLIGHT_SYNC = Object.freeze(${JSON.stringify(configuration)});`);
  const fixture = bindings(), sdk = {}, imports = [], transports = [];
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded.require = name => {
    imports.push(name);
    if (name === '../firebaseConfig') return { FIREBASE_APP: fixture.app, FIREBASE_AUTH: fixture.auth, FIRESTORE_DB: fixture.db };
    if (name === 'firebase/firestore') return sdk;
    if (name === './highlightSyncFirestore') return { createHighlightSyncTransportForEnvironment(environment) {
      transports.push(environment); return { fixtureTransport: true };
    } };
    throw new Error('Unexpected dependency in isolated factory test: ' + name);
  };
  loaded._compile(source, filename);
  return { api: loaded.exports, fixture, sdk, imports, transports };
}

test('production activation is frozen and pinned to the verified project, database and ruleset', () => {
  assert.deepEqual(PRODUCTION_HIGHLIGHT_SYNC, activeConfiguration);
  assert.ok(Object.isFrozen(PRODUCTION_HIGHLIGHT_SYNC));
});

test('disabled, paused and incomplete activation states reject before importing Firebase', () => {
  for (const configuration of [
    { ...activeConfiguration, enabled: false, storageMode: 'legacy-v1', migrationApproved: false, approvedRulesetName: null },
    { ...activeConfiguration, enabled: false },
    { ...activeConfiguration, storageMode: 'legacy-v1' },
    { ...activeConfiguration, migrationApproved: false },
    { ...activeConfiguration, approvedRulesetName: null },
    { ...activeConfiguration, approvedRulesetName: 'projects/another-project/rulesets/fixture' },
  ]) {
    const f = loadEnvironment(configuration);
    assert.throws(() => f.api.createProductionHighlightEnvironment(), { code: 'SYNC_PRODUCTION_DISABLED' });
    assert.deepEqual(f.imports, []);
  }
});

test('copied configuration and unbranded environments cannot bypass the production boundary', () => {
  const f = loadEnvironment();
  assert.throws(() => f.api.createProductionHighlightEnvironment({ configuration: { ...f.api.PRODUCTION_HIGHLIGHT_SYNC } }), { code: 'SYNC_PRODUCTION_DISABLED' });
  for (const environment of [undefined, { projectId: 'shakespearenativeapp' }, { projectId: 'demo-bard-highlights-sync' }]) {
    assert.throws(() => f.api.assertProductionHighlightEnvironment(environment), { code: 'SYNC_PRODUCTION_ENVIRONMENT_REQUIRED' });
    assert.throws(() => f.api.createProductionHighlightSyncTransport({ environment }), { code: 'SYNC_PRODUCTION_ENVIRONMENT_REQUIRED' });
  }
  assert.deepEqual(f.imports, []);
});

test('enabled construction delegates only a privately branded environment to the existing transport', async () => {
  const f = loadEnvironment();
  const environment = f.api.createProductionHighlightEnvironment({ configuration: f.api.PRODUCTION_HIGHLIGHT_SYNC });
  assert.ok(Object.isFrozen(environment));
  assert.equal(f.api.assertProductionHighlightEnvironment(environment), environment);
  assert.equal(environment.app, f.fixture.app);
  assert.equal(environment.auth, f.fixture.auth);
  assert.equal(environment.db, f.fixture.db);
  assert.equal(environment.sdk, f.sdk);
  assert.equal(await environment.assertReady(), true);
  assert.deepEqual(f.api.createProductionHighlightSyncTransport({ environment }), { fixtureTransport: true });
  assert.deepEqual(f.transports, [environment]);
  assert.deepEqual(f.imports, ['../firebaseConfig', 'firebase/firestore', './highlightSyncFirestore']);
  assert.throws(() => f.api.assertProductionHighlightEnvironment({ ...environment }), { code: 'SYNC_PRODUCTION_ENVIRONMENT_REQUIRED' });
  f.fixture.auth.currentUser = null;
  await assert.rejects(environment.assertReady(), { code: 'unauthenticated' });
  f.fixture.auth.currentUser = { uid: 'fixture-owner' };
  f.fixture.data.settings.host = '127.0.0.1:8180';
  await assert.rejects(environment.assertReady(), { code: 'SYNC_PRODUCTION_ENVIRONMENT_REQUIRED' });
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
