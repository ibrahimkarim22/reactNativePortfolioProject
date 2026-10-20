const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const expectedDefault = { schemaVersion: 1, fontId: 'literata', fontSize: 20, lineSpacing: 'comfortable', theme: 'paper' };
const key = '@bard/reader-preferences:v1';
function api() {
  const file = path.resolve(__dirname, '../../reader/readerPreferences.js');
  const value = fs.existsSync(file) ? require(file) : {};
  assert.equal(typeof value.createReaderPreferenceStore, 'function', 'reader preference store must exist');
  assert.equal(typeof value.normalizePreferences, 'function', 'reader preference validation must exist');
  return value;
}
function memoryStorage(value) {
  const values = new Map([['persist:root', 'untouched course/auth state']]);
  if (value !== undefined) values.set(key, value);
  return { values, async getItem(name) { return values.get(name) ?? null; }, async setItem(name, text) { values.set(name, text); } };
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('invalid/missing stored preferences yield readable defaults without executable or unknown values', () => {
  const { normalizePreferences } = api();
  for (const value of [null, [], 12, 'paper', { schemaVersion: 7 }, { theme: '<script>', fontId: 'remote-font', fontSize: NaN }]) {
    assert.deepEqual(normalizePreferences(value), expectedDefault);
  }
  assert.deepEqual(normalizePreferences({ schemaVersion: 1, fontId: 'source-serif-4', fontSize: 24, lineSpacing: 'compact', theme: 'night', account: 'discard' }), {
    schemaVersion: 1, fontId: 'source-serif-4', fontSize: 24, lineSpacing: 'compact', theme: 'night',
  });
});

test('size validation bounds numeric values and rejects nonfinite or string sizes', () => {
  const { normalizePreferences } = api();
  for (const [value, want] of [[-5, 16], [100, 30], [27, 28], [16.2, 16], [Infinity, 20], ['30', 20]]) {
    assert.equal(normalizePreferences({ schemaVersion: 1, fontSize: value }).fontSize, want);
  }
});

test('pending hydration cannot overwrite saved settings with defaults or an early change', async () => {
  const { createReaderPreferenceStore } = api();
  const pending = deferred();
  const storage = memoryStorage();
  storage.getItem = () => pending.promise;
  const store = createReaderPreferenceStore(storage);
  const hydration = store.hydrate();
  assert.equal(store.getSnapshot().hydrated, false);
  assert.equal(store.update({ theme: 'night' }), false);
  assert.equal(storage.values.has(key), false);
  pending.resolve(JSON.stringify({ ...expectedDefault, fontSize: 26, theme: 'sepia' }));
  await hydration;
  assert.equal(store.getSnapshot().hydrated, true);
  assert.equal(store.getSnapshot().preferences.fontSize, 26);
  assert.equal(store.getSnapshot().preferences.theme, 'sepia');
  assert.equal(storage.values.has(key), false, 'hydration must never auto-save its result');
});

test('missing/corrupted/oversized storage settles without writing over the stored value', async () => {
  const { createReaderPreferenceStore } = api();
  for (const value of [undefined, '{bad json', 'x'.repeat(5000), JSON.stringify({ schemaVersion: 9, theme: 'night' })]) {
    const storage = memoryStorage(value);
    const store = createReaderPreferenceStore(storage);
    await store.hydrate();
    assert.equal(store.getSnapshot().hydrated, true);
    assert.deepEqual(store.getSnapshot().preferences, expectedDefault);
    assert.equal(storage.values.get(key), value);
  }
});

test('user changes persist under the reader key and survive a fresh store without touching course/auth storage', async () => {
  const { createReaderPreferenceStore } = api();
  const storage = memoryStorage();
  const store = createReaderPreferenceStore(storage);
  await store.hydrate();
  store.update({ theme: 'night', fontId: 'source-sans-3', fontSize: 30, lineSpacing: 'spacious' });
  await store.flush();
  const reopened = createReaderPreferenceStore(storage);
  await reopened.hydrate();
  assert.deepEqual(reopened.getSnapshot().preferences, { schemaVersion: 1, fontId: 'source-sans-3', fontSize: 30, lineSpacing: 'spacious', theme: 'night' });
  assert.equal(storage.values.get('persist:root'), 'untouched course/auth state');
  assert.deepEqual([...storage.values.keys()].sort(), [key, 'persist:root'].sort());
});

test('a failed read permits temporary reading changes without overwriting unread saved preferences', async () => {
  const { createReaderPreferenceStore } = api();
  const saved = { ...expectedDefault, fontId: 'source-serif-4', fontSize: 22, theme: 'sepia' };
  const storage = memoryStorage(JSON.stringify(saved));
  let fail = true;
  storage.getItem = async name => { if (fail) throw new Error('read unavailable'); return storage.values.get(name) ?? null; };
  const store = createReaderPreferenceStore(storage);
  await store.hydrate();
  assert.equal(store.getSnapshot().hydrated, true);
  assert.equal(store.getSnapshot().error, 'read');
  store.update({ fontSize: 28 });
  await store.flush();
  assert.equal(store.getSnapshot().preferences.fontSize, 28);
  assert.equal(storage.values.get(key), JSON.stringify(saved));
  fail = false;
  await store.retry();
  await store.flush();
  assert.deepEqual(store.getSnapshot().preferences, { ...saved, fontSize: 28 });
  assert.equal(store.getSnapshot().error, null);
  assert.deepEqual(JSON.parse(storage.values.get(key)), { ...saved, fontSize: 28 });
});

test('write failure preserves session preferences and retry saves the newest values', async () => {
  const { createReaderPreferenceStore } = api();
  const storage = memoryStorage();
  let fail = true;
  storage.setItem = async (name, value) => { if (fail) throw new Error('disk unavailable'); storage.values.set(name, value); };
  const store = createReaderPreferenceStore(storage);
  await store.hydrate();
  store.update({ theme: 'night' });
  await store.flush();
  assert.equal(store.getSnapshot().preferences.theme, 'night');
  assert.equal(store.getSnapshot().error, 'write');
  fail = false;
  store.update({ fontId: 'source-sans-3' });
  await store.retry();
  await store.flush();
  assert.equal(store.getSnapshot().error, null);
  assert.equal(JSON.parse(storage.values.get(key)).fontId, 'source-sans-3');
  assert.equal(JSON.parse(storage.values.get(key)).theme, 'night');
});

test('rapid updates serialize storage so an older completion cannot replace the latest selection', async () => {
  const { createReaderPreferenceStore } = api();
  const storage = memoryStorage();
  const first = deferred();
  let writes = 0;
  storage.setItem = async (name, value) => { if (++writes === 1) await first.promise; storage.values.set(name, value); };
  const store = createReaderPreferenceStore(storage);
  await store.hydrate();
  store.update({ fontId: 'source-serif-4' });
  store.update({ fontId: 'source-sans-3' });
  store.update({ theme: 'night', fontSize: 28 });
  assert.equal(store.getSnapshot().preferences.fontId, 'source-sans-3');
  first.resolve();
  await store.flush();
  assert.deepEqual(JSON.parse(storage.values.get(key)), { ...expectedDefault, fontId: 'source-sans-3', theme: 'night', fontSize: 28 });
  assert.equal(store.getSnapshot().saving, false);
});

test('reset restores and saves only reader defaults', async () => {
  const { createReaderPreferenceStore } = api();
  const storage = memoryStorage(JSON.stringify({ ...expectedDefault, theme: 'night', fontSize: 30 }));
  const store = createReaderPreferenceStore(storage);
  await store.hydrate();
  store.reset();
  await store.flush();
  assert.deepEqual(store.getSnapshot().preferences, expectedDefault);
  assert.deepEqual(JSON.parse(storage.values.get(key)), expectedDefault);
  assert.equal(storage.values.get('persist:root'), 'untouched course/auth state');
});

test('explicit reset replaces corrupt stored settings even when the fallback already looks like defaults', async () => {
  const { createReaderPreferenceStore } = api();
  const storage = memoryStorage('{broken');
  const store = createReaderPreferenceStore(storage);
  await store.hydrate();
  store.reset();
  await store.flush();
  assert.equal(storage.values.get(key), JSON.stringify(expectedDefault));
});

test('simultaneous read retries cannot replace a pending user choice with an older saved value', async () => {
  const { createReaderPreferenceStore } = api();
  const storage = memoryStorage();
  storage.getItem = async () => { throw new Error('temporarily unreadable'); };
  const store = createReaderPreferenceStore(storage);
  await store.hydrate();
  const pending = deferred();
  storage.getItem = () => pending.promise;
  const firstRetry = store.retry();
  const secondRetry = store.retry();
  store.update({ fontSize: 28 });
  pending.resolve(JSON.stringify({ ...expectedDefault, fontSize: 22, theme: 'sepia' }));
  await Promise.all([firstRetry, secondRetry]);
  await store.flush();
  assert.equal(store.getSnapshot().preferences.fontSize, 28);
  assert.equal(store.getSnapshot().preferences.theme, 'sepia');
  assert.equal(JSON.parse(storage.values.get(key)).fontSize, 28);
});
