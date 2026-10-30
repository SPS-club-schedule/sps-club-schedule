import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
let mf, options, directory;
const password='Archive-test-password-2026!';
async function post(route,data,token) {
  const response=await mf.dispatchFetch('http://localhost'+route,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://site.test',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data)});
  return {status:response.status,...await response.json()};
}
const attempt=(action,input,token)=>post('/api',{action,input},token);
async function api(action,input,token) {const r=await attempt(action,input,token); assert.equal(r.status,200,JSON.stringify(r)); return r.data;}
async function register(username,invite) {
  const r=await post('/auth/register',{username,password,nickname:username,mode:invite?'join':'create',name:'Archive tests',invite});
  assert.equal(r.status,200,JSON.stringify(r)); return r.data;
}
async function fixture(prefix) {
  const owner=await register(prefix+'_owner'),clubId=owner.clubId,invite=(await api('getInvite',{clubId},owner.token)).token;
  const member=await register(prefix+'_member',invite), board=await api('bootstrap',{clubId},member.token);
  const fields={clubId,title:'Archived work',description:'Preserved description',priority:'high',mode:'individual',participantIds:[board.me.id],dueAt:Date.now()+3*86400000};
  let sequence=0;
  const create=(extra={})=>api('createTask',{...fields,requestId:'archive-task-'+sequence++,...extra},member.token);
  const list=(token=owner.token)=>api('adminArchives',{clubId},token);
  const restore=(task,token=owner.token)=>api('adminRestoreTask',{clubId,taskId:task._id,revision:task.revision},token);
  const template=()=>api('createTemplate',{...fields,requestId:'archive-template',name:'Archived template',category:'Tests',durationMinutes:150,participantDepartment:'academic',steps:[{...fields,title:'Follow main',daysBefore:1,followMain:true}]},member.token);
  return {owner,member,clubId,invite,board,fields,create,list,restore,template};
}
const history = record => {const copy={...record}; for(const field of ['archived','revision','syncVersion','updatedAt','updatedBy']) delete copy[field]; return copy;};
before(async()=>{
  const result=await build({entryPoints:['server/worker.mjs'],bundle:true,format:'esm',platform:'neutral',external:['cloudflare:workers','node:*'],write:false});
  directory=await mkdtemp(path.join(tmpdir(),'sps-archive-'));
  options=convertV4MiniflareOptions({modules:[{type:'ESModule',path:'worker.mjs',contents:result.outputFiles[0].text}],compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],durableObjects:{CLUB_SERVICE:{className:'ClubService',useSQLite:true}},durableObjectsPersist:directory,bindings:{ALLOWED_ORIGINS:'https://site.test',REGISTRATION_OPEN:'true'}});
  options.resourcePersistencePath=directory; mf=new Miniflare(options);
});
after(async()=>{await mf?.dispose(); if(directory) await rm(directory,{recursive:true,force:true});});

test('only current same-club admins can list or restore archives, including other creators’ content',async()=>{
  const f=await fixture('accessarc'),task=(await f.create()).task,template=(await f.template()).template;
  const archived=(await api('archiveTask',{taskId:task._id},f.member.token)).task;
  const archivedTemplate=(await api('archiveTemplate',{templateId:template._id,revision:template.revision},f.member.token)).template;
  const outsider=await register('archive_outsider');
  for(const [action,input] of [['adminArchives',{clubId:f.clubId}],['adminRestoreTask',{clubId:f.clubId,taskId:task._id,revision:archived.revision}],['adminRestoreTemplate',{clubId:f.clubId,templateId:template._id,revision:archivedTemplate.revision}]]) {
    for(const token of [undefined,f.member.token,outsider.token]) assert.equal((await attempt(action,{...input,identity:f.owner.user.id},token)).status,token?403:401);
    assert.equal((await attempt(action,{...input,clubId:outsider.clubId},f.owner.token)).status,403);
  }
  const admin=await register('archive_admin',f.invite), rows=await api('adminMembers',{clubId:f.clubId},f.owner.token), row=rows.members.find(m=>m.username===admin.user.username);
  const promoted=await api('adminEditMember',{clubId:f.clubId,memberId:row.id,memberVersion:row.syncVersion,accountRevision:row.accountRevision,name:row.name,role:'admin',adminPassword:password},f.owner.token);
  assert.equal((await f.list(admin.token)).tasks.length,1);
  await f.restore(archived,admin.token);
  const result=await api('adminRestoreTemplate',{clubId:f.clubId,templateId:template._id,revision:archivedTemplate.revision},admin.token);
  assert.deepEqual(history(result.template),history(template));
  await api('adminEditMember',{clubId:f.clubId,memberId:row.id,memberVersion:promoted.member.syncVersion,accountRevision:row.accountRevision,name:row.name,role:'member',adminPassword:password},f.owner.token);
  assert.equal((await attempt('adminArchives',{clubId:f.clubId},admin.token)).status,403);
  // Being an admin elsewhere does not authorize a target from this club.
  assert.equal((await attempt('adminRestoreTask',{clubId:outsider.clubId,taskId:task._id,revision:archived.revision},outsider.token)).status,404);
});

test('restoring a parent atomically restores only its jointly archived children and preserves history',async()=>{
  const f=await fixture('familyarc');
  const group=await api('createTaskGroup',{...f.fields,requestId:'archive-family',startsAt:f.fields.dueAt,endsAt:f.fields.dueAt+7200000,subtasks:[{...f.fields,title:'Together',daysBefore:1,dueAt:f.fields.dueAt-86400000},{...f.fields,title:'Previously archived',daysBefore:1,dueAt:f.fields.dueAt-86400000}]},f.member.token);
  const children=group.tasks.filter(t=>t.parentTaskId), parent=group.tasks.find(t=>!t.parentTaskId);
  await api('complete',{taskId:children[0]._id,done:true},f.member.token);
  await api('archiveTask',{taskId:children[1]._id},f.member.token);
  const before=await api('bootstrap',{clubId:f.clubId},f.member.token);
  const archived=await api('archiveTask',{taskId:parent._id},f.member.token);
  const list=await f.list(), listedParent=list.tasks.find(t=>t._id===parent._id);
  assert.equal(listedParent.restoreChildCount,1); assert.equal(list.tasks.length,3);
  assert.ok(list.tasks.filter(t=>t.parentTaskId).every(t=>t.parentArchived));
  const child=list.tasks.find(t=>t._id===children[1]._id);
  assert.equal((await attempt('adminRestoreTask',{clubId:f.clubId,taskId:child._id,revision:child.revision},f.owner.token)).status,409);
  const restored=await f.restore(archived.task);
  assert.equal(restored.tasks.length,2); assert.equal(restored.baseVersion,archived.version);
  assert.ok(restored.tasks.every(t=>!t.archived && t.syncVersion===restored.version));
  for(const task of restored.tasks) assert.deepEqual(history(task),history(before.tasks.find(t=>t._id===task._id)));
  const delta=await api('sync',{clubId:f.clubId,since:archived.version},f.member.token);
  assert.equal(delta.tasks.length,2); assert.ok(delta.tasks.every(t=>!t.archived));
  const remaining=await f.list(); assert.equal(remaining.tasks.length,1); assert.equal(remaining.tasks[0].parentArchived,false);
  await f.restore(remaining.tasks[0]);
  assert.equal((await api('bootstrap',{clubId:f.clubId},f.member.token)).tasks.length,3);
});

test('templates restore original duration, department rules and steps without changing published tasks',async()=>{
  const f=await fixture('templatearc'),template=(await f.template()).template;
  await f.create(); const before=await api('bootstrap',{clubId:f.clubId},f.member.token);
  const archived=await api('archiveTemplate',{templateId:template._id,revision:template.revision},f.member.token);
  const restored=await api('adminRestoreTemplate',{clubId:f.clubId,templateId:template._id,revision:archived.template.revision},f.owner.token);
  assert.deepEqual(history(restored.template),history(template));
  assert.equal(restored.template.durationMinutes,150); assert.equal(restored.template.steps[0].followMain,true);
  assert.equal(restored.template.participantDepartment,'academic');
  const delta=await api('sync',{clubId:f.clubId,since:archived.version},f.member.token);
  assert.equal(delta.templates[0].archived,false);
  assert.deepEqual((await api('bootstrap',{clubId:f.clubId},f.member.token)).tasks,before.tasks);
  assert.equal((await f.list()).templates.length,0);
  await mf.dispose(); mf=new Miniflare(options);
  assert.equal((await api('bootstrap',{clubId:f.clubId},f.member.token)).templates.find(t=>t._id===template._id).durationMinutes,150);
});

test('stale or duplicate restore requests never restore a newly re-archived revision',async()=>{
  const f=await fixture('stalarc'),task=(await f.create()).task;
  const first=(await api('archiveTask',{taskId:task._id},f.member.token)).task;
  const restored=await f.restore(first);
  assert.equal((await attempt('adminRestoreTask',{clubId:f.clubId,taskId:task._id,revision:first.revision},f.owner.token)).status,409);
  const rearchived=(await api('archiveTask',{taskId:task._id},f.member.token)).task;
  assert.equal((await attempt('adminRestoreTask',{clubId:f.clubId,taskId:task._id,revision:first.revision},f.owner.token)).status,409);
  assert.equal((await f.list()).tasks[0].revision,rearchived.revision);
  const attempts=await Promise.all([1,2].map(()=>attempt('adminRestoreTask',{clubId:f.clubId,taskId:task._id,revision:rearchived.revision},f.owner.token)));
  assert.deepEqual(attempts.map(r=>r.status).sort(),[200,409]);
  assert.equal((await f.list()).tasks.length,0);
  assert.ok(restored.version>first.syncVersion);
});

test('archive listing is club-scoped and reading it does not exhaust the admin write budget',async()=>{
  const f=await fixture('listarc'), task=(await f.create()).task;
  const other=await register('arc_other_club');
  await api('archiveTask',{taskId:task._id},f.member.token);
  assert.deepEqual(await api('adminArchives',{clubId:other.clubId},other.token),{tasks:[],templates:[],currentUser:other.user});
  for(let i=0;i<65;i++) assert.equal((await f.list()).tasks.length,1);
  await f.restore((await f.list()).tasks[0]);
});
