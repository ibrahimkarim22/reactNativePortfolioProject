const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const crypto = require('node:crypto');
const { load } = require('cheerio');
const { buildCanonicalDocument, resolveSelection } = require('../../shared/contentText');

const root = path.resolve(__dirname, '../..');
const workId = 'a-midsummer-nights-dream';
const contentVersion = '8aa631f1bdba8a8599f5ac0f0dc846dd8e9c009203187a0da7353d5e68a96e75';
const sourceSHA256 = 'd7116e381ba4f0164ba059f6d0e135e07af068b4ab486b57fa7deec6a305d5c3';
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const json = file => JSON.parse(read(file));
const play = json(`data/plays/${workId}/play.json`);
const sections = play.sections.map(ref => json(path.posix.join('data/plays', workId, ref.path)));
const canonical = buildCanonicalDocument({ play, sections });
const quiz = () => json(`data/plays/${workId}/quiz.json`);
const copy = value => JSON.parse(JSON.stringify(value));
function validate(content, document = canonical) {
  const file = path.join(root, 'course/quizContent.js');
  assert.ok(fs.existsSync(file), 'the pure authored-quiz validator must exist');
  return require(file).validateQuizContent(content, document);
}

test('authored metadata always selects source validation even when its schema is missing or legacy', () => {
  const { isSourceLinkedQuiz } = require('../../course/quizContent');
  assert.equal(typeof isSourceLinkedQuiz, 'function');
  for (const field of ['quizContentVersion', 'workId', 'contentVersion', 'canonicalTextVersion']) {
    assert.equal(isSourceLinkedQuiz({ [field]: 'authored-marker', questions: [] }), true);
    assert.equal(isSourceLinkedQuiz({ schemaVersion: '1.0.0', [field]: undefined, questions: [] }), true);
  }
  for (const schemaVersion of ['2.0.0', '3.0.0', null, undefined, '']) {
    assert.equal(isSourceLinkedQuiz({ schemaVersion, questions: [] }), true);
  }
  for (const content of [null, undefined, [], { questions: [] }, { schemaVersion: '1.0.0', questions: [] }]) {
    assert.equal(isSourceLinkedQuiz(content), false);
  }
});

test('authored prose preserves apostrophes without encoding replacement question marks', () => {
  for (const question of quiz().questions) {
    for (const value of [question.question, question.explanation, ...question.options.map(option => option.text)]) {
      assert.doesNotMatch(value, /\?(?!$)/, `${question.id}: question marks belong only at the end of a prompt`);
    }
  }
  assert.equal(quiz().questions[4].question,
    "In the craftsmen's play, what makes Pyramus believe a lion has killed Thisbe?");
});

// These literals were checked against the pinned Gutenberg HTML, independently
// of createSelection and the quiz validator. They pin the editorial support.
const approved = [
  { id: 'mnd-01', answer: 'mnd-01.a', ranges: [
    [2386, 2463, 'sceneI_24.1/p@4033', 'Stand forth, Demetrius. My noble lord,\nThis man hath my consent to marry her.'],
    [5793, 5826, 'sceneI_24.1/p@8048', 'I am belov’d of beauteous Hermia.'],
  ] },
  { id: 'mnd-02', answer: 'mnd-02.b', ranges: [
    [32049, 32112, 'sceneII_24.2/p@42110', 'Churl, upon thy eyes I throw\nAll the power this charm doth owe;'],
    [33015, 33138, 'sceneII_24.2/p@43382', 'But who is here? Lysander, on the ground!\nDead or asleep? I see no blood, no wound.\nLysander, if you live, good sir, awake.'],
    [33606, 33636, 'sceneII_24.2/p@44593', 'Not Hermia, but Helena I love.'],
  ] },
  { id: 'mnd-03', answer: 'mnd-03.a', ranges: [
    [40097, 40138, 'sceneIII_24.1/p@53187', 'Enter Puck and Bottom with an ass’s head.'],
    [41861, 41910, 'sceneIII_24.1/p@55549', 'On the first view, to say, to swear, I love thee.'],
    [45244, 45278, 'sceneIII_24.2/p@59890', 'An ass’s nole I fixed on his head.'],
  ] },
  { id: 'mnd-04', answer: 'mnd-04.c', ranges: [
    [73174, 73273, 'sceneIV_24.1/p@97293', 'And all the faith, the virtue of my heart,\nThe object and the pleasure of mine eye,\nIs only Helena.'],
    [73581, 73691, 'sceneIV_24.1/p@98093', 'Egeus, I will overbear your will;\nFor in the temple, by and by with us,\nThese couples shall eternally be knit.'],
  ] },
  { id: 'mnd-05', answer: 'mnd-05.b', ranges: [
    [84160, 84428, 'sceneV_24.1/p@111314', 'And as she fled, her mantle she did fall;\nWhich Lion vile with bloody mouth did stain.\nAnon comes Pyramus, sweet youth, and tall,\nAnd finds his trusty Thisbe’s mantle slain;\nWhereat with blade, with bloody blameful blade,\nHe bravely broach’d his boiling bloody breast;'],
  ] },
  { id: 'mnd-06', answer: 'mnd-06.d', ranges: [
    [12118, 12358, 'sceneI_24.1/p@15475', 'I will go tell him of fair Hermia\u2019s flight.\nThen to the wood will he tomorrow night\nPursue her; and for this intelligence\nIf I have thanks, it is a dear expense.\nBut herein mean I to enrich my pain,\nTo have his sight thither and back again.'],
  ] },
  { id: 'mnd-07', answer: 'mnd-07.c', ranges: [
    [17907, 18088, 'sceneII_24.1/p@24007', 'And jealous Oberon would have the child\nKnight of his train, to trace the forests wild:\nBut she perforce withholds the lov\u00e8d boy,\nCrowns him with flowers, and makes him all her joy.'],
  ] },
  { id: 'mnd-08', answer: 'mnd-08.b', ranges: [
    [12601, 12764, 'sceneI_24.2/p@17226', 'Here is the scroll of every man\u2019s name, which is thought fit through all Athens, to play in our interlude before the Duke and Duchess, on his wedding-day at night.'],
  ] },
  { id: 'mnd-09', answer: 'mnd-09.d', ranges: [
    [60758, 61022, 'sceneIII_24.2/p@80424', 'Like to Lysander sometime frame thy tongue,\nThen stir Demetrius up with bitter wrong;\nAnd sometime rail thou like Demetrius.\nAnd from each other look thou lead them thus,\nTill o\u2019er their brows death-counterfeiting sleep\nWith leaden legs and batty wings doth creep.'],
  ] },
  { id: 'mnd-10', answer: 'mnd-10.a', ranges: [
    [95946, 96079, 'sceneV_24.1/p@128272', 'That you have but slumber\u2019d here\n\u00a0\u00a0\u00a0While these visions did appear.\n\u00a0\u00a0\u00a0And this weak and idle theme,\n\u00a0\u00a0\u00a0No more yielding but a dream,'],
  ] },
];

test('the ten approved questions resolve to independently checked Gutenberg support', () => {
  const content = quiz();
  assert.equal(content.schemaVersion, '2.0.0');
  assert.equal(content.id, 'mnd-comprehension');
  assert.equal(content.workId, workId);
  assert.equal(content.contentVersion, contentVersion);
  assert.equal(content.canonicalTextVersion, '1');
  assert.equal(content.quizContentVersion, '1.1.0');
  assert.equal(content.questions.length, 10);
  assert.deepEqual(content.questions.map(question => question.id), Array.from({ length: 10 }, (_, index) => `mnd-${String(index + 1).padStart(2, '0')}`));
  const source = read('data/source/pg100-images.html');
  assert.equal(crypto.createHash('sha256').update(source).digest('hex'), sourceSHA256);
  for (const [index, expected] of approved.entries()) {
    const question = content.questions[index];
    assert.equal(question.id, expected.id);
    assert.equal(question.correctOptionId, expected.answer);
    assert.deepEqual(question.options.map(option => option.id), ['a', 'b', 'c', 'd'].map(letter => `${expected.id}.${letter}`));
    assert.equal(question.evidence.length, expected.ranges.length);
    for (const [evidenceIndex, [start, end, blockSuffix, exact]] of expected.ranges.entries()) {
      const evidence = question.evidence[evidenceIndex];
      assert.deepEqual([evidence.start, evidence.end, evidence.exact], [start, end, exact]);
      assert.equal(evidence.startRef.textId, `${workId}/${blockSuffix}`);
      assert.equal(evidence.endRef.textId, evidence.startRef.textId);
      assert.equal(resolveSelection(canonical, evidence).text, exact);
      const section = sections.find(value => value.section.id === evidence.startRef.sectionId);
      const block = section.content.find(value => value.id === evidence.startRef.textId);
      const markup = source.slice(block.sourceRef.start, block.sourceRef.end);
      const $ = load(markup);
      $('br').replaceWith('\uFDD0');
      const sourceText = $('body').text().replace(/\r\n?/g, '\n').split('\uFDD0')
        .map(line => line.replace(/^[\t\n ]+|[\t\n ]+$/g, '').replace(/[\t ]*\n[\t ]*/g, ' ')).join('\n');
      assert.ok(sourceText.includes(exact), `${question.id}: literal support exists in original Gutenberg paragraph`);
    }
  }
});


test('the five complementary additions keep independently reviewed facts and distinct answer choices', () => {
  const expected = [
    ['mnd-06', "Why does Helena plan to reveal Hermia's flight to Demetrius?", "To see Demetrius on the journey.", "To keep Demetrius in Athens."],
    ['mnd-07', 'What does Oberon want the Indian boy to become?', "A knight in Oberon's train."],
    ['mnd-08', 'Why are Quince and the craftsmen preparing a play?', "To perform at the Duke's wedding."],
    ['mnd-09', 'How does Oberon tell Puck to keep Lysander and Demetrius from fighting?', 'Imitate their voices and lead them apart.'],
    ['mnd-10', 'What does Puck ask the audience to imagine in his final speech?', 'The performance has been a dream.'],
  ];
  const content = quiz();
  for (const [id, prompt, answer, correctedDistractor] of expected) {
    const question = content.questions.find(value => value.id === id);
    assert.ok(question, id + ' must be authored');
    assert.equal(question.question, prompt);
    assert.equal(question.options.find(option => option.id === question.correctOptionId).text, answer);
    assert.equal(question.options.filter(option => option.id === question.correctOptionId).length, 1);
    if (correctedDistractor) assert.equal(question.options.find(option => option.id === 'mnd-06.c').text, correctedDistractor);
  }
});

test('validated content keeps all feedback as frozen clones and cannot be changed through its input', () => {
  const content = quiz(), snapshot = validate(content);
  assert.ok(snapshot);
  assert.deepEqual(snapshot, content);
  function frozen(value) {
    if (!value || typeof value !== 'object') return;
    assert.ok(Object.isFrozen(value));
    Object.values(value).forEach(frozen);
  }
  frozen(snapshot);
  assert.equal(Object.isFrozen(content), false);
  assert.equal(Object.isFrozen(content.questions[0]), false);
  const answer = snapshot.questions[0].options[0].text;
  content.questions[0].options[0].text = 'Changed after validation';
  content.questions[0].evidence[0].startRef.offsetUtf16 = 0;
  assert.equal(snapshot.questions[0].options[0].text, answer);
  assert.equal(snapshot.questions[0].evidence[0].startRef.offsetUtf16, 85);
});

const malformed = [
  ['missing envelope', () => null],
  ['legacy empty envelope', () => ({ schemaVersion: '1.0.0', questions: [] })],
  ['missing canonical document', value => value, null],
  ['unsupported schema', value => { value.schemaVersion = '3.0.0'; }],
  ['missing quiz ID', value => { delete value.id; }],
  ['missing quiz revision', value => { delete value.quizContentVersion; }],
  ['malformed quiz revision', value => { value.quizContentVersion = {}; }],
  ['blank quiz revision', value => { value.quizContentVersion = ' '; }],
  ['stale work revision', value => { value.contentVersion = 'stale'; }],
  ['stale canonical version', value => { value.canonicalTextVersion = '2'; }],
  ['different work', value => { value.workId = 'another-work'; }],
  ['empty questions', value => { value.questions = []; }],
  ['sparse questions', value => { delete value.questions[0]; }],
  ['null question', value => { value.questions[0] = null; }],
  ['blank prompt', value => { value.questions[0].question = ' '; }],
  ['duplicate question ID', value => { value.questions[1].id = value.questions[0].id; }],
  ['missing question ID', value => { delete value.questions[0].id; }],
  ['blank explanation', value => { value.questions[0].explanation = ' '; }],
  ['too few options', value => { value.questions[0].options.pop(); }],
  ['sparse options', value => { delete value.questions[0].options[0]; }],
  ['legacy string option', value => { value.questions[0].options[0] = 'Answer'; }],
  ['blank option', value => { value.questions[0].options[0].text = ' '; }],
  ['duplicate option text', value => { value.questions[0].options[1].text = ` ${value.questions[0].options[0].text} `; }],
  ['duplicate option ID', value => { value.questions[0].options[1].id = value.questions[0].options[0].id; }],
  ['option from another question', value => { value.questions[0].options[0].id = 'mnd-02.a'; }],
  ['absent correct answer', value => { value.questions[0].correctOptionId = 'mnd-01.z'; }],
  ['missing evidence', value => { delete value.questions[0].evidence; }],
  ['empty evidence', value => { value.questions[0].evidence = []; }],
  ['sparse evidence', value => { delete value.questions[0].evidence[0]; }],
  ['null evidence', value => { value.questions[0].evidence[0] = null; }],
  ['noncanonical evidence kind', value => { value.questions[0].evidence[0].kind = 'section'; }],
  ['wrong offset unit', value => { value.questions[0].evidence[0].offsetUnit = 'bytes'; }],
  ['stale evidence revision', value => { value.questions[0].evidence[0].contentVersion = 'stale'; }],
  ['wrong evidence work', value => { value.questions[0].evidence[0].workId = 'another-work'; }],
  ['wrong evidence exact text', value => { value.questions[0].evidence[0].exact += '!'; }],
  ['wrong evidence context', value => { value.questions[0].evidence[0].prefix = ''; }],
  ['wrong evidence endpoint', value => { value.questions[0].evidence[0].startRef.offsetUtf16 += 1; }],
  ['wrong evidence range type', value => { value.questions[0].evidence[0].start = '2386'; }],
];
for (const [name, mutate, document] of malformed) test(`${name} cannot become usable quiz content`, () => {
  const content = copy(quiz());
  const replacement = mutate(content);
  assert.equal(validate(replacement === undefined ? content : replacement, document === undefined ? canonical : document), null);
});
