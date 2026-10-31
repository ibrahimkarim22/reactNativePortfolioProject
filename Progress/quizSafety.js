const { validateQuizContent } = require('../course/quizContent');

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const nonblank = value => typeof value === 'string' && value.trim().length > 0;
const validId = value => nonblank(value) || Number.isSafeInteger(value) && value > 0;

// Technical validity only. Authored facts and distractors still need editorial
// review against the play; a structurally valid quiz is not approved content.
function validateQuiz(play) {
  if (!play || !nonblank(play.id) || !Number.isSafeInteger(play.difficulty) || play.difficulty < 1) return null;
  // An explicitly supplied authored envelope owns this boundary, even when it
  // is malformed. Legacy questions cannot rescue stale or invalid source data.
  if (own(play, 'quizContent')) {
    const content = validateQuizContent(play.quizContent, play.canonicalDocument);
    if (!content || content.workId !== play.id) return null;
    const questions = Object.freeze(content.questions.map(question => Object.freeze({
      id: question.id, question: question.question,
      options: Object.freeze(question.options.map(option => option.id)),
      choices: question.options, correctAnswer: question.correctOptionId,
      explanation: question.explanation, evidence: question.evidence,
    })));
    const key = JSON.stringify([play.id, play.difficulty, content]);
    return Object.freeze({ key, playId: play.id, level: play.difficulty, questions });
  }
  if (!Array.isArray(play.quiz) || play.quiz.length === 0) return null;
  const ids = new Set(), questions = [];
  for (const question of play.quiz) {
    if (!question || !validId(question.id) || !nonblank(question.question)
        || !Array.isArray(question.options) || question.options.length < 2 || !nonblank(question.correctAnswer)) return null;
    const id = String(question.id);
    if (ids.has(id)) return null;
    ids.add(id);
    // Array.from includes sparse slots, which must not silently disappear.
    const options = Array.from(question.options);
    if (options.some(option => !nonblank(option)) || new Set(options.map(option => option.trim())).size !== options.length
        || options.filter(option => option === question.correctAnswer).length !== 1) return null;
    const choices = Object.freeze(options.map(option => Object.freeze({ id: option, text: option })));
    questions.push(Object.freeze({ id: question.id, question: question.question,
      options: Object.freeze(options), choices, correctAnswer: question.correctAnswer,
      explanation: typeof question.explanation === 'string' ? question.explanation : '', evidence: Object.freeze([]) }));
  }
  const key = JSON.stringify([play.id, play.difficulty, questions]);
  return Object.freeze({ key, playId: play.id, level: play.difficulty, questions: Object.freeze(questions) });
}

function evaluateSubmission(play, answers, expectedKey) {
  const quiz = validateQuiz(play);
  if (!quiz || quiz.key !== expectedKey) return { status: 'unavailable' };
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)
      || Object.keys(answers).length !== quiz.questions.length
      || quiz.questions.some(question => !own(answers, question.id) || !question.options.includes(answers[question.id]))) {
    return { status: 'incomplete' };
  }
  const correct = quiz.questions.filter(question => answers[question.id] === question.correctAnswer).length;
  return { status: 'complete', correct, total: quiz.questions.length, passed: correct === quiz.questions.length, level: quiz.level };
}

module.exports = { validateQuiz, evaluateSubmission };
