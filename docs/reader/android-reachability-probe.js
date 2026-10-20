(async()=>{
if(document.title!=='THE TEMPEST')throw Error('Expected actual Tempest WebView');
const source=[...document.scripts].map(s=>s.textContent).find(s=>s.includes('installReader'));
const identity=JSON.parse(source.match(/(\{"documentId":"reader-\d+".*?\})/)[1]);
const blocks=[...document.querySelectorAll('[data-reader-block]')],first=blocks[0],last=blocks.at(-1);
const frame=()=>new Promise(r=>requestAnimationFrame(r));
const bounds=b=>{let r=document.createRange();r.selectNodeContents(b);let v=r.getBoundingClientRect();return {top:v.top,bottom:v.bottom,left:v.left,right:v.right}};
const cases=[];let requestId=10000;
for(const fontId of ['literata','source-serif-4','source-sans-3'])for(let fontSize=16;fontSize<=30;fontSize+=2)for(const theme of ['paper','sepia','night'])for(const lineSpacing of ['compact','comfortable','spacious']){
const applied=await window.BardReader.applyAppearance({...identity,requestId:++requestId,preferences:{schemaVersion:1,fontId,fontSize,theme,lineSpacing},fontScale:1.5});
scrollTo(0,0);await frame();const start=bounds(first);
scrollTo(0,document.documentElement.scrollHeight);await frame();const end=bounds(last);
const ok=applied&&start.top>=0&&start.bottom<=innerHeight&&end.top>=0&&end.bottom<=innerHeight&&document.documentElement.scrollWidth<=innerWidth+1;
cases.push({fontId,fontSize,theme,lineSpacing,fontScale:1.5,cssSize:getComputedStyle(document.body).fontSize,viewport:innerHeight,first:start,last:end,clearance:innerHeight-end.bottom,scrollY,maxScroll:document.documentElement.scrollHeight-innerHeight,ok});
}
await window.BardReader.applyAppearance({...identity,requestId:++requestId,preferences:{schemaVersion:1,fontId:'literata',fontSize:20,theme:'paper',lineSpacing:'comfortable'},fontScale:1.5});scrollTo(0,document.documentElement.scrollHeight);
return {summary:{caseCount:cases.length,passed:cases.filter(c=>c.ok).length,failures:cases.filter(c=>!c.ok),minLastGlyphClearance:Math.min(...cases.map(c=>c.clearance)),firstText:first.textContent,lastText:last.textContent,mainPadding:getComputedStyle(document.querySelector('main')).padding,loadedFaces:[...document.fonts].length},cases};
})()