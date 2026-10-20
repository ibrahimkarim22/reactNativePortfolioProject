function createFontSelection(loadReaderFont, publish) {
  let generation = 0;
  return {
    async select(fontId) {
      const request = ++generation;
      publish({ fontId, faces: undefined, loading: true, error: null });
      try {
        const result = await loadReaderFont(fontId);
        if (generation !== request) return;
        if (result.fontId !== fontId) throw new Error('The prepared font does not match the selected family.');
        publish({ fontId, faces: result.faces, loading: false, error: null });
      } catch (_) {
        if (generation !== request) return;
        publish({ fontId, faces: [], loading: false, error: 'The local font could not be loaded. A readable system font is being used.' });
      }
    },
    cancel() { generation += 1; },
  };
}

module.exports = { createFontSelection };
