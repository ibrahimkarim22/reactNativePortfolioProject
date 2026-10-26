const assert = require('node:assert/strict');
const test = require('node:test');
const { createReaderDocument } = require('../../reader/readerDocument');
const { parseRoot, textNodes } = require('./selectionDomFixture.cjs');

const entry = { play: { id: 'paint-document', title: 'Paint document', contentVersion: 'revision-1', canonicalTextVersion: '1', sections: [{ id: 'scene' }] },
  sections: [{ work: { id: 'paint-document' }, contentVersion: 'revision-1', canonicalTextVersion: '1', section: { id: 'scene', kind: 'scene' },
    content: [{ id: 'line', type: 'speech', tag: 'p', text: 'CUE.\nCafé\u00a0and grief.', separatorAfter: '\n\n', spans: [{ tag: 'i', start: 5, end: 9 }] }] }] };

test('new document owns four fixed highlight styles without changing literal source nodes or canonical mappings', () => {
  const generated = createReaderDocument(entry, { documentId: 'paint-document-1' });
  for (const id of ['yellow', 'sage', 'blue', 'rose']) assert.ok(generated.html.includes('::highlight(bard-highlight-' + id + ')'), id + ' fixed paint selector exists');
  const root = parseRoot(generated.html);
  assert.equal(textNodes(root).map(n => n.data).join(''), entry.sections[0].content[0].text);
  assert.equal(generated.canonical.text, entry.sections[0].content[0].text);
  assert.equal(root.childNodes.length, 1);
  assert.equal(root.childNodes[0].getAttribute('data-text-id'), 'line');
  assert.ok(generated.html.includes("connect-src &#39;none&#39;"));
});
