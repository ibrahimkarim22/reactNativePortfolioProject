const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { load } = require('cheerio');
const { buildCanonicalDocument, resolveSelection } = require('../shared/contentText');
const { validateQuizContent } = require('../course/quizContent');

const SOURCE_SHA256 = 'd7116e381ba4f0164ba059f6d0e135e07af068b4ab486b57fa7deec6a305d5c3';
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function loadPlayQuiz(root, entry) {
  const play = json(path.resolve(root, 'data', entry.play));
  const folder = path.dirname(path.resolve(root, 'data', entry.play));
  const sections = play.sections.map(reference => json(path.resolve(folder, reference.path)));
  return { entry, play, sections, canonical: buildCanonicalDocument({ play, sections }),
    content: json(path.resolve(root, 'data', entry.quiz)) };
}

// Independent of the play generator and selection constructor. This matches the
// established Gutenberg paragraph check: explicit <br> boundaries remain breaks;
// HTML source indentation is removed within each resulting line only.
function paragraphText(html) {
  const $ = load(html);
  $('br').replaceWith('\uFDD0');
  return $('body').text().replace(/\r\n?/g, '\n').split('\uFDD0')
    .map(line => line.replace(/^[\t\n ]+|[\t\n ]+$/g, '').replace(/[\t ]*\n[\t ]*/g, ' ')).join('\n');
}

function validatePlayQuiz(loaded, source) {
  const { entry, play, sections, content, canonical } = loaded;
  const errors = [];
  const error = message => errors.push(`${entry.id}: ${message}`);
  if (!validateQuizContent(content, canonical)) error('production schema/canonical validation failed');
  if (content.questions?.length !== 10) error('exactly ten questions are required');
  if (content.quizContentVersion !== (entry.id === 'a-midsummer-nights-dream' ? '1.1.0' : '1.0.0')) error('unexpected independent quiz revision');
  const blockById = new Map(sections.flatMap(section => section.content.map(block => [block.id, block])));
  const sourceCache = new Map();
  const prompts = new Set();
  let evidenceCount = 0;
  for (const [index, question] of (content.questions || []).entries()) {
    const expectedId = `${entry.id === 'a-midsummer-nights-dream' ? 'mnd' : entry.id}-${String(index + 1).padStart(2, '0')}`;
    if (question.id !== expectedId) error(`question ${index + 1} has an unexpected stable ID`);
    const prompt = String(question.question || '').trim().toLowerCase();
    if (prompts.has(prompt)) error(`${question.id} repeats a prompt`);
    prompts.add(prompt);
    const choices = (question.options || []).map(option => String(option.text || '').trim().toLowerCase());
    if (choices.length !== 4 || new Set(choices).size !== 4) error(`${question.id} requires four distinct choices`);
    if ((question.options || []).filter(option => option.id === question.correctOptionId).length !== 1) error(`${question.id} requires one correct option`);
    const citedRanges = new Set();
    for (const evidence of question.evidence || []) {
      evidenceCount++;
      const rangeKey = `${evidence.start}:${evidence.end}`;
      if (citedRanges.has(rangeKey)) error(`${question.id} repeats an identical evidence range`);
      citedRanges.add(rangeKey);
      try {
        resolveSelection(canonical, evidence);
        let meaningful = 0;
        for (const unit of canonical.units) {
          const start = Math.max(unit.start, evidence.start), end = Math.min(unit.textEnd, evidence.end);
          if (start >= end) continue;
          const fragment = canonical.text.slice(start, end);
          if (!fragment.trim()) continue;
          meaningful++;
          const block = blockById.get(unit.id), ref = block?.sourceRef;
          if (!ref || !Number.isInteger(ref.start) || !Number.isInteger(ref.end)
              || ref.start < 0 || ref.end <= ref.start || ref.end > source.length
              || !ref.path.startsWith(play.source.chapterId + '/')) throw Error('source block does not belong to this work');
          if (!sourceCache.has(unit.id)) sourceCache.set(unit.id, paragraphText(source.slice(ref.start, ref.end)));
          if (!sourceCache.get(unit.id).includes(fragment)) throw Error('literal quotation differs from the original Gutenberg paragraph');
        }
        if (!meaningful) throw Error('evidence cannot consist only of canonical separators');
      } catch (failure) {
        error(`${question.id}: ${failure.message}`);
      }
    }
  }
  return { workId: entry.id, title: entry.displayName, questions: content.questions?.length || 0,
    evidence: evidenceCount, errors };
}

function validateQuizCollection({ root = path.resolve(__dirname, '..') } = {}) {
  const manifest = json(path.join(root, 'data/manifest.json'));
  const source = fs.readFileSync(path.join(root, 'data/source/pg100-images.html'), 'utf8');
  const errors = [];
  if (crypto.createHash('sha256').update(source).digest('hex') !== SOURCE_SHA256) errors.push('Original Gutenberg source checksum changed');
  if (manifest.plays.length !== 38 || new Set(manifest.plays.map(play => play.id)).size !== 38) errors.push('Catalogue must contain all 38 distinct plays');
  const plays = manifest.plays.map(entry => {
    try { return validatePlayQuiz(loadPlayQuiz(root, entry), source); }
    catch (failure) { return { workId: entry.id, title: entry.displayName, questions: 0, evidence: 0, errors: [`${entry.id}: ${failure.message}`] }; }
  });
  errors.push(...plays.flatMap(play => play.errors));
  return { passed: errors.length === 0, plays, questions: plays.reduce((total, play) => total + play.questions, 0), errors };
}

if (require.main === module) {
  const report = validateQuizCollection();
  for (const play of report.plays) console.log(`${play.errors.length ? 'FAIL' : 'PASS'} ${play.workId}: ${play.questions} questions, ${play.evidence} exact source ranges`);
  for (const error of report.errors) console.error(error);
  console.log(`${report.plays.filter(play => !play.errors.length).length}/${report.plays.length} plays; ${report.questions} questions`);
  process.exitCode = report.passed ? 0 : 1;
}

module.exports = { loadPlayQuiz, validatePlayQuiz, validateQuizCollection };
