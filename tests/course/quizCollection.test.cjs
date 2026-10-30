const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { validateQuiz, evaluateSubmission } = require('../../Progress/quizSafety');
const { createQuizAttempt } = require('../../course/quizAttempt');
const { buildReaderNavigation } = require('../../reader/readerNavigation');

const root = path.resolve(__dirname, '../..');
function validator() {
  const file = path.join(root, 'scripts/validateQuizCollection.cjs');
  assert.ok(fs.existsSync(file), 'catalogue-wide source-linked quiz validation must exist');
  return require(file);
}

test('all 38 bundled plays have ten complete source-backed questions and no omitted quiz', () => {
  const report = validator().validateQuizCollection({ root });
  assert.deepEqual(report.errors, []);
  assert.equal(report.plays.length, 38);
  assert.equal(report.questions, 380);
  assert.equal(new Set(report.plays.map(play => play.workId)).size, 38);
  for (const play of report.plays) {
    assert.equal(play.questions, 10, play.workId);
    assert.ok(play.evidence >= 10, play.workId);
    assert.equal(play.errors.length, 0, play.workId);
  }
});

test('collection validation rejects missing questions, stale ranges, and literal source differences', () => {
  const { loadPlayQuiz, validatePlayQuiz } = validator();
  const entry = JSON.parse(fs.readFileSync(path.join(root, 'data/manifest.json'), 'utf8')).plays
    .find(play => play.id === 'a-midsummer-nights-dream');
  const source = fs.readFileSync(path.join(root, 'data/source/pg100-images.html'), 'utf8');
  const original = loadPlayQuiz(root, entry);
  assert.deepEqual(validatePlayQuiz(original, source).errors, []);
  const missing = { ...original, content: JSON.parse(JSON.stringify(original.content)) };
  missing.content.questions.pop();
  assert.ok(validatePlayQuiz(missing, source).errors.some(error => error.includes('exactly ten')));
  const stale = { ...original, content: JSON.parse(JSON.stringify(original.content)) };
  stale.content.questions[0].evidence[0].start++;
  assert.ok(validatePlayQuiz(stale, source).errors.length > 0);
  const duplicate = { ...original, content: JSON.parse(JSON.stringify(original.content)) };
  duplicate.content.questions[0].evidence.push(duplicate.content.questions[0].evidence[0]);
  assert.ok(validatePlayQuiz(duplicate, source).errors.some(error => error.includes('identical evidence range')));
  const changedSource = source.replace('Stand forth, Demetrius. My noble lord,', 'Stend forth, Demetrius. My noble lord,');
  assert.notEqual(changedSource, source);
  assert.ok(validatePlayQuiz(original, changedSource).errors.some(error => error.includes('literal quotation differs')));
});

test('every completed quiz uses the existing shuffled, locked-answer scoring and navigation contracts', async () => {
  const { loadPlayQuiz } = validator();
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data/manifest.json'), 'utf8'));
  for (const entry of manifest.plays) {
    const loaded = loadPlayQuiz(root, entry);
    const input = { id: entry.id, difficulty: entry.difficulty,
      quizContent: loaded.content, canonicalDocument: loaded.canonical };
    const quiz = validateQuiz(input);
    assert.ok(quiz, entry.id);
    const navigation = buildReaderNavigation({ play: loaded.play, sections: loaded.sections }, loaded.canonical);
    const answers = Object.fromEntries(quiz.questions.map(question => [question.id, question.correctAnswer]));
    assert.deepEqual(evaluateSubmission(input, answers, quiz.key), {
      status: 'complete', correct: 10, total: 10, passed: true, level: entry.difficulty,
    });
    const owner = Object.freeze({ uid: 'isolated-collection-owner', generation: 0 });
    let saves = 0;
    const attempt = createQuizAttempt({ getQuiz: () => quiz, getOwner: () => owner,
      getLevel: () => entry.difficulty, saveProgress: async () => { saves++; throw Error('Replay must not save'); },
      commitLevel: () => { throw Error('Replay must not award'); }, random: () => 0.37 });
    const firstOrder = attempt.getSnapshot().choiceOrder;
    for (const [index, question] of quiz.questions.entries()) {
      const state = attempt.getSnapshot();
      assert.deepEqual(new Set(state.choiceOrder[question.id]), new Set(question.options));
      assert.equal(attempt.choose(question.id, question.correctAnswer, state.attemptToken), true);
      assert.equal(attempt.checkAnswer(question.id, state.attemptToken), true);
      assert.equal(attempt.choose(question.id, question.options.find(id => id !== question.correctAnswer), state.attemptToken), false);
      assert.equal(attempt.getSnapshot().checked[question.id], question.correctAnswer);
      assert.equal(question.choices.find(choice => choice.id === question.correctAnswer).text.length > 0, true);
      assert.ok(question.explanation);
      for (const evidence of question.evidence) {
        const destination = navigation.items.find(item => item.id === evidence.startRef.sectionId);
        assert.ok(destination, `${entry.id}/${question.id} supporting passage is reachable`);
        assert.equal(destination.reference.sectionId, evidence.startRef.sectionId);
      }
      if (index < 9) assert.equal(attempt.next(question.id, state.attemptToken), true);
    }
    assert.equal(attempt.previous(quiz.questions[9].id, attempt.getSnapshot().attemptToken), true);
    assert.equal(attempt.getSnapshot().checked[quiz.questions[8].id], quiz.questions[8].correctAnswer);
    assert.equal(attempt.getSnapshot().choiceOrder, firstOrder, 'review keeps the same presentation order');
    attempt.next(quiz.questions[8].id, attempt.getSnapshot().attemptToken);
    await attempt.submit(quiz.questions[9].id, attempt.getSnapshot().attemptToken);
    assert.equal(attempt.getSnapshot().result.outcome, 'replay');
    assert.equal(attempt.getSnapshot().result.correct, 10);
    assert.equal(saves, 0);
    attempt.retake(attempt.getSnapshot().attemptToken);
    for (const question of quiz.questions) assert.notEqual(attempt.getSnapshot().choiceOrder[question.id].indexOf(question.correctAnswer),
      firstOrder[question.id].indexOf(question.correctAnswer), 'retake moves each answer without changing its identity');
    attempt.dispose();
  }
});
