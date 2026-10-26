const { createSectionReference } = require('../shared/contentText');

const FRONT_MATTER = new Set(['title', 'contents', 'cast', 'setting', 'frontmatter']);
const SPECIAL_LABELS = {
  title: 'Title', contents: 'Original contents', cast: 'Cast', setting: 'Setting', frontmatter: 'Front matter',
  prologue: 'Prologue', epilogue: 'Epilogue', induction: 'Induction',
};
const KINDS = new Set([...Object.keys(SPECIAL_LABELS), 'act', 'scene', 'induction-scene']);
const METADATA = ['kind', 'act', 'scene', 'parentSectionId', 'heading', 'orderInPlay'];

function invalid(message) {
  const error = new Error(message);
  error.code = 'INVALID_NAVIGATION';
  throw error;
}

const isId = value => typeof value === 'string' && value.length > 0;
const isOrdinal = value => Number.isInteger(value) && value > 0 && value < 4000;

function roman(value) {
  let remaining = value;
  let result = '';
  for (const [amount, numeral] of [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]) {
    while (remaining >= amount) {
      result += numeral;
      remaining -= amount;
    }
  }
  return result;
}

function sectionLabel(section) {
  if (section.kind === 'act') return `Act ${roman(section.act)}`;
  if (section.kind === 'scene' || section.kind === 'induction-scene') return `Scene ${roman(section.scene)}`;
  return SPECIAL_LABELS[section.kind];
}

function validateSection(section, reference) {
  if (!KINDS.has(section.kind)) invalid('The source section kind is not supported.');
  for (const field of METADATA) {
    if (Object.hasOwn(reference, field) && reference[field] !== section[field]) invalid(`The section reference disagrees with its source ${field}.`);
  }
  if (section.heading !== undefined && typeof section.heading !== 'string') invalid('A source heading must be a string.');
  if (section.act != null && !isOrdinal(section.act)) invalid('An act number must be a positive source integer.');
  if (section.scene != null && !isOrdinal(section.scene)) invalid('A scene number must be a positive source integer.');
  if (['act', 'scene'].includes(section.kind) && !isOrdinal(section.act)) invalid('A numbered section requires its source act number.');
  if (['scene', 'induction-scene'].includes(section.kind) && !isOrdinal(section.scene)) invalid('A numbered scene requires its source scene number.');
  if (section.kind === 'induction-scene' && section.act != null) invalid('An induction scene has no numbered act.');
  if (section.parentSectionId != null && !isId(section.parentSectionId)) invalid('A source parent section ID must be nonempty.');
}

function buildReaderNavigation(entry, canonical) {
  const play = entry && entry.play;
  const workId = play && (play.id || (play.work && play.work.id) || play.slug);
  if (!play || !isId(workId) || !isId(play.contentVersion) || play.canonicalTextVersion !== '1'
      || !Array.isArray(play.sections) || !Array.isArray(entry.sections) || !canonical
      || !Array.isArray(canonical.sections) || !Array.isArray(canonical.units)) invalid('A source entry and its canonical document are required.');
  if (canonical.workId !== workId || canonical.contentVersion !== play.contentVersion || canonical.canonicalTextVersion !== play.canonicalTextVersion) invalid('The canonical navigation document belongs to another work or revision.');

  const sourceById = new Map();
  for (const document of entry.sections) {
    const section = document && document.section;
    if (!section || !isId(section.id) || sourceById.has(section.id) || !Array.isArray(document.content) || !document.content.length) invalid('Every navigation section needs a unique ID and a source opening.');
    if (!document.work || document.work.id !== workId || document.contentVersion !== play.contentVersion || document.canonicalTextVersion !== play.canonicalTextVersion) invalid('A section document belongs to another work or revision.');
    sourceById.set(section.id, document);
  }
  if (sourceById.size !== play.sections.length || canonical.sections.length !== play.sections.length) invalid('Source and canonical sections must match the play section list.');

  const items = [];
  const priorItems = new Map();
  let unitIndex = 0;
  for (const [index, reference] of play.sections.entries()) {
    const document = reference && sourceById.get(reference.id);
    if (!document || priorItems.has(reference.id)) invalid('Every ordered source reference must identify exactly one section.');
    const section = document.section;
    validateSection(section, reference);
    if (!canonical.sections[index] || canonical.sections[index].id !== section.id) invalid('Canonical section order must match source order.');

    const firstUnit = canonical.units[unitIndex];
    for (const block of document.content) {
      const unit = canonical.units[unitIndex++];
      if (!unit || !isId(block.id) || unit.id !== block.id || unit.sectionId !== section.id) invalid('A canonical destination must identify its actual source block and section.');
    }
    const parentSectionId = section.parentSectionId == null ? null : section.parentSectionId;
    const parent = parentSectionId === null ? null : priorItems.get(parentSectionId);
    if (parentSectionId !== null && !parent) invalid('A section parent must precede its child in source order.');
    if (section.kind === 'scene' && (!parent || parent.kind !== 'act' || parent.act !== section.act)) invalid('A scene must belong to its source act.');
    if (section.kind === 'induction-scene' && (!parent || parent.kind !== 'induction')) invalid('An induction scene must belong to its source induction.');
    const label = sectionLabel(section);
    const item = {
      id: section.id,
      textId: firstUnit.id,
      kind: section.kind,
      act: section.act == null ? null : section.act,
      scene: section.scene == null ? null : section.scene,
      parentSectionId,
      label,
      locationLabel: parent ? `${parent.label} · ${label}` : label,
      sourceHeading: section.heading || '',
      frontMatter: FRONT_MATTER.has(section.kind),
      reference: createSectionReference(canonical, section.id),
    };
    items.push(item);
    priorItems.set(item.id, item);
  }
  if (unitIndex !== canonical.units.length) invalid('Unowned canonical units cannot supply navigation destinations.');
  return { items, initialSectionId: items.length ? items[0].id : null };
}

module.exports = { buildReaderNavigation };
