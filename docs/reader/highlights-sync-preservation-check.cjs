// Read-only synchronization preservation check. Inputs are committed files and
// the explicit milestone base; this command has no dependency on .expo helpers.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '../..');
const base = '9795ab85551ad08d3f11dd152038766211f9c202';
const baselineHead = '19e20a38bd5c8394ff213ce4e4aecbbcdd425c6a';
const collectionVersion = '8edeb3e4395f126c5844d4c395b151b1e291653a78396d3b55908e90ef627f32';
const sourceSHA256 = 'd7116e381ba4f0164ba059f6d0e135e07af068b4ab486b57fa7deec6a305d5c3';
const allowedDevDependencies = Object.freeze({ '@firebase/rules-unit-testing': '5.0.0', 'firebase-tools': '14.12.1' });
const allowedScripts = Object.freeze({
  'test:highlight-sync': 'node tests/firestore/run-emulators.cjs test',
  'test:highlight-sync:clients': 'node tests/firestore/run-clients.cjs',
  'highlight-sync:emulators': 'node tests/firestore/run-emulators.cjs start',
});
const read = file => fs.readFileSync(path.join(root, file));
const json = file => JSON.parse(read(file).toString('utf8'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const git = (...args) => cp.execFileSync('git', ['-c', `safe.directory=${root.replace(/\\/g, '/')}`, ...args], { cwd: root });
const baseJson = file => JSON.parse(git('show', `${base}:${file}`).toString('utf8'));

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
assert.equal(branch, 'feature/reader-interactions');
git('merge-base', '--is-ancestor', base, 'HEAD');
// Packages are not exempted: their exact permitted additions are asserted below.
const protectedPaths = ['data', 'shared', 'assets', '.gitattributes', 'firebaseConfig.js',
  'app.json', 'app.config.js', 'babel.config.js', 'metro.config.js'];
const immutableDiff = git('diff', base, '--name-only', '--', ...protectedPaths).toString().trim();
const protectedIndexDiff = git('diff', '--cached', base, '--name-only', '--', ...protectedPaths).toString().trim();
const protectedUntracked = git('ls-files', '--others', '--exclude-standard', '--', ...protectedPaths).toString().trim();
assert.equal(immutableDiff, '');
assert.equal(protectedIndexDiff, '');
assert.equal(protectedUntracked, '', 'No untracked source, canonical, font or application configuration additions are permitted');
assert.equal(git('diff', '--cached', '--name-only').toString().trim(), '', 'This uncommitted milestone must not stage any work');

const originalPackage = baseJson('package.json');
const actualPackage = json('package.json');
const expectedPackage = {
  ...originalPackage,
  scripts: { ...originalPackage.scripts, ...allowedScripts },
  devDependencies: { ...originalPackage.devDependencies, ...allowedDevDependencies },
};
assert.deepEqual(actualPackage, expectedPackage, 'Only the three emulator scripts and two pinned development tools are permitted');
assert.deepEqual(actualPackage.dependencies, originalPackage.dependencies, 'Runtime declarations must remain unchanged');

const originalLock = baseJson('package-lock.json');
const actualLock = json('package-lock.json');
assert.equal(Object.keys(originalLock.packages).length, 930);
const { packages: oldPackages, ...oldLockMetadata } = originalLock;
const { packages: newPackages, ...newLockMetadata } = actualLock;
assert.deepEqual(newLockMetadata, oldLockMetadata, 'Lockfile metadata must remain unchanged');
const expectedRootPackage = { ...oldPackages[''], devDependencies: { ...oldPackages[''].devDependencies, ...allowedDevDependencies } };
assert.deepEqual(newPackages[''], expectedRootPackage);
const originalEntries = Object.keys(oldPackages).filter(file => file !== '');
assert.equal(originalEntries.length, 929);
for (const file of originalEntries) assert.deepEqual(newPackages[file], oldPackages[file], `Every original lockfile field must remain unchanged: ${file}`);
const addedPackages = Object.keys(newPackages).filter(file => !Object.prototype.hasOwnProperty.call(oldPackages, file));
for (const file of addedPackages) {
  assert.equal(newPackages[file].dev, true, `New lockfile entries must be development-only: ${file}`);
  assert.equal(typeof newPackages[file].version, 'string', file);
}
for (const [name, version] of Object.entries(allowedDevDependencies)) assert.equal(newPackages[`node_modules/${name}`].version, version);

function resolvePackage(from, name) {
  const parts = from.split('/').filter(Boolean);
  for (let length = parts.length; length >= 0; length--) {
    if (parts[length - 1] === 'node_modules') continue;
    const candidate = [...parts.slice(0, length), 'node_modules', name].join('/');
    if (newPackages[candidate]) return candidate;
  }
  return null;
}
const reachable = new Set();
const queue = Object.keys(allowedDevDependencies).map(name => `node_modules/${name}`);
while (queue.length) {
  const file = queue.pop();
  if (reachable.has(file)) continue;
  reachable.add(file);
  const entry = newPackages[file];
  for (const name of Object.keys({ ...entry.dependencies, ...entry.optionalDependencies, ...entry.peerDependencies })) {
    const dependency = resolvePackage(file, name);
    if (dependency) queue.push(dependency);
  }
}
const unreachableAdditions = addedPackages.filter(file => !reachable.has(file));
assert.deepEqual(unreachableAdditions, [], 'Every added package must be reachable from the two approved development tools');

// NormalApp is the original App moved without editing its working bytes. Its
// Git blob uses LF, while this Windows checkout produces CRLF. This one moved
// application file is checked against Git's exact configured checkout filter;
// none of the historical data or license byte assertions use normalization.
const originalAppBlob = git('show', `${base}:App.js`);
const originalAppCheckout = git('cat-file', '--filters', `${base}:App.js`);
const normalAppBytes = read('NormalApp.js');
assert.ok(normalAppBytes.equals(originalAppCheckout), 'NormalApp must preserve the original App checkout bytes exactly');
assert.ok(Buffer.from(normalAppBytes.toString('utf8').replace(/\r\n/g, '\n')).equals(originalAppBlob), 'NormalApp may differ from the original blob only by checkout LF/CRLF conversion');

console.log(JSON.stringify({ branch, developmentBase: base, currentHead, preservationBaseline: baseline.head,
  protectedFiles: baseline.files.length, unchangedFiles: baseline.files.length, mismatches,
  versionsChecked: expected.length, versionMismatches, collectionVersion, sourceSHA256, licenses,
  immutableDiff, protectedIndexDiff, protectedUntracked,
  packages: { permittedDevDependencies: allowedDevDependencies, permittedScripts: allowedScripts,
    runtimeDeclarationsUnchanged: true, originalLockEntriesChecked: Object.keys(oldPackages).length,
    originalNonRootLockEntriesAllFieldsUnchanged: originalEntries.length,
    originalRootLockVersionUnchanged: newPackages[''].version === oldPackages[''].version,
    newDevelopmentOnlyEntries: addedPackages.length, newRuntimeEntries: 0, unreachableAdditions },
  normalApp: { originalBlobBytes: originalAppBlob.length, originalBlobSHA256: sha(originalAppBlob),
    originalCheckoutBytes: originalAppCheckout.length, originalCheckoutSHA256: sha(originalAppCheckout),
    movedWorkingBytes: normalAppBytes.length, movedWorkingSHA256: sha(normalAppBytes), exactCheckoutBytesMatch: true,
    explanation: 'Only NormalApp is compared with Git checkout filters; the original LF blob is CRLF in this Windows checkout. Historical source/data/license bytes are compared raw.' },
}, null, 2));
