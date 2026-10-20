const { THEMES, FONTS, LINE_SPACING } = require('./readerConstants');
const { scriptJson } = require('./readerProtocol');

// A fixed application-owned program survives Hermes bytecode and Metro transforms.
// Keep the WebView runtime here once, as source data rather than a native function.
const READER_RUNTIME_SOURCE = String.raw`function installReader(identity, themes, fonts, spacing) {
  'use strict';
  let latestRequest = 0;
  // A burst of requests shares the point captured before its first reflow.
  let pendingPoint = null;
  let interactionVersion = 0;
  let observedScrollY = window.scrollY || window.pageYOffset || 0;
  let own = function (object, key) { return Object.prototype.hasOwnProperty.call(object, key); };
  let blocks = Array.prototype.slice.call(document.querySelectorAll('[data-reader-block]'));
  const fontCache = Object.create(null);

  function userInteraction() {
    interactionVersion += 1;
    pendingPoint = null;
  }

  function observeScroll() {
    const position = window.scrollY || window.pageYOffset || 0;
    if (position !== observedScrollY) {
      observedScrollY = position;
      userInteraction();
    }
  }

  function diagnostics() {
    let last = blocks[blocks.length - 1];
    let rect = last ? last.getBoundingClientRect() : null;
    return {
      viewportHeight: window.innerHeight || 0,
      viewportWidth: window.innerWidth || 0,
      scrollY: window.scrollY || window.pageYOffset || 0,
      scrollHeight: Math.max(document.documentElement.scrollHeight || 0, document.body.scrollHeight || 0),
      finalTextTop: rect ? rect.top : 0,
      finalTextBottom: rect ? rect.bottom : 0,
    };
  }

  function send(type, values) {
    let message = Object.assign({}, identity, { type: type }, values || {});
    let raw = JSON.stringify(message);
    if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function') window.ReactNativeWebView.postMessage(raw);
    else if (window.parent && window.parent !== window) window.parent.postMessage(raw, '*');
  }

  function textNodes(block) {
    let walker = document.createTreeWalker(block, 4);
    let nodes = [], node;
    while ((node = walker.nextNode())) nodes.push(node);
    return nodes;
  }

  function blockOf(node) {
    let element = node && (node.nodeType === 1 ? node : node.parentElement);
    return element && element.closest ? element.closest('[data-reader-block]') : null;
  }

  function localOffset(block, node, offset) {
    let nodes = textNodes(block), result = 0;
    for (let i = 0; i < nodes.length; i += 1) {
      if (nodes[i] === node) return result + Math.min(offset, nodes[i].textContent.length);
      result += nodes[i].textContent.length;
    }
    return 0;
  }

  function rangeAt(block, offset) {
    let nodes = textNodes(block), remaining = offset;
    for (let i = 0; i < nodes.length; i += 1) {
      let length = nodes[i].textContent.length;
      if (remaining < length || i === nodes.length - 1) {
        let range = document.createRange();
        let position = Math.min(Math.max(0, remaining), Math.max(0, length - 1));
        let text = nodes[i].textContent;
        if (position > 0 && /[\uDC00-\uDFFF]/.test(text[position]) && /[\uD800-\uDBFF]/.test(text[position - 1])) position -= 1;
        let width = /[\uD800-\uDBFF]/.test(text[position]) && /[\uDC00-\uDFFF]/.test(text[position + 1]) ? 2 : 1;
        range.setStart(nodes[i], position);
        // A one-character range has a useful rect in WebKit as well as Android.
        range.setEnd(nodes[i], Math.min(position + width, length));
        return range;
      }
      remaining -= length;
    }
    return null;
  }

  function capturePoint() {
    let x = window.innerWidth < 360 ? 21 : 25;
    let y = Math.min(80, (window.innerHeight || 400) * 0.2);
    let caret = null;
    try {
      if (document.caretRangeFromPoint) caret = document.caretRangeFromPoint(x, y);
      else if (document.caretPositionFromPoint) {
        let position = document.caretPositionFromPoint(x, y);
        if (position) { caret = document.createRange(); caret.setStart(position.offsetNode, position.offset); }
      }
      let block = caret && blockOf(caret.startContainer);
      if (block && caret.startContainer.nodeType === 3) {
        let offset = localOffset(block, caret.startContainer, caret.startOffset);
        let range = rangeAt(block, offset);
        let rect = range && range.getBoundingClientRect();
        if (rect && Number.isFinite(rect.top) && rect.bottom > rect.top) return { textId: block.getAttribute('data-text-id'), offsetUtf16: offset, viewportOffset: rect.top, blockOffset: block.getBoundingClientRect().top };
      }
    } catch (_) { /* A missing caret uses the source block fallback below. */ }
    for (let i = 0; i < blocks.length; i += 1) {
      let bounds = blocks[i].getBoundingClientRect();
      if (bounds.bottom > 0) return { textId: blocks[i].getAttribute('data-text-id'), offsetUtf16: 0, viewportOffset: bounds.top, blockOffset: bounds.top, blockOnly: true };
    }
    return null;
  }

  function restorePoint(point) {
    if (!point) return;
    let block = blocks.find(function (candidate) { return candidate.getAttribute('data-text-id') === point.textId; });
    if (!block) return;
    let rect;
    if (!point.blockOnly) {
      let range = rangeAt(block, point.offsetUtf16);
      rect = range && range.getBoundingClientRect();
    }
    let target = rect && Number.isFinite(rect.top) && rect.bottom > rect.top ? rect.top - point.viewportOffset : block.getBoundingClientRect().top - point.blockOffset;
    window.scrollTo(0, Math.max(0, (window.scrollY || window.pageYOffset || 0) + target));
    // An eventual scroll event caused by our own restoration is not a new
    // reading gesture and must not invalidate the next appearance request.
    observedScrollY = window.scrollY || window.pageYOffset || 0;
  }

  function valid(payload) {
    if (!payload || !Object.keys(identity).every(function (key) { return payload[key] === identity[key]; })
        || !Number.isSafeInteger(payload.requestId) || payload.requestId < 1 || payload.requestId <= latestRequest) return false;
    let p = payload.preferences;
    if (!p || p.schemaVersion !== 1 || !own(fonts, p.fontId) || !own(themes, p.theme) || !own(spacing, p.lineSpacing)
        || !Number.isInteger(p.fontSize) || p.fontSize < 16 || p.fontSize > 30 || p.fontSize % 2
        || !Number.isFinite(payload.fontScale) || payload.fontScale <= 0 || payload.fontScale > 10) return false;
    let faces = payload.fontFaces;
    if (faces !== undefined && (!Array.isArray(faces) || faces.length > 4 || faces.some(function (face) {
      return !face || (face.weight !== 400 && face.weight !== 700) || (face.style !== 'normal' && face.style !== 'italic')
        || typeof face.data !== 'string' || !face.data.length || face.data.length > 2 * 1024 * 1024 || face.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(face.data);
    }))) return false;
    return !faces || new Set(faces.map(function (face) { return face.weight + ':' + face.style; })).size === faces.length;
  }

  function layout() {
    return new Promise(function (resolve) { window.requestAnimationFrame(function () { window.requestAnimationFrame(resolve); }); });
  }

  function loadFontFamily(fontId, faces) {
    if (fontCache[fontId]) return fontCache[fontId];
    if (!faces || !faces.length) return Promise.resolve(fonts[fontId].family);
    const family = 'BardReader_' + fontId.replace(/-/g, '_');
    // Curated font IDs identify immutable bundled bytes for this document's life.
    // Different requests share both the pending load and its registered faces.
    const pending = Promise.all(faces.map(function (face) {
      return new FontFace(family, 'url(data:font/ttf;base64,' + face.data + ')', { weight: String(face.weight), style: face.style }).load();
    })).then(function (loaded) {
      loaded.forEach(function (face) { document.fonts.add(face); });
      return family;
    }).catch(function (error) {
      delete fontCache[fontId];
      throw error;
    });
    fontCache[fontId] = pending;
    return pending;
  }

  async function applyAppearance(payload) {
    if (!valid(payload)) return false;
    let requestId = payload.requestId;
    latestRequest = requestId;
    observeScroll();
    let point = pendingPoint ? pendingPoint.point : capturePoint();
    let pointVersion = pendingPoint ? pendingPoint.version : interactionVersion;
    pendingPoint = { point: point, version: pointVersion };
    try {
      const family = await loadFontFamily(payload.preferences.fontId, payload.fontFaces);
      if (requestId !== latestRequest) return false;
      // Native accessibility scrolling can arrive without a touch event, and
      // the browser's scroll event may still be queued when the font resolves.
      observeScroll();
      if (pointVersion !== interactionVersion) {
        point = capturePoint();
        pointVersion = interactionVersion;
        pendingPoint = { point: point, version: pointVersion };
      }
      let style = document.documentElement.style;
      let preferences = payload.preferences;
      style.setProperty('--reader-font-family', '"' + family + '", ' + (preferences.fontId === 'source-sans-3' ? 'sans-serif' : 'serif'));
      style.setProperty('--reader-font-size', preferences.fontSize + 'px');
      style.setProperty('--reader-font-scale', String(payload.fontScale));
      style.setProperty('--reader-line-height', String(spacing[preferences.lineSpacing]));
      Object.keys(themes[preferences.theme]).forEach(function (key) { style.setProperty('--reader-' + key, themes[preferences.theme][key]); });
      observedScrollY = window.scrollY || window.pageYOffset || 0;
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      if (requestId !== latestRequest) return false;
      await layout();
      if (requestId !== latestRequest) return false;
      observeScroll();
      if (pointVersion === interactionVersion) restorePoint(point);
      pendingPoint = null;
      send('applied', { requestId: requestId, diagnostics: diagnostics() });
      return true;
    } catch (_) {
      if (requestId === latestRequest) {
        observeScroll();
        if (pointVersion === interactionVersion) restorePoint(point);
        pendingPoint = null;
        send('error', { requestId: requestId, code: 'FONT_LOAD_FAILED', message: 'The local reading font could not be applied.' });
      }
      return false;
    }
  }

  window.BardReader = Object.freeze({ applyAppearance: applyAppearance });
  window.addEventListener('message', function (event) {
    if (event.source !== window.parent || !event.data || event.data.type !== 'bard-reader-appearance') return;
    applyAppearance(event.data.payload);
  });
  window.addEventListener('scroll', observeScroll, { passive: true });
  ['touchstart', 'pointerdown', 'wheel', 'keydown'].forEach(function (type) {
    window.addEventListener(type, userInteraction, { passive: true });
  });
  document.addEventListener('click', function (event) {
    if (event.target && event.target.closest && event.target.closest('a')) event.preventDefault();
  });
  send('ready', { diagnostics: diagnostics() });
}`;

function createReaderRuntimeScript(identity) {
  return '(' + READER_RUNTIME_SOURCE + ')(' + [identity, THEMES, FONTS, LINE_SPACING].map(scriptJson).join(',') + ');';
}

module.exports = { createReaderRuntimeScript };
