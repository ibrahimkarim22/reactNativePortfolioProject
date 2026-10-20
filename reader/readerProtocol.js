const { FONTS, THEMES, LINE_SPACING } = require('./readerConstants');

const IDENTITY_FIELDS = ['documentId', 'workId', 'contentVersion', 'canonicalTextVersion'];
const MAX_MESSAGE_LENGTH = 8192;
const MAX_FACE_LENGTH = 2 * 1024 * 1024;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function isIdentity(identity) {
  return identity && IDENTITY_FIELDS.every(key => typeof identity[key] === 'string' && identity[key].length > 0 && identity[key].length <= 512)
    && identity.canonicalTextVersion === '1';
}

function validDiagnostics(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const allowed = ['viewportHeight', 'viewportWidth', 'scrollY', 'scrollHeight', 'finalTextTop', 'finalTextBottom'];
  return Object.keys(value).every(key => allowed.includes(key) && Number.isFinite(value[key]) && Math.abs(value[key]) <= 1e9);
}

function parseReaderMessage(raw, identity) {
  if (!isIdentity(identity) || typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_MESSAGE_LENGTH) return null;
  let message;
  try { message = JSON.parse(raw); } catch (_) { return null; }
  if (!message || typeof message !== 'object' || Array.isArray(message)
      || !IDENTITY_FIELDS.every(key => message[key] === identity[key])) return null;
  const allowed = [...IDENTITY_FIELDS, 'type', 'requestId', 'diagnostics', 'code', 'message'];
  if (Object.keys(message).some(key => !allowed.includes(key)) || !['ready', 'applied', 'error'].includes(message.type)) return null;
  if (message.type === 'applied' && (!Number.isSafeInteger(message.requestId) || message.requestId < 1)) return null;
  if (own(message, 'requestId') && (!Number.isSafeInteger(message.requestId) || message.requestId < 1)) return null;
  if (own(message, 'diagnostics') && !validDiagnostics(message.diagnostics)) return null;
  if (message.type === 'error') {
    if (typeof message.code !== 'string' || !/^[A-Z_]{1,64}$/.test(message.code)
        || typeof message.message !== 'string' || message.message.length > 512) return null;
  } else if (own(message, 'code') || own(message, 'message')) return null;
  return message;
}

function isAllowedReaderNavigation(url) {
  return typeof url === 'string' && /^about:blank(?:#[^\r\n]*)?$/.test(url);
}

function validateAppearance(identity, requestId, appearance) {
  if (!isIdentity(identity) || !Number.isSafeInteger(requestId) || requestId < 1 || !appearance || typeof appearance !== 'object') throw new Error('Invalid reader appearance identity.');
  const { preferences, fontScale, fontFaces } = appearance;
  if (!preferences || preferences.schemaVersion !== 1 || !own(FONTS, preferences.fontId)
      || !Number.isInteger(preferences.fontSize) || preferences.fontSize < 16 || preferences.fontSize > 30 || preferences.fontSize % 2 !== 0
      || !own(LINE_SPACING, preferences.lineSpacing) || !own(THEMES, preferences.theme)
      || !Number.isFinite(fontScale) || fontScale <= 0 || fontScale > 10) throw new Error('Invalid reader appearance preferences.');
  if (fontFaces !== undefined && (!Array.isArray(fontFaces) || fontFaces.length > 4 || fontFaces.some(face => !face
      || ![400, 700].includes(face.weight) || !['normal', 'italic'].includes(face.style)
      || typeof face.data !== 'string' || face.data.length === 0 || face.data.length > MAX_FACE_LENGTH
      || face.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(face.data)))) throw new Error('Invalid local reader font faces.');
  if (fontFaces && new Set(fontFaces.map(face => face.weight + ':' + face.style)).size !== fontFaces.length) throw new Error('Duplicate local reader font faces.');
  return {
    ...Object.fromEntries(IDENTITY_FIELDS.map(key => [key, identity[key]])), requestId,
    preferences: { schemaVersion: 1, fontId: preferences.fontId, fontSize: preferences.fontSize, lineSpacing: preferences.lineSpacing, theme: preferences.theme }, fontScale,
    ...(fontFaces ? { fontFaces: fontFaces.map(face => ({ weight: face.weight, style: face.style, data: face.data })) } : {}),
  };
}

function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function buildAppearanceScript(identity, requestId, appearance) {
  const payload = validateAppearance(identity, requestId, appearance);
  return `if(window.BardReader){window.BardReader.applyAppearance(${scriptJson(payload)});}true;`;
}

module.exports = { parseReaderMessage, isAllowedReaderNavigation, buildAppearanceScript, scriptJson };
