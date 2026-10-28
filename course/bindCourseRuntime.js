function cancelled() {
  const error = new Error('Course session changed. Try again.');
  error.code = 'COURSE_CANCELLED';
  return error;
}

function bindCourseRuntime(source, owner = source.getOwner()) {
  // Capture values rather than the caller's potentially mutable owner object.
  // Observers stay shared; this binding owns no storage or subscriptions.
  const captured = Object.freeze({ uid: owner?.uid, generation: owner?.generation });
  const isCurrent = () => {
    const current = source.getOwner();
    return !!current && current.uid === captured.uid && current.generation === captured.generation;
  };
  const requireCurrent = () => { if (!isCurrent()) throw cancelled(); };
  return Object.freeze({
    subscribe: source.subscribe,
    getOwner: source.getOwner,
    getSnapshot: source.getSnapshot,
    getLevel() {
      if (!isCurrent()) return null;
      const level = source.getLevel();
      return isCurrent() ? level : null;
    },
    async saveProgress(uid, level) {
      requireCurrent();
      if (uid !== captured.uid) throw cancelled();
      try {
        const acknowledgement = await source.saveProgress(uid, level);
        requireCurrent();
        return acknowledgement;
      } catch (error) {
        requireCurrent();
        throw error;
      }
    },
    commitLevel(level) {
      requireCurrent();
      return source.commitLevel(level);
    },
    ...(typeof source.refresh === 'function' ? {
      refresh(...args) { requireCurrent(); return source.refresh(...args); },
    } : {}),
  });
}

module.exports = { bindCourseRuntime };
