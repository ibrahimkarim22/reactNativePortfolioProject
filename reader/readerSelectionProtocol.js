const { resolveSelection } = require('../shared/contentText');

const IDENTITY_FIELDS = ['documentId', 'workId', 'contentVersion', 'canonicalTextVersion'];
const SELECTION_REJECTION_CODES = Object.freeze([
  'INVALID_SELECTION', 'COLLAPSED_SELECTION', 'OUTSIDE_ROOT', 'INVALID_MAPPING', 'INVALID_RANGE',
  'SURROGATE_BOUNDARY', 'SELECTION_TOO_LARGE', 'MAPPING_UNAVAILABLE', 'APPEARANCE_CHANGED',
  'FONT_REFLOW', 'LAYOUT_CHANGED', 'MODAL_OPENED', 'SCENE_JUMP', 'DOCUMENT_CHANGED', 'CANCELLED',
  'STALE_REQUEST', 'INVALID_REQUEST', 'NO_SELECTION', 'CLEARED',
]);
const SELECTION_CLEAR_REASONS = Object.freeze(['cancel', 'appearance', 'contents', 'navigation', 'document', 'layout', 'font', 'dispose', 'modal']);
const MAX_MESSAGE_LENGTH = 8192;
const MAX_CAPTURE_MESSAGE_LENGTH = 131072;
const MAX_SELECTION_LENGTH = 16384;
const SELECTION_FIELDS = ['kind', 'workId', 'contentVersion', 'canonicalTextVersion', 'offsetUnit', 'start', 'end', 'startRef', 'endRef', 'exact', 'prefix', 'suffix'];
const ENDPOINT_FIELDS = ['textId', 'sectionId', 'offsetUtf16'];
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
const boundedString = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const validToken = value => typeof value === 'string' && /^[\x21-\x7e]{1,128}$/.test(value);

function exactKeys(value, fields) {
  return record(value) && Object.keys(value).length === fields.length && fields.every(key => own(value, key));
}

function isIdentity(identity) {
  return record(identity) && IDENTITY_FIELDS.every(key => boundedString(identity[key])) && identity.canonicalTextVersion === '1';
}

function matchesCanonical(identity, canonical) {
  return record(canonical) && typeof canonical.text === 'string' && Array.isArray(canonical.units)
    && ['workId', 'contentVersion', 'canonicalTextVersion'].every(key => canonical[key] === identity[key]);
}

function freezeMessage(message) {
  if (message.selection) {
    Object.freeze(message.selection.startRef);
    Object.freeze(message.selection.endRef);
    Object.freeze(message.selection);
  }
  return Object.freeze(message);
}

function validSelection(selection, canonical) {
  if (!exactKeys(selection, SELECTION_FIELDS)
      || !exactKeys(selection.startRef, ENDPOINT_FIELDS) || !exactKeys(selection.endRef, ENDPOINT_FIELDS)
      || !Number.isSafeInteger(selection.start) || !Number.isSafeInteger(selection.end)
      || selection.start < 0 || selection.end > canonical.text.length || selection.end <= selection.start
      || selection.end - selection.start > MAX_SELECTION_LENGTH
      || typeof selection.exact !== 'string' || selection.exact.length > MAX_SELECTION_LENGTH
      || typeof selection.prefix !== 'string' || selection.prefix.length > 32
      || typeof selection.suffix !== 'string' || selection.suffix.length > 32) return false;
  for (const endpoint of [selection.startRef, selection.endRef]) {
    if (!boundedString(endpoint.textId) || !boundedString(endpoint.sectionId)
        || !Number.isSafeInteger(endpoint.offsetUtf16) || endpoint.offsetUtf16 < 0 || endpoint.offsetUtf16 > canonical.text.length) return false;
  }
  try { resolveSelection(canonical, selection); } catch (_) { return false; }
  return true;
}

function parseSelectionMessage(raw, identity, canonical) {
  if (!isIdentity(identity) || !matchesCanonical(identity, canonical)
      || typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_CAPTURE_MESSAGE_LENGTH) return null;
  let message;
  try { message = JSON.parse(raw); } catch (_) { return null; }
  if (!record(message) || !IDENTITY_FIELDS.every(key => own(message, key) && message[key] === identity[key])
      || !positiveInteger(message.selectionSeq)) return null;
  if (message.type === 'selectionChange') {
    const fields = [...IDENTITY_FIELDS, 'type', 'selectionRequestId', 'selectionSeq', 'state', ...(own(message, 'code') ? ['code'] : [])];
    if (raw.length > MAX_MESSAGE_LENGTH || !exactKeys(message, fields)
        || !Number.isSafeInteger(message.selectionRequestId) || message.selectionRequestId < 0
        || !['none', 'range', 'invalid'].includes(message.state)
        || (own(message, 'code') && !SELECTION_REJECTION_CODES.includes(message.code))) return null;
    return freezeMessage(message);
  }
  if (message.type !== 'selectionCapture' || !positiveInteger(message.selectionRequestId) || !validToken(message.captureToken)) return null;
  const base = [...IDENTITY_FIELDS, 'type', 'selectionRequestId', 'captureToken', 'selectionSeq', 'status'];
  if (message.status === 'rejected') {
    if (raw.length > MAX_MESSAGE_LENGTH || !exactKeys(message, [...base, 'code']) || !SELECTION_REJECTION_CODES.includes(message.code)) return null;
  } else if (message.status === 'captured') {
    if (!exactKeys(message, [...base, 'selection']) || !validSelection(message.selection, canonical)) return null;
  } else return null;
  return freezeMessage(message);
}

function selectionCommandPayload(identity, selectionRequestId, kind, tokenOrReason) {
  if (!isIdentity(identity) || !positiveInteger(selectionRequestId)
      || !['capture', 'clear'].includes(kind)
      || (kind === 'capture' ? !validToken(tokenOrReason) : !SELECTION_CLEAR_REASONS.includes(tokenOrReason))) {
    throw new Error('Invalid reader selection command.');
  }
  return {
    ...Object.fromEntries(IDENTITY_FIELDS.map(key => [key, identity[key]])), selectionRequestId,
    [kind === 'capture' ? 'captureToken' : 'reason']: tokenOrReason,
  };
}

function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function buildSelectionScript(identity, selectionRequestId, kind, tokenOrReason) {
  const payload = selectionCommandPayload(identity, selectionRequestId, kind, tokenOrReason);
  return `if(window.BardReader){window.BardReader.${kind === 'capture' ? 'captureSelection' : 'clearSelection'}(${scriptJson(payload)});}true;`;
}

module.exports = { parseSelectionMessage, selectionCommandPayload, buildSelectionScript, SELECTION_REJECTION_CODES, SELECTION_CLEAR_REASONS };
