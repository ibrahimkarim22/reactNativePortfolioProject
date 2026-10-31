const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');
const root = path.resolve(__dirname, '../..');
const native = Object.fromEntries(['Text','View','Pressable','ScrollView','StatusBar','ActivityIndicator','Modal'].map(name => [name,name]));
native.StyleSheet = { create: value => value };
const React = { createElement(type, props, ...children) {
  const next = { ...props, children }; return typeof type === 'function' ? type(next) : { type, props: next };
}, useRef: value => ({ current: value }), useMemo: fn => fn(), useCallback: fn => fn,
useState: value => [value, () => {}] };
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  if (file === 'course/MedalArtwork.js') return { __esModule: true, default: ({ play }) => ({ type: 'Image', props: { source: play.medalImage, children: [] } }) };
  if (file === 'course/QuizCelebration.js') return { __esModule: true, default: props => {
    const presentation={ type: 'CurtainCall', props };
    return props.renderResult ? props.renderResult(presentation,null) : presentation;
  } };
  const code = babel.transformFileSync(path.join(root,file), { babelrc:false, configFile:false,
    plugins:['@babel/plugin-transform-react-jsx','@babel/plugin-transform-modules-commonjs'] }).code;
  const module = {exports:{}};
  vm.runInThisContext('(function(require,module,exports){'+code+'\n})',{filename:file})(name=>{
    if(name==='react')return React;
    if(name==='react-native')return native;
    if(name==='react-native-safe-area-context')return {SafeAreaView:'SafeAreaView'};
    if(name==='@react-navigation/native')return {useIsFocused:()=>true};
    return name.startsWith('.') ? load(path.posix.join(path.posix.dirname(file),name+'.js')) : require(name);
  },module,module.exports);cache.set(file,module.exports);return module.exports;
}
const nodes = (t,type) => !t||typeof t!=='object'?[]:[...(t.type===type?[t]:[]),...(t.props.children||[]).flat(Infinity).flatMap(c=>nodes(c,type))];
const text = t=>typeof t==='string'||typeof t==='number'?String(t):!t||typeof t!=='object'?'':(t.props.children||[]).flat(Infinity).map(text).join(' ');
const question = {id:'q1',question:'Which choice is supported?',options:['q1.a','q1.b','q1.c','q1.d'],
 choices:['First','Second','Third','Fourth'].map((text,index)=>({id:'q1.'+'abcd'[index],text})),correctAnswer:'q1.b',
 explanation:'The second choice follows the cited passage.',evidence:[{startRef:{sectionId:'scene'},exact:'A source line.\nAnother source line.'}]};
const quiz = {questions:[question,{...question,id:'q2'}]};
const base = {index:0,answers:{q1:'q1.a'},checked:{},saving:false,error:null,attemptToken:Object.freeze({})};

test('selection is neutral and feedback appears only after explicit check',()=>{
 const {QuizQuestion}=load('course/QuizViews.js');
 const before=QuizQuestion({quiz,state:base,attempt:{}});
 assert.equal(nodes(before,'Pressable').filter(n=>n.props.accessibilityRole==='radio').length,4);
 assert.doesNotMatch(text(before),/Correct answer|Not quite|The second choice/);
 const after=QuizQuestion({quiz,state:{...base,checked:{q1:'q1.a'}},attempt:{},onEvidence(){}});
 assert.equal(nodes(after,'Pressable').filter(n=>n.props.accessibilityRole==='radio').length,0,'feedback replaces the choices');
 assert.match(text(after),/Not quite/);assert.match(text(after),/Correct answer:.*Second/);assert.match(text(after),/The second choice/);
 assert.ok(nodes(after,'Pressable').some(n=>n.props.accessibilityLabel==='Read supporting passage'));
 assert.doesNotMatch(text(after),/A source line/,'full evidence stays outside normal feedback flow');
});

test('footer offers guarded Check, Continue, and Finish without automatic advancement',()=>{
 const {QuizFooter}=load('course/QuizViews.js'),calls=[];
 const attempt={checkAnswer:(...a)=>calls.push(['check',...a]),next:(...a)=>calls.push(['next',...a]),submit:(...a)=>calls.push(['submit',...a]),previous:(...a)=>calls.push(['previous',...a])};
 const button=(state,label)=>nodes(QuizFooter({quiz,state,attempt}),'Pressable').find(n=>n.props.accessibilityLabel===label);
 assert.equal(button({...base,answers:{}},'Check answer').props.disabled,true);
 button(base,'Check answer').props.onPress();
 button({...base,checked:{q1:'q1.a'}},'Continue').props.onPress();
 button({...base,index:1,checked:{q1:'q1.a',q2:'q1.b'}},'Finish quiz').props.onPress();
 assert.deepEqual(calls,[['check','q1',base.attemptToken],['next','q1',base.attemptToken],['submit','q2',base.attemptToken]]);
});

test('activity footer is outside scrolling content, with scalable untruncated text',()=>{
 const {CourseActivityPage,CourseText}=load('course/CourseUI.js');
 assert.equal(typeof CourseActivityPage,'function');
 const footer={type:'Footer',props:{children:[]}};
 const tree=CourseActivityPage({children:CourseText({children:'A complete prompt'}),footer});
 assert.equal(nodes(tree,'Footer').length,1);assert.equal(nodes(nodes(tree,'ScrollView')[0],'Footer').length,0);
 assert.deepEqual(nodes(tree,'SafeAreaView')[0].props.edges,['left','right','bottom']);
 for(const n of nodes(tree,'Text')) {assert.notEqual(n.props.allowFontScaling,false);assert.equal(n.props.numberOfLines,undefined);assert.notEqual(n.props.adjustsFontSizeToFit,true);}
});

test('the result overlay stays outside the answer-review scroll view without changing page content',()=>{
 const {CoursePage}=load('course/CourseUI.js');
 const overlay={type:'ViewportOverlay',props:{children:[]}};
 const content={type:'ResultContent',props:{children:[]}};
 const tree=CoursePage({children:content,overlay});
 assert.equal(nodes(tree,'ViewportOverlay').length,1);
 assert.equal(nodes(nodes(tree,'ScrollView')[0],'ViewportOverlay').length,0);
 assert.equal(nodes(nodes(tree,'ScrollView')[0],'ResultContent').length,1);
});

test('shared evidence renders full exact quotations and actual source locations',()=>{
 const {QuizEvidence}=load('course/QuizViews.js');
 assert.equal(typeof QuizEvidence,'function');
 const tree=QuizEvidence({question,sectionLabels:{scene:'Act I · Scene I'}});
 assert.match(text(tree),/Act I · Scene I/);
 assert.deepEqual(nodes(tree,'Text').filter(n=>n.props.selectable).map(text),[question.evidence[0].exact]);
});

test('shuffled answer positions label the displayed order but select the original stable option IDs',()=>{
 const {QuizQuestion}=load('course/QuizViews.js'),calls=[];
 const state={...base,choiceOrder:{q1:['q1.d','q1.b','q1.a','q1.c']}};
 const tree=QuizQuestion({quiz,state,attempt:{choose:(...args)=>calls.push(args)}});
 const rows=nodes(tree,'Pressable').filter(n=>n.props.accessibilityRole==='radio');
 assert.deepEqual(rows.map(n=>n.props.accessibilityLabel),['Fourth','Second','First','Third']);
 assert.deepEqual(rows.map(n=>text(n).trim().split(' ')[0]),['A','B','C','D']);
 rows[0].props.onPress();rows[2].props.onPress();
 assert.deepEqual(calls,[['q1','q1.d',base.attemptToken],['q1','q1.a',base.attemptToken]]);
 assert.equal(rows[2].props.accessibilityState.checked,true,'selection follows its option ID after moving to another letter');
});

function results(outcome, correct = 10) {
 const questions=Array.from({length:10},(_,index)=>({...question,id:'q'+(index+1)}));
 return load('course/QuizViews.js').QuizResults({quiz:{questions},play:{name:'Fixture play',medalImage:123},
  result:{outcome,correct,total:10,passed:correct===10,answers:Object.fromEntries(questions.map(q=>[q.id,q.correctAnswer]))},
  attempt:{retrySave(){},retake(){}},attemptToken:Object.freeze({}),returnToCourse(){},onViewMedals(){},onReviewAnswers(){}});
}
test('perfect-score presentation is distinct from a confirmed new medal and an existing collection entry',()=>{
 for(const outcome of ['saved','replay']) {
  const tree=results(outcome);
  assert.match(text(tree),/Perfect performance/);assert.match(text(tree),/10\/10/);
  assert.doesNotMatch(text(tree),/A flawless performance|Perfect score/);
  assert.equal(nodes(tree,'Text').some(n=>text(n)==='correct'),false,'no redundant score caption');
  assert.equal(text(nodes(tree,'Text').find(n=>n.props.accessibilityLabel==='10 of 10 correct')),'10/10');
  assert.equal(nodes(tree,'CurtainCall').length,1);
  assert.equal(nodes(tree,'Image').length,1);
  if(outcome==='saved')assert.match(text(tree),/Medal added to your collection/);
  else {assert.match(text(tree),/Already in your collection/);assert.doesNotMatch(text(tree),/Medal added to your collection/);}
 }
});
test('an unconfirmed perfect score celebrates its performance while retaining the save error and no medal award',()=>{
 const tree=results('save-failed');
 assert.match(text(tree),/10\/10/);assert.equal(nodes(tree,'CurtainCall').length,1);
 assert.equal(nodes(tree,'Image').length,0);assert.match(text(tree),/Progress not saved/);
 assert.match(text(tree),/Completion has not been confirmed/);
 assert.ok(nodes(tree,'Pressable').some(n=>n.props.accessibilityLabel==='Retry save'));
 assert.ok(!nodes(tree,'Pressable').some(n=>n.props.accessibilityLabel==='View medals'));
 assert.doesNotMatch(text(tree),/Medal added|Already in your collection/);
});
test('non-perfect results prioritize review and retake with their real score and no celebration',()=>{
 const tree=results('failed',8),buttons=nodes(tree,'Pressable').map(n=>n.props.accessibilityLabel);
 assert.match(text(tree),/8\/10/);assert.match(text(tree),/2 answers to revisit/);
 assert.equal(nodes(tree,'CurtainCall').length,0);assert.equal(nodes(tree,'Image').length,0);
 assert.ok(buttons.indexOf('Review answers')<buttons.indexOf('Retake quiz'));
});
