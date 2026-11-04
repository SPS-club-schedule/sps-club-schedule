const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {buildSync}=require('esbuild');
const {createService}=require('../shared/domain');
const {createMemoryStore}=require('../shared/memory-store');
const {taskView}=require('../shared/view');
const {templateDraft}=require('../shared/templates');
const {guestNames,resolveGuestNames}=require('../shared/guest-assignments');
const {setRole,removeRole}=require('../shared/assignments');
const {calendarEntries}=require('../shared/planner');
async function fixture(){
  const store=createMemoryStore(),hash=value=>crypto.createHash('sha256').update(value).digest('hex');
  const run=createService({store,hash,now:Date.now,randomId:()=>crypto.randomBytes(16).toString('hex')});
  const {clubId}=await run('createClub',{name:'SPS',nickname:'Owner',requestId:'speaker-fixture'},'owner');
  const invites=await run('getInvite',{clubId},'owner');
  for(const identity of ['alice','bob','speaker'])await run('joinClub',{token:identity==='speaker'?invites.departments.find(d=>d.id==='speaker').token:invites.token,nickname:identity},identity);
  const board=identity=>run('bootstrap',{clubId},identity||'owner'),b=await board();
  const ids=Object.fromEntries(b.members.map(m=>[m.name.toLowerCase(),m.id]));let seq=0;
  const fields={title:'工作',description:'',mode:'individual',priority:'normal',participantIds:[],daysBefore:1};
  const create=(patch={},identity='owner')=>run('createTask',{...fields,clubId,requestId:'speaker-task-'+seq++,dueAt:Date.now()+86400000*10,participantIds:[ids.alice],...patch},identity);
  const template={...fields,clubId,name:'演讲模板',category:'学术',roles:[{id:'speaker',name:'主讲人',coreMember:false}],steps:[{...fields,id:'talk',roleId:'speaker',title:'准备讲稿',dependsOn:[]}]};
  const publish=(patch={})=>run('createTaskGroup',{...fields,clubId,requestId:'speaker-group-'+seq++,dueAt:Date.now()+86400000*10,participantIds:[ids.alice],roles:[{id:'speaker',name:'主讲人',coreMember:false,participantIds:[],guestNames:'张老师\n李老师'}],subtasks:template.steps,...patch},'owner');
  return {store,run,clubId,ids,board,fields,create,template,publish,invites};
}
test('speaker invitations enforce a separate restricted identity and cannot be used to self-promote',async()=>{
  const f=await fixture(),b=await f.board('speaker');assert.equal(b.me.role,'speaker');assert.equal(b.me.department,'speaker');
  assert.equal((await f.board()).members.find(m=>m.id===b.me.id).role,'speaker');
  await f.run('joinClub',{token:f.invites.token,nickname:'Promote',role:'owner'},'speaker');assert.equal((await f.board('speaker')).me.role,'speaker');
  await assert.rejects(f.run('joinClub',{token:f.invites.departments[0].token,nickname:'Promote'},'speaker'),{code:'CONFLICT'});
  await assert.rejects(f.run('joinClub',{token:f.invites.departments.find(d=>d.id==='speaker').token,nickname:'Demote'},'alice'),{code:'CONFLICT'});
});
test('speaker snapshots and synchronization include only assigned tasks and reject every task/template mutation',async()=>{
  const f=await fixture(),hidden=await f.create({title:'Private task'}),own=await f.create({title:'Speaker task',participantIds:[f.ids.speaker]});
  let b=await f.board('speaker');assert.deepEqual(b.tasks.map(t=>t._id),[own.taskId]);assert.deepEqual(b.templates,[]);
  assert.ok(!b.members.some(m=>m.id===f.ids.bob));assert.ok(!JSON.stringify(b).includes('Private task'));
  const template=(await f.board()).templates[0];
  for(const [action,input] of [
    ['createTask',{...f.fields,clubId:f.clubId,requestId:'forbidden-create',dueAt:Date.now()+86400000}],
    ['createTaskGroup',{clubId:f.clubId,requestId:'forbidden-group'}],
    ['createTemplate',{...f.template,requestId:'forbidden-template'}],
    ['editTemplate',{...template,templateId:template._id}],['archiveTemplate',{templateId:template._id,revision:1}],
    ['editTask',{...own.task,taskId:own.taskId}],['archiveTask',{taskId:own.taskId}],
    ['complete',{taskId:hidden.taskId,done:true}],['getInvite',{clubId:f.clubId}]
  ])await assert.rejects(f.run(action,input,'speaker'),{code:'FORBIDDEN'});
  await f.run('complete',{taskId:own.taskId,done:true},'speaker');
  const delta=await f.run('sync',{clubId:f.clubId,since:b.version},'speaker');assert.equal(delta.full,true);assert.equal(delta.tasks.length,1);
  assert.ok(delta.tasks[0].completions[f.ids.speaker]);
  assert.equal(calendarEntries({...await f.board(),me:b.me},{scope:'club',activities:[{id:'x',title:'Other activity'}]}).entries.some(entry=>entry.taskId===hidden.taskId),false);
});
test('demoted creators cannot use old idempotency requests or ownership to mutate their previous tasks',async()=>{
  const f=await fixture(),input={...f.fields,clubId:f.clubId,requestId:'old-creator-task',participantIds:[f.ids.bob],dueAt:Date.now()+86400000},created=await f.run('createTask',input,'alice');
  await f.store.transaction(async tx=>{const me=await tx.get('members',f.ids.alice),club=await tx.get('clubs',f.clubId),version=club.syncVersion+1;await tx.put('members',me._id,{...me,role:'speaker',department:'speaker',syncVersion:version});await tx.put('clubs',club._id,{...club,syncVersion:version,membersVersion:version});});
  for(const [action,data] of [['createTask',input],['editTask',{...created.task,taskId:created.taskId}],['archiveTask',{taskId:created.taskId}]])await assert.rejects(f.run(action,data,'alice'),{code:'FORBIDDEN'});
  assert.equal((await f.board('alice')).tasks.length,0);
});
test('reassigning a child removes it from speaker synchronization immediately',async()=>{
  const f=await fixture(),group=await f.publish({roles:[{id:'speaker',name:'Speaker',coreMember:false,participantIds:[f.ids.speaker]}]});
  const child=group.tasks[1],before=await f.board('speaker');assert.equal(before.tasks.length,1);
  await f.run('editTask',{...child,taskId:child._id,participantIds:[f.ids.alice]},'owner');
  const after=await f.run('sync',{clubId:f.clubId,since:before.version},'speaker');
  assert.equal(after.full,true);assert.deepEqual(after.tasks,[]);
  await assert.rejects(f.run('complete',{taskId:child._id,done:true},'speaker'),{code:'FORBIDDEN'});
});
test('unfinished guest names survive changing draft role bindings and are validated at publication',async()=>{
  const f=await fixture(),b=await f.board(),draft=templateDraft(f.template,b.members),name='x'.repeat(41);
  draft.roles[0].guestNames=name;
  setRole(draft.steps[0],'',draft,b.members);
  assert.equal(draft.steps[0].guestNames,name);
  assert.throws(()=>resolveGuestNames(draft.steps[0],draft));
  await assert.rejects(f.publish({roles:[{id:'speaker',name:'Speaker',coreMember:false,participantIds:[],guestNames:name}]}),{code:'VALIDATION'});
});
test('non-core roles persist through templates and copying, publish named guests without creating accounts, and preserve bindings',async()=>{
  const f=await fixture(),before=await f.board();
  const {template}=await f.run('createTemplate',{...f.template,requestId:'guest-template'},'alice');
  const copy=await f.run('createTemplate',{...template,requestId:'guest-copy'},'bob');assert.equal(copy.template.roles[0].coreMember,false);
  const draft=templateDraft(template,before.members);assert.equal(draft.roles[0].coreMember,false);draft.roles[0].guestNames='张老师\n李老师';
  const step=draft.steps[0];assert.deepEqual(resolveGuestNames(step,draft),['张老师','李老师']);
  setRole(step,'',draft,before.members);assert.equal(step.guestNames,'张老师\n李老师');
  setRole(step,'speaker',draft,before.members);removeRole(draft,draft.steps,'speaker',before.members);assert.equal(step.guestNames,'张老师\n李老师');
  const group=await f.publish({templateId:template._id}),child=group.tasks[1];
  assert.deepEqual(child.participantIds,[]);assert.deepEqual(child.guestParticipants.map(p=>p.name),['张老师','李老师']);
  assert.equal((await f.board()).members.length,before.members.length);
  assert.equal(taskView(child,await f.board()).total,2);
  const legacy={...template,templateId:template._id,roles:[{id:'speaker',name:'主讲人'}]};await assert.rejects(f.run('editTemplate',legacy,'alice'),{code:'CONFLICT'});
  assert.equal(calendarEntries(await f.board(),{scope:'club'}).entries.filter(entry=>entry.taskId===child._id).length,1);
});
test('proxy completion retains the first real actor, permits appropriate undo, and cannot impersonate core members or cross clubs',async()=>{
  const f=await fixture(),group=await f.publish(),task=group.tasks[1],guest=task.guestParticipants[0],other=task.guestParticipants[1];
  await f.run('complete',{taskId:task._id,participantId:guest.id,done:true,actorId:f.ids.owner,actorName:'Forged'},'bob');
  await f.run('complete',{taskId:task._id,participantId:guest.id,done:true},'alice');
  let saved=(await f.board()).tasks.find(t=>t._id===task._id);assert.equal(saved.completionActors[guest.id].actorId,f.ids.bob);assert.equal(saved.completionActors[guest.id].actorName,'bob');
  assert.equal(taskView(saved,await f.board()).done,false);
  await assert.rejects(f.run('complete',{taskId:task._id,participantId:guest.id,done:false},'alice'),{code:'FORBIDDEN'});
  await assert.rejects(f.run('complete',{taskId:group.taskId,participantId:f.ids.alice,done:true},'bob'),{code:'FORBIDDEN'});
  for(const actor of ['speaker','outsider'])await assert.rejects(f.run('complete',{taskId:task._id,participantId:other.id,done:true},actor),{code:'FORBIDDEN'});
  await f.run('complete',{taskId:task._id,participantId:other.id,done:true},'alice');
  saved=(await f.board()).tasks.find(t=>t._id===task._id);assert.equal(taskView(saved,await f.board()).done,true);
  await assert.rejects(f.run('editTask',{...saved,taskId:saved._id,guestNames:'Changed'},'owner'),{code:'CONFLICT'});
  await f.run('complete',{taskId:task._id,participantId:guest.id,done:false},'bob');
  await f.run('complete',{taskId:task._id,participantId:other.id,done:false},'owner');
  saved=(await f.board()).tasks.find(t=>t._id===task._id);assert.deepEqual(saved.completions,{});assert.deepEqual(saved.completionActors,{});
  await f.run('editTask',{...saved,taskId:saved._id,guestNames:'Changed'},'owner');
});
test('registered speakers can complete their own tasks and core members can proxy; shared guest completion displays both people',async()=>{
  const f=await fixture(),own=await f.create({participantIds:[f.ids.speaker]});
  await f.run('complete',{taskId:own.taskId,participantId:f.ids.speaker,done:true},'alice');
  let b=await f.board('speaker');assert.ok(taskView(b.tasks[0],b).myDone);assert.equal(taskView(b.tasks[0],b).participants[0].completionActor,'alice');
  await f.run('complete',{taskId:own.taskId,done:false},'speaker');await f.run('complete',{taskId:own.taskId,done:true},'speaker');
  const group=await f.publish({subtasks:f.template.steps.map(step=>({...step,mode:'shared'}))}),task=group.tasks[1],guest=task.guestParticipants[0];
  await f.run('complete',{taskId:task._id,participantId:guest.id,done:true},'bob');
  b=await f.board();const view=taskView(b.tasks.find(t=>t._id===task._id),b);assert.match(view.progressLabel,/张老师已完成.*bob 代完成/);assert.equal(view.done,true);
  await assert.rejects(f.run('complete',{taskId:task._id,participantId:guest.id,done:false},'alice'),{code:'FORBIDDEN'});
  await f.run('complete',{taskId:task._id,done:false},'bob');
});
test('guest and role validation rejects malformed names, missing people and non-members in member-only roles',async()=>{
  const f=await fixture();assert.deepEqual(guestNames(' 张老师\n\n张老师\n李老师 '),['张老师','李老师']);
  for(const value of [[],42,'x'.repeat(41),Array.from({length:51},(_,i)=>'Guest '+i).join('\n')])assert.throws(()=>guestNames(value));
  for(const patch of [{coreMember:true,guestNames:'张老师'},{coreMember:true,guestNames:'',participantIds:[f.ids.speaker]},{coreMember:false,guestNames:'',participantIds:[]}])await assert.rejects(f.publish({roles:[{id:'speaker',name:'主讲人',participantIds:[],...patch}]}),{code:'VALIDATION'});
});
test('speaker views omit creation and management controls; guest names and proxy actor labels are escaped',async()=>{
  const f=await fixture(),group=await f.publish({roles:[{id:'speaker',name:'主讲人',coreMember:false,participantIds:[],guestNames:'<img src=x onerror=alert(1)>'}]}),child=group.tasks[1];
  await f.run('complete',{taskId:child._id,participantId:child.guestParticipants[0].id,done:true},'bob');
  const bundle=buildSync({entryPoints:['client/views.js'],bundle:true,format:'esm',write:false}),views=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const state={sync:{phase:'ready',board:await f.board()},id:child._id,form:{},search:'',filter:'all'};
  const detail=views.detail(state);assert.ok(detail.includes('&lt;img'));assert.ok(!detail.includes('<img'));assert.ok(detail.includes('由 bob 代'));
  state.sync.board=await f.board('speaker');const board=views.board(state,true);assert.ok(!board.includes('发布任务'));assert.ok(!board.includes('href="#/templates"'));assert.ok(!board.includes('新手指南'));assert.ok(!board.includes('预约总览'));
});


test('core and multiple guest roles can share a step with deduplicated people and completion progress',async()=>{
  const f=await fixture(),roles=[
    {id:'core',name:'协调人',participantIds:[f.ids.alice]},
    {id:'speaker',name:'主讲人',coreMember:false,participantIds:[f.ids.speaker],guestNames:'张老师\n李老师'},
    {id:'assistant',name:'助讲',coreMember:false,participantIds:[f.ids.speaker],guestNames:'张老师\n王老师'}
  ];
  const result=await f.publish({roles,subtasks:[{...f.template.steps[0],roleId:'',roleIds:['core','speaker','assistant']}]});
  const child=result.tasks[1];
  assert.deepEqual(child.participantIds,[f.ids.alice,f.ids.speaker]);
  assert.deepEqual(child.guestParticipants.map(person=>person.name),['张老师','李老师','王老师']);
  assert.equal(taskView(child,await f.board()).total,5);
  assert.ok(!('roleIds' in child));
  await f.run('complete',{taskId:child._id,done:true},'alice');
  const saved=(await f.board()).tasks.find(task=>task._id===child._id);
  assert.equal(Object.keys(saved.completions).length,1);
  assert.equal(taskView(saved,await f.board()).done,false);
});

test('speaker roles accept members from every department alongside guests without changing account permissions',async()=>{
  const f=await fixture(),departments=['academic','publicity','liaison'];
  for(const department of departments)await f.run('joinClub',{token:f.invites.departments.find(d=>d.id===department).token,nickname:department},'talker_'+department);
  const before=await f.board(),members=departments.map(department=>before.members.find(member=>member.department===department));
  const role={id:'speaker',name:'主讲人',coreMember:false,participantIds:[...members.map(member=>member.id),f.ids.speaker],guestNames:'张老师'};
  const group=await f.publish({roles:[role]}),child=group.tasks[1];
  assert.deepEqual(child.participantIds,role.participantIds);
  assert.equal(taskView(child,await f.board()).total,5);
  assert.deepEqual((await f.board()).members,before.members);
  await assert.rejects(f.run('complete',{taskId:child._id,participantId:members[0].id,done:true},'bob'),{code:'FORBIDDEN'});
  await f.run('complete',{taskId:child._id,done:true},'talker_academic');
  for(const department of departments){
    const result=await f.publish({roles:[{...role,participantIds:[],participantDepartment:department,guestNames:''}]});
    assert.deepEqual(result.tasks[1].participantIds,[members.find(member=>member.department===department).id]);
  }
  const snapshot=f.store.snapshot();
  await assert.rejects(f.publish({roles:[{...role,participantIds:['foreign-member']}]}),{code:'VALIDATION'});
  assert.deepEqual(f.store.snapshot(),snapshot);
});

test('speaker role picker offers all department members and the non-member speaker category',async()=>{
  const bundle=buildSync({entryPoints:['client/template-views.js'],bundle:true,format:'esm',write:false});
  const views=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const members=[
    {id:'a',name:'学术部员',department:'academic',role:'member'},
    {id:'p',name:'宣传部员',department:'publicity',role:'member'},
    {id:'l',name:'联络部员',department:'liaison',role:'member'},
    {id:'s',name:'非部员主讲人',department:'speaker',role:'speaker'}
  ];
  const form={roles:[{id:'talker',name:'主讲人',coreMember:false,participantIds:['a']}],participantIds:[]};
  const state={form,steps:[],editBoard:{members,templates:[]}};
  const html=views.roleEditors(state);
  for(const member of members){assert.ok(html.includes(member.name));assert.ok(html.includes(`data-id="${member.id}"`));}
  for(const label of ['学术部 · 1 人','宣传部 · 1 人','联络部 · 1 人','主讲人 · 1 人'])assert.ok(html.includes(label));
  assert.ok(html.includes('“主讲人”分类用于非部员'));
  assert.match(html,/data-id="a" aria-pressed="true"/);
  assert.match(views.roleEditors(state,true),/负责人范围/);
  form.roles[0].coreMember=true;
  const restricted=views.roleEditors(state);
  assert.ok(restricted.includes('学术部员'));assert.ok(!restricted.includes('非部员主讲人'));assert.ok(!restricted.includes('免注册负责人姓名'));
});
