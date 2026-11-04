const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createService } = require('../shared/domain');
const { createMemoryStore } = require('../shared/memory-store');
const { seminarTemplate, templateDraft } = require('../shared/templates');
const { resolveParticipants, setRole, setRoles, setFollowMain, removeRole, toggleParticipant, chooseDepartment } = require('../shared/assignments');

const { selectedRoleIds } = require('../shared/role-bindings');
const { resolveGuestNames } = require('../shared/guest-assignments');

const roles=[{id:'speaker',name:'主讲人'},{id:'assistant',name:'助教'},{id:'poster',name:'海报制作人'}];
const roleTemplate=()=>({...seminarTemplate(),roles:structuredClone(roles),steps:seminarTemplate().steps.map((step,i)=>({...step,roleId:['assistant','poster','poster','assistant','speaker'][i]}))});
async function fixture() {
  const store=createMemoryStore(), run=createService({store,now:Date.now,randomId:()=>crypto.randomBytes(16).toString('hex'),hash:s=>crypto.createHash('sha256').update(s).digest('hex')});
  const {clubId}=await run('createClub',{name:'SPS',nickname:'Owner',requestId:'role-club-create'},'owner');
  const invite=await run('getInvite',{clubId},'owner');
  const join=name=>run('joinClub',{token:invite.departments.find(d=>d.id==='publicity').token,nickname:name},name);
  await join('alice'); await join('bob');
  const board=()=>run('bootstrap',{clubId},'owner'), b=await board(), ids=Object.fromEntries(b.members.map(m=>[m.name.toLowerCase(),m.id]));
  const create=patch=>run('createTemplate',{...roleTemplate(),clubId,requestId:'role-template-create',...patch},'alice');
  const group=()=>({...roleTemplate(),clubId,requestId:'role-group-create',participantIds:[ids.owner],dueAt:Date.now()+10*86400000,
    roles:roles.map((role,i)=>({...role,participantIds:i===0?[ids.owner]:i===1?[ids.alice,ids.bob]:[ids.bob]})),subtasks:roleTemplate().steps});
  return {store,run,clubId,board,ids,join,create,group};
}

test('named roles and stable bindings survive save, sync, copy, reorder, rename, and archive without changing tasks',async()=>{
  const f=await fixture(), before=await f.board();
  let t=(await f.create()).template;
  assert.deepEqual(t.roles,roles); assert.equal(t.steps[1].roleId,'poster');
  assert.deepEqual((await f.run('sync',{clubId:f.clubId,since:before.version},'owner')).templates[0].roles,roles);
  const copy=(await f.run('createTemplate',{...t,requestId:'role-template-copy'},'owner')).template;
  const group=await f.run('createTaskGroup',{...f.group(),templateId:t._id},'alice');
  t=(await f.run('editTemplate',{...t,templateId:t._id,roles:[roles[2],{...roles[1],name:'协调人'},roles[0]],steps:[...t.steps].reverse()},'owner')).template;
  assert.equal(t.steps[3].roleId,'poster'); assert.equal(t.roles[1].name,'协调人');
  assert.deepEqual(copy.roles,roles);
  const {roles:ignored,...oldClient}=t;
  await assert.rejects(f.run('editTemplate',{...oldClient,templateId:t._id},'owner'),{code:'CONFLICT'});
  await f.run('archiveTemplate',{templateId:t._id,revision:t.revision},'owner');
  assert.deepEqual((await f.board()).tasks,group.tasks.sort((a,b)=>a.dueAt-b.dueAt));
});

test('template roles validate limits, names, identifiers and mutually exclusive rules atomically',async()=>{
  const f=await fixture(), before=f.store.snapshot(), step=roleTemplate().steps[0];
  for (const patch of [
    {roles:null},{roles:{}},{roles:[null]},{roles:[{id:'<bad>',name:'X'}]},
    {roles:[{id:'a',name:' '}]},{roles:[{id:'a',name:'a'.repeat(31)}]},
    {roles:[...roles,roles[0]]},{roles:[...roles,{id:'another',name:' 主讲人 '}]},
    {roles:Array.from({length:21},(_,i)=>({id:'r'+i,name:'角色'+i}))},
    {steps:[{...step,roleId:'missing'}]},{steps:[{...step,roleId:null}]},
    {steps:[{...step,followMain:true}]},{steps:[{...step,participantDepartment:'publicity'}]},
    {roleId:'speaker'}, {roles:[],steps:[step]}
  ]) await assert.rejects(f.create(patch),{code:'VALIDATION'});
  assert.deepEqual(f.store.snapshot(),before);
  // All role bindings can be removed explicitly; role-free old templates still work.
  let t=(await f.create()).template;
  t=(await f.run('editTemplate',{...t,templateId:t._id,roles:[],steps:t.steps.map(step=>({...step,roleId:''}))},'owner')).template;
  assert.deepEqual(t.roles,[]);
  assert.deepEqual((await f.create({requestId:'role-legacy-template',...seminarTemplate(),roles:undefined})).template.roles,[]);
});

test('one selection assigns multiple steps and supports multiple members and overlapping roles; publication freezes members',async()=>{
  const f=await fixture(), input=f.group();
  input.roles[2]={...input.roles[2],participantIds:[],participantDepartment:'publicity'};
  input.roles.push({id:'unused',name:'备用角色',participantIds:[]});
  await f.join('new-member');
  const roster=(await f.board()).members, expected=roster.filter(m=>m.department==='publicity').map(m=>m.id);
  const result=await f.run('createTaskGroup',input,'owner');
  assert.deepEqual(result.tasks[1].participantIds,[f.ids.alice,f.ids.bob]);
  assert.deepEqual(result.tasks[2].participantIds,expected); assert.deepEqual(result.tasks[3].participantIds,expected);
  assert.deepEqual(result.tasks[5].participantIds,[f.ids.owner]);
  assert.ok(result.tasks.every(t=>!('roles' in t)&&!('roleId' in t)&&!('participantDepartment' in t)));
  await f.join('later-member');
  assert.deepEqual((await f.run('createTaskGroup',input,'owner')).tasks,result.tasks);
});

test('missing role selections, foreign members, invalid bindings and conflicting rules cannot publish partial groups',async()=>{
  const f=await fixture(), before=f.store.snapshot();
  for (const change of [
    input=>{input.roles[0].participantIds=[];},
    input=>{input.roles[0].participantIds=['foreign'];},
    input=>{input.roles[0].participantIds=Array(201).fill(f.ids.owner);},
    input=>{input.roles[0].participantDepartment='academic';},
    input=>{input.roles[0].followMain=true;},
    input=>{input.roles[0].roleId='speaker';},
    input=>{input.subtasks[0].roleId='unknown';},
    input=>{input.subtasks[0].followMain=true;},
    input=>{input.subtasks[0].participantDepartment='publicity';},
    input=>{delete input.roles;}
  ]) {const input=f.group();change(input);await assert.rejects(f.run('createTaskGroup',input,'owner'),{code:'VALIDATION'});}
  await assert.rejects(f.run('createTaskGroup',f.group(),'outsider'),{code:'FORBIDDEN'});
  assert.deepEqual(f.store.snapshot(),before);
});

test('draft role changes propagate until manually overridden; removal and all other assignment modes clear bindings',()=>{
  const roster=[{id:'a',department:'publicity'},{id:'b',department:'liaison'}], t=roleTemplate(), draft=templateDraft(t,roster);
  const step=draft.steps[1];
  toggleParticipant(draft.roles[2],'a',roster);
  assert.deepEqual(resolveParticipants(step,roster,draft),['a']);
  assert.deepEqual(resolveParticipants(draft.steps[2],roster,draft),['a']);
  setRole(step,'',draft,roster);
  toggleParticipant(draft.roles[2],'b',roster);
  assert.deepEqual(resolveParticipants(step,roster,draft),['a']);
  assert.deepEqual(resolveParticipants(draft.steps[2],roster,draft),['a','b']);
  removeRole(draft,draft.steps,'poster',roster);
  assert.equal(draft.steps[2].roleId,''); assert.deepEqual(draft.steps[2].participantIds,['a','b']);
  setRole(step,'speaker',draft,roster); setFollowMain(step,true,draft,roster); assert.equal(step.roleId,'');
  setRole(step,'speaker',draft,roster); chooseDepartment(step,'liaison',roster); assert.equal(step.roleId,'');
  setRole(step,'speaker',draft,roster); toggleParticipant(step,'b',roster,draft); assert.equal(step.roleId,'');
  assert.deepEqual(t.roles,roles); assert.equal(t.steps[1].roleId,'poster');
  assert.deepEqual(templateDraft(t,roster).roles[2].participantIds,[]);
});

test('role editor and picker escape shared content, show usage and preserve the selected role',async()=>{
  const {buildSync}=require('esbuild'), bundle=buildSync({entryPoints:['client/template-views.js'],bundle:true,format:'esm',write:false});
  const views=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const unsafe='<img src=x onerror=alert(1)>', b={members:[{id:'a',name:unsafe}],templates:[],me:{id:'a'}}, form=templateDraft(roleTemplate(),b.members);
  form.roles[2].name=unsafe;form.roles[2].participantIds=['a'];
  const s={form,steps:form.steps,editBoard:b,openSteps:new Set([1])};
  const editor=views.templateEditor(s), picker=views.roleEditors(s), steps=views.stepEditors(s);
  for (const html of [editor,picker,steps]) { assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;img')); }
  assert.match(editor,/模板角色.*3/); assert.match(editor,/data-action="removeRole"/);
  assert.match(picker,/关联 2 项：/); assert.match(picker,/data-action="roleParticipant"/);
  assert.match(steps,/data-action="stepRole" data-index="1" data-id="poster" aria-pressed="true"/); assert.match(steps,/负责角色（可多选）/); assert.match(steps,/按角色分配/);
});

test('joint role bindings survive save, copy, sync and reorder; old clients cannot erase them',async()=>{
  const f=await fixture(), before=await f.board(), steps=roleTemplate().steps;
  steps[0]={...steps[0],roleId:'',roleIds:['assistant','poster']};
  let t=(await f.create({steps})).template;
  assert.deepEqual(t.steps[0].roleIds,['assistant','poster']);
  assert.deepEqual((await f.run('sync',{clubId:f.clubId,since:before.version},'owner')).templates[0].steps[0].roleIds,t.steps[0].roleIds);
  const copy=(await f.run('createTemplate',{...t,requestId:'joint-role-copy'},'owner')).template;
  t=(await f.run('editTemplate',{...t,templateId:t._id,roles:[roles[2],{...roles[1],name:'协调人'},roles[0]],steps:[...t.steps].reverse()},'owner')).template;
  assert.deepEqual(t.steps[4].roleIds,['assistant','poster']);
  assert.equal(copy.roles[1].name,'助教');
  const oldSteps=t.steps.map(({roleIds,...step})=>step);
  await assert.rejects(f.run('editTemplate',{...t,templateId:t._id,steps:oldSteps},'owner'),{code:'CONFLICT'});
  await assert.rejects(f.run('createTaskGroup',{...f.group(),templateId:t._id,subtasks:oldSteps},'owner'),{code:'CONFLICT'});
  const draft=templateDraft(t,(await f.board()).members);
  draft.steps[4].roleIds.push('speaker');
  assert.deepEqual(t.steps[4].roleIds,['assistant','poster']);
  t=(await f.run('editTemplate',{...t,templateId:t._id,steps:t.steps.map(step=>({...step,roleIds:[],roleId:''}))},'owner')).template;
  assert.ok(t.steps.every(step=>selectedRoleIds(step).length===0));
});

test('joint roles publish the deduplicated union and require a person for every selected role',async()=>{
  const f=await fixture(), input=f.group();
  input.subtasks[0]={...input.subtasks[0],roleId:'',roleIds:['assistant','poster','speaker']};
  const before=f.store.snapshot();
  const missing={...input,roles:input.roles.map(role=>({...role,participantIds:role.id==='poster'?[]:role.participantIds}))};
  await assert.rejects(f.run('createTaskGroup',missing,'owner'),error=>error.code==='VALIDATION'&&error.message.includes('海报制作人'));
  assert.deepEqual(f.store.snapshot(),before);
  const result=await f.run('createTaskGroup',input,'owner');
  assert.deepEqual(result.tasks[1].participantIds,[f.ids.alice,f.ids.bob,f.ids.owner]);
  assert.ok(result.tasks.every(task=>!('roleIds' in task)&&!('roleId' in task)));
  input.roles[1].participantIds=[];
  assert.deepEqual((await f.run('createTaskGroup',input,'owner')).tasks,result.tasks);
});

test('invalid joint role bindings fail atomically, including contradictory legacy fields',async()=>{
  const f=await fixture(),before=f.store.snapshot(),step=roleTemplate().steps[0];
  for(const patch of [
    {roleIds:null},{roleIds:'assistant'},{roleIds:[null]},{roleIds:['']},
    {roleIds:['assistant','missing']},{roleIds:Array(21).fill('assistant')},
    {roleIds:['assistant','poster'],followMain:true},
    {roleIds:['assistant','poster'],participantDepartment:'publicity'},
    {roleIds:['assistant','poster'],roleId:'speaker'},
    {roleIds:[],roleId:'assistant'}
  ]) {
    const joint={...step,roleId:'',...patch};
    await assert.rejects(f.create({steps:[joint]}),{code:'VALIDATION'});
    await assert.rejects(f.run('createTaskGroup',{...f.group(),subtasks:[joint]},'owner'),{code:'VALIDATION'});
  }
  await assert.rejects(f.create({roleIds:['assistant']}),{code:'VALIDATION'});
  assert.deepEqual(f.store.snapshot(),before);
});

test('joint draft assignments keep remaining roles live and preserve the union when changed to manual',()=>{
  const roster=[{id:'a'},{id:'b'},{id:'c'}],form={roles:[
    {id:'core',name:'协调人',participantIds:['a','b']},
    {id:'guest',name:'嘉宾',coreMember:false,participantIds:['c'],guestNames:'张老师\n李老师'},
    {id:'guest2',name:'助讲',coreMember:false,participantIds:['c'],guestNames:'张老师\n王老师'}
  ]},step={participantIds:[]};
  setRoles(step,['core','guest','guest2'],form,roster);
  assert.deepEqual(resolveParticipants(step,roster,form),['a','b','c']);
  assert.deepEqual(resolveGuestNames(step,form),['张老师','李老师','王老师']);
  setFollowMain(step,false,form,roster);
  assert.deepEqual(selectedRoleIds(step),[]);
  assert.deepEqual(step.participantIds,['a','b','c']);
  assert.equal(step.guestNames,'张老师\n李老师\n王老师');
  setRoles(step,['core','guest'],form,roster);
  removeRole(form,[step],'core',roster);
  assert.deepEqual(selectedRoleIds(step),['guest']);
  form.roles[0].participantIds=[];
  assert.deepEqual(resolveParticipants(step,roster,form),[]);
  removeRole(form,[step],'guest',roster);
  assert.deepEqual(selectedRoleIds(step),[]);
  assert.equal(step.guestNames,'张老师\n李老师');
  for(const change of [()=>chooseDepartment(step,'',roster),()=>toggleParticipant(step,'b',roster,form),()=>setFollowMain(step,true,form,roster)]) {
    setRoles(step,['guest2'],form,roster);change();assert.deepEqual(selectedRoleIds(step),[]);
  }
});
