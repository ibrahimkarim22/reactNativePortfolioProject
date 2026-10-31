const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const babel = require('@babel/core');

const root = path.resolve(__dirname, '../..');
function entry({ course, highlights, dev = true } = {}) {
  const imports = [];
  const code = babel.transformFileSync(path.join(root, 'App.js'), {
    babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'],
  }).code;
  const module = { exports: {} };
  const context = { module, exports: module.exports, __DEV__: dev,
    process: { env: { EXPO_PUBLIC_BARD_COURSE_UI_TEST: course, EXPO_PUBLIC_BARD_HIGHLIGHT_SYNC_TEST: highlights } },
    require(name) { imports.push(name); return { default: name }; } };
  vm.runInNewContext(code, context);
  return { imports, component: module.exports.default };
}

test('normal entry without an opt-in loads only the existing normal application', () => {
  assert.deepEqual(entry().imports, ['./NormalApp']);
  assert.equal(entry({ dev: false }).component, './NormalApp');
});

test('explicit development opt-in selects only the isolated course boundary', () => {
  assert.deepEqual(entry({ course: 'isolated' }).imports, ['./course/CoursePilotHarness']);
});

test('invalid, release, or conflicting course opt-ins fail closed without normal fallback', () => {
  for (const options of [{ course: 'true' }, { course: 'isolated', dev: false },
    { course: 'isolated', highlights: 'emulator' }]) assert.throws(() => entry(options), /isolated|development|conflict/i);
});

test('the existing explicit highlight emulator entry is preserved', () => {
  assert.deepEqual(entry({ highlights: 'emulator' }).imports, ['./reader/HighlightSyncEmulatorHarness']);
});

function loadScenarioFactory() {
  const file = path.join(root, 'course/CoursePilotHarness.js');
  const imports = [];
  const cache = new Map();
  const boundaries = {
    react: {}, 'react-native': { StatusBar: 'StatusBar' },
    'react-native-safe-area-context': { SafeAreaProvider: 'SafeAreaProvider' },
    'react-redux': { Provider: 'Provider' },
    '@react-navigation/native': { NavigationContainer: 'NavigationContainer' },
    '@react-navigation/stack': { createStackNavigator: () => ({ Navigator: 'Navigator', Screen: 'Screen' }) },
    '../screens/LessonScreen': { default: 'Lesson' }, '../screens/QuizScreen': { default: 'Quiz' },
    './CourseUI': {},
  };
  function load(current) {
    if (cache.has(current)) return cache.get(current);
    const code = babel.transformFileSync(current, { babelrc: false, configFile: false,
      plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
    const module = { exports: {} };
    vm.runInThisContext('(function(require,module,exports,__DEV__,process){' + code + '\n})', { filename: current })(name => {
      imports.push(name);
      if (Object.hasOwn(boundaries, name)) return boundaries[name];
      if (name.startsWith('.')) return load(path.resolve(path.dirname(current), name + (path.extname(name) ? '' : '.js')));
      return require(name);
    }, module, module.exports, true, { env: { EXPO_PUBLIC_BARD_COURSE_UI_TEST: 'isolated' } });
    cache.set(current, module.exports); return module.exports;
  }
  return { create: load(file).createPilotScenario, imports };
}

test('scenario creation never imports normal Firebase, persistence, auth screens, or the real store', () => {
  const { create, imports } = loadScenarioFactory();
  const scenario = create('pass');
  assert.equal(scenario.runtime.getLevel(), 0);
  assert.equal(scenario.runtime.getOwner().uid, 'course-preview-owner');
  assert.ok(imports.every(name => !/firebase|AsyncStorage|redux\/store|AuthLogin|ReaderScreen|normalHighlight/i.test(name)), imports.join(', '));
  scenario.dispose();
});

test('isolated scenarios exercise pass, one failed save, replay, and signed-out without persistent writes', async () => {
  const { create } = loadScenarioFactory();
  for (const mode of ['pass', 'save-failed', 'replay', 'signed-out']) {
    const scenario = create(mode);
    assert.equal(scenario.runtime.getLevel(), mode === 'replay' ? 1 : 0);
    assert.equal(scenario.runtime.getOwner().uid, mode === 'signed-out' ? null : 'course-preview-owner');
    if (mode === 'signed-out') {
      await assert.rejects(scenario.runtime.saveProgress('course-preview-owner', 1), /invalid/i);
      assert.equal(scenario.getStats().saveCalls, 0);
      scenario.dispose(); continue;
    }
    if (mode === 'save-failed') await assert.rejects(scenario.runtime.saveProgress('course-preview-owner', 1), /simulated/i);
    const acknowledgement = await scenario.runtime.saveProgress('course-preview-owner', 1);
    assert.ok(Object.isFrozen(acknowledgement));
    assert.deepEqual(acknowledgement, { completedLevel: 1, advanced: mode !== 'replay' });
    assert.equal(scenario.runtime.getLevel(), mode === 'replay' ? 1 : 0, 'save does not award before controller confirmation');
    scenario.runtime.commitLevel(1);
    assert.equal(scenario.runtime.getLevel(), 1);
    scenario.dispose();
  }
  assert.throws(() => create('live'), /scenario/i);
});

test('the preview substitutes storage while the real controller grades and saves the bundled Midsummer quiz', async () => {
  const fs = require('node:fs');
  const { createQuizAttempt } = require('../../course/quizAttempt');
  const { validateQuiz } = require('../../Progress/quizSafety');
  const { buildCanonicalDocument } = require('../../shared/contentText');
  const folder = path.join(root, 'data/plays/a-midsummer-nights-dream');
  const read = file => JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8'));
  const play = read('play.json'), quizContent = read('quiz.json');
  const canonicalDocument = buildCanonicalDocument({ play, sections: play.sections.map(section => read(section.path)) });
  const quiz = validateQuiz({ id: quizContent.workId, difficulty: 1, quizContent, canonicalDocument });
  assert.ok(quiz); assert.equal(quiz.questions.length, 10);
  const { create } = loadScenarioFactory();
  for (const mode of ['pass', 'save-failed', 'replay', 'signed-out']) {
    const scenario = create(mode);
    const attempt = createQuizAttempt({ ...scenario.runtime, getQuiz: () => quiz });
    const attemptToken = attempt.getSnapshot().attemptToken;
    for (const question of quiz.questions) {
      attempt.choose(question.id, question.correctAnswer, attemptToken);
      attempt.checkAnswer(question.id, attemptToken); attempt.next(question.id, attemptToken);
    }
    await attempt.submit(quiz.questions.at(-1).id, attemptToken);
    assert.equal(attempt.getSnapshot().result.correct, 10);
    assert.equal(attempt.getSnapshot().result.total, 10);
    if (mode === 'save-failed') {
      const failed = attempt.getSnapshot().result;
      assert.equal(failed.outcome, 'save-failed');
      assert.equal(scenario.getStats().completedLevel, 0);
      await attempt.retrySave(attemptToken);
      assert.equal(attempt.getSnapshot().result.answers, failed.answers);
    }
    assert.equal(attempt.getSnapshot().result.outcome,
      mode === 'replay' ? 'replay' : mode === 'signed-out' ? 'sign-in' : 'saved');
    assert.deepEqual(scenario.getStats(), {
      saveCalls: mode === 'save-failed' ? 2 : mode === 'pass' ? 1 : 0,
      completedLevel: mode === 'signed-out' ? 0 : 1,
    });
    attempt.dispose(); scenario.dispose();
  }
});
