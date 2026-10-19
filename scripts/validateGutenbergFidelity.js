#!/usr/bin/env node
'use strict';

// Deliberately independent of parseGutenberg: this reader uses htmlparser2,
// source locations, and its own exhaustive DOM traversal and text accounting.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const acorn = require('acorn');
const { parseDocument } = require('htmlparser2');
const { computeContentVersion, computeCollectionVersion } = require('./contentVersion');

const WORK_IDS = [
  'alls-well-that-ends-well', 'antony-and-cleopatra', 'as-you-like-it', 'errors',
  'coriolanus', 'cymbeline', 'hamlet-prince-of-denmark',
  'the-first-part-of-king-henry-the-fourth', 'the-second-part-of-king-henry-the-fourth',
  'king-henry-the-fifth', 'the-first-part-of-henry-the-sixth',
  'the-second-part-of-king-henry-the-sixth', 'the-third-part-of-king-henry-the-sixth',
  'king-henry-the-eighth', 'king-john', 'julius-caesar', 'king-lear', 'loves-labours-lost',
  'macbeth', 'measure-for-measure', 'the-merchant-of-venice', 'the-merry-wives-of-windsor',
  'a-midsummer-nights-dream', 'much-ado-about-nothing', 'othello-the-moor-of-venice',
  'pericles-prince-of-tyre', 'king-richard-the-second', 'king-richard-the-third',
  'romeo-and-juliet', 'the-taming-of-the-shrew', 'the-tempest', 'timon-of-athens',
  'titus-andronicus', 'troilus-and-cressida', 'twelfth-night-or-what-you-will',
  'the-two-gentlemen-of-verona', 'the-two-noble-kinsmen', 'the-winters-tale',
];
const CATALOG_IDS = [...WORK_IDS.slice(0, 4), WORK_IDS[37], ...WORK_IDS.slice(4, 14), WORK_IDS[15], WORK_IDS[14], ...WORK_IDS.slice(16, 37)];
const LEGACY_CODES = ['AWW', 'Ant', 'AYL', 'Err', 'WT', 'Cor', 'Cym', 'Ham', '1H4', '2H4', 'H5', '1H6', '2H6', '3H6', 'H8', 'JC', 'Jn', 'Lr', 'LLL', 'Mac', 'MM', 'MV', 'Wiv', 'MND', 'Ado', 'Oth', 'Per', 'R2', 'R3', 'Rom', 'Shr', 'Tmp', 'Tim', 'Tit', 'Tro', 'TN', 'TGV', 'TNK'];
const LEGACY_IMAGES = ['AWWimage.png', 'ANTimage.png', 'AYLimage.jpg', 'Errimage.png', 'WTimage.png', 'Corimage.png', 'Cymimage.png', 'Hamimage.png', '1H4image.png', '2H4image.png', 'H5image.png', '1H6image.png', '2H6image.png', '3H6image.png', 'H8image.png', 'JCimage.png', 'Jnimage.png', 'Lrimage.png', 'LLLimage.png', 'Macimage.png', 'MMimage.png', 'MVimage.png', 'Wivimage.png', 'MNDimage.jpg', 'Adoimage.png', 'Othimage.png', 'Perimage.png', 'R2image.png', 'R3image.png', 'Romimage.jpg', 'Shrimage.png', 'Tmpimage.jpg', 'Timimage.png', 'Titimage.png', 'Troimage.png', 'TNimage.jpg', 'TGVimage.png', 'TNKimage.png'];
const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th', 'li', 'pre']);
const KNOWN_TAGS = new Set([
  ...BLOCK_TAGS, 'html', 'body', 'div', 'section', 'a', 'span', 'i', 'b', 'strong', 'em',
  'u', 's', 'small', 'sub', 'sup', 'br', 'hr', 'table', 'tbody', 'thead', 'tfoot', 'tr',
  'blockquote', 'ul', 'ol', 'dl', 'dt', 'dd', 'wbr', 'code', 'mark',
]);
const MAX_ERRORS = 200;
const PINNED_SHA256 = 'd7116e381ba4f0164ba059f6d0e135e07af068b4ab486b57fa7deec6a305d5c3';
// Independently reviewed original occurrences. These are assertions about
// located source evidence, not text replacements or a shared cue extractor.
const REVIEWED_CUES = [
  ['hamlet-prince-of-denmark', 1293313, 1293368, 'Both.'],
  ['hamlet-prince-of-denmark', 1395568, 1395630, 'All.'],
  ['hamlet-prince-of-denmark', 1444925, 1444984, 'Danes.'],
  ['hamlet-prince-of-denmark', 1482056, 1482105, 'All.'],
  ['the-merry-wives-of-windsor', 4133324, 4133396, 'SHALLOW, PAGE, etc.'],
];
const FORMATTING_TAGS = new Set(['i', 'b', 'strong', 'em', 'u', 's', 'small', 'sub', 'sup', 'span', 'code', 'mark']);

function descendants(node, predicate) {
  for (const child of node.children || []) {
    if (predicate(child) || descendants(child, predicate)) return true;
  }
  return false;
}

function canonicalBlock(node) {
  const preformatted = node.name === 'pre';
  const segments = [[]];
  const breakStyles = [];
  const formatting = [];
  let breakCount = 0;
  function visit(current, styles) {
    if (current.type === 'text') {
      for (const character of current.data.replace(/\r\n?/g, '\n')) segments.at(-1).push({ character, styles });
      return;
    }
    if (current.name === 'br') {
      breakCount += 1;
      breakStyles.push(styles);
      segments.push([]);
      return;
    }
    let nextStyles = styles;
    const inline = current !== node && FORMATTING_TAGS.has(current.name);
    if (inline) {
      nextStyles = [...styles, current];
    }
    for (const child of current.children || []) visit(child, nextStyles);
    if (inline) formatting.push(current);
  }
  visit(node, []);
  const output = [];
  segments.forEach((segment, index) => {
    let characters = segment;
    if (!preformatted) {
      let first = 0;
      let last = characters.length;
      while (first < last && /^[\t\n\f ]$/.test(characters[first].character)) first += 1;
      while (last > first && /^[\t\n\f ]$/.test(characters[last - 1].character)) last -= 1;
      characters = characters.slice(first, last);
      const compacted = [];
      for (let cursor = 0; cursor < characters.length; cursor += 1) {
        const character = characters[cursor];
        if (character.character === '\n') {
          while (compacted.length && /^[\t ]$/.test(compacted.at(-1).character)) compacted.pop();
          while (cursor + 1 < characters.length && /^[\t \n]$/.test(characters[cursor + 1].character)) cursor += 1;
          compacted.push({ character: ' ', styles: character.styles });
        } else compacted.push(character);
      }
      characters = compacted;
    }
    if (index) output.push({ character: '\n', styles: breakStyles[index - 1] });
    output.push(...characters);
  });
  let offset = 0;
  const extents = new Map();
  for (const item of output) {
    for (const style of item.styles) {
      if (!extents.has(style)) extents.set(style, { tag: style.name, start: offset, end: offset, ...(style.attribs.class ? { className: style.attribs.class } : {}) });
      extents.get(style).end = offset + item.character.length;
    }
    offset += item.character.length;
  }
  const spans = formatting.filter(style => extents.has(style)).map(style => extents.get(style));
  return { text: output.map(item => item.character).join(''), spans, breakCount };
}

function numeral(value) {
  const numbers = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  let result = 0;
  for (let index = 0; index < value.length; index += 1) result += numbers[value[index]] < (numbers[value[index + 1]] || 0) ? -numbers[value[index]] : numbers[value[index]];
  return result;
}

function expectedSections(work) {
  const sections = [];
  let act = null;
  let parent = null;
  let induction = false;
  for (const block of work.blocks) {
    const heading = block.text.split('\n')[0];
    const headingText = heading.trim();
    const isHeading = /^h[1-6]$/.test(block.tag);
    let kind = null;
    let scene = null;
    let match;
    if (!sections.length) kind = 'title';
    else if (isHeading && /^Contents$/i.test(headingText)) kind = 'contents';
    else if (isHeading && /^Dramatis Person/i.test(headingText)) kind = 'cast';
    else if (isHeading && (match = headingText.match(/^ACT\s+([IVXLC]+)\b/i))) {
      kind = 'act'; act = numeral(match[1].toUpperCase()); induction = false;
    } else if (isHeading && /^INDUCTION\b/i.test(headingText)) {
      kind = 'induction'; act = null; induction = true;
    } else if (isHeading && (match = headingText.match(/^SCENE\s+([IVXLC]+)\./i))) {
      kind = induction ? 'induction-scene' : 'scene'; scene = numeral(match[1].toUpperCase());
    } else if ((isHeading || /\.0$/.test(block.ownAnchor || '')) && /^\[?(?:THE\s+)?PROLOGUE\.?\]?$/i.test(headingText)) kind = 'prologue';
    else if (isHeading && /^\[?(?:THE\s+)?EPILOGUE\.?\]?$/i.test(headingText)) kind = 'epilogue';
    else if (isHeading && /^SCENE[.:]/i.test(headingText)) kind = 'setting';
    if (kind) {
      const offset = block.sourceRef.start - work.start;
      const id = kind === 'induction-scene' ? `${work.id}-induction-${scene}` : kind === 'scene' ? `${work.id}-${act}-${scene}` : `${work.id}-${kind}-${offset}`;
      const parentSectionId = ['scene', 'induction-scene', 'prologue', 'epilogue'].includes(kind) ? parent : null;
      const section = { id, kind, heading, act, scene, parentSectionId, orderInPlay: sections.length + 1, sourceRef: block.sourceRef, content: [] };
      if (kind === 'act' || kind === 'induction') parent = id;
      sections.push(section);
    }
    const section = sections.at(-1);
    section.content.push(block);
    block.sectionId = section.id;
  }
  return sections;
}

function expectedBlocks(work, exclusions) {
  const selected = work.elements.filter(element => BLOCK_TAGS.has(element.name) && !descendants(element, descendant => BLOCK_TAGS.has(descendant.name)));
  const selectedSet = new Set(selected);
  const covered = node => {
    let current = node.parent;
    while (current) { if (selectedSet.has(current)) return true; current = current.parent; }
    return false;
  };
  const roots = [...selected, ...work.allNodes.filter(node => node.type === 'text' && visible(node) && !covered(node))].sort((a, b) => a.startIndex - b.startIndex);
  const anchors = work.elements.filter(element => element.attribs.id);
  const blocks = [];
  for (const node of roots) {
    const canonical = canonicalBlock(node);
    if (!canonical.text && !canonical.breakCount) {
      exclusions.push({ reason: 'formatting-only-element', workId: work.id, ...work.location(node) });
      continue;
    }
    const position = work.location(node);
    const tag = node.name || '#text';
    const ownAnchor = anchors.find(anchor => anchor.startIndex >= position.start && anchor.startIndex < position.end);
    const preceding = anchors.filter(anchor => anchor.startIndex <= position.start).at(-1);
    const anchor = ownAnchor?.attribs.id || preceding?.attribs.id || work.anchor;
    const sourceRef = { start: position.start, end: position.end, line: position.line, column: position.column, path: `${work.anchor}/${tag}@${position.start - work.start}`, anchor };
    let separatorAfter = '\n\n';
    if (tag === 'td' || tag === 'th') {
      const cells = (node.parent?.children || []).filter(child => child.name === 'td' || child.name === 'th');
      separatorAfter = cells.at(-1) === node ? '\n' : '\t';
    }
    blocks.push({ id: `${work.id}/${anchor}/${tag}@${position.start - work.start}`, tag, classes: (node.attribs?.class || '').split(/\s+/).filter(Boolean), text: canonical.text, spans: canonical.spans, separatorAfter, sourceRef, ownAnchor: ownAnchor?.attribs.id, breakCount: canonical.breakCount });
  }
  for (const element of work.elements) if (element.name === 'hr') exclusions.push({ reason: 'formatting-rule', workId: work.id, ...work.location(element) });
  return blocks;
}

function same(a, b) { return isDeepStrictEqual(a, b); }

function checkCatalog({ candidateRoot, plays, add }) {
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(candidateRoot, 'data', 'manifest.json'), 'utf8')); }
  catch (error) { add('manifest-file', error.message); }
  const ordered = CATALOG_IDS.map(id => plays.get(id));
  const complete = ordered.every(play => play && typeof play.contentVersion === 'string' && play.contentVersion);
  const collectionVersion = complete ? computeCollectionVersion(ordered.map(play => ({ workId: play.id, contentVersion: play.contentVersion }))) : null;
  if (manifest) {
    if (manifest.version !== 'v2' || manifest.schemaVersion !== '2.0.0' || manifest.canonicalTextVersion !== '1') add('manifest-schema', 'Manifest must declare schema 2 and canonical text version 1.');
    if (!Array.isArray(manifest.plays) || manifest.plays.length !== CATALOG_IDS.length) add('manifest-inventory', 'Manifest must contain all 38 plays in the preserved legacy catalog order.');
    for (let index = 0; index < CATALOG_IDS.length; index += 1) {
      const id = CATALOG_IDS[index];
      const entry = manifest.plays?.[index];
      const play = plays.get(id);
      if (!entry || entry.id !== id || entry.legacyId !== index) { add('manifest-inventory', `Catalog position ${index} must retain ${id} and its legacy ID.`); continue; }
      if (!play) continue;
      if (entry.contentVersion !== play.contentVersion) add('manifest-content-version', `Manifest has a stale work version for ${id}.`);
      if (entry.schemaVersion !== play.schemaVersion || entry.canonicalTextVersion !== play.canonicalTextVersion || entry.title !== play.title || entry.genre !== play.genre || typeof entry.displayName !== 'string' || !Number.isFinite(entry.difficulty)) add('manifest-metadata', `Manifest metadata does not match ${id}.`);
      if (!same(entry.sections, play.sections)) add('manifest-reference', `Manifest section inventory differs from the validated ordered play references for ${id}.`);
      const paths = { folder: `./plays/${id}/`, play: `./plays/${id}/play.json`, characters: `./plays/${id}/characters.json`, synopsis: `./plays/${id}/synopsis.json`, quiz: `./plays/${id}/quiz.json` };
      for (const [field, expected] of Object.entries(paths)) if (entry[field] !== expected) add('manifest-reference', `Manifest ${id}.${field} must remain ${expected}.`);
    }
    if (collectionVersion && manifest.contentVersion !== collectionVersion) add('collection-version', 'Collection version must hash the ordered legacy catalog work/version pairs.');
  }
  let ast;
  try { ast = acorn.parse(fs.readFileSync(path.join(candidateRoot, 'shared', 'localPlayRegistry.js'), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' }); }
  catch (error) { add('registry-file', error.message); return { collectionVersion }; }
  const declarations = new Map();
  let exported = false;
  for (const statement of ast.body) {
    if (statement.type === 'VariableDeclaration' && statement.kind === 'const') {
      for (const declaration of statement.declarations) {
        if (declaration.id.type !== 'Identifier' || declaration.init?.type !== 'ArrayExpression') add('registry-schema', 'Registry declarations must be static named arrays.');
        else declarations.set(declaration.id.name, declaration.init);
      }
    } else if (statement.type === 'ExportDefaultDeclaration' && statement.declaration.type === 'Identifier' && statement.declaration.name === 'LOCAL_PLAY_DATA') exported = true;
    else add('registry-schema', `Unsupported executable registry statement ${statement.type}.`);
  }
  const registry = declarations.get('LOCAL_PLAY_DATA');
  if (!exported || !registry || registry.elements.length !== CATALOG_IDS.length) { add('registry-inventory', 'Registry must export all 38 static play entries in legacy catalog order.'); return { collectionVersion }; }
  const literal = node => node?.type === 'Literal' ? node.value : undefined;
  const requiredPath = node => node?.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require' && node.arguments.length === 1 && typeof literal(node.arguments[0]) === 'string' ? literal(node.arguments[0]) : undefined;
  const usedDeclarations = new Set(['LOCAL_PLAY_DATA']);
  const allowedFields = new Set(['id', 'slug', 'legacyId', 'name', 'code', 'difficulty', 'mainImage', 'medalImage', 'play', 'characters', 'synopsis', 'quiz', 'sections', 'scenes']);
  for (let index = 0; index < CATALOG_IDS.length; index += 1) {
    const id = CATALOG_IDS[index];
    const node = registry.elements[index];
    if (node?.type !== 'ObjectExpression' || node.properties.some(property => property.type !== 'Property' || property.computed || property.kind !== 'init' || property.method || property.shorthand)) { add('registry-schema', `Registry ${id} must be a static object.`); continue; }
    const props = new Map(node.properties.map(property => [property.key.name ?? literal(property.key), property.value]));
    if (props.size !== node.properties.length) add('registry-schema', `Registry ${id} has duplicate properties.`);
    for (const field of props.keys()) if (!allowedFields.has(field)) add('registry-schema', `Registry ${id} has unsupported property ${field}.`);
    if (literal(props.get('id')) !== id || literal(props.get('slug')) !== id || literal(props.get('legacyId')) !== index || literal(props.get('code')) !== LEGACY_CODES[index]) add('registry-inventory', `Registry ${id} has changed identity, legacy ID, code or catalog ordering.`);
    const entry = manifest?.plays?.[index];
    if (entry && (literal(props.get('name')) !== entry.displayName || literal(props.get('difficulty')) !== entry.difficulty)) add('registry-metadata', `Registry display metadata differs from manifest ${id}.`);
    const approvedImages = {
      mainImage: `../assets/images/${LEGACY_IMAGES[index]}`,
      medalImage: `../assets/medalCollection/m${index === 1 ? 'ANT' : LEGACY_CODES[index]}.png`,
    };
    for (const [field, asset] of Object.entries(approvedImages)) if (requiredPath(props.get(field)) !== asset) add('registry-reference', `Registry ${id}.${field} must be a static one-argument require of its approved asset ${asset}.`);
    for (const file of ['play', 'characters', 'synopsis', 'quiz']) if (requiredPath(props.get(file)) !== `../data/plays/${id}/${file}.json`) add('registry-reference', `Registry ${id}.${file} must statically import its own preserved file.`);
    const play = plays.get(id);
    if (!play || !Array.isArray(play.sections)) continue;
    const sectionName = props.get('sections')?.type === 'Identifier' ? props.get('sections').name : null;
    if (sectionName) usedDeclarations.add(sectionName);
    const sectionArray = declarations.get(sectionName);
    const expectedImports = play.sections.map(ref => typeof ref?.path === 'string' ? `../data/plays/${id}/${ref.path.slice(2)}` : null);
    const actualImports = sectionArray?.elements.map(requiredPath);
    if (!same(actualImports, expectedImports)) add('registry-reference', `Registry section imports must exactly follow ${id}.sections source order.`);
    const scenes = props.get('scenes');
    const expectedScenes = (play.acts || []).flatMap(act => act.scenes || []).map(scene => play.sections.findIndex(ref => ref.id === scene.id && ref.path === scene.path));
    const actualScenes = scenes?.type === 'ArrayExpression' ? scenes.elements.map(scene => scene?.type === 'MemberExpression' && scene.computed && scene.object.type === 'Identifier' && scene.object.name === sectionName ? literal(scene.property) : undefined) : null;
    if (!same(actualScenes, expectedScenes)) add('registry-reference', `Registry ordinary scene aliases differ from the validated ordered references for ${id}.`);
  }
  for (const name of declarations.keys()) if (!usedDeclarations.has(name)) add('registry-reference', `Unreferenced registry declaration ${name} may import unapproved runtime material.`);
  return { collectionVersion };
}

function checkPlay({ work, playFile, source, add }) {
  if (!work.sections) { add('missing-source-chapter', 'Candidate has no corresponding complete source chapter.'); return {}; }
  let play;
  try { play = JSON.parse(fs.readFileSync(playFile, 'utf8')); }
  catch (error) { add('play-json', error.message); return {}; }
  const workRoot = path.dirname(playFile);
  if (play.id !== work.id || play.schemaVersion !== '2.0.0' || play.canonicalTextVersion !== '1') add('play-schema', 'Play identity/schema/canonical text version is invalid.');
  if (play.title !== work.blocks[0]?.text || play.fullTitle !== work.blocks[0]?.text) add('source-title', 'Play title and fullTitle must match the original source work heading.');
  if (play.source?.chapterId !== work.anchor || play.source?.sha256 !== source.sha256) add('play-provenance', 'Play provenance must identify its exact raw source and chapter.');
  if (!Array.isArray(play.sections)) { add('section-inventory', 'play.sections must be the authoritative ordered array.'); return { play }; }
  const expectedByStart = new Map(work.blocks.map(block => [block.sourceRef.start, block]));
  const expectedBySection = new Map(work.sections.map(section => [section.id, section]));
  const sections = [];
  const sectionIds = new Set();
  const sectionPaths = new Set();
  const actualFiles = new Set();
  function list(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) list(file);
      else if (entry.isFile() && entry.name.endsWith('.json')) actualFiles.add(path.resolve(file));
    }
  }
  list(path.join(workRoot, 'scenes'));
  list(path.join(workRoot, 'sections'));
  if (play.sections.length !== work.sections.length) add('section-inventory', `Expected ${work.sections.length} source sections, found ${play.sections.length}.`);
  const seen = new Map();
  const textIds = new Set();
  let previous = -1;
  let unlabelled = 0;
  let generatedBlocks = 0;
  const canonicalParts = [];
  for (let index = 0; index < play.sections.length; index += 1) {
    const ref = play.sections[index];
    if (!ref || typeof ref !== 'object') { add('section-reference', `Invalid section reference at ${index}.`); continue; }
    if (sectionIds.has(ref.id) || sectionPaths.has(ref.path)) add('section-reference', `Duplicate section ID/path at ${index}.`);
    sectionIds.add(ref.id); sectionPaths.add(ref.path);
    if (typeof ref.path !== 'string' || !/^\.\/(scenes|sections)\/[a-zA-Z0-9_.-]+\.json$/.test(ref.path)) { add('section-reference', `Unsafe or unsupported section path ${String(ref.path)}.`); continue; }
    const file = path.resolve(workRoot, ref.path);
    actualFiles.delete(file);
    let document;
    try { document = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { add('section-file', `${ref.path}: ${error.message}`); continue; }
    sections.push(document);
    const section = document.section;
    if (document.schemaVersion !== '2.0.0' || document.canonicalTextVersion !== '1' || document.work?.id !== work.id || document.source?.sha256 !== source.sha256 || document.source?.chapterId !== work.anchor) add('section-schema', `Invalid schema/work/provenance in ${ref.path}.`);
    if (document.work?.title !== work.blocks[0]?.text) add('source-title', `${ref.path}: work.title differs from the original source work heading.`);
    if (!section || typeof section !== 'object' || !Array.isArray(document.content)) { add('section-schema', `Missing section/content in ${ref.path}.`); continue; }
    const expectedSection = work.sections[index];
    const fields = ['id', 'kind', 'heading', 'act', 'scene', 'parentSectionId', 'orderInPlay'];
    for (const field of fields) {
      if (!same(section[field], ref[field])) add('section-reference', `${ref.path}: section.${field} differs from its play reference.`);
      if (expectedSection && !same(section[field], expectedSection[field])) add('section-ownership', `${ref.path}: expected ${field} ${JSON.stringify(expectedSection[field])}, found ${JSON.stringify(section[field])}.`, expectedSection.sourceRef);
    }
    if (expectedSection && !same(section.sourceRef, expectedSection.sourceRef)) add('source-reference', `${ref.path}: section provenance does not address its source boundary.`, expectedSection.sourceRef);
    if (section.kind === 'scene' && section.act !== null && ref.path !== `./scenes/act-${section.act}-scene-${section.scene}.json`) add('scene-alias', `Ordinary scene ${section.id} must retain its legacy path.`);
    for (const block of document.content) {
      generatedBlocks += 1;
      if (!block || typeof block !== 'object') { add('block-schema', `Invalid block in ${ref.path}.`); continue; }
      const location = block.sourceRef;
      const expected = expectedByStart.get(location?.start);
      if (!expected) { add('extra-generated-block', `Block ${block.id} has no corresponding source occurrence.`, location); continue; }
      const start = expected.sourceRef.start;
      seen.set(start, (seen.get(start) || 0) + 1);
      if (seen.get(start) > 1) add('duplicate-source-occurrence', `Source occurrence ${start} is emitted more than once.`, expected.sourceRef);
      if (start < previous) add('source-order', `Block ${block.id} is out of raw source order.`, expected.sourceRef);
      previous = start;
      if (expected.sectionId !== section.id) add('section-ownership', `Block ${block.id} belongs to source section ${expected.sectionId}.`, expected.sourceRef);
      if (!same(location, expected.sourceRef)) add('source-reference', `Block ${block.id} has forged or inaccurate source provenance.`, expected.sourceRef);
      if (block.id !== expected.id || textIds.has(block.id)) add('text-id', `Expected unique stable text ID ${expected.id}.`, expected.sourceRef);
      textIds.add(block.id);
      if (block.tag !== expected.tag || !same(block.classes, expected.classes) || typeof block.type !== 'string') add('block-schema', `Block ${block.id} must retain its source tag/classes and a type.`, expected.sourceRef);
      if (block.text !== expected.text) add('text-mismatch', `Block ${block.id} differs from independently decoded source text.`, expected.sourceRef);
      if (block.separatorAfter !== expected.separatorAfter) add('separator-mismatch', `Block ${block.id} loses a paragraph/table boundary.`, expected.sourceRef);
      const spans = Array.isArray(block.spans) ? block.spans.map(span => ({ tag: span.tag, start: span.start, end: span.end, ...(span.className ? { className: span.className } : {}) })) : null;
      if (!same(spans, expected.spans)) add('formatting-spans', `Block ${block.id} has missing or inaccurate source formatting ranges.`, expected.sourceRef);
      let cursor = 0;
      const lines = expected.text.split('\n').map((text, lineIndex) => {
        const line = { id: `${expected.id}/line-${lineIndex + 1}`, start: cursor, end: cursor + text.length, sourceLineNumber: null };
        cursor += text.length + 1;
        return line;
      });
      if (!same(block.lines, lines)) add('line-reference', `Block ${block.id} has stale or inaccurate UTF-16 line references.`, expected.sourceRef);
      const sourceSection = expectedBySection.get(expected.sectionId);
      const stage = expected.classes.includes('scenedesc');
      const caption = expected.tag === 'p' && /^(?:[\p{Lu}\p{M} ’']* )?SONG\.?$/u.test(expected.text);
      const canHaveCue = expected.tag === 'p' && !stage && !caption && !['title', 'contents', 'cast', 'setting'].includes(sourceSection?.kind);
      const firstLine = expected.text.split('\n')[0];
      let prefix = firstLine.match(/^((?:[0-9]+ )?[\p{Lu}][\p{Lu}\p{M}0-9 ’'.,&\-]*(?:\band\b[\p{Lu}\p{M}0-9 ’'.,&\-]*)?\.)/u)?.[1];
      if (!prefix && expected.breakCount > 0 && /^(?:[0-9]+ )?[\p{Lu}][\p{Lu}\p{M}0-9 ’',&\-]*(?:\band\b[\p{Lu}\p{M}0-9 ’',&\-]*)?$/u.test(firstLine)) prefix = firstLine;
      if (!prefix && expected.breakCount > 0) prefix = firstLine.match(/^((?:[0-9]+ )?[\p{Lu}][\p{Lu}\p{M}0-9 ’',&\-]*?)(?= +[\[(])/u)?.[1];
      const reviewed = work.sha256 === PINNED_SHA256 && REVIEWED_CUES.find(([id, start, end, label]) => id === work.id && start === expected.sourceRef.start && end === expected.sourceRef.end && label === firstLine && expected.breakCount > 0 && expected.classes.includes('drama'));
      const cue = canHaveCue ? (reviewed?.[3] || (prefix && !['SONG', 'THE SONG', 'A SONG'].includes(prefix.replace(/\.$/, '')) ? prefix : null)) : null;
      const status = cue ? 'explicit' : canHaveCue ? 'source-unlabelled' : 'not-applicable';
      const expectedType = /^h[1-6]$/.test(expected.tag) || caption ? 'heading' : expected.tag === 'p' && sourceSection?.kind === 'cast' ? 'cast' : stage ? 'stage' : cue ? 'speech' : 'passage';
      if (block.type !== expectedType) add('block-type', `Block ${block.id} has type ${block.type}; source evidence requires ${expectedType}.`, expected.sourceRef);
      if (status === 'source-unlabelled') unlabelled += 1;
      if ((block.speakerLabel ?? null) !== cue || block.attribution?.status !== status || (cue && (block.attribution.cueStart !== 0 || block.attribution.cueEnd !== cue.length))) add('attribution-mismatch', `Block ${block.id} does not match its source cue evidence (${status}).`, expected.sourceRef);
      if (block.attribution?.evidence && (!reviewed || block.attribution.evidence !== 'reviewed-source-cue')) add('attribution-mismatch', `Block ${block.id} asserts unverified reviewed cue evidence.`, expected.sourceRef);
      canonicalParts.push(expected.text + expected.separatorAfter);
    }
  }
  for (const expected of work.blocks) if (!seen.has(expected.sourceRef.start)) add('missing-source-occurrence', `Missing source block ${expected.id}.`, expected.sourceRef);
  for (const file of actualFiles) add('unreferenced-section-file', `Generated section file is absent from the ordered reference inventory: ${path.relative(workRoot, file)}.`);
  const sceneReferences = play.sections.filter(ref => ref.kind === 'scene' && ref.act !== null);
  const sceneAliases = (Array.isArray(play.acts) ? play.acts : []).flatMap(act => (Array.isArray(act.scenes) ? act.scenes : []).map(scene => ({ act: act.act, ...scene })));
  if (sceneAliases.length !== sceneReferences.length || sceneReferences.some((ref, index) => {
    const alias = sceneAliases[index];
    return !alias || alias.id !== ref.id || alias.act !== ref.act || alias.scene !== ref.scene || alias.path !== ref.path;
  })) add('scene-alias', 'Legacy acts[].scenes[] must preserve the ordered ordinary scene IDs and paths.');
  try {
    const version = computeContentVersion(play, sections);
    if (play.contentVersion !== version || sections.some(document => document.contentVersion !== version)) add('content-version', 'Content version does not match the complete ordered generated payload.');
  } catch (error) { add('content-version', error.message); }
  return { play, sectionCount: sections.length, sourceBlocks: work.blocks.length, generatedBlocks, unlabelledPassages: unlabelled, explicitBreaks: work.blocks.reduce((sum, block) => sum + block.breakCount, 0), canonicalUtf16Length: work.blocks.reduce((sum, block, index) => sum + block.text.length + (index === work.blocks.length - 1 ? 0 : block.separatorAfter.length), 0) };
}

function visible(node) {
  if (node.type === 'text') return /[^\t\n\r ]/.test(node.data);
  if (node.name === 'br' || node.name === 'img') return true;
  return (node.children || []).some(visible);
}

function sourceInventory(html, sha256) {
  const document = parseDocument(html, { decodeEntities: true, withStartIndices: true, withEndIndices: true });
  const elements = [];
  const allNodes = [];
  const visit = node => {
    allNodes.push(node);
    if (node.type === 'tag') elements.push(node);
    for (const child of node.children || []) visit(child);
  };
  visit(document);
  const lineStarts = [0];
  for (let index = 0; index < html.length; index += 1) {
    if (html[index] === '\r') {
      if (html[index + 1] === '\n') index += 1;
      lineStarts.push(index + 1);
    } else if (html[index] === '\n') lineStarts.push(index + 1);
  }
  function location(node) {
    const start = node.startIndex;
    let low = 0;
    let high = lineStarts.length;
    while (low + 1 < high) {
      const mid = (low + high) >> 1;
      if (lineStarts[mid] <= start) low = mid;
      else high = mid;
    }
    return { start, end: node.endIndex + 1, line: low + 1, column: start - lineStarts[low] + 1, tag: node.name || '#text' };
  }
  const anchors = elements.filter(element => /^chap\d{2}$/.test(element.attribs.id || ''));
  const chapters = anchors.map(anchor => {
    let heading = anchor;
    while (heading.parent && !/^h[1-6]$/.test(heading.name || '')) heading = heading.parent;
    if (!/^h[1-6]$/.test(heading.name || '')) heading = anchor;
    return { anchor: anchor.attribs.id, node: heading, start: heading.startIndex };
  });
  const footer = elements.find(element => element.attribs.id === 'pg-footer');
  for (let index = 0; index < chapters.length; index += 1) {
    chapters[index].end = chapters[index + 1]?.start ?? footer?.startIndex ?? html.length;
  }
  const exclusions = [];
  if (chapters[0]?.start > 0) exclusions.push({ reason: 'document-header-and-navigation', start: 0, end: chapters[0].start });
  for (const chapter of chapters) {
    const number = Number(chapter.anchor.slice(4));
    if (number < 2 || number > 39) exclusions.push({ reason: 'non-play-work', anchor: chapter.anchor, start: chapter.start, end: chapter.end });
  }
  const lastEnd = chapters.at(-1)?.end;
  if (lastEnd < html.length) exclusions.push({ reason: 'document-footer-and-license', start: lastEnd, end: html.length });
  const errors = [];
  if (chapters.length !== 44 || chapters.some((chapter, index) => chapter.anchor !== `chap${String(index + 1).padStart(2, '0')}`)) {
    errors.push({ code: 'chapter-inventory', message: 'Expected ordered source chapter anchors chap01 through chap44.' });
  }
  const works = WORK_IDS.map((id, index) => {
    const anchor = `chap${String(index + 2).padStart(2, '0')}`;
    const chapter = chapters.find(item => item.anchor === anchor);
    if (!chapter) return { id, anchor, blocks: [], errors: [{ code: 'missing-source-chapter', message: `Missing ${anchor}.` }] };
    const localErrors = [];
    const inside = node => node.startIndex >= chapter.start && node.startIndex < chapter.end;
    for (const element of elements) {
      if (inside(element) && !KNOWN_TAGS.has(element.name) && visible(element)) {
        const error = { code: 'unsupported-markup', workId: id, message: `Meaningful <${element.name}> requires an explicit supported representation.`, location: location(element) };
        localErrors.push(error);
        errors.push(error);
      }
    }
    const work = { id, ...chapter, sha256, errors: localErrors, elements: elements.filter(inside), allNodes: allNodes.filter(inside), location };
    work.blocks = expectedBlocks(work, exclusions);
    work.sections = expectedSections(work);
    return work;
  });
  return { works, errors, exclusions, chapterCount: chapters.length, location };
}

function validateCollection({ sourceFile, candidateRoot } = {}) {
  const errors = [];
  const report = { passed: false, source: {}, plays: [], exclusions: [], errors, errorCount: 0 };
  let raw;
  try { raw = fs.readFileSync(sourceFile); }
  catch (error) {
    errors.push({ code: 'source-read', message: error.message });
    report.errorCount = 1; return report;
  }
  const sha256 = crypto.createHash('sha256').update(raw).digest('hex');
  const inventory = sourceInventory(raw.toString('utf8'), sha256);
  report.source = { sourceFile: path.basename(sourceFile), sha256, bytes: raw.length, chapterCount: inventory.chapterCount, playCount: inventory.works.length };
  report.exclusions = inventory.exclusions;
  errors.push(...inventory.errors.slice(0, MAX_ERRORS));
  report.errorCount = inventory.errors.length;
  if (path.basename(sourceFile) === 'pg100-images.html' && report.source.sha256 !== PINNED_SHA256) {
    report.errorCount += 1;
    errors.push({ code: 'source-checksum', message: 'pg100-images.html differs from the approved immutable raw source SHA-256.' });
  }
  const playsRoot = path.join(candidateRoot || '', 'data', 'plays');
  const versions = [];
  const plays = new Map();
  for (const work of inventory.works) {
    const finding = { id: work.id, anchor: work.anchor, passed: false, errors: work.errors.slice(0, MAX_ERRORS), errorCount: work.errors.length };
    report.plays.push(finding);
    const add = (code, message, location) => {
      const error = { code, workId: work.id, message, ...(location ? { location } : {}) };
      finding.errorCount += 1;
      report.errorCount += 1;
      if (finding.errors.length < MAX_ERRORS) finding.errors.push(error);
      if (errors.length < MAX_ERRORS) errors.push(error);
    };
    const playFile = path.join(playsRoot, work.id, 'play.json');
    if (!fs.existsSync(playFile)) add('missing-play', `Missing ${playFile}.`);
    else {
      const result = checkPlay({ work, playFile, source: report.source, add });
      const { play, ...counts } = result;
      Object.assign(finding, counts);
      if (play) plays.set(work.id, play);
      if (typeof play?.contentVersion === 'string' && play.contentVersion) versions.push({ workId: work.id, contentVersion: play.contentVersion });
    }
    finding.passed = finding.errorCount === 0;
  }
  if (fs.existsSync(playsRoot)) for (const entry of fs.readdirSync(playsRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && !WORK_IDS.includes(entry.name)) {
      report.errorCount += 1;
      if (errors.length < MAX_ERRORS) errors.push({ code: 'extra-play', message: `Unexpected candidate play directory ${entry.name}.` });
    }
  }
  if (versions.length === WORK_IDS.length) report.sourceOrderVersion = computeCollectionVersion(versions);
  const catalog = checkCatalog({ candidateRoot: candidateRoot || '', plays, add: (code, message) => {
    report.errorCount += 1;
    if (errors.length < MAX_ERRORS) errors.push({ code, message });
  } });
  if (catalog.collectionVersion) report.collectionVersion = catalog.collectionVersion;
  report.passed = report.errorCount === 0;
  return report;
}

function runCli(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--source') options.sourceFile = argv[++index];
    else if (argv[index] === '--candidate') options.candidateRoot = argv[++index];
    else if (argv[index] === '--report') options.reportFile = argv[++index];
    else if (argv[index] !== '--strict') throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!options.sourceFile || !options.candidateRoot) throw new Error('Usage: node scripts/validateGutenbergFidelity.js --source FILE --candidate ROOT [--report FILE] --strict');
  const report = validateCollection(options);
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (options.reportFile) fs.writeFileSync(options.reportFile, output);
  else process.stdout.write(output);
  if (!report.passed) process.exitCode = 1;
}

module.exports = { validateCollection };
if (require.main === module) {
  try { runCli(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
