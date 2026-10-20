const assert = require('node:assert/strict');
const test = require('node:test');
const cheerio = require('cheerio');

function fixture() {
  const blocks = [
    { id: 'title', tag: 'h2', classes: [], text: 'A TITLE', separatorAfter: '\n\n', spans: [] },
    { id: 'speech', tag: 'p', classes: ['drama'], text: 'CUE.\nA\u00a0😀 & <word>\n\n', separatorAfter: '\n\n', speakerLabel: 'CUE.', attribution: { status: 'explicit', cueStart: 0, cueEnd: 4 }, spans: [{ tag: 'i', start: 5, end: 10 }, { tag: 'span', className: 'charname', start: 7, end: 14 }] },
    { id: 'cell', tag: 'td', classes: ['right'], text: 'end\n', separatorAfter: '\n\n', spans: [] },
  ];
  return { play: { id: 'fixture', title: 'Metadata must not be added', contentVersion: 'v1', canonicalTextVersion: '1', sections: [{ id: 's1' }] }, sections: [{ work: { id: 'fixture' }, contentVersion: 'v1', canonicalTextVersion: '1', section: { id: 's1', kind: 'frontmatter' }, content: blocks }] };
}

test('reader maps canonical block boundaries while preserving exact text, overlapping spans and explicit cue', () => {
  const { createReaderDocument } = require('../../reader/readerDocument');
  const entry = fixture();
  const before = JSON.stringify(entry);
  const result = createReaderDocument(entry, { documentId: 'doc-1' });
  assert.deepEqual(result.identity, { documentId: 'doc-1', workId: 'fixture', contentVersion: 'v1', canonicalTextVersion: '1' });
  assert.equal(JSON.stringify(entry), before);
  const $ = cheerio.load(result.html);
  const blocks = $('[data-reader-block]').toArray();
  assert.equal(blocks.length, 3);
  assert.equal(blocks.map(node => $(node).text() + $(node).attr('data-separator')).join(''), 'A TITLE\n\nCUE.\nA\u00a0😀 & <word>\n\n\n\nend\n');
  assert.deepEqual(blocks.map(node => ['data-text-id', 'data-section-id', 'data-start', 'data-text-end', 'data-end'].map(name => $(node).attr(name))), [['title', 's1', '0', '7', '9'], ['speech', 's1', '9', '29', '31'], ['cell', 's1', '31', '35', '35']]);
  assert.equal($(blocks[1]).find('[data-reader-cue]').text(), 'CUE.');
  assert.equal($(blocks[1]).find('[data-span-index="0"]').map((_, node) => $(node).text()).get().join(''), 'A\u00a0😀 ');
  assert.equal($(blocks[1]).find('[data-span-index="1"]').map((_, node) => $(node).text()).get().join(''), '😀 & <w');
  assert.equal($(blocks[2]).attr('data-source-tag'), 'td');
  assert.equal($(blocks[2]).attr('data-separator'), '');
  assert.equal($('body').text().includes('Metadata must not be added'), false);
});

test('reader escapes hostile text, IDs and source mappings and emits no source executable content', () => {
  const { createReaderDocument } = require('../../reader/readerDocument');
  const entry = fixture();
  const block = entry.sections[0].content[1];
  block.id = 'x" onclick="alert(1)';
  block.tag = 'script';
  block.classes = ['scenedesc', 'onclick="bad', 'reader-title'];
  block.text = '</script><img src="https://evil.test" onerror="alert(1)">\u2028\n';
  block.spans = [{ tag: 'script', className: 'x" onclick="bad', start: 0, end: 9 }];
  const { html } = createReaderDocument(entry, { documentId: '</script><script>bad</script>' });
  const $ = cheerio.load(html);
  const node = $('[data-reader-block]').eq(1);
  assert.equal(node.text(), block.text);
  assert.equal(node.attr('data-text-id'), block.id);
  assert.equal(node.attr('onclick'), undefined);
  assert.equal($('img,iframe,link,a,[src],[href],[onerror],[onclick]').length, 0);
  assert.equal($('script').length, 1, 'only the app-owned runtime executes');
  assert.equal($('script[src]').length, 0);
  const policy = $('meta[http-equiv="Content-Security-Policy"]').attr('content');
  assert.match(policy, /default-src 'none'/);
  assert.match(policy, /connect-src 'none'/);
  assert.match(policy, /font-src data:/);
  assert.equal(node.hasClass('reader-title'), false, 'source classes cannot impersonate app classes');
});

test('reader orders sections from the play contract and omits only the final added separator', () => {
  const { createReaderDocument } = require('../../reader/readerDocument');
  const entry = fixture();
  entry.sections[0].content = [{ id: 'a', tag: 'p', text: '\nA\n', separatorAfter: '\t', spans: [] }];
  entry.play.sections.push({ id: 's2' });
  entry.sections.unshift({ work: { id: 'fixture' }, contentVersion: 'v1', canonicalTextVersion: '1', section: { id: 's2', kind: 'scene' }, content: [{ id: 'b', tag: 'p', text: 'B\n\n', separatorAfter: '\n\n', spans: [] }] });
  const result = createReaderDocument(entry, { documentId: 'd' });
  const $ = cheerio.load(result.html);
  assert.equal($('[data-reader-block]').map((_, node) => $(node).text() + $(node).attr('data-separator')).get().join(''), '\nA\n\tB\n\n');
  assert.equal($('[data-boundary="tab"]').length, 1);
  assert.equal(result.canonical.text, '\nA\n\tB\n\n');
});

test('the local document viewport leaves browser zoom available', () => {
  const { createReaderDocument } = require('../../reader/readerDocument');
  const $ = cheerio.load(createReaderDocument(fixture(), { documentId: 'zoom' }).html);
  const viewport = $('meta[name="viewport"]').attr('content');
  assert.match(viewport, /width=device-width/);
  assert.match(viewport, /initial-scale=1/);
  assert.doesNotMatch(viewport, /maximum-scale|user-scalable\s*=\s*no/);
});

module.exports = { fixture };
