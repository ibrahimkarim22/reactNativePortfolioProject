const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { stableStringify } = require('./contentVersion');

const REPOSITORY = path.resolve(__dirname, '..');
const SUPPORT = ['characters.json', 'synopsis.json', 'quiz.json'];
const SOURCE = 'data/source/pg100-images.html';
const MANIFEST = 'data/manifest.json';
const REGISTRY = 'shared/localPlayRegistry.js';
const RECEIPT_VERSION = 1;

const slash = value => value.replace(/\\/g, '/');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

// Resolve existing ancestors too: an uncreated path under a junction must not
// hide a production destination behind an apparently temporary spelling.
function realTarget(target) {
  let current = path.resolve(target);
  const tail = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error('Cannot resolve candidate filesystem ancestor: ' + target);
    tail.unshift(path.basename(current));
    current = parent;
  }
  return path.join(fs.realpathSync(current), ...tail);
}

function assertCandidateTarget(repoRoot, outDir) {
  const repository = realTarget(repoRoot);
  const candidate = realTarget(outDir);
  if (inside(repository, candidate) || inside(candidate, repository)) {
    throw new Error('A fresh temporary candidate outside the production repository is required.');
  }
  return candidate;
}

function safeJoin(root, relative) {
  if (typeof relative !== 'string' || !relative || /[\\:\0]/.test(relative)
      || relative.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Unsafe inventory path: ' + relative);
  }
  const target = path.resolve(root, ...relative.split('/'));
  if (!inside(path.resolve(root), target) || !inside(realTarget(root), realTarget(target))) {
    throw new Error('Unsafe inventory path outside its intended directory: ' + relative);
  }
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('Symlink inventory path is unsafe: ' + relative);
  }
  return target;
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function record(root, relative) {
  const bytes = fs.readFileSync(safeJoin(root, relative));
  return { path: relative, sha256: sha256(bytes), bytes: bytes.length };
}
function listFiles(root) {
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Symlink candidate or original inventory is unsafe: ' + target);
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile()) files.push(slash(path.relative(root, target)));
      else throw new Error('Only regular inventory files are supported: ' + target);
    }
  }
  walk(root);
  return files.sort();
}

function allowedGenerated(relative, ids) {
  if (relative === MANIFEST || relative === REGISTRY) return true;
  const match = relative.match(/^data\/plays\/([a-z0-9-]+)\/(play\.json|scenes\/act-[1-9]\d*-scene-[1-9]\d*\.json|sections\/[a-z0-9-]+\.json)$/);
  return Boolean(match && ids.includes(match[1]));
}
function assertGenerated(relative, ids) {
  if (!allowedGenerated(relative, ids)) throw new Error('Unsafe or protected generated inventory path: ' + relative);
}
function sectionFile(id, reference, ids) {
  if (!reference || typeof reference.path !== 'string') throw new Error('Every generated section reference requires a path.');
  const local = reference.path.replace(/^\.\//, '');
  const relative = 'data/plays/' + id + '/' + local;
  assertGenerated(relative, ids);
  if (local === 'play.json') throw new Error('A section reference cannot own play.json.');
  return relative;
}

function originalSnapshot(repoRoot) {
  const manifest = readJson(safeJoin(repoRoot, MANIFEST));
  const ids = (manifest.plays || []).map(play => play.id);
  if (ids.length !== 38 || new Set(ids).size !== 38 || ids.some(id => !/^[a-z0-9-]+$/.test(id))) {
    throw new Error('The original manifest must identify exactly 38 existing plays.');
  }
  const protectedPaths = [SOURCE, ...ids.flatMap(id => SUPPORT.map(name => 'data/plays/' + id + '/' + name))].sort();
  const protectedFiles = protectedPaths.map(relative => record(repoRoot, relative));
  const originalPaths = listFiles(safeJoin(repoRoot, 'data/plays'))
    .map(relative => 'data/plays/' + relative).filter(relative => allowedGenerated(relative, ids));
  originalPaths.push(MANIFEST, REGISTRY);
  const originalFiles = [...new Set(originalPaths)].sort().map(relative => record(repoRoot, relative));
  const oldReferences = [];
  for (const id of ids) {
    const play = readJson(safeJoin(repoRoot, 'data/plays/' + id + '/play.json'));
    const refs = Array.isArray(play.sections) ? play.sections : (play.acts || []).flatMap(act => act.scenes || []);
    for (const reference of refs) oldReferences.push(sectionFile(id, reference, ids));
  }
  return { ids, protectedFiles, originalFiles, oldReferences: [...new Set(oldReferences)].sort() };
}

function assertOriginalUnchanged(repoRoot, baseline) {
  if (stableStringify(originalSnapshot(repoRoot)) !== stableStringify(baseline)) {
    throw new Error('Original generated targets or protected source/support files changed since the staging baseline.');
  }
}

function dependencies(overrides = {}) {
  return {
    generateCollection: overrides.generateCollection || require('./parseGutenberg').generateCollection,
    generateRegistry: overrides.generateRegistry || require('./generateLocalPlayRegistry').generateRegistry,
    validateCollection: overrides.validateCollection || require('./validateGutenbergFidelity').validateCollection,
    copyFile: overrides.copyFile || fs.copyFileSync,
  };
}

function candidateInventory(candidateRoot, baseline, parserInventory) {
  const expected = [MANIFEST, REGISTRY];
  for (const id of baseline.ids) {
    const relative = 'data/plays/' + id + '/play.json';
    const play = readJson(safeJoin(candidateRoot, relative));
    if (play.id !== id || !Array.isArray(play.sections)) throw new Error('Candidate play identity or ordered sections are invalid: ' + id);
    expected.push(relative, ...play.sections.map(ref => sectionFile(id, ref, baseline.ids)));
  }
  if (new Set(expected).size !== expected.length) throw new Error('Duplicate generated paths in candidate inventory.');
  expected.sort();
  if (parserInventory) {
    if (!Array.isArray(parserInventory)) throw new Error('The parser must return an explicit generated inventory.');
    const declared = parserInventory.map(relative => 'data/plays/' + relative).sort();
    for (const relative of declared) assertGenerated(relative, baseline.ids);
    const expectedParser = expected.filter(relative => relative !== MANIFEST && relative !== REGISTRY);
    if (stableStringify(declared) !== stableStringify(expectedParser)) throw new Error('Parser generated inventory does not match authoritative section references.');
  }
  const protectedCandidate = baseline.protectedFiles.filter(item => item.path !== SOURCE);
  for (const original of protectedCandidate) {
    const actual = record(candidateRoot, original.path);
    if (actual.sha256 !== original.sha256 || actual.bytes !== original.bytes) throw new Error('Protected support bytes changed in candidate: ' + original.path);
  }
  const actualPaths = listFiles(candidateRoot);
  const permitted = [...expected, ...protectedCandidate.map(item => item.path)].sort();
  if (stableStringify(actualPaths) !== stableStringify(permitted)) throw new Error('Unexpected or missing candidate inventory files.');
  return { generatedFiles: expected.map(relative => record(candidateRoot, relative)), allFiles: actualPaths.map(relative => record(candidateRoot, relative)) };
}

function strictValidation(validator, sourceFile, candidateRoot) {
  const report = validator({ sourceFile, candidateRoot });
  if (!report || report.passed !== true || (report.errorCount !== undefined && report.errorCount !== 0)
      || (Array.isArray(report.errors) && report.errors.length)) {
    const error = new Error('Strict source validation did not pass for ' + candidateRoot);
    error.validation = report;
    throw error;
  }
  return report;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}
function reportTarget(repoRoot, reportFile) {
  if (!reportFile) return null;
  const target = path.resolve(reportFile);
  if (inside(realTarget(path.join(repoRoot, 'data')), realTarget(target)) || realTarget(target) === realTarget(path.join(repoRoot, REGISTRY))) {
    throw new Error('A report cannot replace generated data or protected source/support files.');
  }
  return target;
}
function receiptHash(receipt) {
  const { receiptHash: ignored, ...payload } = receipt;
  return sha256(stableStringify(payload));
}

function stageCollection({ repoRoot = REPOSITORY, reportFile, dependencies: overrides, onStageCreated } = {}) {
  repoRoot = path.resolve(repoRoot);
  const outputReport = reportTarget(repoRoot, reportFile);
  const baseline = originalSnapshot(repoRoot);
  const services = dependencies(overrides);
  const stagedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bard-content-stage-'));
  if (onStageCreated) onStageCreated(stagedRoot);
  try {
    assertCandidateTarget(repoRoot, stagedRoot);
    const candidates = [];
    for (const name of ['candidate-a', 'candidate-b']) {
      const candidateRoot = safeJoin(stagedRoot, name);
      const outDir = safeJoin(candidateRoot, 'data/plays');
      assertCandidateTarget(repoRoot, outDir);
      fs.mkdirSync(outDir, { recursive: true });
      const generated = services.generateCollection({ sourceFile: safeJoin(repoRoot, SOURCE), outDir, supportRoot: safeJoin(repoRoot, 'data/plays') });
      if (!generated || !Array.isArray(generated.inventory)) throw new Error('The parser must return an explicit generated inventory.');
      services.generateRegistry({ dataRoot: safeJoin(candidateRoot, 'data'), output: safeJoin(candidateRoot, REGISTRY), assetsRoot: path.join(repoRoot, 'assets') });
      const inventory = candidateInventory(candidateRoot, baseline, generated.inventory);
      const validation = strictValidation(services.validateCollection, safeJoin(repoRoot, SOURCE), candidateRoot);
      // Validators are read-only participants; catch unexpected candidate changes.
      if (stableStringify(candidateInventory(candidateRoot, baseline)) !== stableStringify(inventory)) throw new Error('Candidate changed during strict validation.');
      candidates.push({ name, ...inventory, validation });
      assertOriginalUnchanged(repoRoot, baseline);
    }
    if (stableStringify(candidates[0].allFiles) !== stableStringify(candidates[1].allFiles)) throw new Error('Generated candidate inventory/bytes are not deterministic.');
    const receipt = {
      receiptVersion: RECEIPT_VERSION, passed: true, repoRoot, stagedRoot,
      baseline, protectedFiles: baseline.protectedFiles,
      generatedFiles: candidates[0].generatedFiles,
      candidateFiles: candidates[0].allFiles,
      validations: candidates.map(candidate => candidate.validation),
    };
    receipt.receiptHash = receiptHash(receipt);
    writeJson(safeJoin(stagedRoot, 'receipt.json'), receipt);
    const result = { passed: true, stagedRoot, receipt };
    if (outputReport) writeJson(outputReport, result);
    return result;
  } catch (error) {
    error.stagedRoot = stagedRoot;
    if (outputReport) writeJson(outputReport, { passed: false, stagedRoot, error: error.message, ...(error.validation ? { validation: error.validation } : {}) });
    throw error;
  }
}

function promoteCollection({ stagedRoot, repoRoot = REPOSITORY, dependencies: overrides } = {}) {
  if (!stagedRoot) throw new Error('An explicit previously staged root is required.');
  repoRoot = path.resolve(repoRoot);
  stagedRoot = path.resolve(stagedRoot);
  assertCandidateTarget(repoRoot, stagedRoot);
  const receipt = readJson(safeJoin(stagedRoot, 'receipt.json'));
  if (receipt.receiptVersion !== RECEIPT_VERSION || receipt.passed !== true || receipt.repoRoot !== repoRoot
      || receipt.stagedRoot !== stagedRoot || receipt.receiptHash !== receiptHash(receipt)) throw new Error('The staging receipt is invalid or changed.');
  const baseline = receipt.baseline;
  for (const file of receipt.generatedFiles) assertGenerated(file.path, baseline.ids);
  assertOriginalUnchanged(repoRoot, baseline);
  const services = dependencies(overrides);
  for (const name of ['candidate-a', 'candidate-b']) {
    const candidateRoot = safeJoin(stagedRoot, name);
    const current = candidateInventory(candidateRoot, baseline);
    if (stableStringify(current.generatedFiles) !== stableStringify(receipt.generatedFiles)
        || stableStringify(current.allFiles) !== stableStringify(receipt.candidateFiles)) throw new Error('Candidate inventory or bytes changed since the staging receipt.');
    strictValidation(services.validateCollection, safeJoin(repoRoot, SOURCE), candidateRoot);
    if (stableStringify(candidateInventory(candidateRoot, baseline)) !== stableStringify(current)) throw new Error('Candidate changed during revalidation.');
  }
  assertOriginalUnchanged(repoRoot, baseline);
  const generatedPaths = receipt.generatedFiles.map(file => file.path);
  const obsolete = baseline.oldReferences.filter(relative => !generatedPaths.includes(relative) && fs.existsSync(safeJoin(repoRoot, relative)));
  const targets = [...new Set([...generatedPaths, ...obsolete])];
  const originals = new Map(baseline.originalFiles.map(file => [file.path, file]));
  for (const relative of targets) {
    assertGenerated(relative, baseline.ids);
    const target = safeJoin(repoRoot, relative);
    if (originals.has(relative)) {
      const backup = safeJoin(stagedRoot, 'backup/' + relative);
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.copyFileSync(target, backup);
      if (record(stagedRoot, 'backup/' + relative).sha256 !== originals.get(relative).sha256) throw new Error('Original backup verification failed: ' + relative);
    } else if (fs.existsSync(target)) throw new Error('An original generated target appeared after staging: ' + relative);
  }
  const changed = [];
  try {
    for (const relative of generatedPaths) {
      const target = safeJoin(repoRoot, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      changed.push(relative);
      services.copyFile(safeJoin(stagedRoot, 'candidate-a/' + relative), target);
    }
    for (const relative of obsolete) {
      changed.push(relative);
      fs.unlinkSync(safeJoin(repoRoot, relative));
    }
    for (const expected of receipt.generatedFiles) {
      if (record(repoRoot, expected.path).sha256 !== expected.sha256) throw new Error('Promoted generated bytes differ from the validated receipt: ' + expected.path);
    }
    for (const expected of baseline.protectedFiles) {
      if (record(repoRoot, expected.path).sha256 !== expected.sha256) throw new Error('Protected source/support bytes changed during promotion: ' + expected.path);
    }
    const validation = strictValidation(services.validateCollection, safeJoin(repoRoot, SOURCE), repoRoot);
    const result = { passed: true, stagedRoot, generatedFiles: generatedPaths.length, removedObsoleteFiles: obsolete.length, protectedFiles: baseline.protectedFiles.length, validation };
    writeJson(safeJoin(stagedRoot, 'promotion.json'), result);
    return result;
  } catch (error) {
    const rollbackErrors = [];
    for (const relative of [...new Set(changed)].reverse()) {
      try {
        const target = safeJoin(repoRoot, relative);
        if (originals.has(relative)) fs.copyFileSync(safeJoin(stagedRoot, 'backup/' + relative), target);
        else if (fs.existsSync(target)) fs.unlinkSync(target);
      } catch (rollbackError) { rollbackErrors.push(relative + ': ' + rollbackError.message); }
    }
    if (rollbackErrors.length) throw new Error(error.message + '; rollback errors: ' + rollbackErrors.join('; '));
    throw error;
  }
}

function main(argv = process.argv.slice(2)) {
  let mode;
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--stage' && !mode) mode = 'stage';
    else if (flag === '--promote' && !mode && argv[index + 1]) { mode = 'promote'; options.stagedRoot = argv[++index]; }
    else if (flag === '--report' && argv[index + 1]) options.reportFile = argv[++index];
    else throw new Error('Usage: node scripts/completePlayCollection.js --stage [--report FILE] | --promote STAGED_ROOT');
  }
  if (!mode || (mode === 'promote' && options.reportFile)) throw new Error('Choose --stage [--report FILE] or --promote STAGED_ROOT.');
  const result = mode === 'stage' ? stageCollection(options) : promoteCollection(options);
  process.stdout.write(JSON.stringify({ passed: result.passed, stagedRoot: result.stagedRoot, ...(result.receipt ? { receipt: path.join(result.stagedRoot, 'receipt.json'), generatedFiles: result.receipt.generatedFiles.length } : { generatedFiles: result.generatedFiles, removedObsoleteFiles: result.removedObsoleteFiles }) }, null, 2) + '\n');
  return result;
}

module.exports = { assertCandidateTarget, stageCollection, promoteCollection, main };
if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(error.message + (error.stagedRoot ? '\nCandidate retained at ' + error.stagedRoot : '') + '\n'); process.exitCode = 1; }
}
