const { DEFAULT_PREFERENCES, FONTS, THEMES, LINE_SPACING } = require('./readerConstants');

const PREFERENCE_KEY = '@bard/reader-preferences:v1';
const fields = ['fontId', 'fontSize', 'lineSpacing', 'theme'];
const own = (object, name) => Object.prototype.hasOwnProperty.call(object, name);

function normalizePreferences(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.schemaVersion !== 1) return DEFAULT_PREFERENCES;
  const size = Number.isFinite(input.fontSize) ? 16 + Math.round((Math.min(30, Math.max(16, input.fontSize)) - 16) / 2) * 2 : 20;
  return Object.freeze({
    schemaVersion: 1,
    fontId: own(FONTS, input.fontId) ? input.fontId : 'literata',
    fontSize: size,
    lineSpacing: own(LINE_SPACING, input.lineSpacing) ? input.lineSpacing : 'comfortable',
    theme: own(THEMES, input.theme) ? input.theme : 'paper',
  });
}

function parseStored(value) {
  if (typeof value !== 'string' || value.length > 4096) return DEFAULT_PREFERENCES;
  try { return normalizePreferences(JSON.parse(value)); } catch (_) { return DEFAULT_PREFERENCES; }
}

function createReaderPreferenceStore(storage) {
  let snapshot = Object.freeze({ preferences: DEFAULT_PREFERENCES, hydrated: false, error: null, saving: false });
  let hydration;
  let reading = false;
  let writes = Promise.resolve();
  let writeGeneration = 0;
  let readFailed = false;
  let pendingPatch = {};
  const listeners = new Set();
  const emit = changes => {
    snapshot = Object.freeze({ ...snapshot, ...changes });
    for (const listener of listeners) listener();
  };

  function save(preferences) {
    const generation = ++writeGeneration;
    emit({ saving: true, error: null });
    writes = writes.then(async () => {
      try {
        await storage.setItem(PREFERENCE_KEY, JSON.stringify(preferences));
        if (generation === writeGeneration) emit({ saving: false, error: null });
      } catch (_) {
        if (generation === writeGeneration) emit({ saving: false, error: 'write' });
      }
    });
  }

  async function load() {
    try {
      const stored = parseStored(await storage.getItem(PREFERENCE_KEY));
      const hasPending = Object.keys(pendingPatch).length > 0;
      const preferences = hasPending ? normalizePreferences({ ...stored, ...pendingPatch }) : stored;
      readFailed = false;
      pendingPatch = {};
      emit({ preferences, hydrated: true, error: null });
      // A successful initial read is never a write. Only explicit changes made
      // while a failed read was being retried earn this deferred save.
      if (hasPending) save(preferences);
    } catch (_) {
      readFailed = true;
      emit({ hydrated: true, error: 'read', saving: false });
    }
  }

  function hydrate() {
    if (!hydration) {
      reading = true;
      hydration = load().finally(() => { reading = false; });
    }
    return hydration;
  }

  function update(patch) {
    if (!snapshot.hydrated || !patch || typeof patch !== 'object' || Array.isArray(patch)) return false;
    const next = normalizePreferences({ ...snapshot.preferences, ...patch, schemaVersion: 1 });
    if (fields.every(name => next[name] === snapshot.preferences[name])) return true;
    emit({ preferences: next, error: readFailed ? 'read' : null });
    if (readFailed) {
      for (const name of fields) if (own(patch, name)) pendingPatch[name] = next[name];
    } else save(next);
    return true;
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    hydrate,
    update,
    reset() {
      if (!snapshot.hydrated) return false;
      // A reset is an explicit full preference choice, including when corrupt
      // storage already made the visible fallback look like the defaults.
      emit({ preferences: DEFAULT_PREFERENCES });
      if (readFailed) pendingPatch = { ...DEFAULT_PREFERENCES };
      else save(DEFAULT_PREFERENCES);
      return true;
    },
    flush: () => writes,
    async retry() {
      if (readFailed) {
        if (!reading) hydration = undefined;
        await hydrate();
      } else if (snapshot.hydrated) save(snapshot.preferences);
      await writes;
    },
  };
}

module.exports = { PREFERENCE_KEY, normalizePreferences, createReaderPreferenceStore };
