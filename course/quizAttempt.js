const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const emptyAnswers = () => Object.freeze({});
const validLevel = level => Number.isSafeInteger(level) && level >= 0;
const failure = code => Object.freeze({ code });
const validAcknowledgement = (value, level) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.isFrozen(value) && own(value, 'completedLevel') && own(value, 'advanced')
  && validLevel(value.completedLevel) && value.completedLevel >= level && typeof value.advanced === 'boolean'
  && (!value.advanced || value.completedLevel === level);

function choiceOrderFor(quiz, random, previous) {
  return Object.freeze(Object.fromEntries((quiz?.questions || []).map(question => {
    const order = [...question.options];
    for (let index = order.length - 1; index > 0; index--) {
      const other = Math.floor(random() * (index + 1));
      [order[index], order[other]] = [order[other], order[index]];
    }
    const priorPosition = previous?.[question.id]?.indexOf(question.correctAnswer);
    const position = order.indexOf(question.correctAnswer);
    // A retake must not leave the correct answer in the same displayed slot.
    // One bounded swap also works when consecutive random draws repeat.
    if (order.length > 1 && priorPosition === position) {
      const other = (position + 1 + Math.floor(random() * (order.length - 1))) % order.length;
      [order[position], order[other]] = [order[other], order[position]];
    }
    return [question.id, Object.freeze(order)];
  })));
}

function createQuizAttempt({ getQuiz, getOwner, getLevel, saveProgress, commitLevel, random = Math.random }) {
  const listeners = new Set();
  let disposed = false, scope = null, currentQuiz = null, currentOwner = null, inFlight = null;
  let snapshot;

  const publish = change => {
    snapshot = Object.freeze({ ...snapshot, ...change });
    for (const listener of [...listeners]) listener();
  };
  const freshState = (quiz, previousOrder) => ({ phase: quiz ? 'answering' : 'unavailable', index: 0,
    choiceOrder: choiceOrderFor(quiz, random, previousOrder),
    attemptToken: Object.freeze({}), answers: emptyAnswers(), checked: emptyAnswers(), result: null, saving: false, error: null });

  const synchronize = () => {
    if (disposed) return false;
    // The caller validates the source on every read. Never treat a captured
    // render, answer set, or earlier validation as authority to submit.
    const quiz = getQuiz() || null;
    const owner = getOwner() || { uid: null, generation: 0 };
    const key = JSON.stringify([quiz?.key || null, owner.uid || null, owner.generation]);
    currentQuiz = quiz;
    currentOwner = owner;
    if (scope?.key !== key) {
      scope = { key };
      inFlight = null;
      publish(freshState(quiz));
    }
    return !!quiz;
  };
  const matchesToken = expected => expected === undefined || expected === snapshot.attemptToken;
  const editable = expected => synchronize() && matchesToken(expected) && snapshot.phase === 'answering' && !snapshot.saving && !inFlight;
  const currentQuestion = expectedId => {
    const question = currentQuiz?.questions[snapshot.index];
    return question && (expectedId === undefined || expectedId === question.id) ? question : null;
  };
  const isCurrent = request => {
    synchronize();
    return !disposed && scope === request.scope && inFlight === request;
  };
  const showResult = (score, outcome, error = null) => {
    publish({ phase: 'results', result: Object.freeze({ ...score, outcome }), saving: false, error });
  };

  async function persist(score) {
    const uid = currentOwner?.uid;
    if (!uid) { showResult(score, 'sign-in', failure('SIGN_IN_REQUIRED')); return true; }
    const previousLevel = getLevel();
    if (!validLevel(previousLevel)) { showResult(score, 'invalid-progress', failure('INVALID_PROGRESS')); return true; }
    if (score.level <= previousLevel) { showResult(score, 'replay'); return true; }

    const request = { scope, uid };
    inFlight = request;
    publish({ saving: true, error: null });
    try {
      if (!isCurrent(request)) return false;
      const acknowledgement = await saveProgress(uid, score.level);
      if (!isCurrent(request)) return false;
      if (!validAcknowledgement(acknowledgement, score.level)) throw new Error('Unconfirmed progress acknowledgement');
      const latestLevel = getLevel();
      // The transaction result is confirmed even if a later progress read is
      // temporarily unavailable. Keep a newer confirmed local value as well.
      commitLevel(Math.max(validLevel(latestLevel) ? latestLevel : 0, acknowledgement.completedLevel));
      if (!isCurrent(request)) return false;
      showResult(score, acknowledgement.advanced ? 'saved' : 'replay');
      return true;
    } catch (_) {
      if (!isCurrent(request)) return false;
      showResult(score, 'save-failed', failure('SAVE_FAILED'));
      return true;
    } finally {
      if (inFlight === request) inFlight = null;
    }
  }

  synchronize();

  return Object.freeze({
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() { synchronize(); return snapshot; },
    choose(questionId, option, expectedToken) {
      if (!editable(expectedToken)) return false;
      const question = currentQuestion(questionId);
      if (!question?.options.includes(option) || own(snapshot.checked, question.id)) return false;
      if (own(snapshot.answers, questionId) && snapshot.answers[questionId] === option) return true;
      publish({ answers: Object.freeze({ ...snapshot.answers, [questionId]: option }) });
      return true;
    },
    checkAnswer(expectedQuestionId, expectedToken) {
      if (!editable(expectedToken)) return false;
      const question = currentQuestion(expectedQuestionId);
      if (!question || own(snapshot.checked, question.id) || !own(snapshot.answers, question.id)
          || !question.options.includes(snapshot.answers[question.id])) return false;
      publish({ checked: Object.freeze({ ...snapshot.checked, [question.id]: snapshot.answers[question.id] }) });
      return true;
    },
    previous(expectedQuestionId, expectedToken) {
      if (!editable(expectedToken) || !currentQuestion(expectedQuestionId) || snapshot.index === 0) return false;
      publish({ index: snapshot.index - 1 });
      return true;
    },
    next(expectedQuestionId, expectedToken) {
      if (!editable(expectedToken)) return false;
      const question = currentQuestion(expectedQuestionId);
      if (!question || snapshot.index >= currentQuiz.questions.length - 1 || !own(snapshot.checked, question.id)) return false;
      publish({ index: snapshot.index + 1 });
      return true;
    },
    async submit(expectedQuestionId, expectedToken) {
      if (!editable(expectedToken) || !currentQuestion(expectedQuestionId) || snapshot.index !== currentQuiz.questions.length - 1) return false;
      const quiz = currentQuiz, answers = snapshot.checked;
      if (Object.keys(answers).length !== quiz.questions.length
          || quiz.questions.some(question => !own(answers, question.id) || !question.options.includes(answers[question.id]))) return false;
      const correct = quiz.questions.filter(question => answers[question.id] === question.correctAnswer).length;
      const score = Object.freeze({ correct, total: quiz.questions.length, passed: correct === quiz.questions.length,
        level: quiz.level, answers });
      if (!score.passed) { showResult(score, 'failed'); return true; }
      return persist(score);
    },
    async retrySave(expectedToken) {
      if (!synchronize() || !matchesToken(expectedToken) || snapshot.phase !== 'results' || snapshot.result?.outcome !== 'save-failed'
          || snapshot.saving || inFlight) return false;
      return persist(snapshot.result);
    },
    retake(expectedToken) {
      if (!synchronize() || !matchesToken(expectedToken)) return false;
      // A fresh identity retires pending work even when the same quiz and
      // account remain selected. Its late save cannot finish this attempt.
      scope = { key: scope.key };
      inFlight = null;
      publish(freshState(currentQuiz, snapshot.choiceOrder));
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      inFlight = null;
      listeners.clear();
      snapshot = Object.freeze({ ...snapshot, saving: false });
    },
  });
}

module.exports = { createQuizAttempt };
