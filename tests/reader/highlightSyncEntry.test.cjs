const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');

function entry(flag, development = true, failHarness = false) {
  const calls = [], normal = function Normal() {}, isolated = function Isolated() {};
  const code = babel.transformFileSync(path.resolve(__dirname, '../../App.js'), { babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
  const module = { exports: {} };
  const load = name => {
    calls.push(name);
    if (name === 'react') return {};
    if (name === './NormalApp') return { __esModule: true, default: normal };
    if (name === './reader/HighlightSyncEmulatorHarness') {
      if (failHarness) throw new Error('Isolated backend unavailable');
      return { __esModule: true, default: isolated };
    }
    throw new Error('Unexpected normal application initialization: ' + name);
  };
  vm.runInNewContext('(function(require,module,exports){' + code + '\n})', {
    __DEV__: development, process: { env: { EXPO_PUBLIC_BARD_HIGHLIGHT_SYNC_TEST: flag } },
  })(load, module, module.exports);
  return { calls, selected: module.exports.default, normal, isolated };
}

test('default entry keeps the existing normal app and never imports isolated backend code', () => {
  const result = entry(undefined);
  assert.equal(result.selected, result.normal);
  assert.ok(!result.calls.some(name => name.includes('HighlightSyncEmulator')));
});
test('explicit test entry initializes only the isolated harness, with no normal Firebase or Redux import', () => {
  const result = entry('emulator');
  assert.equal(result.selected, result.isolated);
  assert.deepEqual(result.calls.filter(name => name !== 'react'), ['./reader/HighlightSyncEmulatorHarness']);
});
test('an unavailable isolated backend never falls back to the normal app', () => {
  assert.throws(() => entry('emulator', true, true), /Isolated backend unavailable/);
});
