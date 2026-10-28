const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const quizPath = 'data/plays/a-midsummer-nights-dream/quiz.json';

test('only the explicitly approved Midsummer quiz replaces historical raw content', () => {
  const original = read('tests/fixtures/content-preservation.json');
  assert.equal(sha(original), '3f59ec945cd177441e9249ba6f7c181dbdb46d9d61a799038e354e38d8125cd8', 'the historical fixture must never be rebased');
  const baseline = JSON.parse(original);
  assert.equal(baseline.head, '19e20a38bd5c8394ff213ce4e4aecbbcdd425c6a');
  assert.equal(baseline.files.length, 1286);
  assert.equal(new Set(baseline.files.map(file => file.path)).size, 1286);
  assert.deepEqual(baseline.files.find(file => file.path === quizPath), {
    path: quizPath, bytes: 49, sha256: '3ee8d50b8a1570818558bc8e759f0fb27b281c7315d4352a1a990f6995d838a3',
  });
  const strict = baseline.files.filter(file => file.path !== quizPath);
  assert.equal(strict.length, 1285);
  assert.equal(strict.filter(file => /\/quiz\.json$/.test(file.path)).length, 37);
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
});
