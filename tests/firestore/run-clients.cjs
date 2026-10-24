const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
// This runner is for an already running fixed demo backend. The test environment
// still performs its own health checks and never falls back to production.
const args = ['--test', '--test-concurrency=1', ...fs.readdirSync(__dirname).filter(name => name.endsWith('.test.cjs')).map(name => path.join(__dirname, name))];
const env = { ...process.env, GCLOUD_PROJECT: 'demo-bard-highlights-sync', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9199', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8180' };
const child = spawn(process.execPath, args, { env, stdio: 'inherit', windowsHide: true });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code === null ? 1 : code; });
