const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function host({runtime,canonicalDocument}={}) {
  const file = path.resolve(__dirname, '../../reader/useMyHighlights.js');
  assert.ok(fs.existsSync(file), 'production shared local highlights hooks exist');
  let owner = { uid: 'a', generation: 1, ready: true }, cursor = 0, effects = [], canonicalCalls = 0;
  const slots = [], stores = new Map(), reads = [], mutations = [];
  const same = (a,b) => a && b && a.length === b.length && a.every((v,i) => Object.is(v,b[i]));
  const memo = (f,deps) => { const i = cursor++; if (!slots[i] || !same(slots[i].deps,deps)) slots[i] = { value: f(), deps }; return slots[i].value; };
  const effect = (f,deps) => { const i = cursor++; if (!slots[i] || !same(slots[i].deps,deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: f() }; }); };
  const React = { useMemo: memo, useCallback: (f,d) => memo(() => f,d), useRef: value => memo(() => ({current:value}),[]), useEffect: effect,
    useState: initial => { const i = cursor++; if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }]; },
    useSyncExternalStore: (subscribe,getSnapshot) => { effect(() => subscribe(() => {}),[subscribe]); return getSnapshot(); } };
  function storeFor(id) {
    if (!stores.has(id)) { const gate = deferred(); const snapshot = { hydrated: true, loading: false, error: null, works: [{workKey:'hamlet',workId:'hamlet',count:1}], records: [], unresolved: [], unreadable: [], conflicts: [] };
      stores.set(id, { gate, snapshot, getSnapshot: () => snapshot, subscribe: () => () => {}, refreshReadOnly: () => { reads.push(id); return gate.promise; }, recolor: (...args) => { mutations.push(args); return Promise.resolve(); }, retry: () => { mutations.push(['retry']); return Promise.resolve(); } }); }
    return stores.get(id);
  }
  const dependencies = {
    react: React, './useHighlightOwner': { __esModule: true, default: () => owner, highlightOwner: { getSnapshot: () => owner } },
    './normalHighlightStore': { normalHighlightRuntime:runtime,normalHighlightManager: runtime?.manager || { forAccount: ({uid}) => storeFor(uid), forWork: ({uid,canonical}) => storeFor(uid + '/' + canonical.workId), forStoredWork: ({uid,workKey}) => storeFor(uid + '/' + workKey) } },
    '../shared/localPlayService': { PLAYS: [{id:'hamlet',name:'Hamlet'}], getLocalPlayEntry: id => id === 'hamlet' ? { play:{id}, sections:[] } : undefined },
    '../shared/contentText': { buildCanonicalDocument: entry => { canonicalCalls++; return canonicalDocument || {workId:entry.play.id}; } },
    './readerNavigation': { buildReaderNavigation: () => ({items:[]}) },
    './myHighlightsPresentation': require('../../reader/myHighlightsPresentation'),
    './highlightSyncPresentation':require('../../reader/highlightSyncPresentation'),
  };
  const module = {exports:{}};
  const code = babel.transformFileSync(file,{babelrc:false,configFile:false,plugins:['@babel/plugin-transform-modules-commonjs']}).code;
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})',{filename:file})(name => dependencies[name],module,module.exports);
  return { stores, reads, mutations, storeFor, setOwner: value => { owner=value; }, get canonicalCalls(){return canonicalCalls;},
    render(kind='catalogue',params) { cursor=0;effects=[];const value = kind === 'catalogue' ? module.exports.useMyHighlightsCatalogue() : module.exports.useMyHighlightsWork(params); effects.forEach(f => f());return value; },
    unmount() { slots.forEach(s => s?.cleanup?.()); } };
}
test('catalogue waits for the current account queue and never prepares canonical text', async () => {
  const h=host(); let value=h.render();
  assert.equal(value.loading,true); assert.deepEqual(value.rows,[]); assert.equal(h.canonicalCalls,0);
  h.storeFor('a').gate.resolve(); await new Promise(r=>setImmediate(r)); value=h.render();
  assert.equal(value.loading,false); assert.equal(value.rows[0].title,'Hamlet'); assert.equal(h.canonicalCalls,0);
  h.unmount();
});

test('normal My Highlights detail opens the real shared durable runtime and read Retry never replays cloud writes',async()=>{
  const {createNormalHighlightRuntime}=require('../../reader/normalHighlightRuntime');
  const {canonical,storageFixture}=require('./highlightSyncFixture.cjs');
  const f=storageFixture(),calls=[];
  const runtime=createNormalHighlightRuntime({storage:f.storage,configuration:{storageMode:'durable-v2',enabled:true,migrationApproved:true},
    createBackend:()=>({commit(){calls.push('commit');throw Error('unexpected');},listen(uid,work,next){calls.push(['listen',uid,work]);next([]);return()=>{};},listenWorks(uid,next){next([]);return()=>{};}}),resolveCanonical:()=>canonical});
  await runtime.setOwner('a');const h=host({runtime,canonicalDocument:canonical});h.render('work',{workKey:'hamlet',ownerGeneration:1});
  await new Promise(resolve=>setImmediate(resolve));let value=h.render('work',{workKey:'hamlet',ownerGeneration:1});
  assert.ok(calls.some(call=>Array.isArray(call)&&call[0]==='listen'));
  assert.equal(value.store,runtime.manager.forWork({uid:'a',canonical}));assert.equal(value.synchronizationEnabled,true);assert.equal(value.synchronizationMode,'production');
  await value.refreshReadOnly();assert.equal(calls.includes('commit'),false);
  h.setOwner({uid:'b',generation:2,ready:true});await runtime.setOwner('b');await assert.rejects(value.mutate('remove','old'),{code:'CANCELLED'});
  h.unmount();runtime.dispose();
});
test('A to B to A cannot expose cached quotations before the new generation finishes its read', async () => {
  const h=host(); h.render(); h.storeFor('a').gate.resolve(); await new Promise(r=>setImmediate(r)); assert.equal(h.render().rows.length,1);
  h.setOwner({uid:'b',generation:2,ready:true}); assert.deepEqual(h.render().rows,[]);
  const gate=deferred(); h.storeFor('a').gate=gate; h.storeFor('a').refreshReadOnly=()=>gate.promise;
  h.setOwner({uid:'a',generation:3,ready:true}); assert.deepEqual(h.render().rows,[]);
  h.storeFor('b').gate.resolve(); await new Promise(r=>setImmediate(r)); assert.deepEqual(h.render().rows,[]);
  gate.resolve(); await new Promise(r=>setImmediate(r)); assert.equal(h.render().rows.length,1);
});
test('read retry never calls write retry, and stale route generations prepare no private store', async () => {
  const h=host(); h.render(); h.storeFor('a').gate.reject(Object.assign(new Error('read'),{code:'READ_FAILED'})); await new Promise(r=>setImmediate(r));
  const value=h.render(); assert.ok(value.error); assert.deepEqual(value.rows,[]); await value.refreshReadOnly();
  assert.equal(h.mutations.length,0);
  const detail=host(); const stale=detail.render('work',{workKey:'hamlet',ownerGeneration:0});
  assert.equal(stale.validOwner,false); assert.equal(detail.stores.size,0); assert.equal(detail.canonicalCalls,0);
});
test('selected-play detail prepares only its canonical map and guards queued mutations after account changes', async () => {
  const h=host(); let value=h.render('work',{workKey:'hamlet',ownerGeneration:1}); assert.equal(h.canonicalCalls,1); assert.deepEqual(value.items,[]);
  h.storeFor('a/hamlet').gate.resolve();await new Promise(resolve=>setImmediate(resolve));value=h.render('work',{workKey:'hamlet',ownerGeneration:1});assert.equal(h.canonicalCalls,1);
  await value.mutate('recolor','existing','blue');assert.equal(h.mutations[0][0],'existing');assert.equal(h.mutations[0][1],'blue');assert.equal(h.mutations[0][2].isCurrent(),true);
  h.setOwner({uid:'b',generation:2,ready:true});assert.equal(h.mutations[0][2].isCurrent(),false);await assert.rejects(value.mutate('recolor','existing','rose'),{code:'CANCELLED'});
  assert.equal(h.mutations.length,1);
});
test('unknown stored work remains reachable without a canonical map and sign-out exposes no cached rows', async () => {
  const h=host();let value=h.render('work',{workKey:'unknown%2Fwork',ownerGeneration:1});assert.equal(h.canonicalCalls,0);assert.ok(value.store);h.storeFor('a/unknown%2Fwork').gate.resolve();await new Promise(resolve=>setImmediate(resolve));
  value=h.render('work',{workKey:'unknown%2Fwork',ownerGeneration:1});assert.equal(value.play,null);
  h.setOwner({uid:null,generation:2,ready:true});value=h.render('work',{workKey:'unknown%2Fwork',ownerGeneration:1});assert.deepEqual(value.items,[]);assert.equal(value.validOwner,false);
});
test('catalogue read errors published after hydration remain visible without replaying a change',async()=>{
  const h=host();h.render();h.storeFor('a').gate.resolve();await new Promise(resolve=>setImmediate(resolve));h.render();
  h.storeFor('a').snapshot.error={code:'READ_FAILED'};const value=h.render();assert.equal(value.error.code,'READ_FAILED');assert.equal(h.mutations.length,0);
});
