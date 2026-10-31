const safeCodes = new Set([
  'COURSE_INVALID_OWNER', 'COURSE_INVALID_LEVEL', 'COURSE_PROFILE_MISSING',
  'COURSE_PROGRESS_INVALID', 'COURSE_CANCELLED', 'COURSE_UNAVAILABLE',
  'cancelled', 'unknown', 'invalid-argument', 'deadline-exceeded', 'not-found',
  'already-exists', 'permission-denied', 'resource-exhausted', 'failed-precondition',
  'aborted', 'out-of-range', 'unimplemented', 'internal', 'unavailable', 'data-loss', 'unauthenticated',
]);
const failure = code => Object.assign(new Error('Course progress could not be verified.'), { code });
const sanitized = error => failure(safeCodes.has(error?.code) ? error.code : 'COURSE_UNAVAILABLE');
const validLevel = value => Number.isSafeInteger(value) && value >= 0;

function owner(uid) {
  if (typeof uid !== 'string' || !uid.trim() || uid.length > 128 || /[/\\\u0000-\u001f]/.test(uid)) {
    throw failure('COURSE_INVALID_OWNER');
  }
  return uid;
}

function scalar(snapshot) {
  if (!snapshot?.exists()) throw failure('COURSE_PROFILE_MISSING');
  const data = snapshot.data();
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw failure('COURSE_PROGRESS_INVALID');
  const completedLevel = Object.prototype.hasOwnProperty.call(data, 'completedLevel') ? data.completedLevel : 0;
  if (!validLevel(completedLevel)) throw failure('COURSE_PROGRESS_INVALID');
  return Object.freeze({ exists: true, completedLevel,
    fromCache: snapshot.metadata?.fromCache === true,
    hasPendingWrites: snapshot.metadata?.hasPendingWrites === true });
}

function createFirestoreCourseProgressTransport({ db, doc, onSnapshot, runTransaction, getDocFromServer }) {
  const reference = uid => doc(db, 'users', owner(uid));
  const current = isCurrent => {
    let active = false;
    try { active = isCurrent() === true; } catch (_) { /* A failed ownership check cancels the request. */ }
    if (!active) throw failure('COURSE_CANCELLED');
  };

  return Object.freeze({
    observe(uid, next, error) {
      try {
        return onSnapshot(reference(uid), { includeMetadataChanges: true }, snapshot => {
          let progress;
          try { progress = scalar(snapshot); }
          catch (cause) { error(sanitized(cause)); return; }
          next(progress);
        }, cause => error(sanitized(cause)));
      } catch (cause) { throw sanitized(cause); }
    },
    async read(uid) {
      try { return scalar(await getDocFromServer(reference(uid))); }
      catch (cause) { throw sanitized(cause); }
    },
    async save(uid, level, isCurrent = () => true) {
      try {
        owner(uid);
        if (!validLevel(level) || level === 0) throw failure('COURSE_INVALID_LEVEL');
        current(isCurrent);
        const ref = reference(uid);
        const confirmed = await runTransaction(db, async transaction => {
          // Firebase may rerun this callback. Recheck ownership and reread the
          // server value on each retry; publish no local state inside it.
          current(isCurrent);
          const prior = scalar(await transaction.get(ref)).completedLevel;
          current(isCurrent);
          const completedLevel = Math.max(prior, level);
          const advanced = completedLevel > prior;
          if (advanced) {
            current(isCurrent);
            transaction.update(ref, { completedLevel });
          }
          return Object.freeze({ completedLevel, advanced });
        });
        current(isCurrent);
        return confirmed;
      } catch (cause) { throw sanitized(cause); }
    },
  });
}

module.exports = { createFirestoreCourseProgressTransport };
