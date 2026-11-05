const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const vm=require('node:vm');
const {parseDeadline}=require('../shared/view');
function fixture(role='owner',bundled=false){
  const session=role==='guest'?null:{token:'a'.repeat(64),user:{id:'me',username:'view_test'},expiresAt:Date.now()+3600000};
  const routes=[];
  const ctx={exports:{},window:{matchMedia:()=>({matches:false})},setTimeout,clearTimeout,crypto:{randomUUID:()=> 'local-view-test'},sessionStorage:{getItem:key=>key==='sps-web-session'?JSON.stringify(session):null}};ctx.module={exports:ctx.exports};
  vm.runInNewContext(buildSync({entryPoints:['client/simple.js'],bundle:true,format:'cjs',write:false,define:{__BUNDLED_APP__:String(bundled)}}).outputFiles[0].text,ctx);
  const dueAt=parseDeadline('2026-11-06','10:00'),board={club:{id:'c'},me:{id:'me',role},members:[{id:'me',name:'<img src=x>',role}],tasks:[{_id:'root',title:'<script>alert(1)</script>',dueAt,participantIds:['me'],completions:{me:dueAt},mode:'individual',creatorId:'me'},{_id:'child',title:'预约教室',parentTaskId:'root',dueAt,startsAt:dueAt-3600000,endsAt:dueAt,participantIds:['me'],completions:{me:dueAt},sharedCompletion:null,mode:'individual',creatorId:'me'}]};
  const s={page:'simple',sync:{board,phase:'ready'},error:''};
  const simple=ctx.module.exports.createSimple({root:{querySelector:()=>null},getState:()=>s,render(){},go(path){routes.push(path);},perform(){},toast(){},confirmAction(){}});
  simple.input({type:'change',target:{name:'simpleDate',value:'2026-11-06'}});
  return {simple,s,routes};
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
function bookingFixture(role='owner'){
  const f=fixture(role),startsAt=parseDeadline('2026-11-06','09:30');
  f.s.booking={from:'2026-11-05',to:'2027-01-05',activities:[{id:'reservation',club:'SPS <img src=x>',title:'预约 <script>',location:'物理楼 <svg>',startsAt,endsAt:startsAt+3600000}]};
  return f;
}
test('simple reservations have a separate style and read-only details with escaped location and booking link',()=>{
  const {simple,s}=bookingFixture();const html=simple.view(s);
  assert.match(html,/class="simple-block simple-booking"/);assert.match(html,/预约 · SPS &lt;img src=x&gt;/);assert.match(html,/2026-11-05 至 2027-01-05/);
  simple.action('simpleDetail','','booking:reservation');
  const detail=simple.view(s).split('<dialog')[1];
  assert.match(detail,/2026-11-06 09:30 — 2026-11-06 10:30/);assert.match(detail,/地点：物理楼 &lt;svg&gt;/);assert.match(detail,/data-action="enterBooking"/);
  assert.doesNotMatch(detail,/<script>|<img|<svg|负责人：|simpleEdit|simpleArchive|完成/);
  simple.action('simpleClose');assert.doesNotMatch(simple.view(s),/<dialog/);
});
test('simple booking refresh failures keep prior blocks visible and expose retry without claiming an empty calendar',()=>{
  const {simple,s}=bookingFixture();s.booking.error='预约活动暂时无法更新';
  assert.match(simple.view(s),/暂时无法更新，保留上次内容/);assert.match(simple.view(s),/class="simple-block simple-booking"/);
  s.bookingLoading=true;assert.match(simple.view(s),/data-action="refreshBooking"[^>]*disabled/);
  s.booking={error:'预约活动暂时无法更新'};s.bookingLoading=false;
  assert.match(simple.view(s),/预约活动暂时无法更新/);assert.doesNotMatch(simple.view(s),/simple-block simple-booking/);
});
test('speaker minimal view retains assigned-task-only access even with cached booking data',()=>{
  const {simple,s}=bookingFixture('speaker');
  simple.action('simpleDetail','','booking:reservation');const html=simple.view(s);
  assert.doesNotMatch(html,/simple-block simple-booking|预约时段|refreshBooking|enterBooking|<dialog/);
});

test('schedule-origin booking outside my assignments still opens its read-only detail',()=>{
  const {simple,s}=bookingFixture();const taskId='t_'+'b'.repeat(32),activity=s.booking.activities[0];
  activity.id='sps:'+taskId+':2026-11-06';s.sync.board.members.push({id:'other',name:'同学'});
  s.sync.board.tasks.push({_id:taskId,title:activity.title,participantIds:['other'],startsAt:activity.startsAt,endsAt:activity.endsAt,dueAt:activity.endsAt,mode:'individual',creatorId:'other'});
  simple.input({type:'change',target:{name:'simpleScope',value:'mine'}});
  assert.match(simple.view(s),/simple-block simple-booking/);
  simple.action('simpleDetail','','booking:'+activity.id);
  assert.match(simple.view(s).split('<dialog')[1],/data-action="enterBooking"/);
  simple.action('simpleClose');simple.input({type:'change',target:{name:'simpleScope',value:'club'}});
  assert.doesNotMatch(simple.view(s),/simple-block simple-booking/);
});

test('guest simple calendar displays public bookings without private tasks, account or write controls',async()=>{
  const {simple,s,routes}=bookingFixture('guest');await simple.enter();
  const html=simple.view(s);
  assert.match(html,/预约 · SPS/);assert.match(html,/data-action="simpleLogin"/);assert.match(html,/公开预约/);
  assert.doesNotMatch(html,/data-action="simpleNew"|simplePerson|name="simpleScope"|账号设置|关闭任务邮件|准备同步|&lt;script&gt;alert/);
  simple.action('simpleLogin');assert.equal(routes.at(-1),'/auth?next=%2Fsimple');
  simple.action('simpleFull');assert.equal(routes.at(-1),'/mine');
  simple.action('simpleNew');assert.equal(routes.at(-1),'/auth?next=%2Fsimple');
  simple.action('simpleDetail','','booking:reservation');
  const detail=simple.view(s).split('<dialog')[1];assert.match(detail,/地点：物理楼/);assert.doesNotMatch(detail,/simpleEdit|simpleArchive/);
});

test('bundled guest and signed-in calendars keep login/settings but remove downloads and duplicate mode controls',()=>{
  for(const role of ['guest','owner']){
    const {simple,s}=fixture(role,true),html=simple.view(s);
    assert.doesNotMatch(html,/下载.*App|分享包|simpleFull|simpleEnter/);
    assert.match(html,role==='guest'?/data-action="simpleLogin"/:/账号设置/);
  }
});
