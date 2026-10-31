// No Firebase login, default project selection, deployment, import or export.
// This executable's only backend is the fixed, isolated demo configuration.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const mode = process.argv[2] || 'test';
if (!['start', 'test'].includes(mode)) throw new Error('Use only start or test');
const variant = process.argv[3] || 'highlights';
if (!['highlights', 'course'].includes(variant) || process.argv.length > 4) throw new Error('Use only the fixed highlights or course emulator fixture');
const fixturePath = path.join(__dirname, variant === 'course' ? 'firebase.course.demo.json' : 'firebase.demo.json');
const config = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
if (config.emulators.auth.port !== 9199 || config.emulators.firestore.port !== 8180
    || config.emulators.auth.host !== '127.0.0.1' || config.emulators.firestore.host !== '127.0.0.1') throw new Error('Unexpected emulator configuration');
const temporaryRoot = fs.realpathSync(os.tmpdir());
const cwd = fs.mkdtempSync(path.join(temporaryRoot, 'bard-firestore-'));
let configPath = fixturePath;
if (variant === 'course') {
  const approvedRules = path.join(root, 'docs/reader/production/firestore.rules');
  if (fs.realpathSync(path.resolve(__dirname, config.firestore.rules)) !== fs.realpathSync(approvedRules)) {
    throw new Error('The course emulator must use the reviewed merged rules');
  }
  // Firebase rejects a rules path outside the configuration's project folder.
  // Keep only this necessary fixture in the existing temporary test directory.
  fs.writeFileSync(path.join(cwd, 'firestore.rules'), fs.readFileSync(approvedRules));
  configPath = path.join(cwd, 'firebase.course.demo.json');
  fs.writeFileSync(configPath, JSON.stringify({ ...config, firestore: { rules: 'firestore.rules' } }));
}
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  const resolved = fs.realpathSync(cwd);
  if (path.dirname(resolved) !== temporaryRoot || !path.basename(resolved).startsWith('bard-firestore-')) {
    throw new Error('Temporary test directory escaped its owned location');
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  cleaned = true;
}
const cli = path.join(root, 'node_modules/firebase-tools/lib/bin/firebase.js');
const args = [cli, mode === 'test' ? 'emulators:exec' : 'emulators:start', '--project', 'demo-bard-highlights-sync', '--config', configPath, '--only', 'auth,firestore', '--non-interactive'];
if (mode === 'test') {
  const tests = fs.readdirSync(__dirname).filter(name => name.endsWith('.test.cjs')).map(name => '"' + path.join(__dirname, name) + '"');
  if (!tests.length) throw new Error('No rule-enforced acceptance tests found');
  args.push('"' + process.execPath + '" --test --test-concurrency=1 ' + tests.join(' '));
}
const env = { ...process.env, XDG_CONFIG_HOME: path.join(cwd, 'config'), GCLOUD_PROJECT: 'demo-bard-highlights-sync', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9199', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8180', CI: '1' };
const bundledJava = 'C:/Program Files/Android/Android Studio1/jbr';
if (!env.JAVA_HOME && fs.existsSync(path.join(bundledJava, 'bin/java.exe'))) env.JAVA_HOME = bundledJava;
// Windows' Oracle javapath launcher can create a second JVM that outlives the
// CLI's shutdown signal. Resolve JAVA_HOME directly in this child process only.
if (env.JAVA_HOME && fs.existsSync(path.join(env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'))) env.PATH = path.join(env.JAVA_HOME, 'bin') + path.delimiter + (env.PATH || '');
const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit', windowsHide: true });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('close', code => {
  process.exitCode = code === null ? 1 : code;
  try { cleanup(); } catch (error) { console.error(error.message); process.exitCode = 1; }
});
