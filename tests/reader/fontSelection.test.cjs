const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function create(...args) {
  const file = path.resolve(__dirname, '../../reader/fontSelection.js');
  const api = fs.existsSync(file) ? require(file) : {};
  assert.equal(typeof api.createFontSelection, 'function', 'the font selection coordinator must exist');
  return api.createFontSelection(...args);
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('a late older font result cannot replace the newest reader family', async () => {
  const old = deferred(), recent = deferred(), states = [];
  const controller = create(id => id === 'literata' ? old.promise : recent.promise, state => states.push(state));
  const first = controller.select('literata');
  const second = controller.select('source-sans-3');
  recent.resolve({ fontId: 'source-sans-3', faces: ['sans-face'] });
  await second;
  old.resolve({ fontId: 'literata', faces: ['serif-face'] });
  await first;
  assert.equal(states.at(-1).fontId, 'source-sans-3');
  assert.deepEqual(states.at(-1).faces, ['sans-face']);
  assert.equal(states.at(-1).loading, false);
});

test('a stale font error cannot replace a successful newer selection and unmount cancels publications', async () => {
  const old = deferred(), states = [];
  const controller = create(id => id === 'literata' ? old.promise : Promise.resolve({ fontId: id, faces: ['new-face'] }), state => states.push(state));
  const first = controller.select('literata');
  await controller.select('source-serif-4');
  old.reject(new Error('old failure'));
  await first;
  assert.equal(states.at(-1).fontId, 'source-serif-4');
  assert.equal(states.at(-1).error, null);
  const cancelled = deferred();
  const laterStates = [];
  const later = create(() => cancelled.promise, state => laterStates.push(state));
  const loading = later.select('literata');
  later.cancel();
  const count = laterStates.length;
  cancelled.resolve({ fontId: 'literata', faces: ['late'] });
  await loading;
  assert.equal(laterStates.length, count);
});

test('font failure exposes a readable fallback while retaining the desired family and permitting retry', async () => {
  const states = [];
  let unavailable = true;
  const controller = create(async id => { if (unavailable) throw new Error('missing asset'); return { fontId: id, faces: ['recovered'] }; }, state => states.push(state));
  await controller.select('literata');
  assert.equal(states.at(-1).fontId, 'literata');
  assert.deepEqual(states.at(-1).faces, []);
  assert.equal(typeof states.at(-1).error, 'string');
  unavailable = false;
  await controller.select('literata');
  assert.equal(states.at(-1).error, null);
  assert.deepEqual(states.at(-1).faces, ['recovered']);
});
