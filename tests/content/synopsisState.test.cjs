const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');

function stateModule() {
  const file = path.resolve(__dirname, '../../folgerLibrary/folgerSlice.js');
  const calls = [];
  const code = babel.transformFileSync(file, { babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-modules-commonjs'] }).code;
  const module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: file })(name => {
    if (name === '../shared/localPlayService') return {
      getLocalSynopsis(id) { calls.push(['package', id]); return { workId: id, title: id }; },
      getSynopsisHtml(id) { calls.push(['html', id]); return '<p>Local prose</p>'; },
    };
    return require(name);
  }, module, module.exports);
  return { ...module.exports, calls };
}

test('synopsis requests clear old prose and reject stale success, failure, and A to B to A callbacks', () => {
  const { folgerReducer: reducer, fetchFolger: fetch } = stateModule();
  let state = reducer(undefined, { type: 'init' });
  state = reducer(state, fetch.pending('a1', 'a'));
  state = reducer(state, fetch.fulfilled({ synopsis: { workId: 'a' }, htmlContent: 'A' }, 'a1', 'a'));
  assert.equal(state.synopsis.workId, 'a');
  state = reducer(state, fetch.pending('b1', 'b'));
  assert.equal(state.synopsis, null);
  assert.equal(state.htmlContent, '');
  assert.equal(state.requestedId, 'b');
  const before = state;
  state = reducer(state, fetch.fulfilled({ synopsis: { workId: 'a' }, htmlContent: 'Old A' }, 'a1', 'a'));
  assert.equal(state, before);
  state = reducer(state, fetch.pending('a2', 'a'));
  state = reducer(state, fetch.rejected(Error('Old error'), 'a1', 'a'));
  assert.equal(state.isLoading, true);
  state = reducer(state, fetch.fulfilled({ synopsis: { workId: 'a' }, htmlContent: 'New A' }, 'a2', 'a'));
  assert.equal(state.htmlContent, 'New A');
  assert.equal(state.isLoading, false);
});

test('the existing fetchFolger action loads only the local authored package and compatible HTML', async () => {
  const { fetchFolger, calls } = stateModule();
  const actions = [];
  await fetchFolger('local-play')(action => { actions.push(action); }, () => ({}), undefined);
  assert.deepEqual(calls, [['package', 'local-play'], ['html', 'local-play']]);
  assert.equal(actions.at(-1).payload.synopsis.workId, 'local-play');
});
