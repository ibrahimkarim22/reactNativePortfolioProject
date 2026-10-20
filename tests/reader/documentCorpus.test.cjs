const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const cheerio = require('cheerio');

const repository = path.resolve(__dirname, '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(repository, 'data/manifest.json'), 'utf8'));

function documentGenerator() {
  const file = path.join(repository, 'reader/readerDocument.js');
  const exported = fs.existsSync(file) ? require(file) : {};
  assert.equal(typeof exported.createReaderDocument, 'function', 'the real reader document generator must exist');
  return exported.createReaderDocument;
}

function loadEntry(reference) {
  const playFile = path.join(repository, 'data', reference.play);
  const play = JSON.parse(fs.readFileSync(playFile, 'utf8'));
  const sections = play.sections.map(ref => JSON.parse(fs.readFileSync(path.resolve(path.dirname(playFile), ref.path), 'utf8')));
  return { slug: play.id, name: reference.displayName, play, sections, scenes: sections.filter(section => section.section.kind === 'scene') };
}

// This oracle intentionally reads only the published JSON contract. No renderer,
// canonical builder, normalizer, cue recognizer or other production helper is used.
function sourceExpectation(entry) {
  const records = [];
  for (const ref of entry.play.sections) {
    const section = entry.sections.find(item => item.section.id === ref.id);
    assert.ok(section, `missing source section ${ref.id}`);
    for (const block of section.content) records.push({ block, sectionId: ref.id });
  }
  let text = '';
  const sections = [];
  for (const ref of entry.play.sections) {
    const start = text.length;
    for (const record of records.filter(item => item.sectionId === ref.id)) {
      record.start = text.length;
      text += record.block.text;
      record.textEnd = text.length;
      record.separator = record === records[records.length - 1] ? '' : record.block.separatorAfter;
      text += record.separator;
      record.end = text.length;
    }
    sections.push({ id: ref.id, start, end: text.length });
  }
  return { records, sections, text };
}

function sourceClasses(source) {
  return source.classes || (source.className ? source.className.split(/\s+/) : []);
}

function semanticTag(node) {
  return node.attribs['data-source-tag'] || node.name;
}

function semanticClasses(node) {
  if (Object.hasOwn(node.attribs, 'data-source-classes')) {
    const value = node.attribs['data-source-classes'];
    // The attribute is textual evidence; support either a space-separated list
    // or a JSON array without using renderer serialization code.
    if (value.startsWith('[')) return JSON.parse(value);
    return value ? value.split(/\s+/) : [];
  }
  return (node.attribs.class || '').split(/\s+/).filter(Boolean).filter(value => !value.startsWith('reader-'));
}

function walk(node, visit) {
  visit(node);
  for (const child of node.children || []) walk(child, visit);
}

function descendantText(node) {
  let value = '';
  walk(node, child => { if (child.type === 'text') value += child.data; });
  return value;
}

function documentTextStyles($) {
  const styles = new Map();
  const relevant = new Set(['white-space', 'display', 'visibility', 'opacity', 'font-size']);
  const merge = (node, declaration) => {
    if (!styles.has(node)) styles.set(node, {});
    for (const item of declaration.split(';')) {
      const colon = item.indexOf(':');
      if (colon === -1) continue;
      const property = item.slice(0, colon).trim().toLowerCase();
      if (relevant.has(property)) styles.get(node)[property] = item.slice(colon + 1).replace(/\s*!important\s*$/i, '').trim().toLowerCase();
    }
  };
  $('style').each((_, element) => {
    const css = descendantText(element).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1].trim();
      if (selector.startsWith('@') || !Array.from(relevant).some(property => rule[2].includes(property))) continue;
      $(selector).each((__, node) => merge(node, rule[2]));
    }
  });
  $('[style]').each((_, node) => merge(node, node.attribs.style));
  return styles;
}

function assertReadableStyle(node, styles, label) {
  let whiteSpace;
  for (let current = node; current; current = current.parent) {
    const style = styles.get(current) || {};
    assert.notEqual(style.display, 'none', `${label}: source text cannot be hidden by CSS`);
    assert.notEqual(style.visibility, 'hidden', `${label}: source text cannot be invisible by CSS`);
    assert.ok(style.opacity === undefined || Number(style.opacity) !== 0, `${label}: source text cannot be transparent by CSS`);
    assert.doesNotMatch(style['font-size'] || '', /^0(?:[a-z%]*|\.0*[a-z%]*)$/, `${label}: source text cannot have zero font size`);
    if (whiteSpace === undefined && style['white-space'] !== undefined && !['inherit', 'unset'].includes(style['white-space'])) whiteSpace = style['white-space'];
    if (whiteSpace === undefined && current.name === 'pre') whiteSpace = 'pre';
  }
  assert.ok(['pre', 'pre-wrap', 'break-spaces'].includes(whiteSpace), `${label}: visible whitespace preserves exact explicit LF and indentation (got ${whiteSpace})`);
}

function auditDocument(entry, result, expected = sourceExpectation(entry)) {
  assert.equal(typeof result.html, 'string');
  assert.equal(result.canonical.text, expected.text, `${entry.slug}: exact independent canonical text`);
  assert.deepEqual(result.canonical.units, expected.records.map(record => ({
    id: record.block.id, sectionId: record.sectionId,
    start: record.start, textEnd: record.textEnd, end: record.end,
  })), `${entry.slug}: source block UTF-16 ranges`);
  assert.deepEqual(result.canonical.sections, expected.sections, `${entry.slug}: source section UTF-16 ranges`);
  assert.equal(result.canonical.workId, entry.play.id);
  assert.equal(result.canonical.contentVersion, entry.play.contentVersion);
  assert.equal(result.canonical.canonicalTextVersion, entry.play.canonicalTextVersion);
  assert.equal(result.identity.workId, entry.play.id, 'document identity names its actual source work');
  assert.equal(result.identity.contentVersion, entry.play.contentVersion, 'document identity names its actual content revision');
  assert.equal(result.identity.canonicalTextVersion, entry.play.canonicalTextVersion, 'document identity names its actual canonical contract');

  const $ = cheerio.load(result.html);
  const body = $('body')[0];
  assert.ok(body, 'complete HTML has a body');
  const blocks = $('[data-reader-block]').toArray();
  const textStyles = documentTextStyles($);
  assert.equal(blocks.length, expected.records.length, `${entry.slug}: exactly one element for every source occurrence`);
  let recovered = '';
  let readable = '';
  const sourceBlockNodes = new Set(blocks);
  const seenIds = new Set();

  walk(body, node => {
    if (node.type !== 'text' || !node.data) return;
    let current = node.parent;
    let mapped = false;
    let ownedCode = false;
    while (current && current !== body) {
      if (current.name === 'script' || current.name === 'style') ownedCode = true;
      if (sourceBlockNodes.has(current)) mapped = true;
      current = current.parent;
    }
    if (ownedCode) {
      assert.equal(mapped, false, 'app code must never swallow source text inside a mapped block');
      return;
    }
    // Formatting between block elements may contain whitespace. Every other
    // readable occurrence must belong to exactly one canonical source block.
    assert.ok(mapped || /^[\t\n\r ]*$/.test(node.data), `${entry.slug}: unmapped readable text ${JSON.stringify(node.data.slice(0, 80))}`);
    if (mapped) readable += node.data;
  });

  for (let index = 0; index < blocks.length; index += 1) {
    const node = blocks[index];
    const record = expected.records[index];
    const { block } = record;
    const label = `${entry.slug}: ${block.id}`;
    assertReadableStyle(node, textStyles, label);
    assert.equal(node.attribs['data-text-id'], block.id, `${label}: source order and distinct occurrence`);
    assert.equal(node.attribs['data-section-id'], record.sectionId, `${label}: source section ownership`);
    assert.equal(seenIds.has(block.id), false, `${label}: no duplicate source occurrence`);
    seenIds.add(block.id);
    for (const [attribute, value] of [['data-start', record.start], ['data-text-end', record.textEnd], ['data-end', record.end]]) {
      assert.equal(node.attribs[attribute], String(value), `${label}: ${attribute}`);
    }
    assert.equal(node.attribs['data-separator'], record.separator, `${label}: exact structural separator`);
    assert.equal(semanticTag(node), block.tag, `${label}: source block tag evidence`);
    assert.deepEqual(semanticClasses(node), sourceClasses(block), `${label}: source block classes`);
    // The source sometimes prints a heading in a paragraph (SONG., for
    // example). Its canonical heading type permits a real heading element,
    // while data-source-tag must still retain the original paragraph evidence.
    if (/^(?:h[1-6]|p|pre|blockquote)$/.test(block.tag) && !(block.type === 'heading' && block.tag === 'p')) assert.equal(node.name, block.tag, `${label}: actual source block semantics`);
    if (block.type === 'heading') assert.match(node.name, /^h[1-6]$/, `${label}: headings retain heading semantics`);
    assert.equal(descendantText(node), block.text, `${label}: exact descendant text including explicit LF, NBSP and trailing breaks`);
    recovered += descendantText(node) + node.attribs['data-separator'];

    const inline = new Map();
    const cues = [];
    let localOffset = 0;
    function inspect(child) {
      const start = localOffset;
      if (child.type === 'text') localOffset += child.data.length;
      for (const nested of child.children || []) inspect(nested);
      if (child !== node && child.attribs) {
        assertReadableStyle(child, textStyles, label);
        assert.equal(sourceBlockNodes.has(child), false, `${label}: mapped blocks cannot nest`);
        assert.equal(Object.hasOwn(child.attribs, 'hidden'), false, `${label}: actual source text is visible`);
        assert.notEqual(child.attribs['aria-hidden'], 'true', `${label}: actual source text stays accessible`);
        assert.doesNotMatch(child.attribs.style || '', /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\D|$)|font-size\s*:\s*0(?:\D|$)/i, `${label}: actual source text is not hidden`);
        if (Object.hasOwn(child.attribs, 'data-span-index')) {
          const spanIndex = Number(child.attribs['data-span-index']);
          assert.ok(Number.isInteger(spanIndex) && spanIndex >= 0 && spanIndex < block.spans.length, `${label}: known source span`);
          const span = block.spans[spanIndex];
          assert.equal(semanticTag(child), span.tag, `${label}: inline source tag`);
          assert.deepEqual(semanticClasses(child), sourceClasses(span), `${label}: inline source classes`);
          if (/^(?:b|i|em|strong|span|u|s|small|sub|sup|code|mark)$/.test(span.tag)) assert.equal(child.name, span.tag, `${label}: actual inline formatting semantics`);
          for (const className of sourceClasses(span)) assert.ok((child.attribs.class || '').split(/\s+/).includes(className), `${label}: actual inline source class ${className}`);
          if (!inline.has(spanIndex)) inline.set(spanIndex, []);
          inline.get(spanIndex).push([start, localOffset]);
        }
        if (Object.hasOwn(child.attribs, 'data-reader-cue')) {
          assert.equal(child.attribs['data-reader-cue'], 'true', `${label}: cue marker`);
          cues.push([start, localOffset]);
          assert.equal(child.attribs['data-cue-start'], String(block.attribution.cueStart), `${label}: cue start mapping`);
          assert.equal(child.attribs['data-cue-end'], String(block.attribution.cueEnd), `${label}: cue end mapping`);
        }
      }
    }
    inspect(node);
    assert.equal(localOffset, block.text.length, `${label}: UTF-16 visible length`);
    for (let spanIndex = 0; spanIndex < block.spans.length; spanIndex += 1) {
      const span = block.spans[spanIndex];
      const ranges = (inline.get(spanIndex) || []).sort((a, b) => a[0] - b[0]);
      let cursor = span.start;
      assert.ok(ranges.length > 0, `${label}: source span ${spanIndex} is rendered`);
      for (const [start, end] of ranges) {
        assert.equal(start, cursor, `${label}: span ${spanIndex} has continuous exact coverage without duplicate formatting`);
        assert.ok(end >= start && end <= span.end, `${label}: source span ${spanIndex} end`);
        cursor = end;
      }
      assert.equal(cursor, span.end, `${label}: source span ${spanIndex} complete`);
    }
    const explicit = block.speakerLabel && block.attribution.status === 'explicit';
    assert.deepEqual(cues.sort((a, b) => a[0] - b[0]), explicit ? [[block.attribution.cueStart, block.attribution.cueEnd]] : [], `${label}: original cue styled once in its exact source range`);
    if (explicit) assert.equal(block.text.slice(block.attribution.cueStart, block.attribution.cueEnd), block.speakerLabel, `${label}: exact original cue remains in text`);
    for (let ancestor = node; ancestor && ancestor !== body; ancestor = ancestor.parent) {
      if (!ancestor.attribs) continue;
      assert.equal(Object.hasOwn(ancestor.attribs, 'hidden'), false, `${label}: source block visible`);
      assert.notEqual(ancestor.attribs['aria-hidden'], 'true', `${label}: source block accessible`);
      assert.doesNotMatch(ancestor.attribs.style || '', /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\D|$)/i, `${label}: source block not hidden`);
    }
  }
  assert.equal(recovered, expected.text, `${entry.slug}: DOM text plus mapped structural separators recovers source exactly`);
  assert.equal(readable, expected.records.map(record => record.block.text).join(''), `${entry.slug}: no source text is duplicated outside the mapping`);
  assert.equal($('script[src],link[rel="stylesheet"],iframe,object,embed,img,audio,video,base').length, 0, 'source content cannot load external resources or active markup');
  $('*').each((_, node) => {
    for (const [name, value] of Object.entries(node.attribs || {})) {
      assert.doesNotMatch(name, /^on/i, 'no source event handlers');
      if (['src', 'href', 'srcdoc', 'xlink:href'].includes(name)) assert.doesNotMatch(value, /^\s*(?:javascript:|data:|https?:|\/\/)/i, 'no external or executable source URLs');
    }
  });
  return { $, expected };
}

test('reader corpus has all 38 published plays and the real document API', () => {
  assert.equal(manifest.plays.length, 38);
  documentGenerator();
});

for (const reference of manifest.plays) {
  test(`reader document preserves every mapped source occurrence and inline range: ${reference.id}`, () => {
    const entry = loadEntry(reference);
    const result = documentGenerator()(entry, { documentId: `corpus-${entry.slug}` });
    auditDocument(entry, result);
  });
}

function fixtureEntry() {
  const section = { id: 'corpus-fixture-scene', kind: 'scene', act: 1, scene: 1, parentSectionId: null, heading: 'Fixture', orderInPlay: 1 };
  const blocks = [
    { id: 'fixture/heading', type: 'heading', tag: 'h2', classes: [], text: 'A & "quoted" <heading>', separatorAfter: '\n\n', spans: [], speakerLabel: null, attribution: { status: 'not-applicable' } },
    { id: 'fixture/cue', type: 'speech', tag: 'p', classes: ['drama'], text: 'A.\n</script><img src=x onerror="alert(1)"> & \' " 😀\u00a0same\n\nsame\n\n', separatorAfter: '\n\n', spans: [{ tag: 'i', start: 3, end: 24 }, { tag: 'b', start: 3, end: 24 }, { tag: 'span', className: 'charname', start: 7, end: 31 }], speakerLabel: 'A.', attribution: { status: 'explicit', cueStart: 0, cueEnd: 2 } },
    { id: 'fixture/cell-a', type: 'passage', tag: 'td', classes: [], text: 'same', separatorAfter: '\t', spans: [], speakerLabel: null, attribution: { status: 'source-unlabelled' } },
    { id: 'fixture/cell-b', type: 'passage', tag: 'td', classes: [], text: 'same', separatorAfter: '\n', spans: [], speakerLabel: null, attribution: { status: 'source-unlabelled' } },
    { id: 'fixture/final', type: 'passage', tag: 'p', classes: ['right'], text: '  😀\u00a0same\n\n', separatorAfter: '\n\n', spans: [], speakerLabel: null, attribution: { status: 'source-unlabelled' } },
  ];
  const play = { id: 'corpus-fixture', schemaVersion: '2.0.0', canonicalTextVersion: '1', contentVersion: 'a'.repeat(64), title: 'Fixture', sections: [{ ...section, path: './scene.json' }] };
  const document = { schemaVersion: '2.0.0', canonicalTextVersion: '1', contentVersion: play.contentVersion, work: { id: play.id }, section, content: blocks };
  return { slug: play.id, play, sections: [document], scenes: [document] };
}

test('reader DOM preserves dangerous-looking source as text, astral offsets, repeated text, overlapping spans and structural table separators', () => {
  const entry = fixtureEntry();
  const result = documentGenerator()(entry, { documentId: 'corpus-fixture' });
  const { expected } = auditDocument(entry, result);
  assert.ok(expected.text.endsWith('same\n\n'), 'only added final separator is omitted, never explicit trailing LF');
  assert.ok(expected.text.includes('same\tsame\n'), 'table separators are TAB/LF mappings, without duplicated visible text');
});

test('independent reader audit rejects text, order, separator, span and cue corruption in real generated HTML', () => {
  const entry = fixtureEntry();
  const result = documentGenerator()(entry, { documentId: 'corpus-mutations' });
  auditDocument(entry, result);
  const mutations = {
    deletion($) { $('[data-reader-block]').first().text(''); },
    addition($) { $('[data-reader-block]').first().append('INJECTED'); },
    unmappedDuplicate($) { $('body').append('<p>same</p>'); },
    unmappedNbsp($) { $('body').append('<p>\u00a0</p>'); },
    duplication($) { const block = $('[data-reader-block]').first(); block.after(block.clone()); },
    reordering($) { $('[data-reader-block]').first().insertAfter($('[data-reader-block]').last()); },
    separator($) { $('[data-reader-block]').eq(2).attr('data-separator', '\n'); },
    range($) { $('[data-reader-block]').eq(2).attr('data-start', '0'); },
    span($) { $('[data-span-index]').first().attr('data-source-tag', 'strong'); },
    missingSpan($) { $('[data-span-index]').first().removeAttr('data-span-index'); },
    formatTag($) { const span = $('[data-span-index]').first()[0]; span.name = 'span'; },
    cue($) { $('[data-reader-cue]').first().attr('data-cue-end', '1'); },
    missingCue($) { $('[data-reader-cue]').first().removeAttr('data-reader-cue'); },
    hidden($) { $('[data-reader-block]').eq(1).attr('hidden', ''); },
    hiddenStyle($) { $('head').append('<style>[data-reader-block]{display:none!important}</style>'); },
    collapsedWhitespace($) { $('head').append('<style>[data-reader-block]{white-space:normal!important}</style>'); },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const $ = cheerio.load(result.html);
    mutate($);
    assert.throws(() => auditDocument(entry, { ...result, html: $.html() }), assert.AssertionError, `${name}: actual HTML corruption must fail independently of unchanged reported canonical metadata`);
  }
});
