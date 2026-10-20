const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repository = path.resolve(__dirname, '../..');
const assetsRoot = path.join(repository, 'assets/reader-fonts');
const definitions = [
  { assetModule: 11, weight: 400, style: 'normal' },
  { assetModule: 12, weight: 400, style: 'italic' },
  { assetModule: 13, weight: 700, style: 'normal' },
  { assetModule: 14, weight: 700, style: 'italic' },
];

function loaderFactory() {
  const file = path.join(repository, 'reader/fontLoader.js');
  const exported = fs.existsSync(file) ? require(file) : {};
  assert.equal(typeof exported.createFontLoader, 'function', 'the injected reader font loader must exist');
  return exported.createFontLoader;
}

function makeLoader(overrides = {}) {
  const resolves = [];
  const reads = [];
  const loadReaderFont = loaderFactory()({
    assets: { literata: definitions, 'source-serif-4': definitions.map(face => ({ ...face, assetModule: face.assetModule + 10 })) },
    resolveAsset: async assetModule => { resolves.push(assetModule); return `file:///font-${assetModule}.ttf`; },
    readBase64: async uri => { reads.push(uri); return 'AA=='; },
    ...overrides,
  });
  return { loadReaderFont, resolves, reads };
}

test('font loader resolves only the selected four local faces and shares its family promise', async () => {
  const h = makeLoader();
  const first = h.loadReaderFont('literata');
  assert.equal(h.loadReaderFont('literata'), first, 'concurrent requests share exactly one family promise');
  const result = await first;
  assert.deepEqual(result, { fontId: 'literata', faces: definitions.map(({ weight, style }) => ({ weight, style, data: 'AA==' })) });
  assert.deepEqual(h.resolves, [11, 12, 13, 14], 'no unselected family is loaded');
  assert.deepEqual(h.reads, [11, 12, 13, 14].map(id => `file:///font-${id}.ttf`));
  assert.equal(h.loadReaderFont('literata'), first, 'successful family promise remains cached');
});

test('font loader rejects unknown and inherited family names without touching assets', async () => {
  const h = makeLoader();
  for (const id of ['unknown', 'toString', '__proto__', '', null, undefined]) await assert.rejects(h.loadReaderFont(id), /unknown.*font/i);
  assert.deepEqual(h.resolves, []);
  assert.deepEqual(h.reads, []);
});

test('font loader rejects missing downloaded URI and evicts failure for retry', async () => {
  for (const uri of [null, undefined, '', '   ']) {
    let available = false;
    const h = makeLoader({ resolveAsset: async id => available ? `file:///font-${id}.ttf` : uri });
    await assert.rejects(h.loadReaderFont('literata'), /local.*uri/i);
    assert.deepEqual(h.reads, [], 'missing URI is never passed to the filesystem');
    available = true;
    assert.equal((await h.loadReaderFont('literata')).faces.length, 4);
  }
});

test('font loader rejects invalid or oversized base64 and permits retry', async () => {
  for (const data of ['', null, 'bad!', 'A', 'AA=A', 'AB==', 'AAB=', 'AA==\n', 'A'.repeat(2 * 1024 * 1024 + 4)]) {
    let repaired = false;
    const h = makeLoader({ readBase64: async () => repaired ? 'AA==' : data });
    await assert.rejects(h.loadReaderFont('literata'), /base64/i);
    repaired = true;
    assert.equal((await h.loadReaderFont('literata')).faces[0].data, 'AA==');
  }
});

test('font loader rejects asset and filesystem failures and retries the family', async () => {
  for (const boundary of ['resolveAsset', 'readBase64']) {
    let failed = true;
    let attempts = 0;
    const h = makeLoader({ [boundary]: async value => {
      attempts += 1;
      if (failed) throw new Error(`${boundary} failed`);
      return boundary === 'resolveAsset' ? `file:///font-${value}.ttf` : 'AA==';
    } });
    await assert.rejects(h.loadReaderFont('literata'), new RegExp(`${boundary} failed`));
    failed = false;
    assert.equal((await h.loadReaderFont('literata')).faces.length, 4);
    assert.ok(attempts >= 8, 'a failed family does not retain a poisoned cache promise');
  }
});

test('font loader bounds the entire family to five seconds and late work cannot replace retry', async () => {
  const timers = [];
  const cleared = [];
  let stuck = true;
  const pending = [];
  const h = makeLoader({
    resolveAsset: id => stuck ? new Promise(resolve => pending.push(() => resolve(`file:///old-${id}.ttf`))) : Promise.resolve(`file:///new-${id}.ttf`),
    setTimeoutFn: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    clearTimeoutFn: id => cleared.push(id),
  });
  const first = h.loadReaderFont('literata');
  const failed = assert.rejects(first, /timed out/i);
  assert.equal(timers[0].delay, 5000);
  timers[0].callback();
  await failed;
  stuck = false;
  const retry = h.loadReaderFont('literata');
  assert.notEqual(retry, first);
  const result = await retry;
  pending.forEach(resolve => resolve());
  await Promise.resolve();
  assert.equal(h.loadReaderFont('literata'), retry, 'late completion cannot poison the newer successful cache');
  assert.equal(result.fontId, 'literata');
  assert.ok(cleared.includes(2), 'successful family clears its timeout');
});

test('font loader keeps family results independent when requests finish out of order', async () => {
  const pending = new Map();
  const h = makeLoader({ resolveAsset: id => new Promise(resolve => pending.set(id, resolve)) });
  const first = h.loadReaderFont('literata');
  const second = h.loadReaderFont('source-serif-4');
  for (const id of [21, 22, 23, 24]) pending.get(id)(`file:///font-${id}.ttf`);
  assert.equal((await second).fontId, 'source-serif-4');
  for (const id of [11, 12, 13, 14]) pending.get(id)(`file:///font-${id}.ttf`);
  assert.equal((await first).fontId, 'literata');
  assert.equal(h.loadReaderFont('literata'), first);
  assert.equal(h.loadReaderFont('source-serif-4'), second);
});

function loadPlatformAdapter(platform, overrides) {
  const file = path.join(repository, `reader/readerFonts.${platform}.js`);
  const module = { exports: {} };
  const dependencies = {
    './fontAssets': { FONT_ASSETS: { literata: definitions } },
    './fontLoader': require('../../reader/fontLoader'),
    ...overrides.dependencies,
  };
  const context = {
    setTimeout, clearTimeout, URL,
    ...overrides.globals,
  };
  vm.runInNewContext('(function(require,module,exports){' + fs.readFileSync(file, 'utf8') + '\n})', context)(request => {
    assert.ok(Object.hasOwn(dependencies, request), `unexpected adapter dependency ${request}`);
    return dependencies[request];
  }, module, module.exports);
  return module.exports.loadReaderFont;
}

test('native adapter reads downloaded local assets as base64 through the installed SDK interfaces', async () => {
  const downloaded = [];
  const read = [];
  const loadReaderFont = loadPlatformAdapter('native', { dependencies: {
    'expo-asset': { Asset: { fromModule(id) { return {
      localUri: null,
      async downloadAsync() { downloaded.push(id); this.localUri = `file:///native-${id}.ttf`; return this; },
    }; } } },
    'expo-file-system': {
      EncodingType: { Base64: 'base64' },
      async readAsStringAsync(uri, options) {
        assert.equal(options.encoding, 'base64');
        assert.ok(downloaded.includes(Number(uri.match(/native-(\d+)/)[1])), 'download finishes before local bytes are read');
        read.push(uri);
        return 'AAEC/w==';
      },
    },
  } });
  const result = await loadReaderFont('literata');
  assert.equal(result.fontId, 'literata');
  assert.deepEqual(result.faces.map(face => face.data), ['AAEC/w==', 'AAEC/w==', 'AAEC/w==', 'AAEC/w==']);
  assert.deepEqual(downloaded, [11, 12, 13, 14]);
  assert.deepEqual(read, [11, 12, 13, 14].map(id => `file:///native-${id}.ttf`));
  await loadReaderFont('literata');
  assert.equal(read.length, 4, 'adapter retains the family cache');
});

test('web adapter fetches only same-origin bundled asset URLs and converts exact bytes without Node APIs', async () => {
  const requests = [];
  const loadReaderFont = loadPlatformAdapter('web', {
    dependencies: { 'expo-asset': { Asset: { fromModule: id => ({ uri: `/assets/font-${id}.ttf` }) } } },
    globals: {
      window: { location: { href: 'https://reader.local/app', origin: 'https://reader.local' } },
      async fetch(uri, options) { requests.push([uri, options]); return { ok: true, arrayBuffer: async () => Uint8Array.from([0, 1, 2, 255]).buffer }; },
      btoa: binary => Buffer.from(binary, 'binary').toString('base64'),
    },
  });
  const result = await loadReaderFont('literata');
  assert.equal(result.fontId, 'literata');
  assert.deepEqual(result.faces.map(face => face.data), ['AAEC/w==', 'AAEC/w==', 'AAEC/w==', 'AAEC/w==']);
  assert.deepEqual(requests.map(([uri]) => uri), [11, 12, 13, 14].map(id => `https://reader.local/assets/font-${id}.ttf`));
  for (const [, options] of requests) {
    assert.equal(options.redirect, 'error', 'bundled assets cannot redirect to a font service');
    assert.equal(options.credentials, 'same-origin');
  }
});

test('web adapter rejects remote and executable font asset URLs before fetching', async () => {
  for (const uri of ['https://cdn.example/font.ttf', 'data:font/ttf;base64,AA==', 'javascript:alert(1)', 'file:///font.ttf', '']) {
    let fetched = false;
    const loadReaderFont = loadPlatformAdapter('web', {
      dependencies: { 'expo-asset': { Asset: { fromModule: () => ({ uri }) } } },
      globals: {
        window: { location: { href: 'https://reader.local/app', origin: 'https://reader.local' } },
        async fetch() { fetched = true; throw new Error('unexpected fetch'); },
      },
    });
    await assert.rejects(loadReaderFont('literata'), /(?:bundled local asset|local URI)/i);
    assert.equal(fetched, false, 'untrusted URLs never reach the browser network boundary');
  }
});

function readAssetMap() {
  const file = path.join(repository, 'reader/fontAssets.js');
  assert.ok(fs.existsSync(file), 'the Metro asset map must exist');
  const source = fs.readFileSync(file, 'utf8');
  const module = { exports: {} };
  const imports = [];
  const localRequire = request => {
    assert.ok(request.endsWith('.ttf'), 'asset map imports local font files only');
    const absolute = path.resolve(path.dirname(file), request);
    assert.ok(absolute.startsWith(assetsRoot + path.sep), 'font map stays within its bundled asset directory');
    assert.ok(fs.existsSync(absolute), 'every Metro font import exists');
    imports.push(absolute);
    return absolute;
  };
  vm.runInNewContext('(function(require,module,exports){' + source + '\n})', {})(localRequire, module, module.exports);
  return { assets: module.exports.FONT_ASSETS, imports };
}

function glyphFor(buffer, codePoint) {
  const tables = buffer.readUInt16BE(4);
  let cmap;
  for (let index = 0; index < tables; index += 1) {
    const offset = 12 + index * 16;
    if (buffer.toString('ascii', offset, offset + 4) === 'cmap') cmap = buffer.readUInt32BE(offset + 8);
  }
  assert.notEqual(cmap, undefined, 'TTF has cmap table');
  for (let index = 0; index < buffer.readUInt16BE(cmap + 2); index += 1) {
    const record = cmap + 4 + index * 8;
    const platform = buffer.readUInt16BE(record);
    const encoding = buffer.readUInt16BE(record + 2);
    if (!(platform === 0 || (platform === 3 && [1, 10].includes(encoding)))) continue;
    const sub = cmap + buffer.readUInt32BE(record + 4);
    const format = buffer.readUInt16BE(sub);
    if (format === 12) {
      const groups = buffer.readUInt32BE(sub + 12);
      for (let group = 0; group < groups; group += 1) {
        const at = sub + 16 + group * 12;
        const start = buffer.readUInt32BE(at);
        const end = buffer.readUInt32BE(at + 4);
        if (codePoint >= start && codePoint <= end) return buffer.readUInt32BE(at + 8) + codePoint - start;
      }
    } else if (format === 4 && codePoint <= 0xffff) {
      const segments = buffer.readUInt16BE(sub + 6) / 2;
      const ends = sub + 14;
      const starts = ends + segments * 2 + 2;
      const deltas = starts + segments * 2;
      const offsets = deltas + segments * 2;
      for (let segment = 0; segment < segments; segment += 1) {
        const end = buffer.readUInt16BE(ends + segment * 2);
        const start = buffer.readUInt16BE(starts + segment * 2);
        if (codePoint < start || codePoint > end) continue;
        const delta = buffer.readInt16BE(deltas + segment * 2);
        const range = buffer.readUInt16BE(offsets + segment * 2);
        if (!range) return (codePoint + delta) & 0xffff;
        const glyph = buffer.readUInt16BE(offsets + segment * 2 + range + (codePoint - start) * 2);
        return glyph ? (glyph + delta) & 0xffff : 0;
      }
    }
  }
  return 0;
}

test('all twelve pinned reader faces and three OFL notices match recorded bytes and hashes', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(assetsRoot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.assets.filter(asset => asset.kind === 'license').length, 3);
  const faces = manifest.assets.filter(asset => asset.kind !== 'license');
  assert.equal(faces.length, 12);
  assert.equal(faces.reduce((total, asset) => total + asset.bytes, 0), 3681220);
  for (const asset of manifest.assets) {
    const buffer = fs.readFileSync(path.join(assetsRoot, asset.path));
    assert.equal(buffer.length, asset.bytes, asset.path);
    assert.equal(crypto.createHash('sha256').update(buffer).digest('hex'), asset.sha256, asset.path);
    assert.match(asset.url, /^https:\/\/raw\.githubusercontent\.com\/(?:adobe-fonts\/(?:source-serif\/4\.005R|source-sans\/3\.052R)|googlefonts\/literata\/3\.103)\//, 'source is a pinned upstream release');
    if (asset.kind === 'license') assert.match(buffer.toString('utf8'), /SIL OPEN FONT LICENSE Version 1\.1/i);
  }
  const { assets, imports } = readAssetMap();
  assert.deepEqual(Object.keys(assets).sort(), ['literata', 'source-sans-3', 'source-serif-4']);
  assert.equal(new Set(imports).size, 12);
  for (const [fontId, actual] of Object.entries(assets)) {
    const expected = faces.filter(face => face.family === fontId);
    assert.deepEqual(Array.from(actual, face => ({ path: path.relative(assetsRoot, face.assetModule).replaceAll('\\', '/'), weight: face.weight, style: face.style })), expected.map(face => ({ path: face.path, weight: face.weight, style: face.style })));
  }
});

test('all bundled faces map French accents, NBSP, smart quotes and dash characters to nonzero glyphs', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(assetsRoot, 'manifest.json'), 'utf8'));
  const required = [0x00c7, 0x00e7, 0x00c9, 0x00e9, 0x00a0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2013, 0x2014];
  for (const asset of manifest.assets.filter(asset => asset.kind !== 'license')) {
    const buffer = fs.readFileSync(path.join(assetsRoot, asset.path));
    for (const codePoint of required) assert.ok(glyphFor(buffer, codePoint) > 0, `${asset.path}: nonzero glyph U+${codePoint.toString(16).toUpperCase()}`);
  }
});

test('every bundled face covers the complete printable glyph inventory of the 38 canonical plays', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(repository, 'data/manifest.json'), 'utf8'));
  const codePoints = new Set();
  for (const reference of catalog.plays) {
    const playFile = path.resolve(repository, 'data', reference.play);
    const play = JSON.parse(fs.readFileSync(playFile, 'utf8'));
    for (const ref of play.sections) {
      const section = JSON.parse(fs.readFileSync(path.resolve(path.dirname(playFile), ref.path), 'utf8'));
      for (const block of section.content) for (const character of block.text) codePoints.add(character.codePointAt(0));
    }
  }
  const printable = Array.from(codePoints).filter(codePoint => codePoint >= 32 && codePoint !== 127);
  const manifest = JSON.parse(fs.readFileSync(path.join(assetsRoot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.coverage.corpus.works, catalog.plays.length);
  assert.equal(manifest.coverage.corpus.distinctCodePoints, codePoints.size);
  assert.equal(manifest.coverage.corpus.printableCodePoints, printable.length);
  for (const asset of manifest.assets.filter(asset => asset.kind !== 'license')) {
    const buffer = fs.readFileSync(path.join(assetsRoot, asset.path));
    for (const codePoint of printable) assert.ok(glyphFor(buffer, codePoint) > 0, `${asset.path}: corpus glyph U+${codePoint.toString(16).toUpperCase()}`);
    const coverage = manifest.coverage.corpus.faces.find(face => face.path === asset.path);
    assert.equal(coverage.coveredCodePoints, printable.length);
    assert.deepEqual(coverage.missingCodePoints, []);
  }
});
