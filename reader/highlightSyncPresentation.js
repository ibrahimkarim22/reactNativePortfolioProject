function syncLabel(value, { mode = 'production', syncing = false } = {}) {
  if (value?.status === 'synced') return mode === 'emulator' ? 'Confirmed in isolated test backend' : '';
  return ({ pending: syncing ? 'Syncing…' : 'Saved on this device · Waiting to sync',
    failed: 'Saved on this device · Sync failed', conflict: 'Saved on this device · Changes need review' })[value?.status] || 'Saved on this device';
}
function syncSummaryText(value, { running = false } = {}) {
  if (!value) return '';
  const messages = [];
  if (value.pending) messages.push(running ? 'Syncing…' : 'Saved on this device · Waiting to sync');
  if (value.failed) messages.push(`${value.failed} ${value.failed === 1 ? 'change needs' : 'changes need'} Retry`);
  if (value.conflict) messages.push(`${value.conflict} ${value.conflict === 1 ? 'change needs' : 'changes need'} review`);
  return messages.join(' · ');
}
function syncErrorText(error) {
  if (!error) return '';
  const code = error.code || '';
  if (code.includes('permission-denied')) return 'Synchronization was denied. Your highlight is saved on this device. Retry after access is restored.';
  if (code.includes('CONFLICT')) return 'The cloud and this device differ. Your local choice is retained; choose which version to keep.';
  if (code.includes('LISTENER_LIMIT')) return 'This play has more retained history than this version can load. Data was kept; automatic cleanup is disabled.';
  if (code.includes('LIMIT') || code.includes('CAPACITY')) return 'Synchronization reached a capacity limit. Your local data and pending changes were kept.';
  return 'Synchronization could not complete. Your local highlights and pending changes were kept. Retry when a connection is available.';
}
module.exports = { syncLabel, syncSummaryText, syncErrorText };
