const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');
function nodes(tree,type) { return !tree || typeof tree !== 'object' ? [] : [...(tree.type === type ? [tree] : []), ...(tree.props?.children || []).flat(Infinity).flatMap(child=>nodes(child,type))]; }
function texts(tree) { return typeof tree === 'string' ? tree : !tree || typeof tree !== 'object' ? '' : (tree.props?.children || []).flat(Infinity).map(texts).join(''); }
function host(name, state) {
  const file = path.resolve(__dirname, '../../screens/' + name + '.js');
  assert.ok(fs.existsSync(file), 'production ' + name + ' exists');
  let cursor=0, effects=[]; const slots=[], calls=[];
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]));
  const memo=(f,deps)=>{const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={value:f(),deps};return slots[i].value;};
  const effect=(f,deps)=>{const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))effects.push(()=>{slots[i]?.cleanup?.();slots[i]={deps,cleanup:f()};});};
  const React={createElement:(type,props,...children)=>({type,props:{...props,children}}),useMemo:memo,useCallback:(f,d)=>memo(()=>f,d),useRef:v=>memo(()=>({current:v}),[]),useEffect:effect,useLayoutEffect:effect,
    useState:v=>{const i=cursor++;if(!slots[i])slots[i]={value:typeof v==='function'?v():v};return[slots[i].value,v=>{slots[i].value=typeof v==='function'?v(slots[i].value):v;}];}};
  const native=Object.fromEntries(['FlatList','Text','View','Pressable','ActivityIndicator','StatusBar','Image'].map(n=>[n,n]));
  Object.assign(native,{StyleSheet:{create:s=>s},Alert:{alert:(...args)=>calls.push(['alert',...args])}});
  const navigation={push:(...args)=>calls.push(['push',...args]),navigate:(...args)=>calls.push(['navigate',...args]),setOptions:value=>calls.push(['options',value]),goBack:()=>calls.push(['back'])};
  const dependencies={react:React,'react-native':native,'@react-navigation/native':{useNavigation:()=>navigation,useFocusEffect:fn=>effect(fn,[fn])},'react-native-safe-area-context':{useSafeAreaInsets:()=>({bottom:16})},
    '../reader/useMyHighlights':{useMyHighlightsCatalogue:()=>state,useMyHighlightsWork:()=>state},
    '../reader/normalHighlightStore':{normalMyHighlightsHandoff:{prepare:async value=>{calls.push(['prepare',value]);return{token:'request'};},cancel:()=>calls.push(['cancelHandoff'])}},
    '../reader/useReaderModalFocus':{__esModule:true,default:()=>({triggerRef:{current:null},restoreAfterClose(){},onDismiss(){},cancel(){}})},
    '../reader/ReaderHighlightsModal':{__esModule:true,default:'ReaderHighlightsModal'},'../reader/ReaderHighlightPicker':{__esModule:true,default:'ReaderHighlightPicker'}};
  dependencies['../reader/HighlightEntry']={__esModule:true,default:'HighlightEntry'};
  dependencies['../reader/HighlightOptionsModal']={__esModule:true,default:'HighlightOptionsModal'};
  dependencies['../reader/HighlightStorageStatus']={__esModule:true,default:'HighlightStorageStatus'};
  const module={exports:{}};
  const code=babel.transformFileSync(file,{babelrc:false,configFile:false,plugins:['@babel/plugin-transform-react-jsx','@babel/plugin-transform-modules-commonjs']}).code;
  vm.runInThisContext('(function(require,module,exports){'+code+'\n})',{filename:file})(name=>dependencies[name]||require(path.join(path.dirname(file),name)),module,module.exports);
  return{calls,render(){cursor=0;effects=[];const tree=module.exports.default({route:{params:{workKey:'hamlet',ownerGeneration:1}},navigation});effects.forEach(f=>f());return tree;}};
}
const owner={uid:'a',generation:1,ready:true};

test('overview and detail keep their navigation title without repeating it in the scrolling content',()=>{
  const state={owner,validOwner:true,play:{name:'Hamlet'},items:[],rows:[],loading:false,error:null,snapshot:{saving:false,error:null},isCurrent:()=>true,refreshReadOnly(){}};
  const overview=host('MyHighlightsScreen',state).render();
  assert.ok(!nodes(nodes(overview,'FlatList')[0].props.ListHeaderComponent,'Text').some(node=>texts(node)==='My Highlights'));
  const h=host('PlayHighlightsScreen',state),tree=h.render();
  assert.ok(!nodes(nodes(tree,'FlatList')[0].props.ListHeaderComponent,'Text').some(node=>texts(node)==='Hamlet'));
  const options=h.calls.find(call=>call[0]==='options')[1];
  assert.equal(options.title,'Hamlet');
  assert.equal(typeof options.headerTitle,'function','the single visible header supplies the focus fallback');
  const measured=()=>{};
  const title=options.headerTitle({children:'Hamlet',tintColor:'#fff8ef',onLayout:measured});
  assert.equal(texts(title),'Hamlet');
  assert.equal(title.props.accessibilityRole,'header');
  assert.equal(title.props.accessibilityLabel,'Hamlet');
  assert.equal(title.props.allowFontScaling,true);
  assert.equal(title.props.onLayout,measured);
  assert.equal(typeof title.props.ref,'function');
});
test('overview has one compact storage status while detail omits repeated storage and unavailable-record paragraphs',()=>{
  const state={owner,validOwner:true,play:{name:'Hamlet'},items:[],rows:[],loading:false,error:null,snapshot:{saving:false,error:null},isCurrent:()=>true,refreshReadOnly(){}};
  const overview=host('MyHighlightsScreen',state).render();
  const overviewHeader=nodes(overview,'FlatList')[0].props.ListHeaderComponent;
  assert.equal(nodes(overviewHeader,'HighlightStorageStatus').length,1);
  assert.doesNotMatch(texts(overviewHeader),/not synced|backed up|Counts include/);
  const detail=host('PlayHighlightsScreen',state).render();
  assert.doesNotMatch(texts(nodes(detail,'FlatList')[0].props.ListHeaderComponent),/not synced|backed up|Unavailable entries/);
});
test('detail shares the light entry layout and options delegate to the existing picker and removal confirmation',()=>{
  const item={id:'a',quotation:'Exact short quote',colorId:'sage',locationLabel:'Act I',status:'resolved',record:{id:'a',revision:1}};
  const state={owner,validOwner:true,play:{name:'Hamlet'},workId:'hamlet',loading:false,error:null,snapshot:{saving:false,error:null},items:[item],isCurrent:()=>true,refreshReadOnly(){},mutate:async()=>{},retryPending:async()=>{}};
  const h=host('PlayHighlightsScreen',state);let tree=h.render();const card=nodes(tree,'FlatList')[0].props.renderItem({item,index:0});
  const entry=nodes(card,'HighlightEntry')[0];assert.ok(entry,'both surfaces use the shared per-highlight presentation');assert.equal(entry.props.item,item);
  entry.props.onOptions('a');tree=h.render();let menu=nodes(tree,'HighlightOptionsModal')[0];assert.equal(menu.props.visible,true);
  menu.props.onEdit();tree=h.render();assert.equal(nodes(tree,'ReaderHighlightPicker')[0].props.visible,true);
  nodes(tree,'ReaderHighlightPicker')[0].props.onClose();tree=h.render();
  nodes(nodes(tree,'FlatList')[0].props.renderItem({item,index:0}),'HighlightEntry')[0].props.onOptions('a');
  nodes(h.render(),'HighlightOptionsModal')[0].props.onRemove();
  assert.equal(nodes(h.render(),'ReaderHighlightsModal')[0].props.removingId,'a');
});
test('normal overview is virtualized, distinguishes loading/empty/sign-out/errors and carries owner generation',()=>{
  const state={owner,loading:false,error:null,rows:[{workKey:'hamlet',title:'Hamlet',countLabel:'2 saved entries',available:true}],refreshReadOnly(){}};
  const h=host('MyHighlightsScreen',state);const tree=h.render();const list=nodes(tree,'FlatList')[0];assert.ok(list);assert.equal(list.props.data.length,1);assert.ok(list.props.initialNumToRender<=12);
  const card=list.props.renderItem({item:state.rows[0]});nodes(card,'Pressable')[0].props.onPress();assert.deepEqual(h.calls.find(c=>c[0]==='push'),['push','PlayHighlights',{workKey:'hamlet',ownerGeneration:1}]);
  state.rows=[];state.loading=true;assert.match(texts(nodes(h.render(),'FlatList')[0].props.ListEmptyComponent),/Loading/);
  state.loading=false;assert.match(texts(nodes(h.render(),'FlatList')[0].props.ListEmptyComponent),/Select a passage/);
  state.error={code:'READ_FAILED'};assert.match(texts(nodes(h.render(),'FlatList')[0].props.ListEmptyComponent),/could not be loaded/i);
  state.owner={uid:null,generation:2,ready:true};assert.match(texts(h.render()),/Sign in/);
});
test('detail virtualizes bounded previews and opens an exact single-quote modal, preserving unavailable rows',()=>{
  const exact='FIRST.\n'+ 'Exact original quotation. '.repeat(40);const item={id:'a',quotation:exact,colorId:'sage',locationLabel:'Prologue',status:'resolved',record:{id:'a',revision:1}};
  const state={owner,validOwner:true,play:{name:'Hamlet'},workId:'hamlet',loading:false,error:null,snapshot:{saving:false,error:null},items:[item,{id:'bad',status:'unreadable',detail:'Unavailable'}],isCurrent:()=>true,refreshReadOnly(){},mutate:async()=>{},retryPending:async()=>{}};
  const h=host('PlayHighlightsScreen',state);const tree=h.render();const list=nodes(tree,'FlatList')[0];assert.ok(list);assert.equal(list.props.data.length,2);assert.ok(list.props.initialNumToRender<=12);
  const card=list.props.renderItem({item,index:0});const entry=nodes(card,'HighlightEntry')[0];assert.equal(entry.props.item.quotation,exact);entry.props.onFullQuote('a');
  const modal=nodes(h.render(),'ReaderHighlightsModal')[0];assert.equal(modal.props.visible,true);assert.equal(modal.props.fullQuotation,true);assert.equal(modal.props.items.length,1);assert.equal(modal.props.items[0].quotation,exact);
  const bad=list.props.renderItem({item:state.items[1],index:1});assert.equal(nodes(bad,'HighlightEntry')[0].props.item.status,'unreadable');
});
test('destructive removal needs confirmation and read Retry remains separate from failed-change retry',()=>{
  let removed=0,read=0,retried=0;const item={id:'a',quotation:'Exact',colorId:'sage',locationLabel:'Epilogue',status:'resolved',record:{id:'a',revision:1}};
  const state={owner,validOwner:true,play:{name:'Hamlet'},workId:'hamlet',loading:false,error:{code:'READ_FAILED'},snapshot:{saving:false,error:{code:'WRITE_FAILED'}},items:[item],isCurrent:()=>true,refreshReadOnly:()=>read++,mutate:async method=>{if(method==='remove')removed++;},retryPending:async()=>retried++};
  const h=host('PlayHighlightsScreen',state);let tree=h.render();nodes(nodes(tree,'FlatList')[0].props.ListHeaderComponent,'Pressable').find(n=>n.props.accessibilityLabel==='Retry reading highlights').props.onPress();assert.equal(read,1);assert.equal(retried,0);
  const list=nodes(tree,'FlatList')[0];const card=list.props.renderItem({item,index:0});assert.equal(nodes(card,'HighlightEntry')[0].props.disabled,true);assert.equal(removed,0);
});
test('Remove cancellation writes nothing and completed confirmation closes only after persistence',async()=>{
  let release, removed=0;const gate=new Promise(resolve=>{release=resolve;});const item={id:'a',quotation:'Exact',colorId:'sage',locationLabel:'Epilogue',status:'resolved',record:{id:'a',revision:1}};
  const state={owner,validOwner:true,play:{name:'Hamlet'},workId:'hamlet',loading:false,error:null,snapshot:{saving:false,error:null},items:[item],isCurrent:()=>true,refreshReadOnly(){},mutate:async method=>{if(method==='remove'){await gate;removed++;}},retryPending:async()=>{}};
  const h=host('PlayHighlightsScreen',state);let list=nodes(h.render(),'FlatList')[0];nodes(list.props.renderItem({item,index:0}),'HighlightEntry')[0].props.onOptions('a');nodes(h.render(),'HighlightOptionsModal')[0].props.onRemove();
  let modal=nodes(h.render(),'ReaderHighlightsModal')[0];assert.equal(modal.props.removingId,'a');assert.equal(removed,0);modal.props.onCancelRemove();modal=nodes(h.render(),'ReaderHighlightsModal')[0];assert.equal(modal.props.removingId,null);assert.equal(removed,0);
  modal.props.onRequestRemove();modal=nodes(h.render(),'ReaderHighlightsModal')[0];modal.props.onConfirmRemove();assert.equal(removed,0);assert.equal(nodes(h.render(),'ReaderHighlightsModal')[0].props.saving,true);
  release();await new Promise(resolve=>setImmediate(resolve));assert.equal(removed,1);const completed=nodes(h.render(),'ReaderHighlightsModal')[0];assert.equal(completed.props.visible,false);assert.equal(completed.props.saving,false);
});
test('read failures do not offer pending-write replay and row triggers provide a modal focus return target',()=>{
  const item={id:'a',quotation:'Exact',colorId:'yellow',locationLabel:'Act I',status:'resolved',record:{id:'a',revision:1}};
  const state={owner,validOwner:true,play:{name:'Hamlet'},loading:false,error:null,snapshot:{saving:false,error:{code:'READ_FAILED'}},items:[item],isCurrent:()=>true,refreshReadOnly(){},mutate:async()=>{},retryPending:async()=>{}};
  const h=host('PlayHighlightsScreen',state);const list=nodes(h.render(),'FlatList')[0];const buttons=nodes(list.props.ListHeaderComponent,'Pressable');assert.equal(buttons.some(n=>n.props.accessibilityLabel==='Retry pending highlight change'),false);assert.ok(buttons.some(n=>n.props.accessibilityLabel==='Retry reading highlights'));
  const card=list.props.renderItem({item,index:0});assert.equal(typeof nodes(card,'HighlightEntry')[0].props.onTrigger,'function');
});
test('Show passage prepares an identifier request before navigating and account changes clear full quotations',async()=>{
  const item={id:'a',quotation:'Repeated quotation',colorId:'blue',locationLabel:'Prologue',status:'resolved',record:{id:'a',revision:7}};
  const state={owner,validOwner:true,play:{name:'Hamlet'},workId:'hamlet',store:{},loading:false,error:null,snapshot:{saving:false,error:null},items:[item],isCurrent:()=>true,refreshReadOnly(){},mutate:async()=>{},retryPending:async()=>{}};
  const h=host('PlayHighlightsScreen',state);const card=nodes(h.render(),'FlatList')[0].props.renderItem({item,index:0});nodes(card,'HighlightEntry')[0].props.onShow('a');assert.equal(h.calls.some(c=>c[0]==='push'),false);
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(h.calls.find(c=>c[0]==='prepare')[1],{store:state.store,workId:'hamlet',recordId:'a',expectedRevision:7});assert.deepEqual(h.calls.find(c=>c[0]==='push'),['push','ReadFolger',{id:'hamlet',openHighlight:{token:'request'}}]);
  state.owner={uid:'b',generation:2,ready:true};state.validOwner=false;assert.doesNotMatch(texts(h.render()),/Repeated quotation/);
});
test('pure storage-unavailable reads offer only read Retry, while a retained failed write stays separately actionable',async()=>{
  let reads=0,writes=0;const readError={code:'STORAGE_UNAVAILABLE'};const item={id:'a',quotation:'Exact',colorId:'sage',locationLabel:'Prologue',status:'resolved',record:{id:'a',revision:1}};
  const state={owner,validOwner:true,play:{name:'Hamlet'},loading:false,error:readError,snapshot:{saving:false,error:readError,readError,writeBlocked:false},items:[item],isCurrent:()=>true,refreshReadOnly:()=>reads++,mutate:async()=>{},retryPending:async()=>writes++};
  const h=host('PlayHighlightsScreen',state);let list=nodes(h.render(),'FlatList')[0];let headerButtons=nodes(list.props.ListHeaderComponent,'Pressable');assert.equal(headerButtons.some(n=>n.props.accessibilityLabel==='Retry pending highlight change'),false);
  nodes(list.props.renderItem({item,index:0}),'HighlightEntry')[0].props.onFullQuote('a');let modal=nodes(h.render(),'ReaderHighlightsModal')[0];assert.equal(modal.props.retryLabel,'Retry reading highlights');assert.equal(modal.props.onRetryPending,undefined);modal.props.onRetry();assert.equal(reads,1);assert.equal(writes,0);
  state.snapshot.error={code:'STORAGE_UNAVAILABLE'};state.snapshot.writeBlocked=true;modal=nodes(h.render(),'ReaderHighlightsModal')[0];assert.equal(typeof modal.props.onRetryPending,'function');modal.props.onRetryPending();await new Promise(resolve=>setImmediate(resolve));assert.equal(writes,1);assert.equal(reads,1);
});

test('normal overview passes actual synchronization status without repeating local-only claims',()=>{
  const status={label:'Syncing',error:null,onRetry:undefined};
  const state={owner,rows:[],loading:false,error:null,storageStatus:status};
  const header=nodes(host('MyHighlightsScreen',state).render(),'FlatList')[0].props.ListHeaderComponent;
  const props=nodes(header,'HighlightStorageStatus')[0].props;
  assert.equal(props.label,'Syncing');assert.equal(props.error,null);
});

test('detail exposes deletion conflict decisions through the existing mutation and full-quote handlers',async()=>{
  const calls=[];const item={id:'a',quotation:'Exact retained quote',locationLabel:'Act I',colorId:'blue',status:'conflict',syncConflict:true,retainedDeletion:true,record:{id:'a',revision:1}};
  const state={owner,validOwner:true,play:{name:'Hamlet'},workId:'hamlet',items:[item],loading:false,error:null,snapshot:{saving:false,error:null},isCurrent:()=>true,mutate:async(...args)=>calls.push(args),synchronizationEnabled:true};
  const h=host('PlayHighlightsScreen',state);const card=nodes(h.render(),'FlatList')[0].props.renderItem({item,index:0});
  assert.equal(nodes(card,'HighlightEntry')[0].props.onOptions,undefined);
  assert.match(texts(card),/local removal/);const keep=nodes(card,'Pressable').find(node=>node.props.accessibilityLabel==='Keep cloud highlight 1');assert.ok(keep);await keep.props.onPress();
  assert.deepEqual(calls,[['resolveConflict','a','use-cloud']]);
  nodes(card,'HighlightEntry')[0].props.onFullQuote('a');const modal=nodes(h.render(),'ReaderHighlightsModal')[0];assert.equal(modal.props.synchronizationEnabled,true);assert.equal(typeof modal.props.onResolveSync,'function');
});
