const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const adapterPath = path.resolve(__dirname, '../../reader/highlightSyncFirestore.js');
// The real environment is privately branded and opens only isolated emulators.
// These focused transaction-boundary tests substitute that environment boundary;
// separate emulator acceptance uses the real factory and actual rule clients.
function loadAdapter() {
  if (!fs.existsSync(adapterPath)) return {};
  const loaded = new Module(adapterPath, module); loaded.filename = adapterPath; loaded.paths = Module._nodeModulePaths(path.dirname(adapterPath));
  const originalRequire = loaded.require.bind(loaded);
  loaded.require = name => name === './highlightSyncEnvironment' ? { assertIsolatedHighlightEnvironment(env) {
    if (env?.projectId !== 'demo-bard-highlights-sync') throw Object.assign(new Error('Not isolated.'), { code: 'SYNC_ISOLATION_REQUIRED' });
    return env;
  } } : originalRequire(name);
  loaded._compile(fs.readFileSync(adapterPath, 'utf8'), adapterPath); return loaded.exports;
}
const adapter = loadAdapter();
const version = 'a'.repeat(64), selectionRef = { kind: 'text-range', workId: 'hamlet', contentVersion: version, canonicalTextVersion: '1', offsetUnit: 'utf16', start: 0, end: 4,
  startRef: { textId: 'a', sectionId: 's', offsetUtf16: 0 }, endRef: { textId: 'a', sectionId: 's', offsetUtf16: 4 }, exact: 'Echo', prefix: '', suffix: '' };
const operation = { schemaVersion: 1, operationId: 'op-1', uid: 'A', workId: 'hamlet', cloudKey: `h1_${version}_1_0_4`, kind: 'create', selectionRef, colorId: 'sage', generation: 1, baseRevision: 0 };
const stamp = { seconds: 100, nanoseconds: 0 };
function fixture() {
  const records = new Map(), committed = [], pending = [], env = { projectId: 'demo-bard-highlights-sync', db: { app: { options: { projectId: 'demo-bard-highlights-sync' } } }, auth: { currentUser: { uid: 'A' } }, ready: true, retries: 1, changeDuringRead: null, next: null, failure: null, transactionCalls: 0, denyBeforeCommit: null };
  const snapshot = key => ({ exists: () => records.has(key), data: () => structuredClone(records.get(key)) });
  env.assertReady = async () => { if (!env.ready) throw Object.assign(new Error('Emulator unavailable.'), { code: 'SYNC_EMULATOR_UNAVAILABLE' }); };
  env.sdk = {
    doc: (_db, ...parts) => parts.join('/'), collection: (_db, ...parts) => parts.join('/'), serverTimestamp: () => stamp,
    async runTransaction(_db, callback) {
      env.transactionCalls++;
      let result;
      for (let attempt = 0; attempt < env.retries; attempt += 1) {
        pending.length = 0;
        result = await callback({ get: async key => { if (env.changeDuringRead) { const change = env.changeDuringRead; env.changeDuringRead = null; change(); } return snapshot(key); },
          set: (key, value) => pending.push([key, structuredClone(value)]) });
      }
      if (env.denyBeforeCommit) {
        const update = env.denyBeforeCommit; env.denyBeforeCommit = null; pending.length = 0;
        update(records);
        throw Object.assign(new Error('Write prestate changed before rules evaluation.'), { code: 'permission-denied' });
      }
      for (const [key, value] of pending) records.set(key, value);
      committed.push(...pending);
      if (env.failure === 'lost-ack') { env.failure = null; throw Object.assign(new Error('Lost acknowledgement.'), { code: 'unavailable' }); }
      return result;
    },
    async getDocFromServer(key) { return snapshot(key); },
    query: (collection, ...constraints) => ({ collection, constraints }), limit: value => ({ limit: value }),
    onSnapshot(query, next, error) { env.query = query; env.next = next; env.error = error; return () => { env.unsubscribed = true; }; },
  };
  return { env, records, committed };
}
function transport(env) { return adapter.createFirestoreHighlightSyncTransport({ environment: env }); }

test('transport refuses a non-demo environment and fails closed when either isolated service is unavailable', async () => {
  assert.equal(typeof adapter.createFirestoreHighlightSyncTransport, 'function');
  const { env, committed } = fixture();
  assert.throws(() => transport({ ...env, projectId: 'bard-production' }), { code: 'SYNC_ISOLATION_REQUIRED' });
  env.ready = false;
  await assert.rejects(transport(env).commit(operation), { code: 'SYNC_EMULATOR_UNAVAILABLE' }); assert.equal(committed.length, 0);
});

test('retryable transaction callback produces one atomic record/receipt/accounting commit with a stable identity', async () => {
  assert.equal(typeof adapter.createFirestoreHighlightSyncTransport, 'function');
  const { env, records, committed } = fixture(); env.retries = 3;
  const result = await transport(env).commit(operation);
  assert.equal(records.size, 3); assert.equal(committed.length, 3);
  assert.equal(result.cloud.lastOperationId, 'op-1'); assert.equal(result.receipt.operationId, 'op-1'); assert.equal(result.metadata.activeCount, 1);
  assert.ok(records.has(`users/A/highlightWorks/hamlet/highlights/h1_${version}_1_0_4`));
  assert.ok(records.has('users/A/highlightWorks/hamlet/operations/op-1'));
});

test('ambiguous commit retries reuse the immutable receipt without adding server revisions', async () => {
  assert.equal(typeof adapter.createFirestoreHighlightSyncTransport, 'function');
  const { env, records, committed } = fixture(), client = transport(env); env.failure = 'lost-ack';
  await assert.rejects(client.commit(operation), { code: 'unavailable' }); assert.equal(records.size, 3);
  const result = await client.commit(operation); assert.equal(result.receipt.resultRevision, 1); assert.equal(committed.length, 3);
});

test('account transitions and owner-generation cancellation block queued or retrying writes', async () => {
  assert.equal(typeof adapter.createFirestoreHighlightSyncTransport, 'function');
  const { env, committed } = fixture(), client = transport(env);
  await assert.rejects(client.commit(operation, { isCurrent: () => false }), { code: 'SYNC_CANCELLED' });
  env.changeDuringRead = () => { env.auth.currentUser = { uid: 'B' }; };
  await assert.rejects(client.commit(operation), { code: 'SYNC_CANCELLED' }); assert.equal(committed.length, 0);
  env.auth.currentUser = { uid: 'A' }; let current = true; env.changeDuringRead = () => { current = false; };
  await assert.rejects(client.commit(operation, { isCurrent: () => current }), { code: 'SYNC_CANCELLED' }); assert.equal(committed.length, 0);
});

test('bounded owner-scoped listener retains full tombstones and rejects oversized or malformed snapshots', async () => {
  assert.equal(typeof adapter.createFirestoreHighlightSyncTransport, 'function');
  const { env } = fixture(), client = transport(env), values = [], errors = [];
  const unsubscribe = client.listen('A', 'hamlet', rows => values.push(rows), error => errors.push(error));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(env.query, { collection: 'users/A/highlightWorks/hamlet/highlights', constraints: [{ limit: 1001 }] });
  const result = require('../../reader/highlightSyncProtocol').planServerMutation({ operation, serverTimestamp: stamp });
  env.next({ docs: [{ id: operation.cloudKey, data: () => result.cloud }] });
  assert.equal(values[0][0].cloud.selectionRef.exact, 'Echo'); assert.equal(values[0][0].cloudKey, operation.cloudKey);
  env.next({ docs: Array.from({ length: 1001 }, () => ({ id: operation.cloudKey, data: () => result.cloud })) });
  assert.equal(errors.at(-1).code, 'SYNC_LISTENER_LIMIT'); assert.equal(values.length, 1);
  env.next({ docs: [{ id: operation.cloudKey, data: () => ({ ...result.cloud, colorId: 'forged' }) }] }); assert.equal(errors.at(-1).code, 'SYNC_INVALID_STATE');
  env.auth.currentUser = { uid: 'B' }; env.next({ docs: [] }); assert.equal(values.length, 1); unsubscribe();
});

test('listener cancelled during asynchronous readiness never attaches or publishes after ownership changes', async () => {
  assert.equal(typeof adapter.createFirestoreHighlightSyncTransport, 'function');
  const { env } = fixture(), client = transport(env), values = [];
  let release; env.assertReady = () => new Promise(resolve => { release = resolve; });
  const stop = client.listen('A', 'hamlet', rows => values.push(rows), () => {}); stop(); release();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(env.next, null); assert.deepEqual(values, []);
});

test('a permission rejection is retried once only after server reads prove a competing transaction advanced the work', async () => {
  const { env, records } = fixture(), client = transport(env);
  env.denyBeforeCommit = data => {
    const concurrent = require('../../reader/highlightSyncProtocol').planServerMutation({ operation: { ...operation, operationId: 'other-device' }, serverTimestamp: stamp });
    data.set(`users/A/highlightWorks/hamlet/highlights/${operation.cloudKey}`, concurrent.cloud);
    data.set('users/A/highlightWorks/hamlet/operations/other-device', concurrent.receipt);
    data.set('users/A/highlightWorks/hamlet', concurrent.metadata);
  };
  const result = await client.commit(operation);
  assert.equal(result.cloud.serverRevision, 2); assert.equal(result.metadata.activeCount, 1); assert.equal(env.transactionCalls, 2);
  assert.equal(records.size, 4, 'one shared highlight, work metadata and two immutable receipts');
});

test('permanent permission failures with unchanged server state never gain automatic write retries', async () => {
  const { env, committed } = fixture(), client = transport(env);
  env.denyBeforeCommit = () => {};
  await assert.rejects(client.commit(operation), { code: 'permission-denied' });
  assert.equal(env.transactionCalls, 1); assert.equal(committed.length, 0);
});

test('continued state changes cannot turn guarded permission recovery into an unbounded retry loop', async () => {
  const { env, records } = fixture(), client = transport(env);
  let races = 0;
  const racingCommit = data => {
    const cloudPath = `users/A/highlightWorks/hamlet/highlights/${operation.cloudKey}`, metadataPath = 'users/A/highlightWorks/hamlet';
    const result = require('../../reader/highlightSyncProtocol').planServerMutation({ operation: { ...operation, operationId: 'racer-' + ++races },
      cloud: data.get(cloudPath), metadata: data.get(metadataPath), serverTimestamp: stamp });
    data.set(cloudPath, result.cloud); data.set(metadataPath, result.metadata);
    data.set('users/A/highlightWorks/hamlet/operations/' + result.receipt.operationId, result.receipt);
    env.denyBeforeCommit = racingCommit;
  };
  env.denyBeforeCommit = racingCommit;
  await assert.rejects(client.commit(operation), { code: 'permission-denied' });
  assert.equal(env.transactionCalls, 2); assert.equal(races, 2);
  assert.equal(records.has('users/A/highlightWorks/hamlet/operations/op-1'), false);
});
