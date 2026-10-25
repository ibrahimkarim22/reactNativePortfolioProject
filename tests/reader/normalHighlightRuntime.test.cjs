const assert = require('node:assert/strict');
const test = require('node:test');
const { canonical, ref, legacyRecord, storageFixture, accepted } = require('./highlightSyncFixture.cjs');
const { buildCanonicalDocument, createSelection } = require('../../shared/contentText');
const disabled = Object.freeze({ enabled:false, storageMode:'legacy-v1', migrationApproved:false });
const durable = Object.freeze({ enabled:true, storageMode:'durable-v2', migrationApproved:true });
const oldKey = (id='legacy-id',uid='alice',work='hamlet') => '@bard/reader-highlights:v1/'+encodeURIComponent(uid)+'/'+encodeURIComponent(work)+'/'+encodeURIComponent(id);
const tick = () => new Promise(resolve => setImmediate(resolve));
const load = () => require('../../reader/normalHighlightRuntime').createNormalHighlightRuntime;
function backend() {
  const listeners=new Map(), catalogue=new Map(), cloud=new Map(), calls=[];
  return {calls, transport: {
    async commit(operation,options) {
      if(options?.isCurrent && !options.isCurrent())throw Object.assign(new Error('cancelled'),{code:'CANCELLED'});
      calls.push(['commit',operation.uid,operation.workId,operation.operationId]);
      const result=accepted(operation); cloud.set(operation.uid+'/'+operation.workId,[{cloudKey:operation.cloudKey,cloud:result.cloud}]);return result;
    },
    listen(uid,work,onRows) {calls.push(['listen',uid,work]);listeners.set(uid+'/'+work,onRows);queueMicrotask(()=>onRows(cloud.get(uid+'/'+work)||[]));return()=>listeners.delete(uid+'/'+work);},
    listenWorks(uid,onRows) {calls.push(['works',uid]);catalogue.set(uid,onRows);queueMicrotask(()=>onRows([]));return()=>catalogue.delete(uid);},
  },
  emitWorks(uid,rows){catalogue.get(uid)?.(rows);},
  emit(uid,work,rows){listeners.get(uid+'/'+work)?.(rows);},
  setCloud(uid,work,rows){cloud.set(uid+'/'+work,rows);},
  };
}
function create(storage, configuration=durable, transport=backend().transport, extra={}) {
  let ids=0;
  return load()({storage,configuration,createBackend:()=>transport,resolveCanonical:id=>id==='hamlet'?canonical:null,
    storeOptions:{makeId:()=> 'adapter-'+(++ids),now:()=>1000},coordinatorOptions:{schedule:()=>1,cancelSchedule(){}},...extra});
}

test('default normal application remains v1 with no sync initialization, migration or backend calls',async()=>{
  const source=JSON.stringify(legacyRecord());const f=storageFixture({[oldKey()]:source});let factory=0;
  const syncFile=require.resolve('../../reader/highlightSyncStore');const before=!!require.cache[syncFile];
  const runtime=create(f.storage,disabled,null,{createBackend:()=>{factory++;throw Error('forbidden');}});
  assert.equal(runtime.storageMode,'legacy-v1');assert.equal(runtime.enabled,false);assert.equal(runtime.coordinator,null);assert.equal(factory,0);assert.equal(!!require.cache[syncFile],before);assert.equal(f.calls.length,0);
  await runtime.setOwner('alice');const work=runtime.manager.forWork({uid:'alice',canonical});await work.hydrate();
  assert.equal(work.getSnapshot().records[0].id,'legacy-id');assert.equal(f.data.get(oldKey()),source);assert.equal(f.calls.some(call=>call[0]==='set'),false);runtime.dispose();
});

test('invalid activation is rejected before storage reads or backend construction',()=>{
  const f=storageFixture();for(const configuration of [{enabled:'true',storageMode:'durable-v2',migrationApproved:true},{enabled:true,storageMode:'legacy-v1',migrationApproved:true},{enabled:false,storageMode:'unknown',migrationApproved:false}]){
    assert.throws(()=>create(f.storage,configuration),{code:'SYNC_ACTIVATION_REQUIRED'});
  }assert.equal(f.calls.length,0);
});

test('normal durable migration preserves actual v1 bytes and IDs, and reopening never duplicates upload',async()=>{
  const source=JSON.stringify(legacyRecord());const f=storageFixture({[oldKey()]:source});const b=backend();
  const runtime=create(f.storage,durable,b.transport);await runtime.setOwner('alice');await runtime.flush();await tick();
  const work=runtime.manager.forWork({uid:'alice',canonical});await work.hydrate();assert.equal(work.getSnapshot().records[0].id,'legacy-id');assert.deepEqual(work.getSnapshot().records[0].selectionRef,ref());assert.equal(f.data.get(oldKey()),source);
  assert.equal(b.calls.filter(call=>call[0]==='commit').length,1);const account=runtime.manager.forAccount({uid:'alice'});await account.refreshReadOnly();assert.equal(account.getSnapshot().works[0].localCount,1);
  runtime.dispose();const reopened=create(f.storage,durable,b.transport);await reopened.setOwner('alice');await reopened.flush();assert.equal(b.calls.filter(call=>call[0]==='commit').length,1);assert.equal(f.data.get(oldKey()),source);reopened.dispose();
});

test('fresh normal client discovers multiple remote plays without preparing any canonical map',async()=>{
  const f=storageFixture(),b=backend();let canonicalReads=0;
  const runtime=create(f.storage,durable,b.transport,{resolveCanonical:()=>{canonicalReads++;throw Error('overview must not load plays');}});await runtime.setOwner('alice');await tick();
  const metadata=revision=>({schemaVersion:1,activeCount:2,activeBytes:100,revision,lastOperationId:'remote-'+revision});
  b.emitWorks('alice',[{workId:'hamlet',metadata:metadata(1)},{workId:'the-tempest',metadata:metadata(2)}]);await tick();
  const account=runtime.manager.forAccount({uid:'alice'});await account.refreshReadOnly();const snapshot=account.getSnapshot();
  assert.deepEqual(snapshot.works.map(row=>[row.workId,row.count]),[['hamlet',2],['the-tempest',2]]);assert.equal(canonicalReads,0);
  assert.equal(b.calls.filter(call=>call[0]==='listen').length,0);runtime.dispose();
});

test('pending local changes survive read-only discovery and retry without write replay or blocked-state clearing',async()=>{
  const source=JSON.stringify(legacyRecord());const f=storageFixture({[oldKey()]:source});const runtime=create(f.storage,{...durable,enabled:false});await runtime.setOwner('alice');
  const work=runtime.manager.forWork({uid:'alice',canonical});await work.hydrate();const original=f.storage.setItem;f.storage.setItem=async()=>{throw Error('disk unavailable');};
  await assert.rejects(work.recolor('legacy-id','blue'),{code:'WRITE_FAILED'});const before=work.getSnapshot().error;
  const account=runtime.manager.forAccount({uid:'alice'});await account.refreshReadOnly();await work.refreshReadOnly();await account.refreshReadOnly();
  assert.equal(work.getSnapshot().writeBlocked,true);assert.equal(work.getSnapshot().error,before);assert.equal(work.getSnapshot().records[0].colorId,'yellow');
  f.storage.setItem=original;await work.retry();assert.equal(work.getSnapshot().records[0].colorId,'blue');runtime.dispose();
});

test('pausing transport and restarting in durable mode never resurrects a local deletion from retained v1',async()=>{
  const source=JSON.stringify(legacyRecord());const f=storageFixture({[oldKey()]:source});let factory=0;const configuration={...durable,enabled:false};
  const runtime=create(f.storage,configuration,null,{createBackend:()=>{factory++;throw Error('paused');}});await runtime.setOwner('alice');const work=runtime.manager.forWork({uid:'alice',canonical});await work.hydrate();await work.remove('legacy-id');runtime.dispose();
  const restarted=create(f.storage,{...configuration,migrationApproved:false});await restarted.setOwner('alice');const opened=restarted.manager.forWork({uid:'alice',canonical});await opened.hydrate();
  assert.equal(opened.getSnapshot().records.length,0);assert.equal(opened.getSnapshot().tombstones.length,1);assert.equal(factory,0);assert.equal(f.data.get(oldKey()),source);restarted.dispose();
});

test('normal raw unavailable entries remain recoverable and exact removal retains original bytes',async()=>{
  const f=storageFixture({[oldKey('a','alice','unknown-work')]:'{',[oldKey('a!','alice','unknown-work')]:'{'});
  const runtime=create(f.storage,{...durable,enabled:false,migrationApproved:false});await runtime.setOwner('alice');const account=runtime.manager.forAccount({uid:'alice'});await account.refreshReadOnly();assert.equal(account.getSnapshot().works[0].count,2);
  const raw=runtime.manager.forStoredWork({uid:'alice',workKey:'unknown-work'});await raw.refreshReadOnly();const entries=raw.getSnapshot().entries;assert.notEqual(entries[0].id,entries[1].id);await raw.remove(entries[1].id);
  await account.refreshReadOnly();assert.equal(account.getSnapshot().works[0].count,1);assert.equal(f.data.get(oldKey('a!','alice','unknown-work')),'{');assert.equal(f.data.get(oldKey('a','alice','unknown-work')),'{');runtime.dispose();
});

test('account changes clear catalogue immediately and stale account refresh cannot reveal returning-owner data',async()=>{
  const f=storageFixture({[oldKey()]:JSON.stringify(legacyRecord())});const runtime=create(f.storage,{...durable,enabled:false});await runtime.setOwner('alice');const a=runtime.manager.forAccount({uid:'alice'});await a.refreshReadOnly();assert.equal(a.getSnapshot().works.length,1);
  await runtime.setOwner('bob');assert.equal(a.getSnapshot().works.length,0);await assert.rejects(a.refreshReadOnly(),{code:'CANCELLED'});const b=runtime.manager.forAccount({uid:'bob'});await b.refreshReadOnly();assert.equal(b.getSnapshot().works.length,0);
  await runtime.setOwner('alice');assert.equal(a.getSnapshot().works.length,0);await a.refreshReadOnly();assert.equal(a.getSnapshot().works.length,1);runtime.dispose();
});


test('an unavailable injected backend reports discovery failure without falling back or dropping local data',async()=>{
  const source=JSON.stringify(legacyRecord()),f=storageFixture({[oldKey()]:source});
  const runtime=create(f.storage,durable,null,{createBackend:()=>{throw Object.assign(new Error('isolated services unavailable'),{code:'SYNC_EMULATOR_UNAVAILABLE'});}});
  await runtime.setOwner('alice');await runtime.flush();await tick();
  assert.equal(runtime.getSnapshot().discoveryError?.code,'SYNC_EMULATOR_UNAVAILABLE');assert.equal(runtime.storageMode,'durable-v2');
  const work=runtime.manager.forWork({uid:'alice',canonical});assert.equal(work.getSnapshot().records[0].id,'legacy-id');assert.ok(work.getSnapshot().syncSummary.pendingOperations>0);assert.equal(f.data.get(oldKey()),source);runtime.dispose();
});


test('normal reader hydrate cannot migrate an old owner after an account switch interrupts its read',async()=>{
  const source=JSON.stringify(legacyRecord()),f=storageFixture({[oldKey()]:source});const runtime=create(f.storage,{...durable,enabled:false});await runtime.setOwner('alice');
  const work=runtime.manager.forWork({uid:'alice',canonical});let release;const gate=new Promise(resolve=>{release=resolve;});const get=f.storage.getItem;f.storage.getItem=async key=>{if(key===oldKey())await gate;return get(key);};
  const opening=work.hydrate();await tick();await runtime.setOwner('bob');release();await assert.rejects(opening,{code:'CANCELLED'});
  assert.equal(f.calls.some(call=>call[0]==='set'),false);assert.equal(f.data.get(oldKey()),source);assert.equal(work.getSnapshot().records.length,0);runtime.dispose();
});

test('opening a play returns the same owned facade used by normal detail and reader views',async()=>{
  const f=storageFixture(),runtime=create(f.storage);await runtime.setOwner('alice');
  const detail=runtime.manager.forWork({uid:'alice',canonical}),reader=await runtime.openWork(canonical);
  assert.equal(reader,detail);assert.deepEqual(reader.pendingOperations(),[]);await runtime.setOwner('bob');assert.deepEqual(reader.getSnapshot().records,[]);runtime.dispose();
});

test('normal overview keeps acknowledged create and delete counts while the metadata listener echo is delayed',async()=>{
  const f=storageFixture(),b=backend();let revision=1;
  b.transport.commit=async operation=>{const result=accepted(operation);result.receipt.metadataRevision=++revision;result.metadata={schemaVersion:1,activeCount:operation.kind==='delete'?0:1,activeBytes:operation.kind==='delete'?0:result.cloud.payloadBytes,revision,lastOperationId:operation.operationId};return result;};
  const runtime=create(f.storage,durable,b.transport);await runtime.setOwner('alice');await tick();
  const stale={schemaVersion:1,activeCount:0,activeBytes:0,revision:1,lastOperationId:'prior-deletion'};b.emitWorks('alice',[{workId:'hamlet',metadata:stale}]);await tick();
  const account=runtime.manager.forAccount({uid:'alice'}),work=await runtime.openWork(canonical);const made=await work.create(ref(),'yellow');await runtime.flush();await account.refreshReadOnly();
  assert.equal(account.getSnapshot().works[0].count,1);assert.equal(work.getSnapshot().syncSummary.pending,0);
  b.emitWorks('alice',[{workId:'hamlet',metadata:stale}]);await tick();await account.refreshReadOnly();assert.equal(account.getSnapshot().works[0].count,1);
  const confirmedCreate=runtime.getSnapshot().works[0];await work.remove(made.record.id);await runtime.flush();await account.refreshReadOnly();assert.equal(account.getSnapshot().works.length,0);
  b.emitWorks('alice',[confirmedCreate]);await tick();await account.refreshReadOnly();assert.equal(account.getSnapshot().works.length,0);runtime.dispose();
});
