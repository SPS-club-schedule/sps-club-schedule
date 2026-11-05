const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const vm=require('node:vm');
const {parseDeadline}=require('../shared/view');
function fixture(role='owner'){
  const ctx={exports:{},window:{matchMedia:()=>({matches:false})},setTimeout,clearTimeout,crypto:{randomUUID:()=> 'local-view-test'},sessionStorage:{getItem:()=>null}};ctx.module={exports:ctx.exports};
  vm.runInNewContext(buildSync({entryPoints:['client/simple.js'],bundle:true,format:'cjs',write:false}).outputFiles[0].text,ctx);
  const dueAt=parseDeadline('2026-11-06','10:00'),board={club:{id:'c'},me:{id:'me',role},members:[{id:'me',name:'<img src=x>',role}],tasks:[{_id:'root',title:'<script>alert(1)</script>',dueAt,participantIds:['me'],completions:{me:dueAt},mode:'individual',creatorId:'me'},{_id:'child',title:'预约教室',parentTaskId:'root',dueAt,startsAt:dueAt-3600000,endsAt:dueAt,participantIds:['me'],completions:{me:dueAt},sharedCompletion:null,mode:'individual',creatorId:'me'}]};
  const s={page:'simple',sync:{board,phase:'ready'},error:''};
  const simple=ctx.module.exports.createSimple({root:{querySelector:()=>null},getState:()=>s,render(){},go(){},perform(){},toast(){},confirmAction(){}});
  simple.input({type:'change',target:{name:'simpleDate',value:'2026-11-06'}});
  return {simple,s};
}
test('simple calendar renders completed records without state/priority/hierarchy controls and escapes titles',()=>{
  const {simple,s}=fixture();const html=simple.view(s);
  assert.match(html,/预约教室/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|已完成|未完成|已逾期|优先|data-action="toggle"|主任务|子任务/);
});
test('new button respects selected date and form has only headings, times and assignees',()=>{
  const {simple,s}=fixture();simple.action('simpleNew');const html=simple.view(s);
  assert.match(html,/value="2026-11-06T09:00"/);assert.match(html,/value="2026-11-06T10:00"/);
  for(const name of ['simpleMajor','simpleMinor','simpleStart','simpleEnd','simplePerson'])assert.match(html,new RegExp('name="'+name+'"'));
  assert.doesNotMatch(html,/name="priority"|name="description"|data-action="addStep"/);
});
test('speaker simple calendar has no create or edit controls',()=>{
  const {simple,s}=fixture('speaker');const html=simple.view(s);assert.doesNotMatch(html,/data-action="simpleNew"/);
  simple.action('simpleDetail','', 'child');const detail=simple.view(s);assert.doesNotMatch(detail,/data-action="simpleEdit"|data-action="simpleArchive"/);
});
