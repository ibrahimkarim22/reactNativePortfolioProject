const { resolveSelection } = require('../shared/contentText');

// Pure annotation policy. Storage and mounted reader state remain external.
const LIMITS = Object.freeze({ MAX_RECORDS: 200, MAX_RECORD_BYTES: 131072, MAX_WORK_BYTES: 524288, MAX_SELECTION_UTF16: 16384, MAX_MESSAGE_UNITS: 8192 });
const HIGHLIGHT_PALETTE = Object.freeze({
  yellow: Object.freeze({ label: 'Yellow', background: Object.freeze({ paper: '#F3E4A6', sepia: '#E6CF85', night: '#50472A' }) }),
  sage: Object.freeze({ label: 'Sage', background: Object.freeze({ paper: '#D6E5CE', sepia: '#CCD7B3', night: '#30483C' }) }),
  blue: Object.freeze({ label: 'Blue', background: Object.freeze({ paper: '#D7E5F2', sepia: '#CCD8DF', night: '#304555' }) }),
  rose: Object.freeze({ label: 'Rose', background: Object.freeze({ paper: '#EED6DC', sepia: '#E2C4C5', night: '#513840' }) }),
});
const SELECTION_FIELDS = ['kind', 'workId', 'contentVersion', 'canonicalTextVersion', 'offsetUnit', 'start', 'end', 'startRef', 'endRef', 'exact', 'prefix', 'suffix'];
const ENDPOINT_FIELDS = ['textId', 'sectionId', 'offsetUtf16'];
const RECORD_FIELDS = ['schemaVersion', 'id', 'owner', 'workId', 'selectionRef', 'colorId', 'revision', 'createdAt', 'updatedAt'];
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const bounded = (value, max = 512) => typeof value === 'string' && value.length > 0 && value.length <= max;
const natural = value => Number.isSafeInteger(value) && value >= 0;
const exact = (value, keys) => record(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && descriptor.enumerable && Object.prototype.hasOwnProperty.call(descriptor, 'value');
});

const MESSAGES = Object.freeze({
  INVALID_HIGHLIGHT: 'This highlight is unavailable because its saved data is invalid. You can remove this entry.',
  HIGHLIGHT_COUNT_LIMIT: 'This play already has 200 highlights on this device. Remove a highlight before saving another.',
  RECORD_TOO_LARGE: 'This highlight exceeds the 128 KiB record limit. Select a shorter passage.',
  WORK_TOO_LARGE: 'Highlights for this play exceed the 512 KiB limit. Remove a highlight before saving another.',
  READ_FAILED: 'Could not load highlights from this device. Retry before making changes.',
  WRITE_FAILED: 'Could not save the highlight on this device. Your last confirmed highlights and quotation are retained. Retry to check storage and try again.',
  STORAGE_UNAVAILABLE: 'Highlight storage is unavailable on this device. Retry to check storage.',
  RETRY_REQUIRED: 'Retry loading highlights before making another change. Your last confirmed highlights are retained.',
  WRITE_CONFLICT: 'Saved highlights changed while this action was pending. Reload highlights before trying the change again.',
  ID_COLLISION: 'A unique highlight ID could not be created. Try saving the passage again.',
  CANCELLED: 'This highlight action was cancelled because the reader or account changed.',
  UNSUPPORTED: 'Highlight painting is unavailable in this reader. Your saved highlights are retained on this device.',
  HIGHLIGHT_OVERLAP: 'This passage overlaps an existing highlight. Open the existing entry to edit or remove it.',
  HIGHLIGHT_NOT_FOUND: 'This highlight is no longer available. Reload highlights and try again.',
  SEPARATOR_ONLY: 'Select some passage text to highlight. A layout break alone cannot be highlighted.',
  SELECTION_TOO_LARGE: 'Select a shorter passage. Highlights can contain at most 16,384 UTF-16 units.',
  CONTENT_VERSION_MISMATCH: 'This highlight belongs to another content version and cannot be shown in this edition.',
  CANONICAL_TEXT_VERSION_MISMATCH: 'This highlight uses another text version and cannot be shown in this edition.',
});
const MESSAGE_ALIASES = Object.freeze({ HIGHLIGHT_RECORD_TOO_LARGE: 'RECORD_TOO_LARGE', HIGHLIGHT_WORK_TOO_LARGE: 'WORK_TOO_LARGE', HIGHLIGHT_READ_FAILED: 'READ_FAILED', HIGHLIGHT_WRITE_FAILED: 'WRITE_FAILED', HIGHLIGHT_STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE', OVERLAP: 'HIGHLIGHT_OVERLAP', NOT_FOUND: 'HIGHLIGHT_NOT_FOUND', HIGHLIGHTS_UNSUPPORTED: 'UNSUPPORTED' });
function errorMessage(code) { return MESSAGES[MESSAGE_ALIASES[code] || code] || 'The highlight could not be completed. Try again.'; }
function fail(code, values) { const error = new Error(errorMessage(code)); error.code = code; if (values) Object.assign(error, values); throw error; }
function invalid() { fail('INVALID_HIGHLIGHT'); }

function utf8Length(value) {
  if (typeof value !== 'string') invalid();
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) { bytes += 4; index += 1; }
    else bytes += 3;
  }
  return bytes;
}
function segment(value, max) {
  if (!bounded(value, max)) invalid();
  try { return encodeURIComponent(value); } catch (_) { return invalid(); }
}
function prefixFor(uid, workId) { return '@bard/reader-highlights:v1/' + segment(uid, 128) + '/' + segment(workId, 512) + '/'; }
function keyFor(uid, workId, id) { return prefixFor(uid, workId) + segment(id, 128); }

function canonicalFor(canonical) {
  if (!record(canonical) || !bounded(canonical.workId) || !bounded(canonical.contentVersion) || canonical.canonicalTextVersion !== '1'
      || typeof canonical.text !== 'string' || !Array.isArray(canonical.units)) invalid();
  return canonical;
}
function selectionShape(value) {
  if (!exact(value, SELECTION_FIELDS) || value.kind !== 'text-range' || value.offsetUnit !== 'utf16'
      || !bounded(value.workId) || !bounded(value.contentVersion) || !bounded(value.canonicalTextVersion)
      || !natural(value.start) || !natural(value.end) || value.end <= value.start || typeof value.exact !== 'string'
      || value.exact.length !== value.end - value.start || typeof value.prefix !== 'string' || value.prefix.length > 32
      || typeof value.suffix !== 'string' || value.suffix.length > 32) invalid();
  if (value.end - value.start > LIMITS.MAX_SELECTION_UTF16) fail('SELECTION_TOO_LARGE');
  for (const endpoint of [value.startRef, value.endRef]) {
    if (!exact(endpoint, ENDPOINT_FIELDS) || !bounded(endpoint.textId) || !bounded(endpoint.sectionId) || !natural(endpoint.offsetUtf16)) invalid();
  }
  return Object.freeze({ ...value, startRef: Object.freeze({ ...value.startRef }), endRef: Object.freeze({ ...value.endRef }) });
}
function versionCode(value, canonical) {
  if (value.workId !== canonical.workId) invalid();
  if (value.contentVersion !== canonical.contentVersion) return 'CONTENT_VERSION_MISMATCH';
  if (value.canonicalTextVersion !== canonical.canonicalTextVersion) return 'CANONICAL_TEXT_VERSION_MISMATCH';
  return null;
}
function validateSelectionRef(value, canonical) {
  canonicalFor(canonical);
  const selection = selectionShape(value), code = versionCode(selection, canonical);
  if (code) fail(code);
  try { resolveSelection(canonical, selection); } catch (_) { invalid(); }
  if (!canonical.units.some(unit => unit.start < selection.end && unit.textEnd > selection.start)) fail('SEPARATOR_ONLY');
  return selection;
}
function validateHighlightRecord(value, scope) {
  if (!exact(value, RECORD_FIELDS) || value.schemaVersion !== 1 || !bounded(value.id, 128)
      || !exact(value.owner, ['kind', 'uid']) || value.owner.kind !== 'account' || !bounded(value.owner.uid, 128)
      || !bounded(value.workId) || typeof value.colorId !== 'string' || !Object.prototype.hasOwnProperty.call(HIGHLIGHT_PALETTE, value.colorId)
      || !Number.isSafeInteger(value.revision) || value.revision < 1 || !natural(value.createdAt) || !natural(value.updatedAt) || value.updatedAt < value.createdAt
      || !record(scope) || !bounded(scope.uid, 128) || !bounded(scope.workId) || value.owner.uid !== scope.uid || value.workId !== scope.workId) invalid();
  const canonical = canonicalFor(scope.canonical);
  if (canonical.workId !== scope.workId) invalid();
  keyFor(value.owner.uid, value.workId, value.id);
  let serialized;
  try { serialized = JSON.stringify(value); } catch (_) { invalid(); }
  if (utf8Length(serialized) > LIMITS.MAX_RECORD_BYTES) fail('RECORD_TOO_LARGE');
  let selection = selectionShape(value.selectionRef);
  if (selection.workId !== value.workId) invalid();
  if (!versionCode(selection, canonical)) selection = validateSelectionRef(selection, canonical);
  return Object.freeze({ schemaVersion: 1, id: value.id, owner: Object.freeze({ kind: 'account', uid: value.owner.uid }), workId: value.workId,
    selectionRef: selection, colorId: value.colorId, revision: value.revision, createdAt: value.createdAt, updatedAt: value.updatedAt });
}
function classifyRecord(value, scope) {
  const validated = validateHighlightRecord(value, scope), code = versionCode(validated.selectionRef, scope.canonical);
  return Object.freeze(code ? { status: 'unresolved', record: validated, code } : { status: 'resolved', record: validated });
}
function resolvedRanges(records, canonical) {
  canonicalFor(canonical);
  if (!Array.isArray(records)) invalid();
  return records.filter(value => {
    if (!record(value) || !bounded(value.id, 128)) invalid();
    const selection = selectionShape(value.selectionRef);
    if (versionCode(selection, canonical)) return false;
    validateSelectionRef(selection, canonical);
    return true;
  }).slice().sort((a, b) => a.selectionRef.start - b.selectionRef.start || a.selectionRef.end - b.selectionRef.end || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
function overlapping(a, b) { return a.start < b.end && b.start < a.end; }
function findCreateConflict(records, selectionRef, canonical) {
  const selection = validateSelectionRef(selectionRef, canonical);
  const conflicts = resolvedRanges(records, canonical).filter(value => overlapping(value.selectionRef, selection));
  if (!conflicts.length) return Object.freeze({ kind: 'new' });
  if (conflicts.length === 1 && conflicts[0].selectionRef.start === selection.start && conflicts[0].selectionRef.end === selection.end) return Object.freeze({ kind: 'duplicate', record: conflicts[0] });
  fail('HIGHLIGHT_OVERLAP', { conflictIds: Object.freeze(Array.from(new Set(conflicts.map(value => value.id)))) });
}
function findStoredConflicts(records, canonical) {
  const resolved = resolvedRanges(records, canonical), conflicts = new Set();
  for (let first = 0; first < resolved.length; first += 1) {
    for (let next = first + 1; next < resolved.length && resolved[next].selectionRef.start < resolved[first].selectionRef.end; next += 1) {
      if (overlapping(resolved[first].selectionRef, resolved[next].selectionRef)) { conflicts.add(resolved[first].id); conflicts.add(resolved[next].id); }
    }
  }
  return Object.freeze(resolved.filter(value => conflicts.has(value.id)).map(value => value.id));
}

module.exports = { LIMITS, HIGHLIGHT_PALETTE, validateSelectionRef, validateHighlightRecord, classifyRecord, findCreateConflict, findStoredConflicts, utf8Length, errorMessage, keyFor, prefixFor };
