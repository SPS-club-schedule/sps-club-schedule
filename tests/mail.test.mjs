import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
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
  async function assign(t,before=null,action='createTask',actor='dispatcher'){await mail.changed(before,{baseVersion:0,version:t.syncVersion,task:t},action,actor);}
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
  const next=await f.task('work',{...t,participantIds:['m_bob'],syncVersion:2});await f.assign(next,t,'editTask');f.advance(60000);
  await f.drain();assert.equal(f.sent.length,1);assert.deepEqual(f.sent[0].body.to,['bob@example.test']);assert.equal(f.jobs().find(j=>j.account_id==='alice').state,'cancelled');
  const later={...next,title:'renamed',syncVersion:3};await f.assign(later,next,'editTask');assert.equal(f.jobs().length,2);
});

test('one assignment digest per recipient and root includes only their current work', async()=>{
  const f = await fixture();
  for (const id of ['alice','bob','carol']) await f.person(id);
  const root = await f.task('main', {participantIds:['m_alice','m_bob']});
  const poster = await f.task('poster', {parentTaskId:'main',participantIds:['m_bob','m_carol']});
  const speaker = await f.task('speaker', {parentTaskId:'main',participantIds:['m_alice','m_bob']});
  const result = {baseVersion:0,version:1,tasks:[root,poster,speaker]};
  await assert.rejects(f.store.transaction(async()=>{
    await f.mail.changed(null,result,'createTaskGroup','alice');
    throw Error('rollback');
  }));
  assert.equal(f.jobs().length,0);
  await f.mail.changed(null,result,'createTaskGroup','alice');
  await f.mail.changed(null,result,'createTaskGroup','alice');
  assert.equal(f.jobs().length,2);
  f.advance(30_000);
  const added = await f.task('minutes',{parentTaskId:'main',participantIds:['m_bob'],syncVersion:2});
  await f.assign(added,null,'createTask','alice');
  const other = await f.task('other',{participantIds:['m_bob'],syncVersion:3});
  await f.assign(other,null,'createTask','alice');
  await f.task('speaker',{...speaker,completions:{m_bob:START}});
  f.restart();
  f.advance(29_999);
  await f.drain();
  assert.equal(f.sent.length,0);
  f.advance(1);
  await f.drain();
  assert.equal(f.sent.length,2);
  const bob = f.sent.find(send=>send.body.to[0]==='bob@example.test').body;
  for (const id of ['main','poster','minutes']) assert.ok(bob.text.includes('#/task?id='+id+'&club=club'));
  assert.doesNotMatch(bob.text,/「speaker」|「other」/);
  const carol = f.sent.find(send=>send.body.to[0]==='carol@example.test').body;
  assert.match(carol.text,/以下 1 项/);
  assert.match(carol.text,/子任务「poster」/);
  f.advance(30_000);
  await f.drain();
  assert.equal(f.sent.length,3);
  assert.match(f.sent[2].body.text,/主任务「other」/);
  const later = await f.task('later',{parentTaskId:'main',participantIds:['m_bob'],syncVersion:4});
  await f.assign(later,null,'createTask','alice');
  f.advance(60_000);
  await f.drain();
  assert.equal(f.sent.length,4);
  assert.match(f.sent[3].body.text,/以下 1 项/);
  assert.match(f.sent[3].body.text,/子任务「later」/);
});

test('self reassignment by an editor drops any undelivered old addition for that subtask', async()=>{
  const f=await fixture();
  await f.person('alice');await f.person('bob');
  await f.task('root');
  const child=await f.task('child',{parentTaskId:'root',participantIds:['m_bob']});
  await f.assign(child,null,'createTask','alice');
  const moved=await f.task('child',{...child,participantIds:['m_alice'],syncVersion:2});
  await f.assign(moved,child,'editTask','alice');
  const back=await f.task('child',{...child,syncVersion:3});
  await f.assign(back,moved,'editTask','bob');
  f.advance(60_000);await f.drain();
  assert.equal(f.sent.length,0);
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

test('each reminder stage groups by root, exact deadline and account; department reports combine personal and managed work', async()=>{
  const f=await fixture();
  await f.person('lead',{role:'department_admin'});
  await f.person('assistant',{role:'department_admin'});
  await f.person('alice');
  await f.person('bob',{department:'publicity'});
  await f.person('outside',{clubId:'other',role:'department_admin'});
  const dueAt=START+2*DAY;
  const root=await f.task('event',{participantIds:['m_lead'],dueAt:dueAt+DAY*2});
  const child=(id,participantIds,extra={})=>f.task(id,{parentTaskId:root._id,participantIds,dueAt,...extra});
  await child('poster',['m_lead','m_alice','m_bob']);
  await child('venue',['m_alice']);
  await child('private-other-department',['m_bob']);
  await child('finished',['m_alice'],{completions:{m_alice:START}});
  await child('separate-minute',['m_alice'],{dueAt:dueAt+60_000});
  await f.task('separate-root',{participantIds:['m_alice'],dueAt});
  f.setTime(dueAt-DAY+60_000);
  await f.mail.scanDeadlines();await f.drain();
  const matching=(id,stage)=>f.sent.map(x=>x.body).filter(body=>body.to[0]===id+'@example.test'&&body.subject.includes(stage));
  const links=body=>[...body.text.matchAll(/#\/task\?id=([^&]+)&club=/g)].map(m=>m[1]).sort();
  const lists=(id,stage)=>matching(id,stage).map(links).sort();
  assert.deepEqual(lists('alice','一天'),[['poster','venue'],['separate-minute'],['separate-root']]);
  assert.deepEqual(lists('lead','一天'),[['poster']]);
  assert.deepEqual(lists('assistant','一天'),[]);
  assert.deepEqual(lists('bob','一天'),[['poster','private-other-department']]);

  f.setTime(dueAt+60_000);
  await f.mail.scanDeadlines();f.restart();await f.mail.scanDeadlines();await f.drain();
  await f.mail.scanDeadlines();await f.drain();
  const expected=[['poster','venue'],['separate-minute'],['separate-root']];
  for(const id of ['lead','assistant','alice']) assert.deepEqual(lists(id,'到期'),expected);
  assert.deepEqual(lists('outside','到期'),[]);
  assert.deepEqual(lists('bob','到期'),[['poster','private-other-department']]);
  const lead=matching('lead','到期').find(body=>links(body).includes('poster'));
  assert.match(lead.text,/子任务「poster」 · 你负责；[^\n]*未完成：[^\n]*alice/);
  assert.match(lead.text,/子任务「venue」 · [^\n]*未完成：alice/);
  assert.doesNotMatch(lead.text,/bob|private-other-department|finished/);
});

test('a queued reminder uses current responsibilities and deadline; identical rescans consume one send',async()=>{
  const f=await fixture();await f.person('alice');await f.person('bob');
  const root=await f.task('root',{participantIds:['m_bob'],dueAt:START+4*DAY});
  const dueAt=START+2*DAY;
  const add=(id,extra={})=>f.task(id,{parentTaskId:root._id,participantIds:['m_alice'],dueAt,...extra});
  await add('kept');await add('completed');await add('rescheduled');
  f.setTime(dueAt);await f.mail.scanDeadlines();
  await add('rescheduled',{dueAt:dueAt+2*DAY});await add('new');
  await f.mail.scanDeadlines();
  await add('completed',{completions:{m_alice:dueAt}});
  await f.drain();
  assert.equal(f.sent.length,1);
  assert.match(f.sent[0].body.text,/子任务「kept」/);
  assert.match(f.sent[0].body.text,/子任务「new」/);
  assert.doesNotMatch(f.sent[0].body.text,/completed|rescheduled/);
  await f.mail.scanDeadlines();await f.drain();
  assert.equal(f.rows('SELECT SUM(used) AS n FROM email_usage')[0].n,1);
});

test('upgrade folds untouched legacy mail into a digest and never replays attempted legacy task keys',async()=>{
  const f=await fixture();await f.person('alice');const dueAt=START+2*DAY;
  await f.task('root',{participantIds:[],dueAt:dueAt+DAY});
  for(const id of ['already','waiting','new'])await f.task(id,{parentTaskId:'root',dueAt});
  for(const kind of ['day','deadline']){
    const time=kind==='day'?dueAt-DAY:dueAt, expiry=kind==='day'?dueAt:dueAt+7*DAY;
    f.setTime(time);
    for(const [id,state] of [['already','sent'],['waiting','queued']]){
      const key=[kind,id,dueAt,kind==='day'?'m_alice':'alice'].join(':');
      f.sql.exec(`INSERT INTO email_outbox(id,kind,task_id,account_id,state,first_attempt,context,created_at,expires_at,priority)
        VALUES(?,?,?,'alice',?,?,?,?,?,1)`,createHash('sha256').update(key).digest('hex'),kind,id,state,state==='sent'?time:0,JSON.stringify({dueAt,memberId:'m_alice'}),time,expiry);
    }
    await f.mail.scanDeadlines();await f.drain();f.restart();await f.mail.scanDeadlines();await f.drain();
    const deliveries=f.sent.filter(x=>x.body.subject.includes(kind==='day'?'一天':'到期'));
    assert.equal(deliveries.length,1);
    assert.match(deliveries[0].body.text,/「new」/);assert.match(deliveries[0].body.text,/「waiting」/);
    assert.doesNotMatch(deliveries[0].body.text,/already/);
  }
});

test('ambiguous digest retry preserves idempotency and cannot resend departed department members to the former manager',async()=>{
  const f=await fixture();await f.person('alice',{role:'department_admin'});await f.person('bob');
  await f.task('root',{participantIds:['m_alice','m_bob']});
  await f.task('child',{parentTaskId:'root',participantIds:['m_alice']});
  f.setTime(START+2*DAY);await f.mail.scanDeadlines();
  f.respond(()=>{throw Error('network');});await f.drain();
  const first=f.sent.find(x=>x.body.to[0]==='alice@example.test');assert.match(first.body.text,/部门管理员/);
  f.restart();f.advance(60_000);await f.mail.scanDeadlines();await f.drain();
  const attempts=f.sent.filter(x=>x.body.to[0]==='alice@example.test');
  assert.equal(attempts.length,2);assert.equal(attempts[0].headers['Idempotency-Key'],attempts[1].headers['Idempotency-Key']);
  assert.deepEqual(attempts[0].body,attempts[1].body);
  const me=await f.store.get('members','m_alice');await f.store.put('members','m_alice',{...me,role:'member'});
  f.advance(120_000);await f.mail.scanDeadlines();await f.drain();
  assert.equal(f.sent.filter(x=>x.body.to[0]==='alice@example.test').length,2);
  assert.equal(f.jobs().find(j=>j.account_id==='alice').state,'uncertain');
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
  await f.assign(t);await f.task('deadline',{...t,archived:true});f.advance(60000);await f.drain();assert.equal(f.sent.length,0);
  const a=await f.task('dep'),b=await f.task('dependent',{dependsOnTaskIds:['dep']});const done=await f.task('dep',{...a,completions:{m_alice:START},syncVersion:2});
  await f.assign(done,a,'complete');await f.task('dependent',{...b,dependsOnTaskIds:[]});await f.drain();assert.equal(f.sent.length,0);
});

test('historical overdue tasks do not cause a migration burst; skipped ticks catch up within live deadline window',async()=>{
  const f=await fixture();await f.person('alice');await f.task('old',{dueAt:START-1000});const t=await f.task('future');
  f.setTime(t.dueAt+60000);await f.mail.scanDeadlines();await f.drain();assert.equal(f.sent.length,1);assert.match(f.sent[0].body.subject,/future/);
  f.advance(8*DAY);await f.mail.scanDeadlines();await f.drain();assert.equal(f.sent.length,1);
});

test('retries survive service restart with unchanged provider idempotency and immutable body',async()=>{
  const f=await fixture();await f.person('alice');const t=await f.task('retry');await f.assign(t);f.advance(60000);
  f.respond(()=>Response.json({message:'try later'},{status:429,headers:{'Retry-After':'120'}}));await f.drain();assert.equal(f.sent.length,1);
  f.restart();await f.task('retry',{...t,title:'changed title'});f.advance(120000);f.respond(()=>Response.json({id:'accepted'}));await f.drain();
  assert.equal(f.sent.length,2);assert.equal(f.sent[0].headers['Idempotency-Key'],f.sent[1].headers['Idempotency-Key']);assert.deepEqual(f.sent[0].body,f.sent[1].body);assert.equal(f.jobs()[0].state,'sent');
  await f.drain();assert.equal(f.sent.length,2);
});

test('ambiguous sends stop before 24h idempotency expires; permanent failures do not retry',async()=>{
  const f=await fixture();await f.person('alice');await f.assign(await f.task('uncertain'));f.advance(60000);
  f.respond(()=>{throw Error('network');});await f.drain();f.advance(23*3600000);await f.drain();assert.equal(f.jobs()[0].state,'uncertain');assert.equal(f.sent.length,1);
  await f.assign(await f.task('permanent'));f.advance(60000);f.respond(()=>Response.json({message:'bad request'},{status:422}));await f.drain();assert.equal(f.jobs().find(j=>j.task_id==='permanent').state,'failed');
});

test('malformed successful provider responses remain safely retryable',async()=>{
  const f=await fixture();await f.person('alice');await f.assign(await f.task('ambiguous-response'));f.advance(60000);
  f.respond(()=>new Response('unreadable',{status:200}));await f.drain();assert.equal(f.jobs()[0].state,'queued');
  f.advance(60000);f.respond(()=>Response.json({id:'accepted'}));await f.drain();assert.equal(f.jobs()[0].state,'sent');
  assert.equal(f.sent[0].headers['Idempotency-Key'],f.sent[1].headers['Idempotency-Key']);
});

test('quota defers excess mail, confirmed email remains private, deleted accounts and HTML are handled safely',async()=>{
  const f=await fixture({daily:1});await f.person('alice');await f.person('bob');await f.assign(await f.task('quota',{title:'<script>alert(1)</script>',participantIds:['m_alice','m_bob']}));
  f.advance(60000);await f.drain();assert.equal(f.sent.length,1);assert.ok(!f.sent[0].body.html.includes('<script>'));assert.ok(f.sent[0].body.html.includes('&lt;script&gt;'));
  assert.ok(!f.sent[0].headers.Authorization.includes('undefined'));assert.equal(f.sent[0].url,'https://api.resend.com/emails');
  f.advance(DAY);await f.drain();assert.equal(f.sent.length,2);
  await f.assign(await f.task('deleted'));f.sql.exec('DELETE FROM accounts WHERE id=?','alice');f.mail.cleanup();f.advance(60000);await f.drain();assert.equal(f.sent.length,2);assert.equal(f.mail.info('alice').email,'');
});

test('account opt-out persists, cancels queued task mail and keeps verification available',async()=>{
  const f=await fixture();await f.person('alice');const t=await f.task('preference');await f.assign(t);
  assert.equal(f.mail.info('alice').emailNotificationsEnabled,true);
  f.mail.setNotifications('alice',false);f.restart();assert.equal(f.mail.info('alice').emailNotificationsEnabled,false);
  f.advance(60_000);await f.drain();assert.equal(f.sent.length,0);assert.equal(f.jobs()[0].state,'cancelled');
  await f.assign(await f.task('after-opt-out'));await f.drain();assert.equal(f.sent.length,0);
  f.mail.requestVerification('alice','new@example.test');await f.drain();assert.equal(f.sent.length,1);assert.match(f.sent[0].body.subject,/验证码/);
  f.mail.verify('alice','123456');f.mail.setNotifications('alice',true);await f.assign(await f.task('after-opt-in'));f.advance(60_000);await f.drain();assert.equal(f.sent.length,2);
  assert.throws(()=>f.mail.setNotifications('alice','false'),/开关无效/);
});
test('opted-out overdue members never trigger manager notices, including queued and retried digests',async()=>{
  const f=await fixture();await f.person('alice');await f.person('bob');await f.person('lead',{role:'department_admin'});
  await f.task('private-overdue',{participantIds:['m_alice'],dueAt:START+60_000});
  await f.task('mixed-overdue',{participantIds:['m_alice','m_bob'],dueAt:START+60_000});
  f.advance(60_000);await f.mail.scanDeadlines();
  // Preferences can change after cron enqueues but before delivery.
  f.mail.setNotifications('alice',false);await f.drain();
  assert.ok(f.sent.every(x=>x.body.to[0]!=='alice@example.test'));
  const lead=f.sent.filter(x=>x.body.to[0]==='lead@example.test');assert.equal(lead.length,1);assert.match(lead[0].body.text,/bob/);assert.doesNotMatch(lead[0].body.text,/alice|private-overdue/);
  // A failed send has a frozen provider payload. Revoking the last member must
  // cancel the manager retry, even if it was already prepared once.
  const g=await fixture();await g.person('alice');await g.person('lead',{role:'department_admin'});await g.task('retry',{dueAt:START+60_000});g.advance(60_000);await g.mail.scanDeadlines();
  g.respond(()=>Response.json({}, {status:503}));
  for(let i=0;i<2;i++){let job=await g.mail.prepare();if(job?.wait){g.advance(job.wait);job=await g.mail.prepare();}g.mail.finish(job,await g.mail.transmit(job));}
  g.mail.setNotifications('alice',false);const count=g.sent.length;g.advance(3600000);await g.drain();assert.equal(g.sent.length,count);
});
test('opted-out managers receive no escalation; simple containers produce no phantom reminders',async()=>{
  const f=await fixture();await f.person('alice');await f.person('lead',{role:'department_admin'});f.mail.setNotifications('lead',false);
  const root=await f.task('heading',{simpleContainer:true,participantIds:['m_alice'],dueAt:START+60_000});
  const child=await f.task('real-work',{parentTaskId:root._id,participantIds:['m_alice'],dueAt:START+60_000});
  await f.mail.changed(null,{baseVersion:0,version:1,tasks:[root,child]},'createSimpleTask','lead');f.advance(60_000);await f.mail.scanDeadlines();await f.drain();
  assert.ok(f.sent.every(x=>x.body.to[0]==='alice@example.test'));assert.ok(f.sent.every(x=>!x.body.text.includes('#/task?id=heading&')));assert.ok(f.sent.some(x=>x.body.text.includes('#/task?id=real-work&')));
});
