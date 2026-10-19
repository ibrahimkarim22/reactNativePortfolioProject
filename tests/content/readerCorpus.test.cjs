const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const test = require('node:test');
const cheerio = require('cheerio');
const { parseSource } = require('../../scripts/parseGutenberg');
const { buildCanonicalDocument } = require('../../shared/contentText');

const repository = path.resolve(__dirname, '../..');

function actualService(entries) {
  const file = path.join(repository, 'shared/localPlayService.js');
  const source = fs.readFileSync(file, 'utf8')
    .replace(/import LOCAL_PLAY_DATA from [^;]+;/, 'const LOCAL_PLAY_DATA = injectedEntries;')
    .replace(/export const (\w+)/g, 'const $1');
  return vm.runInThisContext('(function(require,injectedEntries){' + source + '\nreturn {getCharactersHtml,getFullPlayHtml};})')(createRequire(file), entries);
}

// This traversal decodes actual generated HTML, not renderer helpers or source extraction.
// Native paragraph/heading boundaries contribute two line feeds; explicit BR and cell
// separators remain independent, including consecutive and trailing source breaks.
function projectRenderedHtml(html) {
  const $ = cheerio.load('<main>' + html + '</main>');
  const blockTags = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'blockquote']);
  function visit(node) {
    if (node.type === 'text') return node.data;
    if (node.name === 'br') return '\n';
    return (node.children || []).map(visit).join('') + (blockTags.has(node.name) ? '\n\n' : '');
  }
  const nodes = $('main').contents().toArray();
  const text = nodes.map(visit).join('');
  return blockTags.has(nodes.at(-1)?.name) ? text.slice(0, -2) : text;
}

function inlineRanges(element) {
  let position = 0;
  const ranges = [];
  function visit(node) {
    if (node.type === 'text') { position += node.data.length; return; }
    if (node.name === 'br') { position += 1; return; }
    const start = position;
    for (const child of node.children || []) visit(child);
    ranges.push({ tag: node.name, start, end: position, ...(node.attribs?.class ? { className: node.attribs.class } : {}) });
  }
  for (const child of element.children || []) visit(child);
  return ranges;
}

test('both readers combined render every canonical occurrence of all 38 source plays in exact order', () => {
  const raw = fs.readFileSync(path.join(repository, 'data/source/pg100-images.html'), 'utf8');
  const parsed = parseSource(raw);
  assert.equal(parsed.plays.length, 38);
  const entries = parsed.plays.map(({ play, sections }) => ({
    slug: play.id,
    name: play.title,
    play,
    sections,
    scenes: sections.filter(item => item.section.kind === 'scene'),
    // Existing support casts must never duplicate the source cast owned by full-play HTML.
    characters: JSON.parse(fs.readFileSync(path.join(repository, 'data/plays', play.id, 'characters.json'), 'utf8')),
  }));
  const reader = actualService(entries);
  let nbspCount = 0;
  let nestedBlockCount = 0;
  for (const { play, sections } of parsed.plays) {
    const prefix = reader.getCharactersHtml(play.id);
    assert.equal(prefix, '', play.id + ': cast remains in source order in the full play');
    const html = prefix + reader.getFullPlayHtml(play.id);
    const rendered = projectRenderedHtml(html);
    const canonical = buildCanonicalDocument({ play, sections });
    if (rendered !== canonical.text) {
      let index = 0;
      while (index < rendered.length && index < canonical.text.length && rendered[index] === canonical.text[index]) index += 1;
      assert.fail(play.id + ': rendered text diverges at UTF-16 offset ' + index + '\nrendered=' + JSON.stringify(rendered.slice(Math.max(0, index - 50), index + 100)) + '\ncanonical=' + JSON.stringify(canonical.text.slice(Math.max(0, index - 50), index + 100)));
    }
    assert.ok(canonical.text.includes('’'), play.id + ': source curly punctuation survives');
    assert.ok(sections.some(section => section.section.kind === 'cast'), play.id + ': canonical source cast was rendered');
    nbspCount += (canonical.text.match(/\u00a0/g) || []).length;
    const $ = cheerio.load('<main>' + html + '</main>');
    const renderedBlocks = $('main').children().not('br').toArray();
    const blocks = sections.flatMap(section => section.content);
    assert.equal(renderedBlocks.length, blocks.length, play.id + ': exactly one HTML block per source block');
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      const expectedSpans = block.spans.filter(span => span.start < span.end);
      assert.deepEqual(inlineRanges(renderedBlocks[index]), expectedSpans, block.id + ': source inline tags, nested ranges, and classes survive');
      if (expectedSpans.some((outer, i) => expectedSpans.some((inner, j) => i !== j && outer.start <= inner.start && outer.end >= inner.end))) nestedBlockCount += 1;
    }
  }
  assert.ok(nbspCount > 0, 'the real corpus tests preservation of source NBSP');
  assert.ok(nestedBlockCount > 0, 'the real corpus tests nested inline formatting');
});
