const validLevel = value => Number.isSafeInteger(value) && value >= 0;
const normalizedUid = value => typeof value === 'string' && value.trim() ? value : null;
function failure(code) {
  const error = new Error('Course progress is unavailable.');
  error.code = code;
  return error;
}

// This is an account-scoped in-memory view of the existing Firestore profile.
// It neither persists another copy nor writes during hydration or refresh.
function createCourseProgressSession({ getUid, subscribeAuth, transport }) {
  const listeners = new Set();
  let active = false, lifetime = 0, unsubscribeAuth = null, watcher = null;
  let owner = Object.freeze({ uid: normalizedUid(getUid()), generation: 0 });
  let confirmedLevel = null, acknowledgedLevel = null, confirmationRevision = 0;
  let snapshot = Object.freeze({ owner, status: owner.uid ? 'loading' : 'signed-out', completedLevel: 0, error: null });

  function publish(status, completedLevel, error = null) {
    if (snapshot.owner === owner && snapshot.status === status && snapshot.completedLevel === completedLevel && snapshot.error === error) return;
    snapshot = Object.freeze({ owner, status, completedLevel, error });
    for (const listener of [...listeners]) listener();
  }
  function retireWatcher() {
    const old = watcher;
    watcher = null;
    old?.unsubscribe?.();
  }
  function replaceOwner(uid, observe = true) {
    retireWatcher();
    owner = Object.freeze({ uid, generation: owner.generation + 1 });
    confirmedLevel = null; acknowledgedLevel = null; confirmationRevision = 0;
    publish(uid ? 'loading' : 'signed-out', 0);
    if (observe) ensureObservation();
  }
  function synchronizeOwner() {
    const uid = normalizedUid(getUid());
    if (uid !== owner.uid) replaceOwner(uid);
  }
  function current(token) {
    synchronizeOwner();
    return active && token.lifetime === lifetime && token.owner === owner;
  }
  function watchCurrent(token) { return current(token) && watcher === token; }
  function readError(error) {
    const code = error?.code === 'COURSE_PROFILE_MISSING' ? 'PROFILE_MISSING'
      : error?.code === 'COURSE_PROGRESS_INVALID' ? 'INVALID_PROGRESS' : 'PROGRESS_READ_FAILED';
    publish('error', confirmedLevel ?? 0, code);
  }
  function accept(value) {
    if (value?.fromCache !== false || value?.hasPendingWrites !== false) {
      if (confirmedLevel === null) publish('error', 0, 'UNVERIFIED_PROGRESS');
      return false;
    }
    if (value.exists === false) { publish('error', confirmedLevel ?? 0, 'PROFILE_MISSING'); return false; }
    const level = value.completedLevel === undefined ? 0 : value.completedLevel;
    if (value.exists !== true || !validLevel(level)) {
      publish('error', confirmedLevel ?? 0, 'INVALID_PROGRESS');
      return false;
    }
    confirmedLevel = Math.max(confirmedLevel ?? 0, level);
    confirmationRevision++;
    publish('ready', confirmedLevel);
    return true;
  }
  function ensureObservation() {
    if (!active || !owner.uid || watcher) return;
    const token = { owner, lifetime, unsubscribe: null };
    watcher = token;
    try {
      const unsubscribe = transport.observe(owner.uid, value => {
        if (watchCurrent(token)) accept(value);
      }, error => {
        if (watchCurrent(token)) { token.failed = true; readError(error); }
      });
      token.unsubscribe = unsubscribe;
      if (!watchCurrent(token)) unsubscribe?.();
    } catch (error) {
      if (watchCurrent(token)) { token.failed = true; readError(error); }
    }
  }
  function stop() {
    if (!active) return;
    active = false;
    lifetime++;
    const unsubscribe = unsubscribeAuth;
    unsubscribeAuth = null;
    unsubscribe?.();
    replaceOwner(normalizedUid(getUid()), false);
  }

  return Object.freeze({
    start() {
      if (active) return stop;
      active = true;
      lifetime++;
      synchronizeOwner();
      const started = lifetime;
      const unsubscribe = subscribeAuth?.(value => {
        if (!active || lifetime !== started) return;
        // Preserve intervening auth transitions, while observing only the
        // actual current account when notifications have already been queued.
        if ((value === null || typeof value === 'string') && normalizedUid(value) !== owner.uid) {
          replaceOwner(normalizedUid(value), false);
        }
        synchronizeOwner();
        ensureObservation();
      });
      if (active && lifetime === started) unsubscribeAuth = unsubscribe;
      else unsubscribe?.();
      ensureObservation();
      return stop;
    },
    stop,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() { synchronizeOwner(); return snapshot; },
    getOwner() { synchronizeOwner(); return owner; },
    getLevel() { synchronizeOwner(); return active && snapshot.status === 'ready' ? snapshot.completedLevel : null; },
    async refresh() {
      synchronizeOwner();
      if (!active || !owner.uid) return false;
      if (snapshot.status === 'error' || watcher?.failed) {
        retireWatcher();
        publish('loading', confirmedLevel ?? 0);
      }
      ensureObservation();
      const token = { owner, lifetime }, revision = confirmationRevision;
      if (!current(token)) return false;
      try {
        const value = await transport.read(owner.uid);
        if (!current(token)) return false;
        // A newer observer confirmation supersedes an older failed/missing
        // refresh response; lower valid levels are merged monotonically.
        if (confirmationRevision !== revision && (value?.exists !== true
            || !validLevel(value.completedLevel === undefined ? 0 : value.completedLevel))) return false;
        return accept(value);
      } catch (error) {
        if (current(token) && confirmationRevision === revision) readError(error);
        return false;
      }
    },
    async saveProgress(uid, level) {
      synchronizeOwner();
      const token = { owner, lifetime };
      if (!active || !uid || uid !== owner.uid) throw failure('COURSE_CANCELLED');
      if (!validLevel(level) || level === 0) throw failure('COURSE_INVALID_LEVEL');
      if (snapshot.status !== 'ready') throw failure('COURSE_PROGRESS_NOT_READY');
      const result = await transport.save(uid, level, () => current(token));
      if (!current(token)) throw failure('COURSE_CANCELLED');
      if (!result || typeof result !== 'object' || Array.isArray(result) || !validLevel(result.completedLevel)
          || result.completedLevel < level || typeof result.advanced !== 'boolean'
          || result.advanced && result.completedLevel !== level) throw failure('COURSE_INVALID_ACKNOWLEDGMENT');
      acknowledgedLevel = Math.max(acknowledgedLevel ?? 0, result.completedLevel);
      return Object.freeze({ completedLevel: result.completedLevel, advanced: result.advanced });
    },
    commitLevel(level) {
      synchronizeOwner();
      const known = Math.max(confirmedLevel ?? -1, acknowledgedLevel ?? -1);
      if (!active || !owner.uid || !validLevel(level) || level > known) return false;
      confirmedLevel = Math.max(confirmedLevel ?? 0, acknowledgedLevel ?? 0, level);
      confirmationRevision++;
      publish('ready', confirmedLevel);
      return true;
    },
  });
}

module.exports = { createCourseProgressSession };
