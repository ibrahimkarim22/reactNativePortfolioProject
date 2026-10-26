function syncLabel(value, { mode = 'production' } = {}) {
  if (value?.status === 'synced') return mode === 'emulator' ? 'Confirmed in isolated test backend' : '';
  return value?.status === 'failed' ? 'Your highlight changes could not be saved to your account.' : '';
}
function syncSummaryText(value) {
  if (!value?.failed) return '';
  return `${value.failed} highlight ${value.failed === 1 ? 'change' : 'changes'} could not be saved to your account.`;
}
function syncErrorText(error) {
  if (!error) return '';
  const code = (error.code || '').replace(/^firestore\//, '');
  if (code === 'unauthenticated') return 'Sign in again to save your highlight changes.';
  if (code.includes('CONFLICT')) return 'This highlight changed on another device. Choose which change to keep.';
  if (code.includes('LISTENER_LIMIT')) return 'This play has too many saved highlights to load. Existing highlights have been kept.';
  if (code.includes('LIMIT') || code.includes('CAPACITY')) return 'The highlight limit has been reached. Existing highlights have been kept.';
  if (['READ_FAILED', 'STORAGE_UNAVAILABLE'].includes(code)) return 'Highlights could not be loaded. Please try again.';
  if (['WRITE_FAILED', 'RETRY_REQUIRED'].includes(code)) return 'Your highlight could not be saved. Please try again.';
  // A queued, retryable connection interruption is not a rejected save. Never
  // turn either state into a claim of server confirmation.
  if (error.retryable === true && ['unavailable', 'deadline-exceeded', 'aborted', 'network-request-failed'].includes(code)) return '';
  return 'Your highlight changes could not be saved to your account.';
}
module.exports = { syncLabel, syncSummaryText, syncErrorText };
