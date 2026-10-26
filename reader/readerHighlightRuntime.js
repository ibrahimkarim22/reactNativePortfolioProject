const { LIMITS } = require('./readerHighlights');

// Fixed source is shared by the native WebView and web reader. The CSS registry
// is the only paint boundary: source nodes and native Selection stay untouched.
const HIGHLIGHT_RUNTIME_SOURCE = String.raw`function installHighlights(env, createSelectionDom, palette) {
  'use strict';
  const IDENTITY = ['documentId', 'workId', 'contentVersion', 'canonicalTextVersion'];
  const COLORS = ['yellow', 'sage', 'blue', 'rose'];
  const MAX_RECORDS = ${LIMITS.MAX_RECORDS}, MAX_MESSAGE = ${LIMITS.MAX_MESSAGE_UNITS};
  let adapter = null, mappingCode = 'INVALID_MAPPING';
  try { adapter = createSelectionDom(env.root, env.identity); } catch (error) { mappingCode = error.code || mappingCode; }
  let owner = 0, latestRevision = 0, appliedRevision = 0, latestShow = 0, transaction = null, applied = new Map(), anchor = null;
  const own = function(value, key) { return Object.prototype.hasOwnProperty.call(value, key); };
  function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function positive(value) { return Number.isSafeInteger(value) && value > 0; }
  function validId(value) { return typeof value === 'string' && value.length > 0 && value.length <= 128; }
  function exact(value, keys) { return record(value) && Object.keys(value).length === keys.length && keys.every(function(key) { return own(value, key); }); }
  function validBase(payload) {
    if (!record(payload) || !IDENTITY.every(function(key) { return payload[key] === env.identity[key]; })
        || !positive(payload.ownerGeneration) || !positive(payload.revision)) return false;
    try { return JSON.stringify(payload).length <= MAX_MESSAGE; } catch (_) { return false; }
  }
  function supported() { return typeof CSS !== 'undefined' && CSS.highlights && typeof CSS.highlights.set === 'function'
    && typeof CSS.highlights.get === 'function' && typeof CSS.highlights.delete === 'function' && typeof Highlight === 'function'; }
  function clearOwned() { if (supported()) COLORS.forEach(function(color) { CSS.highlights.delete('bard-highlight-' + color); }); }
  function send(payload, type, status, code) {
    const values = { ownerGeneration: payload.ownerGeneration, revision: payload.revision, status: status };
    if (type === 'highlightShown') { values.showId = payload.showId; values.id = payload.id; }
    if (code) values.code = code;
    env.send(type, values);
  }
  function reject(payload, code) { transaction = null; send(payload, 'highlightsApplied', 'error', code); return false; }
  function rangesFor(item) {
    if (!adapter) { const error = new Error('Mapping unavailable'); error.code = mappingCode; throw error; }
    return adapter.rangesFor(item.start, item.end, function() { return document.createRange(); });
  }
  function validItem(item) {
    return exact(item, ['id', 'start', 'end', 'colorId']) && validId(item.id) && COLORS.includes(item.colorId)
      && Number.isSafeInteger(item.start) && Number.isSafeInteger(item.end) && item.start >= 0 && item.end > item.start;
  }
  function update(payload) {
    if (!validBase(payload) || payload.ownerGeneration < owner) return false;
    const base = IDENTITY.concat(['ownerGeneration', 'revision', 'phase']);
    if (payload.phase === 'begin') {
      if (!exact(payload, base.concat(['count', 'chunks'])) || !Number.isSafeInteger(payload.count) || payload.count < 0 || payload.count > MAX_RECORDS
          || !Number.isSafeInteger(payload.chunks) || payload.chunks < 0 || payload.chunks > payload.count
          || (payload.count === 0 ? payload.chunks !== 0 : payload.chunks === 0)
          || (payload.ownerGeneration === owner && payload.revision <= latestRevision)) return false;
      if (payload.ownerGeneration > owner) {
        try { clearOwned(); } catch (_) { send(payload, 'highlightsApplied', 'error', 'PAINT_FAILED'); return false; }
        owner = payload.ownerGeneration; appliedRevision = 0; latestShow = 0; applied = new Map(); anchor = null;
      }
      latestRevision = payload.revision;
      transaction = { revision: payload.revision, count: payload.count, chunks: payload.chunks, next: 0, items: [], ids: new Set() };
      return true;
    }
    if (payload.ownerGeneration !== owner || payload.revision !== latestRevision || !transaction || transaction.revision !== payload.revision) return false;
    if (payload.phase === 'chunk') {
      if (!exact(payload, base.concat(['index', 'items'])) || !Number.isSafeInteger(payload.index) || payload.index !== transaction.next
          || payload.index >= transaction.chunks || !Array.isArray(payload.items) || !payload.items.length || transaction.items.length + payload.items.length > transaction.count) return reject(payload, 'INVALID_REQUEST');
      try {
        payload.items.forEach(function(item) {
          if (!validItem(item) || transaction.ids.has(item.id)) throw new Error('Invalid item');
          rangesFor(item);
          transaction.ids.add(item.id); transaction.items.push({ id: item.id, start: item.start, end: item.end, colorId: item.colorId });
        });
      } catch (error) { return reject(payload, error.code || 'INVALID_REQUEST'); }
      transaction.next += 1;
      return true;
    }
    if (payload.phase !== 'commit' || !exact(payload, base)) return reject(payload, 'INVALID_REQUEST');
    if (transaction.next !== transaction.chunks || transaction.items.length !== transaction.count) return reject(payload, 'INCOMPLETE_TRANSACTION');
    if (!supported()) { transaction = null; send(payload, 'highlightsApplied', 'unsupported', 'UNSUPPORTED'); return false; }
    const buckets = { yellow: [], sage: [], blue: [], rose: [] }, nextApplied = new Map();
    try {
      transaction.items.forEach(function(item) {
        Array.prototype.push.apply(buckets[item.colorId], rangesFor(item));
        nextApplied.set(item.id, item);
      });
      const nextPaint = COLORS.map(function(color) {
        if (!buckets[color].length) return null;
        // Avoid constructor argument limits for heavily fragmented selections.
        const paint = new Highlight();
        buckets[color].forEach(function(range) { paint.add(range); });
        return paint;
      });
      const previous = COLORS.map(function(color) { return CSS.highlights.get('bard-highlight-' + color); });
      try {
        COLORS.forEach(function(color, index) {
          if (nextPaint[index]) CSS.highlights.set('bard-highlight-' + color, nextPaint[index]);
          else CSS.highlights.delete('bard-highlight-' + color);
        });
      } catch (error) {
        COLORS.forEach(function(color, index) { if (previous[index]) CSS.highlights.set('bard-highlight-' + color, previous[index]); else CSS.highlights.delete('bard-highlight-' + color); });
        throw error;
      }
      applied = nextApplied; appliedRevision = payload.revision; transaction = null;
      if (anchor) {
        const anchored = applied.get(anchor.id);
        if (!anchored || anchored.start !== anchor.start || anchored.end !== anchor.end) anchor = null;
      }
      send(payload, 'highlightsApplied', 'applied'); return true;
    } catch (error) { return reject(payload, error.code || 'PAINT_FAILED'); }
  }
  function firstGlyphRect(item) {
      const ranges = rangesFor(item);
      let rect = null;
      // Geometry comes from the actual first painted glyph, including when the
      // canonical range begins in a layout-backed separator or a blank text leaf.
      for (let index = 0; index < ranges.length && !rect; index += 1) {
        const range = ranges[index], node = range.startContainer;
        for (let offset = range.startOffset; offset < range.endOffset && !rect;) {
          const glyph = document.createRange(), before = node.data.charCodeAt(offset), after = node.data.charCodeAt(offset + 1);
          const width = before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff ? 2 : 1;
          glyph.setStart(node, offset); glyph.setEnd(node, Math.min(offset + width, range.endOffset));
          const rects = glyph.getClientRects();
          for (let r = 0; r < rects.length; r += 1) if (Number.isFinite(rects[r].top) && rects[r].width > 0 && rects[r].height > 0) { rect = rects[r]; break; }
          offset += width;
        }
      }
      return rect;
  }
  function align(rect) {
      const y = window.scrollY || window.pageYOffset || 0;
      window.scrollTo(0, Math.max(0, y + rect.top - Math.min(24, (window.innerHeight || 400) / 5)));
      env.markOwnScroll(); env.refreshLocation();
  }
  function cancel() { anchor = null; }
  function restore() {
    env.observeScroll();
    if (!anchor || anchor.ownerGeneration !== owner || (env.interactionVersion && anchor.version !== env.interactionVersion())) return false;
    const item = applied.get(anchor.id);
    if (!item || item.start !== anchor.start || item.end !== anchor.end) { anchor = null; return false; }
    try { const rect = firstGlyphRect(item); if (!rect) return false; align(rect); return true; }
    catch (_) { anchor = null; return false; }
  }
  function show(payload) {
    const keys = IDENTITY.concat(['ownerGeneration', 'revision', 'showId', 'id', 'start', 'end']);
    if (!validBase(payload) || !exact(payload, keys) || payload.ownerGeneration !== owner || payload.revision !== appliedRevision
        || payload.revision !== latestRevision || transaction || !positive(payload.showId) || payload.showId <= latestShow || !validId(payload.id)) return false;
    const item = applied.get(payload.id);
    if (!item || payload.start !== item.start || payload.end !== item.end) return false;
    latestShow = payload.showId;
    try {
      const rect = firstGlyphRect(item);
      if (!rect) { send(payload, 'highlightShown', 'error', 'GEOMETRY_UNAVAILABLE'); return false; }
      env.observeScroll(); env.newIntent();
      anchor = { id: item.id, start: item.start, end: item.end, ownerGeneration: owner, version: env.interactionVersion ? env.interactionVersion() : null };
      align(rect);
      send(payload, 'highlightShown', 'applied'); return true;
    } catch (error) { send(payload, 'highlightShown', 'error', error.code || 'GEOMETRY_UNAVAILABLE'); return false; }
  }
  return { update: update, show: show, restore: restore, cancel: cancel };
}`;
module.exports = { HIGHLIGHT_RUNTIME_SOURCE };
