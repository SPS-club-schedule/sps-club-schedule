import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
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
  options={ modules:[{type:'ESModule',path:'worker.mjs',contents:result.outputFiles[0].text}], compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],durableObjects:{CLUB_SERVICE:{className:'ClubService',useSQLite:true}},durableObjectsPersist:directory,bindings:{ALLOWED_ORIGINS:'https://site.test',REGISTRATION_OPEN:'true'} };
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
