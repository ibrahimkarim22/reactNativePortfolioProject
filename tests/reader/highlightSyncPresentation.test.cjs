const test = require('node:test');
const assert = require('node:assert/strict');
const { syncLabel, syncSummaryText, syncErrorText } = require('../../reader/highlightSyncPresentation');

test('only a confirmed current operation is described as synced and local failure is never pending', () => {
  assert.equal(syncLabel({ status: 'pending' }), 'Saved locally · pending sync');
  assert.equal(syncLabel({ status: 'synced' }), 'Synced to the test backend');
  assert.equal(syncLabel({ status: 'failed' }), 'Saved locally · sync failed');
  assert.equal(syncLabel({ status: 'conflict' }), 'Saved locally · synchronization conflict');
  assert.equal(syncLabel(undefined), 'Saved on this device');
});
test('deletion and permanent failure copy retains local data and does not imply backup', () => {
  assert.match(syncSummaryText({ pending: 2, failed: 1, deleted: 1 }), /1 deletion/);
  assert.match(syncErrorText({ code: 'permission-denied' }), /saved on this device/);
  assert.match(syncErrorText({ code: 'SYNC_LISTENER_LIMIT' }), /retained history/);
});
