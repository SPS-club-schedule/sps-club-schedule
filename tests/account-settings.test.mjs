import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
let mf, options, directory;
const password='Account-settings-test-2026!', newPassword='Updated-account-password-2026!';
async function post(route,data,token) {
  const response=await mf.dispatchFetch('http://localhost'+route,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://site.test',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data)});
  return {status:response.status,...await response.json()};
}
async function api(action,input,token) {
  const response=await post('/api',{action,input},token);
  assert.equal(response.status,200,JSON.stringify(response)); return response.data;
}
const attempt=(action,input,token)=>post('/api',{action,input},token);
const read=async account=>(await api('accountSettings',{},account.token)).account;
async function register(username,invite) {
  const response=await post('/auth/register',{username,password,nickname:username,mode:invite?'join':'create',name:'Account settings',invite});
  assert.equal(response.status,200,JSON.stringify(response)); return response.data;
}
async function fixture(prefix) {
  const owner=await register(prefix+'_owner'),clubId=owner.clubId;
  const invite=(await api('getInvite',{clubId},owner.token)).token;
  const member=await register(prefix+'_member',invite);
  const adminRow=async account=>(await api('adminMembers',{clubId},owner.token)).members.find(m=>m.username===account.user.username);
  const adminInput=target=>({clubId,memberId:target.id,memberVersion:target.syncVersion,accountRevision:target.accountRevision,adminPassword:password});
  return {owner,member,clubId,invite,adminRow,adminInput};
}
before(async()=>{
  const result=await build({entryPoints:['server/worker.mjs'],bundle:true,format:'esm',platform:'neutral',external:['cloudflare:workers','node:*'],write:false});
  directory=await mkdtemp(path.join(tmpdir(),'sps-account-settings-'));
  options=convertV4MiniflareOptions({modules:[{type:'ESModule',path:'worker.mjs',contents:result.outputFiles[0].text}],compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],durableObjects:{CLUB_SERVICE:{className:'ClubService',useSQLite:true}},durableObjectsPersist:directory,bindings:{ALLOWED_ORIGINS:'https://site.test',REGISTRATION_OPEN:'true'}});
  options.resourcePersistencePath=directory; mf=new Miniflare(options);
});
after(async()=>{await mf?.dispose(); if(directory) await rm(directory,{recursive:true,force:true});});

test('all authenticated members can manage only their own account, independent of club privileges',async()=>{
  const f=await fixture('self');
  for(const action of ['accountSettings','accountChangeUsername','accountChangePassword']) assert.equal((await attempt(action,{})).status,401);
  const info=await api('accountSettings',{accountId:f.owner.user.id,identity:f.owner.user.id},f.member.token);
  assert.equal(info.account.username,f.member.user.username);
  assert.deepEqual(Object.keys(info.account).sort(),['createdAt','revision','username']);
  assert.ok(!JSON.stringify(info).includes(f.member.recoveryCode));
  const result=await api('accountChangeUsername',{revision:info.account.revision,username:'self_new',currentPassword:password,accountId:f.owner.user.id,identity:f.owner.user.id,role:'owner'},f.member.token);
  assert.equal(result.currentUser.id,f.member.user.id); assert.equal(result.account.username,'self_new');
  assert.equal((await read(f.owner)).username,f.owner.user.username);
  assert.equal((await api('bootstrap',{clubId:f.clubId},f.member.token)).me.role,'member');
  assert.equal((await attempt('adminMembers',{clubId:f.clubId},f.member.token)).status,403);
});

test('username changes validate passwords, uniqueness and stale revisions without partial updates',async()=>{
  const f=await fixture('rename'), info=await read(f.member), input={revision:info.revision,currentPassword:password,username:'RENAMED_ACCOUNT'};
  for(const currentPassword of [undefined,'incorrect-password!']) assert.equal((await attempt('accountChangeUsername',{...input,currentPassword},f.member.token)).status,403);
  assert.equal((await attempt('accountChangeUsername',{...input,username:'bad name'},f.member.token)).status,400);
  assert.equal((await attempt('accountChangeUsername',{...input,username:f.owner.user.username.toUpperCase()},f.member.token)).status,409);
  assert.deepEqual(await read(f.member),info);
  const target=await f.adminRow(f.member),reset=await api('adminResetPassword',f.adminInput(target),f.owner.token);
  const otherLogin=await post('/auth/login',{username:f.member.user.username,password}); assert.equal(otherLogin.status,200);
  const before=await api('bootstrap',{clubId:f.clubId},f.member.token);
  const result=await api('accountChangeUsername',input,f.member.token);
  assert.equal(result.account.username,'renamed_account'); assert.equal(result.account.revision,info.revision+1);
  assert.equal((await post('/auth/login',{username:f.member.user.username,password})).status,401);
  assert.equal((await post('/auth/login',{username:'RENAMED_ACCOUNT',password})).status,200);
  const other=await api('bootstrap',{clubId:f.clubId},otherLogin.data.token);
  assert.equal(other.currentUser.username,'renamed_account'); assert.deepEqual(other.members,before.members);
  assert.equal((await attempt('accountChangeUsername',{...input,username:'stale_rename'},f.member.token)).status,409);
  assert.equal((await attempt('adminDeleteAccount',f.adminInput(target),f.owner.token)).status,409);
  assert.equal((await post('/auth/recover',{username:'renamed_account',password:newPassword,resetToken:reset.resetToken})).status,401);
  const same=await api('accountChangeUsername',{revision:result.account.revision,username:'RENAMED_ACCOUNT',currentPassword:password},f.member.token);
  assert.equal(same.account.revision,result.account.revision);
  assert.equal((await post('/auth/recover',{username:'renamed_account',password:newPassword,recoveryCode:f.member.recoveryCode})).status,200);
});

test('password changes retain the current session, revoke others and rotate recovery credentials',async()=>{
  const f=await fixture('password'),info=await read(f.member),target=await f.adminRow(f.member);
  const reset=await api('adminResetPassword',f.adminInput(target),f.owner.token);
  const other=await post('/auth/login',{username:f.member.user.username,password}); assert.equal(other.status,200);
  const before=await api('bootstrap',{clubId:f.clubId},f.member.token);
  const input={revision:info.revision,currentPassword:password,newPassword};
  for(const invalid of [{currentPassword:'incorrect-password!'},{newPassword:'short'},{newPassword:password}]) {
    assert.equal((await attempt('accountChangePassword',{...input,...invalid},f.member.token)).status,invalid.currentPassword?403:400);
  }
  assert.deepEqual(await read(f.member),info);
  assert.equal((await api('accountSettings',{},other.data.token)).account.revision,info.revision);
  const changed=await api('accountChangePassword',input,f.member.token);
  assert.equal(changed.account.revision,info.revision+1); assert.notEqual(changed.recoveryCode,f.member.recoveryCode);
  assert.equal((await attempt('accountSettings',{},other.data.token)).status,401);
  const after=await api('bootstrap',{clubId:f.clubId},f.member.token);
  assert.deepEqual(after,before);
  assert.equal((await post('/auth/login',{username:f.member.user.username,password})).status,401);
  assert.equal((await post('/auth/login',{username:f.member.user.username,password:newPassword})).status,200);
  for(const credential of [{resetToken:reset.resetToken},{recoveryCode:f.member.recoveryCode}]) assert.equal((await post('/auth/recover',{username:f.member.user.username,password,...credential})).status,401);
  assert.equal((await read(f.owner)).username,f.owner.user.username);
  await mf.dispose(); mf=new Miniflare(options);
  assert.equal((await read(f.member)).revision,changed.account.revision);
  assert.equal((await attempt('accountSettings',{},other.data.token)).status,401);
  assert.equal((await post('/auth/recover',{username:f.member.user.username,password,recoveryCode:changed.recoveryCode})).status,200);
  assert.equal((await attempt('accountSettings',{},f.member.token)).status,401);
});

test('multi-club members can change their own credentials without changing memberships or tasks',async()=>{
  const f=await fixture('multiself'),before=await api('bootstrap',{clubId:f.clubId},f.member.token);
  const otherClub=(await api('createClub',{requestId:'settings-other-club',name:'Second club',nickname:'Same person'},f.member.token)).clubId;
  const second=await api('bootstrap',{clubId:otherClub},f.member.token);
  const {taskId}=await api('createTask',{clubId:f.clubId,requestId:'settings-task',title:'Keep my work',description:'',priority:'normal',mode:'individual',participantIds:[before.me.id],dueAt:Date.now()+86400000},f.member.token);
  await api('complete',{taskId,done:true},f.member.token);
  const history=await api('bootstrap',{clubId:f.clubId},f.member.token);
  const changed=await api('accountChangeUsername',{revision:(await read(f.member)).revision,username:'multiself_new',currentPassword:password},f.member.token);
  await api('accountChangePassword',{revision:changed.account.revision,currentPassword:password,newPassword},f.member.token);
  const final=await api('bootstrap',{clubId:f.clubId},f.member.token);
  assert.deepEqual(final.me,history.me); assert.deepEqual(final.tasks,history.tasks); assert.equal(final.clubs.length,2);
  assert.deepEqual((await api('bootstrap',{clubId:otherClub},f.member.token)).me,second.me);
});

test('self-service password changes invalidate reset links issued by that administrator',async()=>{
  const f=await fixture('issuedself'), target=await f.adminRow(f.member);
  const reset=await api('adminResetPassword',f.adminInput(target),f.owner.token);
  await api('accountChangePassword',{revision:(await read(f.owner)).revision,currentPassword:password,newPassword},f.owner.token);
  assert.equal((await post('/auth/recover',{username:f.member.user.username,password:newPassword,resetToken:reset.resetToken})).status,401);
  assert.equal((await read(f.member)).revision,1);
});

test('admin edits and simultaneous self-service writes cannot overwrite newer account versions',async()=>{
  const f=await fixture('conflicts'),old=await read(f.member),target=await f.adminRow(f.member);
  await api('adminEditMember',{...f.adminInput(target),name:target.name,role:target.role,username:'admin_renamed'},f.owner.token);
  assert.equal((await attempt('accountChangePassword',{revision:old.revision,currentPassword:password,newPassword},f.member.token)).status,409);
  const revision=(await read(f.member)).revision;
  const results=await Promise.all(['first_self','second_self'].map(username=>attempt('accountChangeUsername',{revision,currentPassword:password,username},f.member.token)));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal((await read(f.member)).revision,revision+1);
});

test('incorrect self-service password attempts stay throttled after transaction rollback',async()=>{
  const f=await fixture('selflimit'),info=await read(f.member);
  const input={revision:info.revision,username:'must_not_change',currentPassword:'incorrect-password!'};
  for(let i=0;i<10;i++) assert.equal((await attempt('accountChangeUsername',input,f.member.token)).status,403);
  assert.equal((await attempt('accountChangePassword',{revision:info.revision,currentPassword:password,newPassword},f.member.token)).status,429);
  assert.deepEqual(await read(f.member),info);
});
