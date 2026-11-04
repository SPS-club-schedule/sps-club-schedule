import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
let mf,options,rawOptions,directory,owner,member,speaker,clubId,ids,group,template;
const password='Speaker-test-password-2026!';
async function post(route,input,account=owner){const response=await mf.dispatchFetch('http://localhost'+route,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://site.test',...(account?{Authorization:'Bearer '+account.token}:{})},body:JSON.stringify(input)});return {status:response.status,...await response.json()};}
async function api(action,input,account=owner){const result=await post('/api',{action,input},account);assert.equal(result.status,200,JSON.stringify(result));return result.data;}
async function role(account,value,department){const list=await api('adminMembers',{clubId}),row=list.members.find(m=>m.username===account.user.username);return api('adminEditMember',{clubId,memberId:row.id,memberVersion:row.syncVersion,accountRevision:row.accountRevision,name:row.name,username:row.username,role:value,department,adminPassword:password});}
before(async()=>{
  directory=await mkdtemp(path.join(tmpdir(),'sps-speakers-'));
  const bundle=await build({entryPoints:['server/worker.mjs'],bundle:true,format:'esm',platform:'neutral',external:['cloudflare:workers','node:*'],write:false});
  rawOptions={modules:[{type:'ESModule',path:'worker.mjs',contents:bundle.outputFiles[0].text}],compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],durableObjects:{CLUB_SERVICE:{className:'ClubService',useSQLite:true}},durableObjectsPersist:directory,bindings:{ALLOWED_ORIGINS:'https://site.test',REGISTRATION_OPEN:'true'}};
  options=convertV4MiniflareOptions(rawOptions);options.resourcePersistencePath=directory;mf=new Miniflare(options);
  const register=async(username,extra)=>{const result=await post('/auth/register',{username,email:username+'@example.test',nickname:username,password,...extra},null);assert.equal(result.status,200,JSON.stringify(result));return result.data;};
  owner=await register('speaker_owner',{mode:'create',name:'Speaker test'});clubId=owner.clubId;
  rawOptions.bindings.EXPERIENCE_CLUB_ID=clubId;options=convertV4MiniflareOptions(rawOptions);options.resourcePersistencePath=directory;await mf.setOptions(options);
  const invites=await api('getInvite',{clubId});
  member=await register('speaker_member',{mode:'join',invite:invites.token});
  speaker=await register('speaker_guest',{mode:'join',invite:invites.departments.find(d=>d.id==='speaker').token,role:'owner'});
  ids={owner:(await api('bootstrap',{clubId})).me.id,member:(await api('bootstrap',{clubId},member)).me.id,speaker:(await api('bootstrap',{clubId},speaker)).me.id};
});
after(async()=>{await mf?.dispose();await rm(directory,{recursive:true,force:true});});
const fields={title:'外部主讲活动',description:'',mode:'individual',priority:'normal',participantIds:[]};
test('actual Worker stores non-core templates and mixed registered/named speaker assignments across restart',async()=>{
  ({template}=await api('createTemplate',{...fields,clubId,requestId:'runtime-speaker-template',name:'主讲人模板',category:'学术',roles:[{id:'talker',name:'主讲人',coreMember:false}],steps:[{...fields,id:'speech',title:'准备演讲',roleId:'talker',daysBefore:1,dependsOn:[]}]}));
  const input={...fields,clubId,templateId:template._id,requestId:'runtime-speaker-group',participantIds:[ids.member],dueAt:Date.now()+10*86400000,roles:[{...template.roles[0],participantIds:[ids.speaker],guestNames:'免注册张老师'}],subtasks:template.steps};
  group=await api('createTaskGroup',input);assert.equal((await api('createTaskGroup',input)).taskId,group.taskId);
  const child=group.tasks[1];assert.deepEqual(child.participantIds,[ids.speaker]);assert.equal(child.guestParticipants[0].name,'免注册张老师');
  await mf.dispose();mf=new Miniflare(options);
  const b=await api('bootstrap',{clubId},speaker);assert.equal(b.me.role,'speaker');assert.equal(b.templates.length,0);assert.deepEqual(b.tasks.map(t=>t._id),[child._id]);
  assert.equal((await api('bootstrap',{clubId})).members.length,3);
});
test('speaker cannot create, edit, archive, proxy for others, read private activity status or contribute experience',async()=>{
  for(const [action,input] of [
    ['createTask',{...fields,clubId,requestId:'forbidden-create',dueAt:Date.now()+86400000}],['createTaskGroup',{clubId,requestId:'forbidden-group'}],
    ['createTemplate',{...template,requestId:'forbidden-template'}],['editTemplate',{...template,templateId:template._id}],['archiveTemplate',{templateId:template._id,revision:template.revision}],
    ['editTask',{...group.tasks[1],taskId:group.tasks[1]._id}],['archiveTask',{taskId:group.tasks[1]._id}],['complete',{taskId:group.taskId,done:true}],
    ['complete',{taskId:group.tasks[1]._id,participantId:group.tasks[1].guestParticipants[0].id,done:true}],['bookingStatus',{clubId}],['adminMembers',{clubId}],['getInvite',{clubId}]
  ])assert.equal((await post('/api',{action,input:{...input,role:'owner',identity:owner.user.id}},speaker)).status,403,action);
  assert.equal((await post('/experience/manage',{action:'folder',path:'forbidden'},speaker)).status,403);
  assert.equal((await post('/experience/manage',{action:'folder',path:'member-folder'},member)).status,200);
  await api('complete',{taskId:group.tasks[1]._id,done:true},speaker);
});
test('same-club member proxy completion records the authenticated actor and survives SQLite restart',async()=>{
  const child=group.tasks[1],guest=child.guestParticipants[0],input={taskId:child._id,participantId:guest.id,done:true,actorName:'forged',actorId:ids.owner};
  const result=await api('complete',input,member);assert.equal(result.task.completionActors[guest.id].actorId,ids.member);assert.equal(result.task.completionActors[guest.id].actorName,'speaker_member');
  const again=await api('complete',input);assert.equal(again.task.completionActors[guest.id].actorId,ids.member);
  await mf.dispose();mf=new Miniflare(options);
  const saved=(await api('bootstrap',{clubId})).tasks.find(t=>t._id===child._id);assert.deepEqual(saved.completionActors,result.task.completionActors);
  const copied=await api('createTemplate',{...template,requestId:'runtime-speaker-copy'},member);assert.equal(copied.template.roles[0].coreMember,false);
});
test('demotion prunes the old board, promotion restores older tasks, and identities stay consistent',async()=>{
  const before=await api('bootstrap',{clubId},member);assert.ok(before.templates.length>0);
  const changed=await role(member,'speaker','speaker');
  const after=await api('sync',{clubId,since:before.version},member);assert.equal(after.full,true);assert.equal(after.me.role,'speaker');assert.equal(after.templates.length,0);assert.deepEqual(after.tasks.map(t=>t._id),[group.taskId]);
  assert.ok(!after.tasks.some(t=>t._id===group.tasks[1]._id));
  assert.equal((await post('/api',{action:'adminEditMember',input:{clubId,memberId:ids.member,memberVersion:changed.member.syncVersion,accountRevision:changed.adminMember.accountRevision,name:changed.member.name,role:'member',department:'speaker',adminPassword:password}})).status,400);
  await role(member,'member','academic');
  const restored=await api('sync',{clubId,since:after.version},member);assert.equal(restored.full,true);assert.ok(restored.tasks.some(t=>t._id===group.tasks[1]._id));assert.ok(restored.templates.length>0);
});
