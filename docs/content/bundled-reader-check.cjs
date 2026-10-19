// Read-only integration check of the promoted runtime registry and service.
// Usage from any directory: node <repo>/docs/content/bundled-reader-check.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const cheerio = require('cheerio');

const root = path.resolve(__dirname, '../..');
const { buildCanonicalDocument } = require(path.join(root, 'shared/contentText'));
const registryFile = path.join(root, 'shared/localPlayRegistry.js');
const actualRequire = createRequire(registryFile);
let imageImports = 0;
let jsonImports = 0;
const requireRegistry = request => {
  // Native asset loaders are the only boundary replaced: all JSON is real.
  if (/\.(png|jpg)$/i.test(request)) { imageImports += 1; return request; }
  assert.ok(request.endsWith('.json'), 'Only runtime JSON and image imports are expected.');
  jsonImports += 1;
  return actualRequire(request);
};
const registryCode = fs.readFileSync(registryFile, 'utf8')
  .replace('export default LOCAL_PLAY_DATA;', 'return LOCAL_PLAY_DATA;');
const entries = vm.runInThisContext('(function(require){' + registryCode + '\n})')(requireRegistry);
const serviceFile = path.join(root, 'shared/localPlayService.js');
const serviceCode = fs.readFileSync(serviceFile, 'utf8')
  .replace(/import LOCAL_PLAY_DATA from [^;]+;/, 'const LOCAL_PLAY_DATA = entries;')
  .replace(/export const (\w+)/g, 'const $1');
const service = vm.runInThisContext('(function(require,entries){' + serviceCode + '\nreturn {getCharactersHtml,getFullPlayHtml};})')(createRequire(serviceFile), entries);

// Independent rendered DOM traversal: paragraphs/headings contribute two LF,
// BR contributes one LF, and serialized cell TAB separators remain intact.
const blockTags = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'blockquote']);
function project(html) {
  const $ = cheerio.load('<main>' + html + '</main>');
  function read(node) {
    if (node.type === 'text') return node.data;
    if (node.name === 'br') return '\n';
    return (node.children || []).map(read).join('') + (blockTags.has(node.name) ? '\n\n' : '');
  }
  const nodes = $('main').contents().toArray();
  const result = nodes.map(read).join('');
  return blockTags.has(nodes.at(-1)?.name) ? result.slice(0, -2) : result;
}

const totals = { entries: entries.length, sections: 0, ordinaryScenes: 0, blocks: 0, canonicalUTF16: 0, emptyCharacterPrefixes: 0, exactReaderMatches: 0, imageImports, jsonImports };
assert.equal(entries.length, 38);
for (const entry of entries) {
  const prefix = service.getCharactersHtml(entry.slug);
  assert.equal(prefix, '', entry.slug + ': canonical cast duplication');
  const canonical = buildCanonicalDocument({ play: entry.play, sections: entry.sections });
  const rendered = project(prefix + service.getFullPlayHtml(entry.slug));
  if (rendered !== canonical.text) {
    let offset = 0;
    while (offset < rendered.length && offset < canonical.text.length && rendered[offset] === canonical.text[offset]) offset += 1;
    assert.fail(entry.slug + ': promoted reader text diverges at UTF-16 offset ' + offset);
  }
  totals.sections += entry.sections.length;
  totals.ordinaryScenes += entry.scenes.length;
  totals.blocks += canonical.units.length;
  totals.canonicalUTF16 += canonical.text.length;
  totals.emptyCharacterPrefixes += 1;
  totals.exactReaderMatches += 1;
}
console.log(JSON.stringify(totals));
