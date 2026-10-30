const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createService } = require('../shared/domain');
const { createMemoryStore } = require('../shared/memory-store');
const { resolveParticipants, chooseDepartment, toggleParticipant, setFollowMain } = require('../shared/assignments');
const { templateDraft, seminarTemplate } = require('../shared/templates');

async function fixture() {
  const store=createMemoryStore();
  const run=createService({store,now:Date.now,randomId:()=>crypto.randomBytes(16).toString('hex'),hash:s=>crypto.createHash('sha256').update(s).digest('hex')});
  const {clubId}=await run('createClub',{name:'SPS',nickname:'Owner',requestId:'assignment-club'},'owner');
  const invites=await run('getInvite',{clubId},'owner');
  const join=(identity,department)=>run('joinClub',{token:invites.departments.find(d=>d.id===department).token,nickname:identity},identity);
  await join('alice','publicity'); await join('bob','liaison');
  const board=()=>run('bootstrap',{clubId},'owner');
  const b=await board(), ids=Object.fromEntries(b.members.map(m=>[m.name.toLowerCase(),m.id]));
  const input={clubId,requestId:'assignment-task',title:'部门协作',description:'',mode:'individual',priority:'normal',participantIds:[],dueAt:Date.now()+10*86400000};
  return {store,run,clubId,join,board,ids,input};
}

test('department selection replaces all-members default; manual changes exit the rule; following stays in sync until disabled',()=>{
  const roster=[{id:'a',department:'publicity'},{id:'b',department:'liaison'},{id:'c',department:'publicity'}];
  const main={participantIds:['a','b','c']},step={participantIds:['b']};
  chooseDepartment(main,'publicity',roster);
  assert.deepEqual(resolveParticipants(main,roster),['a','c']);
  setFollowMain(step,true,main,roster);
  chooseDepartment(main,'liaison',roster);
  assert.deepEqual(resolveParticipants(step,roster,main),['b']);
  toggleParticipant(main,'a',roster);
  assert.equal(main.participantDepartment,'');
  assert.deepEqual(resolveParticipants(step,roster,main),['b','a']);
  setFollowMain(step,false,main,roster);
  toggleParticipant(main,'b',roster);
  assert.deepEqual(resolveParticipants(step,roster,main),['b','a']);
  assert.deepEqual(main.participantIds,['a']);
});

test('publication resolves the latest same-club department roster and then freezes task membership',async()=>{
  const f=await fixture();
  const stale={...f.input,participantDepartment:'publicity',participantIds:[f.ids.owner]};
  await f.join('new member','publicity');
  await f.store.transaction(tx=>tx.put('members','foreign',{_id:'foreign',clubId:'other',department:'publicity'}));
  const before=await f.board();
  const result=await f.run('createTask',stale,'alice');
  assert.deepEqual(result.task.participantIds,before.members.filter(m=>m.department==='publicity').map(m=>m.id));
  assert.equal(result.task.participantDepartment,undefined);
  await f.join('later member','publicity');
  assert.deepEqual((await f.board()).tasks[0].participantIds,result.task.participantIds);
  await assert.rejects(f.run('createTask',{...stale,requestId:'outsider-task'},'outsider'),{code:'FORBIDDEN'});
});

test('template department and follow rules survive save/copy and resolve against the main task during atomic publication',async()=>{
  const f=await fixture();
  const {template}=await f.run('createTemplate',{...seminarTemplate(),clubId:f.clubId,requestId:'assignment-template',participantDepartment:'publicity',participantIds:[f.ids.owner],steps:[
    {...seminarTemplate().steps[0],followMain:true,participantIds:['stale-member']},
    {...seminarTemplate().steps[1],participantDepartment:'liaison'}
  ]},'alice');
  assert.deepEqual(template.participantIds,[]); assert.deepEqual(template.steps[0].participantIds,[]);
  assert.equal(template.steps[0].followMain,true); assert.equal(template.steps[1].participantDepartment,'liaison');
  await f.join('new member','publicity');
  const board=await f.board(), draft=templateDraft(template,board.members);
  assert.equal(draft.participantIds.length,2); assert.equal(draft.steps[0].followMain,true);
  const {tasks}=await f.run('createTaskGroup',{...f.input,...draft,subtasks:draft.steps.map(s=>({...s,participantIds:[f.ids.owner]}))},'owner');
  assert.deepEqual(tasks[1].participantIds,tasks[0].participantIds);
  assert.deepEqual(tasks[2].participantIds,[f.ids.bob]);
  assert.ok(tasks.every(t=>t.followMain===undefined&&t.participantDepartment===undefined));
  draft.steps[0].followMain=false;
  assert.equal((await f.board()).templates.find(t=>t._id===template._id).steps[0].followMain,true);
  // An empty department remains an explicit rule instead of becoming all members.
  const empty=templateDraft({...template,participantDepartment:'academic'},board.members);
  assert.deepEqual(empty.participantIds,[]); assert.equal(empty.participantDepartment,'academic');
});

test('empty/oversized departments and malformed follow rules reject without partial tasks or cursor changes',async()=>{
  const f=await fixture(), original=f.store.snapshot();
  for(const patch of [
    {participantDepartment:'academic'},{participantDepartment:'fake'}, {participantDepartment:null},
    {followMain:true},{followMain:'true'}
  ]) await assert.rejects(f.run('createTask',{...f.input,participantIds:[f.ids.owner],...patch},'owner'),{code:'VALIDATION'});
  for(const patch of [{followMain:'true'},{followMain:true,participantDepartment:'liaison'},{participantDepartment:'academic'}]) {
    await assert.rejects(f.run('createTaskGroup',{...f.input,participantIds:[f.ids.owner],subtasks:[{...f.input,daysBefore:1,...patch}]},'owner'),{code:'VALIDATION'});
  }
  assert.deepEqual(f.store.snapshot(),original);
  await f.store.transaction(async tx=>{for(let i=0;i<201;i++) await tx.put('members','bulk'+i,{_id:'bulk'+i,clubId:f.clubId,department:'academic'});});
  const oversized=f.store.snapshot();
  await assert.rejects(f.run('createTask',{...f.input,participantDepartment:'academic'},'owner'),{code:'VALIDATION'});
  assert.deepEqual(f.store.snapshot(),oversized);
});

test('department reassignment of a standalone subtask retains conflict and completion protection',async()=>{
  const f=await fixture();
  const parent=await f.run('createTask',{...f.input,participantIds:[f.ids.owner]},'owner');
  const child=await f.run('createTask',{...f.input,requestId:'department-child',parentTaskId:parent.taskId,participantDepartment:'publicity'},'owner');
  const edit={...child.task,taskId:child.taskId,participantDepartment:'liaison'};
  await assert.rejects(f.run('editTask',edit,'bob'),{code:'FORBIDDEN'});
  const completion=await f.run('complete',{taskId:child.taskId,done:true},'alice');
  await assert.rejects(f.run('editTask',{...edit,revision:completion.task.revision},'owner'),{code:'CONFLICT'});
  const undone=await f.run('complete',{taskId:child.taskId,done:false},'alice');
  const changed=await f.run('editTask',{...edit,revision:undone.task.revision},'owner');
  assert.deepEqual(changed.task.participantIds,[f.ids.bob]);
  await assert.rejects(f.run('editTask',edit,'owner'),{code:'CONFLICT'});
});

test('editors render department counts, following state and escaped names while published lists remain locked',async()=>{
  const {buildSync}=require('esbuild');
  const bundle=buildSync({entryPoints:['client/views.js'],bundle:true,format:'esm',write:false});
  const views=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const b={members:[{id:'a',name:'<script>bad</script>',department:'publicity'},{id:'b',name:'Bob',department:'liaison'}],templates:[],me:{id:'a'}};
  const s={form:{...seminarTemplate(),participantDepartment:'publicity'},editBoard:b,steps:[{...seminarTemplate().steps[0],followMain:true}],openSteps:new Set([0])};
  const html=views.templateEditor(s);
  assert.ok(html.includes('宣传部 · 1 人')); assert.ok(html.includes('学术部 · 0 人'));
  assert.ok(html.includes('跟随主任务负责人')); assert.ok(html.includes('子任务')&&html.includes(' · 1 人'));
  assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;script&gt;'));
  const locked=views.editor({...s,id:'published',form:{...s.form,participantDepartment:'',participantIds:['b']},steps:[]});
  assert.ok(!locked.includes('data-action="department"')); assert.ok(locked.includes('data-action="participant"'));
  assert.match(locked,/data-id="b" aria-pressed="true" disabled/);
});
