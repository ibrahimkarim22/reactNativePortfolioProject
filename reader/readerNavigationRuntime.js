// Fixed application-owned source, composed without Function.toString (Hermes).
const NAVIGATION_RUNTIME_SOURCE = String.raw`function installNavigation(env) {
  'use strict';
  let targets = [], byId = Object.create(null), currentId = null;
  let locationSeq = 0, latestNavigation = 0, anchor = null, frame = null, timer = null;
  let lastSent = 0;
  env.blocks.forEach(function (block) {
    let id = block.getAttribute('data-section-id');
    if (typeof id === 'string' && id.length && id.length <= 512 && !byId[id]) {
      let target = { id: id, block: block };
      byId[id] = target; targets.push(target);
    }
  });
  function valid(payload) {
    return payload && Object.keys(payload).every(function (key) {
      return Object.keys(env.identity).includes(key) || key === 'navigationId' || key === 'sectionId';
    }) && Object.keys(env.identity).every(function (key) { return payload[key] === env.identity[key]; })
      && Number.isSafeInteger(payload.navigationId) && payload.navigationId > 0
      && typeof payload.sectionId === 'string' && Object.prototype.hasOwnProperty.call(byId, payload.sectionId);
  }
  function readingLine() { return Math.min(24, (window.innerHeight || 400) / 5); }
  function measure(forceId) {
    if (!targets.length) return;
    let line = readingLine(), height = window.innerHeight || 0;
    let tops = targets.map(function (target) { return target.block.getBoundingClientRect().top; });
    let index = 0;
    for (let i = 0; i < tops.length; i += 1) if (tops[i] <= line) index = i;
    let y = window.scrollY || window.pageYOffset || 0;
    let total = Math.max(document.documentElement.scrollHeight || 0, document.body.scrollHeight || 0);
    let atBottom = y > 0 && y + height >= total - 2 && tops[tops.length - 1] < height;
    if (atBottom) index = targets.length - 1;
    let previous = targets.findIndex(function (target) { return target.id === currentId; });
    if (!forceId && !atBottom && previous >= 0) {
      if (index > previous && tops[index] > line - 2) index = previous;
      else if (index < previous && tops[previous] <= line + 2) index = previous;
    }
    let id = forceId && byId[forceId] ? forceId : targets[index].id;
    if (id === currentId) return;
    currentId = id;
    env.send('location', { sectionId: id, locationSeq: ++locationSeq });
    lastSent = Date.now();
  }
  function refresh() {
    if (frame != null || timer != null) return;
    let pending = true;
    let handle = window.requestAnimationFrame(function () {
      pending = false; frame = null;
      let remaining = 100 - (Date.now() - lastSent);
      if (remaining > 0) timer = setTimeout(function () { timer = null; measure(); }, remaining);
      else measure();
    });
    if (pending) frame = handle;
  }
  function align() {
    env.observeScroll();
    if (!anchor || anchor.version !== env.interactionVersion()) return false;
    let block = byId[anchor.sectionId].block;
    let y = (window.scrollY || window.pageYOffset || 0) + block.getBoundingClientRect().top - readingLine();
    let max = Math.max(0, Math.max(document.documentElement.scrollHeight || 0, document.body.scrollHeight || 0) - (window.innerHeight || 0));
    window.scrollTo(0, Math.max(0, Math.min(max, y)));
    env.markOwnScroll();
    return true;
  }
  function cancel() { anchor = null; }
  function jumpToSection(payload) {
    if (!valid(payload) || payload.navigationId <= latestNavigation) return false;
    env.observeScroll();
    latestNavigation = payload.navigationId;
    env.newIntent();
    anchor = { sectionId: payload.sectionId, navigationId: payload.navigationId, version: env.interactionVersion() };
    align(); measure(payload.sectionId);
    env.layout().then(function () {
      env.observeScroll();
      if (!anchor || anchor.navigationId !== payload.navigationId || anchor.version !== env.interactionVersion()) return;
      align(); measure(payload.sectionId);
      env.send('jumped', { sectionId: payload.sectionId, navigationId: payload.navigationId });
    });
    return true;
  }
  function focusSection(payload) {
    env.observeScroll();
    if (!valid(payload) || payload.navigationId !== latestNavigation || !anchor
        || anchor.sectionId !== payload.sectionId || anchor.version !== env.interactionVersion()) return false;
    let block = byId[payload.sectionId].block;
    block.setAttribute('tabindex', '-1');
    if (typeof block.focus === 'function') block.focus({ preventScroll: true });
    return true;
  }
  function reflow() { align(); refresh(); }
  window.addEventListener('scroll', refresh, { passive: true });
  window.addEventListener('resize', function () { env.layout().then(reflow); });
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', function () { env.layout().then(reflow); });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(function () { env.layout().then(reflow); }).observe(document.body);
  return { jumpToSection: jumpToSection, focusSection: focusSection, cancel: cancel, reflow: reflow, restore: align, refresh: refresh };
}`;

module.exports = { NAVIGATION_RUNTIME_SOURCE };
