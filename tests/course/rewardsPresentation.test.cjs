const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');
const root = path.resolve(__dirname, '../..');
const tick = () => new Promise(resolve => setImmediate(resolve));
const nodes = (t,type) => !t||typeof t!=='object'?[]:[...(t.type===type?[t]:[]),...(t.props.children||[]).flat(Infinity).flatMap(c=>nodes(c,type))];
const text = t=>typeof t==='string'||typeof t==='number'?String(t):!t||typeof t!=='object'?'':(t.props.children||[]).flat(Infinity).map(text).join(' ');
const style = node => {assert.ok(node,'the visible presentation child exists');return Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean));};
const content = tree => nodes(tree,'View').find(node=>node.props.testID==='quiz-performance');
const imageFrame = tree => nodes(tree,'View').find(node=>(node.props.children||[]).flat(Infinity).some(child=>child?.type==='Image'));
const viewport = tree => nodes(tree,'View').find(node=>node.props.testID==='quiz-confetti-viewport');
const confetti = tree => nodes(tree,'View').find(node=>node.props.testID==='quiz-confetti');
const pieces = tree => nodes(confetti(tree),'AnimatedView');
const value = animated => typeof animated==='number'?animated:animated.value;
const child = {type:'Image',props:{source:123,accessibilityLabel:'Fixture Play medal',children:[]}};
function celebrationProps(outcome='saved') {
  let consumed=false;
  return {result:result(outcome),attemptToken:token,children:child,
    attempt:{claimCelebration:()=>{if(consumed)return false;consumed=true;return true;}}};
}
function host({ reduced = false, focused = true, motionQuery, appState = 'active' } = {}) {
  const frames=new Map(), cache=new Map(), assets=new Map(), animations=[], motionListeners=new Set(), appListeners=new Set(); let frame,calls,effects=[],stateUpdates=0;
  function invoke(type,props){const index=calls.get(type)||0;calls.set(type,index+1);if(!frames.has(type))frames.set(type,[]);const list=frames.get(type);const current=list[index]||(list[index]={slots:[],cursor:0});current.cursor=0;const parent=frame;frame=current;try{return type(props);}finally{frame=parent;}}
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const memo=(fn,deps)=>{const {slots}=frame,i=frame.cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={value:fn(),deps};return slots[i].value;};
  const React={createElement(type,props,...children){const next={...props,children};return typeof type==='function'?invoke(type,next):{type,props:next};},
    useMemo:memo,useRef:value=>memo(()=>({current:value}),[]),useState:initial=>{const s=memo(()=>({value:typeof initial==='function'?initial():initial}),[]);return[s.value,next=>{stateUpdates++;s.value=typeof next==='function'?next(s.value):next;}];},
    useCallback:(fn,deps)=>memo(()=>fn,deps),
    useEffect(fn,deps){const {slots}=frame,i=frame.cursor++;if(!slots[i]||!same(slots[i].deps,deps))effects.push(()=>{slots[i]?.cleanup?.();slots[i]={deps,setup:fn,cleanup:fn()};});}};
  const Image=Object.assign(props=>({type:'Image',props}),{resolveAssetSource:source=>Number.isInteger(source)&&source>0?{uri:'asset:'+source}:null});
  const native=Object.fromEntries(['Text','View','Pressable','ScrollView','StatusBar','ActivityIndicator'].map(n=>[n,n]));
  native.Image=Image;native.StyleSheet={create:v=>v,absoluteFillObject:{position:'absolute',top:0,left:0,right:0,bottom:0}};
  native.useWindowDimensions=()=>({width:411,height:914,fontScale:1});
  native.AccessibilityInfo={isReduceMotionEnabled:()=>motionQuery||Promise.resolve(reduced),addEventListener:(event,fn)=>{motionListeners.add(fn);return{remove:()=>motionListeners.delete(fn)};}};
  native.AppState={currentState:appState,addEventListener:(event,fn)=>{assert.equal(event,'change');appListeners.add(fn);return{remove:()=>appListeners.delete(fn)};}};
  native.Easing={linear:v=>v};
  native.Animated={View:'AnimatedView',Value:class{constructor(v){this.value=v;}setValue(v){this.value=v;}interpolate(config){const source=this;return{...config,get value(){const {inputRange:x,outputRange:y}=config;const n=Math.max(x[0],Math.min(x[x.length-1],source.value));let i=1;while(i<x.length-1&&n>x[i])i++;return typeof y[i]==='number'?y[i-1]+(y[i]-y[i-1])*(n-x[i-1])/(x[i]-x[i-1]):y[i];}};}},timing:(value,options)=>{const run={options,stopped:false,start(done){this.done=done;},stop(){this.stopped=true;},advance(milliseconds){value.setValue(milliseconds);},finish(){value.setValue(options.toValue);this.done?.({finished:true});}};animations.push(run);return run;}};
  function load(file){if(cache.has(file))return cache.get(file);assert.ok(fs.existsSync(path.join(root,file)),file+' exists');if(file.endsWith('.png')){if(!assets.has(file))assets.set(file,1000+assets.size);return assets.get(file);}const code=babel.transformFileSync(path.join(root,file),{babelrc:false,configFile:false,plugins:['@babel/plugin-transform-react-jsx','@babel/plugin-transform-modules-commonjs']}).code;const module={exports:{}};
    vm.runInThisContext('(function(require,module,exports){'+code+'\n})',{filename:file})(name=>name==='react'?React:name==='react-native'?native:name==='@react-navigation/native'?{useIsFocused:()=>focused}:name==='react-native-safe-area-context'?{SafeAreaView:'SafeAreaView'}:name.startsWith('.')?load(path.posix.join(path.posix.dirname(file),name.endsWith('.png')?name:name+'.js')):require(name),module,module.exports);cache.set(file,module.exports);return module.exports;}
  return {animations,get stateUpdates(){return stateUpdates;},focus(value){focused=value;},background(value){native.AppState.currentState=value;appListeners.forEach(fn=>fn(value));},render(file,props,exportName='default'){calls=new Map();effects=[];const tree=invoke(load(file)[exportName],props);effects.forEach(fn=>fn());return tree;},unmount(){for(const list of frames.values())for(const frame of list)frame.slots.forEach(s=>s?.cleanup?.());},replayEffects(){const slots=[...frames.values()].flat().flatMap(frame=>frame.slots).filter(s=>s?.setup);slots.forEach(s=>s.cleanup?.());slots.forEach(s=>{s.cleanup=s.setup();});},motion(value){motionListeners.forEach(fn=>fn(value));}};
}
const play={id:'fixture',name:'Fixture Play',medalImage:123};
const question={id:'q',question:'Question?',choices:[{id:'a',text:'Correct'},{id:'b',text:'Other'}],correctAnswer:'a',evidence:[]};
const quiz={playId:'fixture',questions:[question]}, token=Object.freeze({});
const result=outcome=>Object.freeze({outcome,correct:outcome==='failed'?0:1,total:1,passed:outcome!=='failed',answers:{q:'a'}});
function props(outcome){return{quiz,play,result:result(outcome),saving:false,attemptToken:token,attempt:{claimCelebration:()=>true,retake(){}},returnToCourse(){},onViewMedals(){}};}

test('a confirmed new completion displays its actual mapped medal and collection actions',()=>{
  const h=host(),p=props('saved'),tree=h.render('course/QuizViews.js',p,'QuizResults');
  assert.match(text(tree),/Perfect performance/);assert.doesNotMatch(text(tree),/Perfect score|A flawless performance/);assert.match(text(tree),/Medal added to your collection/);assert.match(text(tree),/1\/1/);
  const image=nodes(tree,'Image')[0];assert.ok(image,'render the actual medal');assert.equal(image.props.source,123);assert.equal(image.props.resizeMode,'contain');assert.equal(image.props.accessibilityLabel,'Fixture Play medal');
  assert.ok(nodes(tree,'Pressable').some(n=>n.props.accessibilityLabel==='View medals'));
  assert.ok(nodes(tree,'Pressable').some(n=>n.props.accessibilityLabel==='Continue course'));h.unmount();
});

test('perfect replay celebrates its performance around already-earned artwork',async()=>{
  const h=host(),p=props('replay');let tree=h.render('course/QuizViews.js',p,'QuizResults');measureViewport(tree);await tick();
  nodes(tree,'Image')[0].props.onLoad();h.render('course/QuizViews.js',p,'QuizResults');tree=h.render('course/QuizViews.js',p,'QuizResults');
  assert.match(text(tree),/Already in your collection/);assert.equal(nodes(tree,'Image').length,1);assert.doesNotMatch(text(tree),/Medal added|new medal|earned a medal/i);assert.equal(h.animations.length,1);h.unmount();
});

test('unconfirmed perfect scores celebrate without showing earned artwork or collection actions',async()=>{
  for(const outcome of ['sign-in','save-failed','invalid-progress']){
    const h=host(),p=props(outcome);const initial=h.render('course/QuizViews.js',p,'QuizResults');measureViewport(initial);await tick();
    const tree=h.render('course/QuizViews.js',p,'QuizResults');
    assert.equal(nodes(tree,'Image').length,0,outcome);assert.equal(h.animations.length,1,outcome);
    assert.match(text(tree),/1\/1/);assert.doesNotMatch(text(tree),/Medal added|Already in your collection/);
    assert.equal(nodes(tree,'Pressable').some(n=>n.props.accessibilityLabel==='View medals'),false);
    assert.equal(nodes(tree,'Pressable').some(n=>n.props.accessibilityLabel==='Continue course'),false);h.unmount();
  }
});

test('incorrect results offer review without celebration or medal award',async()=>{
  const h=host(),tree=h.render('course/QuizViews.js',props('failed'),'QuizResults');await tick();
  assert.equal(nodes(tree,'Image').length,0);assert.equal(h.animations.length,0);
  assert.equal(confetti(tree),undefined);
  assert.doesNotMatch(text(tree),/Medal added|Already in your collection/);assert.match(text(tree),/1 answer to revisit/);
  assert.ok(nodes(tree,'Pressable').some(n=>n.props.accessibilityLabel==='Review answers'));h.unmount();
});

test('missing or failed artwork shows an honest unavailable state without a generic substitute',()=>{
  const h=host();let tree=h.render('course/MedalArtwork.js',{play:{name:'Fixture Play'}});assert.equal(nodes(tree,'Image').length,0);assert.match(text(tree),/Medal artwork unavailable/);
  tree=h.render('course/MedalArtwork.js',{play});nodes(tree,'Image')[0].props.onError();tree=h.render('course/MedalArtwork.js',{play});assert.equal(nodes(tree,'Image').length,0);assert.match(text(tree),/Medal artwork unavailable/);h.unmount();
});


const opacity = tree => value(style(content(tree)).opacity);
const renderCall = (h,p) => h.render('course/QuizCelebration.js',p);
function measureViewport(tree,{width=411,height=700}={}){
  const surface=viewport(tree);assert.ok(surface,'the viewport layout surface is mounted');
  surface.props.onLayout({nativeEvent:{layout:{width,height}}});
}
async function prepared(h,p){const tree=renderCall(h,p);if(viewport(tree))measureViewport(tree);await tick();return renderCall(h,p);}

test('performance text stays readable from the first frame while native artwork readiness gates the shower',async()=>{
  let resolve;const h=host({motionQuery:new Promise(yes=>{resolve=yes;})}),p={...celebrationProps(),ready:false};
  let tree=renderCall(h,p);assert.equal(opacity(tree),1,'score and performance text are readable even while artwork is pending');
  assert.equal(nodes(tree,'Image').length,1,'the native image stays mounted for decoding');
  measureViewport(tree);resolve(false);await tick();tree=renderCall(h,p);assert.equal(opacity(tree),1);assert.equal(h.animations.length,0);
  tree=renderCall(h,{...p,ready:true});assert.equal(h.animations.length,1);assert.equal(opacity(tree),1);
  assert.equal(h.animations[0].options.duration,3200);assert.equal(h.animations[0].options.toValue,3200);assert.equal(h.animations[0].options.useNativeDriver,true);
  assert.equal(style(content(tree)).transform,undefined,'fully readable performance never rides an animation transform');
  assert.equal(pieces(tree).length,64,'the ready result has one viewport paper celebration');
  assert.equal(content(tree).props.accessibilityElementsHidden,undefined);h.animations[0].finish();
  tree=renderCall(h,{...p,ready:true});assert.equal(opacity(tree),1);h.unmount();
});

test('gold and ivory paper crosses the viewport in staggered falls while performance stays readable',async()=>{
  const h=host(),p=celebrationProps();let tree=renderCall(h,p);
  assert.equal(confetti(tree),undefined,'no decoration before motion readiness');
  measureViewport(tree);await tick();tree=renderCall(h,p);const surface=viewport(tree);
  assert.ok(confetti(tree),'the overlay is armed in the render before the start effect');
  assert.equal(surface.props.pointerEvents,'none');assert.equal(surface.props.accessible,false);
  assert.equal(surface.props.accessibilityElementsHidden,true);assert.equal(surface.props.importantForAccessibility,'no-hide-descendants');
  assert.equal(style(surface).position,'absolute');assert.equal(style(surface).overflow,'hidden');
  for(const edge of ['top','left','right','bottom'])assert.equal(style(surface)[edge],0);
  assert.equal(pieces(tree).length,64);assert.ok(pieces(tree).every(piece=>value(style(piece).opacity)===0));
  const colors=new Set(pieces(tree).map(piece=>style(piece).backgroundColor));assert.ok(colors.has('#E5BD68'));assert.ok(colors.has('#F6E8CD'));
  for(const piece of pieces(tree)){
    const s=style(piece);assert.ok(s.width>0&&s.height>0);
    assert.ok(!s.borderRadius||s.borderRadius<=1,'paper has no circular disc shape');
  }
  const axis=(piece,name)=>value(style(piece).transform.find(transform=>name in transform)[name]);
  const updates=h.stateUpdates;let staggered=false;
  for(const milliseconds of [50,200,500,1000,1600,2300,2900]){
    h.animations[0].advance(milliseconds);const visible=pieces(tree).filter(piece=>value(style(piece).opacity)>0.1).length;
    staggered ||= visible>0&&visible<64;assert.equal(opacity(tree),1,'the score and medal stay fully readable throughout the shower');
  }
  assert.ok(staggered,'independent particle entrances and retirements prevent one synchronized paper band');
  h.animations[0].advance(500);const high=pieces(tree).map(piece=>axis(piece,'translateY'));
  h.animations[0].advance(1400);assert.ok(pieces(tree).some((piece,index)=>axis(piece,'translateY')>high[index]+100),'paper falls across the viewport');
  assert.equal(h.stateUpdates,updates,'native clock progress does not produce per-frame React updates');
  h.animations[0].finish();assert.ok(pieces(tree).every(piece=>value(style(piece).opacity)===0));
  tree=renderCall(h,p);assert.equal(confetti(tree),undefined);assert.equal(opacity(tree),1);assert.equal(h.animations.length,1);h.unmount();
});

test('the first viewport measurement fixes particle trajectories for the attempt without resetting its clock',async()=>{
  const h=host(),p=celebrationProps();let tree=await prepared(h,p);
  h.animations[0].advance(1200);const geometry=pieces(tree).map(piece=>style(piece));
  measureViewport(tree,{width:900,height:1200});tree=renderCall(h,p);
  assert.deepEqual(pieces(tree).map(piece=>style(piece)),geometry,'later viewport layouts cannot jump an in-flight particle');
  assert.equal(h.animations.length,1);assert.equal(opacity(tree),1);
  assert.deepEqual(style(pieces(tree)[0]),style(pieces(renderCall(h,p))[0]),'rerenders retain deterministic paper geometry');h.unmount();
});

test('score and navigation stay visible while native onLoad alone releases the complete artwork and shower',async()=>{
  const h=host(),p=props('saved');let tree=h.render('course/QuizViews.js',p,'QuizResults');
  assert.equal(opacity(tree),1);assert.ok(nodes(tree,'Pressable').find(n=>n.props.accessibilityLabel==='View medals').props.onPress);
  assert.equal(style(imageFrame(tree)).opacity,0,'the whole native artwork frame stays hidden while it decodes');
  assert.equal(imageFrame(tree).props.accessibilityElementsHidden,true);
  measureViewport(tree);
  await tick();tree=h.render('course/QuizViews.js',p,'QuizResults');assert.equal(h.animations.length,0);assert.equal(opacity(tree),1);
  assert.equal(style(imageFrame(tree)).opacity,0,'viewport and motion readiness cannot expose pending artwork');
  nodes(tree,'Image')[0].props.onLoad();h.render('course/QuizViews.js',p,'QuizResults');tree=h.render('course/QuizViews.js',p,'QuizResults');
  assert.equal(h.animations.length,1);assert.equal(opacity(tree),1);assert.equal(style(imageFrame(tree)).opacity,1,'native onLoad exposes the complete artwork immediately');
  assert.equal(imageFrame(tree).props.accessibilityElementsHidden,false);assert.equal(nodes(tree,'Image')[0].props.fadeDuration,0,'disable the independent Android image fade');
  h.animations[0].finish();tree=h.render('course/QuizViews.js',p,'QuizResults');assert.equal(opacity(tree),1);h.unmount();
});

test('terminal image failure releases the result with a stable unavailable-art footprint',async()=>{
  const h=host(),p=props('saved');let tree=h.render('course/QuizViews.js',p,'QuizResults');measureViewport(tree);await tick();
  nodes(tree,'Image')[0].props.onError();h.render('course/QuizViews.js',p,'QuizResults');tree=h.render('course/QuizViews.js',p,'QuizResults');
  assert.equal(h.animations.length,1);assert.equal(opacity(tree),1);assert.match(text(tree),/Medal artwork unavailable/);assert.match(text(tree),/Medal added to your collection/);h.unmount();
});

test('completion and an already-consumed remount stay static and never replay',async()=>{
  const p=celebrationProps(),h=host();await prepared(h,p);h.animations[0].finish();
  assert.equal(opacity(renderCall(h,p)),1);assert.equal(confetti(renderCall(h,p)),undefined);renderCall(h,p);assert.equal(h.animations.length,1);h.unmount();
  const again=host();const tree=await prepared(again,p);assert.equal(again.animations.length,0);assert.equal(opacity(tree),1);assert.equal(confetti(tree),undefined);again.unmount();
});

test('reduced motion keeps pending performance text readable and never replays after artwork is ready',async()=>{
  const h=host({reduced:true}),p={...celebrationProps(),ready:false};let tree=await prepared(h,p);
  assert.equal(h.animations.length,0);assert.equal(opacity(tree),1);assert.equal(confetti(tree),undefined);tree=renderCall(h,{...p,ready:true});assert.equal(opacity(tree),1);assert.equal(confetti(tree),undefined);
  h.motion(false);await tick();tree=renderCall(h,{...p,ready:true});assert.equal(h.animations.length,0);assert.equal(opacity(tree),1);h.unmount();
});

test('save-retry result replacement never cancels or restarts the same attempt reveal',async()=>{
  const p=celebrationProps('save-failed'),h=host();await prepared(h,p);const saved={...p,result:result('saved'),ready:false};
  assert.equal(pieces(renderCall(h,saved)).length,64,'a save retry does not remove the active performance');assert.equal(h.animations.length,1);assert.equal(h.animations[0].stopped,false);
  h.animations[0].finish();let tree=renderCall(h,saved);assert.equal(opacity(tree),1,'a newly loading medal cannot dim an already visible score');
  tree=renderCall(h,{...saved,ready:true});assert.equal(opacity(tree),1);assert.equal(h.animations.length,1);h.unmount();
});

test('development effect replay retains the original attempt claim while artwork is pending',async()=>{
  const h=host(),p={...celebrationProps(),ready:false};const tree=renderCall(h,p);measureViewport(tree);h.replayEffects();await tick();
  renderCall(h,{...p,ready:true});assert.equal(h.animations.length,1);h.unmount();
});

test('leaving before motion or image readiness consumes the event and Back cannot replay it',async()=>{
  let resolve;const h=host({motionQuery:new Promise(yes=>{resolve=yes;})}),p={...celebrationProps(),ready:false};
  measureViewport(renderCall(h,p));h.focus(false);renderCall(h,p);resolve(false);await tick();h.focus(true);renderCall(h,p);await tick();
  assert.equal(opacity(renderCall(h,p)),1,'Back preserves readable performance text while artwork is pending');
  assert.equal(h.animations.length,0);assert.equal(opacity(renderCall(h,{...p,ready:true})),1);h.unmount();
});

test('enabling reduced motion during the reveal settles immediately and never restarts',async()=>{
  const h=host(),p=celebrationProps();await prepared(h,p);assert.equal(h.animations.length,1);h.motion(true);
  assert.equal(h.animations[0].stopped,true);assert.equal(opacity(renderCall(h,p)),1);assert.equal(confetti(renderCall(h,p)),undefined);h.motion(false);renderCall(h,p);assert.equal(h.animations.length,1);h.unmount();
});

test('the latest motion preference wins over late success or failure of the initial lookup',async()=>{
  for(const latest of [true,false])for(const failed of [true,false]){
    let resolve,reject;const h=host({motionQuery:new Promise((yes,no)=>{resolve=yes;reject=no;})}),p=celebrationProps();
    measureViewport(renderCall(h,p));h.motion(latest);failed?reject(new Error('fixture unavailable')):resolve(!latest);await tick();
    const tree=renderCall(h,p);assert.equal(h.animations.length,latest?0:1);if(latest)assert.equal(opacity(tree),1);h.unmount();
  }
});

test('blur cancels an active reveal and returning keeps the same result static',async()=>{
  const h=host(),p=celebrationProps();await prepared(h,p);h.focus(false);renderCall(h,p);h.focus(true);renderCall(h,p);await tick();
  assert.equal(h.animations.length,1);assert.equal(h.animations[0].stopped,true);assert.equal(opacity(renderCall(h,p)),1);assert.equal(confetti(renderCall(h,p)),undefined);h.unmount();
});

test('fresh attempt tokens can celebrate while old motion and animation callbacks remain retired',async()=>{
  let resolve;const h=host({motionQuery:new Promise(yes=>{resolve=yes;})}),old=celebrationProps(),fresh={...celebrationProps('replay'),attemptToken:Object.freeze({})};
  measureViewport(renderCall(h,old));measureViewport(renderCall(h,fresh));resolve(false);await tick();assert.equal(pieces(renderCall(h,fresh)).length,64);assert.equal(h.animations.length,1);
  const newest={...celebrationProps(),attemptToken:Object.freeze({})};measureViewport(renderCall(h,newest));await tick();renderCall(h,newest);
  assert.equal(h.animations.length,2);assert.equal(h.animations[0].stopped,true);assert.equal(pieces(renderCall(h,newest)).length,64);h.animations[0].finish();
  const tree=renderCall(h,newest);assert.equal(opacity(tree),1);assert.equal(pieces(tree).length,64,'an old completion cannot retire the newer animation');
  assert.ok(pieces(tree).every(piece=>value(style(piece).opacity)===0),'the newer native clock remains at its own initial frame');assert.equal(h.animations[1].stopped,false);h.unmount();
});

test('unmount retires late motion callbacks without starting an animation',async()=>{
  let resolve;const h=host({motionQuery:new Promise(yes=>{resolve=yes;})}),p=celebrationProps();measureViewport(renderCall(h,p));h.unmount();resolve(false);await tick();assert.equal(h.animations.length,0);
});

test('failed motion queries safely settle ready content without animation',async()=>{
  const h=host({motionQuery:Promise.reject(new Error('fixture unavailable'))}),p=celebrationProps();
  const tree=await prepared(h,p);assert.equal(h.animations.length,0);assert.equal(opacity(tree),1);assert.equal(p.attempt.claimCelebration(),false);h.unmount();
});

test('non-perfect content stays visible without claiming any celebration',async()=>{
  for(const score of [result('failed'),{...result('saved'),total:0,correct:0},{...result('saved'),passed:false}]){
    let claims=0;const p={...celebrationProps(),result:score,attempt:{claimCelebration(){claims++;return true;}}},h=host();
    const tree=await prepared(h,p);assert.equal(claims,0);assert.equal(h.animations.length,0);assert.equal(opacity(tree),1);h.unmount();
  }
});

test('native confetti waits for a measured viewport while ready performance stays fully visible',async()=>{
  const h=host(),p=celebrationProps();let tree=renderCall(h,p);await tick();tree=renderCall(h,p);
  assert.equal(h.animations.length,0,'no viewport measurement means no native animation start');
  const performance=nodes(tree,'View').find(node=>node.props.testID==='quiz-performance');
  assert.ok(performance,'performance is a static native View');assert.equal(style(performance).opacity,1);
  assert.equal(style(performance).transform,undefined,'the readable score and medal never translate or fade');
  const viewport=nodes(tree,'View').find(node=>node.props.testID==='quiz-confetti-viewport');
  assert.ok(viewport,'the confetti owns an explicit viewport measurement surface');
  for(const dimensions of [{width:0,height:700},{width:411,height:0}]){
    measureViewport(tree,dimensions);tree=renderCall(h,p);assert.equal(h.animations.length,0,'empty viewport dimensions cannot start the native clock');
  }
  measureViewport(tree);tree=renderCall(h,p);assert.equal(h.animations.length,1);assert.equal(opacity(tree),1);h.unmount();
});

test('renderResult receives separate readable presentation and noninteractive viewport overlay',async()=>{
  let supplied;
  const h=host(),p={...celebrationProps(),renderResult(presentation,overlay){
    supplied={presentation,overlay};return{type:'ResultFrame',props:{children:[{type:'ScrollView',props:{children:[presentation]}},overlay]}};
  }};
  const tree=await prepared(h,p);
  assert.equal(tree.type,'ResultFrame');assert.equal(supplied.presentation.props.testID,'quiz-performance');
  assert.equal(supplied.overlay.props.testID,'quiz-confetti-viewport');assert.equal(nodes(tree,'ScrollView').length,1);
  assert.equal(viewport(nodes(tree,'ScrollView')[0]),undefined,'the decoration can live outside the answer-review scroll surface');
  assert.equal(content(nodes(tree,'ScrollView')[0]),supplied.presentation);assert.equal(pieces(tree).length,64);h.unmount();
});

test('ready performance stays fully visible while the initial motion preference is unresolved',async()=>{
  let resolve;const h=host({motionQuery:new Promise(yes=>{resolve=yes;})}),p=celebrationProps();
  let tree=renderCall(h,p);measureViewport(tree);tree=renderCall(h,p);
  assert.equal(opacity(tree),1);assert.equal(h.animations.length,0);assert.equal(confetti(tree),undefined);
  resolve(false);await tick();tree=renderCall(h,p);assert.equal(h.animations.length,1);assert.equal(opacity(tree),1);h.unmount();
});

test('backgrounding retires active native paper immediately and foregrounding cannot replay it',async()=>{
  const h=host(),p=celebrationProps();let tree=await prepared(h,p);h.animations[0].advance(1000);
  assert.ok(pieces(tree).some(piece=>value(style(piece).opacity)>0),'the native paper is visible before backgrounding');
  h.background('background');assert.equal(h.animations[0].stopped,true);
  assert.ok(pieces(tree).every(piece=>value(style(piece).opacity)===0),'retiring an event hides all native pieces before another render');
  tree=renderCall(h,p);assert.equal(opacity(tree),1);assert.equal(confetti(tree),undefined);
  h.background('active');await tick();tree=renderCall(h,p);assert.equal(h.animations.length,1);assert.equal(confetti(tree),undefined);h.unmount();
});

test('backgrounding while readiness is pending consumes the event without a foreground replay',async()=>{
  let resolve;const h=host({motionQuery:new Promise(yes=>{resolve=yes;})}),p={...celebrationProps(),ready:false};
  measureViewport(renderCall(h,p));h.background('inactive');renderCall(h,p);resolve(false);await tick();h.background('active');
  const tree=renderCall(h,{...p,ready:true});assert.equal(opacity(tree),1);assert.equal(h.animations.length,0);assert.equal(confetti(tree),undefined);h.unmount();
});

test('a result mounted while backgrounded is consumed and stays static after foregrounding',async()=>{
  const h=host({appState:'background'}),p=celebrationProps();let tree=await prepared(h,p);
  assert.equal(h.animations.length,0);assert.equal(opacity(tree),1);h.background('active');await tick();tree=renderCall(h,p);
  assert.equal(h.animations.length,0);assert.equal(confetti(tree),undefined);assert.equal(p.attempt.claimCelebration(),false);h.unmount();
});

test('late artwork readiness cannot expose replacement artwork or start its shower while score stays readable',async()=>{
  const h=host(),old=props('saved');let tree=h.render('course/QuizViews.js',old,'QuizResults');const staleLoad=nodes(tree,'Image')[0].props.onLoad;
  measureViewport(tree);const fresh={...old,attemptToken:Object.freeze({}),play:{...play,medalImage:124}};
  tree=h.render('course/QuizViews.js',fresh,'QuizResults');measureViewport(tree);await tick();staleLoad();
  tree=h.render('course/QuizViews.js',fresh,'QuizResults');assert.equal(opacity(tree),1);assert.equal(h.animations.length,0);
  assert.equal(style(imageFrame(tree)).opacity,0,'a stale image callback cannot reveal the replacement native artwork');
  assert.equal(imageFrame(tree).props.accessibilityElementsHidden,true);
  nodes(tree,'Image')[0].props.onLoad();h.render('course/QuizViews.js',fresh,'QuizResults');tree=h.render('course/QuizViews.js',fresh,'QuizResults');
  assert.equal(opacity(tree),1);assert.equal(style(imageFrame(tree)).opacity,1);assert.equal(h.animations.length,1);h.unmount();
});
