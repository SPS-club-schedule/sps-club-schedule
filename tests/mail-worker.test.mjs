import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('Worker enforces email onboarding, privately verifies email, persists outbox, runs cron and guards internal delivery',{timeout:60000},async()=>{
  const bundle=await build({entryPoints:['server/worker.mjs'],bundle:true,format:'esm',platform:'neutral',external:['cloudflare:workers','node:*'],write:false});
  const directory=await mkdtemp(join(tmpdir(),'sps-email-worker-')),sent=[];let mf;
  const bindings={ALLOWED_ORIGINS:'https://site.test',REGISTRATION_OPEN:'true',EMAIL_NOTIFICATIONS_ENABLED:'true',RESEND_API_KEY:'test-only-key'};
  const options=()=>{const o=convertV4MiniflareOptions({name:'email-tests',modules:[{type:'ESModule',path:'worker.mjs',contents:bundle.outputFiles[0].text}],compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],durableObjects:{CLUB_SERVICE:{className:'ClubService',useSQLite:true}},durableObjectsPersist:directory,bindings,outboundService:async request=>{
    assert.equal(request.url,'https://api.resend.com/emails');assert.equal(request.headers.get('authorization'),'Bearer test-only-key');assert.ok(request.headers.get('Idempotency-Key')?.startsWith('sps/'));
    sent.push(await request.json());return Response.json({id:'test-provider-'+sent.length});
  }});o.resourcePersistencePath=directory;o.unsafeInspectDurableObjects=true;return o;};
  const post=async(path,data,token)=>{const r=await mf.dispatchFetch('http://localhost'+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://site.test',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data)});return {status:r.status,...await r.json()};};
  const api=async(action,input,token)=>{const r=await post('/api',{action,input},token);assert.equal(r.status,200,JSON.stringify(r));return r.data;};
  const attempt=(action,input,token)=>post('/api',{action,input},token);
  const wait=async predicate=>{const end=Date.now()+12000;while(!await predicate()){if(Date.now()>end)throw new Error('Mail timed out');await new Promise(r=>setTimeout(r,50));}};
  const register=(username,extra={})=>post('/auth/register',{username,email:username+'@example.test',password:'Email-test-password!',nickname:username,mode:'create',name:'Email tests',...extra});
  const db=()=>mf.unsafeGetDurableObjectStorage('email-tests','ClubService',{name:'sps-club-service-v1'});
  const code=address=>sent.find(x=>x.to[0]===address&&x.subject.includes('验证码'))?.subject.match(/\d{6}/)[0];
  try{
    mf=new Miniflare(options());
    for(const email of [undefined,'invalid','a@b.com\r\nX: 1'])assert.equal((await register('invalid_mail',{email})).status,400);
    const owner=(await register('email_owner')).data;assert.equal(owner.user.emailVerified,false);assert.equal(owner.user.email,'email_owner@example.test');
    const clubId=owner.clubId,invite=(await api('getInvite',{clubId},owner.token)).token;
    const member=(await register('email_member',{mode:'join',invite})).data;
    await wait(()=>code(owner.user.email)&&code(member.user.email));
    assert.equal((await attempt('accountVerifyEmail',{code:'000000',revision:1},owner.token)).status,400);
    const info=(await api('accountSettings',{},owner.token)).account;
    const verified=await api('accountVerifyEmail',{revision:info.revision,code:code(owner.user.email),accountId:member.user.id},owner.token);
    assert.equal(verified.currentUser.emailVerified,true);assert.equal(verified.account.revision,info.revision+1);assert.equal((await api('accountSettings',{},member.token)).account.emailVerified,false);
    assert.equal((await attempt('accountRequestEmail',{revision:verified.account.revision,email:'bad@example.test',currentPassword:'Wrong-password!'},owner.token)).status,403);
    assert.equal((await attempt('accountVerifyEmail',{revision:info.revision,code:code(owner.user.email)},owner.token)).status,409);
    const board=await api('bootstrap',{clubId},member.token);assert.ok(!JSON.stringify(board).includes(owner.user.email));
    const admin=await api('adminMembers',{clubId},owner.token);assert.ok(!JSON.stringify(admin.members).includes(member.user.email));
    assert.equal((await post('/internal/mail-tick',{},owner.token)).status,404);assert.equal((await attempt('accountVerifyEmail',{})).status,401);
    const ownerBoard=await api('bootstrap',{clubId},owner.token);
    const memberAccount=(await api('accountSettings',{},member.token)).account;
    await api('accountVerifyEmail',{revision:memberAccount.revision,code:code(member.user.email)},member.token);
    const fields={mode:'individual',priority:'normal',daysBefore:0,participantIds:[]};
    const input={...fields,clubId,requestId:'assignment-digest-group',title:'邮件流程',participantIds:[ownerBoard.me.id],dueAt:Date.now()+3*86400000,
      roles:[{id:'poster',name:'海报负责人',participantIds:[board.me.id]},{id:'host',name:'主持人',participantIds:[board.me.id,ownerBoard.me.id]}],
      subtasks:[{...fields,id:'poster-task',title:'制作海报',roleIds:['poster','host']},{...fields,id:'host-task',title:'活动主持',roleId:'host'}],
      actorId:member.user.id};
    const task=await api('createTaskGroup',input,owner.token);
    await api('createTaskGroup',input,owner.token);
    const storage=await db();
    const jobs=await storage.exec("SELECT id,account_id,created_at,next_attempt FROM email_outbox WHERE kind IN ('assigned','assignment_list')");
    assert.equal(jobs.length,1);
    assert.equal(jobs[0].account_id,member.user.id);
    assert.ok(Math.abs(jobs[0].next_attempt-jobs[0].created_at-60_000)<1000);
    // Make the local digest eligible for the scheduled worker without sleeping for a minute.
    await storage.exec('UPDATE email_outbox SET next_attempt=0 WHERE id=?',jobs[0].id);
    await (await mf.getWorker()).scheduled({cron:'* * * * *',scheduledTime:Date.now()});
    await wait(()=>sent.some(x=>x.subject.includes('负责人')));
    const assignments=sent.filter(x=>x.subject.includes('负责人'));
    assert.equal(assignments.length,1);
    assert.deepEqual(assignments[0].to,[member.user.email]);
    assert.match(assignments[0].text,/以下 2 项/);
    for(const child of task.tasks.slice(1))assert.ok(assignments[0].text.includes('#/task?id='+child._id+'&club='+clubId));
    // Root and both children now share a deadline. Each person gets just their own list.
    const past=Date.now()-1;
    await storage.exec("UPDATE records SET data=json_set(data,'$.dueAt',?) WHERE collection='tasks' AND (id=? OR json_extract(data,'$.parentTaskId')=?)",past,task.taskId,task.taskId);
    await (await mf.getWorker()).scheduled({cron:'* * * * *',scheduledTime:Date.now()});
    await wait(()=>sent.filter(x=>x.subject.includes('到期')).length===2);
    for (const [account, id] of [[owner,ownerBoard.me.id],[member,board.me.id]]) {
      const notices = sent.filter(x=>x.subject.includes('到期') && x.to[0]===account.user.email);
      assert.equal(notices.length,1);
      for (const item of task.tasks) assert.equal(notices[0].text.includes('#/task?id='+item._id+'&club='+clubId),item.participantIds.includes(id));
    }
    await (await mf.getWorker()).scheduled({cron:'* * * * *',scheduledTime:Date.now()});
    assert.equal(sent.filter(x=>x.subject.includes('到期')).length,2);
    // An old account has no email record, but can still log in and bind one after password confirmation.
    await storage.exec('DELETE FROM account_emails WHERE account_id=?',member.user.id);
    const legacy=await post('/auth/login',{username:member.user.username,password:'Email-test-password!'});assert.equal(legacy.status,200);assert.equal(legacy.data.user.email,'');
    const legacyInfo=(await api('accountSettings',{},legacy.data.token)).account;
    const requested=await api('accountRequestEmail',{revision:legacyInfo.revision,email:'legacy@example.test',currentPassword:'Email-test-password!'},legacy.data.token);
    assert.equal(requested.account.emailVerified,false);await wait(()=>code('legacy@example.test'));
    await api('accountVerifyEmail',{revision:requested.account.revision,code:code('legacy@example.test')},legacy.data.token);
    await mf.dispose();mf=new Miniflare(options());
    const persisted=await api('accountSettings',{},legacy.data.token);assert.equal(persisted.account.emailVerified,true);assert.equal(persisted.account.email,'legacy@example.test');
    await (await mf.getWorker()).scheduled({cron:'* * * * *',scheduledTime:Date.now()});assert.equal(sent.filter(x=>x.subject.includes('到期')).length,2);
    const limited=(await register('email_limited')).data;
    for(let i=0;i<6;i++)assert.equal((await attempt('accountVerifyEmail',{revision:1,code:'000000'},limited.token)).status,400);
    assert.equal((await attempt('accountVerifyEmail',{revision:1,code:'000000'},limited.token)).status,429);
  }finally{await mf?.dispose();await rm(directory,{recursive:true,force:true});}
});
