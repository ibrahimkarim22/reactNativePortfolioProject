const normalizeUid = value => typeof value === 'string' && value.trim() ? value : null;

function createQuizRuntime({ getUid, subscribeAuth, getLevel, saveProgress, commitLevel }) {
  const listeners = new Set();
  let disposed = false;
  let owner = Object.freeze({ uid: normalizeUid(getUid()), generation: 0 });

  const updateOwner = uid => {
    if (disposed || owner.uid === uid) return;
    owner = Object.freeze({ uid, generation: owner.generation + 1 });
    for (const listener of [...listeners]) listener();
  };
  const getOwner = () => {
    if (!disposed) updateOwner(normalizeUid(getUid()));
    return owner;
  };
  const unsubscribeAuth = subscribeAuth?.(value => {
    if (disposed) return;
    // Auth events retain transitions that might otherwise finish A-to-B-to-A
    // between screen renders. A no-argument observer still reads current Auth.
    if (value === null || typeof value === 'string' || value && typeof value.uid === 'string') {
      updateOwner(normalizeUid(typeof value === 'string' ? value : value?.uid));
    } else getOwner();
  });

  return Object.freeze({
    getOwner,
    getLevel,
    saveProgress,
    commitLevel,
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      unsubscribeAuth?.();
    },
  });
}

module.exports = { createQuizRuntime };
