const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');

const root = path.resolve(__dirname, '../..');
const fixture = () => ({
  slug: 'a-midsummer-nights-dream', name: "A Midsummer Night's Dream", difficulty: 1,
  play: { title: 'A MIDSUMMER NIGHT’S DREAM', author: 'William Shakespeare', genre: 'Comedy', acts: [{}, {}, {}, {}, {}] },
  synopsis: { playSummary: '', acts: [], scenes: [] }, quiz: { questions: [] },
});
const legacyQuestion = () => ({ id: 1, question: 'Fixture question?',
  options: ['Fixture answer', 'Fixture distractor'], correctAnswer: 'Fixture answer' });
function authoredFixture() {
  const entry = fixture();
  const directory = path.join(root, 'data/plays', entry.slug);
  const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  entry.play = json(path.join(directory, 'play.json'));
  entry.sections = entry.play.sections.map(ref => json(path.join(directory, ref.path)));
  entry.quiz = json(path.join(directory, 'quiz.json'));
  return entry;
}
const nodes = (tree, type) => !tree || typeof tree !== 'object' ? [] : [
  ...(tree.type === type ? [tree] : []), ...(tree.props?.children || []).flat(Infinity).flatMap(child => nodes(child, type)),
];
const text = tree => typeof tree === 'string' || typeof tree === 'number' ? String(tree) : !tree || typeof tree !== 'object'
  ? '' : (tree.props?.children || []).flat(Infinity).map(text).join(' ');

function host(options = {}) {
  const { entry = fixture() } = options;
  const params = Object.hasOwn(options, 'params') ? options.params : { id: 'a-midsummer-nights-dream' };
  const calls = [], actions = [], slots = [];
  let cursor = 0, effects = [];
  const React = {
    createElement(type, props, ...children) {
      const next = { ...props, children };
      return typeof type === 'function' ? type(next) : { type, props: next };
    },
    useEffect(callback, dependencies) {
      const index = cursor++;
      if (!slots[index] || !dependencies.every((value, i) => Object.is(value, slots[index][i]))) {
        slots[index] = dependencies; effects.push(callback);
      }
    },
  };
  const route = { params };
  const navigation = { navigate: (...args) => calls.push(args) };
  const native = Object.fromEntries(['View', 'Text', 'Button', 'Pressable', 'ScrollView', 'ActivityIndicator', 'StatusBar'].map(name => [name, name]));
  native.StyleSheet = { create: value => value };
  const cache = new Map();
  const dependencies = {
    react: React, 'react-native': native,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'react-native-gesture-handler': { ScrollView: 'ScrollView' },
    'react-native-htmlview': { __esModule: true, default: 'HTMLView' },
    '@react-navigation/native': { useRoute: () => route, useNavigation: () => navigation },
    'react-redux': {
      useDispatch: () => action => actions.push(action),
      useSelector: select => select({ folger: { isLoading: false, htmlContent: '<h2>Duplicate title</h2><p>Local synopsis data has not been written yet.</p>' } }),
    },
    '../shared/localPlayService': {
      getLocalPlayEntry: id => entry && [entry.slug, entry.legacyId].includes(id) ? entry : undefined,
    },
    '../folgerLibrary/folgerSlice': { fetchFolger: id => ({ type: 'fixture/synopsis', id }) },
    '../completeWorks/MITShakespeareSlice': { fetchMIT: id => ({ type: 'fixture/play', id }) },
    '../charactersList/FolgerCharacterList': { fetchFolgerCharacter: id => ({ type: 'fixture/characters', id }) },
    '../Componenets/Loader': { __esModule: true, default: 'Loader' },
  };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const code = babel.transformFileSync(file, { babelrc: false, configFile: false,
      plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
    const module = { exports: {} };
    vm.runInThisContext('(function(require,module,exports,React){' + code + '\n})', { filename: file })(name => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + (path.extname(name) ? '' : '.js')));
      return require(name);
    }, module, module.exports, React);
    cache.set(file, module.exports); return module.exports;
  }
  const Screen = load(path.join(root, 'screens/LessonScreen.js')).default;
  const h = { calls, actions, route,
    render() { cursor = 0; effects = []; const tree = Screen(); effects.forEach(run => run()); return tree; },
    button(title) {
      const tree = h.render();
      return [...nodes(tree, 'Pressable'), ...nodes(tree, 'Button')].find(node => node.props.title === title || node.props.accessibilityLabel === title);
    },
  };
  return h;
}

test('lesson shows one source title and metadata without generated synopsis placeholders', () => {
  const h = host(), tree = h.render();
  assert.equal(nodes(tree, 'Text').filter(node => text(node) === "A Midsummer Night's Dream").length, 1);
  assert.match(text(tree), /Lesson 1/); assert.match(text(tree), /William Shakespeare/);
  assert.match(text(tree), /Comedy/); assert.match(text(tree), /5 acts/);
  assert.equal(nodes(tree, 'HTMLView').length, 0);
  assert.doesNotMatch(text(tree), /synopsis.*not.*written|coming soon|placeholder/i);
  assert.deepEqual(h.actions, [], 'opening a local lesson does not fetch a legacy synopsis');
});

test('lesson actions use the shared reader and the nested course route without legacy fetches', () => {
  const entry = fixture(); entry.quiz.questions = [legacyQuestion()];
  const h = host({ entry });
  h.button('Read play').props.onPress();
  h.button('Start quiz').props.onPress();
  h.button('Back to course').props.onPress();
  assert.deepEqual(h.calls, [['MIT', { id: entry.slug }], ['Quiz', { id: entry.slug }], ['Main', { screen: 'Course' }]]);
  assert.deepEqual(h.actions, []);
});

test('empty quiz has no enabled start action and does not pretend the activity is ready', () => {
  const h = host(), button = h.button('Start quiz');
  assert.equal(button.props.disabled, true);
  assert.match(text(h.render()), /Quiz unavailable/);
  assert.deepEqual(h.actions, []);
});

test('nonempty malformed questions do not advertise an available quiz', () => {
  for (const questions of [[null], [{ id: 1 }], [{ ...legacyQuestion(), correctAnswer: 'Absent answer' }]]) {
    const entry = fixture(); entry.quiz.questions = questions;
    const h = host({ entry }), button = h.button('Start quiz');
    assert.equal(button.props.disabled, true);
    assert.equal(button.props.onPress, undefined);
    assert.match(text(h.render()), /Quiz unavailable/);
  }
});

test('the approved source-linked quiz enables the lesson start action', () => {
  const entry = authoredFixture(), h = host({ entry });
  assert.equal(h.button('Start quiz').props.disabled, false);
  assert.doesNotMatch(text(h.render()), /Quiz unavailable/);
  h.button('Start quiz').props.onPress();
  assert.deepEqual(h.calls, [['Quiz', { id: entry.slug }]]);
});

test('stale or malformed source-linked quizzes stay unavailable at the lesson boundary', () => {
  const changes = [
    entry => { entry.quiz.contentVersion = 'stale'; },
    entry => { entry.quiz.questions[0].evidence[0].exact += '!'; },
    entry => { entry.quiz.questions = [null]; },
    entry => { entry.sections[0].contentVersion = 'stale'; },
    entry => { entry.quiz.schemaVersion = '3.0.0'; entry.quiz.questions = [legacyQuestion()]; },
  ];
  for (const change of changes) {
    const entry = authoredFixture(); change(entry);
    const h = host({ entry }), button = h.button('Start quiz');
    assert.equal(button.props.disabled, true);
    assert.equal(button.props.onPress, undefined);
    assert.match(text(h.render()), /Quiz unavailable/);
    assert.deepEqual(h.actions, []);
  }
});

test('authored synopsis text is preserved and blank summary sections are omitted', () => {
  const entry = fixture();
  entry.synopsis = {
    playSummary: 'The authored summary.',
    acts: [{ act: 1, summary: 'The authored act summary.' }, { act: 2, summary: ' ' }],
    scenes: [{ label: 'Act 1, Scene 1', summary: 'The authored scene summary.' }, { label: 'Empty scene', summary: '' }],
  };
  const tree = host({ entry }).render();
  assert.match(text(tree), /The authored summary\./); assert.match(text(tree), /Act 1/);
  assert.match(text(tree), /The authored act summary\./); assert.match(text(tree), /The authored scene summary\./);
  assert.doesNotMatch(text(tree), /Act 2|Empty scene/);
});

test('invalid or missing routes cannot silently open the first local play', () => {
  for (const params of [undefined, null, {}, { id: '' }, { id: {} }, { id: 'unknown' }]) {
    const h = host({ params }), tree = h.render();
    assert.match(text(tree), /Lesson unavailable/);
    assert.equal(h.button('Read play'), undefined); assert.equal(h.button('Start quiz'), undefined);
    h.button('Back to course').props.onPress();
    assert.deepEqual(h.calls, [['Main', { screen: 'Course' }]]); assert.deepEqual(h.actions, []);
  }
});

test('lesson uses natural scrolling and labels allow font scaling without line limits', () => {
  const tree = host().render();
  assert.equal(nodes(tree, 'StatusBar')[0]?.props.barStyle, 'light-content');
  assert.equal(nodes(tree, 'ScrollView').length, 1);
  assert.deepEqual(nodes(tree, 'SafeAreaView')[0].props.edges, ['left', 'right', 'bottom']);
  for (const node of nodes(tree, 'Text')) {
    assert.notEqual(node.props.allowFontScaling, false);
    assert.equal(node.props.numberOfLines, undefined);
  }
  const title = nodes(tree, 'Text').find(node => text(node) === "A Midsummer Night's Dream");
  assert.equal(title.props.accessibilityRole, 'header');
  for (const button of nodes(tree, 'Pressable')) {
    assert.equal(button.props.accessibilityRole, 'button');
    assert.equal(button.props.accessibilityState.disabled, !!button.props.disabled);
  }
});

test('authored metadata cannot fall back to legacy eligibility when schemaVersion is missing', () => {
  for (const marker of ['quizContentVersion', 'workId', 'contentVersion', 'canonicalTextVersion']) {
    const entry = fixture();
    entry.quiz = { [marker]: 'stale-authored-marker', questions: [legacyQuestion()] };
    const h = host({ entry }), button = h.button('Start quiz');
    assert.equal(button.props.disabled, true, marker);
    assert.equal(button.props.onPress, undefined);
    assert.match(text(h.render()), /Quiz unavailable/);
  }
});
