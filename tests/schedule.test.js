const { test }=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createService}=require('../shared/domain');
const {createMemoryStore}=require('../shared/memory-store');
const {parseDeadline,taskView,hasDuration}=require('../shared/view');
const {scheduleDraft,enableDuration,followStart,changeScheduleField,scheduleFields}=require('../shared/schedule-draft');
const hour=3600000;
async function fixture() {
  let now=parseDeadline('2026-10-30','12:00');
  const store=createMemoryStore();
  const run=createService({store,now:()=>now,randomId:()=>crypto.randomBytes(16).toString('hex'),hash:s=>crypto.createHash('sha256').update(s).digest('hex')});
  const {clubId}=await run('createClub',{name:'SPS',nickname:'Owner',requestId:'duration-club'},'owner');
  const board=()=>run('bootstrap',{clubId},'owner'), b=await board();
  const input={clubId,requestId:'duration-task',title:'持续任务',description:'',priority:'normal',mode:'individual',participantIds:[b.me.id],dueAt:now+24*hour};
  return {run,store,board,input,start:now+48*hour,end:now+50*hour,advance:ms=>now+=ms};
}

test('duration is opt-in; its initial deadline follows start and survives edits and sync',async()=>{
  const f=await fixture();
  const plain=await f.run('createTask',f.input,'owner');
  assert.equal(hasDuration(plain.task),false);
  const before=await f.board();
  const event=await f.run('createTask',{...f.input,requestId:'with-duration',dueAt:undefined,startsAt:f.start,endsAt:f.end},'owner');
  assert.equal(event.task.dueAt,f.start); assert.equal(event.task.deadlineFollowsStart,true);
  const edited=await f.run('editTask',{...event.task,taskId:event.taskId,startsAt:f.start+hour},'owner');
  assert.equal(edited.task.dueAt,f.start+hour);
  const delta=await f.run('sync',{clubId:f.input.clubId,since:before.version},'owner');
  assert.equal(delta.tasks[0].startsAt,f.start+hour);
  assert.equal((await f.run('editTask',{...edited.task,taskId:edited.taskId},'owner')).version,edited.version);
});

test('manual deadline overrides persist when the interval changes and can explicitly resume following',async()=>{
  const f=await fixture();
  let t=(await f.run('createTask',{...f.input,startsAt:f.start,endsAt:f.end,deadlineFollowsStart:true},'owner')).task;
  t=(await f.run('editTask',{...t,taskId:t._id,dueAt:f.start-hour,deadlineFollowsStart:false},'owner')).task;
  t=(await f.run('editTask',{...t,taskId:t._id,startsAt:f.start+hour,endsAt:f.end+hour},'owner')).task;
  assert.equal(t.dueAt,f.start-hour); assert.equal(t.deadlineFollowsStart,false);
  // Legacy clients can still change a deadline without erasing a stored interval.
  t=(await f.run('editTask',{taskId:t._id,title:t.title,priority:t.priority,revision:t.revision,dueAt:f.end+2*hour},'owner')).task;
  assert.equal(t.startsAt,f.start+hour); assert.equal(t.dueAt,f.end+2*hour);
  t=(await f.run('editTask',{...t,taskId:t._id,deadlineFollowsStart:true},'owner')).task;
  assert.equal(t.dueAt,t.startsAt);
  t=(await f.run('editTask',{...t,taskId:t._id,startsAt:null,endsAt:null,deadlineFollowsStart:false},'owner')).task;
  assert.equal(hasDuration(t),false); assert.equal(t.dueAt,f.start+hour);
});

test('invalid and partial intervals reject atomically, and subtasks cannot acquire duration',async()=>{
  const f=await fixture(), original=f.store.snapshot();
  for(const patch of [
    {startsAt:f.start},{endsAt:f.end},{startsAt:f.start,endsAt:f.start},
    {startsAt:f.end,endsAt:f.start},{startsAt:'tomorrow',endsAt:f.end},
    {startsAt:f.start,endsAt:f.end+6*366*24*hour},{startsAt:null,endsAt:null,deadlineFollowsStart:true},
    {startsAt:f.start,endsAt:f.end,deadlineFollowsStart:'false'}
  ]) await assert.rejects(f.run('createTask',{...f.input,...patch},'owner'),{code:'VALIDATION'});
  assert.deepEqual(f.store.snapshot(),original);
  const parent=await f.run('createTask',f.input,'owner');
  const childInput={...f.input,requestId:'duration-child',parentTaskId:parent.taskId};
  await assert.rejects(f.run('createTask',{...childInput,startsAt:f.start,endsAt:f.end},'owner'),{code:'VALIDATION'});
  const child=await f.run('createTask',childInput,'owner');
  await assert.rejects(f.run('editTask',{...child.task,taskId:child.taskId,startsAt:f.start,endsAt:f.end},'owner'),{code:'VALIDATION'});
  const snapshot=f.store.snapshot();
  await assert.rejects(f.run('createTaskGroup',{...f.input,requestId:'invalid-duration-group',subtasks:[{...f.input,daysBefore:0,startsAt:f.start,endsAt:f.end}]},'owner'),{code:'VALIDATION'});
  assert.deepEqual(f.store.snapshot(),snapshot);
});

test('task groups use the automatic start deadline for relative steps; main edits leave published children intact',async()=>{
  const f=await fixture();
  const group=await f.run('createTaskGroup',{...f.input,startsAt:f.start,endsAt:f.end,deadlineFollowsStart:true,subtasks:[{...f.input,daysBefore:1,followMain:true}]},'owner');
  assert.equal(group.tasks[1].dueAt,f.start-24*hour); assert.equal(hasDuration(group.tasks[1]),false);
  await f.run('editTask',{...group.task,taskId:group.taskId,startsAt:f.start+hour},'owner');
  assert.equal((await f.store.get('tasks',group.tasks[1]._id)).dueAt,group.tasks[1].dueAt);
});

test('duration edits preserve authorization, stale-edit protection and past completion history',async()=>{
  const f=await fixture();
  const created=await f.run('createTask',{...f.input,startsAt:f.start,endsAt:f.end,deadlineFollowsStart:true},'owner');
  await assert.rejects(f.run('editTask',{...created.task,taskId:created.taskId},'outsider'),{code:'FORBIDDEN'});
  const done=await f.run('complete',{taskId:created.taskId,done:true},'owner');
  await assert.rejects(f.run('editTask',{...created.task,taskId:created.taskId,endsAt:f.end+hour},'owner'),{code:'CONFLICT'});
  f.advance(5*24*hour);
  const changed=await f.run('editTask',{...done.task,taskId:created.taskId,description:'历史说明'},'owner');
  assert.deepEqual(changed.task.completions,done.task.completions);
  assert.equal(changed.task.startsAt,f.start); assert.equal(changed.task.dueAt,f.start);
});

test('drafts default to deadline only, follow starts until manually changed, and restore persisted intent',()=>{
  const f={date:'2026-11-01',time:'23:30',...scheduleDraft(null)};
  assert.equal(f.hasDuration,false);
  enableDuration(f,true);
  assert.equal(f.endDate,'2026-11-02'); assert.equal(f.endTime,'00:30');
  changeScheduleField(f,'startTime','22:00'); assert.equal(f.time,'22:00');
  changeScheduleField(f,'time','21:00');
  changeScheduleField(f,'startDate','2026-11-02'); assert.equal(f.date,'2026-11-01'); assert.equal(f.time,'21:00');
  const stored=scheduleFields(f); assert.equal(scheduleDraft(stored).deadlineFollowsStart,false);
  enableDuration(f,true); assert.equal(f.time,'21:00'); // Clicking the selected mode is a no-op.
  followStart(f); assert.equal(f.time,'22:00'); assert.equal(f.date,'2026-11-02');
  enableDuration(f,false); assert.equal(scheduleFields(f).startsAt,null); assert.equal(f.time,'22:00');
});

test('duration editor and detail render only on main tasks; older and child records stay deadline-only',async()=>{
  const {buildSync}=require('esbuild');
  const bundle=buildSync({entryPoints:['client/views.js'],bundle:true,format:'esm',write:false});
  const views=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const f=await fixture(), created=await f.run('createTask',{...f.input,startsAt:f.start,endsAt:f.end},'owner'), b=await f.board();
  const form={...created.task,...scheduleDraft(created.task),date:'2026-10-31',time:'12:00'};
  assert.match(views.editor({form,editBoard:b,steps:[]}),/开始日期/);
  const child=views.editor({form,editBoard:b,steps:[],parent:{_id:'parent',title:'Parent'}});
  assert.ok(!child.includes('开始日期')); assert.ok(!child.includes('data-action="duration"'));
  const detail=views.detail({id:created.taskId,sync:{board:b,phase:'ready'}});
  assert.ok(detail.includes('持续时段')); assert.ok(detail.includes('2026-11-01 12:00 — 14:00'));
  assert.equal(taskView({...created.task,parentTaskId:'parent'},b).durationLabel,'');
});
