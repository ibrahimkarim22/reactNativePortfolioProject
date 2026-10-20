const { buildCanonicalDocument } = require('../shared/contentText');
const { DEFAULT_PREFERENCES, THEMES } = require('./readerConstants');
const { createReaderRuntimeScript } = require('./readerRuntime');

const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'blockquote']);
const INLINE_TAGS = new Set(['b', 'i', 'em', 'strong', 'u', 's', 'sup', 'sub', 'small', 'span', 'code']);
const SOURCE_CLASSES = new Set(['scenedesc', 'drama', 'right', 'center', 'letter', 'noindent', 'charname']);
const escapeHtml = value => String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const attributes = values => Object.entries(values).map(([key, value]) => ` ${key}="${escapeHtml(value)}"`).join('');
const classesOf = item => Array.isArray(item.classes) ? item.classes.filter(value => typeof value === 'string') : typeof item.className === 'string' ? item.className.split(/\s+/).filter(Boolean) : [];

function splitsSurrogate(text, offset) {
  return offset > 0 && offset < text.length && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]);
}

function renderText(block) {
  const text = block.text;
  const spans = (Array.isArray(block.spans) ? block.spans : []).map((span, index) => ({ ...span, index }))
    .filter(span => Number.isInteger(span.start) && Number.isInteger(span.end) && span.start >= 0 && span.end <= text.length && span.start < span.end && !splitsSurrogate(text, span.start) && !splitsSurrogate(text, span.end));
  const cue = block.attribution;
  if (cue && cue.status === 'explicit' && typeof block.speakerLabel === 'string' && Number.isInteger(cue.cueStart) && Number.isInteger(cue.cueEnd)
      && cue.cueStart >= 0 && cue.cueEnd <= text.length && cue.cueStart < cue.cueEnd && text.slice(cue.cueStart, cue.cueEnd) === block.speakerLabel
      && !splitsSurrogate(text, cue.cueStart) && !splitsSurrogate(text, cue.cueEnd)) spans.push({ tag: 'strong', start: cue.cueStart, end: cue.cueEnd, index: 'cue', cue: true });
  const boundaries = [...new Set([0, text.length, ...spans.flatMap(span => [span.start, span.end])])].sort((a, b) => a - b);
  let active = [], html = '';
  const tagOf = span => INLINE_TAGS.has(span.tag) ? span.tag : 'span';
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index], end = boundaries[index + 1];
    const next = spans.filter(span => span.start <= start && span.end >= end).sort((a, b) => a.start - b.start || b.end - a.end || (a.cue ? -1 : b.cue ? 1 : a.index - b.index));
    let shared = 0;
    while (shared < active.length && shared < next.length && active[shared].index === next[shared].index) shared += 1;
    for (let closing = active.length - 1; closing >= shared; closing -= 1) html += `</${tagOf(active[closing])}>`;
    for (let opening = shared; opening < next.length; opening += 1) {
      const span = next[opening];
      const sourceClasses = classesOf(span);
      const mapped = sourceClasses.filter(value => SOURCE_CLASSES.has(value));
      html += `<${tagOf(span)}${attributes(span.cue ? { 'data-reader-cue': 'true', 'data-cue-start': span.start, 'data-cue-end': span.end } : { 'data-span-index': span.index, 'data-source-tag': span.tag || '', 'data-source-classes': JSON.stringify(sourceClasses), ...(mapped.length ? { class: mapped.join(' ') } : {}) })}>`;
    }
    html += escapeHtml(text.slice(start, end));
    active = next;
  }
  for (let closing = active.length - 1; closing >= 0; closing -= 1) html += `</${tagOf(active[closing])}>`;
  return html;
}

function semanticRole(block, section) {
  if (block.type === 'heading' && !/^h[1-6]$/.test(block.tag)) return 'heading';
  if (/^h[1-6]$/.test(block.tag)) {
    if (section.section.kind === 'title' || (section.section.kind === 'frontmatter' && (block.tag === 'h1' || block.tag === 'h2'))) return 'title';
    if (section.section.kind === 'cast') return 'cast';
    if (section.section.kind === 'act' || /^ACT(?:\s|$)/.test(block.text)) return 'act';
    if (section.section.kind === 'scene' || /^SCENE(?:\s|$)/.test(block.text)) return 'scene';
    return 'heading';
  }
  return classesOf(block).includes('scenedesc') ? 'stage' : 'body';
}

function boundaryOf(separator) {
  if (separator === '\n\n') return 'paragraph';
  if (separator === '\n') return 'line';
  if (separator === '\t') return 'tab';
  return separator === '' ? 'none' : 'mapped';
}

function styles() {
  const theme = THEMES.paper;
  return `:root{--reader-font-family:"Literata",serif;--reader-font-size:${DEFAULT_PREFERENCES.fontSize}px;--reader-font-scale:1;--reader-line-height:1.6;${Object.entries(theme).map(([key, value]) => `--reader-${key}:${value};`).join('')}}
*{box-sizing:border-box}html{background:var(--reader-background);color:var(--reader-text);overflow-anchor:none;-webkit-text-size-adjust:100%;text-size-adjust:100%}body{margin:0;padding:0;font-family:var(--reader-font-family);font-size:calc(var(--reader-font-size) * var(--reader-font-scale));line-height:var(--reader-line-height);overflow-wrap:break-word}main{max-width:688px;margin:0 auto;padding:24px} [data-reader-block]{white-space:pre-wrap;tab-size:4;margin:0;font-size:inherit;line-height:inherit;font-weight:400;min-width:0} [data-boundary="paragraph"]{margin-bottom:12px}[data-boundary="tab"]{display:inline-block;padding-right:1.5em}[data-boundary="line"]{display:block} [data-reader-role="title"]{font-size:1.6em;line-height:1.25;text-align:center;font-weight:700;margin:0 0 16px} [data-reader-role="act"],[data-reader-role="cast"],[data-reader-role="heading"]{font-size:1.2em;line-height:1.333333;font-weight:700;text-align:center;margin:40px 0 16px} [data-reader-role="scene"]{font-size:1.05em;line-height:1.380953;font-weight:700;margin:40px 0 16px} [data-reader-role="stage"]{color:var(--reader-secondary)}[data-reader-cue]{font-size:inherit;font-weight:700}[data-reader-block].right{text-align:right}[data-reader-block].center{text-align:center}[data-reader-block].letter{margin-left:1em}[data-reader-block].scenedesc{color:var(--reader-secondary)}.charname{font-variant:small-caps} [data-reader-block]:last-child{margin-bottom:0} @media(max-width:359px){main{padding:24px 20px}}`;
}

function createReaderDocument(entry, options) {
  if (!options || typeof options.documentId !== 'string' || !options.documentId.length || options.documentId.length > 512) throw new Error('A bounded reader documentId is required.');
  const canonical = buildCanonicalDocument({ play: entry && entry.play, sections: entry && entry.sections });
  const identity = { documentId: options.documentId, workId: canonical.workId, contentVersion: canonical.contentVersion, canonicalTextVersion: canonical.canonicalTextVersion };
  const sectionsById = new Map(entry.sections.map(section => [section.section.id, section]));
  const blocks = entry.play.sections.flatMap(reference => sectionsById.get(reference.id).content.map(block => ({ block, section: sectionsById.get(reference.id) })));
  const body = blocks.map(({ block, section }, index) => {
    const unit = canonical.units[index];
    const separator = canonical.text.slice(unit.textEnd, unit.end);
    const sourceClasses = classesOf(block);
    const mapped = sourceClasses.filter(value => SOURCE_CLASSES.has(value));
    const tag = block.type === 'heading' && !/^h[1-6]$/.test(block.tag) ? 'h4' : BLOCK_TAGS.has(block.tag) ? block.tag : block.tag === 'td' || block.tag === 'th' ? 'span' : 'p';
    return `<${tag}${attributes({ 'data-reader-block': 'true', 'data-text-id': unit.id, 'data-section-id': unit.sectionId, 'data-start': unit.start, 'data-text-end': unit.textEnd, 'data-end': unit.end, 'data-separator': separator, 'data-boundary': boundaryOf(separator), 'data-reader-role': semanticRole(block, section), 'data-source-tag': block.tag || '', 'data-source-classes': JSON.stringify(sourceClasses), ...(mapped.length ? { class: mapped.join(' ') } : {}) })}>${renderText(block)}</${tag}>`;
  }).join('');
  const csp = "default-src 'none'; script-src 'nonce-bard-reader-v1'; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; img-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}"><title>${escapeHtml(entry.play.title || entry.play.id)}</title><style>${styles()}</style></head><body><main>${body}</main><script nonce="bard-reader-v1">${createReaderRuntimeScript(identity)}</script></body></html>`;
  return { html, identity, canonical };
}

module.exports = { createReaderDocument };
