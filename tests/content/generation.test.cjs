const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { createRequire } = require('node:module');

let api = {};
try { api = require('../../scripts/completePlayCollection'); }
catch (error) { if (error.code !== 'MODULE_NOT_FOUND' || !error.message.includes('scripts/completePlayCollection')) throw error; }
const call = (name, ...args) => {
  assert.equal(typeof api[name], 'function', `completePlayCollection must export ${name}`);
  return api[name](...args);
};
const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

function fixture(t, overrides = {}) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bard-generation-test-'));
  const stageRoots = [];
  t.after(() => {
    for (const root of [repoRoot, ...stageRoots]) {
      const resolved = path.resolve(root);
      assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()), 'test cleanup stays in its explicit temporary directory');
      assert.match(path.basename(resolved), /^bard-(?:generation-test|content-stage)-/);
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  });
  const ids = Array.from({ length: 38 }, (_, index) => 'work-' + String(index + 1).padStart(2, '0'));
  put(path.join(repoRoot, 'data/source/pg100-images.html'), '<p>technical source fixture</p>');
  put(path.join(repoRoot, 'data/manifest.json'), JSON.stringify({ plays: ids.map(id => ({ id })) }));
  put(path.join(repoRoot, 'shared/localPlayRegistry.js'), 'original registry');
  for (const id of ids) {
    put(path.join(repoRoot, 'data/plays', id, 'play.json'), JSON.stringify({ id, acts: [{ scenes: [{ path: './scenes/act-1-scene-1.json' }] }] }));
    put(path.join(repoRoot, 'data/plays', id, 'scenes/act-1-scene-1.json'), 'original scene ' + id);
    for (const support of ['characters.json', 'synopsis.json', 'quiz.json']) put(path.join(repoRoot, 'data/plays', id, support), 'protected ' + id + '/' + support);
  }
  put(path.join(repoRoot, 'data/plays', ids[0], 'scenes/act-99-scene-99.json'), 'unreferenced original must survive');
  const dependencies = {
    generateCollection({ outDir, supportRoot }) {
      const inventory = [];
      for (const id of ids) {
        const generated = {
          id, schemaVersion: '2.0.0', canonicalTextVersion: '1', contentVersion: id,
          sections: [{ id: id + '-title', path: './sections/title-1.json' }], acts: [],
        };
        put(path.join(outDir, id, 'play.json'), JSON.stringify(generated));
        put(path.join(outDir, id, 'sections/title-1.json'), JSON.stringify({ content: [{ id: id + '/p@1', text: 'technical' }] }));
        inventory.push(id + '/play.json', id + '/sections/title-1.json');
        for (const support of ['characters.json', 'synopsis.json', 'quiz.json']) {
          fs.copyFileSync(path.join(supportRoot, id, support), path.join(outDir, id, support));
        }
      }
      return { inventory, plays: ids.map(id => ({ play: { id } })), diagnostics: [] };
    },
    generateRegistry({ dataRoot, output }) {
      put(path.join(dataRoot, 'manifest.json'), JSON.stringify({ schemaVersion: '2.0.0', plays: ids.map(id => ({ id })) }));
      put(output, 'deterministic registry');
    },
    validateCollection() { return { passed: true, errorCount: 0, errors: [], plays: ids.map(id => ({ id, passed: true })) }; },
    ...overrides,
  };
  function stage() {
    const result = call('stageCollection', { repoRoot, dependencies, onStageCreated: root => stageRoots.push(root) });
    return result;
  }
  return { repoRoot, ids, dependencies, stage, stageRoots };
}
const snapshot = root => {
  const result = {};
  function walk(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) walk(file);
      else result[path.relative(root, file).replace(/\\/g, '/')] = fs.readFileSync(file).toString('base64');
    }
  }
  walk(root);
  return result;
};

test('candidate output guard rejects the production plays directory and descendants', t => {
  const fixtureData = fixture(t);
  assert.equal(typeof api.assertCandidateTarget, 'function', 'completePlayCollection must export assertCandidateTarget');
  for (const outDir of [path.join(fixtureData.repoRoot, 'data/plays'), path.join(fixtureData.repoRoot, 'data/plays/nested')]) {
    assert.throws(() => call('assertCandidateTarget', fixtureData.repoRoot, outDir), /candidate|production|temporary/i);
  }
});

test('candidate output guard resolves junction ancestors before accepting an uncreated path', t => {
  const data = fixture(t);
  const aliasRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bard-generation-test-'));
  data.stageRoots.push(aliasRoot);
  const alias = path.join(aliasRoot, 'repository-junction');
  fs.symlinkSync(data.repoRoot, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => call('assertCandidateTarget', data.repoRoot, path.join(alias, 'data/plays/uncreated')), /temporary|production|candidate/i);
});

test('actual parser refuses all in-repository output targets before extraction or writing', () => {
  const repository = path.resolve(__dirname, '../..');
  const script = path.join(repository, 'scripts/parseGutenberg.js');
  const fromScript = createRequire(script);
  const module = { exports: {} };
  const localRequire = name => name === 'parse5'
    ? { ...fromScript(name), parse() { throw new Error('extraction reached before unsafe-output guard'); } }
    : fromScript(name);
  localRequire.main = {};
  vm.runInThisContext('(function(require,module,exports,__dirname){' + fs.readFileSync(script, 'utf8') + '\n})')(localRequire, module, module.exports, path.dirname(script));
  for (const relative of ['data/plays/uncreated-child', 'data/source', 'data/source/pg100-images.html']) {
    assert.throws(() => module.exports.generateCollection({
      sourceFile: path.join(repository, 'data/source/pg100-images.html'),
      outDir: path.join(repository, relative), supportRoot: path.join(repository, 'data/plays'),
    }), /temporary|outside.*repo|in.*repo.*output|candidate.*repo/i, relative);
  }
});

test('stage produces two byte-identical fresh candidates and snapshots all 114 protected support files', t => {
  const data = fixture(t);
  const before = snapshot(data.repoRoot);
  const result = data.stage();
  assert.equal(result.passed, true);
  assert.equal(path.dirname(result.stagedRoot), path.resolve(os.tmpdir()));
  assert.equal(result.receipt.protectedFiles.filter(item => /(?:characters|synopsis|quiz)\.json$/.test(item.path)).length, 114);
  assert.equal(result.receipt.generatedFiles.length, 78);
  assert.deepEqual(snapshot(data.repoRoot), before, 'staging leaves every repository byte unchanged');
  assert.deepEqual(snapshot(path.join(result.stagedRoot, 'candidate-a')), snapshot(path.join(result.stagedRoot, 'candidate-b')));
  assert.equal(fs.existsSync(path.join(result.stagedRoot, 'receipt.json')), true);
});

test('stage refuses nondeterministic generation without a passing receipt or report', t => {
  const data = fixture(t);
  const generate = data.dependencies.generateCollection;
  let sequence = 0;
  data.dependencies.generateCollection = options => {
    const result = generate(options);
    put(path.join(options.outDir, data.ids[0], 'sections/title-1.json'), String(++sequence));
    return result;
  };
  const reportFile = path.join(data.repoRoot, 'report.json');
  assert.throws(() => call('stageCollection', { repoRoot: data.repoRoot, reportFile, dependencies: data.dependencies, onStageCreated: root => data.stageRoots.push(root) }), /determin/i);
  assert.equal(JSON.parse(fs.readFileSync(reportFile, 'utf8')).passed, false);
  assert.equal(fs.existsSync(path.join(data.stageRoots[0], 'receipt.json')), false);
});

test('stage requires a literal strict validator pass for both candidates', t => {
  const data = fixture(t, { validateCollection: () => ({ passed: 'true', errors: [] }) });
  assert.throws(() => data.stage(), /validat/i);
  assert.equal(fs.existsSync(path.join(data.stageRoots[0], 'receipt.json')), false);
  data.dependencies.validateCollection = ({ candidateRoot }) => ({ passed: path.basename(candidateRoot) !== 'candidate-b', errors: [] });
  assert.throws(() => data.stage(), /validat/i);
  assert.equal(fs.existsSync(path.join(data.stageRoots[1], 'receipt.json')), false);
});

test('stage rejects candidate support changes and unexpected generated inventory paths', t => {
  const data = fixture(t);
  const generate = data.dependencies.generateCollection;
  data.dependencies.generateCollection = options => {
    const result = generate(options);
    put(path.join(options.outDir, data.ids[0], 'characters.json'), 'changed support');
    return result;
  };
  assert.throws(() => data.stage(), /support|protected/i);
  data.dependencies.generateCollection = options => ({ ...generate(options), inventory: ['../source/pg100-images.html'] });
  assert.throws(() => data.stage(), /inventory|unsafe|generated/i);
});

test('promotion installs only explicit generated files, backs up old refs, and preserves source and support bytes', t => {
  const data = fixture(t);
  const before = snapshot(data.repoRoot);
  const staged = data.stage();
  const result = call('promoteCollection', { repoRoot: data.repoRoot, stagedRoot: staged.stagedRoot, dependencies: data.dependencies });
  assert.equal(result.passed, true);
  const after = snapshot(data.repoRoot);
  for (const [file, bytes] of Object.entries(before)) {
    if (/\/(?:characters|synopsis|quiz)\.json$/.test(file) || file === 'data/source/pg100-images.html' || file.endsWith('act-99-scene-99.json')) assert.equal(after[file], bytes, file);
  }
  assert.equal(fs.existsSync(path.join(data.repoRoot, 'data/plays', data.ids[0], 'scenes/act-1-scene-1.json')), false, 'only obsolete old referenced scenes are removed');
  assert.equal(fs.readFileSync(path.join(data.repoRoot, 'shared/localPlayRegistry.js'), 'utf8'), 'deterministic registry');
  assert.equal(fs.readFileSync(path.join(staged.stagedRoot, 'backup/shared/localPlayRegistry.js'), 'utf8'), 'original registry');
  assert.equal(fs.readFileSync(path.join(staged.stagedRoot, 'backup/data/plays', data.ids[0], 'scenes/act-1-scene-1.json'), 'utf8'), 'original scene ' + data.ids[0]);
});

test('promotion refuses changed candidate bytes before touching original files', t => {
  const data = fixture(t);
  const staged = data.stage();
  const before = snapshot(data.repoRoot);
  put(path.join(staged.stagedRoot, 'candidate-a/data/plays', data.ids[0], 'sections/title-1.json'), 'stale candidate');
  assert.throws(() => call('promoteCollection', { repoRoot: data.repoRoot, stagedRoot: staged.stagedRoot, dependencies: data.dependencies }), /candidate|receipt|changed/i);
  assert.deepEqual(snapshot(data.repoRoot), before);
});

test('promotion refuses candidate inventory additions and a changed original generated target', t => {
  const data = fixture(t);
  const staged = data.stage();
  put(path.join(staged.stagedRoot, 'candidate-a/data/plays', data.ids[0], 'sections/extra.json'), '{}');
  assert.throws(() => call('promoteCollection', { repoRoot: data.repoRoot, stagedRoot: staged.stagedRoot, dependencies: data.dependencies }), /candidate|inventory|changed/i);
  fs.unlinkSync(path.join(staged.stagedRoot, 'candidate-a/data/plays', data.ids[0], 'sections/extra.json'));
  put(path.join(data.repoRoot, 'shared/localPlayRegistry.js'), 'concurrent edit');
  const before = snapshot(data.repoRoot);
  assert.throws(() => call('promoteCollection', { repoRoot: data.repoRoot, stagedRoot: staged.stagedRoot, dependencies: data.dependencies }), /original|changed|baseline/i);
  assert.deepEqual(snapshot(data.repoRoot), before);
});

test('promotion refuses changed protected source or support files', t => {
  const data = fixture(t);
  const staged = data.stage();
  const support = path.join(data.repoRoot, 'data/plays', data.ids[0], 'quiz.json');
  put(support, 'concurrent support edit');
  const before = snapshot(data.repoRoot);
  assert.throws(() => call('promoteCollection', { repoRoot: data.repoRoot, stagedRoot: staged.stagedRoot, dependencies: data.dependencies }), /original|protected|changed|baseline/i);
  assert.deepEqual(snapshot(data.repoRoot), before);
  put(support, 'protected ' + data.ids[0] + '/quiz.json');
  put(path.join(data.repoRoot, 'data/source/pg100-images.html'), 'concurrent source edit');
  const sourceChanged = snapshot(data.repoRoot);
  assert.throws(() => call('promoteCollection', { repoRoot: data.repoRoot, stagedRoot: staged.stagedRoot, dependencies: data.dependencies }), /original|protected|changed|baseline/i);
  assert.deepEqual(snapshot(data.repoRoot), sourceChanged);
});

test('promotion revalidates staged content and refuses a failed current validator result', t => {
  const data = fixture(t);
  const staged = data.stage();
  const before = snapshot(data.repoRoot);
  data.dependencies.validateCollection = () => ({ passed: false, errors: [{ code: 'current-failure' }] });
  assert.throws(() => call('promoteCollection', { repoRoot: data.repoRoot, stagedRoot: staged.stagedRoot, dependencies: data.dependencies }), /validat/i);
  assert.deepEqual(snapshot(data.repoRoot), before);
});

test('promotion rolls back every replaced and newly created file after an install failure', t => {
  const data = fixture(t);
  const staged = data.stage();
  const before = snapshot(data.repoRoot);
  const dependencies = { ...data.dependencies, copyFile(source, target) {
    if (target === path.join(data.repoRoot, 'shared/localPlayRegistry.js')) throw new Error('controlled install failure');
    fs.copyFileSync(source, target);
  } };
  assert.throws(() => call('promoteCollection', { repoRoot: data.repoRoot, stagedRoot: staged.stagedRoot, dependencies }), /controlled install failure/);
  assert.deepEqual(snapshot(data.repoRoot), before, 'rollback restores original bytes and removes only new generated files');
});

test('promotion rejects receipt edits before interpreting any unsafe target paths', t => {
  const data = fixture(t);
  const staged = data.stage();
  const receiptFile = path.join(staged.stagedRoot, 'receipt.json');
  const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
  receipt.generatedFiles[0].path = 'data/source/pg100-images.html';
  put(receiptFile, JSON.stringify(receipt));
  const before = snapshot(data.repoRoot);
  assert.throws(() => call('promoteCollection', { repoRoot: data.repoRoot, stagedRoot: staged.stagedRoot, dependencies: data.dependencies }), /receipt|unsafe|inventory/i);
  assert.deepEqual(snapshot(data.repoRoot), before);
});
