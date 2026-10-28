const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { createCourseRewardsScenario } = require('../../course/courseRewardsEnvironment');
const { createQuizAttempt } = require('../../course/quizAttempt');
const { validateQuiz } = require('../../Progress/quizSafety');
const { buildCanonicalDocument } = require('../../shared/contentText');

let rules;
const root = path.resolve(__dirname, '../..');
const folder = path.join(root, 'data/plays/a-midsummer-nights-dream');
const read = file => JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8'));
const play = read('play.json'), quizContent = read('quiz.json');
const canonicalDocument = buildCanonicalDocument({ play, sections: play.sections.map(section => read(section.path)) });
const quiz = validateQuiz({ id: quizContent.workId, difficulty: 1, quizContent, canonicalDocument });

test.before(async () => {
  assert.equal(process.env.GCLOUD_PROJECT, 'demo-bard-highlights-sync');
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8180');
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9199');
  rules = await initializeTestEnvironment({ projectId: 'demo-bard-highlights-sync',
    firestore: { host: '127.0.0.1', port: 8180,
      rules: fs.readFileSync(path.join(root, 'docs/reader/production/firestore.rules'), 'utf8') } });
});
test.after(async () => { await rules?.cleanup(); });

function finishedAttempt(scenario, correct = true) {
  assert.equal(quiz.questions.length, 10);
  const attempt = createQuizAttempt({ ...scenario.runtime, getQuiz: () => quiz });
  const token = attempt.getSnapshot().attemptToken;
  for (const q of quiz.questions) {
    attempt.choose(q.id, correct ? q.correctAnswer : q.options.find(id => id !== q.correctAnswer), token);
    attempt.checkAnswer(q.id, token); attempt.next(q.id, token);
  }
  return attempt;
}

async function profile(scenario) {
  const env = scenario.environment;
  assert.equal(env.projectId, 'demo-bard-highlights-sync');
  const uid = env.auth.currentUser?.uid;
  assert.ok(uid);
  return (await env.sdk.getDocFromServer(env.sdk.doc(env.db, 'users', uid))).data();
}

test('the bundled ten-question quiz confirms a first completion in an isolated authenticated Firebase account exactly once', async t => {
  const scenario = await createCourseRewardsScenario('pass', { host: '127.0.0.1' });
  const attempt = finishedAttempt(scenario);
  t.after(async () => { attempt.dispose(); await scenario.dispose(); });
  assert.deepEqual(await profile(scenario), { completedLevel: 0 });
  const token = attempt.getSnapshot().attemptToken;
  await Promise.all([attempt.submit(quiz.questions.at(-1).id, token), attempt.submit(quiz.questions.at(-1).id, token)]);
  const result = attempt.getSnapshot().result;
  assert.equal(result.outcome, 'saved'); assert.equal(result.correct, 10); assert.equal(result.total, 10);
  assert.deepEqual(scenario.getStats(), { mode: 'pass', saveCalls: 1, confirmedSaves: 1, completedLevel: 1 });
  assert.deepEqual(await profile(scenario), { completedLevel: 1 });
  assert.equal(await attempt.submit(quiz.questions.at(-1).id, token), false);
  assert.equal(scenario.getStats().saveCalls, 1);
});

test('an interrupted isolated save preserves the finished score until one genuine Firebase retry is confirmed', async t => {
  const scenario = await createCourseRewardsScenario('save-failed', { host: '127.0.0.1' });
  const attempt = finishedAttempt(scenario);
  t.after(async () => { attempt.dispose(); await scenario.dispose(); });
  const token = attempt.getSnapshot().attemptToken;
  await attempt.submit(quiz.questions.at(-1).id, token);
  const failed = attempt.getSnapshot().result;
  assert.equal(failed.outcome, 'save-failed'); assert.equal(failed.correct, 10);
  assert.deepEqual(await profile(scenario), { completedLevel: 0 });
  assert.equal(scenario.getStats().confirmedSaves, 0);
  await Promise.all([attempt.retrySave(token), attempt.retrySave(token)]);
  const saved = attempt.getSnapshot().result;
  assert.equal(saved.outcome, 'saved'); assert.equal(saved.answers, failed.answers);
  assert.deepEqual(scenario.getStats(), { mode: 'save-failed', saveCalls: 2, confirmedSaves: 1, completedLevel: 1 });
  assert.deepEqual(await profile(scenario), { completedLevel: 1 });
});

test('perfect replay and incorrect attempts keep their isolated profile values without new completion writes', async t => {
  const scenarios = [];
  t.after(async () => { for (const { scenario, attempt } of scenarios) { attempt.dispose(); await scenario.dispose(); } });
  for (const mode of ['replay', 'incorrect']) {
    const scenario = await createCourseRewardsScenario(mode, { host: '127.0.0.1' });
    const attempt = finishedAttempt(scenario, mode === 'replay'); scenarios.push({ scenario, attempt });
    await attempt.submit(quiz.questions.at(-1).id, attempt.getSnapshot().attemptToken);
    assert.equal(attempt.getSnapshot().result.outcome, mode === 'replay' ? 'replay' : 'failed');
    assert.equal(attempt.getSnapshot().result.correct, mode === 'replay' ? 10 : 0);
    assert.equal(scenario.getStats().saveCalls, 0); assert.equal(scenario.getStats().confirmedSaves, 0);
    assert.deepEqual(await profile(scenario), { completedLevel: mode === 'replay' ? 1 : 0 });
  }
  assert.notEqual(scenarios[0].scenario.environment.auth.currentUser.uid, scenarios[1].scenario.environment.auth.currentUser.uid);
});
