const test = require('node:test');
const assert = require('node:assert/strict');
const { syncLabel, syncSummaryText, syncErrorText } = require('../../reader/highlightSyncPresentation');

test('automatic account saving keeps ordinary pending and confirmed states quiet', () => {
  assert.equal(syncLabel({ status: 'pending' }), '');
  assert.equal(syncLabel({ status: 'pending' }, { syncing: true }), '');
  assert.equal(syncLabel({ status: 'synced' }), '');
  assert.equal(syncLabel({ status: 'synced' }, { mode: 'emulator' }), 'Confirmed in isolated test backend');
  assert.match(syncLabel({ status: 'failed' }), /could not be saved to your account/);
  assert.equal(syncLabel({ status: 'conflict' }), '');
  assert.equal(syncLabel(undefined), '');
});
test('only genuine failures interrupt reading and never imply successful synchronization', () => {
  assert.match(syncSummaryText({ pending: 2, failed: 1, deleted: 1 }), /1 highlight change could not be saved/);
  assert.equal(syncSummaryText({ pending: 2 }, { running: true }), '');
  assert.equal(syncSummaryText({ pending: 0, failed: 0, conflict: 0, deleted: 4 }), '');
  assert.match(syncErrorText({ code: 'permission-denied' }), /could not be saved to your account/);
  assert.match(syncErrorText({ code: 'SYNC_LISTENER_LIMIT' }), /too many/);
  for (const code of ['unavailable', 'firestore/deadline-exceeded', 'aborted']) {
    assert.equal(syncErrorText({ code, retryable: true }), '');
  }
  for (const code of ['WRITE_FAILED', 'READ_FAILED', 'STORAGE_UNAVAILABLE', 'invalid-argument']) {
    assert.ok(syncErrorText({ code }), `${code} must remain visible`);
  }
  for (const code of ['SYNC_PRODUCTION_ENVIRONMENT_REQUIRED', 'resource-exhausted', 'permission-denied']) {
    assert.match(syncErrorText({ code, retryable: true }), /could not be saved/, `${code} is not an ordinary connection interruption`);
  }
  assert.doesNotMatch(syncSummaryText({ failed: 2 }), /synced|backed up|on this device|Retry/);
});
