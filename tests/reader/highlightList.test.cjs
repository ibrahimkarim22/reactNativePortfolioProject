const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');
const { THEMES } = require('../../reader/readerConstants');
function load() {
  const file = path.resolve(__dirname, '../../reader/ReaderHighlightsModal.js');
  assert.ok(fs.existsSync(file), 'production saved-highlights panel exists');
  let cursor = 0, effects = [], dirty = false; const slots = [], focusCalls = [], focusTargets = [];
  const same = (a,b) => a && b && a.length === b.length && a.every((v,i) => Object.is(v,b[i]));
  const memo = (fn,deps) => { const i=cursor++; if(!slots[i] || !same(slots[i].deps,deps)) slots[i]={value:fn(),deps}; return slots[i].value; };
  const effect = (fn,deps) => { const i=cursor++; if(!slots[i] || !same(slots[i].deps,deps)) effects.push(() => {slots[i]?.cleanup?.();slots[i]={deps,cleanup:fn()};}); };
  const React = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), useRef: value => memo(() => ({current:value}), []), useMemo:memo, useCallback:(fn,deps)=>memo(()=>fn,deps), useEffect:effect,
    useState: initial => { const slot=memo(()=>({value:initial}),[]);return[slot.value,next=>{const value=typeof next==='function'?next(slot.value):next;if(!Object.is(value,slot.value)){slot.value=value;dirty=true;}}];} };
  const native = Object.fromEntries(['Modal', 'Pressable', 'ScrollView', 'Text', 'View', 'ActivityIndicator'].map(n => [n, n]));
  Object.assign(native, { StyleSheet: { create: s => s }, AccessibilityInfo: { setAccessibilityFocus() {} }, findNodeHandle: () => null });
  const module = { exports: {} };
  const code = babel.transformFileSync(file, { babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: file })(name => {
    if (name === 'react') return React;
    if (name === 'react-native') return native;
    if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ bottom: 24 }) };
    if(name === './HighlightEntry')return {__esModule:true,default:'HighlightEntry'};
    if(name === './HighlightOptionsModal')return {__esModule:true,default:'HighlightOptionsModal'};
    if(name === './useReaderModalFocus')return {__esModule:true,default:()=>{const triggerRef=React.useRef(null);return {triggerRef,restoreAfterClose:()=>{focusCalls.push('restore');focusTargets.push(triggerRef.current);},onDismiss(){},cancel:()=>focusCalls.push('cancel')};}};
    return require(path.join(path.dirname(file), name));
  }, module, module.exports);
  const Panel = props => {let tree, attempts=0;do{assert.ok(++attempts<20,'modal state settles');cursor=0;effects=[];dirty=false;tree=module.exports.default(props);effects.forEach(fn=>fn());}while(dirty);return tree;};
  Panel.focusCalls=focusCalls;Panel.focusTargets=focusTargets;
  return Panel;
}
function nodes(tree, type) { return !tree || typeof tree !== 'object' ? [] : [...(tree.type === type ? [tree] : []), ...(tree.props?.children || []).flat(Infinity).flatMap(x => nodes(x, type))]; }
function texts(tree) { return typeof tree === 'string' ? tree : !tree || typeof tree !== 'object' ? '' : (tree.props?.children || []).flat(Infinity).map(texts).join(''); }
const items = [
  { id: 'a', quotation: 'FIRST.\nThe exact passage.', locationLabel: 'Act I, Scene II', colorId: 'sage', status: 'resolved' },
  { id: 'b', quotation: 'An older quotation', locationLabel: 'Older text version', colorId: 'blue', status: 'unresolved' },
  { id: 'c', quotation: 'Overlapping quotation', locationLabel: 'Act II', colorId: 'rose', status: 'conflict' },
  { id: 'd', status: 'unreadable' },
];

test('sync states and deletion backlog stay visible without disabling local actions or claiming backup', () => {
  const Panel = load(); let retried = 0, resolved;
  const tree = Panel({ visible: true, items: [{ ...items[0], syncLabel: 'Saved locally · sync failed', syncConflict: true }], theme: THEMES.paper,
    storageNotice: 'Emulator test only. Production synchronization is disabled.', syncNotice: '1 deletion pending sync',
    syncError: 'Permission denied. Local data is retained.', onRetrySync: () => retried++, onResolveSync: (...args) => { resolved = args; } });
  assert.match(texts(tree), /Production synchronization is disabled/);
  assert.match(texts(tree), /1 deletion pending sync/);
  assert.match(nodes(tree,'HighlightEntry')[0].props.item.syncLabel,/sync failed/);
  const buttons = nodes(tree, 'Pressable');
  nodes(tree,'HighlightEntry')[0].props.onOptions('a');const menu=nodes(Panel({visible:true,items:[{...items[0],syncConflict:true}],theme:THEMES.paper}),'HighlightOptionsModal')[0];assert.equal(menu.props.canEdit,true);
  buttons.find(n => n.props.accessibilityLabel === 'Retry synchronization').props.onPress(); assert.equal(retried, 1);
  buttons.find(n => n.props.accessibilityLabel === 'Use cloud color 1').props.onPress(); assert.deepEqual(resolved, ['a', 'use-cloud']);
});
test('a cloud-only conflict offers color decisions without falsely reporting an overlapping quotation', () => {
  const Panel = load();
  const tree = Panel({ visible: true, items: [{ ...items[0], status: 'conflict', syncConflict: true, overlapConflict: false }], theme: THEMES.paper });
  assert.match(texts(tree), /cloud color differs/);
  assert.doesNotMatch(texts(tree), /overlaps another/);
  const buttons = nodes(tree, 'Pressable');
  assert.ok(buttons.some(n => n.props.accessibilityLabel === 'Use cloud color 1'));
  assert.ok(buttons.some(n => n.props.accessibilityLabel === 'Reapply local color 1'));
});

test('deletion conflicts offer an explicit cloud decision without a misleading recolor or silent recreation', () => {
  for (const [flags, label] of [[{ syncDeletion: true }, 'Keep cloud deletion 1'], [{ retainedDeletion: true }, 'Keep cloud highlight 1']]) {
    const Panel = load(); let resolved;
    const tree = Panel({ visible: true, theme: THEMES.paper, items: [{ ...items[0], status: 'conflict', syncConflict: true, ...flags }],
      onResolveSync: (...args) => { resolved = args; } });
    const buttons = nodes(tree, 'Pressable');
    const decision = buttons.find(node => node.props.accessibilityLabel === label);
    assert.ok(decision);
    assert.ok(!buttons.some(node => node.props.accessibilityLabel?.startsWith('Reapply local color')));
    decision.props.onPress(); assert.deepEqual(resolved, ['a', 'use-cloud']);
    if (flags.retainedDeletion) assert.equal(nodes(tree, 'HighlightEntry')[0].props.onOptions, undefined);
  }
});
test('combined conflicts show both explanations and legacy overlap records retain their warning', () => {
  const Panel = load();
  const combined = Panel({ visible: true, items: [{ ...items[0], status: 'conflict', syncConflict: true, overlapConflict: true }], theme: THEMES.paper });
  assert.match(texts(combined), /cloud color differs/);
  assert.equal(nodes(combined,'HighlightEntry')[0].props.item.overlapConflict,true);
  const legacy = Panel({ visible: true, items: [items[2]], theme: THEMES.paper });
  assert.equal(nodes(legacy,'HighlightEntry')[0].props.item.status,'conflict');
  assert.doesNotMatch(texts(legacy), /cloud color differs/);
});
test('list retains exact quotations and unavailable entries without repeating a storage disclaimer', () => {
  const Panel = load(); const shown = [], edited = [], requested = [];
  const tree = Panel({ visible: true, items, theme: THEMES.paper, onShow: id => shown.push(id), onEdit: id => edited.push(id), onRequestRemove: id => requested.push(id) });
  assert.doesNotMatch(texts(tree), /not synced or guaranteed backed up/);
  assert.equal(nodes(tree,'HighlightEntry')[0].props.item.quotation,items[0].quotation);
  const entries=nodes(tree,'HighlightEntry'); entries[0].props.onShow('a');assert.deepEqual(shown,['a']);
  entries[0].props.onOptions('a');let current=Panel({ visible:true,items,theme:THEMES.paper,onEdit:id=>edited.push(id),onRequestRemove:id=>requested.push(id) });
  nodes(current,'HighlightOptionsModal')[0].props.onEdit();assert.deepEqual(edited,['a']);
  for(const index of [1,2]){entries[index].props.onShow(items[index].id);entries[index].props.onOptions(items[index].id);current=Panel({visible:true,items,theme:THEMES.paper});assert.equal(nodes(current,'HighlightOptionsModal')[0].props.canEdit,false);}
  entries[3].props.onOptions('d');current=Panel({visible:true,items,theme:THEMES.paper,onRequestRemove:id=>requested.push(id)});nodes(current,'HighlightOptionsModal')[0].props.onRemove();assert.deepEqual(requested,['d']);
  assert.equal(nodes(tree,'HighlightEntry')[2].props.item.status,'conflict');assert.equal(nodes(tree,'HighlightEntry')[3].props.item.status,'unreadable');
});
test('removal requires explicit confirmation; cancellation and Android Back never mutate a record', () => {
  const Panel = load(); let removed = 0, cancelled = 0, closed = 0;
  let tree = Panel({ visible: true, items, theme: THEMES.night, removingId: 'a', onConfirmRemove: () => removed++, onCancelRemove: () => cancelled++, onClose: () => closed++ });
  assert.equal(removed, 0);
  nodes(tree, 'Modal')[0].props.onRequestClose(); assert.equal(cancelled, 1); assert.equal(closed, 0);
  nodes(tree, 'Pressable').find(n => n.props.accessibilityLabel === 'Confirm remove highlight').props.onPress(); assert.equal(removed, 1);
  tree = Panel({ visible: true, items, theme: THEMES.night, saving: true, removingId: 'a', onConfirmRemove: () => removed++, onCancelRemove: () => cancelled++ });
  const remove = nodes(tree, 'Pressable').find(n => n.props.accessibilityLabel === 'Confirm remove highlight');
  assert.equal(remove.props.disabled, true); remove.props.onPress(); assert.equal(removed, 1);
});
test('storage and paint errors expose Retry, all content remains in a scrollable native modal', () => {
  const Panel = load(); let retries = 0;
  const tree = Panel({ visible: true, items, theme: THEMES.sepia, error: 'Highlights could not be loaded. Retry.', renderError: 'Painting is unavailable.', onRetry: () => retries++ });
  assert.match(texts(tree), /could not be loaded/); assert.match(texts(tree), /Painting is unavailable/);
  nodes(tree, 'Pressable').find(n => n.props.accessibilityLabel === 'Retry highlights').props.onPress(); assert.equal(retries, 1);
  assert.equal(nodes(tree, 'View').some(n => n.props.accessibilityViewIsModal), true);
  assert.ok(nodes(tree, 'ScrollView').length);
});

test('Show passage stays unavailable until current paint is acknowledged, without disabling cancellation', () => {
  const Panel = load(); const tree = Panel({ visible: true, items, theme: THEMES.paper, painting: true });
  assert.equal(nodes(tree, 'HighlightEntry')[0].props.painting, true);
  assert.equal(nodes(tree, 'Pressable').find(n => n.props.accessibilityLabel === 'Close highlights').props.disabled, false);
});
test('optional explicit pending-change retry stays separate from labeled read-only retry', () => {
  const Panel = load(); let reads = 0, writes = 0;
  const tree = Panel({ visible: true, items, theme: THEMES.night, error: 'Storage needs attention.', retryLabel: 'Retry reading highlights', onRetry: () => reads++, onRetryPending: () => writes++ });
  const buttons = nodes(tree, 'Pressable');
  buttons.find(n => n.props.accessibilityLabel === 'Retry reading highlights').props.onPress();
  assert.equal(reads, 1); assert.equal(writes, 0);
  buttons.find(n => n.props.accessibilityLabel === 'Retry pending highlight change').props.onPress();
  assert.equal(reads, 1); assert.equal(writes, 1);
  const writeOnly = Panel({ visible: true, items, theme: THEMES.night, error: 'Save failed.', onRetryPending: () => writes++ });
  assert.equal(nodes(writeOnly, 'Pressable').some(n => n.props.accessibilityLabel === 'Retry highlights'), false);
});


test('fixed modal header has an accessible close target and no scrolling footer',()=>{
  const Panel=load();const tree=Panel({visible:true,items,theme:THEMES.paper});
  const close=nodes(tree,'Pressable').filter(n=>n.props.accessibilityLabel==='Close highlights');assert.equal(close.length,1);
  const style=Object.assign({},...[typeof close[0].props.style==='function'?close[0].props.style({pressed:false}):close[0].props.style].flat().filter(Boolean));assert.ok(style.minWidth>=48 && style.minHeight>=48);
  assert.ok(nodes(tree,'ScrollView').every(scroll=>!nodes(scroll,'Pressable').some(n=>n.props.accessibilityLabel==='Close highlights')));
  assert.doesNotMatch(texts(close[0]),/Close highlights/);
});
test('full quotation is exact, retains the list scroll view and Android Back returns before dismissing',()=>{
  const Panel=load();let closed=0;const exact='Long original quotation. '.repeat(100);const source=[{...items[0],quotation:exact}];const props={visible:true,items:source,theme:THEMES.night,onClose:()=>closed++};
  let tree=Panel(props);nodes(tree,'HighlightEntry')[0].props.onFullQuote('a');tree=Panel(props);
  const scrolls=nodes(tree,'ScrollView');assert.equal(scrolls.length,2);assert.equal(Object.assign({},...scrolls[0].props.style.filter(Boolean)).display,'none');
  const full=nodes(scrolls[1],'HighlightEntry')[0];assert.equal(full.props.fullQuotation,true);assert.equal(full.props.item.quotation,exact);
  nodes(tree,'Modal')[0].props.onRequestClose();tree=Panel(props);assert.equal(closed,0);assert.equal(nodes(tree,'ScrollView').length,1);
  nodes(tree,'Modal')[0].props.onRequestClose();assert.equal(closed,1);assert.equal(source[0].quotation,exact);
});
test('options cancel restores its trigger while saving blocks mutations but never traps its menu',()=>{
  const Panel=load();let edited=0,removed=0;const props={visible:true,items,theme:THEMES.paper,onEdit:()=>edited++,onRequestRemove:()=>removed++};
  let tree=Panel(props);nodes(tree,'HighlightEntry')[0].props.onOptions('a');tree=Panel(props);let menu=nodes(tree,'HighlightOptionsModal')[0];assert.equal(menu.props.visible,true);menu.props.onClose();tree=Panel(props);assert.equal(nodes(tree,'HighlightOptionsModal')[0].props.visible,false);assert.ok(Panel.focusCalls.includes('restore'));assert.equal(edited+removed,0);
  nodes(tree,'HighlightEntry')[0].props.onOptions('a');tree=Panel(props);nodes(tree,'HighlightOptionsModal')[0].props.onEdit();assert.equal(edited,1);assert.equal(removed,0);
  nodes(tree,'HighlightEntry')[0].props.onOptions('a');tree=Panel({...props,saving:true});menu=nodes(tree,'HighlightOptionsModal')[0];menu.props.onRemove();assert.equal(removed,0);assert.equal(menu.props.disabled,true);menu.props.onClose();tree=Panel({...props,saving:true});assert.equal(nodes(tree,'HighlightOptionsModal')[0].props.visible,false);
});


test('closing full quotation returns to its original preview trigger after using its options menu',()=>{
  const Panel=load();const props={visible:true,items:[{...items[0],quotation:'Original long quotation. '.repeat(80)}],theme:THEMES.paper};
  const previewTarget={nativeTag:1},optionsTarget={nativeTag:2};
  let tree=Panel(props);let entry=nodes(tree,'HighlightEntry')[0];entry.props.onTrigger(previewTarget);entry.props.onFullQuote('a');
  tree=Panel(props);entry=nodes(nodes(tree,'ScrollView')[1],'HighlightEntry')[0];entry.props.onTrigger(optionsTarget);entry.props.onOptions('a');
  tree=Panel(props);nodes(tree,'HighlightOptionsModal')[0].props.onClose();tree=Panel(props);
  nodes(tree,'Modal')[0].props.onRequestClose();
  assert.equal(Panel.focusTargets.at(-1),previewTarget,'full-view options must not overwrite the retained list trigger');
});


test('expanded quotation exposes live storage and paint failures with the existing distinct Retry handlers',()=>{
  const Panel=load();let read=0,write=0,sync=0;const props={visible:true,items:[{...items[0],quotation:'Exact retained passage. '.repeat(100)}],theme:THEMES.paper,onRetry:()=>read++,onRetryPending:()=>write++,onRetrySync:()=>sync++};
  let tree=Panel(props);nodes(tree,'HighlightEntry')[0].props.onFullQuote('a');
  props.error='The change could not be saved.';props.renderError='Current painting is unavailable.';props.syncNotice='One pending synchronization';props.syncError='Permission denied; local data retained.';props.loading=true;props.removingId='a';
  tree=Panel(props);const scrolls=nodes(tree,'ScrollView');assert.equal(scrolls.length,2);const full=scrolls[1];
  assert.match(texts(full),/change could not be saved/);assert.match(texts(full),/Current painting is unavailable/);assert.match(texts(full),/One pending synchronization/);assert.match(texts(full),/Permission denied/);assert.equal(nodes(full,'ActivityIndicator').length,1);
  const controls=nodes(full,'Pressable');controls.find(n=>n.props.accessibilityLabel==='Retry highlights').props.onPress();assert.equal(read,1);assert.equal(write,0);assert.equal(sync,0);
  controls.find(n=>n.props.accessibilityLabel==='Retry pending highlight change').props.onPress();controls.find(n=>n.props.accessibilityLabel==='Retry synchronization').props.onPress();assert.equal(read,1);assert.equal(write,1);assert.equal(sync,1);
  assert.equal(controls.find(n=>n.props.accessibilityLabel==='Confirm remove highlight').props.disabled,true);assert.equal(Object.assign({},...scrolls[0].props.style.filter(Boolean)).display,'none');
});
