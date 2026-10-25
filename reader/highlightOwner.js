// Highlight-specific activation identity. It observes existing authentication;
// it never signs in/out or writes account data.
function createHighlightOwner({ observe }) {
  let state = Object.freeze({ uid: null, generation: 0, ready: false });
  let consumers = 0, epoch = 0, stop = null;
  const listeners = new Set();
  function publish(uid, ready) {
    if (uid === state.uid && ready === state.ready) return;
    state = Object.freeze({ uid, ready, generation: state.generation + 1 });
    for (const listener of listeners) listener();
  }
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    acquire() {
      if (++consumers === 1) {
        const activation = ++epoch;
        const current = () => consumers > 0 && activation === epoch;
        try {
          stop = observe(user => {
            if (current()) publish(typeof user?.uid === 'string' && user.uid.length ? user.uid : null, true);
          }, () => { if (current()) publish(null, true); });
        } catch (_) { publish(null, true); }
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (--consumers === 0) {
          epoch++;
          stop?.(); stop = null;
          publish(null, false);
        }
      };
    },
  };
}
module.exports = { createHighlightOwner };
