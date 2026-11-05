const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createService}=require('../shared/domain');
const {createMemoryStore}=require('../shared/memory-store');
const {parseDeadline,hasDuration}=require('../shared/view');
const {simpleEntries,matchingParents,selectionRange,blockLayout,simpleDays}=require('../shared/simple-calendar');
const NOW=parseDeadline('2026-11-05','08:00'),HOUR=3600000;
async function fixture(){
  const store=createMemoryStore(),run=createService({store,now:()=>NOW,randomId:()=>crypto.randomBytes(16).toString('hex'),hash:s=>crypto.createHash('sha256').update(s).digest('hex')});
  const {clubId}=await run('createClub',{name:'SPS',nickname:'负责人',requestId:'simple-club'},'owner');
  const b=await run('bootstrap',{clubId},'owner');
  const input={clubId,major:'科研分享会',minor:'预约教室',startsAt:NOW+HOUR,endsAt:NOW+2*HOUR,participantIds:[b.me.id],requestId:'simple-first'};
  return {store,run,b,input,board:()=>run('bootstrap',{clubId},'owner')};
}
test('simple titles atomically create a container and child; retries and concurrent matching create only one root',async()=>{
  const f=await fixture();
  const [a,b]=await Promise.all([f.run('createSimpleTask',f.input,'owner'),f.run('createSimpleTask',{...f.input,minor:'制作海报',requestId:'simple-second'},'owner')]);
  assert.equal(a.task.parentTaskId,b.task.parentTaskId);assert.ok(hasDuration(a.task));
  assert.equal((await f.run('createSimpleTask',f.input,'owner')).taskId,a.taskId);
  const board=await f.board();assert.equal(board.tasks.length,3);assert.equal(board.tasks.filter(t=>t.simpleContainer).length,1);
  const entries=simpleEntries(board,'club');assert.equal(entries.length,2);assert.equal(entries[0].major,'科研分享会');assert.deepEqual(new Set(entries.map(t=>t.minor)),new Set(['预约教室','制作海报']));
});
test('blank subtitle promotes a heading once with independent duration and replay protection',async()=>{
  const f=await fixture();const child=await f.run('createSimpleTask',f.input,'owner');
  const input={...f.input,minor:'',requestId:'simple-parent'};
  const main=await f.run('createSimpleTask',input,'owner');assert.equal(main.taskId,child.task.parentTaskId);assert.equal(main.task.simpleContainer,false);assert.ok(hasDuration(main.task));
  assert.equal((await f.run('createSimpleTask',input,'owner')).taskId,main.taskId);assert.equal((await f.board()).tasks.length,2);
  await assert.rejects(f.run('createSimpleTask',{...input,requestId:'duplicate-main'},'owner'),{code:'CONFLICT'});
});
test('existing full-mode roots match normalized whole headings; equal start/end is a deadline',async()=>{
  const f=await fixture();const parent=await f.run('createTask',{clubId:f.input.clubId,requestId:'old-full-main',title:' 科研分享会 ',priority:'normal',mode:'individual',participantIds:f.input.participantIds,dueAt:NOW+HOUR},'owner');
  const child=await f.run('createSimpleTask',{...f.input,endsAt:f.input.startsAt},'owner');
  assert.equal(child.task.parentTaskId,parent.taskId);assert.equal(child.task.dueAt,f.input.startsAt);assert.equal(child.task.startsAt,null);
  assert.equal(matchingParents([{title:'Ａ  B'},{title:'A B more'}],'a b').length,1);
});
test('same-name ambiguity and forged cross-club parents fail without creating records',async()=>{
  const f=await fixture();const fields={clubId:f.input.clubId,title:'科研分享会',priority:'normal',mode:'individual',participantIds:f.input.participantIds,dueAt:NOW+HOUR};
  const a=await f.run('createTask',{...fields,requestId:'old-main-one'},'owner');await f.run('createTask',{...fields,requestId:'old-main-two'},'owner');
  const before=f.store.snapshot();await assert.rejects(f.run('createSimpleTask',f.input,'owner'),{code:'CONFLICT'});assert.deepEqual(f.store.snapshot(),before);
  await assert.rejects(f.run('createSimpleTask',{...f.input,parentTaskId:'foreign'},'owner'),{code:'CONFLICT'});
  const child=await f.run('createSimpleTask',{...f.input,parentTaskId:a.taskId},'owner');assert.equal(child.task.parentTaskId,a.taskId);
});
test('core members may append to a shared title without permission to change the root; outsiders and speakers cannot',async()=>{
  const f=await fixture();const parent=await f.run('createSimpleTask',{...f.input,minor:''},'owner');
  const invite=await f.run('getInvite',{clubId:f.input.clubId},'owner');
  await f.run('joinClub',{token:invite.token,nickname:'同学',requestId:'join-simple'},'member');
  const other=await f.run('bootstrap',{clubId:f.input.clubId},'member');
  const child=await f.run('createSimpleTask',{...f.input,participantIds:[other.me.id],requestId:'member-child'},'member');assert.equal(child.task.parentTaskId,parent.taskId);
  await assert.rejects(f.run('editSimpleTask',{...f.input,taskId:parent.taskId,revision:1,minor:''},'member'),{code:'FORBIDDEN'});
  await assert.rejects(f.run('createSimpleTask',f.input,'outsider'),{code:'FORBIDDEN'});
  await f.store.transaction(async tx=>{const m=await tx.get('members',other.me.id);await tx.put('members',m._id,{...m,role:'speaker'});});
  await assert.rejects(f.run('createSimpleTask',{...f.input,requestId:'speaker-child'},'member'),{code:'FORBIDDEN'});
});
test('simple editing preserves original records, protects stale edits and never shows completion state',async()=>{
  const f=await fixture();const a=await f.run('createSimpleTask',f.input,'owner');
  const edited=await f.run('editSimpleTask',{...f.input,taskId:a.taskId,revision:1,minor:'确认教室',endsAt:NOW+3*HOUR},'owner');assert.equal(edited.task.parentTaskId,a.task.parentTaskId);assert.equal(edited.task.endsAt,NOW+3*HOUR);
  await assert.rejects(f.run('editSimpleTask',{...f.input,taskId:a.taskId,revision:1},'owner'),{code:'CONFLICT'});
  const before=simpleEntries(await f.board(),'club');await f.run('complete',{taskId:a.taskId,done:true},'owner');assert.deepEqual(simpleEntries(await f.board(),'club'),before);
});
test('bad dates and assignees reject atomically, without leaving empty headings',async()=>{
  const f=await fixture(),before=f.store.snapshot();
  for(const patch of [{endsAt:NOW},{startsAt:'tomorrow'},{participantIds:[]},{participantIds:['outsider']},{major:''},{startsAt:NOW-2*HOUR,endsAt:NOW-HOUR}])await assert.rejects(f.run('createSimpleTask',{...f.input,...patch},'owner'),{code:'VALIDATION'});
  assert.deepEqual(f.store.snapshot(),before);
});
test('quarter-hour dragging snaps in either direction, midnight clips and overlaps remain selectable',()=>{
  assert.deepEqual(selectionRange('2026-11-05',40.8,36.2),{startsAt:NOW+HOUR,endsAt:NOW+2*HOUR+15*60000});
  const end=selectionRange('2026-11-05',95,120);assert.equal(end.endsAt,parseDeadline('2026-11-06','00:00'));assert.equal(end.endsAt-end.startsAt,15*60000);
  const day=simpleDays('2026-11-05','day')[0];
  const entries=[{key:'a',kind:'block',startsAt:day.start-HOUR,endsAt:NOW+HOUR},{key:'b',kind:'block',startsAt:NOW,endsAt:NOW+2*HOUR},{key:'c',kind:'block',startsAt:NOW+2*HOUR,endsAt:NOW+3*HOUR}];
  const layout=blockLayout(entries,day);assert.equal(layout[0].start,0);assert.equal(layout[0].lanes,2);assert.equal(layout[1].lane,1);assert.equal(layout[2].lanes,1);
});
test('simple calendar overlays manual bookings in every task scope without duplicating schedule-origin blocks',()=>{
  const taskId='t_'+'a'.repeat(32);
  const b={me:{id:'me',role:'owner',department:'academic'},members:[{id:'me',department:'academic'}],tasks:[{_id:taskId,title:'日程',participantIds:['me'],startsAt:NOW,endsAt:NOW+HOUR,dueAt:NOW}]};
  const manual={id:'manual',club:'SPS',title:'手动预约',startsAt:NOW,endsAt:NOW+HOUR};
  const activities=[manual,{...manual,id:'other',club:'其他社团'}, {...manual,id:'sps:t_'+'a'.repeat(32)+':2026-11-05'}, {...manual,endsAt:NOW},null];
  for(const scope of ['mine','department','club']){
    const entries=simpleEntries(b,scope,activities);
    assert.equal(entries.length,3);assert.equal(new Set(entries.map(t=>t.key)).size,3);
    assert.deepEqual(entries.filter(t=>t.external).map(t=>t.minor),['SPS','其他社团']);
    const layout=blockLayout(entries,simpleDays('2026-11-05','day')[0]);
    assert.deepEqual(new Set(layout.map(t=>t.lane)),new Set([0,1,2]));assert.ok(layout.every(t=>t.lanes===3));
  }
  assert.equal(simpleEntries({...b,me:{...b.me,role:'speaker'}},'mine',activities).length,1);
});
test('simple booking blocks span days and clip at midnight without occupying the following day',()=>{
  const b={me:{id:'me',role:'member'},members:[],tasks:[]};
  const entries=simpleEntries(b,'mine',[{id:'overnight',club:'SPS',title:'跨日预约',startsAt:parseDeadline('2026-11-05','23:00'),endsAt:parseDeadline('2026-11-07','00:00')}]);
  const days=simpleDays('2026-11-05','three');
  assert.deepEqual(blockLayout(entries,days[0]).map(t=>[t.start,t.end]),[[92,96]]);
  assert.deepEqual(blockLayout(entries,days[1]).map(t=>[t.start,t.end]),[[0,96]]);
  assert.equal(blockLayout(entries,days[2]).length,0);
});

test('simple calendar keeps schedule-origin reservations for tasks outside the selected scope',()=>{
  const taskId='t_'+'b'.repeat(32),b={me:{id:'me',role:'owner'},members:[{id:'me'},{id:'other'}],tasks:[{_id:taskId,title:'其他成员活动',participantIds:['other'],startsAt:NOW,endsAt:NOW+HOUR,dueAt:NOW}]};
  const activities=[{id:'sps:'+taskId+':2026-11-05',club:'SPS',title:'其他成员活动',startsAt:NOW,endsAt:NOW+HOUR}];
  assert.equal(simpleEntries(b,'mine',activities)[0].external,true);
  const club=simpleEntries(b,'club',activities);assert.equal(club.length,1);assert.equal(club[0].taskId,taskId);assert.equal(club[0].external,undefined);
  b.tasks=[];assert.equal(simpleEntries(b,'club',activities).length,1);
});
