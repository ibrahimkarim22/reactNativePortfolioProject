// Canonical text and references use JavaScript UTF-16 offsets throughout.
// Keep this module dependency-free so the same contract runs in React Native.
const CONTEXT_LENGTH = 32;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function nonemptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function workIdOf(play) {
  return play.id || (play.work && play.work.id) || play.slug;
}

function assertIdentity(document, reference) {
  // Revisions are checked before positions, endpoint IDs, or quotations.
  if (!reference || reference.contentVersion !== document.contentVersion) {
    fail('CONTENT_VERSION_MISMATCH', 'The reference belongs to a different content revision.');
  }
  if (reference.canonicalTextVersion !== document.canonicalTextVersion) {
    fail('CANONICAL_TEXT_VERSION_MISMATCH', 'The reference uses a different canonical text contract.');
  }
  if (reference.workId !== document.workId) {
    fail('WORK_MISMATCH', 'The reference belongs to a different work.');
  }
}

function buildCanonicalDocument({ play, sections }) {
  if (!play || !nonemptyString(workIdOf(play)) || !nonemptyString(play.contentVersion)
      || play.canonicalTextVersion !== '1' || !Array.isArray(play.sections) || !Array.isArray(sections)) {
    fail('INVALID_DOCUMENT', 'A versioned play and its ordered section references are required.');
  }
  const workId = workIdOf(play);
  const byId = new Map();
  for (const section of sections) {
    const id = section && section.section && section.section.id;
    if (!nonemptyString(id) || byId.has(id) || !Array.isArray(section.content)) {
      fail('INVALID_DOCUMENT', 'Section IDs must be unique and each section must contain content.');
    }
    byId.set(id, section);
  }
  const orderedSections = [];
  const referencedIds = new Set();
  for (const reference of play.sections) {
    const id = reference && reference.id;
    if (!byId.has(id) || referencedIds.has(id)) {
      fail('INVALID_DOCUMENT', 'Every play section reference must identify one section document.');
    }
    referencedIds.add(id);
    const section = byId.get(id);
    assertIdentity({ workId, contentVersion: play.contentVersion, canonicalTextVersion: play.canonicalTextVersion }, {
      workId: section.work && section.work.id,
      contentVersion: section.contentVersion,
      canonicalTextVersion: section.canonicalTextVersion,
    });
    orderedSections.push(section);
  }
  if (referencedIds.size !== byId.size) {
    fail('INVALID_DOCUMENT', 'Unreferenced section documents cannot enter the canonical work.');
  }

  const pieces = [];
  const units = [];
  const sectionRanges = [];
  const textIds = new Set();
  let remainingBlocks = orderedSections.reduce((count, section) => count + section.content.length, 0);
  let offset = 0;
  for (const section of orderedSections) {
    const sectionId = section.section.id;
    const sectionStart = offset;
    for (const block of section.content) {
      if (!block || !nonemptyString(block.id) || textIds.has(block.id)
          || typeof block.text !== 'string' || typeof block.separatorAfter !== 'string') {
        fail('INVALID_DOCUMENT', 'Text IDs must be unique and text/separators must be exact strings.');
      }
      textIds.add(block.id);
      remainingBlocks -= 1;
      const start = offset;
      pieces.push(block.text);
      offset += block.text.length;
      const textEnd = offset;
      // Only the final added separator is omitted; explicit breaks in text remain.
      if (remainingBlocks > 0) {
        pieces.push(block.separatorAfter);
        offset += block.separatorAfter.length;
      }
      units.push({ id: block.id, sectionId, start, textEnd, end: offset });
    }
    sectionRanges.push({ id: sectionId, start: sectionStart, end: offset });
  }
  return {
    workId,
    contentVersion: play.contentVersion,
    canonicalTextVersion: play.canonicalTextVersion,
    text: pieces.join(''),
    units,
    sections: sectionRanges,
  };
}

function splitsSurrogate(text, offset) {
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}

function assertRange(document, start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > document.text.length || start >= end) {
    fail('INVALID_RANGE', 'A nonempty UTF-16 range within the canonical work is required.');
  }
  if (splitsSurrogate(document.text, start) || splitsSurrogate(document.text, end)) {
    fail('SURROGATE_BOUNDARY', 'A selection endpoint cannot divide a UTF-16 surrogate pair.');
  }
}

function endpointReference(document, offset, isEnd) {
  // At a shared boundary the start belongs to the next unit and the end to
  // the preceding unit. Separators belong to their preceding source block.
  const unit = document.units.find(candidate => isEnd
    ? offset > candidate.start && offset <= candidate.end
    : offset >= candidate.start && offset < candidate.end);
  if (!unit) fail('ENDPOINT_REFERENCE_MISMATCH', 'The canonical offset has no mapped source text unit.');
  return { textId: unit.id, sectionId: unit.sectionId, offsetUtf16: offset - unit.start };
}

function contextFor(text, start, end) {
  let prefixStart = Math.max(0, start - CONTEXT_LENGTH);
  let suffixEnd = Math.min(text.length, end + CONTEXT_LENGTH);
  if (splitsSurrogate(text, prefixStart)) prefixStart += 1;
  if (splitsSurrogate(text, suffixEnd)) suffixEnd -= 1;
  return { prefix: text.slice(prefixStart, start), suffix: text.slice(end, suffixEnd) };
}

function createSelection(document, start, end) {
  assertRange(document, start, end);
  return {
    kind: 'text-range',
    workId: document.workId,
    contentVersion: document.contentVersion,
    canonicalTextVersion: document.canonicalTextVersion,
    offsetUnit: 'utf16',
    start,
    end,
    startRef: endpointReference(document, start, false),
    endRef: endpointReference(document, end, true),
    exact: document.text.slice(start, end),
    ...contextFor(document.text, start, end),
  };
}

function sameEndpoint(actual, expected) {
  return actual && actual.textId === expected.textId && actual.sectionId === expected.sectionId
    && actual.offsetUtf16 === expected.offsetUtf16;
}

function resolveSelection(document, selection) {
  assertIdentity(document, selection);
  if (selection.kind !== 'text-range' || selection.offsetUnit !== 'utf16') {
    fail('INVALID_SELECTION', 'A canonical UTF-16 text-range selection is required.');
  }
  const { start, end } = selection;
  assertRange(document, start, end);
  if (!sameEndpoint(selection.startRef, endpointReference(document, start, false))
      || !sameEndpoint(selection.endRef, endpointReference(document, end, true))) {
    fail('ENDPOINT_REFERENCE_MISMATCH', 'Endpoint references do not match the canonical positions.');
  }
  const text = document.text.slice(start, end);
  if (selection.exact !== text) fail('EXACT_MISMATCH', 'The selected text does not match the canonical range.');
  const context = contextFor(document.text, start, end);
  if (selection.prefix !== context.prefix || selection.suffix !== context.suffix) {
    fail('CONTEXT_MISMATCH', 'The surrounding text does not match the canonical range.');
  }
  return { start, end, text };
}

function findSection(document, sectionId) {
  const section = document.sections.find(candidate => candidate.id === sectionId);
  if (!section) fail('SECTION_NOT_FOUND', 'The section does not belong to this canonical work.');
  return section;
}

function createSectionReference(document, sectionId) {
  findSection(document, sectionId);
  return {
    kind: 'section',
    workId: document.workId,
    contentVersion: document.contentVersion,
    canonicalTextVersion: document.canonicalTextVersion,
    sectionId,
  };
}

function resolveSectionReference(document, reference) {
  assertIdentity(document, reference);
  if (reference.kind !== 'section') fail('INVALID_SELECTION', 'A whole-section reference is required.');
  const { start, end } = findSection(document, reference.sectionId);
  return { sectionId: reference.sectionId, start, end, text: document.text.slice(start, end) };
}

module.exports = {
  buildCanonicalDocument,
  createSelection,
  resolveSelection,
  createSectionReference,
  resolveSectionReference,
};
