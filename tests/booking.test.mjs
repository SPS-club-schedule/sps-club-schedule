import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('durable task sync retries failures, isolates clubs, preserves private data, updates and removes/restores blocks',{timeout:60000},async()=>{
  const bundle=await build({entryPoints:['server/worker.mjs'],bundle:true,format:'esm',platform:'neutral',external:['cloudflare:workers','node:*'],write:false});
  const directory=await mkdtemp(join(tmpdir(),'sps-booking-'));let mf,failNext=true;const sent=[];
  const bindings={ALLOWED_ORIGINS:'https://site.test',REGISTRATION_OPEN:'true',BOOKING_SYNC_KEY:'test-only-sync-key',BOOKING_SYNC_URL:'https://booking.test/api/integrations/sps'};
  const options=()=>{const o=convertV4MiniflareOptions({modules:[{type:'ESModule',path:'worker.mjs',contents:bundle.outputFiles[0].text}],compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],durableObjects:{CLUB_SERVICE:{className:'ClubService',useSQLite:true}},durableObjectsPersist:directory,bindings,outboundService:async request=>{
    assert.equal(request.headers.get('authorization'),'Bearer test-only-sync-key');
    const data=await request.json();if(failNext){failNext=false;return Response.json({error:'offline'},{status:503});}sent.push(data);return Response.json({sourceVersion:data.version});
  }});o.resourcePersistencePath=directory;return o;};
  const post=async(path,data,token)=>{const r=await mf.dispatchFetch('http://localhost'+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://site.test',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data)});return {status:r.status,...await r.json()};};
  const api=async(action,input,token)=>{const r=await post('/api',{action,input},token);assert.equal(r.status,200,JSON.stringify(r));return r.data;};
  const wait=async predicate=>{const end=Date.now()+25000;while(!predicate()){if(Date.now()>end)throw new Error('Sync timed out');await new Promise(r=>setTimeout(r,100));}};
  try{
    mf=new Miniflare(options());
    const owner=(await post('/auth/register',{username:'sync_owner',email:'sync_owner@example.test',password:'Sync-password-2026!',nickname:'PRIVATE NAME',name:'SPS',mode:'create'})).data;
    const outsider=(await post('/auth/register',{username:'sync_other',email:'sync_other@example.test',password:'Sync-password-2026!',nickname:'Other',name:'Other',mode:'create'})).data;
    assert.equal((await mf.dispatchFetch('http://localhost/integrations/booking')).status,404);
    const discovery=await (await mf.dispatchFetch('http://localhost/integrations/booking',{headers:{Authorization:'Bearer test-only-sync-key'}})).json();assert.equal(discovery.clubs.length,2);
    bindings.BOOKING_CLUB_ID=owner.clubId;await mf.setOptions(options());
    const b=await api('bootstrap',{clubId:owner.clubId},owner.token);assert.equal(b.bookingEnabled,true);
    assert.equal((await api('bookingStatus',{clubId:outsider.clubId},outsider.token)).enabled,false);
    assert.equal((await post('/api',{action:'bookingStatus',input:{clubId:owner.clubId}},outsider.token)).status,403);
    const fields={clubId:owner.clubId,title:'Activity',description:'PRIVATE DESCRIPTION',mode:'individual',priority:'normal',participantIds:[b.me.id],startsAt:Date.now()+86400000,endsAt:Date.now()+90000000,deadlineFollowsStart:true};
    const created=await api('createTask',{...fields,requestId:'booking-integration'},owner.token);
    await wait(()=>sent.length===1);assert.equal(sent[0].sourceId,owner.clubId);assert.equal(sent[0].events[0].location,'未定');assert.doesNotMatch(JSON.stringify(sent[0]),/PRIVATE|participant|completions|member/);
    const simple=await api('createSimpleTask',{clubId:owner.clubId,major:'Activity',minor:'Only in calendar',startsAt:fields.startsAt,endsAt:fields.endsAt,participantIds:[b.me.id],requestId:'simple-booking-child'},owner.token);
    assert.equal(simple.task.parentTaskId,created.taskId);
    await wait(()=>sent.at(-1).version>=simple.version);
    assert.deepEqual(sent.at(-1).events.map(e=>e.id),[created.taskId]);
    const ddl=await api('createSimpleTask',{clubId:owner.clubId,major:'Deadline only',minor:'',startsAt:fields.startsAt,endsAt:fields.startsAt,participantIds:[b.me.id],requestId:'simple-booking-ddl'},owner.token);
    await wait(()=>sent.at(-1).version>=ddl.version);
    assert.deepEqual(sent.at(-1).events.map(e=>e.id),[created.taskId]);
    let task=created.task;
    task=(await api('editTask',{...fields,taskId:task._id,revision:task.revision,location:'物理楼 301',endsAt:fields.endsAt+3600000},owner.token)).task;
    await wait(()=>sent.at(-1).events[0]?.location==='物理楼 301');
    const archived=await api('archiveTask',{taskId:task._id},owner.token);await wait(()=>sent.at(-1).events.length===0);
    task=(await api('adminRestoreTask',{clubId:owner.clubId,taskId:task._id,revision:archived.task.revision},owner.token)).task;await wait(()=>sent.at(-1).events.length===1);
    assert.equal(sent.at(-1).events[0].location,'物理楼 301');
    await api('editTask',{...fields,taskId:task._id,revision:task.revision,startsAt:null,endsAt:null,deadlineFollowsStart:false,dueAt:fields.startsAt},owner.token);await wait(()=>sent.at(-1).events.length===0);
    const status=await api('bookingStatus',{clubId:owner.clubId},owner.token);assert.equal(status.sync.delivered,status.sync.desired);assert.equal(status.sync.attempts,0);
    await mf.dispose();mf=new Miniflare(options());const after=await api('bookingStatus',{clubId:owner.clubId},owner.token);assert.equal(after.sync.delivered,status.sync.delivered);
  }finally{await mf?.dispose();await rm(directory,{recursive:true,force:true});}
});

test('booking login checks current SPS membership and consumes a calendar code only once', {timeout:60000}, async()=>{
  const result=await build({entryPoints:['server/worker.mjs'],bundle:true,format:'esm',platform:'neutral',external:['cloudflare:workers','node:*'],write:false});
  const directory=await mkdtemp(join(tmpdir(),'sps-login-'));
  const bindings={ALLOWED_ORIGINS:'https://site.test',REGISTRATION_OPEN:'true',BOOKING_SYNC_KEY:'test-key'};
  function options(){
    const o=convertV4MiniflareOptions({modules:[{type:'ESModule',path:'worker.mjs',contents:result.outputFiles[0].text}],compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],durableObjects:{CLUB_SERVICE:{className:'ClubService',useSQLite:true}},durableObjectsPersist:directory,bindings});
    o.resourcePersistencePath=directory;return o;
  }
  const mf=new Miniflare(options());
  const pass='Test-only-password-2026!';
  const post=async(path,body,token)=>{
    const r=await mf.dispatchFetch('http://localhost'+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://site.test',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
    return {status:r.status,...await r.json()};
  };
  const register=(name,invite)=>post('/auth/register',{username:name,password:pass,nickname:name,email:name+'@example.test',name:'Test club',mode:invite?'join':'create',invite});
  const api=(user,action,input={})=>post('/api',{action,input},user.token);
  const bridge=(body,key='test-key')=>post('/integrations/booking/identity',body,key);
  try {
    const owner=(await register('club_owner')).data, outsider=(await register('other_owner')).data;
    const clubId=owner.clubId, invite=(await api(owner,'getInvite',{clubId})).data.token;
    const member=(await register('club_member',invite)).data;
    bindings.BOOKING_CLUB_ID=clubId;await mf.setOptions(options());
    assert.equal((await bridge({operation:'login',username:'club_owner',password:pass},'bad-key')).status,404);
    assert.equal((await bridge({operation:'login',username:'club_owner',password:'incorrect-password'})).status,401);
    for(const user of [owner,member]) {
      const passwordLogin=await bridge({operation:'login',username:user.user.username,password:pass});
      assert.equal(passwordLogin.data.id,user.user.id);assert.equal(passwordLogin.data.verifiedEmail,'');
      assert.equal(passwordLogin.data.token,undefined);
      const {code}= (await api(user,'bookingEntryCode')).data;
      assert.deepEqual((await bridge({operation:'preview',code})).data,{username:user.user.username});
      assert.equal((await bridge({operation:'redeem',code})).data.id,user.user.id);
      assert.equal((await bridge({operation:'redeem',code})).status,401);
    }
    assert.equal((await api(outsider,'bookingEntryCode',{clubId})).status,403);
    assert.equal((await bridge({operation:'login',username:outsider.user.username,password:pass})).status,403);
    const stale=(await api(member,'bookingEntryCode')).data.code;
    const row=(await api(owner,'adminMembers',{clubId})).data.members.find(m=>m.username===member.user.username);
    assert.equal((await api(owner,'adminEditMember',{clubId,memberId:row.id,memberVersion:row.syncVersion,accountRevision:row.accountRevision,name:row.name,username:row.username,role:'speaker',department:'speaker',adminPassword:pass})).status,200);
    assert.equal((await bridge({operation:'check',id:member.user.id})).status,403);
    assert.equal((await bridge({operation:'redeem',code:stale})).status,403);
    const afterLogout=(await api(owner,'bookingEntryCode')).data.code;
    assert.equal((await post('/auth/logout',{},owner.token)).status,200);
    assert.equal((await bridge({operation:'redeem',code:afterLogout})).status,401);
  } finally {await mf.dispose();await rm(directory,{recursive:true,force:true});}
});
