const { resolveSelection } = require('../shared/contentText');

const nonblank = value => typeof value === 'string' && value.trim().length > 0;
const stableId = value => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const revision = value => typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function isSourceLinkedQuiz(content) {
  if (!content || typeof content !== 'object') return false;
  return ['quizContentVersion', 'workId', 'contentVersion', 'canonicalTextVersion'].some(field => own(content, field))
    || own(content, 'schemaVersion') && content.schemaVersion !== '1.0.0';
}

function cloneEvidence(evidence) {
  return Object.freeze({
    kind: evidence.kind,
    workId: evidence.workId,
    contentVersion: evidence.contentVersion,
    canonicalTextVersion: evidence.canonicalTextVersion,
    offsetUnit: evidence.offsetUnit,
    start: evidence.start,
    end: evidence.end,
    startRef: Object.freeze({ textId: evidence.startRef.textId, sectionId: evidence.startRef.sectionId,
      offsetUtf16: evidence.startRef.offsetUtf16 }),
    endRef: Object.freeze({ textId: evidence.endRef.textId, sectionId: evidence.endRef.sectionId,
      offsetUtf16: evidence.endRef.offsetUtf16 }),
    exact: evidence.exact,
    prefix: evidence.prefix,
    suffix: evidence.suffix,
  });
}

// Structural and canonical validity do not establish editorial correctness.
// Return null for unavailable/stale content and clone every retained object so
// callers can keep their own input mutable without changing an active quiz.
function validateQuizContent(content, canonical) {
  if (!record(content) || content.schemaVersion !== '2.0.0' || !stableId(content.id)
      || !revision(content.quizContentVersion) || !canonical || typeof canonical.text !== 'string'
      || !Array.isArray(canonical.units) || !Array.isArray(canonical.sections)
      || !nonblank(content.workId) || content.workId !== canonical.workId
      || !nonblank(content.contentVersion) || content.contentVersion !== canonical.contentVersion
      || content.canonicalTextVersion !== '1' || content.canonicalTextVersion !== canonical.canonicalTextVersion
      || !Array.isArray(content.questions) || content.questions.length === 0) return null;

  const questionIds = new Set(), questions = [];
  for (const question of Array.from(content.questions)) {
    if (!record(question) || !stableId(question.id) || questionIds.has(question.id)
        || !nonblank(question.question) || !nonblank(question.explanation)
        || !Array.isArray(question.options) || question.options.length !== 4
        || !Array.isArray(question.evidence) || question.evidence.length === 0) return null;
    questionIds.add(question.id);

    const options = [], optionTexts = new Set();
    for (const [index, option] of Array.from(question.options).entries()) {
      if (!record(option) || option.id !== `${question.id}.${'abcd'[index]}`
          || !nonblank(option.text) || optionTexts.has(option.text.trim())) return null;
      optionTexts.add(option.text.trim());
      options.push(Object.freeze({ id: option.id, text: option.text }));
    }
    if (!options.some(option => option.id === question.correctOptionId)) return null;

    const evidence = [];
    for (const selection of Array.from(question.evidence)) {
      if (!record(selection) || !record(selection.startRef) || !record(selection.endRef)
          || !nonblank(selection.exact) || typeof selection.prefix !== 'string' || typeof selection.suffix !== 'string') return null;
      try {
        resolveSelection(canonical, selection);
      } catch (_) {
        return null;
      }
      evidence.push(cloneEvidence(selection));
    }
    questions.push(Object.freeze({ id: question.id, question: question.question, options: Object.freeze(options),
      correctOptionId: question.correctOptionId, explanation: question.explanation, evidence: Object.freeze(evidence) }));
  }
  return Object.freeze({ schemaVersion: content.schemaVersion, id: content.id, workId: content.workId,
    contentVersion: content.contentVersion, canonicalTextVersion: content.canonicalTextVersion,
    quizContentVersion: content.quizContentVersion, questions: Object.freeze(questions) });
}

module.exports = { isSourceLinkedQuiz, validateQuizContent };
