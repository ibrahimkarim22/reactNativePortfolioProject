const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;

function authenticationObserver() {
  const source = fs.readFileSync(path.join(__dirname, '../../Componenets/Navigation.js'), 'utf8');
  const callbacks = [];
  traverse(parse(source, { sourceType: 'module', plugins: ['jsx'] }), {
    CallExpression({ node }) {
      if (node.callee.type === 'Identifier' && node.callee.name === 'onAuthStateChanged'
          && node.arguments[0]?.type === 'Identifier' && node.arguments[0].name === 'FIREBASE_AUTH') {
        callbacks.push(node.arguments[1]);
      }
    },
  });
  assert.equal(callbacks.length, 1, 'exercise the normal navigation authentication observer');
  const callback = callbacks[0];
  assert.ok(['ArrowFunctionExpression', 'FunctionExpression'].includes(callback.type));
  const writes = [], diagnostics = [];
  const console = Object.fromEntries(['log', 'debug', 'info', 'warn', 'error', 'trace', 'dir', 'table']
    .map(level => [level, () => diagnostics.push(level)]));
  const observe = vm.runInNewContext(`(${source.slice(callback.start, callback.end)})`, {
    setUser: value => writes.push(value), console,
  }, { timeout: 1000 });
  return { observe, writes, diagnostics };
}

test('normal sign-in updates navigation without logging the credential-bearing user', () => {
  const dummyUser = Object.freeze({
    uid: 'dummy-user',
    stsTokenManager: Object.freeze({ accessToken: 'dummy-id-token', refreshToken: 'dummy-refresh-token' }),
    _tokenResponse: Object.freeze({ idToken: 'dummy-id-token', refreshToken: 'dummy-refresh-token' }),
  });
  const { observe, writes, diagnostics } = authenticationObserver();
  observe(dummyUser);
  assert.equal(writes.length, 1);
  assert.ok(writes[0] === dummyUser, 'retain the original authentication state transition');
  assert.equal(diagnostics.length, 0, 'authentication state must not be sent to diagnostics');
});

test('normal sign-out clears navigation state without authentication diagnostics', () => {
  const { observe, writes, diagnostics } = authenticationObserver();
  observe(null);
  assert.equal(writes.length, 1);
  assert.ok(writes[0] === null);
  assert.equal(diagnostics.length, 0, 'authentication state must not be sent to diagnostics');
});
