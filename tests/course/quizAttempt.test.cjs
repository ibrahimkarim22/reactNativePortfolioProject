const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function load(name) {
  const file = path.resolve(__dirname, '../../course', name + '.js');
  assert.ok(fs.existsSync(file), 'production ' + name + ' exists');
  return require(file);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const acknowledgement = (completedLevel = 1, advanced = true) => Object.freeze({ completedLevel, advanced });
function quiz(key = 'quiz-a', level = 1) {
  return Object.freeze({ key, playId: 'fixture-play', level, questions: Object.freeze([
    { id: 'q1', question: 'First question?', options: ['q1.a', 'q1.b'], choices: [{ id: 'q1.a', text: 'First A' }, { id: 'q1.b', text: 'First B' }], correctAnswer: 'q1.a', explanation: 'First explanation.', evidence: [] },
    { id: 'q2', question: 'Second question?', options: ['q2.a', 'q2.b'], choices: [{ id: 'q2.a', text: 'Second A' }, { id: 'q2.b', text: 'Second B' }], correctAnswer: 'q2.b', explanation: 'Second explanation.', evidence: [] },
  ].map(question => Object.freeze({ ...question, options: Object.freeze(question.options) }))) });
}
function host(options = {}) {
  const h = { source: quiz(), owner: Object.freeze({ uid: 'owner-a', generation: 0 }), level: 0, writes: [], commits: [], notices: [], ...options };
  h.attempt = load('quizAttempt').createQuizAttempt({
    getQuiz: () => h.source, getOwner: () => h.owner, getLevel: () => h.level,
    ...(h.random ? { random: h.random } : {}),
    saveProgress: async (...args) => { h.writes.push(args); return h.save ? h.save(...args) : acknowledgement(args[1]); },
    commitLevel: level => { h.commits.push(level); h.level = level; },
  });
  h.unsubscribe = h.attempt.subscribe(() => h.notices.push(h.attempt.getSnapshot()));
  h.answerAll = (correct = true) => {
    h.attempt.choose('q1', correct ? 'q1.a' : 'q1.b'); h.attempt.checkAnswer('q1'); h.attempt.next('q1');
    h.attempt.choose('q2', correct ? 'q2.b' : 'q2.a'); h.attempt.checkAnswer('q2');
  };
  return h;
}

test('choice order is an immutable per-attempt permutation and never mutates the source quiz', () => {
  let randomCalls = 0;
  const h = host({ random: () => { randomCalls++; return 0; } });
  const before = JSON.stringify(h.source);
  const first = h.attempt.getSnapshot().choiceOrder;
  assert.ok(first, 'the attempt owns the displayed option order');
  assert.ok(Object.isFrozen(first));
  for (const question of h.source.questions) {
    assert.ok(Object.isFrozen(first[question.id]));
    assert.deepEqual([...first[question.id]].sort(), [...question.options].sort());
  }
  assert.deepEqual(first.q1, ['q1.b', 'q1.a'], 'shuffle uses stable choice IDs rather than replacing their identity');
  const calls = randomCalls;
  h.attempt.choose('q1', 'q1.a'); h.attempt.checkAnswer('q1'); h.attempt.next('q1'); h.attempt.previous('q2');
  assert.equal(h.attempt.getSnapshot().choiceOrder, first, 'checking, review and rendering never reshuffle');
  assert.equal(randomCalls, calls);
  assert.equal(JSON.stringify(h.source), before);
});

test('every retake moves the correct option from its prior position even with identical random draws', () => {
  const original = quiz();
  const source = { ...original, questions: original.questions.map(q => ({ ...q, options: [...q.options, q.id + '.c', q.id + '.d'] })) };
  const h = host({ source, random: () => 0 });
  let previous = h.attempt.getSnapshot();
  for (let repeat = 0; repeat < 8; repeat++) {
    h.attempt.retake(previous.attemptToken);
    const current = h.attempt.getSnapshot();
    for (const question of h.source.questions) {
      assert.notEqual(current.choiceOrder[question.id].indexOf(question.correctAnswer), previous.choiceOrder[question.id].indexOf(question.correctAnswer));
      assert.deepEqual([...current.choiceOrder[question.id]].sort(), [...question.options].sort());
    }
    assert.deepEqual(current.answers, {}); assert.deepEqual(current.checked, {});
    assert.notEqual(current.attemptToken, previous.attemptToken);
    previous = current;
  }
  assert.deepEqual(h.writes, []); assert.deepEqual(h.commits, []);
});

test('shuffled presentation scores original option IDs and save-only retry retains that same order', async () => {
  let saves = 0;
  const h = host({ random: () => 0, save: async () => { if (++saves === 1) throw new Error('fixture offline'); return acknowledgement(); } });
  const order = h.attempt.getSnapshot().choiceOrder;
  assert.ok(order, 'the live controller creates the presentation order');
  h.answerAll(); await h.attempt.submit();
  assert.equal(h.attempt.getSnapshot().result.correct, 2);
  assert.equal(h.attempt.getSnapshot().result.outcome, 'save-failed');
  await h.attempt.retrySave();
  assert.equal(h.attempt.getSnapshot().result.outcome, 'saved');
  assert.equal(h.attempt.getSnapshot().choiceOrder, order);
  assert.equal(saves, 2); assert.deepEqual(h.commits, [1]);
});

test('only a current confirmed new completion can claim its one-shot celebration', async () => {
  const gate = deferred(), h = host({ save: () => gate.promise });
  h.answerAll();
  const pending = h.attempt.submit();
  assert.equal(typeof h.attempt.claimCelebration, 'function');
  assert.equal(h.attempt.claimCelebration({ outcome: 'saved' }, h.attempt.getSnapshot().attemptToken), false);
  gate.resolve(acknowledgement()); await pending;
  const state = h.attempt.getSnapshot();
  assert.equal(h.attempt.claimCelebration(state.result, state.attemptToken), true);
  assert.equal(h.attempt.claimCelebration(state.result, state.attemptToken), false, 'component remounts and repeated callbacks cannot replay it');
  h.attempt.retake(state.attemptToken);
  assert.equal(h.attempt.claimCelebration(state.result, state.attemptToken), false);
});

test('failed, replay and unconfirmed outcomes cannot celebrate; a confirmed save-only retry can once', async () => {
  for (const kind of ['failed', 'replay', 'sign-in', 'save-failed']) {
    let saves = 0;
    const h = host({ level: kind === 'replay' ? 1 : 0,
      owner: Object.freeze({ uid: kind === 'sign-in' ? null : 'owner-a', generation: 0 }),
      save: async () => { if (++saves === 1) throw new Error('fixture offline'); return acknowledgement(); } });
    h.answerAll(kind !== 'failed'); await h.attempt.submit();
    const state = h.attempt.getSnapshot();
    assert.equal(typeof h.attempt.claimCelebration, 'function');
    assert.equal(h.attempt.claimCelebration(state.result, state.attemptToken), false, kind);
    if (kind === 'save-failed') {
      await h.attempt.retrySave(state.attemptToken);
      const saved = h.attempt.getSnapshot();
      assert.equal(h.attempt.claimCelebration(saved.result, saved.attemptToken), true);
      assert.equal(h.attempt.claimCelebration(saved.result, saved.attemptToken), false);
      assert.equal(saved.result.correct, state.result.correct); assert.equal(saves, 2);
    }
  }
});

test('an account change retires a confirmed but not yet animated award', async () => {
  const h = host(); h.answerAll(); await h.attempt.submit();
  const state = h.attempt.getSnapshot();
  h.owner = Object.freeze({ uid: 'owner-b', generation: 1 });
  assert.equal(typeof h.attempt.claimCelebration, 'function');
  assert.equal(h.attempt.claimCelebration(state.result, state.attemptToken), false);
});

test('an attempt keeps immutable snapshots and choices editable only until deliberately checked', () => {
  const h = host(), { attempt } = h, first = attempt.getSnapshot();
  assert.equal(first, attempt.getSnapshot()); assert.equal(first.phase, 'answering'); assert.equal(first.index, 0);
  assert.ok(Object.isFrozen(first)); assert.ok(Object.isFrozen(first.answers)); assert.ok(Object.isFrozen(first.checked));
  assert.deepEqual(first.checked, {});
  assert.equal(attempt.next(), false); assert.equal(attempt.previous(), false);
  assert.equal(attempt.choose('missing', 'q1.a'), false); assert.equal(attempt.choose('q1', 'missing'), false);
  assert.deepEqual(attempt.getSnapshot().answers, {});
  assert.equal(attempt.choose('q1', 'q1.a'), true); assert.equal(attempt.choose('q1', 'q1.b'), true);
  assert.equal(attempt.getSnapshot().answers.q1, 'q1.b'); assert.equal(attempt.getSnapshot().result, null);
  assert.equal(attempt.next(), false, 'an unconfirmed selection cannot advance');
  assert.equal(attempt.checkAnswer('q1'), true);
  assert.equal(attempt.getSnapshot().checked.q1, 'q1.b'); assert.ok(Object.isFrozen(attempt.getSnapshot().checked));
  assert.equal(attempt.choose('q1', 'q1.a'), false, 'checked choices remain locked');
  assert.equal(attempt.next('q1'), true); assert.equal(attempt.getSnapshot().index, 1); assert.equal(attempt.next(), false);
  assert.equal(attempt.previous(), true); assert.equal(attempt.getSnapshot().answers.q1, 'q1.b');
  assert.equal(attempt.choose('q1', 'q1.a'), false, 'review navigation does not unlock the answer');
  assert.deepEqual(h.writes, []); assert.deepEqual(h.commits, []);
});

test('incomplete answers cannot submit across the callback boundary', async () => {
  const h = host();
  assert.equal(await h.attempt.submit(), false);
  h.attempt.choose('q1', 'q1.a'); assert.equal(await h.attempt.submit(), false);
  assert.equal(h.attempt.getSnapshot().phase, 'answering'); assert.equal(h.attempt.getSnapshot().result, null);
  assert.deepEqual(h.writes, []); assert.deepEqual(h.commits, []);
});

test('Check answer requires the current valid selection and cannot be processed twice', () => {
  const h = host(), { attempt } = h;
  assert.equal(attempt.checkAnswer('q1'), false);
  assert.equal(attempt.choose('q2', 'q2.b'), false, 'future answers cannot be prefilled');
  attempt.choose('q1', 'q1.b');
  assert.equal(attempt.checkAnswer('q2'), false, 'a stale or incorrect question identity cannot check the current choice');
  assert.equal(attempt.getSnapshot().checked.q1, undefined);
  attempt.choose('q1', 'q1.a');
  const notices = h.notices.length;
  assert.equal(attempt.checkAnswer('q1'), true);
  assert.equal(attempt.checkAnswer('q1'), false);
  assert.equal(h.notices.length, notices + 1, 'rapid duplicate checks cannot publish another result');
  assert.deepEqual(attempt.getSnapshot().checked, { q1: 'q1.a' });
  assert.equal(attempt.getSnapshot().result, null, 'per-question feedback does not finalize the attempt');
  assert.deepEqual(h.writes, []); assert.deepEqual(h.commits, []);
});

test('an earlier Check callback cannot lock a later question after Continue', () => {
  const h = host(), { attempt } = h;
  const oldCheck = () => attempt.checkAnswer('q1');
  attempt.choose('q1', 'q1.a'); assert.equal(oldCheck(), true);
  assert.equal(attempt.next('q1'), true); attempt.choose('q2', 'q2.b');
  assert.equal(oldCheck(), false);
  assert.deepEqual(attempt.getSnapshot().checked, { q1: 'q1.a' });
  assert.equal(attempt.checkAnswer('q2'), true);
  assert.deepEqual(attempt.getSnapshot().checked, { q1: 'q1.a', q2: 'q2.b' });
});

test('an earlier Continue callback cannot skip a checked review destination', () => {
  const original = quiz(), q3 = Object.freeze({ ...original.questions[0], id: 'q3', options: ['q3.a', 'q3.b'], correctAnswer: 'q3.a' });
  const h = host({ source: Object.freeze({ ...original, key: 'three-question-fixture', questions: [...original.questions, q3] }) });
  const { attempt } = h;
  for (const question of h.source.questions) {
    attempt.choose(question.id, question.correctAnswer); attempt.checkAnswer(question.id); attempt.next(question.id);
  }
  attempt.previous(); attempt.previous();
  const oldContinue = () => attempt.next('q1');
  assert.equal(oldContinue(), true); assert.equal(attempt.getSnapshot().index, 1);
  assert.equal(oldContinue(), false); assert.equal(attempt.getSnapshot().index, 1);
});

test('Finish requires the final feedback and scores the locked choices rather than reviewed corrections', async () => {
  const h = host(), { attempt } = h;
  attempt.choose('q1', 'q1.b'); attempt.checkAnswer('q1');
  assert.equal(await attempt.submit('q1'), false);
  attempt.next('q1'); attempt.choose('q2', 'q2.b');
  assert.equal(await attempt.submit('q2'), false, 'the final choice must be deliberately checked');
  attempt.checkAnswer('q2');
  attempt.previous(); assert.equal(attempt.choose('q1', 'q1.a'), false);
  assert.equal(await attempt.submit('q1'), false, 'reviewing an earlier feedback is not Finish');
  attempt.next('q1'); assert.equal(await attempt.submit('q1'), false, 'captured wrong question identity is stale');
  const checked = attempt.getSnapshot().checked;
  assert.equal(await attempt.submit('q2'), true);
  assert.equal(attempt.getSnapshot().result.answers, checked);
  assert.equal(attempt.getSnapshot().result.correct, 1);
  assert.equal(attempt.getSnapshot().result.outcome, 'failed');
  assert.deepEqual(h.writes, []); assert.deepEqual(h.commits, []);
});

test('returning to feedback preserves checked answers and an unconfirmed next selection', () => {
  const h = host(), { attempt } = h;
  attempt.choose('q1', 'q1.a'); attempt.checkAnswer('q1'); attempt.next('q1');
  attempt.choose('q2', 'q2.a'); attempt.previous();
  assert.deepEqual(attempt.getSnapshot().checked, { q1: 'q1.a' });
  assert.equal(attempt.getSnapshot().answers.q2, 'q2.a');
  attempt.next('q1'); assert.equal(attempt.choose('q2', 'q2.b'), true);
  assert.equal(attempt.getSnapshot().answers.q2, 'q2.b');
  assert.equal(attempt.getSnapshot().checked.q2, undefined);
  assert.deepEqual(h.writes, []);
});

test('checking every answer performs no persistence until the deliberate final Finish', async () => {
  const h = host(); h.answerAll();
  assert.deepEqual(h.attempt.getSnapshot().checked, { q1: 'q1.a', q2: 'q2.b' });
  assert.ok(Object.isFrozen(h.attempt.getSnapshot().checked));
  assert.equal(h.attempt.getSnapshot().result, null);
  assert.deepEqual(h.writes, []); assert.deepEqual(h.commits, []);
  await h.attempt.submit('q2');
  assert.equal(h.writes.length, 1); assert.deepEqual(h.commits, [1]);
});

test('each fresh attempt exposes an opaque frozen token that stays stable through question feedback', () => {
  const h = host(), { attempt } = h, token = attempt.getSnapshot().attemptToken;
  assert.ok(token && typeof token === 'object'); assert.ok(Object.isFrozen(token));
  assert.deepEqual(Object.keys(token), [], 'the token carries no account or content identifiers');
  attempt.choose('q1', 'q1.a', token); attempt.checkAnswer('q1', token); attempt.next('q1', token);
  assert.equal(attempt.getSnapshot().attemptToken, token);
  assert.equal(attempt.retake(token), true);
  assert.notEqual(attempt.getSnapshot().attemptToken, token);
  assert.ok(Object.isFrozen(attempt.getSnapshot().attemptToken));
});

test('captured callbacks cannot mutate or finish a new attempt after retake even with the same question IDs', async () => {
  const h = host(), { attempt } = h, old = attempt.getSnapshot().attemptToken;
  const callbacks = {
    choose: () => attempt.choose('q1', 'q1.b', old),
    check: () => attempt.checkAnswer('q1', old),
    next: () => attempt.next('q1', old),
    previous: () => attempt.previous('q2', old),
    finish: () => attempt.submit('q2', old),
    retake: () => attempt.retake(old),
  };
  assert.equal(attempt.retake(old), true);
  const current = attempt.getSnapshot().attemptToken;
  attempt.choose('q1', 'q1.a', current);
  assert.equal(callbacks.choose(), false); assert.equal(callbacks.check(), false);
  assert.equal(attempt.getSnapshot().answers.q1, 'q1.a');
  assert.deepEqual(attempt.getSnapshot().checked, {});
  attempt.checkAnswer('q1', current);
  assert.equal(callbacks.next(), false); assert.equal(callbacks.retake(), false);
  assert.equal(attempt.getSnapshot().index, 0);
  attempt.next('q1', current); attempt.choose('q2', 'q2.b', current); attempt.checkAnswer('q2', current);
  assert.equal(callbacks.previous(), false); assert.equal(attempt.getSnapshot().index, 1);
  assert.equal(await callbacks.finish(), false); assert.deepEqual(h.writes, []);
  assert.equal(await attempt.submit('q2', current), true); assert.equal(h.writes.length, 1);
});

test('an old failed-save retry or retake cannot act on a newer failed attempt', async () => {
  let saves = 0;
  const h = host({ save: async () => {
    if (++saves <= 2) throw new Error('fixture interrupted');
    return acknowledgement();
  } });
  h.answerAll(); const old = h.attempt.getSnapshot().attemptToken;
  await h.attempt.submit('q2', old); h.attempt.retake(old);
  h.answerAll(); const current = h.attempt.getSnapshot().attemptToken;
  await h.attempt.submit('q2', current);
  const failed = h.attempt.getSnapshot();
  assert.equal(failed.result.outcome, 'save-failed'); assert.equal(h.writes.length, 2);
  assert.equal(await h.attempt.retrySave(old), false); assert.equal(h.attempt.retake(old), false);
  assert.equal(h.attempt.getSnapshot(), failed); assert.equal(h.writes.length, 2);
  assert.equal(await h.attempt.retrySave(current), true);
  assert.equal(h.attempt.getSnapshot().result.outcome, 'saved'); assert.equal(h.writes.length, 3);
});

for (const change of ['account', 'content']) test('a token is retired by ' + change + ' before a stale check is evaluated', () => {
  const h = host(), old = h.attempt.getSnapshot().attemptToken;
  if (change === 'account') h.owner = { uid: 'owner-b', generation: 1 };
  else h.source = quiz('new-version');
  h.attempt.choose('q1', 'q1.a');
  const current = h.attempt.getSnapshot().attemptToken;
  assert.notEqual(current, old);
  assert.equal(h.attempt.checkAnswer('q1', old), false);
  assert.deepEqual(h.attempt.getSnapshot().checked, {});
  assert.equal(h.attempt.checkAnswer('q1', current), true);
});

test('an initially unavailable quiz has no empty success or writable attempt', async () => {
  const h = host({ source: null });
  assert.equal(h.attempt.getSnapshot().phase, 'unavailable'); assert.equal(h.attempt.getSnapshot().result, null);
  assert.equal(await h.attempt.submit(), false); assert.equal(await h.attempt.retrySave(), false);
  assert.equal(h.attempt.checkAnswer(), false);
  assert.deepEqual(h.writes, []); assert.deepEqual(h.commits, []);
});

test('one wrong answer fails the existing all-correct threshold without a progress write', async () => {
  const h = host(); h.attempt.choose('q1', 'q1.a'); h.attempt.checkAnswer('q1'); h.attempt.next('q1');
  h.attempt.choose('q2', 'q2.a'); h.attempt.checkAnswer('q2');
  assert.equal(await h.attempt.submit(), true);
  const state = h.attempt.getSnapshot();
  assert.equal(state.phase, 'results'); assert.equal(state.result.correct, 1); assert.equal(state.result.total, 2);
  assert.equal(state.result.passed, false); assert.equal(state.result.outcome, 'failed');
  assert.equal(h.attempt.choose('q2', 'q2.b'), false); assert.equal(await h.attempt.submit(), false);
  assert.equal(h.attempt.previous(), false); assert.equal(h.attempt.next(), false);
  assert.deepEqual(state.result.answers, { q1: 'q1.a', q2: 'q2.a' }); assert.ok(Object.isFrozen(state.result.answers));
  assert.deepEqual(h.writes, []); assert.deepEqual(h.commits, []);
});

test('pending passing save is locked and deduplicated, then commits only after confirmation', async () => {
  const gate = deferred(), h = host({ save: () => gate.promise }); h.answerAll();
  const pending = h.attempt.submit(), state = h.attempt.getSnapshot();
  assert.equal(state.saving, true); assert.equal(state.phase, 'answering'); assert.equal(state.result, null);
  assert.deepEqual(h.writes, [['owner-a', 1]]); assert.deepEqual(h.commits, []);
  assert.equal(h.attempt.choose('q2', 'q2.a'), false); assert.equal(h.attempt.previous(), false); assert.equal(h.attempt.next(), false);
  assert.equal(h.attempt.checkAnswer('q2'), false);
  assert.equal(await h.attempt.submit(), false); assert.equal(await h.attempt.retrySave(), false); assert.equal(h.writes.length, 1);
  gate.resolve(acknowledgement()); assert.equal(await pending, true);
  assert.equal(h.attempt.getSnapshot().saving, false); assert.equal(h.attempt.getSnapshot().result.outcome, 'saved');
  assert.equal(h.attempt.getSnapshot().result.correct, 2); assert.deepEqual(h.commits, [1]);
  assert.equal(await h.attempt.submit(), false); assert.equal(await h.attempt.retrySave(), false); assert.equal(h.writes.length, 1);
});

test('ownership is rechecked immediately before the external write after notifying listeners', async () => {
  const h = host(); h.answerAll();
  h.attempt.subscribe(() => {
    if (h.attempt.getSnapshot().saving) h.owner = { uid: 'owner-b', generation: 1 };
  });
  assert.equal(await h.attempt.submit(), false);
  assert.deepEqual(h.writes, []); assert.deepEqual(h.commits, []);
  assert.equal(h.attempt.getSnapshot().result, null);
});

test('a failed save exposes a save-only retry preserving immutable answers and score', async () => {
  const retryGate = deferred(); let count = 0;
  const h = host({ save: () => ++count === 1 ? Promise.reject(new Error('fixture offline')) : retryGate.promise }); h.answerAll();
  await h.attempt.submit(); const failed = h.attempt.getSnapshot();
  assert.equal(failed.result.outcome, 'save-failed'); assert.equal(failed.error.code, 'SAVE_FAILED');
  assert.equal(failed.result.correct, 2); assert.deepEqual(h.commits, []);
  assert.equal(h.attempt.choose('q2', 'q2.a'), false); assert.equal(await h.attempt.submit(), false);
  const retry = h.attempt.retrySave(), pending = h.attempt.getSnapshot();
  assert.equal(pending.saving, true); assert.equal(pending.result, failed.result); assert.equal(pending.error, null);
  assert.equal(await h.attempt.retrySave(), false); assert.equal(h.writes.length, 2);
  retryGate.resolve(acknowledgement()); await retry;
  const saved = h.attempt.getSnapshot();
  assert.equal(saved.result.outcome, 'saved'); assert.equal(saved.result.answers, failed.result.answers);
  assert.equal(saved.result.correct, failed.result.correct); assert.equal(saved.result.total, failed.result.total);
  assert.deepEqual(h.commits, [1]);
});

test('repeated save failures remain retryable without regrading or awarding', async () => {
  const h = host({ save: () => Promise.reject(new Error('fixture offline')) }); h.answerAll(); await h.attempt.submit();
  const answers = h.attempt.getSnapshot().result.answers;
  await h.attempt.retrySave(); await h.attempt.retrySave();
  assert.equal(h.writes.length, 3); assert.deepEqual(h.commits, []);
  assert.equal(h.attempt.getSnapshot().result.answers, answers); assert.equal(h.attempt.getSnapshot().result.outcome, 'save-failed');
});

test('replay and invalid progress states cannot write or award a new completion', async () => {
  for (const level of [1, 3, -1, NaN, '0', null]) {
    const h = host({ level }); h.answerAll(); await h.attempt.submit();
    const expected = Number.isSafeInteger(level) && level >= 1 ? 'replay' : 'invalid-progress';
    assert.equal(h.attempt.getSnapshot().result.outcome, expected);
    assert.deepEqual(h.writes, []); assert.deepEqual(h.commits, []);
  }
});

test('missing authentication never changes local progress and cannot use save retry', async () => {
  const h = host({ owner: { uid: null, generation: 0 } }); h.answerAll(); await h.attempt.submit();
  const state = h.attempt.getSnapshot(); assert.equal(state.result.outcome, 'sign-in'); assert.equal(state.error.code, 'SIGN_IN_REQUIRED');
  assert.equal(await h.attempt.retrySave(), false); assert.deepEqual(h.writes, []); assert.deepEqual(h.commits, []);
});

test('a confirmed save never lowers newer local progress', async () => {
  const gate = deferred(), h = host({ save: () => gate.promise }); h.answerAll(); const pending = h.attempt.submit();
  h.level = 3; gate.resolve(acknowledgement()); await pending;
  assert.deepEqual(h.commits, [3]); assert.equal(h.attempt.getSnapshot().result.outcome, 'saved');
});

test('another device completion returned by the transaction is replay rather than a new award', async () => {
  for (const confirmedLevel of [1, 4]) {
    const h = host({ save: async () => acknowledgement(confirmedLevel, false) });
    h.answerAll(); await h.attempt.submit();
    assert.equal(h.attempt.getSnapshot().result.outcome, 'replay');
    assert.equal(h.attempt.getSnapshot().result.correct, 2);
    assert.deepEqual(h.commits, [confirmedLevel]);
    assert.equal(h.writes.length, 1);
  }
});

test('confirmed transaction acknowledgement can restore progress that became unavailable during the save', async () => {
  const gate = deferred(), h = host({ save: () => gate.promise });
  h.answerAll(); const pending = h.attempt.submit(); h.level = null;
  gate.resolve(acknowledgement()); await pending;
  assert.deepEqual(h.commits, [1]);
  assert.equal(h.attempt.getSnapshot().result.outcome, 'saved');
});

test('unavailable progress at submission cannot write or infer account progress', async () => {
  const h = host({ level: null }); h.answerAll(); await h.attempt.submit();
  assert.equal(h.attempt.getSnapshot().result.outcome, 'invalid-progress');
  assert.deepEqual(h.writes, []); assert.deepEqual(h.commits, []);
});

for (const [label, value] of [
  ['missing', undefined], ['null', null], ['boolean', true], ['array', Object.freeze([1, true])],
  ['mutable', { completedLevel: 1, advanced: true }],
  ['missing level', Object.freeze({ advanced: true })],
  ['missing outcome', Object.freeze({ completedLevel: 1 })],
  ['nonboolean outcome', Object.freeze({ completedLevel: 1, advanced: 'true' })],
  ['lower level', acknowledgement(0, false)], ['negative level', acknowledgement(-1, false)],
  ['fractional level', acknowledgement(1.5, false)], ['nonfinite level', acknowledgement(Infinity, false)],
  ['unsafe level', acknowledgement(Number.MAX_SAFE_INTEGER + 1, false)],
  ['different advanced level', acknowledgement(4, true)],
]) test('a ' + label + ' transaction acknowledgement never awards unconfirmed progress', async () => {
  const h = host({ save: async () => value }); h.answerAll(); await h.attempt.submit();
  assert.equal(h.attempt.getSnapshot().result.outcome, 'save-failed');
  assert.equal(h.attempt.getSnapshot().error.code, 'SAVE_FAILED');
  assert.deepEqual(h.commits, []); assert.equal(h.writes.length, 1);
});

test('out-of-order confirmed acknowledgements cannot replace a newer attempt or reduce its confirmed level', async () => {
  const old = deferred(), newer = deferred(); let calls = 0;
  const h = host({ save: () => ++calls === 1 ? old.promise : newer.promise });
  h.answerAll(); const oldSave = h.attempt.submit(); h.attempt.retake(); h.answerAll();
  const newerSave = h.attempt.submit();
  newer.resolve(acknowledgement(4, false)); await newerSave;
  const result = h.attempt.getSnapshot().result;
  assert.equal(result.outcome, 'replay'); assert.deepEqual(h.commits, [4]);
  old.resolve(acknowledgement()); await oldSave;
  assert.equal(h.attempt.getSnapshot().result, result); assert.deepEqual(h.commits, [4]);
});

test('retake clears the prior result and answers and can submit a separate attempt', async () => {
  const h = host(); h.answerAll(false); await h.attempt.submit();
  assert.equal(h.attempt.retake(), true); assert.equal(h.attempt.getSnapshot().phase, 'answering');
  assert.equal(h.attempt.getSnapshot().index, 0); assert.deepEqual(h.attempt.getSnapshot().answers, {});
  assert.deepEqual(h.attempt.getSnapshot().checked, {});
  assert.equal(h.attempt.getSnapshot().result, null); assert.equal(h.attempt.getSnapshot().error, null);
  h.answerAll(); await h.attempt.submit(); assert.equal(h.attempt.getSnapshot().result.outcome, 'saved'); assert.deepEqual(h.commits, [1]);
});

test('unavailable or changed content is re-read at each action and cannot retain answers', async () => {
  const h = host(); h.answerAll(); h.source = null;
  assert.equal(await h.attempt.submit(), false); assert.equal(h.attempt.getSnapshot().phase, 'unavailable');
  assert.deepEqual(h.attempt.getSnapshot().answers, {}); assert.equal(h.attempt.choose('q1', 'q1.a'), false);
  assert.deepEqual(h.attempt.getSnapshot().checked, {});
  assert.equal(h.attempt.next(), false); assert.equal(h.attempt.previous(), false); assert.equal(h.attempt.retake(), false);
  h.source = quiz('quiz-b'); assert.equal(h.attempt.getSnapshot().phase, 'answering');
  assert.deepEqual(h.attempt.getSnapshot().answers, {}); assert.deepEqual(h.writes, []); assert.deepEqual(h.commits, []);
  assert.deepEqual(h.attempt.getSnapshot().checked, {});
});

for (const change of ['content', 'account', 'generation', 'dispose', 'retake']) {
  test('late save cannot commit or publish completion after ' + change, async () => {
    const gate = deferred(), h = host({ save: () => gate.promise }); h.answerAll(); const pending = h.attempt.submit();
    if (change === 'content') h.source = quiz('quiz-b');
    else if (change === 'account') h.owner = { uid: 'owner-b', generation: 1 };
    else if (change === 'generation') h.owner = { uid: 'owner-a', generation: 2 };
    else if (change === 'dispose') h.attempt.dispose();
    else h.attempt.retake();
    gate.resolve(acknowledgement()); await pending;
    assert.deepEqual(h.commits, []); assert.equal(h.attempt.getSnapshot().result, null);
    assert.equal(h.attempt.getSnapshot().saving, false);
  });
}

test('A-to-B-to-A content changes retire a pending attempt even when its original key returns', async () => {
  const gate = deferred(), h = host({ save: () => gate.promise }), original = h.source; h.answerAll(); const pending = h.attempt.submit();
  h.source = quiz('quiz-b'); h.attempt.getSnapshot(); h.source = original; h.attempt.getSnapshot();
  gate.resolve(acknowledgement()); await pending; assert.deepEqual(h.commits, []); assert.equal(h.attempt.getSnapshot().result, null);
});

test('a retired save cannot clear or complete a newer attempt that is still saving', async () => {
  const first = deferred(), second = deferred(); let calls = 0;
  const h = host({ save: () => ++calls === 1 ? first.promise : second.promise });
  h.answerAll(); const oldSave = h.attempt.submit(); h.attempt.retake(); h.answerAll(); const newSave = h.attempt.submit();
  first.resolve(acknowledgement()); await oldSave;
  assert.equal(h.attempt.getSnapshot().saving, true); assert.equal(h.attempt.getSnapshot().result, null); assert.deepEqual(h.commits, []);
  second.resolve(acknowledgement()); await newSave;
  assert.equal(h.attempt.getSnapshot().saving, false); assert.equal(h.attempt.getSnapshot().result.outcome, 'saved');
  assert.deepEqual(h.commits, [1]);
});

test('content or owner changes invalidate save-only retry without writing', async () => {
  for (const change of ['content', 'owner']) {
    const h = host({ save: () => Promise.reject(new Error('fixture offline')) }); h.answerAll(); await h.attempt.submit();
    if (change === 'content') h.source = quiz('quiz-b'); else h.owner = { uid: 'owner-a', generation: 2 };
    assert.equal(await h.attempt.retrySave(), false); assert.equal(h.writes.length, 1); assert.deepEqual(h.commits, []);
    assert.equal(h.attempt.getSnapshot().result, null);
  }
});

test('unsubscribe and dispose suppress later notifications and actions', async () => {
  const h = host(); h.unsubscribe(); h.attempt.choose('q1', 'q1.a'); assert.equal(h.notices.length, 0);
  h.attempt.dispose(); h.attempt.dispose();
  assert.equal(h.attempt.choose('q2', 'q2.b'), false); assert.equal(await h.attempt.submit(), false);
  assert.equal(h.attempt.checkAnswer('q2'), false);
  assert.equal(await h.attempt.retrySave(), false); assert.equal(h.attempt.retake(), false);
  assert.deepEqual(h.writes, []); assert.deepEqual(h.commits, []);
});

function runtimeHost() {
  let uid = 'owner-a', authListener, unsubscriptions = 0;
  const writes = [], commits = [];
  const runtime = load('quizRuntime').createQuizRuntime({
    getUid: () => uid,
    subscribeAuth: listener => { authListener = listener; return () => unsubscriptions++; },
    getLevel: () => 2,
    saveProgress: (...args) => { writes.push(args); return Promise.resolve(acknowledgement(args[1])); },
    commitLevel: level => commits.push(level),
  });
  return { runtime, writes, commits, setUid: next => { uid = next; }, event: value => authListener(value), unsubscriptions: () => unsubscriptions };
}

test('runtime keeps owner identity stable and increments generation on observed uid transitions', async () => {
  const h = runtimeHost(), { runtime } = h, owner = runtime.getOwner(), notices = [];
  const unsubscribe = runtime.subscribe(() => notices.push(runtime.getOwner()));
  assert.equal(owner, runtime.getOwner()); assert.deepEqual(owner, { uid: 'owner-a', generation: 0 }); assert.ok(Object.isFrozen(owner));
  h.setUid('owner-b'); const second = runtime.getOwner(); assert.deepEqual(second, { uid: 'owner-b', generation: 1 });
  h.event({ uid: 'owner-b' }); assert.equal(runtime.getOwner(), second);
  h.setUid(null); h.event(null); h.setUid('owner-a'); h.event({ uid: 'owner-a' });
  assert.deepEqual(runtime.getOwner(), { uid: 'owner-a', generation: 3 }); assert.equal(notices.length, 3);
  assert.equal(runtime.getLevel(), 2); await runtime.saveProgress('owner-a', 3); runtime.commitLevel(3);
  assert.deepEqual(h.writes, [['owner-a', 3]]); assert.deepEqual(h.commits, [3]);
  unsubscribe(); runtime.dispose(); runtime.dispose(); assert.equal(h.unsubscriptions(), 1);
});

test('runtime catches an auth A-to-B-to-A cycle while a quiz save is pending', async () => {
  const h = runtimeHost(), gate = deferred(), commits = [];
  const attempt = load('quizAttempt').createQuizAttempt({
    ...h.runtime, getQuiz: () => quiz(), getLevel: () => 0,
    saveProgress: () => gate.promise, commitLevel: level => commits.push(level),
  });
  attempt.choose('q1', 'q1.a'); attempt.checkAnswer('q1'); attempt.next('q1');
  attempt.choose('q2', 'q2.b'); attempt.checkAnswer('q2'); const pending = attempt.submit();
  h.setUid('owner-b'); h.event({ uid: 'owner-b' }); h.setUid('owner-a'); h.event({ uid: 'owner-a' });
  gate.resolve(acknowledgement()); await pending; assert.deepEqual(commits, []); assert.equal(attempt.getSnapshot().result, null);
  attempt.dispose(); h.runtime.dispose();
});

test('runtime stops observing auth after disposal', () => {
  const h = runtimeHost(), notices = [];
  h.runtime.subscribe(() => notices.push(h.runtime.getOwner())); h.runtime.dispose();
  h.setUid('owner-b'); h.event({ uid: 'owner-b' });
  assert.deepEqual(h.runtime.getOwner(), { uid: 'owner-a', generation: 0 }); assert.deepEqual(notices, []);
  assert.equal(h.unsubscriptions(), 1);
});
