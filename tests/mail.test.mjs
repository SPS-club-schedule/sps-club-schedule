import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createStore} from '../server/store.mjs';
import {createMailService,taskDone} from '../server/mail.mjs';
import email from '../shared/email.js';
const DAY=86400000, START=Date.parse('2026-11-04T00:00:00Z');
async function fixture({daily=1000}={}) {
  const db=new DatabaseSync(':memory:');let time=START;
  const sql={exec(query,...params){if(!params.length){db.exec(query);return {toArray:()=>[]};}const result=db.prepare(query).all(...params);return {toArray:()=>result};}};
  const storage={sql,async transaction(fn){db.exec('BEGIN');try{const result=await fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}};
  const store=createStore(storage);sql.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY,username TEXT)');
  const sent=[];let responder=()=>Response.json({id:'provider-'+sent.length});
  const env={RESEND_API_KEY:'test-key-never-real',EMAIL_NOTIFICATIONS_ENABLED:'true',EMAIL_DAILY_LIMIT:String(daily)};
  const make=()=>createMailService({sql,store,env,now:()=>time,codeGenerator:()=> '123456',fetcher:async(url,options)=>{sent.push({url,...options,body:JSON.parse(options.body)});return responder();}});
  let mail=make();
  const rows=(query,...args)=>db.prepare(query).all(...args), jobs=()=>rows('SELECT * FROM email_outbox WHERE kind<>?','verify');
  async function person(id,{department='academic',role='member',clubId='club',verified=true}={}) {
    sql.exec('INSERT INTO accounts VALUES(?,?)',id,id);await store.put('members','m_'+id,{identity:id,name:id,department,role,clubId});
    mail.requestVerification(id,id+'@example.test');if(verified)mail.verify(id,'123456');return 'm_'+id;
  }
  async function task(id,extra={}) {const t={_id:id,clubId:'club',title:id,mode:'individual',participantIds:['m_alice'],dueAt:time+2*DAY,completions:{},syncVersion:1,...extra};await store.put('tasks',id,t);return t;}
  async function assign(t,before=null,action='createTask'){await mail.changed(before,{baseVersion:0,version:t.syncVersion,task:t},action);}
  async function drain(){for(let i=0;i<200;i++){const job=await mail.prepare();if(!job)return;if(job.wait){time+=job.wait;continue;}mail.finish(job,await mail.transmit(job));}throw Error('queue did not drain');}
  await store.put('clubs','club',{name:'SPS'});
  return {db,sql,store,env,sent,person,task,assign,drain,rows,jobs,get mail(){return mail;},setTime:v=>{time=v;},advance:v=>{time+=v;},respond:fn=>{responder=fn;},restart:()=>{mail=make();}};
}

test('email input rejects header injection and malformed addresses, normalizes domain',()=>{
  assert.equal(email.normalizeEmail(' Member+club@EXAMPLE.COM '),'Member+club@example.com');
  for(const value of [undefined,'','name','a@b','a..b@example.com','a@-bad.com','a@b.com\r\nBcc:evil@b.com','a@b@c.com'])assert.throws(()=>email.normalizeEmail(value));
});

test('registration verification waits for proof; codes expire and changing addresses revokes old proof',async()=>{
  const f=await fixture();await f.person('alice',{verified:false});
  const t=await f.task('assigned');await f.assign(t);await f.drain();
  assert.equal(f.sent.length,1);assert.match(f.sent[0].body.subject,/验证码/);assert.equal(f.mail.info('alice').emailVerified,false);
  assert.throws(()=>f.mail.verify('alice','000000'),/验证码/);assert.throws(()=>f.mail.requestVerification('alice','other@example.test'),/一分钟/);
  f.mail.verify('alice','123456');f.advance(60000);await f.drain();assert.equal(f.sent.length,2);assert.match(f.sent[1].body.subject,/负责人/);
  f.mail.requestVerification('alice','other@example.test');assert.equal(f.mail.info('alice').emailVerified,false);
  f.advance(16*60000);assert.throws(()=>f.mail.verify('alice','123456'),/过期/);await f.drain();assert.equal(f.sent.length,2);
});

test('assignment notifications dedupe mutation retries, include every new assignee, skip guests and stale recipients',async()=>{
  const f=await fixture();await f.person('alice');await f.person('bob');
  const t=await f.task('work',{guestParticipants:[{id:'g1',name:'Guest'}]});await f.assign(t);await f.assign(t);
  assert.equal(f.jobs().length,1);
  await f.mail.changed(null,{baseVersion:1,version:1,task:t},'createTask');assert.equal(f.jobs().length,1);
  const next=await f.task('work',{...t,participantIds:['m_bob'],syncVersion:2});await f.assign(next,t,'editTask');
  await f.drain();assert.equal(f.sent.length,1);assert.deepEqual(f.sent[0].body.to,['bob@example.test']);assert.equal(f.jobs().find(j=>j.account_id==='alice').state,'cancelled');
  const later={...next,title:'renamed',syncVersion:3};await f.assign(later,next,'editTask');assert.equal(f.jobs().length,2);
});

test('task group queues each main and child assignment atomically',async()=>{
  const f=await fixture();await f.person('alice');const a=await f.task('main'),b=await f.task('child',{parentTaskId:'main'});
  await f.mail.changed(null,{baseVersion:0,version:1,tasks:[a,b]},'createTaskGroup');assert.equal(f.jobs().length,2);
  await assert.rejects(f.store.transaction(async()=>{await f.mail.changed(null,{baseVersion:0,version:2,task:{...a,_id:'rollback'}},'createTask');throw Error('rollback');}));
  assert.equal(f.jobs().length,2);
});

test('deadline scan sends once at 24h and due time; department escalation stays in department and club',async()=>{
  const f=await fixture();for(const [id,options] of Object.entries({alice:{},bob:{department:'publicity'},manager:{role:'department_admin'},other:{role:'department_admin',department:'publicity'},owner:{role:'owner'},outsider:{role:'department_admin',clubId:'other'}}))await f.person(id,options);
  const t=await f.task('deadline',{participantIds:['m_alice','m_bob'],completions:{m_bob:START}});
  f.setTime(t.dueAt-DAY-1);await f.mail.scanDeadlines();assert.equal(f.jobs().length,0);
  f.advance(1);await f.mail.scanDeadlines();await f.mail.scanDeadlines();await f.drain();assert.equal(f.sent.length,1);assert.deepEqual(f.sent[0].body.to,['alice@example.test']);
  f.setTime(t.dueAt);await f.mail.scanDeadlines();await f.drain();await f.mail.scanDeadlines();await f.drain();
  assert.equal(f.sent.length,3);assert.deepEqual(f.sent.slice(1).map(x=>x.body.to[0]).sort(),['alice@example.test','manager@example.test']);
  assert.match(f.sent.find(x=>x.body.to[0]==='manager@example.test').body.text,/部门管理员/);
});

test('one person with both roles gets one due email, shared completion stops all alerts',async()=>{
  const f=await fixture();await f.person('alice',{role:'department_admin'});await f.person('bob');
  const t=await f.task('shared',{mode:'shared',participantIds:['m_alice','m_bob']});
  f.setTime(t.dueAt);await f.mail.scanDeadlines();assert.equal(f.jobs().length,2);await f.drain();
  const mine=f.sent.find(x=>x.body.to[0]==='alice@example.test').body.text;assert.match(mine,/你负责/);assert.match(mine,/部门管理员/);
  const done=await f.task('finished',{mode:'shared',dueAt:t.dueAt,sharedCompletion:{memberId:'m_alice',at:t.dueAt}});
  await f.assign(done);await f.mail.scanDeadlines();await f.drain();assert.equal(f.sent.length,2);
});

test('dependency needs full completion, names prerequisite owners, reports remaining prerequisites, handles re-completion',async()=>{
  const f=await fixture();await f.person('alice');await f.person('bob');const main=await f.task('main');
  const a=await f.task('A',{participantIds:['m_alice','m_bob'],parentTaskId:main._id});const b=await f.task('B',{parentTaskId:main._id});
  await f.task('child',{parentTaskId:main._id,dependsOnTaskIds:['A','B'],participantIds:['m_bob']});
  const partial=await f.task('A',{...a,completions:{m_alice:START},syncVersion:2});await f.assign(partial,a,'complete');assert.equal(f.jobs().length,0);
  const done=await f.task('A',{...partial,completions:{m_alice:START,m_bob:START},syncVersion:3});await f.assign(done,partial,'complete');await f.drain();
  assert.equal(f.sent.length,1);assert.match(f.sent[0].body.text,/alice、bob/);assert.match(f.sent[0].body.text,/仍需等待其他前置任务：B/);
  const doneB=await f.task('B',{...b,completions:{m_alice:START},syncVersion:4});await f.assign(doneB,b,'complete');await f.drain();assert.match(f.sent[1].body.text,/所有前置任务均已完成/);
  const reopened=await f.task('A',{...a,syncVersion:5});await f.assign(reopened,done,'complete');assert.equal(f.sent.length,2);
  const again=await f.task('A',{...done,syncVersion:6});await f.assign(again,reopened,'complete');await f.drain();assert.equal(f.sent.length,3);
  assert.equal(taskDone({...a,guestParticipants:[{id:'g',name:'Guest'}],completions:{m_alice:1,m_bob:1}}),false);
});

test('completion, archival, removed dependency, reassignment and deadline edits cancel queued stale notices',async()=>{
  const f=await fixture();await f.person('alice');const t=await f.task('deadline');f.setTime(t.dueAt-DAY);await f.mail.scanDeadlines();
  await f.task('deadline',{...t,dueAt:t.dueAt+DAY});await f.drain();assert.equal(f.sent.length,0);
  await f.assign(t);await f.task('deadline',{...t,archived:true});await f.drain();assert.equal(f.sent.length,0);
  const a=await f.task('dep'),b=await f.task('dependent',{dependsOnTaskIds:['dep']});const done=await f.task('dep',{...a,completions:{m_alice:START},syncVersion:2});
  await f.assign(done,a,'complete');await f.task('dependent',{...b,dependsOnTaskIds:[]});await f.drain();assert.equal(f.sent.length,0);
});

test('historical overdue tasks do not cause a migration burst; skipped ticks catch up within live deadline window',async()=>{
  const f=await fixture();await f.person('alice');await f.task('old',{dueAt:START-1000});const t=await f.task('future');
  f.setTime(t.dueAt+60000);await f.mail.scanDeadlines();await f.drain();assert.equal(f.sent.length,1);assert.match(f.sent[0].body.subject,/future/);
  f.advance(8*DAY);await f.mail.scanDeadlines();await f.drain();assert.equal(f.sent.length,1);
});

test('retries survive service restart with unchanged provider idempotency and immutable body',async()=>{
  const f=await fixture();await f.person('alice');const t=await f.task('retry');await f.assign(t);
  f.respond(()=>Response.json({message:'try later'},{status:429,headers:{'Retry-After':'120'}}));await f.drain();assert.equal(f.sent.length,1);
  f.restart();await f.task('retry',{...t,title:'changed title'});f.advance(120000);f.respond(()=>Response.json({id:'accepted'}));await f.drain();
  assert.equal(f.sent.length,2);assert.equal(f.sent[0].headers['Idempotency-Key'],f.sent[1].headers['Idempotency-Key']);assert.deepEqual(f.sent[0].body,f.sent[1].body);assert.equal(f.jobs()[0].state,'sent');
  await f.drain();assert.equal(f.sent.length,2);
});

test('ambiguous sends stop before 24h idempotency expires; permanent failures do not retry',async()=>{
  const f=await fixture();await f.person('alice');await f.assign(await f.task('uncertain'));
  f.respond(()=>{throw Error('network');});await f.drain();f.advance(23*3600000);await f.drain();assert.equal(f.jobs()[0].state,'uncertain');assert.equal(f.sent.length,1);
  await f.assign(await f.task('permanent'));f.respond(()=>Response.json({message:'bad request'},{status:422}));await f.drain();assert.equal(f.jobs().find(j=>j.task_id==='permanent').state,'failed');
});

test('malformed successful provider responses remain safely retryable',async()=>{
  const f=await fixture();await f.person('alice');await f.assign(await f.task('ambiguous-response'));
  f.respond(()=>new Response('unreadable',{status:200}));await f.drain();assert.equal(f.jobs()[0].state,'queued');
  f.advance(60000);f.respond(()=>Response.json({id:'accepted'}));await f.drain();assert.equal(f.jobs()[0].state,'sent');
  assert.equal(f.sent[0].headers['Idempotency-Key'],f.sent[1].headers['Idempotency-Key']);
});

test('quota defers excess mail, confirmed email remains private, deleted accounts and HTML are handled safely',async()=>{
  const f=await fixture({daily:1});await f.person('alice');await f.person('bob');await f.assign(await f.task('quota',{title:'<script>alert(1)</script>',participantIds:['m_alice','m_bob']}));
  await f.drain();assert.equal(f.sent.length,1);assert.ok(!f.sent[0].body.html.includes('<script>'));assert.ok(f.sent[0].body.html.includes('&lt;script&gt;'));
  assert.ok(!f.sent[0].headers.Authorization.includes('undefined'));assert.equal(f.sent[0].url,'https://api.resend.com/emails');
  f.advance(DAY);await f.drain();assert.equal(f.sent.length,2);
  await f.assign(await f.task('deleted'));f.sql.exec('DELETE FROM accounts WHERE id=?','alice');f.mail.cleanup();await f.drain();assert.equal(f.sent.length,2);assert.equal(f.mail.info('alice').email,'');
});
