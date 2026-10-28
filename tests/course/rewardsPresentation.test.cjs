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
function host({ reduced = false, focused = true, motionQuery } = {}) {
  const slots=[], cache=new Map(), animations=[], motionListeners=new Set(); let cursor=0,effects=[];
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const memo=(fn,deps)=>{const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={value:fn(),deps};return slots[i].value;};
  const React={createElement(type,props,...children){const next={...props,children};return typeof type==='function'?type(next):{type,props:next};},
    useMemo:memo,useRef:value=>memo(()=>({current:value}),[]),useState:initial=>{const s=memo(()=>({value:typeof initial==='function'?initial():initial}),[]);return[s.value,next=>{s.value=typeof next==='function'?next(s.value):next;}];},
    useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))effects.push(()=>{slots[i]?.cleanup?.();slots[i]={deps,cleanup:fn()};});}};
  const Image=Object.assign(props=>({type:'Image',props}),{resolveAssetSource:source=>Number.isInteger(source)&&source>0?{uri:'asset:'+source}:null});
  const native=Object.fromEntries(['Text','View','Pressable','ScrollView','StatusBar','ActivityIndicator'].map(n=>[n,n]));
  native.Image=Image;native.StyleSheet={create:v=>v,absoluteFillObject:{position:'absolute',top:0,left:0,right:0,bottom:0}};
  native.useWindowDimensions=()=>({width:411,height:914,fontScale:1});
  native.AccessibilityInfo={isReduceMotionEnabled:()=>motionQuery||Promise.resolve(reduced),addEventListener:(event,fn)=>{motionListeners.add(fn);return{remove:()=>motionListeners.delete(fn)};}};
  native.Animated={View:'AnimatedView',Value:class{constructor(v){this.value=v;}setValue(v){this.value=v;}interpolate(v){return v;}},timing:(value,options)=>{const run={options,stopped:false,start(done){this.done=done;},stop(){this.stopped=true;}};animations.push(run);return run;}};
  function load(file){if(cache.has(file))return cache.get(file);assert.ok(fs.existsSync(path.join(root,file)),file+' exists');const code=babel.transformFileSync(path.join(root,file),{babelrc:false,configFile:false,plugins:['@babel/plugin-transform-react-jsx','@babel/plugin-transform-modules-commonjs']}).code;const module={exports:{}};
    vm.runInThisContext('(function(require,module,exports){'+code+'\n})',{filename:file})(name=>name==='react'?React:name==='react-native'?native:name==='@react-navigation/native'?{useIsFocused:()=>focused}:name==='react-native-safe-area-context'?{SafeAreaView:'SafeAreaView'}:name.startsWith('.')?load(path.posix.join(path.posix.dirname(file),name+'.js')):require(name),module,module.exports);cache.set(file,module.exports);return module.exports;}
  return {animations,focus(value){focused=value;},render(file,props,exportName='default'){cursor=0;effects=[];const tree=load(file)[exportName](props);effects.forEach(fn=>fn());return tree;},unmount(){slots.forEach(s=>s?.cleanup?.());},motion(value){motionListeners.forEach(fn=>fn(value));}};
}
const play={id:'fixture',name:'Fixture Play',medalImage:123};
const question={id:'q',question:'Question?',choices:[{id:'a',text:'Correct'},{id:'b',text:'Other'}],correctAnswer:'a',evidence:[]};
const quiz={playId:'fixture',questions:[question]}, token=Object.freeze({});
const result=outcome=>Object.freeze({outcome,correct:outcome==='failed'?0:1,total:1,passed:outcome!=='failed',answers:{q:'a'}});
function props(outcome){return{quiz,play,result:result(outcome),saving:false,attemptToken:token,attempt:{claimCelebration:()=>true,retake(){}},returnToCourse(){},onViewMedals(){}};}

test('a confirmed new completion displays its actual mapped medal and collection actions',()=>{
  const h=host(),p=props('saved'),tree=h.render('course/QuizViews.js',p,'QuizResults');
  assert.match(text(tree),/Play completed/);assert.match(text(tree),/Medal added to your collection/);assert.match(text(tree),/1\/1 correct/);
  const image=nodes(tree,'Image')[0];assert.ok(image,'render the actual medal');assert.equal(image.props.source,123);assert.equal(image.props.resizeMode,'contain');assert.equal(image.props.accessibilityLabel,'Fixture Play medal');
  assert.ok(nodes(tree,'Pressable').some(n=>n.props.accessibilityLabel==='View medals'));
  assert.ok(nodes(tree,'Pressable').some(n=>n.props.accessibilityLabel==='Continue course'));h.unmount();
});

test('perfect replay displays already-earned artwork without new-award language or confetti',async()=>{
  const h=host(),tree=h.render('course/QuizViews.js',props('replay'),'QuizResults');await tick();
  assert.match(text(tree),/Already in your collection/);assert.equal(nodes(tree,'Image').length,1);assert.doesNotMatch(text(tree),/Medal added|new medal|earned a medal/i);assert.equal(h.animations.length,0);h.unmount();
});

test('incorrect and unconfirmed results never show a medal award or celebration',async()=>{
  for(const outcome of ['failed','sign-in','save-failed','invalid-progress']){const h=host(),tree=h.render('course/QuizViews.js',props(outcome),'QuizResults');await tick();assert.equal(nodes(tree,'Image').length,0,outcome);assert.equal(h.animations.length,0,outcome);assert.doesNotMatch(text(tree),/Medal added|Already in your collection/);if(outcome==='failed'){assert.match(text(tree),/1 answer to revisit/);assert.ok(nodes(tree,'Pressable').some(n=>n.props.accessibilityLabel==='Review answers'));}h.unmount();}
});

test('missing or failed artwork shows an honest unavailable state without a generic substitute',()=>{
  const h=host();let tree=h.render('course/MedalArtwork.js',{play:{name:'Fixture Play'}});assert.equal(nodes(tree,'Image').length,0);assert.match(text(tree),/Medal artwork unavailable/);
  tree=h.render('course/MedalArtwork.js',{play});nodes(tree,'Image')[0].props.onError();tree=h.render('course/MedalArtwork.js',{play});assert.equal(nodes(tree,'Image').length,0);assert.match(text(tree),/Medal artwork unavailable/);h.unmount();
});

test('celebration consumes a confirmed event once and stops on unmount',async()=>{
  let consumed=false;const p={result:result('saved'),attemptToken:token,attempt:{claimCelebration:()=>{if(consumed)return false;consumed=true;return true;}}};
  const h=host();h.render('course/QuizCelebration.js',p);await tick();const tree=h.render('course/QuizCelebration.js',p);assert.equal(h.animations.length,1);assert.equal(h.animations[0].options.duration,1000);assert.equal(h.animations[0].options.useNativeDriver,true);assert.equal(nodes(tree,'View')[0].props.pointerEvents,'none');h.unmount();assert.equal(h.animations[0].stopped,true);
  const again=host();again.render('course/QuizCelebration.js',p);await tick();assert.equal(again.animations.length,0,'remount does not replay a consumed event');again.unmount();
});

test('reduced motion suppresses particles and enabling motion later does not replay the award',async()=>{
  let consumed=false;const h=host({reduced:true}),p={result:result('saved'),attemptToken:token,attempt:{claimCelebration:()=>{if(consumed)return false;consumed=true;return true;}}};h.render('course/QuizCelebration.js',p);await tick();assert.equal(consumed,true);assert.equal(h.animations.length,0);h.motion(false);await tick();assert.equal(h.animations.length,0);h.unmount();
});

test('a late reduced-motion lookup cannot start particles after unmount',async()=>{
  let resolve,claims=0;const h=host({motionQuery:new Promise(yes=>{resolve=yes;})});h.render('course/QuizCelebration.js',{result:result('saved'),attemptToken:token,attempt:{claimCelebration:()=>{claims++;return true;}}});h.unmount();resolve(false);await tick();assert.equal(claims,0);assert.equal(h.animations.length,0);
});

test('leaving before the motion lookup completes consumes the event without animation on return',async()=>{
 let resolve,consumed=false;const h=host({motionQuery:new Promise(yes=>{resolve=yes;})}),p={result:result('saved'),attemptToken:token,attempt:{claimCelebration:()=>{if(consumed)return false;consumed=true;return true;}}};
 h.render('course/QuizCelebration.js',p);h.focus(false);h.render('course/QuizCelebration.js',p);assert.equal(consumed,true);resolve(false);await tick();h.focus(true);h.render('course/QuizCelebration.js',p);await tick();assert.equal(h.animations.length,0);h.unmount();
});

test('enabling reduced motion during an active burst stops it immediately',async()=>{
 const h=host(),p={result:result('saved'),attemptToken:token,attempt:{claimCelebration:()=>true}};h.render('course/QuizCelebration.js',p);await tick();assert.equal(h.animations.length,1);h.motion(true);const tree=h.render('course/QuizCelebration.js',p);assert.equal(h.animations[0].stopped,true);assert.equal(nodes(tree,'AnimatedView').length,0);h.unmount();
});
