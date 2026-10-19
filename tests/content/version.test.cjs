const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

let api = {};
try {
  api = require('../../scripts/contentVersion');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND' || !error.message.includes('scripts/contentVersion')) throw error;
}
const call = (name, ...args) => {
  assert.equal(typeof api[name], 'function', `contentVersion must export ${name}`);
  return api[name](...args);
};
function fixture() {
  const play = {
    schemaVersion: '2.0.0', canonicalTextVersion: '1', contentVersion: 'old',
    id: 'technical-work', source: { sha256: 'unchanged-source', ebookNumber: 100 },
    acts: [{ act: 1, scenes: [{ id: 'act-1-scene-1' }] }],
    sections: [{ id: 'act-1-scene-1', kind: 'scene', path: 'scenes/act-1-scene-1.json', orderInPlay: 0 }],
  };
  const sections = [{
    schemaVersion: '2.0.0', canonicalTextVersion: '1', contentVersion: 'old',
    work: { id: play.id }, source: play.source,
    section: { id: 'act-1-scene-1', act: 1, scene: 1, kind: 'scene', orderInPlay: 0, sourceRef: { start: 20, end: 60, path: 'chap02/h3@20' } },
    content: [{ id: 'chap02/p@30', text: 'A\ud83d\ude00\u00a0e\u0301', separatorAfter: '\n\n', spans: [{ start: 0, end: 1, tag: 'b' }],
      speakerLabel: null, attribution: { status: 'unlabelled' }, sourceRef: { start: 30, end: 50, path: 'chap02/p@30' } }],
  }];
  return { play, sections };
}
const version = ({ play, sections }) => call('computeContentVersion', play, sections);

test('stable serialization sorts object keys recursively and preserves ordered arrays and Unicode', () => {
  assert.equal(call('stableStringify', { z: [2, { y: '\u00a0e\u0301\ud83d\ude00', a: 1 }], a: null }), '{"a":null,"z":[2,{"a":1,"y":"\u00a0e\u0301\ud83d\ude00"}]}');
});

test('stable serialization rejects non-JSON data rather than silently making digest collisions', () => {
  for (const value of [{ a: undefined }, { a: NaN }, [Infinity], { a: 1n }, { a: () => 1 }]) {
    assert.throws(() => call('stableStringify', value), /JSON|finite|serializ/i);
  }
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => call('stableStringify', cyclic), /cycl/i);
});

test('content version is a SHA-256 generated-payload digest and is not the source checksum', () => {
  const input = fixture();
  const digest = version(input);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.notEqual(digest, input.play.source.sha256);
  assert.equal(digest, version(JSON.parse(JSON.stringify(input))));
});

test('identical regeneration and object key reordering preserve the version', () => {
  const input = fixture();
  const reordered = JSON.parse(JSON.stringify(input, (key, value) => value && !Array.isArray(value) && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).reverse()) : value));
  assert.equal(version(input), version(reordered));
});

test('self-referential contentVersion fields do not change the generated digest', () => {
  const first = fixture();
  const second = fixture();
  second.play.contentVersion = 'new';
  second.sections[0].contentVersion = 'new';
  assert.equal(version(first), version(second));
});

test('unchanged source still changes version when generated canonical text or separators change', () => {
  const base = version(fixture());
  for (const [field, value] of [['text', 'corrected'], ['separatorAfter', '\n']]) {
    const input = fixture();
    input.sections[0].content[0][field] = value;
    assert.notEqual(version(input), base, field);
  }
});

test('unchanged source still changes version when attribution, formatting, IDs or reference meaning change', () => {
  const base = version(fixture());
  const mutations = [
    input => { input.sections[0].content[0].attribution = { status: 'explicit', speaker: 'cue-id' }; },
    input => { input.sections[0].content[0].speakerLabel = 'SOURCE CUE'; },
    input => { input.sections[0].content[0].spans[0].end = 3; },
    input => { input.sections[0].content[0].id = 'chap02/p@31'; },
    input => { input.sections[0].content[0].sourceRef.start = 31; },
    input => { input.sections[0].section.kind = 'prologue'; },
    input => { input.play.sections[0].path = 'sections/prologue.json'; },
    input => { input.play.id = 'different-work'; },
    input => { input.play.canonicalTextVersion = '2'; },
    input => { input.play.schemaVersion = '3.0.0'; },
    input => { input.play.source.ebookNumber = 101; },
  ];
  for (const mutate of mutations) {
    const input = fixture();
    mutate(input);
    assert.notEqual(version(input), base);
  }
});

test('generated block and section ordering are covered by content versions', () => {
  const input = fixture();
  input.sections[0].content.push({ id: 'chap02/p@51', text: 'B', separatorAfter: '' });
  const original = version(input);
  input.sections[0].content.reverse();
  assert.notEqual(version(input), original);
  input.sections.push({ ...input.sections[0], section: { id: 'other', orderInPlay: 1 }, content: [] });
  const sectionsOriginal = version(input);
  input.sections.reverse();
  assert.notEqual(version(input), sectionsOriginal);
});

test('content version computation does not mutate its inputs', () => {
  const input = fixture();
  const before = JSON.stringify(input);
  version(input);
  assert.equal(JSON.stringify(input), before);
});

test('collection versions hash ordered work and content-version pairs', () => {
  const works = [{ workId: 'a', contentVersion: 'one' }, { workId: 'b', contentVersion: 'two' }];
  const expected = crypto.createHash('sha256').update('[["a","one"],["b","two"]]', 'utf8').digest('hex');
  assert.equal(call('computeCollectionVersion', works), expected);
  assert.notEqual(call('computeCollectionVersion', [...works].reverse()), expected);
  assert.notEqual(call('computeCollectionVersion', [{ workId: 'a', contentVersion: 'new' }, works[1]]), expected);
});
