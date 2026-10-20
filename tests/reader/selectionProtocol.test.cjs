const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');

const identity = { documentId: 'selection-doc', workId: 'hamlet', contentVersion: 'v1', canonicalTextVersion: '1' };
const canonical = {
  workId: 'hamlet', contentVersion: 'v1', canonicalTextVersion: '1', text: 'Alpha\nBeta 😀 gamma\nOmega',
  units: [
    { id: 'a', sectionId: 's1', start: 0, textEnd: 5, end: 6 },
    { id: 'b', sectionId: 's1', start: 6, textEnd: 19, end: 20 },
    { id: 'c', sectionId: 's2', start: 20, textEnd: 25, end: 25 },
  ], sections: [{ id: 's1', start: 0, end: 20 }, { id: 's2', start: 20, end: 25 }],
};
const selection = {
  kind: 'text-range', workId: 'hamlet', contentVersion: 'v1', canonicalTextVersion: '1', offsetUnit: 'utf16',
  start: 6, end: 13, startRef: { textId: 'b', sectionId: 's1', offsetUtf16: 0 },
  endRef: { textId: 'b', sectionId: 's1', offsetUtf16: 7 }, exact: 'Beta 😀', prefix: 'Alpha\n', suffix: ' gamma\nOmega',
};
const capture = () => ({ ...identity, type: 'selectionCapture', selectionRequestId: 1, captureToken: 'token-1', selectionSeq: 1, status: 'captured', selection: structuredClone(selection) });
const parse = (message, document = canonical, expectedIdentity = identity) => require('../../reader/readerSelectionProtocol').parseSelectionMessage(typeof message === 'string' ? message : JSON.stringify(message), expectedIdentity, document);

test('selection messages retain exact canonical captures and deeply freeze every nested reference', () => {
  const message = parse(capture());
  assert.deepEqual(message, capture());
  for (const value of [message, message.selection, message.selection.startRef, message.selection.endRef]) assert.equal(Object.isFrozen(value), true);
});

test('provisional messages expose bounded states and allowlisted reasons without quotation', () => {
  for (const state of ['none', 'range', 'invalid']) {
    const message = { ...identity, type: 'selectionChange', selectionRequestId: 0, selectionSeq: 4, state, code: 'CLEARED' };
    assert.deepEqual(parse(message), message);
  }
  for (const changes of [{ state: 'captured' }, { code: 'UNTRUSTED_TEXT' }, { exact: 'quotation' }, { selection }, { selectionSeq: 0 }, { selectionSeq: 1.5 }, { selectionSeq: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.equal(parse({ ...identity, type: 'selectionChange', selectionRequestId: 0, selectionSeq: 1, state: 'range', ...changes }), null);
  }
});

test('provisional changes require a nonnegative safe request identifier including zero before commands', () => {
  const message = { ...identity, type: 'selectionChange', selectionRequestId: 0, selectionSeq: 1, state: 'range' };
  assert.deepEqual(parse(message), message);
  assert.deepEqual(parse({ ...message, selectionRequestId: 12 }), { ...message, selectionRequestId: 12 });
  for (const selectionRequestId of [undefined, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, '0', null]) assert.equal(parse({ ...message, selectionRequestId }), null);
  assert.equal(parse({ ...message, selectionSeq: 0, state: 'none', code: 'CLEARED', origin: 'native' }), null);
});

test('capture rejection accepts only an allowlisted code and no captured data', () => {
  const rejected = { ...identity, type: 'selectionCapture', selectionRequestId: 2, captureToken: 'token', selectionSeq: 2, status: 'rejected', code: 'OUTSIDE_ROOT' };
  assert.deepEqual(parse(rejected), rejected);
  for (const changes of [{ code: 'arbitrary' }, { selection }, { exact: 'hello' }, { status: 'pending' }, { captureToken: '' }, { captureToken: 'x'.repeat(129) }, { captureToken: '😀' }]) assert.equal(parse({ ...rejected, ...changes }), null);
  assert.equal(parse({ ...capture(), code: 'CLEARED' }), null);
});

test('selection wire schema rejects missing fields and unexpected keys at every nesting level', () => {
  for (const field of Object.keys(capture())) {
    const message = capture(); delete message[field]; assert.equal(parse(message), null, field);
  }
  const extra = capture(); extra.extra = true; assert.equal(parse(extra), null);
  for (const field of Object.keys(selection)) {
    const message = capture(); delete message.selection[field]; assert.equal(parse(message), null, field);
  }
  for (const field of ['selection', 'startRef', 'endRef']) {
    const message = capture(); const target = field === 'selection' ? message.selection : message.selection[field]; target.extra = true; assert.equal(parse(message), null);
  }
  for (const invalid of [null, [], {}, true, 1, '{broken']) assert.equal(parse(invalid), null);
});

test('selection identity must match the mounted document and its canonical revision', () => {
  for (const key of Object.keys(identity)) assert.equal(parse({ ...capture(), [key]: 'other' }), null, key);
  for (const key of ['workId', 'contentVersion', 'canonicalTextVersion']) assert.equal(parse(capture(), { ...canonical, [key]: 'other' }), null, key);
  assert.equal(parse(capture(), canonical, { ...identity, documentId: '' }), null);
  assert.equal(parse(capture(), canonical, { ...identity, canonicalTextVersion: '2' }), null);
  assert.equal(parse(capture(), null), null);
});

test('capture validates exact text, context, offsets, surrogate boundaries and endpoint ownership', () => {
  for (const changes of [
    { exact: 'different' }, { prefix: '' }, { suffix: '' }, { start: -1 }, { start: 12 }, { end: 12 },
    { start: 6.5 }, { end: 26 }, { end: 6 }, { offsetUnit: 'codepoint' }, { kind: 'section' },
    { workId: 'other' }, { contentVersion: 'other' }, { canonicalTextVersion: '2' },
    { startRef: { textId: 'a', sectionId: 's1', offsetUtf16: 6 } },
    { endRef: { textId: 'b', sectionId: 's2', offsetUtf16: 7 } },
    { endRef: { textId: 'b', sectionId: 's1', offsetUtf16: -1 } },
  ]) { const message = capture(); Object.assign(message.selection, changes); assert.equal(parse(message), null, JSON.stringify(changes)); }
});

test('only valid selection captures may exceed the small wire envelope and worst-case escaped text fits', () => {
  const text = '\u0000'.repeat(16384);
  const document = { ...canonical, text, units: [{ id: 'a', sectionId: 's1', start: 0, textEnd: text.length, end: text.length }] };
  const message = { ...capture(), selection: { ...selection, start: 0, end: text.length, startRef: { textId: 'a', sectionId: 's1', offsetUtf16: 0 }, endRef: { textId: 'a', sectionId: 's1', offsetUtf16: text.length }, exact: text, prefix: '', suffix: '' } };
  assert.ok(JSON.stringify(message).length > 8192);
  assert.ok(JSON.stringify(message).length < 131072);
  assert.ok(parse(message, document));
  assert.equal(parse(JSON.stringify(message) + ' '.repeat(131072), document), null);
  assert.equal(parse(' '.repeat(8192) + JSON.stringify({ ...identity, type: 'selectionChange', selectionRequestId: 0, selectionSeq: 1, state: 'none' })), null);
  assert.equal(parse(' '.repeat(8192) + JSON.stringify({ ...identity, type: 'selectionCapture', selectionRequestId: 1, captureToken: 'x', selectionSeq: 1, status: 'rejected', code: 'NO_SELECTION' })), null);
  const tooLong = { ...document, text: text + 'x', units: [{ id: 'a', sectionId: 's1', start: 0, textEnd: 16385, end: 16385 }] };
  const over = structuredClone(message); over.selection.end = 16385; over.selection.endRef.offsetUtf16 = 16385; over.selection.exact += 'x';
  assert.equal(parse(over, tooLong), null);
});

test('capture request and clear scripts validate bounded commands and safely transport hostile identities', () => {
  const { selectionCommandPayload, buildSelectionScript } = require('../../reader/readerSelectionProtocol');
  const hostile = { ...identity, documentId: '</script>\u2028\u2029\";global.pwned=true;//' };
  for (const [kind, argument, method] of [['capture', 'token-1', 'captureSelection'], ['clear', 'modal', 'clearSelection']]) {
    let received;
    const script = buildSelectionScript(hostile, 7, kind, argument);
    assert.equal(script.includes('</script>'), false);
    vm.runInNewContext(script, { window: { BardReader: { [method](payload) { received = JSON.parse(JSON.stringify(payload)); } } } });
    assert.deepEqual(received, { ...hostile, selectionRequestId: 7, [kind === 'capture' ? 'captureToken' : 'reason']: argument });
  }
  for (const [id, kind, argument] of [[0, 'capture', 't'], [1.5, 'clear', 'modal'], [1, 'other', 't'], [1, 'capture', ''], [1, 'capture', 'x'.repeat(129)], [1, 'capture', 'é'], [1, 'clear', 'unknown']]) assert.throws(() => selectionCommandPayload(identity, id, kind, argument));
  const input = { ...identity, unwanted: 'drop' };
  assert.deepEqual(selectionCommandPayload(input, 1, 'capture', 't'), { ...identity, selectionRequestId: 1, captureToken: 't' });
});
