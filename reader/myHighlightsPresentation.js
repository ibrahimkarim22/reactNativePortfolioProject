const { errorMessage } = require('./readerHighlights');

function catalogueRows(works, plays) {
  const titles = new Map(plays.map(play => [play.id, play.name || play.title]));
  return works.filter(work => work.count > 0).map(work => ({
    ...work,
    title: titles.get(work.workId) || 'Unavailable play',
    available: titles.has(work.workId),
    // Different pending measurements cannot establish a single exact count.
    // Keep those measurements internally without turning storage into a choice.
    countLabel: work.countDescription ? 'Saved passages' : `${work.count} saved ${work.count === 1 ? 'entry' : 'entries'}`,
  })).sort((a, b) => a.title.localeCompare(b.title) || a.workKey.localeCompare(b.workKey));
}

function highlightRows(snapshot, model) {
  const labels = new Map((model?.items || []).map(item => [item.id, item.locationLabel]));
  const conflicts = new Set(snapshot.conflicts || []);
  const row = (record, status, retainedDeletion = false) => {
    const sync = snapshot.syncById?.[record.id], syncConflict = sync?.status === 'conflict';
    return { id: record.id, record, quotation: record.selectionRef.exact,
    locationLabel: status === 'unresolved' ? 'Different text version' : labels.get(record.selectionRef.startRef.sectionId) || 'Saved quotation',
    colorId: record.colorId, status: syncConflict ? 'conflict' : status,
    sync, syncConflict, syncDeletion: !!sync?.conflict?.cloud?.deleted, retainedDeletion,
    overlapConflict: conflicts.has(record.id) && !syncConflict,
    start: record.selectionRef.start, end: record.selectionRef.end };
  };
  return [...(snapshot.records || []).map(record => row(record, conflicts.has(record.id) ? 'conflict' : 'resolved')),
    ...(snapshot.unresolved || []).map(({ record }) => row(record, 'unresolved')),
    ...(snapshot.tombstones || []).filter(marker => marker.record && snapshot.syncById?.[marker.id]?.status === 'conflict').map(marker => row(marker.record, 'conflict', true))]
    .sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id))
    .concat((snapshot.unreadable || snapshot.entries || []).map(item => ({ id: item.id, status: 'unreadable', locationLabel: 'Unavailable saved entry', detail: errorMessage(item.code) })));
}

function previewQuote(exact, limit = 240) {
  if (exact.length <= limit) return exact;
  let end = limit;
  const last = exact.charCodeAt(end - 1);
  if (last >= 0xD800 && last <= 0xDBFF) end--;
  return exact.slice(0, end) + '…';
}

module.exports = { catalogueRows, highlightRows, previewQuote };
