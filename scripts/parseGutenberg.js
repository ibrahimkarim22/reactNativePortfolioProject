const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const parse5 = require('parse5');
const { computeContentVersion } = require('./contentVersion');
const cueEvidence = require('./sourceCueEvidence.json');

const SOURCE_SHA256 = 'd7116e381ba4f0164ba059f6d0e135e07af068b4ab486b57fa7deec6a305d5c3';
const BLOCKS = new Set(['p','h1','h2','h3','h4','h5','h6','td','th','li','pre','caption']);
const INLINE = new Set(['a','span','i','b','em','strong','sup','sub','u','s','small','big','br']);
const CONTAINERS = new Set(['html','head','body','div','section','table','thead','tbody','tfoot','tr','ul','ol','blockquote','center']);
function walk(node, callback) {
  callback(node);
  for (const child of node.childNodes || []) walk(child, callback);
}
function attr(node, name) { return (node.attrs || []).find((item) => item.name === name)?.value; }
function findAll(node, predicate) {
  const found = [];
  walk(node, (child) => { if (predicate(child)) found.push(child); });
  return found;
}
function roman(value) {
  const numbers = { I:1,V:5,X:10,L:50,C:100,D:500,M:1000 };
  return [...value].reduce((sum,char,index) => sum + (numbers[char] < (numbers[value[index+1]] || 0) ? -numbers[char] : numbers[char]),0);
}

// Only HTML flow soft wrapping is normalized, never literary punctuation or NBSP.
function blockText(node) {
  let raw = '';
  const spans = [];
  const pre = node.tagName === 'pre';
  function visit(current) {
    if (current.nodeName === '#text') {
      const text = current.value.replace(/\r\n?/g,'\n');
      raw += pre ? text : text.replace(/[ \t]*\n[ \t]*/g,' ');
      return;
    }
    if (current.tagName === 'br') { raw += '\n'; return; }
    const start = raw.length;
    for (const child of current.childNodes || []) visit(child);
    if (current !== node && current.tagName && current.tagName !== 'a') {
      spans.push({tag:current.tagName,start,end:raw.length,...(attr(current,'class') ? {className:attr(current,'class')} : {})});
    }
  }
  visit(node);
  if (pre) return {text:raw,spans};
  const keep = new Uint8Array(raw.length);
  let start = 0;
  for (let end = 0; end <= raw.length; end += 1) {
    if (end !== raw.length && raw[end] !== '\n') continue;
    let left = start;
    let right = end;
    while (left < right && /[ \t]/.test(raw[left])) left += 1;
    while (right > left && /[ \t]/.test(raw[right-1])) right -= 1;
    keep.fill(1,left,right);
    if (end < raw.length) keep[end] = 1;
    start = end+1;
  }
  const positions = new Uint32Array(raw.length+1);
  let text = '';
  for (let index=0; index<raw.length; index+=1) {
    if (keep[index]) text += raw[index];
    positions[index+1] = text.length;
  }
  return {text,spans:spans.map((span)=>({...span,start:positions[span.start],end:positions[span.end]}))};
}

function parseSource(html, options = {}) {
  const tree = parse5.parse(html,{sourceCodeLocationInfo:true});
  const all = [];
  walk(tree,(node)=>{if(node.sourceCodeLocation) all.push(node);});
  const chapters = all.filter((node)=>node.tagName==='h2' && findAll(node,(child)=>/^chap\d\d$/.test(attr(child,'id')||'')).length)
    .map((node)=>({node,chapterId:attr(findAll(node,(child)=>/^chap\d\d$/.test(attr(child,'id')||''))[0],'id'),start:node.sourceCodeLocation.startOffset}));
  const diagnostics = [];
  if (chapters.length !== 44) diagnostics.push({severity:'error',message:'Expected 44 source work anchors; found '+chapters.length});
  const metadata = {name:'Project Gutenberg',ebookNumber:100,sourceFile:'pg100-images.html',rights:'Public domain in the USA',
    sha256:crypto.createHash('sha256').update(html,'utf8').digest('hex'),releaseDate:'1994-01-01',visibleUpdate:'2025-08-24',
    htmlModified:'2026-05-01T07:55:46.077975+00:00',generator:'Ebookmaker 0.13.9 by Project Gutenberg'};
  const reviewedCues = new Map((metadata.sha256===cueEvidence.sourceSha256?cueEvidence.entries:[]).map((entry)=>[entry.sourceRef.start,entry]));
  const manifest = options.manifest || JSON.parse(fs.readFileSync(path.join(__dirname,'../data/manifest.json'),'utf8'));
  const identityKey = (text)=>text.toLowerCase().replace(/[’']/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  const lineStarts=[0];
  for(let index=0;index<html.length;index+=1) if(html[index]==='\n') lineStarts.push(index+1);
  function lineAt(position) {
    let low=0;let high=lineStarts.length;
    while(low+1<high){const middle=(low+high)>>>1;if(lineStarts[middle]<=position)low=middle;else high=middle;}
    return {line:low+1,column:position-lineStarts[low]+1};
  }
  const footer = html.indexOf('<section class="pg-boilerplate pgfooter"');
  const exclusions=[{kind:'document-frontmatter',start:0,end:chapters[0]?.start||0,reason:'Gutenberg header, collection title and global navigation; original source retained'}];
  const plays=[];
  for(let chapterIndex=0;chapterIndex<chapters.length;chapterIndex+=1){
    const boundary=chapters[chapterIndex];
    const end=chapters[chapterIndex+1]?.start ?? (footer>=0?footer:html.length);
    const number=Number(boundary.chapterId.slice(4));
    if(number<2 || number>39){exclusions.push({kind:'non-play-work',chapterId:boundary.chapterId,start:boundary.start,end,reason:'Poetry outside the agreed 38-play collection'});continue;}
    const title=blockText(boundary.node).text;
    const identity=manifest.plays.find((item)=>identityKey(item.title)===identityKey(title));
    if(!identity){diagnostics.push({severity:'error',message:'No existing play identity for '+boundary.chapterId+': '+title,sourceRef:{start:boundary.start,end,...lineAt(boundary.start)}});continue;}
    const work={id:identity.id,title,author:'William Shakespeare',genre:identity.genre};
    const source={...metadata,chapterId:boundary.chapterId};
    const nodes=all.filter((node)=>node.sourceCodeLocation.startOffset>=boundary.start && node.sourceCodeLocation.startOffset<end);
    const anchors=nodes.filter((node)=>attr(node,'id')).map((node)=>({id:attr(node,'id'),start:node.sourceCodeLocation.startOffset}));
    function ref(node){
      const start=node.sourceCodeLocation.startOffset;
      const contained=findAll(node,(child)=>Boolean(attr(child,'id')))[0];
      const anchor=contained?attr(contained,'id'):[...anchors].reverse().find((item)=>item.start<=start)?.id||boundary.chapterId;
      return {start,end:node.sourceCodeLocation.endOffset,...lineAt(start),path:boundary.chapterId+'/'+(node.tagName||'#text')+'@'+(start-boundary.start),anchor};
    }
    const selected=[];
    function collect(node){
      const loc=node.sourceCodeLocation;
      if(loc && (loc.startOffset>=end || loc.endOffset<=boundary.start))return;
      if(node.tagName && loc && loc.startOffset>=boundary.start){
        const nested=(node.childNodes||[]).some((child)=>findAll(child,(entry)=>BLOCKS.has(entry.tagName)).length);
        if(BLOCKS.has(node.tagName) && !nested){selected.push(node);return;}
        if(!BLOCKS.has(node.tagName)&&!INLINE.has(node.tagName)&&!CONTAINERS.has(node.tagName)&&!['hr','img'].includes(node.tagName))
          diagnostics.push({severity:'error',message:'Unsupported meaningful element <'+node.tagName+'>',sourceRef:ref(node)});
      }
      if(node.nodeName==='#text' && loc && loc.startOffset>=boundary.start && /[^ \t\r\n]/.test(node.value))selected.push(node);
      else for(const child of node.childNodes||[])collect(child);
    }
    collect(tree);
    selected.sort((a,b)=>a.sourceCodeLocation.startOffset-b.sourceCodeLocation.startOffset);
    const sections=[];
    let active;
    let act=null;
    let actParent=null;
    let inductionParent=null;
    function open(kind,block,scene=null){
      const relative=block.sourceRef.start-boundary.start;
      const id=kind==='scene'?work.id+'-'+act+'-'+scene:kind==='induction-scene'?work.id+'-induction-'+scene:work.id+'-'+kind+'-'+relative;
      const parentSectionId=kind==='scene'?actParent:kind==='induction-scene'?inductionParent:
        ['title','cast','setting','contents','induction','act'].includes(kind)?null:actParent;
      active={schemaVersion:'2.0.0',canonicalTextVersion:'1',work,source,
        section:{id,kind,heading:kind==='prologue'&&block.tag==='p'?block.text.split('\n')[0]:block.text,act:kind==='induction-scene'?null:act,scene,parentSectionId,orderInPlay:sections.length+1,sourceRef:block.sourceRef},content:[]};
      sections.push(active);
      if(kind==='act')actParent=id;
      if(kind==='induction')inductionParent=id;
    }
    for(const node of selected){
      const {text,spans}=blockText(node);
      if(!text)continue;
      const sourceRef=ref(node);
      const tag=node.tagName||'#text';
      const classes=(attr(node,'class')||'').split(/ +/).filter(Boolean);
      const nextCell=['td','th'].includes(tag)&&(node.parentNode.childNodes||[]).some((sibling)=>sibling.sourceCodeLocation?.startOffset>sourceRef.start&&['td','th'].includes(sibling.tagName));
      const block={id:work.id+'/'+sourceRef.anchor+'/'+tag+'@'+(sourceRef.start-boundary.start),type:/^h[1-6]$/.test(tag)?'heading':'passage',
        tag,classes,text,separatorAfter:['td','th'].includes(tag)?(nextCell?'\t':'\n'):'\n\n',spans,lines:[],sourceRef,speakerLabel:null,attribution:{status:'not-applicable'}};
      let lineStart=0;
      block.lines=text.split('\n').map((line,index)=>{const item={id:block.id+'/line-'+(index+1),start:lineStart,end:lineStart+line.length,sourceLineNumber:null};lineStart+=line.length+1;return item;});
      const label=text.trim();
      const heading=/^h[1-6]$/.test(tag);
      const actMatch=heading&&label.match(/^ACT\s+([IVXLCDM]+)\b/i);
      const sceneMatch=heading&&label.match(/^SCENE\s+([IVXLCDM]+)\./i);
      if(!active)open('title',block);
      else if(actMatch){act=roman(actMatch[1].toUpperCase());inductionParent=null;open('act',block);}
      else if(heading&&/^INDUCTION\b/i.test(label)){act=null;actParent=null;open('induction',block);}
      else if(sceneMatch){
        const scene=roman(sceneMatch[1].toUpperCase());
        if(inductionParent&&act===null)open('induction-scene',block,scene);
        else if(act!==null)open('scene',block,scene);
        else{open('unnumbered-scene',block,scene);diagnostics.push({severity:'warning',message:'Scene has no source act context',sourceRef});}
      }
      else if(heading&&/^Dramatis Person[æa]/i.test(label))open('cast',block);
      else if(heading&&/^SCENE[.:]/i.test(label))open('setting',block);
      else if(heading&&/^(?:\[)?(?:THE )?PROLOGUE\b/i.test(label))open('prologue',block);
      else if(heading&&/^(?:\[)?(?:THE )?EPILOGUE\b/i.test(label))open('epilogue',block);
      else if(heading&&/^CONTENTS\b/i.test(label))open('contents',block);
      else if(tag==='p'&&findAll(node,(child)=>/\.0$/.test(attr(child,'id')||'')).length&&/^(?:THE )?PROLOGUE\b/.test(label))open('prologue',block);
      if(active.section.kind==='cast'&&tag==='p')block.type='cast';
      else if(classes.includes('scenedesc'))block.type='stage';
      else if(tag==='p' && !['title','contents','cast','setting'].includes(active.section.kind)){
        const firstLine=text.split('\n')[0];
        const songCaption=/^(?:[\p{Lu}’']+ )*SONG\.?$/u.test(firstLine);
        const wholeCue=text.includes('\n')&&/^(?:\p{Lu}|\d+ \p{Lu})[\p{Lu}\p{M}\p{N}’' ,&.\-]*(?:(?:and|of|the) \p{Lu}[\p{Lu}\p{M}\p{N}’' ,&.\-]*)?$/u.test(firstLine)?firstLine:null;
        const prefixCue=firstLine.match(/^((?:\p{Lu}|\d+ \p{Lu})[\p{Lu}\p{M}\p{N}’' ,&.\-]*(?:(?:and|of|the) \p{Lu}[\p{Lu}\p{M}\p{N}’' ,&.\-]*)?\.)(?=\s|$)/u)?.[1];
        const annotatedCue=firstLine.match(/^((?:\p{Lu}|\d+ \p{Lu})[\p{Lu}\p{M}\p{N}’' ,&.\-]*?)(?= [\[(])/u)?.[1];
        const reviewed=reviewedCues.get(sourceRef.start);
        if(reviewed && (reviewed.workId!==work.id || reviewed.sourceRef.end!==sourceRef.end || firstLine!==reviewed.label || !text.includes('\n')))
          diagnostics.push({severity:'error',message:'Reviewed source cue no longer matches its pinned source evidence',sourceRef});
        const cue=reviewed?.label||wholeCue||prefixCue||annotatedCue;
        if(songCaption){block.type=text.includes('\n')?'passage':'heading';block.attribution={status:text.includes('\n')?'source-unlabelled':'not-applicable'};}
        else if(cue){block.type='speech';block.speakerLabel=cue;block.attribution={status:'explicit',cueStart:0,cueEnd:cue.length,...(reviewed?{evidence:'reviewed-source-cue'}:{})};}
        else block.attribution={status:'source-unlabelled'};
      }
      active.content.push(block);
      walk(node,(child)=>{if(child!==node&&child.tagName&&!INLINE.has(child.tagName))
        diagnostics.push({severity:'error',message:'Unsupported inline element <'+child.tagName+'>',sourceRef:ref(child)});});
    }
    const sectionRefs=sections.map((item)=>{const details=item.section;return {id:details.id,kind:details.kind,
      path:details.kind==='scene'?'./scenes/act-'+details.act+'-scene-'+details.scene+'.json':'./sections/'+details.kind+'-'+(details.sourceRef.start-boundary.start)+'.json',
      act:details.act,scene:details.scene,parentSectionId:details.parentSectionId,orderInPlay:details.orderInPlay,heading:details.heading};});
    const acts=[...new Set(sectionRefs.filter((item)=>item.kind==='scene').map((item)=>item.act))].map((number)=>({act:number,
      scenes:sectionRefs.filter((item)=>item.kind==='scene'&&item.act===number).map((item)=>({scene:item.scene,id:item.id,label:'Act '+item.act+', Scene '+item.scene,
        title:item.heading,path:item.path,lineCount:sections.find((section)=>section.section.id===item.id).content.reduce((sum,block)=>sum+block.lines.length,0)}))}));
    const play={schemaVersion:'2.0.0',canonicalTextVersion:'1',...work,fullTitle:title,source,
      paths:{characters:'./characters.json',synopsis:'./synopsis.json',quiz:'./quiz.json',scenes:'./scenes/',sections:'./sections/'},acts,sections:sectionRefs};
    play.contentVersion=computeContentVersion(play,sections);
    for(const section of sections)section.contentVersion=play.contentVersion;
    plays.push({play,sections});
  }
  if(footer>=0)exclusions.push({kind:'gutenberg-footer',start:footer,end:html.length,reason:'Gutenberg license and distribution boilerplate retained in original source'});
  return {plays,source:metadata,exclusions,diagnostics};
}

function generateCollection({sourceFile,outDir,supportRoot}){
  if(!sourceFile||!outDir||!supportRoot)throw new Error('Explicit sourceFile, outDir and supportRoot are required');
  // Resolve the nearest existing ancestor so junctions/symlinks cannot send a
  // supposedly temporary output path back into this repository or its inputs.
  function realTarget(target) {
    let ancestor=path.resolve(target);
    const suffix=[];
    while(!fs.existsSync(ancestor)) { suffix.unshift(path.basename(ancestor)); const parent=path.dirname(ancestor); if(parent===ancestor)break; ancestor=parent; }
    return path.resolve(fs.realpathSync(ancestor),...suffix);
  }
  function contains(parent,child) { const relative=path.relative(parent,child); return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)); }
  const target=realTarget(outDir);
  const repository=realTarget(path.resolve(__dirname,'..'));
  if(contains(repository,target)||contains(target,realTarget(sourceFile))||contains(target,realTarget(supportRoot)))
    throw new Error('Output must be an external temporary candidate outside the repository and protected inputs');
  const input=fs.readFileSync(sourceFile);
  if(crypto.createHash('sha256').update(input).digest('hex')!==SOURCE_SHA256)throw new Error('Source checksum mismatch; review source changes explicitly');
  if(path.resolve(outDir)===path.resolve(__dirname,'../data/plays'))throw new Error('Generate into a temporary candidate, not tracked data/plays');
  if(fs.existsSync(outDir)&&fs.readdirSync(outDir).length)throw new Error('Candidate output must be empty');
  const parsed=parseSource(input.toString('utf8'));
  if(parsed.diagnostics.some((item)=>item.severity==='error'))throw new Error(JSON.stringify(parsed.diagnostics));
  if(parsed.plays.length!==38)throw new Error('Expected 38 plays');
  const inventory=[];
  for(const {play,sections} of parsed.plays){
    const folder=path.join(outDir,play.id);
    function write(relative,data){const target=path.join(folder,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(data,null,2)+'\n','utf8');inventory.push(play.id+'/'+relative.replace(/\\/g,'/'));}
    write('play.json',play);
    for(let index=0;index<sections.length;index+=1)write(play.sections[index].path.replace(/^\.\//,''),sections[index]);
    for(const file of ['characters.json','synopsis.json','quiz.json']){
      const original=path.join(supportRoot,play.id,file);
      if(!fs.existsSync(original))throw new Error('Missing protected support file: '+original);
      fs.copyFileSync(original,path.join(folder,file));
    }
  }
  return {...parsed,inventory:inventory.sort()};
}
if(require.main===module){
  try{
    const args=process.argv.slice(2);
    const option=(flag)=>args[args.indexOf(flag)+1];
    if(!args.includes('--source')||!args.includes('--out'))throw new Error('Usage: node scripts/parseGutenberg.js --source <pinned HTML> --out <empty temporary plays directory> [--support-root <original plays>]');
    const result=generateCollection({sourceFile:option('--source'),outDir:option('--out'),supportRoot:args.includes('--support-root')?option('--support-root'):path.resolve(__dirname,'../data/plays')});
    console.log(JSON.stringify({plays:result.plays.length,generatedFiles:result.inventory.length,diagnostics:result.diagnostics},null,2));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={parseSource,generateCollection,SOURCE_SHA256};
