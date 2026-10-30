import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
let mf, options, directory;
const password = 'Deletion-test-password-2026!';
async function post(route, data, token) {
  const response = await mf.dispatchFetch('http://localhost'+route, { method:'POST', headers:{ 'Content-Type':'application/json', Origin:'https://site.test', ...(token?{ Authorization:'Bearer '+token }:{}) }, body:JSON.stringify(data) });
  return { status:response.status, ...(await response.json()) };
}
async function api(action, input, token) {
  const response=await post('/api',{action,input},token);
  assert.equal(response.status,200,JSON.stringify(response)); return response.data;
}
async function register(username, invite, extra={}) {
  const response=await post('/auth/register',{username,password,nickname:username,mode:invite?'join':'create',name:'Account deletion tests',invite,...extra});
  assert.equal(response.status,200,JSON.stringify(response)); return response.data;
}
async function fixture(prefix) {
  const owner=await register(prefix+'_owner'), clubId=owner.clubId;
  const invite=(await api('getInvite',{clubId},owner.token)).token;
  const member=await register(prefix+'_member',invite);
  const list=()=>api('adminMembers',{clubId},owner.token);
  const row=async account=>(await list()).members.find(m=>m.username===account.user.username);
  const input=target=>({clubId,memberId:target.id,memberVersion:target.syncVersion,accountRevision:target.accountRevision,adminPassword:password});
  const promote=async account=>{
    const target=await row(account);
    return (await api('adminEditMember',{...input(target),name:target.name,role:'admin'},owner.token)).adminMember;
  };
  return {owner,member,clubId,invite,list,row,input,promote};
}
before(async()=>{
  const result=await build({entryPoints:['server/worker.mjs'],bundle:true,format:'esm',platform:'neutral',external:['cloudflare:workers','node:*'],write:false});
  directory=await mkdtemp(path.join(tmpdir(),'sps-account-delete-'));
  options=convertV4MiniflareOptions({modules:[{type:'ESModule',path:'worker.mjs',contents:result.outputFiles[0].text}],compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],durableObjects:{CLUB_SERVICE:{className:'ClubService',useSQLite:true}},durableObjectsPersist:directory,bindings:{ALLOWED_ORIGINS:'https://site.test',REGISTRATION_OPEN:'true'}});
  options.resourcePersistencePath=directory; mf=new Miniflare(options);
});
after(async()=>{ await mf?.dispose(); if(directory) await rm(directory,{recursive:true,force:true}); });

test('deletion protects owners, self and peers, and rejects members and unrelated admins',async()=>{
  const f=await fixture('protect'), target=await f.row(f.member), owner=await f.row(f.owner);
  const outsider=await register('delete_outsider');
  for (const token of [undefined,f.member.token,outsider.token]) {
    const result=await post('/api',{action:'adminDeleteAccount',input:{...f.input(target),identity:f.owner.user.id}},token);
    assert.equal(result.status,token?403:401);
  }
  assert.equal(owner.canDeleteAccount,false);
  assert.equal((await post('/api',{action:'adminDeleteAccount',input:f.input(owner)},f.owner.token)).status,403);
  const promoted=await f.promote(f.member);
  const peer=await register('delete_peer',f.invite), peerRow=await f.promote(peer);
  for(const target of [owner,promoted,peerRow]) {
    assert.equal((await post('/api',{action:'adminDeleteAccount',input:f.input(target)},f.member.token)).status,403);
  }
  const adminList=await api('adminMembers',{clubId:f.clubId},f.member.token);
  assert.ok(adminList.members.every(m=>!m.canDeleteAccount));
  assert.equal((await f.row(f.member)).canDeleteAccount,true);
  assert.equal((await f.list()).members.length,3);
});

test('deletion requires the admin password and current member and account versions',async()=>{
  const f=await fixture('versions'), original=await f.row(f.member);
  const before=await api('bootstrap',{clubId:f.clubId},f.owner.token);
  for(const adminPassword of [undefined,'incorrect-password!']) {
    assert.equal((await post('/api',{action:'adminDeleteAccount',input:{...f.input(original),adminPassword}},f.owner.token)).status,403);
  }
  assert.equal((await api('bootstrap',{clubId:f.clubId},f.member.token)).version,before.version);
  assert.equal((await f.list()).events.length,0);
  const changed=(await api('adminEditMember',{...f.input(original),name:'Changed name',role:'member'},f.owner.token)).adminMember;
  assert.equal((await post('/api',{action:'adminDeleteAccount',input:f.input(original)},f.owner.token)).status,409);
  const recovered=await post('/auth/recover',{username:f.member.user.username,password,recoveryCode:f.member.recoveryCode});
  assert.equal(recovered.status,200);
  assert.equal((await post('/api',{action:'adminDeleteAccount',input:f.input(changed)},f.owner.token)).status,409);
  assert.equal((await api('bootstrap',{clubId:f.clubId},recovered.data.token)).me.name,'Changed name');
  assert.ok(!(await f.list()).events.some(event=>event.action==='delete'));
});

test('an admin deletes a member atomically, revokes credentials and preserves task history',async()=>{
  const f=await fixture('history'), target=await f.row(f.member);
  const admin=await register('history_admin',f.invite); await f.promote(admin);
  const login=await post('/auth/login',{username:f.member.user.username,password}); assert.equal(login.status,200);
  const reset=await api('adminResetPassword',f.input(target),admin.token);
  const fields={clubId:f.clubId,title:'Keep historical work',description:'History',priority:'normal',mode:'individual',participantIds:[target.id],dueAt:Date.now()+86400000};
  const {taskId}=await api('createTask',{...fields,requestId:'delete-history-task'},f.member.token);
  await api('complete',{taskId,done:true},f.member.token);
  await api('createTask',{...fields,requestId:'delete-pending-task'},f.owner.token);
  await api('createTemplate',{...fields,requestId:'delete-history-template',name:'Keep template',category:'Tests',steps:[{...fields,title:'Child',daysBefore:0}]},f.member.token);
  const before=await api('bootstrap',{clubId:f.clubId},f.owner.token);
  const removed=await api('adminDeleteAccount',f.input(target),admin.token);
  assert.equal(removed.baseVersion,before.version); assert.equal(removed.version,before.version+1);
  assert.deepEqual(removed.member,{id:target.id,archived:true,syncVersion:removed.version});
  const delta=await api('sync',{clubId:f.clubId,since:before.version,memberTombstones:true},f.owner.token);
  assert.deepEqual(delta.members,[removed.member]); assert.deepEqual(delta.tasks,[]);
  const legacy=await api('sync',{clubId:f.clubId,since:before.version},f.owner.token);
  assert.equal(legacy.full,true); assert.ok(legacy.members.every(m=>m.id!==target.id && m.name));
  const after=await api('bootstrap',{clubId:f.clubId},f.owner.token);
  assert.ok(!after.members.some(m=>m.id===target.id));
  assert.deepEqual(after.tasks,before.tasks); assert.deepEqual(after.templates,before.templates);
  assert.ok(!(await f.list()).members.some(m=>m.id===target.id));
  assert.equal((await f.list()).events[0].action,'delete');
  for(const token of [f.member.token,login.data.token]) assert.equal((await post('/api',{action:'bootstrap',input:{clubId:f.clubId}},token)).status,401);
  assert.equal((await post('/auth/login',{username:f.member.user.username,password})).status,401);
  for(const credential of [{recoveryCode:f.member.recoveryCode},{resetToken:reset.resetToken}]) assert.equal((await post('/auth/recover',{username:f.member.user.username,password,...credential})).status,401);
  assert.equal((await post('/api',{action:'createTask',input:{...fields,requestId:'deleted-member-assignment'}},f.owner.token)).status,400);
  assert.equal((await post('/api',{action:'createTemplate',input:{...fields,requestId:'deleted-member-template',name:'Invalid',steps:[{...fields,daysBefore:0}]}},f.owner.token)).status,400);
  assert.equal((await post('/api',{action:'adminDeleteAccount',input:f.input(target)},admin.token)).status,404);
  const replacement=await register(f.member.user.username,f.invite,{password:'A-different-password-2026!'});
  assert.notEqual(replacement.user.id,f.member.user.id);
  const replacementBoard=await api('bootstrap',{clubId:f.clubId},replacement.token);
  assert.notEqual(replacementBoard.me.id,target.id);
  assert.ok(replacementBoard.tasks.every(t=>!t.participantIds.includes(replacementBoard.me.id)));
  assert.equal((await post('/api',{action:'complete',input:{taskId,done:false}},replacement.token)).status,403);
  for(const credential of [{recoveryCode:f.member.recoveryCode},{resetToken:reset.resetToken}]) assert.equal((await post('/auth/recover',{username:f.member.user.username,password,...credential})).status,401);
});

test('deleting an admin also revokes the password reset links that admin issued',async()=>{
  const f=await fixture('issuer'); await f.promote(f.member);
  const recipient=await register('issuer_recipient',f.invite), recipientRow=await f.row(recipient);
  const reset=await api('adminResetPassword',f.input(recipientRow),f.member.token);
  await api('adminDeleteAccount',f.input(await f.row(f.member)),f.owner.token);
  assert.equal((await post('/auth/recover',{username:recipient.user.username,password,resetToken:reset.resetToken})).status,401);
  assert.equal((await post('/api',{action:'adminMembers',input:{clubId:f.clubId}},f.member.token)).status,401);
  assert.equal((await post('/auth/login',{username:recipient.user.username,password})).status,200);
});

test('joining another club after opening the editor prevents cross-club account deletion',async()=>{
  const f=await fixture('multiple'), target=await f.row(f.member);
  assert.equal(target.canDeleteAccount,true);
  const {clubId:otherClub}=await api('createClub',{requestId:'other-club-delete',name:'Other club',nickname:'Creator elsewhere'},f.member.token);
  assert.equal((await post('/api',{action:'adminDeleteAccount',input:f.input(target)},f.owner.token)).status,403);
  const current=await f.row(f.member); assert.equal(current.canDeleteAccount,false); assert.match(current.deleteAccountRestriction,/其他社团/);
  assert.equal((await api('bootstrap',{clubId:otherClub},f.member.token)).me.role,'owner');
  assert.equal((await f.list()).events.length,0);
});

test('account deletion and revoked sessions remain effective after a runtime restart',async()=>{
  const f=await fixture('persist'), target=await f.row(f.member);
  const before=await api('bootstrap',{clubId:f.clubId},f.owner.token);
  await api('adminDeleteAccount',f.input(target),f.owner.token);
  await mf.dispose(); mf=new Miniflare(options);
  const delta=await api('sync',{clubId:f.clubId,since:before.version,memberTombstones:true},f.owner.token);
  assert.equal(delta.members[0].archived,true);
  assert.equal((await post('/api',{action:'bootstrap',input:{}},f.member.token)).status,401);
  assert.equal((await post('/auth/login',{username:f.member.user.username,password})).status,401);
  assert.equal((await f.list()).events[0].action,'delete');
});

test('incorrect deletion passwords are throttled without removing the target',async()=>{
  const f=await fixture('delete_limit'), target=await f.row(f.member);
  for(let i=0;i<10;i++) assert.equal((await post('/api',{action:'adminDeleteAccount',input:{...f.input(target),adminPassword:'incorrect-password!'}},f.owner.token)).status,403);
  assert.equal((await post('/api',{action:'adminDeleteAccount',input:f.input(target)},f.owner.token)).status,429);
  assert.equal((await api('bootstrap',{clubId:f.clubId},f.member.token)).me.id,target.id);
  assert.equal((await f.list()).events.length,0);
});
