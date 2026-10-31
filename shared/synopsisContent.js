const { buildCanonicalDocument, resolveSectionReference } = require('./contentText');

const framingKinds = new Set(['prologue', 'induction', 'induction-scene', 'epilogue']);
const narrativeKinds = new Set(['act', 'scene', ...framingKinds]);
const nonblank = value => typeof value === 'string' && value.trim().length > 0;
const plain = value => nonblank(value) && !/<\/?[a-z][^>]*>/i.test(value)
  && !/\b(?:lorem ipsum|coming soon|not been written|TODO|TBD|placeholder)\b/i.test(value);
const wordCount = value => String(value || '').trim().split(/\s+/).filter(Boolean).length;

function validateSynopsisContent(synopsis, entry) {
  const errors = [];
  const error = message => errors.push(message);
  const play = entry?.play;
  if (!synopsis || typeof synopsis !== 'object' || !play || !Array.isArray(play.sections)) {
    return { errors: ['A synopsis package and its original play are required.'] };
  }
  const allowed = new Set(['schemaVersion', 'workId', 'contentVersion', 'canonicalTextVersion',
    'synopsisContentVersion', 'introduction', 'fullSynopsis', 'acts', 'framing', 'scenes']);
  if (Object.keys(synopsis).some(key => !allowed.has(key))) error('Unexpected synopsis fields.');
  if (synopsis.schemaVersion !== '2.0.0') error('Unsupported synopsis schema.');
  if (synopsis.workId !== play.id || synopsis.contentVersion !== play.contentVersion
      || synopsis.canonicalTextVersion !== play.canonicalTextVersion) error('Wrong work or original content version.');
  if (!/^[1-9]\d*\.\d+\.\d+$/.test(synopsis.synopsisContentVersion || '')) error('An independent synopsis content version is required.');
  if (!plain(synopsis.introduction)) error('A plain-text introduction is required.');
  if (!Array.isArray(synopsis.scenes) || synopsis.scenes.length !== 0) error('Scene-by-scene summaries are outside this schema.');
  const metadata = new Map(play.sections.map(section => [section.id, section]));
  const documents = new Map((entry.sections || []).map(section => [section.section?.id, section]));
  let canonical;
  try { canonical = buildCanonicalDocument({ play, sections: entry.sections }); }
  catch (_) { error('The original canonical work cannot be resolved.'); }
  function evidence(references, label, expected) {
    if (!Array.isArray(references) || references.length === 0) { error(`${label}: evidence is required.`); return; }
    const seen = new Set();
    for (const ref of references) {
      const section = metadata.get(ref?.sectionId);
      if (seen.has(ref?.sectionId)) error(`${label}: duplicate evidence.`);
      seen.add(ref?.sectionId);
      if (!section || !narrativeKinds.has(section.kind) || (expected && !expected(section))) {
        error(`${label}: evidence is outside the relevant source sections.`); continue;
      }
      const substantive = documents.get(section.id)?.content?.some(block => nonblank(block.text)
        && block.text.trim() !== String(section.heading || '').trim() && !/^h[1-6]$/.test(block.tag));
      if (!substantive) error(`${label}: a heading alone cannot support narrative claims.`);
      try { if (!canonical) throw Error(); resolveSectionReference(canonical, ref); }
      catch (_) { error(`${label}: evidence does not resolve to the original work and edition.`); }
    }
  }
  const fullParagraphs = Array.isArray(synopsis.fullSynopsis) ? synopsis.fullSynopsis : [];
  if (!Array.isArray(synopsis.fullSynopsis) || fullParagraphs.length === 0) error('A full synopsis is required.');
  const ids = new Set(), paragraphs = new Set();
  for (const paragraph of fullParagraphs) {
    if (!nonblank(paragraph?.id) || !paragraph.id.startsWith(`${play.id}-summary-`)
        || paragraph.id.length <= `${play.id}-summary-`.length || ids.has(paragraph.id)) {
      error('Full synopsis paragraph IDs must be unique and belong to this work.');
    }
    ids.add(paragraph?.id);
    if (!plain(paragraph?.text)) error('Full synopsis paragraphs must contain original plain prose.');
    const normalized = String(paragraph?.text || '').trim().replace(/\s+/g, ' ').toLowerCase();
    if (paragraphs.has(normalized)) error('Duplicate full synopsis paragraph.');
    paragraphs.add(normalized);
    evidence(paragraph?.evidence, paragraph?.id || 'Paragraph');
  }
  const expectedActs = (play.acts || []).map(act => act.act);
  const acts = Array.isArray(synopsis.acts) ? synopsis.acts : [];
  if (!Array.isArray(synopsis.acts) || acts.length !== expectedActs.length
      || acts.some((act, i) => act?.act !== expectedActs[i])) error('Act coverage must match the source in order.');
  for (const act of acts) {
    const section = metadata.get(act?.sectionId);
    if (!section || section.kind !== 'act' || section.act !== act.act || act.label !== section.heading) error('Act heading does not match the source.');
    if (!plain(act?.summary)) error('Every act needs a substantive plain-text summary.');
    evidence(act?.evidence, `Act ${act?.act}`, candidate => candidate.act === act.act);
  }
  const requiredFrames = play.sections.filter(section => framingKinds.has(section.kind)).map(section => section.id);
  const frames = Array.isArray(synopsis.framing) ? synopsis.framing : [];
  const covered = [];
  if (!Array.isArray(synopsis.framing)) error('Explicit framing coverage is required.');
  for (const frame of frames) {
    if (!plain(frame?.label) || !plain(frame?.summary) || !Array.isArray(frame?.sectionIds) || frame.sectionIds.length === 0) {
      error('Framing summaries need a label, prose, and actual source sections.'); continue;
    }
    covered.push(...frame.sectionIds);
    evidence(frame.evidence, frame.label);
    if (!Array.isArray(frame.evidence) || !frame.evidence.some(ref => frame.sectionIds.includes(ref?.sectionId))) {
      error(`${frame.label}: the actual framing source must support its summary.`);
    }
  }
  if (covered.length !== new Set(covered).size || covered.length !== requiredFrames.length
      || covered.some(id => !requiredFrames.includes(id))) error('Prologues, inductions, and epilogues must match the source.');
  return { errors, words: { introduction: wordCount(synopsis.introduction),
    fullSynopsis: fullParagraphs.reduce((sum, paragraph) => sum + wordCount(paragraph?.text), 0),
    acts: acts.map(act => wordCount(act.summary)) } };
}

function orderedSynopsisSections(synopsis, play) {
  const order = new Map((play?.sections || []).map(section => [section.id, section.orderInPlay]));
  return [
    ...(synopsis.acts || []).map(act => ({ id: act.sectionId, label: act.label, summary: act.summary, order: order.get(act.sectionId) })),
    ...(synopsis.framing || []).map(frame => ({ id: frame.sectionIds.join(':'), label: frame.label,
      summary: frame.summary, order: Math.min(...frame.sectionIds.map(id => order.get(id) ?? Infinity)) })),
  ].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
}

function getSynopsisContent(entry) {
  const result = validateSynopsisContent(entry?.synopsis, entry);
  if (result.errors.length) {
    const error = new Error('Synopsis unavailable for this play.');
    error.code = 'SYNOPSIS_UNAVAILABLE'; throw error;
  }
  return { ...entry.synopsis, title: entry.name || entry.play.title,
    summarySections: orderedSynopsisSections(entry.synopsis, entry.play) };
}

const escape = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
function renderSynopsisHtml(synopsis, title, play) {
  return [`<h1>${escape(title)}</h1>`, `<p>${escape(synopsis.introduction)}</p>`,
    '<h2>Full synopsis</h2><p>Plot spoilers, including the ending.</p>',
    ...(synopsis.fullSynopsis || []).map(paragraph => `<p>${escape(paragraph.text)}</p>`),
    '<h2>Act and framing summaries</h2>',
    ...orderedSynopsisSections(synopsis, play).map(section => `<h3>${escape(section.label)}</h3><p>${escape(section.summary)}</p>`),
  ].join('');
}

module.exports = { validateSynopsisContent, getSynopsisContent, orderedSynopsisSections, renderSynopsisHtml };
