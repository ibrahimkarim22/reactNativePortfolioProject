const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const identity = { documentId: 'doc-1', workId: 'hamlet', contentVersion: 'v1', canonicalTextVersion: '1' };
const preferences = { schemaVersion: 1, fontId: 'literata', fontSize: 20, lineSpacing: 'comfortable', theme: 'paper' };

test('protocol accepts only bounded allowlisted messages for the exact versioned document', () => {
  const { parseReaderMessage } = require('../../reader/readerProtocol');
  for (const type of ['ready', 'applied', 'error']) {
    const message = { ...identity, type, ...(type === 'applied' ? { requestId: 2 } : {}), ...(type === 'error' ? { code: 'FONT_LOAD_FAILED', message: 'Could not load local font.' } : {}) };
    assert.deepEqual(parseReaderMessage(JSON.stringify(message), identity), message);
  }
  for (const message of [null, {}, { ...identity, type: 'navigate' }, { ...identity, type: 'applied', requestId: -1 }, { ...identity, type: 'applied', requestId: 1.5 }, { ...identity, type: 'ready', documentId: 'old' }, { ...identity, type: 'ready', contentVersion: 'old' }, { ...identity, type: 'ready', unexpected: true }, { ...identity, type: 'error', code: 'X', message: 'x'.repeat(600) }]) assert.equal(parseReaderMessage(JSON.stringify(message), identity), null);
  assert.equal(parseReaderMessage('{broken', identity), null);
  assert.equal(parseReaderMessage(' '.repeat(8193), identity), null);
});

test('protocol allows only the initial local blank document and its hash navigation', () => {
  const { isAllowedReaderNavigation } = require('../../reader/readerProtocol');
  for (const url of ['about:blank', 'about:blank#point']) assert.equal(isAllowedReaderNavigation(url), true);
  for (const url of ['https://example.com', 'file:///local', 'javascript:alert(1)', 'data:text/html,hello', 'about:blank?url=x', 'about:blank.evil', 'ABOUT:blank', '', null]) assert.equal(isAllowedReaderNavigation(url), false);
});

test('appearance script transports validated data without interpreting strings as source', () => {
  const { buildAppearanceScript } = require('../../reader/readerProtocol');
  const hostile = { ...identity, documentId: '</script>\u2028\u2029";global.pwned=true;//' };
  let received;
  const script = buildAppearanceScript(hostile, 4, { preferences, fontScale: 1.2, fontFaces: [{ weight: 400, style: 'normal', data: 'AAEAAA==' }] });
  assert.equal(script.includes('</script>'), false);
  vm.runInNewContext(script, { window: { BardReader: { applyAppearance(payload) { received = payload; } } } });
  assert.equal(received.documentId, hostile.documentId);
  assert.equal(received.requestId, 4);
  assert.equal(received.fontScale, 1.2);
  assert.equal(received.preferences.fontId, 'literata');
});

test('appearance script rejects external fonts, invalid preferences and unbounded data', () => {
  const { buildAppearanceScript } = require('../../reader/readerProtocol');
  const build = changes => buildAppearanceScript(identity, 1, { preferences, fontScale: 1, ...changes });
  for (const changes of [{ preferences: { ...preferences, fontId: 'remote' } }, { preferences: { ...preferences, fontSize: 21 } }, { fontScale: NaN }, { fontFaces: [{ weight: 400, style: 'normal', data: 'https://evil.test/font.ttf' }] }, { fontFaces: [{ weight: 500, style: 'normal', data: 'AA==' }] }, { fontFaces: [{ weight: 400, style: 'normal', data: 'A'.repeat(2 * 1024 * 1024 + 4) }] }]) assert.throws(() => build(changes));
  assert.throws(() => buildAppearanceScript(identity, 0, { preferences, fontScale: 1 }));
});
