// Fixed, application-owned source shared by Android and the sandboxed web reader.
const SELECTION_RUNTIME_SOURCE = String.raw`function installSelection(env, createSelectionDom) {
  'use strict';
  let adapter = null, mappingError = 'MAPPING_UNAVAILABLE';
  try { adapter = createSelectionDom(env.root, env.identity); }
  catch (error) { mappingError = error.code || 'INVALID_MAPPING'; }
  let revision = 0, latestRequest = 0, signature = null, scheduled = false, lastState = null, lastCode = null;
  let width = window.innerWidth, height = window.innerHeight;
  const reasons = ['cancel', 'appearance', 'contents', 'navigation', 'document', 'layout', 'font', 'dispose', 'modal'];
  const keys = Object.keys(env.identity);
  function valid(payload, extra) {
    return payload && keys.every(function (key) { return payload[key] === env.identity[key]; })
      && Object.keys(payload).every(function (key) { return keys.includes(key) || key === 'selectionRequestId' || key === extra; })
      && Number.isSafeInteger(payload.selectionRequestId) && payload.selectionRequestId > latestRequest;
  }
  function live() {
    const selection = typeof window.getSelection === 'function' ? window.getSelection() : null;
    if (!selection || !selection.rangeCount || selection.isCollapsed) return { signature: [], state: 'none', code: 'NO_SELECTION' };
    if (selection.rangeCount !== 1) return { signature: [selection.rangeCount], state: 'invalid', code: 'INVALID_SELECTION' };
    try {
      const range = selection.getRangeAt(0);
      const current = [range.startContainer, range.startOffset, range.endContainer, range.endOffset,
        selection.anchorNode, selection.anchorOffset, selection.focusNode, selection.focusOffset];
      if (!adapter) return { signature: current, state: 'invalid', code: mappingError };
      try { return { signature: current, state: 'range', selection: adapter.read(selection) }; }
      catch (error) { return { signature: current, state: 'invalid', code: error.code || 'INVALID_RANGE' }; }
    } catch (_) { return { signature: [null], state: 'invalid', code: 'INVALID_SELECTION' }; }
  }
  function observe() {
    const current = live();
    const code = current.state === 'invalid' ? current.code : null;
    if (!signature || current.state !== lastState || code !== lastCode || current.signature.length !== signature.length || current.signature.some(function (part, index) { return part !== signature[index]; })) {
      signature = current.signature.slice(); revision += 1;
      lastState = current.state; lastCode = code;
      env.send('selectionChange', { selectionRequestId: latestRequest, selectionSeq: revision, state: current.state,
        ...(current.state === 'invalid' ? { code: current.code } : {}) });
    }
    return current;
  }
  function invalidate(reason) {
    if (!reasons.includes(reason)) return false;
    const selection = typeof window.getSelection === 'function' ? window.getSelection() : null;
    if (selection && typeof selection.removeAllRanges === 'function') selection.removeAllRanges();
    signature = []; lastState = 'none'; lastCode = null; revision += 1;
    env.send('selectionChange', { selectionRequestId: latestRequest, selectionSeq: revision, state: 'none', code: 'CLEARED' });
    return true;
  }
  function captureSelection(payload) {
    if (!valid(payload, 'captureToken') || typeof payload.captureToken !== 'string'
        || !/^[\x21-\x7e]{1,128}$/.test(payload.captureToken)) return false;
    latestRequest = payload.selectionRequestId;
    // Always inspect the live endpoints now. A queued selectionchange is not authoritative.
    const current = observe();
    const result = { selectionRequestId: latestRequest, captureToken: payload.captureToken, selectionSeq: revision };
    if (current.state === 'range') env.send('selectionCapture', { ...result, status: 'captured', selection: current.selection });
    else env.send('selectionCapture', { ...result, status: 'rejected', code: current.code });
    return true;
  }
  function clearSelection(payload) {
    if (!valid(payload, 'reason') || !reasons.includes(payload.reason)) return false;
    latestRequest = payload.selectionRequestId;
    return invalidate(payload.reason);
  }
  document.addEventListener('selectionchange', function () {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(function () { scheduled = false; observe(); });
  });
  window.addEventListener('resize', function () {
    if (width === window.innerWidth && height === window.innerHeight) return;
    width = window.innerWidth; height = window.innerHeight; invalidate('layout');
  });
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', function () { invalidate('font'); });
  if (typeof ResizeObserver !== 'undefined' && env.root && env.root.getBoundingClientRect) {
    let previous = env.root.getBoundingClientRect();
    new ResizeObserver(function () {
      const next = env.root.getBoundingClientRect();
      if (previous.width !== next.width || previous.height !== next.height) invalidate('layout');
      previous = next;
    }).observe(env.root);
  }
  return { captureSelection: captureSelection, clearSelection: clearSelection, invalidate: invalidate };
}`;

module.exports = { SELECTION_RUNTIME_SOURCE };
