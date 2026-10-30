const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const quizPath = 'data/plays/a-midsummer-nights-dream/quiz.json';
const editorialQuizPaths = new Set([
  'alls-well-that-ends-well', 'antony-and-cleopatra', 'as-you-like-it', 'errors',
  'the-winters-tale', 'coriolanus', 'cymbeline', 'hamlet-prince-of-denmark',
  'the-first-part-of-king-henry-the-fourth', 'the-second-part-of-king-henry-the-fourth',
  'king-henry-the-fifth', 'the-first-part-of-henry-the-sixth',
  'the-second-part-of-king-henry-the-sixth', 'the-third-part-of-king-henry-the-sixth',
  'king-henry-the-eighth', 'julius-caesar', 'king-john', 'king-lear',
  'loves-labours-lost', 'macbeth', 'measure-for-measure', 'the-merchant-of-venice',
  'the-merry-wives-of-windsor', 'much-ado-about-nothing', 'othello-the-moor-of-venice',
  'pericles-prince-of-tyre', 'king-richard-the-second', 'king-richard-the-third',
  'romeo-and-juliet', 'the-taming-of-the-shrew', 'the-tempest', 'timon-of-athens',
  'titus-andronicus', 'troilus-and-cressida', 'twelfth-night-or-what-you-will',
  'the-two-gentlemen-of-verona', 'the-two-noble-kinsmen',
].map(slug => `data/plays/${slug}/quiz.json`));

test('only the explicitly authorized quiz paths replace historical raw content; Midsummer stays unchanged', () => {
  const original = read('tests/fixtures/content-preservation.json');
  assert.equal(sha(original), '3f59ec945cd177441e9249ba6f7c181dbdb46d9d61a799038e354e38d8125cd8', 'the historical fixture must never be rebased');
  const baseline = JSON.parse(original);
  assert.equal(baseline.head, '19e20a38bd5c8394ff213ce4e4aecbbcdd425c6a');
  assert.equal(baseline.files.length, 1286);
  assert.equal(new Set(baseline.files.map(file => file.path)).size, 1286);
  assert.deepEqual(baseline.files.find(file => file.path === quizPath), {
    path: quizPath, bytes: 49, sha256: '3ee8d50b8a1570818558bc8e759f0fb27b281c7315d4352a1a990f6995d838a3',
  });
  assert.equal(editorialQuizPaths.size, 37);
  assert.equal(editorialQuizPaths.has(quizPath), false);
  for (const file of editorialQuizPaths) assert.deepEqual(baseline.files.find(entry => entry.path === file), {
    path: file, bytes: 49, sha256: '3ee8d50b8a1570818558bc8e759f0fb27b281c7315d4352a1a990f6995d838a3',
  }, `the original empty-quiz baseline remains immutable: ${file}`);
  const strict = baseline.files.filter(file => file.path !== quizPath && !editorialQuizPaths.has(file.path));
  assert.equal(strict.length, 1248);
  assert.equal(strict.filter(file => /\/quiz\.json$/.test(file.path)).length, 0);
  for (const file of strict) {
    const bytes = read(file.path);
    assert.equal(bytes.length, file.bytes, `preserved byte count: ${file.path}`);
    assert.equal(sha(bytes), file.sha256, `preserved raw hash: ${file.path}`);
  }
  const replacement = read(quizPath);
  assert.notEqual(sha(replacement), '3ee8d50b8a1570818558bc8e759f0fb27b281c7315d4352a1a990f6995d838a3');
  assert.equal(sha(replacement), '82b6270ffa44ba0afd318f73c7a3b50a085b61a47164147e9eda57573de6b4cf');
  assert.equal(replacement.length, 23596);
  assert.equal(JSON.parse(replacement).quizContentVersion, '1.1.0');
  const { loadPlayQuiz, validatePlayQuiz } = require('../../scripts/validateQuizCollection.cjs');
  const manifest = JSON.parse(read('data/manifest.json'));
  const source = read('data/source/pg100-images.html').toString('utf8');
  for (const file of editorialQuizPaths) {
    const entry = manifest.plays.find(play => `data/${play.quiz.replace(/^\.\//, '')}` === file);
    assert.ok(entry, `the authorized exact path belongs to the catalogue: ${file}`);
    const result = validatePlayQuiz(loadPlayQuiz(root, entry), source);
    assert.equal(result.questions, 10, file);
    assert.deepEqual(result.errors, [], file);
  }
});
