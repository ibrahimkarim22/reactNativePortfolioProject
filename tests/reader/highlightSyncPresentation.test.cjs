const test = require('node:test');
const assert = require('node:assert/strict');
const { syncLabel, syncSummaryText, syncErrorText } = require('../../reader/highlightSyncPresentation');

test('normal confirmed synchronization is quiet while pending and failed local saves stay explicit', () => {
  assert.equal(syncLabel({ status: 'pending' }), 'Saved on this device · Waiting to sync');
  assert.equal(syncLabel({ status: 'pending' }, { syncing: true }), 'Syncing…');
  assert.equal(syncLabel({ status: 'synced' }), '');
  assert.equal(syncLabel({ status: 'synced' }, { mode: 'emulator' }), 'Confirmed in isolated test backend');
  assert.equal(syncLabel({ status: 'failed' }), 'Saved on this device · Sync failed');
  assert.equal(syncLabel({ status: 'conflict' }), 'Saved on this device · Changes need review');
  assert.equal(syncLabel(undefined), 'Saved on this device');
});
test('deletion and permanent failure copy retains local data and does not imply backup', () => {
  assert.equal(syncSummaryText({ pending: 2, failed: 1, deleted: 1 }), 'Saved on this device · Waiting to sync · 1 change needs Retry');
  assert.equal(syncSummaryText({ pending: 2 }, { running: true }), 'Syncing…');
  assert.equal(syncSummaryText({ pending: 0, failed: 0, conflict: 0, deleted: 4 }), '');
  assert.match(syncErrorText({ code: 'permission-denied' }), /saved on this device/);
  assert.match(syncErrorText({ code: 'SYNC_LISTENER_LIMIT' }), /retained history/);
});
