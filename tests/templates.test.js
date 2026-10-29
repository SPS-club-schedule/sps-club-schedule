const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createService } = require('../shared/domain');
const { createMemoryStore } = require('../shared/memory-store');
const { seminarTemplate, relativeDeadline, templateDraft, draftDeadline } = require('../shared/templates');
const { parts, parseDeadline, taskView } = require('../shared/view');
const { deadlineCalendar } = require('../shared/calendar');

async function fixture() {
  let time = Date.parse('2026-10-30T12:00:00+08:00');
  const store=createMemoryStore();
  const run=createService({store,now:()=>time,randomId:()=>crypto.randomBytes(16).toString('hex'),hash:s=>crypto.createHash('sha256').update(s).digest('hex')});
  const {clubId}=await run('createClub',{name:'SPS',nickname:'Owner',requestId:'templates-club'},'owner');
  const invite=await run('getInvite',{clubId},'owner');
  await run('joinClub',{token:invite.token,nickname:'Alice'},'alice');
  const board=()=>run('bootstrap',{clubId},'owner');
  const b=await board(), ids=Object.fromEntries(b.members.map(m=>[m.name.toLowerCase(),m.id]));
  const template=b.templates[0];
  const group=()=>({...template,templateId:template._id,clubId,requestId:'seminar-batch-1',title:'周五研讨班',dueAt:parseDeadline('2026-11-06','18:30'),participantIds:[ids.owner,ids.alice],subtasks:template.steps.map((step,i)=>({...step,participantIds:[i%2?ids.owner:ids.alice]}))});
  return {run,store,clubId,board,ids,template,group,advance:ms=>time+=ms};
}

test('seminar is seeded once per club with the five requested offsets; legacy clubs migrate without changing old tasks',async()=>{
  const f=await fixture();
  assert.deepEqual(f.template.steps.map(s=>s.daysBefore),[4,3,3,2,1]);
  assert.match(f.template.steps[3].title,/院系群/);
  await f.store.transaction(async tx=>{
    const c=await tx.get('clubs',f.clubId); delete c.templatesInitialized; delete c.templatesVersion;
    await tx.put('clubs',c._id,c); await tx.remove('templates',f.template._id);
  });
  const [a,b]=await Promise.all([f.board(),f.board()]);
  assert.equal(a.templates.length,1); assert.equal(b.templates.length,1);
  assert.equal(a.templates[0]._id,f.template._id); assert.equal(a.version,b.version);
  assert.deepEqual((await f.board()).tasks,[]);
});

test('any member creates, edits and categorizes shared templates; stale edits and outsiders are rejected',async()=>{
  const f=await fixture();
  const created=await f.run('createTemplate',{...seminarTemplate(),name:'读书会',category:'学习小组',clubId:f.clubId,requestId:'alice-template-1'},'alice');
  const retry=await f.run('createTemplate',{...seminarTemplate(),clubId:f.clubId,requestId:'alice-template-1'},'alice');
  assert.equal(retry.template._id,created.template._id);
  const edited=await f.run('editTemplate',{...created.template,name:'读书会新版',category:'学术交流',templateId:created.template._id},'owner');
  assert.equal(edited.template.category,'学术交流'); assert.equal(edited.template.creatorId,f.ids.alice);
  await assert.rejects(f.run('editTemplate',{...created.template,templateId:created.template._id},'alice'),{code:'CONFLICT'});
  await assert.rejects(f.run('editTemplate',{...edited.template,templateId:created.template._id},'outsider'),{code:'FORBIDDEN'});
  await assert.rejects(f.run('createTemplate',{...seminarTemplate(),clubId:f.clubId,requestId:'outsider-template'},'outsider'),{code:'FORBIDDEN'});
  const changed=await f.run('editTemplate',{...f.template,templateId:f.template._id,category:'成员整理'},'alice');
  assert.equal(changed.template.category,'成员整理');
});

test('template validation bounds offsets, steps and default assignees without writing partial records',async()=>{
  const f=await fixture(), original=f.store.snapshot();
  for(const patch of [
    {steps:[]},{steps:Array(21).fill(f.template.steps[0])},
    {steps:[{...f.template.steps[0],daysBefore:-1}]},
    {steps:[{...f.template.steps[0],daysBefore:1.5}]},
    {steps:[{...f.template.steps[0],participantIds:['foreign-member']}]},
    {participantIds:['foreign-member']},{category:'x'.repeat(31)}
  ]) await assert.rejects(f.run('createTemplate',{...seminarTemplate(),...patch,clubId:f.clubId,requestId:'invalid-template'},'alice'),{code:'VALIDATION'});
  assert.deepEqual(f.store.snapshot(),original);
});

test('applying a template creates one atomic group with separate assignees, Beijing deadlines and personal calendars',async()=>{
  const f=await fixture(), input=f.group(), before=await f.board();
  input.subtasks[1].title='本次海报';
  input.subtasks[1].dueAt=parseDeadline('2026-11-02','09:00');
  const result=await f.run('createTaskGroup',input,'alice');
  assert.equal(result.tasks.length,6); assert.equal(result.version,before.version+1);
  assert.equal(result.tasks[1].dueAt,parseDeadline('2026-11-02','18:30'));
  assert.equal(result.tasks[2].dueAt,input.subtasks[1].dueAt);
  assert.ok(result.tasks.slice(1).every(t=>t.parentTaskId===result.taskId&&t.parentCreatorId===f.ids.alice));
  const delta=await f.run('sync',{clubId:f.clubId,since:before.version},'owner');
  assert.equal(delta.tasks.length,6); assert.deepEqual(delta.templates,[]);
  const alice=await f.run('bootstrap',{clubId:f.clubId},'alice');
  const mine=deadlineCalendar(alice.tasks.map(t=>taskView(t,alice)),{mine:true,month:'2026-11',now:Date.parse('2026-10-30')});
  assert.equal(mine.tasks.length,4);
  assert.ok(!mine.tasks.some(t=>t.title==='本次海报'));
  assert.equal((await f.board()).templates[0].steps[1].title,'制作海报');
});

test('task-group retries remain idempotent after deadlines pass and after parent archive',async()=>{
  const f=await fixture(),input=f.group();
  const [a,b]=await Promise.all([f.run('createTaskGroup',input,'owner'),f.run('createTaskGroup',input,'owner')]);
  assert.equal(a.taskId,b.taskId); assert.equal((await f.board()).tasks.length,6);
  f.advance(15*86400000);
  assert.equal((await f.run('createTaskGroup',input,'owner')).taskId,a.taskId);
  await f.run('archiveTask',{taskId:a.taskId},'owner');
  const retry=await f.run('createTaskGroup',input,'owner');
  assert.ok(retry.tasks.every(t=>t.archived)); assert.equal((await f.board()).tasks.length,0);
});

test('invalid steps, cross-club templates and injected subtask parents cannot leave a partial group',async()=>{
  const f=await fixture(),original=f.store.snapshot();
  for(const patch of [{participantIds:[]},{dueAt:parseDeadline('2026-10-31','18:30')},{parentTaskId:'fake-parent'},
    {subtasks:[...f.group().subtasks.slice(0,4),{...f.group().subtasks[4],participantIds:['foreign']}]},
    {subtasks:[{...f.group().subtasks[0],dueAt:parseDeadline('2026-11-07','18:30')}]}
  ]) await assert.rejects(f.run('createTaskGroup',{...f.group(),...patch},'owner'),{code:'VALIDATION'});
  assert.deepEqual(f.store.snapshot(),original);
  const other=await f.run('createClub',{name:'Other',nickname:'Owner',requestId:'other-club-123'},'owner');
  const second=await f.run('bootstrap',{clubId:other.clubId},'owner');
  await assert.rejects(f.run('createTaskGroup',{...f.group(),templateId:second.templates[0]._id},'owner'),{code:'NOT_FOUND'});
  await assert.rejects(f.run('createTaskGroup',f.group(),'outsider'),{code:'FORBIDDEN'});
});

test('a storage failure midway through group creation rolls back the parent, children and club cursor',async()=>{
  const f=await fixture(),original=f.store.snapshot(),transaction=f.store.transaction;
  f.store.transaction=work=>transaction(async tx=>{
    const put=tx.put; let writes=0;
    tx.put=async(...args)=>{await put(...args); if(++writes===4) throw new Error('injected storage failure');};
    return work(tx);
  });
  await assert.rejects(f.run('createTaskGroup',f.group(),'owner'),/storage failure/);
  assert.deepEqual(f.store.snapshot(),original);
});

test('template edits and archive never rewrite already-created tasks; archive sends a tombstone',async()=>{
  const f=await fixture(),group=await f.run('createTaskGroup',f.group(),'owner');
  await assert.rejects(f.run('archiveTemplate',{templateId:f.template._id,revision:1},'alice'),{code:'FORBIDDEN'});
  const changed=await f.run('editTemplate',{...f.template,templateId:f.template._id,steps:[{...f.template.steps[0],daysBefore:10}]},'alice');
  const before=await f.board();
  await f.run('archiveTemplate',{templateId:f.template._id,revision:changed.template.revision},'owner');
  assert.deepEqual((await f.board()).tasks,group.tasks.sort((a,b)=>a.dueAt-b.dueAt));
  assert.equal((await f.board()).templates.length,0);
  const delta=await f.run('sync',{clubId:f.clubId,since:before.version},'alice');
  assert.equal(delta.templates[0].archived,true); assert.deepEqual(delta.tasks,[]);
  await assert.rejects(f.run('createTaskGroup',{...f.group(),requestId:'archived-template-group'},'owner'),{code:'ARCHIVED'});
});

test('relative dates cross month/year and leap boundaries; custom dates stay fixed; drafts do not mutate shared defaults',()=>{
  assert.equal(parts(relativeDeadline(parseDeadline('2028-03-01','00:10'),1)).date,'2028-02-29');
  assert.deepEqual(parts(relativeDeadline(parseDeadline('2027-01-02','18:30'),4)),{date:'2026-12-29',time:'18:30',weekday:'二'});
  const t=seminarTemplate(); t.steps[0].participantIds=['alice','departed'];
  const draft=templateDraft(t,[{id:'alice'}]);
  draft.steps[0].title='本次修改'; draft.steps[0].participantIds.push('bob');
  assert.equal(t.steps[0].title,'预约教室'); assert.deepEqual(t.steps[0].participantIds,['alice','departed']);
  const main={date:'2026-11-06',time:'18:30'}, relative={daysBefore:4}, custom={customDeadline:true,date:'2026-11-01',time:'12:00'};
  assert.equal(draftDeadline({...main,date:'2026-11-07'},relative)-draftDeadline(main,relative),86400000);
  assert.equal(draftDeadline({...main,date:'2026-11-07'},custom),draftDeadline(main,custom));
  assert.throws(()=>relativeDeadline(parseDeadline('2026-11-06','18:30'),''));
});

test('template views escape shared names, categories and step content and handle missing-template errors',async()=>{
  const {buildSync}=require('esbuild');
  const bundled=buildSync({entryPoints:['client/template-views.js'],bundle:true,format:'esm',write:false});
  const view=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
  const unsafe='<img src=x onerror=alert(1)>',t={...seminarTemplate(),_id:'id&other',name:unsafe,category:unsafe,creatorId:'me',updatedBy:'me',steps:[{...seminarTemplate().steps[0],title:unsafe,description:'</textarea><script>bad()</script>'}]};
  const b={club:{id:'club'},me:{id:'me',role:'member'},members:[{id:'me',name:unsafe}],templates:[t]};
  const s={sync:{board:b,phase:'ready'},search:'',form:{name:unsafe,title:'test',participantIds:[]},editBoard:b,steps:t.steps,openSteps:new Set([0])};
  for(const html of [view.templates(s),view.templatePicker(s),view.stepEditors(s,true)]) {
    assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;img'));
  }
  assert.ok(view.templates(s).includes('template=id%26other'));
  const missing=view.templateEditor({form:{},error:'模板不存在或已归档'});
  assert.ok(missing.includes('role="alert"'));assert.ok(!missing.includes('正在加载模板'));
});
