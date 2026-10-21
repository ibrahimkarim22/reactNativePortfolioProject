const { LIMITS, HIGHLIGHT_PALETTE, validateSelectionRef } = require('./readerHighlights');
const IDENTITY = ['documentId', 'workId', 'contentVersion', 'canonicalTextVersion'];
const CODES = Object.freeze(['INVALID_REQUEST', 'INVALID_MAPPING', 'INVALID_RANGE', 'SURROGATE_BOUNDARY', 'SELECTION_TOO_LARGE', 'SEPARATOR_ONLY', 'INCOMPLETE_TRANSACTION', 'UNSUPPORTED', 'PAINT_FAILED', 'GEOMETRY_UNAVAILABLE']);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const positive = value => Number.isSafeInteger(value) && value > 0;
const bounded = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const exact = (value, keys) => record(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && descriptor.enumerable && own(descriptor, 'value');
});
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
function invalid() { throw new Error('Invalid reader highlight command.'); }
function identityFor(identity, canonical) {
  if (!record(identity) || !IDENTITY.every(key => bounded(identity[key])) || identity.canonicalTextVersion !== '1'
      || !record(canonical) || typeof canonical.text !== 'string' || !Array.isArray(canonical.units)
      || !IDENTITY.slice(1).every(key => canonical[key] === identity[key])) invalid();
  return Object.fromEntries(IDENTITY.map(key => [key, identity[key]]));
}
function split(text, at) { return /[\uD800-\uDBFF]/.test(text[at - 1] || '') && /[\uDC00-\uDFFF]/.test(text[at] || ''); }
function itemFor(item, canonical) {
  if (!exact(item, ['id', 'start', 'end', 'colorId']) || !validId(item.id) || typeof item.colorId !== 'string' || !own(HIGHLIGHT_PALETTE, item.colorId)
      || !Number.isSafeInteger(item.start) || !Number.isSafeInteger(item.end) || item.start < 0 || item.end <= item.start
      || item.end > canonical.text.length || item.end - item.start > LIMITS.MAX_SELECTION_UTF16
      || split(canonical.text, item.start) || split(canonical.text, item.end)
      || !canonical.units.some(unit => unit.start < item.end && unit.textEnd > item.start)) invalid();
  return { id: item.id, start: item.start, end: item.end, colorId: item.colorId };
}
function highlightItemsFromReferences(records, canonical) {
  if (!record(canonical) || !Array.isArray(records) || records.length > LIMITS.MAX_RECORDS) invalid();
  const identity = { documentId: 'reference-validation', workId: canonical.workId, contentVersion: canonical.contentVersion, canonicalTextVersion: canonical.canonicalTextVersion };
  identityFor(identity, canonical);
  const ids = new Set();
  return records.map(value => {
    if (!exact(value, ['id', 'colorId', 'selectionRef']) || ids.has(value.id)) invalid();
    const selection = validateSelectionRef(value.selectionRef, canonical);
    ids.add(value.id);
    return itemFor({ id: value.id, colorId: value.colorId, start: selection.start, end: selection.end }, canonical);
  });
}
function baseFor(identity, ownerGeneration, revision, canonical) {
  if (!positive(ownerGeneration) || !positive(revision)) invalid();
  return { ...identityFor(identity, canonical), ownerGeneration, revision };
}
function wireSize(payload) {
  return JSON.stringify({ type: own(payload, 'showId') ? 'bard-reader-highlight-show' : 'bard-reader-highlights', payload }).length;
}
function boundedPayload(payload) { if (wireSize(payload) > LIMITS.MAX_MESSAGE_UNITS) invalid(); return payload; }
function highlightUpdatePayloads(identity, ownerGeneration, revision, items, canonical) {
  const base = baseFor(identity, ownerGeneration, revision, canonical);
  if (!Array.isArray(items) || items.length > LIMITS.MAX_RECORDS) invalid();
  const ids = new Set(), chunks = [];
  for (const item of items) {
    const compact = itemFor(item, canonical);
    if (ids.has(item.id)) invalid(); ids.add(item.id);
    let chunk = chunks[chunks.length - 1];
    if (!chunk || wireSize({ ...base, phase: 'chunk', index: chunks.length - 1, items: [...chunk, compact] }) > LIMITS.MAX_MESSAGE_UNITS) { chunk = []; chunks.push(chunk); }
    chunk.push(compact);
    boundedPayload({ ...base, phase: 'chunk', index: chunks.length - 1, items: chunk });
  }
  return [boundedPayload({ ...base, phase: 'begin', count: items.length, chunks: chunks.length }),
    ...chunks.map((chunk, index) => boundedPayload({ ...base, phase: 'chunk', index, items: chunk })), boundedPayload({ ...base, phase: 'commit' })];
}
function highlightShowPayload(identity, ownerGeneration, revision, showId, item, canonical) {
  const base = baseFor(identity, ownerGeneration, revision, canonical), compact = itemFor(item, canonical);
  if (!positive(showId)) invalid();
  return boundedPayload({ ...base, showId, id: compact.id, start: compact.start, end: compact.end });
}
function scriptJson(value) { return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'); }
function buildHighlightScripts(...args) { return highlightUpdatePayloads(...args).map(payload => `if(window.BardReader){window.BardReader.updateHighlights(${scriptJson(payload)});}true;`); }
function buildHighlightShowScript(...args) { return `if(window.BardReader){window.BardReader.showHighlight(${scriptJson(highlightShowPayload(...args))});}true;`; }
function buildHighlightCommandScript(kind, payload, canonical) {
  if (!record(payload)) invalid();
  baseFor(payload, payload.ownerGeneration, payload.revision, canonical);
  boundedPayload(payload);
  const base = [...IDENTITY, 'ownerGeneration', 'revision'];
  if (kind === 'show') {
    if (!exact(payload, [...base, 'showId', 'id', 'start', 'end']) || !positive(payload.showId)) invalid();
    itemFor({ id: payload.id, start: payload.start, end: payload.end, colorId: 'yellow' }, canonical);
  } else if (kind === 'apply') {
    const keys = [...base, 'phase'];
    if (payload.phase === 'begin') {
      if (!exact(payload, [...keys, 'count', 'chunks']) || !Number.isSafeInteger(payload.count) || payload.count < 0 || payload.count > LIMITS.MAX_RECORDS
          || !Number.isSafeInteger(payload.chunks) || payload.chunks < 0 || payload.chunks > payload.count
          || (payload.count === 0 ? payload.chunks !== 0 : payload.chunks === 0)) invalid();
    } else if (payload.phase === 'chunk') {
      if (!exact(payload, [...keys, 'index', 'items']) || !Number.isSafeInteger(payload.index) || payload.index < 0 || payload.index >= LIMITS.MAX_RECORDS
          || !Array.isArray(payload.items) || !payload.items.length || payload.items.length > LIMITS.MAX_RECORDS) invalid();
      const ids = new Set();
      for (const item of payload.items) { itemFor(item, canonical); if (ids.has(item.id)) invalid(); ids.add(item.id); }
    } else if (payload.phase !== 'commit' || !exact(payload, keys)) invalid();
  } else invalid();
  return `if(window.BardReader){window.BardReader.${kind === 'show' ? 'showHighlight' : 'updateHighlights'}(${scriptJson(payload)});}true;`;
}
function parseHighlightMessage(raw, identity) {
  if (typeof raw !== 'string' || !raw.length || raw.length > LIMITS.MAX_MESSAGE_UNITS || !record(identity)
      || !IDENTITY.every(key => bounded(identity[key])) || identity.canonicalTextVersion !== '1') return null;
  let value; try { value = JSON.parse(raw); } catch (_) { return null; }
  if (!record(value) || !IDENTITY.every(key => value[key] === identity[key]) || !positive(value.ownerGeneration) || !positive(value.revision)
      || !['highlightsApplied', 'highlightShown'].includes(value.type) || !['applied', 'unsupported', 'error'].includes(value.status)) return null;
  const keys = [...IDENTITY, 'type', 'ownerGeneration', 'revision', 'status'];
  if (value.type === 'highlightShown') { keys.push('showId', 'id'); if (!positive(value.showId) || !validId(value.id)) return null; }
  if (own(value, 'code')) { keys.push('code'); if (value.status === 'applied' || !CODES.includes(value.code)) return null; }
  return exact(value, keys) ? Object.freeze(value) : null;
}
module.exports = { highlightItemsFromReferences, highlightUpdatePayloads, buildHighlightScripts, highlightShowPayload, buildHighlightShowScript, buildHighlightCommandScript, parseHighlightMessage };
