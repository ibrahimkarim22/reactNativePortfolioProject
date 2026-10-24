function syncLabel(value) {
  return ({ pending: 'Saved locally · pending sync', synced: 'Synced to the test backend',
    failed: 'Saved locally · sync failed', conflict: 'Saved locally · synchronization conflict' })[value?.status] || 'Saved on this device';
}
function syncSummaryText(value) {
  if (!value) return '';
  return `${value.pending || 0} pending, ${value.failed || 0} failed, ${value.conflict || 0} conflicts. ${value.deleted || 0} deletion markers retained for synchronization.`;
}
function syncErrorText(error) {
  if (!error) return '';
  const code = error.code || '';
  if (code.includes('permission-denied')) return 'Synchronization was denied. Your highlight is saved on this device. Retry after access is restored.';
  if (code.includes('CONFLICT')) return 'The cloud and this device differ. Your local choice is retained; choose which version to keep.';
  if (code.includes('LISTENER_LIMIT')) return 'This play has more retained history than this version can load. Data was kept; automatic cleanup is disabled.';
  if (code.includes('LIMIT') || code.includes('CAPACITY')) return 'Synchronization reached a capacity limit. Your local data and pending changes were kept.';
  return 'Synchronization could not complete. Your local highlights and pending changes were kept. Retry synchronization when the test backend is available.';
}
module.exports = { syncLabel, syncSummaryText, syncErrorText };
