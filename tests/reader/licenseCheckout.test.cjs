const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repository = path.resolve(__dirname, '../..');
const licensePaths = [
  'assets/reader-fonts/literata/OFL.txt',
  'assets/reader-fonts/source-sans-3/LICENSE.md',
  'assets/reader-fonts/source-serif-4/LICENSE.md',
];
const temporaryPrefix = 'bard-license-checkout-';

test('autocrlf checkout preserves the original bytes and manifest hashes of all three font licenses', () => {
  const temporaryParent = fs.realpathSync(os.tmpdir());
  const temporary = fs.mkdtempSync(path.join(temporaryParent, temporaryPrefix));
  try {
    const emptyConfig = path.join(temporary, 'empty-config');
    fs.writeFileSync(emptyConfig, '');
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig, GIT_ATTR_NOSYSTEM: '1' });
    const git = (cwd, args, input) => execFileSync('git', [
      '-c', `safe.directory=${cwd.replaceAll('\\', '/')}`,
      '-c', 'core.autocrlf=true',
      '-c', `core.attributesFile=${emptyConfig}`,
      ...args,
    ], { cwd, env, input, windowsHide: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(repository, 'assets/reader-fonts/manifest.json'), 'utf8'));
    const originals = licensePaths.map(file => {
      const asset = manifest.assets.find(entry => `assets/reader-fonts/${entry.path}` === file && entry.kind === 'license');
      assert.ok(asset, `manifest records ${file}`);
      const bytes = git(repository, ['cat-file', 'blob', `HEAD:${file}`]);
      assert.equal(bytes.length, asset.bytes, `original Git blob byte count: ${file}`);
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), asset.sha256, `original Git blob hash: ${file}`);
      return { file, asset, bytes };
    });
    const attributesPath = path.join(repository, '.gitattributes');
    const attributes = fs.existsSync(attributesPath) ? fs.readFileSync(attributesPath, 'utf8') : '';
    const withoutLicenseRules = attributes.split(/\r?\n/).filter(line => {
      const [pattern, ...settings] = line.trim().split(/\s+/);
      return !(licensePaths.includes(pattern.replace(/^\//, '')) && settings.includes('-text'));
    }).join('\n');

    function checkout(name, rules) {
      const directory = path.join(temporary, name);
      fs.mkdirSync(directory);
      git(directory, ['init', '--quiet', '--template=']);
      fs.writeFileSync(path.join(directory, '.gitattributes'), rules);
      for (const { file, bytes } of [...originals, { file: '.gitattributes', bytes: Buffer.from(rules) }]) {
        const objectId = git(directory, ['hash-object', '-w', '--no-filters', '--stdin'], bytes).toString('ascii').trim();
        git(directory, ['update-index', '--add', '--cacheinfo', `100644,${objectId},${file}`]);
      }
      const output = path.join(temporary, `${name}-checkout`);
      fs.mkdirSync(output);
      git(directory, ['checkout-index', '--all', `--prefix=${output.replaceAll('\\', '/')}/`]);
      return file => fs.readFileSync(path.join(output, file));
    }

    // Prove the fixture exercises autocrlf: both original LF notices change without their rules.
    const unprotected = checkout('unprotected', withoutLicenseRules);
    for (const original of originals.filter(({ file }) => file !== licensePaths[1])) {
      const bytes = unprotected(original.file);
      assert.ok(!original.bytes.includes(Buffer.from('\r\n')), `negative control starts with LF: ${original.file}`);
      assert.ok(bytes.includes(Buffer.from('\r\n')), `negative control produces CRLF: ${original.file}`);
      assert.notDeepEqual(bytes, original.bytes, `negative control changes bytes: ${original.file}`);
    }

    const protectedCheckout = checkout('protected', attributes);
    for (const { file, asset, bytes: original } of originals) {
      const bytes = protectedCheckout(file);
      assert.equal(bytes.length, asset.bytes, `checkout preserves manifest byte count: ${file}`);
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), asset.sha256, `checkout preserves manifest hash: ${file}`);
      assert.deepEqual(bytes, original, `checkout preserves the original Git blob: ${file}`);
    }
  } finally {
    const resolved = fs.realpathSync(temporary);
    assert.equal(path.dirname(resolved), temporaryParent, 'cleanup stays directly inside the temporary directory');
    assert.ok(path.basename(resolved).startsWith(temporaryPrefix), 'cleanup targets this test fixture');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
