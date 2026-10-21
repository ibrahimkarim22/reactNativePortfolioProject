// Read-only preservation check. All inputs are versioned; no .expo dependency.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '../..');
const base = 'c4fe0e5b60fe7c3e17089b106a71d4775146a795';
const baselineHead = '19e20a38bd5c8394ff213ce4e4aecbbcdd425c6a';
const collectionVersion = '8edeb3e4395f126c5844d4c395b151b1e291653a78396d3b55908e90ef627f32';
const sourceSHA256 = 'd7116e381ba4f0164ba059f6d0e135e07af068b4ab486b57fa7deec6a305d5c3';
const read = file => fs.readFileSync(path.join(root, file));
const json = file => JSON.parse(read(file).toString('utf8'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const git = (...args) => cp.execFileSync('git', ['-c', `safe.directory=${root.replace(/\\/g, '/')}`, ...args], { cwd: root });

const baseline = json('tests/fixtures/content-preservation.json');
assert.equal(baseline.head, baselineHead);
assert.equal(baseline.files.length, 1286);
assert.equal(new Set(baseline.files.map(file => file.path)).size, 1286);
const mismatches = [];
for (const file of baseline.files) {
  assert.ok(/^(data\/[a-zA-Z0-9_./-]+|shared\/localPlayRegistry\.js)$/.test(file.path));
  assert.ok(!file.path.split('/').includes('..'));
  assert.ok(Number.isSafeInteger(file.bytes) && file.bytes >= 0);
  assert.match(file.sha256, /^[a-f0-9]{64}$/);
  const bytes = read(file.path);
  if (bytes.length !== file.bytes || sha(bytes) !== file.sha256) mismatches.push(file.path);
}
assert.deepEqual(mismatches, [], 'Historical raw working bytes differ; no newline normalization is performed');

const manifest = json('data/manifest.json');
const expected = baseline.versions;
assert.equal(expected.length, 38);
assert.equal(manifest.plays.length, 38);
assert.equal(new Set(expected.map(play => play.workId)).size, 38);
assert.equal(new Set(manifest.plays.map(play => play.id)).size, 38);
const versionMismatches = expected.filter(version => {
  const entry = manifest.plays.find(play => play.id === version.workId);
  return !entry || [entry, json(path.posix.join('data', entry.play))].some(play =>
    play.contentVersion !== version.contentVersion || play.canonicalTextVersion !== version.canonicalTextVersion);
});
assert.deepEqual(versionMismatches, []);
assert.equal(manifest.contentVersion, collectionVersion);
assert.equal(sha(read('data/source/pg100-images.html')), sourceSHA256);

const expectedLicenses = new Map([
  ['assets/reader-fonts/literata/OFL.txt', [4389, '8742963604cd89dc81437811a850018fc03b2bfad686d7422c8235967c87614e']],
  ['assets/reader-fonts/source-sans-3/LICENSE.md', [4579, '89ad2c4f66dd29127527493e729c31e731f111cf10faf5774c3db9275ed0c22c']],
  ['assets/reader-fonts/source-serif-4/LICENSE.md', [4492, '75784a295293a8992f5a8d99210566e0064a012e6dab6731305e3787f15896c7']],
]);
const licenseAssets = json('assets/reader-fonts/manifest.json').assets.filter(asset => asset.kind === 'license');
assert.equal(licenseAssets.length, 3);
const licenses = licenseAssets.map(asset => {
  const file = `assets/reader-fonts/${asset.path}`, original = expectedLicenses.get(file), bytes = read(file);
  assert.ok(original);
  assert.deepEqual([asset.bytes, asset.sha256], original);
  const originalBytesMatch = bytes.length === original[0] && sha(bytes) === original[1] &&
    bytes.equals(git('show', `${base}:${file}`)) && bytes.equals(git('show', `HEAD:${file}`)) && bytes.equals(git('show', `:${file}`));
  assert.ok(originalBytesMatch, file);
  return { path: file, bytes: bytes.length, sha256: sha(bytes), originalBytesMatch };
});
const branch = git('branch', '--show-current').toString().trim();
const currentHead = git('rev-parse', 'HEAD').toString().trim();
git('merge-base', '--is-ancestor', base, 'HEAD');
const protectedPaths = ['data', 'shared/localPlayRegistry.js', 'shared/contentText.js', 'assets', '.gitattributes',
  'package.json', 'package-lock.json', 'app.json', 'app.config.js', 'babel.config.js', 'metro.config.js'];
const immutableDiff = git('diff', base, '--name-only', '--', ...protectedPaths).toString().trim();
const protectedIndexDiff = git('diff', '--cached', base, '--name-only', '--', ...protectedPaths).toString().trim();
assert.equal(immutableDiff, '');
assert.equal(protectedIndexDiff, '');
console.log(JSON.stringify({ branch, developmentBase: base, currentHead, preservationBaseline: baseline.head,
  protectedFiles: baseline.files.length, unchangedFiles: baseline.files.length, mismatches,
  versionsChecked: expected.length, versionMismatches, collectionVersion, sourceSHA256, licenses,
  immutableDiff, protectedIndexDiff }, null, 2));
