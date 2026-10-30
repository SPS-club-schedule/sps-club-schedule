import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
let mf, options, directory, owner, alice, clubId, invite, memberIds;
const password = 'Test-only-password-2026!';
async function post(route, data, token, origin = 'https://site.test') {
  const response = await mf.dispatchFetch('http://localhost'+route, { method:'POST', headers:{ 'Content-Type':'application/json', Origin:origin, ...(token?{ Authorization:'Bearer '+token }:{}) }, body:JSON.stringify(data) });
  return { status:response.status, ...(await response.json()), headers:response.headers };
}
async function api(action, input, token=owner.token) { const r=await post('/api',{action,input},token); assert.equal(r.status,200,JSON.stringify(r)); return r.data; }
async function register(username, mode, extra={}) { return post('/auth/register',{ username,password,nickname:username,mode,name:'SPS 测试社团',invite,...extra }); }
before(async()=>{
  const result=await build({entryPoints:['server/worker.mjs'],bundle:true,format:'esm',platform:'neutral',external:['cloudflare:workers','node:*'],write:false});
  directory=await mkdtemp(path.join(tmpdir(),'sps-worker-'));
  options={ modules:[{type:'ESModule',path:'worker.mjs',contents:result.outputFiles[0].text}], compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],durableObjects:{CLUB_SERVICE:{className:'ClubService',useSQLite:true}},durableObjectsPersist:directory,bindings:{ALLOWED_ORIGINS:'https://site.test',REGISTRATION_OPEN:'true',GATEWAY_SIGNING_KEY:'test-gateway-secret'} };
  options=convertV4MiniflareOptions(options); options.resourcePersistencePath=directory; mf=new Miniflare(options);
  const first=await register('owner','create'); assert.equal(first.status,200,JSON.stringify(first)); owner=first.data; clubId=owner.clubId;
  invite=(await api('getInvite',{clubId})).token;
  const second=await register('alice','join'); assert.equal(second.status,200,JSON.stringify(second)); alice=second.data;
  memberIds=(await api('bootstrap',{clubId})).members.map(m=>m.id);
});
after(async()=>{ await mf?.dispose(); if(directory) await rm(directory,{recursive:true,force:true}); });

test('actual Workers runtime authenticates independent accounts and persists SQLite membership',async()=>{
  const a=await api('bootstrap',{clubId}); const b=await api('bootstrap',{clubId},alice.token);
  assert.equal(a.members.length,2); assert.notEqual(a.me.id,b.me.id); assert.equal(b.me.name,'alice');
  assert.ok(a.members.every(m=>!('identity' in m))); assert.ok(!JSON.stringify(a).includes(owner.token));
});
test('API rejects missing sessions, spoofed identity and origins outside the exact allowlist',async()=>{
  assert.equal((await post('/api',{action:'bootstrap',input:{clubId,identity:owner.user.id}})).status,401);
  assert.equal((await post('/api',{action:'bootstrap',input:{clubId}},owner.token,'https://site.test.evil.test')).status,403);
  const preflight=await mf.dispatchFetch('http://localhost/api',{method:'OPTIONS',headers:{Origin:'https://site.test','Access-Control-Request-Headers':'authorization,content-type'}});
  assert.equal(preflight.status,204); assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'https://site.test');
});
test('invalid invitation rolls back account creation, allowing the same username to retry',async()=>{
  assert.equal((await register('retry_user','join',{invite:'a'.repeat(32)})).status,404);
  assert.equal((await post('/auth/login',{username:'retry_user',password})).status,401);
  const retry=await register('retry_user','join'); assert.equal(retry.status,200,JSON.stringify(retry));
});
test('concurrent task completion remains atomic in real SQLite storage, with incremental archive removal',async()=>{
  const initial=await api('bootstrap',{clubId});
  const t=await api('createTask',{clubId,requestId:'concurrent-task-1',title:'准备分享会',description:'测试',dueAt:Date.now()+86400000,priority:'normal',mode:'individual',participantIds:memberIds});
  await Promise.all([api('complete',{taskId:t.taskId,done:true}),api('complete',{taskId:t.taskId,done:true},alice.token)]);
  const delta=await api('sync',{clubId,since:initial.version}); assert.equal(Object.keys(delta.tasks[0].completions).length,2);
  const archived=await api('archiveTask',{taskId:t.taskId});
  const next=await api('sync',{clubId,since:delta.version},alice.token); assert.equal(next.tasks[0].archived,true); assert.equal(next.version,archived.version);
  const unchanged=await api('sync',{clubId,since:next.version},alice.token); assert.equal(unchanged.unchanged,true);
});
test('members cannot edit another member’s tasks or read another club',async()=>{
  const t=await api('createTask',{clubId,requestId:'permissions-task-1',title:'权限测试',description:'',dueAt:Date.now()+86400000,priority:'normal',mode:'shared',participantIds:memberIds});
  assert.equal((await post('/api',{action:'archiveTask',input:{taskId:t.taskId,identity:owner.user.id}},alice.token)).status,403);
  const outsider=(await register('outsider','create')).data;
  assert.equal((await post('/api',{action:'bootstrap',input:{clubId}},outsider.token)).status,403);
});
test('login is case-insensitive, checks password, and logout revokes the session server-side',async()=>{
  assert.equal((await post('/auth/login',{username:'OWNER',password:'incorrect-password!'})).status,401);
  const login=await post('/auth/login',{username:'OWNER',password}); assert.equal(login.status,200);
  assert.equal((await post('/auth/logout',{},login.data.token)).status,200);
  assert.equal((await post('/api',{action:'bootstrap',input:{}},login.data.token)).status,401);
});
test('recovery rotates the recovery code and revokes every previous session',async()=>{
  const r=await register('recover_user','join'); const old=r.data;
  const recovered=await post('/auth/recover',{username:'recover_user',password:'A-new-test-password!',recoveryCode:old.recoveryCode});
  assert.equal(recovered.status,200); assert.notEqual(recovered.data.recoveryCode,old.recoveryCode);
  assert.equal((await post('/api',{action:'bootstrap',input:{}},old.token)).status,401);
  assert.equal((await post('/auth/recover',{username:'recover_user',password,recoveryCode:old.recoveryCode})).status,401);
  assert.equal((await post('/auth/login',{username:'recover_user',password:'A-new-test-password!'})).status,200);
});
test('per-account login failures are throttled and oversized requests rejected',async()=>{
  for(let i=0;i<10;i++) assert.equal((await post('/auth/login',{username:'missing_user',password})).status,401);
  assert.equal((await post('/auth/login',{username:'missing_user',password})).status,429);
  assert.equal((await post('/api',{action:'bootstrap',input:{large:'a'.repeat(40000)}},owner.token)).status,400);
});
test('invitation rotation invalidates previous links without removing current members',async()=>{
  const old=invite; invite=(await api('rotateInvite',{clubId})).token;
  assert.equal((await register('old_invite','join',{invite:old})).status,404);
  assert.equal((await register('new_invite','join')).status,200);
  assert.equal((await api('bootstrap',{clubId},alice.token)).club.id,clubId);
});
test('accounts, sessions and tasks survive a Workers runtime restart',async()=>{
  await mf.dispose(); mf=new Miniflare(options);
  const board=await api('bootstrap',{clubId}); assert.ok(board.tasks.some(t=>t.title==='权限测试'));
  assert.equal((await post('/auth/login',{username:'owner',password})).status,200);
});


test('gateway IP proofs preserve separate rate limits and reject spoofed or expired proofs', async () => {
  async function attempt(ip, valid = true, expired = false) {
    const time = String(Date.now() - (expired ? 120000 : 0));
    const signature = createHmac('sha256', valid ? 'test-gateway-secret' : 'wrong-key').update(`${time}\n${ip}`).digest('hex');
    return mf.dispatchFetch('http://localhost/auth/login', { method: 'POST', headers: {
      'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.100',
      'X-SPS-Gateway-IP': ip, 'X-SPS-Gateway-Time': time, 'X-SPS-Gateway-Signature': signature
    }, body: JSON.stringify({ username: '!', password }) });
  }
  for (let i = 0; i < 120; i++) assert.equal((await attempt('192.0.2.1')).status, 400);
  assert.equal((await attempt('192.0.2.1')).status, 429);
  assert.equal((await attempt('192.0.2.2')).status, 400);
  // Forged varying IPs must still share the real transport IP limit.
  for (let i = 0; i < 120; i++) assert.equal((await attempt(`192.0.2.${i}`, false)).status, 400);
  assert.equal((await attempt('192.0.2.250', false)).status, 429);
  assert.equal((await attempt('192.0.2.251', true, true)).status, 429);
  assert.equal((await attempt('192.0.2.2')).status, 400);
});

test('SQLite persists assigned subtasks and atomically archives the parent and all child records', async () => {
  const parent=await api('createTask',{clubId,requestId:'subtask-parent-runtime',title:'Runtime parent',description:'',dueAt:Date.now()+86400000,priority:'normal',mode:'individual',participantIds:memberIds});
  const aliceBoard=await api('bootstrap',{clubId},alice.token);
  const child=await api('createTask',{clubId,parentTaskId:parent.taskId,requestId:'subtask-child-runtime',title:'Assigned subtask',description:'',dueAt:Date.now()+3600000,priority:'normal',mode:'individual',participantIds:[aliceBoard.me.id]});
  assert.equal(child.task.parentTaskId,parent.taskId);
  assert.equal((await post('/api',{action:'complete',input:{taskId:child.taskId,done:true}},owner.token)).status,403);
  await api('complete',{taskId:child.taskId,done:true},alice.token);
  await mf.dispose(); mf=new Miniflare(options);
  const persisted=await api('bootstrap',{clubId},alice.token);
  assert.ok(persisted.tasks.find(t=>t._id===child.taskId).completions[aliceBoard.me.id]);
  const archived=await api('archiveTask',{taskId:parent.taskId});
  assert.equal(archived.tasks.length,2);
  const delta=await api('sync',{clubId,since:persisted.version},alice.token);
  assert.equal(delta.tasks.filter(t=>t.archived&&[parent.taskId,child.taskId].includes(t._id)).length,2);
});

test('shared templates persist in SQLite and batch creation is atomic, repeatable and visible to assignees',async()=>{
  const b=await api('bootstrap',{clubId},alice.token),seed=b.templates[0];
  assert.deepEqual(seed.steps.map(s=>s.daysBefore),[4,3,3,2,1]);
  const created=await api('createTemplate',{...seed,name:'SQLite 研讨班',category:'测试活动',requestId:'runtime-template',clubId},alice.token);
  const input={...seed,clubId,templateId:created.template._id,requestId:'runtime-template-group',title:'Runtime seminar',dueAt:Date.now()+10*86400000,participantIds:[b.me.id],subtasks:seed.steps.map(s=>({...s,participantIds:[b.me.id]}))};
  const before=await api('bootstrap',{clubId});
  const invalid=await post('/api',{action:'createTaskGroup',input:{...input,subtasks:[...input.subtasks.slice(0,4),{...input.subtasks[4],participantIds:['foreign']}] }},alice.token);
  assert.equal(invalid.status,400);assert.equal((await api('bootstrap',{clubId})).version,before.version);
  const group=await api('createTaskGroup',input,alice.token);assert.equal(group.tasks.length,6);
  assert.equal((await api('createTaskGroup',input,alice.token)).taskId,group.taskId);
  const modified=await api('editTemplate',{...created.template,templateId:created.template._id,category:'学术分享'});
  await mf.dispose();mf=new Miniflare(options);
  const persisted=await api('bootstrap',{clubId},alice.token);
  assert.equal(persisted.templates.find(t=>t._id===created.template._id).category,'学术分享');
  assert.equal(persisted.tasks.filter(t=>t._id===group.taskId||t.parentTaskId===group.taskId).length,6);
  assert.equal((await post('/api',{action:'editTemplate',input:{...created.template,templateId:created.template._id}},alice.token)).status,409);
  await api('archiveTemplate',{templateId:created.template._id,revision:modified.template.revision},alice.token);
  assert.equal((await api('bootstrap',{clubId},alice.token)).tasks.filter(t=>t.parentTaskId===group.taskId).length,5);
});

async function adminFixture(prefix) {
  const creator=(await register(prefix+'_owner','create')).data;
  const clubId=creator.clubId, invite=(await api('getInvite',{clubId},creator.token)).token;
  const member=(await register(prefix+'_member','join',{invite})).data;
  const list=()=>api('adminMembers',{clubId},creator.token);
  const row=async account=>(await list()).members.find(m=>m.username===account.user.username);
  const input=target=>({clubId,memberId:target.id,memberVersion:target.syncVersion,accountRevision:target.accountRevision,name:target.name,role:target.role,username:target.username,adminPassword:password});
  return {creator,member,clubId,invite,list,row,input};
}

test('admin endpoints require a live same-club admin session and never expose password or recovery data',async()=>{
  const f=await adminFixture('access'),target=await f.row(f.member);
  for(const action of ['adminMembers','adminEditMember','adminResetPassword','getInvite']) {
    for(const token of [undefined,f.member.token,owner.token]) {
      const r=await post('/api',{action,input:{...f.input(target),identity:f.creator.user.id,role:'owner'}},token);
      assert.equal(r.status,token?403:401);
    }
  }
  const listed=await f.list();
  assert.equal(listed.members.length,2);assert.ok(listed.members.every(m=>m.username));
  const serialized=JSON.stringify(listed);
  for(const value of ['password_hash','salt','recovery_hash',f.member.recoveryCode,f.member.token,f.member.user.id]) assert.ok(!serialized.includes(value));
  const board=await api('bootstrap',{clubId:f.clubId},f.member.token);
  assert.ok(board.members.every(m=>!('username' in m)&&!('identity' in m)));
});

test('admin edits update member sync and login usernames atomically, reject duplicates and stale forms',async()=>{
  const f=await adminFixture('edit'),target=await f.row(f.member),before=await api('bootstrap',{clubId:f.clubId},f.member.token);
  const collision=await post('/api',{action:'adminEditMember',input:{...f.input(target),name:'Must not persist',username:f.creator.user.username}},f.creator.token);
  assert.equal(collision.status,409);assert.equal((await f.row(f.member)).name,target.name);
  const edited=await api('adminEditMember',{...f.input(target),name:'小林',username:'renamed_member'},f.creator.token);
  assert.equal(edited.member.name,'小林');assert.equal(edited.adminMember.accountRevision,target.accountRevision+1);
  assert.equal((await post('/auth/login',{username:f.member.user.username,password})).status,401);
  assert.equal((await post('/auth/login',{username:'RENAMED_MEMBER',password})).status,200);
  const delta=await api('sync',{clubId:f.clubId,since:before.version},f.member.token);
  assert.equal(delta.me.name,'小林');assert.equal(delta.currentUser.username,'renamed_member');
  assert.equal((await post('/api',{action:'adminEditMember',input:{...f.input(target),name:'Stale'}},f.creator.token)).status,409);
  const noPassword=await api('adminEditMember',{...f.input(edited.adminMember),adminPassword:undefined,name:'新称呼'},f.creator.token);
  assert.equal(noPassword.member.name,'新称呼');
  assert.equal((await post('/api',{action:'adminEditMember',input:{...f.input(noPassword.adminMember),username:'another_name',adminPassword:'wrong-password'}},f.creator.token)).status,403);
  assert.equal((await f.list()).events.filter(e=>e.action==='edit').length,2);
});

test('only the creator appoints admins; delegated admins cannot alter creator or peers or their own role',async()=>{
  const f=await adminFixture('roles'),target=await f.row(f.member);
  const promoted=await api('adminEditMember',{...f.input(target),role:'admin'},f.creator.token);
  const adminList=await api('adminMembers',{clubId:f.clubId},f.member.token);
  assert.equal(adminList.me.role,'admin');
  const invitations=await api('getInvite',{clubId:f.clubId},f.member.token);
  assert.equal(invitations.token,f.invite); assert.equal(invitations.departments.length,3);
  const creator=adminList.members.find(m=>m.role==='owner');
  assert.equal(creator.canEdit,false);
  for(const input of [
    {...f.input(creator),name:'Hijacked'},
    {...f.input(promoted.adminMember),role:'owner'},
    {...f.input(promoted.adminMember),role:'member'}
  ]) assert.equal((await post('/api',{action:'adminEditMember',input},f.member.token)).status,403);
  assert.equal((await post('/api',{action:'adminEditMember',input:{...f.input(creator),role:'member'}},f.creator.token)).status,403);
  const ordinary=(await register('roles_ordinary','join',{invite:f.invite})).data,target2=await f.row(ordinary);
  const changed=await api('adminEditMember',{...f.input(target2),name:'管理员修改的称呼'},f.member.token);
  assert.equal(changed.member.name,'管理员修改的称呼');
  assert.equal((await post('/api',{action:'adminEditMember',input:{...f.input(changed.adminMember),role:'admin'}},f.member.token)).status,403);
  await api('adminEditMember',{...f.input(promoted.adminMember),role:'member'},f.creator.token);
  assert.equal((await post('/api',{action:'adminMembers',input:{clubId:f.clubId}},f.member.token)).status,403);
  assert.equal((await post('/api',{action:'getInvite',input:{clubId:f.clubId}},f.member.token)).status,403);
  assert.equal((await api('bootstrap',{clubId:f.clubId},f.member.token)).me.role,'member');
});

test('reset links are single-use, rotated, persisted, reauthenticated and revoke old sessions and recovery codes on redemption',async()=>{
  const f=await adminFixture('reset'),target=await f.row(f.member);
  assert.equal((await post('/api',{action:'adminResetPassword',input:{...f.input(target),adminPassword:undefined}},f.creator.token)).status,403);
  const first=await api('adminResetPassword',f.input(target),f.creator.token);
  const second=await api('adminResetPassword',f.input(target),f.creator.token);
  assert.ok(second.expiresAt>Date.now()+29*60000&&second.expiresAt<=Date.now()+30*60000);
  assert.notEqual(first.resetToken,second.resetToken);
  assert.equal((await post('/auth/recover',{username:target.username,password,resetToken:first.resetToken})).status,401);
  await mf.dispose();mf=new Miniflare(options);
  const changed=await post('/auth/recover',{username:target.username,password:'New-member-password!',resetToken:second.resetToken});
  assert.equal(changed.status,200);assert.notEqual(changed.data.recoveryCode,f.member.recoveryCode);
  assert.equal((await post('/api',{action:'bootstrap',input:{}},f.member.token)).status,401);
  assert.equal((await post('/auth/recover',{username:target.username,password,resetToken:second.resetToken})).status,401);
  assert.equal((await post('/auth/recover',{username:target.username,password,recoveryCode:f.member.recoveryCode})).status,401);
  assert.equal((await post('/auth/login',{username:target.username,password:'New-member-password!'})).status,200);
  const listed=await f.list();assert.ok(!JSON.stringify(listed).includes(second.resetToken));
  assert.equal(listed.events.filter(e=>e.action==='reset').length,2);
});

test('club admins cannot take over accounts in other clubs or manage themselves through the admin endpoint',async()=>{
  const f=await adminFixture('multi');
  await api('createClub',{name:'Another club',nickname:'Other owner',requestId:'multi-other-club'},f.member.token);
  const target=await f.row(f.member);
  assert.equal(target.canEdit,true);assert.equal(target.canEditAccount,false);
  for(const [action,input] of [['adminEditMember',{...f.input(target),username:'stolen_name'}],['adminResetPassword',f.input(target)]]) {
    assert.equal((await post('/api',{action,input},f.creator.token)).status,403);
  }
  const renamed=await api('adminEditMember',{...f.input(target),name:'本社团称呼'},f.creator.token);
  assert.equal(renamed.member.name,'本社团称呼');
  const own=await api('adminMembers',{},f.member.token).catch(()=>null);assert.equal(own,null);
  const clubs=(await api('bootstrap',{},f.member.token)).clubs;
  const other=clubs.find(c=>c.id!==f.clubId),self=(await api('adminMembers',{clubId:other.id},f.member.token)).members[0];
  assert.equal(self.canEditAccount,false); // Self-service uses the separate account settings API.
});

test('demotion cancels pending reset links and joining a different club invalidates earlier account authority',async()=>{
  const f=await adminFixture('cancel'),target=await f.row(f.member);
  const promoted=await api('adminEditMember',{...f.input(target),role:'admin'},f.creator.token);
  const ordinary=(await register('cancel_ordinary','join',{invite:f.invite})).data;
  const target2=await f.row(ordinary);
  const reset=await api('adminResetPassword',f.input(target2),f.member.token);
  await api('adminEditMember',{...f.input(promoted.adminMember),role:'member'},f.creator.token);
  assert.equal((await post('/auth/recover',{username:target2.username,password,resetToken:reset.resetToken})).status,401);
  const reset2=await api('adminResetPassword',f.input(target2),f.creator.token);
  await api('createClub',{name:'New club',nickname:'New owner',requestId:'cancel-other-club'},ordinary.token);
  assert.equal((await post('/auth/recover',{username:target2.username,password,resetToken:reset2.resetToken})).status,403);
});

test('failed admin password checks are rate-limited despite edit-transaction rollback',async()=>{
  const f=await adminFixture('throttle'),target=await f.row(f.member);
  for(let i=0;i<10;i++) assert.equal((await post('/api',{action:'adminResetPassword',input:{...f.input(target),adminPassword:'wrong-password!'}},f.creator.token)).status,403);
  assert.equal((await post('/api',{action:'adminResetPassword',input:f.input(target)},f.creator.token)).status,429);
  assert.equal((await f.list()).events.length,0);
});

test('department registration, joining, admin edits, authorization, rotation and sync persist in SQLite',async()=>{
  const f=await adminFixture('dept');
  const invites=await api('getInvite',{clubId:f.clubId},f.creator.token);
  const accounts=[];
  for(const d of invites.departments) {
    const registered=await register('dept_'+d.id,'join',{invite:d.token,department:'forged',role:'admin'});
    assert.equal(registered.status,200,JSON.stringify(registered)); accounts.push(registered.data);
    const board=await api('bootstrap',{clubId:f.clubId},registered.data.token);
    assert.equal(board.me.department,d.id); assert.equal(board.me.role,'member');
    assert.ok(!JSON.stringify(board).includes(d.token));
  }
  const before=await api('bootstrap',{clubId:f.clubId},f.member.token);
  await api('joinClub',{token:invites.departments[1].token,nickname:'Keep original name'},f.member.token);
  const delta=await api('sync',{clubId:f.clubId,since:before.version},f.member.token);
  assert.equal(delta.me.department,'liaison'); assert.equal(delta.me.name,before.me.name);
  assert.equal((await post('/api',{action:'joinClub',input:{token:invites.departments[2].token,nickname:'Wrong department'}},f.member.token)).status,409);
  let target=await f.row(f.member);
  for(const token of [f.member.token,owner.token]) assert.equal((await post('/api',{action:'adminEditMember',input:{...f.input(target),department:'academic'}},token)).status,403);
  for(const department of ['unknown',null,{}]) assert.equal((await post('/api',{action:'adminEditMember',input:{...f.input(target),department}},f.creator.token)).status,400);
  assert.equal((await f.row(f.member)).department,'liaison');
  const edited=await api('adminEditMember',{...f.input(target),department:'academic',adminPassword:undefined},f.creator.token);
  assert.equal(edited.member.department,'academic'); assert.equal(edited.adminMember.department,'academic');
  assert.equal((await f.list()).events[0].fields[0],'department');
  assert.equal((await post('/api',{action:'adminEditMember',input:{...f.input(target),department:'publicity'}},f.creator.token)).status,409);
  // A pre-department client can still rename without erasing the assignment.
  const renamed=await api('adminEditMember',{...f.input(edited.adminMember),name:'Department member',adminPassword:undefined},f.creator.token);
  assert.equal(renamed.member.department,'academic');
  const promoted=await api('adminEditMember',{...f.input(renamed.adminMember),role:'admin'},f.creator.token);
  target=await f.row(accounts[0]);
  await api('adminEditMember',{...f.input(target),department:'liaison',adminPassword:undefined},f.member.token);
  const creator=(await f.list()).members.find(m=>m.role==='owner');
  assert.equal((await post('/api',{action:'adminEditMember',input:{...f.input(creator),department:'publicity'}},f.member.token)).status,403);
  assert.equal((await post('/api',{action:'rotateInvite',input:{clubId:f.clubId,department:'publicity'}},f.member.token)).status,403);
  const rotated=await api('rotateInvite',{clubId:f.clubId,department:'publicity'},f.creator.token);
  assert.equal((await post('/api',{action:'joinClub',input:{token:invites.departments[0].token,nickname:'Old code'}},accounts[0].token)).status,404);
  const cleared=await api('adminEditMember',{...f.input(promoted.adminMember),department:'',adminPassword:undefined},f.creator.token);
  assert.equal(cleared.member.department,'');
  await mf.dispose(); mf=new Miniflare(options);
  const persisted=await api('getInvite',{clubId:f.clubId},f.creator.token);
  assert.equal(persisted.departments[0].token,rotated.token); assert.equal(persisted.token,invites.token);
  assert.deepEqual(persisted.departments.slice(1),invites.departments.slice(1));
  const roster=(await api('bootstrap',{clubId:f.clubId},f.member.token)).members;
  assert.equal(roster.find(m=>m.id===target.id).department,'liaison');
  assert.equal(roster.find(m=>m.id===cleared.member.id).department,'');
});

test('separate management roles enforce hierarchy, department boundaries, audit access and public role privacy',async()=>{
  async function scopedRegister(username,mode,invite) {
    const time=String(Date.now()),ip='192.0.2.77';
    const signature=createHmac('sha256','test-gateway-secret').update(`${time}\n${ip}`).digest('hex');
    const response=await mf.dispatchFetch('http://localhost/auth/register',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://site.test','X-SPS-Gateway-IP':ip,'X-SPS-Gateway-Time':time,'X-SPS-Gateway-Signature':signature},body:JSON.stringify({username,password,nickname:username,mode,invite,name:'Scoped roles'})});
    const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result.data;
  }
  const creator=await scopedRegister('scoped_owner','create'),clubId=creator.clubId;
  const invitation=(await api('getInvite',{clubId},creator.token)).token;
  const list=()=>api('adminMembers',{clubId},creator.token);
  const f={creator,clubId,list,row:async account=>(await list()).members.find(m=>m.username===account.user.username),input:target=>({clubId,memberId:target.id,memberVersion:target.syncVersion,accountRevision:target.accountRevision,name:target.name,role:target.role,username:target.username,adminPassword:password})};
  const dept=await scopedRegister('scoped_member','join',invitation),web=await scopedRegister('scoped_web','join',invitation);
  const general=await scopedRegister('scoped_general','join',invitation),local=await scopedRegister('scoped_local','join',invitation),foreign=await scopedRegister('scoped_foreign','join',invitation);
  const configure=async(user,role,department='')=>api('adminEditMember',{...f.input(await f.row(user)),role,department},f.creator.token);
  await configure(dept,'department_admin','academic');await configure(web,'web_admin');await configure(general,'admin');
  await configure(local,'member','academic');await configure(foreign,'member','publicity');
  let row=await f.row(local);
  const deptList=await api('adminMembers',{clubId:f.clubId},dept.token);
  assert.equal(deptList.canViewAudit,false);assert.deepEqual(deptList.events,[]);
  const foreignId=(await f.row(foreign)).id;assert.ok(!deptList.members.some(m=>m.id===foreignId));
  assert.equal(deptList.members.length,2);
  const localEntry=deptList.members.find(m=>m.id===row.id);
  assert.equal(localEntry.canResetPassword,true);assert.equal(localEntry.canEditAccount,false);assert.equal(localEntry.canEditDepartment,false);
  await api('adminEditMember',{...f.input(row),name:'部门内称呼'},dept.token);
  row=await f.row(local);
  for(const [user,patch,token] of [[local,{username:'dept_cannot_rename'},dept.token],[local,{department:'publicity'},dept.token],[foreign,{name:'禁止跨部门'},dept.token],[web,{name:'禁止管理另一类管理员'},dept.token],[dept,{name:'禁止同级管理'},web.token],[local,{name:'网页管理不能改称呼'},web.token],[local,{role:'admin'},general.token]]){
    assert.equal((await post('/api',{action:'adminEditMember',input:{...f.input(await f.row(user)),...patch}},token)).status,403);
  }
  await api('adminEditMember',{...f.input(row),username:'scoped_new_login'},web.token);local.user.username='scoped_new_login';
  const reset=await api('adminResetPassword',f.input(await f.row(local)),dept.token);
  await configure(local,'member','publicity');
  assert.equal((await post('/auth/recover',{username:'scoped_new_login',password,resetToken:reset.resetToken})).status,401);
  const webList=await api('adminMembers',{clubId:f.clubId},web.token);assert.equal(webList.canViewAudit,true);assert.ok(webList.events.length);
  await api('adminEditMember',{...f.input(await f.row(foreign)),role:'department_admin'},general.token);
  const publicBoard=await api('bootstrap',{clubId:f.clubId},local.token);
  assert.ok(publicBoard.members.every(m=>['member','admin'].includes(m.role)));
  assert.equal(publicBoard.me.role,'member');
  const ownBoard=await api('bootstrap',{clubId:f.clubId},dept.token);assert.equal(ownBoard.me.role,'department_admin');
});

test('department template rules and following assignees persist through the actual Worker and SQLite restart',async()=>{
  const invites=await api('getInvite',{clubId});
  const token=invites.departments.find(d=>d.id==='publicity').token;
  await api('joinClub',{token,nickname:'owner'});
  const fields={title:'部门分工',description:'',mode:'individual',priority:'normal',participantIds:[]};
  const {template}=await api('createTemplate',{...fields,clubId,requestId:'department-template-runtime',name:'部门模板',category:'测试',participantDepartment:'publicity',steps:[{...fields,title:'跟随负责人',daysBefore:1,followMain:true}]});
  // A member joins after the template was saved; the server uses today's roster.
  await api('joinClub',{token,nickname:'alice'},alice.token);
  const {tasks}=await api('createTaskGroup',{...template,clubId,requestId:'department-group-runtime',dueAt:Date.now()+5*86400000,subtasks:template.steps.map(s=>({...s,participantIds:['forged-id']}))});
  assert.equal(tasks[0].participantIds.length,2);
  assert.deepEqual(tasks[1].participantIds,tasks[0].participantIds);
  await mf.dispose(); mf=new Miniflare(options);
  const board=await api('bootstrap',{clubId});
  const saved=board.templates.find(t=>t._id===template._id);
  assert.equal(saved.participantDepartment,'publicity'); assert.equal(saved.steps[0].followMain,true);
  assert.deepEqual(board.tasks.find(t=>t._id===tasks[1]._id).participantIds,tasks[0].participantIds);
  assert.ok(tasks.every(t=>!('followMain' in t)&&!('participantDepartment' in t)));
});

test('optional duration, automatic deadlines and later manual overrides survive SQLite restart and sync',async()=>{
  const startsAt=Date.now()+4*86400000, endsAt=startsAt+2*3600000;
  const created=await api('createTask',{clubId,requestId:'duration-worker',title:'定时活动',description:'',mode:'individual',priority:'normal',participantIds:memberIds,startsAt,endsAt});
  assert.equal(created.task.dueAt,startsAt); assert.equal(created.task.deadlineFollowsStart,true);
  await mf.dispose(); mf=new Miniflare(options);
  const board=await api('bootstrap',{clubId}), t=board.tasks.find(t=>t._id===created.taskId);
  assert.equal(t.startsAt,startsAt); assert.equal(t.endsAt,endsAt);
  const override=await api('editTask',{...t,taskId:t._id,dueAt:startsAt-86400000,deadlineFollowsStart:false});
  const shifted=await api('editTask',{...override.task,taskId:t._id,startsAt:startsAt+3600000});
  assert.equal(shifted.task.dueAt,startsAt-86400000);
  const delta=await api('sync',{clubId,since:board.version});
  assert.equal(delta.tasks[0].startsAt,startsAt+3600000); assert.equal(delta.tasks[0].deadlineFollowsStart,false);
  assert.equal((await post('/api',{action:'createTask',input:{...t,requestId:'duration-child-worker',parentTaskId:t._id}},owner.token)).status,400);
  const removed=await api('editTask',{...shifted.task,taskId:t._id,startsAt:null,endsAt:null});
  assert.equal(removed.task.startsAt,null); assert.equal(removed.task.dueAt,startsAt-86400000);
});

test('template default duration survives SQLite restart, delta sync, copying and explicit removal',async()=>{
  const before=await api('bootstrap',{clubId});
  const base=before.templates[0];
  const {template}=await api('createTemplate',{...base,clubId,requestId:'template-duration-runtime',name:'默认150分钟',durationMinutes:150});
  await mf.dispose(); mf=new Miniflare(options);
  const delta=await api('sync',{clubId,since:before.version});
  assert.equal(delta.templates.find(t=>t._id===template._id).durationMinutes,150);
  const copy=await api('createTemplate',{...template,requestId:'template-duration-runtime-copy'});
  assert.equal(copy.template.durationMinutes,150);
  assert.equal((await post('/api',{action:'editTemplate',input:{...template,templateId:template._id,durationMinutes:0}},owner.token)).status,400);
  const cleared=await api('editTemplate',{...template,templateId:template._id,durationMinutes:null});
  assert.equal(cleared.template.durationMinutes,null);
});
