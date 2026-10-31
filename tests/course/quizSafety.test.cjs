const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { buildCanonicalDocument, createSelection } = require('../../shared/contentText');
const { validateQuiz, evaluateSubmission } = require('../../Progress/quizSafety');

const root = path.resolve(__dirname, '../..');
const workId = 'a-midsummer-nights-dream';
const json = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const playDocument = json(`data/plays/${workId}/play.json`);
const sections = playDocument.sections.map(ref => json(path.posix.join('data/plays', workId, ref.path)));
const canonicalDocument = buildCanonicalDocument({ play: playDocument, sections });
const authoredPlay = () => ({ id: workId, difficulty: 1,
  quizContent: json(`data/plays/${workId}/quiz.json`), canonicalDocument });
const legacyPlay = () => ({ id: 'fixture-play', difficulty: 1, quiz: [
  { id: 1, question: 'First fixture question?', options: ['Correct A', 'Wrong A'], correctAnswer: 'Correct A' },
  { id: 2, question: 'Second fixture question?', options: ['Wrong B', 'Correct B'], correctAnswer: 'Correct B' },
] });
const answersFor = quiz => Object.fromEntries(quiz.questions.map(question => [question.id, question.correctAnswer]));

test('schema2 uses stable option IDs for scoring and preserves readable feedback', () => {
  const play = authoredPlay(), quiz = validateQuiz(play);
  assert.ok(quiz, 'real authored content must become usable');
  assert.equal(quiz.playId, workId);
  assert.equal(quiz.level, 1);
  assert.equal(quiz.questions.length, 10);
  const first = quiz.questions[0];
  assert.deepEqual(first.options, ['mnd-01.a', 'mnd-01.b', 'mnd-01.c', 'mnd-01.d']);
  assert.equal(first.correctAnswer, 'mnd-01.a');
  assert.equal(first.choices[0].text, 'Egeus favors Demetrius; Hermia loves Lysander.');
  assert.equal(first.choices[0].id, 'mnd-01.a');
  assert.equal(first.explanation, play.quizContent.questions[0].explanation);
  assert.deepEqual(first.evidence, play.quizContent.questions[0].evidence);
  assert.deepEqual(evaluateSubmission(play, answersFor(quiz), quiz.key), {
    status: 'complete', correct: 10, total: 10, passed: true, level: 1,
  });
  const wrong = answersFor(quiz); wrong['mnd-01'] = 'mnd-01.b';
  assert.deepEqual(evaluateSubmission(play, wrong, quiz.key), {
    status: 'complete', correct: 9, total: 10, passed: false, level: 1,
  });
});

test('schema2 labels cannot substitute for option IDs or incomplete answers', () => {
  const play = authoredPlay(), quiz = validateQuiz(play);
  assert.ok(quiz);
  const labels = Object.fromEntries(quiz.questions.map(question => [question.id,
    question.choices.find(choice => choice.id === question.correctAnswer).text]));
  assert.deepEqual(evaluateSubmission(play, labels, quiz.key), { status: 'incomplete' });
  const missing = answersFor(quiz); delete missing['mnd-01'];
  assert.deepEqual(evaluateSubmission(play, missing, quiz.key), { status: 'incomplete' });
  const extra = answersFor(quiz); extra.unasked = 'mnd-01.a';
  assert.deepEqual(evaluateSubmission(play, extra, quiz.key), { status: 'incomplete' });
});

test('schema2 snapshots are frozen clones, leaving caller content mutable', () => {
  const play = authoredPlay(), quiz = validateQuiz(play);
  assert.ok(quiz);
  function frozen(value) {
    if (!value || typeof value !== 'object') return;
    assert.ok(Object.isFrozen(value));
    Object.values(value).forEach(frozen);
  }
  frozen(quiz);
  assert.equal(Object.isFrozen(play.quizContent), false);
  const original = quiz.questions[0].choices[0].text;
  play.quizContent.questions[0].options[0].text = 'Changed option';
  play.quizContent.questions[0].evidence[0].exact = 'Changed evidence';
  assert.equal(quiz.questions[0].choices[0].text, original);
  assert.equal(quiz.questions[0].evidence[0].exact,
    'Stand forth, Demetrius. My noble lord,\nThis man hath my consent to marry her.');
});

const staleChanges = [
  ['editorial revision', play => { play.quizContent.quizContentVersion = '1.0.1'; }],
  ['quiz identity', play => { play.quizContent.id = 'mnd-comprehension-revised'; }],
  ['explanation', play => { play.quizContent.questions[0].explanation += ' Revised explanation.'; }],
  ['option label', play => { play.quizContent.questions[0].options[0].text += ' Revised.'; }],
  ['valid evidence', play => { play.quizContent.questions[0].evidence[0] = createSelection(canonicalDocument, 5793, 5826); }],
];
for (const [name, change] of staleChanges) test(`a changed schema2 ${name} retires captured submission keys`, () => {
  const play = authoredPlay(), initial = validateQuiz(play);
  assert.ok(initial);
  change(play);
  const revised = validateQuiz(play);
  assert.ok(revised, 'the changed content remains structurally valid');
  assert.notEqual(revised.key, initial.key);
  assert.deepEqual(evaluateSubmission(play, answersFor(initial), initial.key), { status: 'unavailable' });
});

const invalidChanges = [
  ['null content', play => { play.quizContent = null; }],
  ['undefined content', play => { play.quizContent = undefined; }],
  ['legacy envelope', play => { play.quizContent = { schemaVersion: '1.0.0', questions: [] }; }],
  ['raw question array', play => { play.quizContent = play.quizContent.questions; }],
  ['stale canonical revision', play => { play.quizContent.contentVersion = 'stale'; }],
  ['stale evidence', play => { play.quizContent.questions[0].evidence[0].exact += '!'; }],
  ['missing document', play => { delete play.canonicalDocument; }],
  ['mismatched play', play => { play.id = 'another-work'; }],
];
for (const [name, change] of invalidChanges) test(`schema2 ${name} never falls back to valid legacy questions`, () => {
  const play = authoredPlay(), initial = validateQuiz(play);
  assert.ok(initial);
  play.quiz = legacyPlay().quiz;
  change(play);
  assert.equal(validateQuiz(play), null);
  assert.deepEqual(evaluateSubmission(play, answersFor(initial), initial.key), { status: 'unavailable' });
});

test('legacy questions retain their answer strings and the all-correct threshold', () => {
  const play = legacyPlay(), quiz = validateQuiz(play);
  assert.ok(quiz);
  assert.deepEqual(quiz.questions[0].choices, [
    { id: 'Correct A', text: 'Correct A' }, { id: 'Wrong A', text: 'Wrong A' },
  ]);
  assert.equal(quiz.questions[0].explanation, '');
  assert.deepEqual(quiz.questions[0].evidence, []);
  assert.deepEqual(evaluateSubmission(play, { 1: 'Correct A', 2: 'Correct B' }, quiz.key), {
    status: 'complete', correct: 2, total: 2, passed: true, level: 1,
  });
  assert.deepEqual(evaluateSubmission(play, { 1: 'Correct A', 2: 'Wrong B' }, quiz.key), {
    status: 'complete', correct: 1, total: 2, passed: false, level: 1,
  });
  assert.deepEqual(evaluateSubmission(play, { 1: 'Correct A' }, quiz.key), { status: 'incomplete' });
  play.quiz[0].options[0] = 'Changed answer';
  assert.deepEqual(evaluateSubmission(play, { 1: 'Correct A', 2: 'Correct B' }, quiz.key), { status: 'unavailable' });
});

test('legacy optional explanation is copied safely and never trusts unvalidated evidence', () => {
  const play = legacyPlay();
  play.quiz[0].explanation = 'Fixture explanation';
  play.quiz[0].evidence = [{ exact: 'Unvalidated legacy evidence' }];
  play.quiz[1].explanation = {};
  const quiz = validateQuiz(play);
  assert.ok(quiz);
  assert.equal(quiz.questions[0].explanation, 'Fixture explanation');
  assert.equal(quiz.questions[1].explanation, '');
  assert.deepEqual(quiz.questions[0].evidence, []);
  assert.ok(Object.isFrozen(quiz.questions[0].choices[0]));
  assert.ok(Object.isFrozen(quiz.questions[0].evidence));
  assert.equal(Object.isFrozen(play.quiz[0]), false);
});
