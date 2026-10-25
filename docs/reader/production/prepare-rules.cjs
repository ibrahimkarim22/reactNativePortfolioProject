// Prepare a review candidate only; no Firebase SDK, CLI or deployment calls.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const original = fs.readFileSync(path.join(__dirname, 'deployed-firestore.rules'), 'utf8');
assert.equal(crypto.createHash('sha256').update(original).digest('hex'), '184e788c4f1b288c2b8490755c2f7ab64ed7bbe57aff2c6d045d55ce18535ba4', 'Deployed snapshot changed; inspect again rather than silently merge');
const fixture = fs.readFileSync(path.join(root, 'tests/firestore/firestore.rules'), 'utf8');
const marker = '    match /{document=**} { allow read, write: if false; }';
assert.equal(fixture.split(marker).length, 2);
assert.ok(original.startsWith('service cloud.firestore {\n  match /databases/{database}/documents {\n'));
assert.ok(original.endsWith('  }\n}\n'));
const preservedGrants = original.split('\n').slice(2, -3).join('\n');
const candidate = fixture.replace('// ISOLATED DEMO FIXTURE. Deployed profile/course rules are unknown. This file\n// must not be used as a production replacement without a separate review.',
  '// UNDEPLOYED REVIEW CANDIDATE. Preserves the retrieved production profile/quiz\n// grants; adds the isolated-tested highlight subtree. Requires explicit approval.')
  .replace(marker, preservedGrants + '\n' + marker);
fs.writeFileSync(path.join(__dirname, 'firestore.rules'), candidate);
console.log('Prepared merged candidate only; no deployment.');
