const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {computeStepSchedule,draftPlanningFields,DAY}=require('../shared/backward-schedule');
const {templateDraft,draftSchedule,seminarTemplate}=require('../shared/templates');
const {createService}=require('../shared/domain');
const {createMemoryStore}=require('../shared/memory-store');
const {parseDeadline,taskView}=require('../shared/view');
const T=parseDeadline('2026-11-20','20:00');
function chain() {
  const base={description:'',mode:'individual',priority:'normal',participantIds:[],daysBefore:0,anchorToMain:false};
  return [
    {...base,id:'copy',title:'宣传文案',estimateMinutes:3*1440,dependsOn:[]},
    {...base,id:'poster',title:'制作海报',estimateMinutes:1440,dependsOn:['copy']},
    {...base,id:'share',title:'宣传',estimateMinutes:1440,dependsOn:['poster'],anchorToMain:true,daysBefore:1}
  ];
}
const plan=steps=>computeStepSchedule(T,steps,'backward');

test('three-day copy, one-day poster and one-day publicity finish 3/2/1 days before the main task and start 6/3/2 days before it',()=>{
  assert.deepEqual(plan(chain()).map(r=>[T-r.dueAt,T-r.startAt]),[[3*DAY,6*DAY],[2*DAY,3*DAY],[DAY,2*DAY]]);
  const longer=chain();longer[0].estimateMinutes=5*1440;
  assert.equal(plan(longer)[0].dueAt,T-3*DAY);assert.equal(plan(longer)[0].startAt,T-8*DAY);
});

test('multiple prerequisites run in parallel; shared prerequisites satisfy the most restrictive successor and intermediate anchors',()=>{
  const steps=chain();
  steps.push({...steps[0],id:'photo',title:'图片',estimateMinutes:2*1440});steps[1].dependsOn.push('photo');
  steps.push({...steps[1],id:'press',title:'新闻稿',estimateMinutes:4*1440,anchorToMain:true,daysBefore:2});
  let rows=Object.fromEntries(plan(steps).map(r=>[r.id,r]));
  assert.equal(rows.copy.dueAt,T-6*DAY);assert.equal(rows.photo.dueAt,T-6*DAY);
  assert.equal(rows.poster.dueAt,T-2*DAY);assert.equal(rows.share.dueAt,T-DAY);
  assert.equal(rows.copy.startAt,T-9*DAY);assert.deepEqual(rows.copy.reason.ids,['press']);
  steps[1].anchorToMain=true;steps[1].daysBefore=8;
  rows=Object.fromEntries(plan(steps).map(r=>[r.id,r]));
  assert.equal(rows.poster.dueAt,T-8*DAY);assert.equal(rows.copy.dueAt,T-9*DAY);
});

test('backward results match exhaustive path bounds on varied DAGs, regardless of step order',()=>{
  let seed=17623;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/2**32);
  for(let trial=0;trial<35;trial++) {
    const steps=Array.from({length:7},(_,i)=>({...chain()[0],id:'n'+i,estimateMinutes:Math.floor(random()*5)*720,anchorToMain:random()<.6,daysBefore:Math.floor(random()*10),dependsOn:Array.from({length:i},(_,j)=>'n'+j).filter(()=>random()<.4)}));
    const bound=step=>T-(step.anchorToMain?step.daysBefore:0)*DAY;
    const exhaustive=step=>Math.min(bound(step),...steps.filter(next=>next.dependsOn.includes(step.id)).map(next=>exhaustive(next)-next.estimateMinutes*60000));
    const expected=Object.fromEntries(steps.map(step=>[step.id,exhaustive(step)]));
    for(const order of [steps,[...steps].reverse()]) for(const row of plan(order)) assert.equal(row.dueAt,expected[row.id]);
  }
});

test('custom caps can move predecessors earlier, later caps cannot override downstream constraints; disconnected steps and milestones remain bounded',()=>{
  const steps=chain();steps[1].dueAt=T-4*DAY;
  assert.equal(plan(steps)[0].dueAt,T-5*DAY);
  steps[1].dueAt=T;
  assert.equal(plan(steps)[1].dueAt,T-2*DAY);
  steps.push({...steps[0],id:'independent',estimateMinutes:0});
  const milestone=plan(steps)[3];assert.equal(milestone.dueAt,T);assert.equal(milestone.startAt,T);
  assert.throws(()=>plan([{...steps[0],dueAt:T+1}]),/晚于主任务/);
});

test('date arithmetic keeps Beijing clock time across years/leap days and supports fractional days to minute precision',()=>{
  const steps=chain();steps[1].estimateMinutes=720;
  const main=parseDeadline('2028-03-01','08:00'),rows=computeStepSchedule(main,steps,'backward');
  assert.equal(rows[0].dueAt,parseDeadline('2028-02-27','20:00'));
  assert.equal(rows[2].dueAt,parseDeadline('2028-02-29','08:00'));
  assert.equal(draftPlanningFields({estimateDays:.5},true).estimateMinutes,720);
  assert.throws(()=>draftPlanningFields({estimateDays:.00001},true));
  assert.throws(()=>draftPlanningFields({estimateDays:''},true));
  assert.equal(computeStepSchedule(parseDeadline('2027-01-01','20:00'),chain(),'backward')[0].dueAt,parseDeadline('2026-12-29','20:00'));
});

test('independent mode retains legacy deadlines and manual overrides; switching modes preserves draft fields and does not mutate a template',()=>{
  const t={...seminarTemplate(),schedulingMode:'backward',steps:chain()},draft=templateDraft(t,[]),main={...draft,date:'2026-11-20',time:'20:00'};
  assert.deepEqual(draftSchedule(main,draft.steps),plan(chain()));
  draft.steps[1].estimateDays=2;assert.equal(draftSchedule(main,draft.steps)[0].dueAt,T-4*DAY);
  assert.equal(t.steps[1].estimateMinutes,1440);
  main.schedulingMode='independent';
  draft.steps[0].customDeadline=true;draft.steps[0].date='2026-11-10';draft.steps[0].time='12:00';
  const independent=draftSchedule(main,draft.steps);
  assert.equal(independent[0].dueAt,parseDeadline('2026-11-10','12:00'));assert.equal(independent[1].dueAt,T);
  assert.equal(independent[0].startAt,null);
});

async function fixture() {
  const now=parseDeadline('2026-11-04','08:00'),store=createMemoryStore();
  const run=createService({store,now:()=>now,randomId:()=>crypto.randomBytes(16).toString('hex'),hash:s=>crypto.createHash('sha256').update(s).digest('hex')});
  const {clubId}=await run('createClub',{name:'倒排测试',nickname:'Owner',requestId:'backward-club'},'owner');
  const board=()=>run('bootstrap',{clubId},'owner'),b=await board();
  const create=(patch={})=>run('createTemplate',{...seminarTemplate(),schedulingMode:'backward',steps:chain(),clubId,requestId:'backward-template',...patch},'owner');
  const group=(t,patch={})=>run('createTaskGroup',{...t,clubId,templateId:t._id,dueAt:T,participantIds:[b.me.id],subtasks:t.steps.map(s=>({...s,participantIds:[b.me.id]})),requestId:'backward-group',...patch},'owner');
  return {now,store,run,clubId,board,create,group};
}

test('templates persist/copy/sync estimates and anchors; server computes final deadlines, retries idempotently and freezes the published plan',async()=>{
  const f=await fixture(),before=await f.board(),{template}=await f.create();
  const copy=(await f.create({...template,requestId:'backward-copy'})).template;
  assert.deepEqual(copy.steps,template.steps);
  assert.equal((await f.run('sync',{clubId:f.clubId,since:before.version},'owner')).templates.find(t=>t._id===template._id).schedulingMode,'backward');
  const group=await f.group(template);
  assert.deepEqual(group.tasks.slice(1).map(t=>t.dueAt),[T-3*DAY,T-2*DAY,T-DAY]);
  assert.deepEqual(group.tasks.slice(1).map(t=>t.estimateMinutes),[4320,1440,1440]);
  assert.equal((await f.group(template)).taskId,group.taskId);
  const poster=group.tasks[2];await f.run('complete',{taskId:poster._id,done:true},'owner');
  const b=await f.board();assert.equal(taskView(b.tasks.find(t=>t._id===poster._id),b).done,true);assert.equal(taskView(group.tasks[1],b).done,false);
  await f.run('editTemplate',{...template,templateId:template._id,steps:template.steps.map(s=>({...s,estimateMinutes:14400}))},'owner');
  assert.equal((await f.board()).tasks.find(t=>t._id===poster._id).dueAt,T-2*DAY);
});

test('malformed estimates, cycles, old editors and plans needing a past start fail without partial writes',async()=>{
  const f=await fixture(),before=f.store.snapshot();
  for (const value of [null,undefined,-1,1.5,'1440',true,{},365*1440+1]) await assert.rejects(f.create({steps:chain().map((s,i)=>i?s:{...s,estimateMinutes:value})}),{code:'VALIDATION'});
  for (const value of [null,1,'yes']) await assert.rejects(f.create({steps:chain().map((s,i)=>i?s:{...s,anchorToMain:value})}),{code:'VALIDATION'});
  await assert.rejects(f.create({schedulingMode:'unknown'}),{code:'VALIDATION'});
  const cyclic=chain();cyclic[0].dependsOn=['share'];await assert.rejects(f.create({steps:cyclic}),{code:'VALIDATION'});
  assert.deepEqual(f.store.snapshot(),before);
  const {template}=await f.create(),saved=f.store.snapshot();
  const {schedulingMode,...old}=template;
  await assert.rejects(f.run('editTemplate',{...old,templateId:template._id},'owner'),{code:'CONFLICT'});
  await assert.rejects(f.group(old),{code:'CONFLICT'});
  await assert.rejects(f.group(template,{dueAt:f.now+5*DAY}),/过去开始/);
  await assert.rejects(f.group({...template,steps:template.steps.map(s=>({...s,estimateMinutes:null}))}),{code:'VALIDATION'});
  assert.deepEqual(f.store.snapshot(),saved);
});

test('schedule preview distinguishes latest start from finish, explains controlling successors and escapes names',async()=>{
  const {buildSync}=require('esbuild'),bundle=buildSync({entryPoints:['client/planning-views.js'],bundle:true,format:'esm',write:false});
  const views=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const draft=templateDraft({...seminarTemplate(),schedulingMode:'backward',steps:chain()},[]),s={form:draft,steps:draft.steps};
  s.steps[1].title='<img src=x onerror=alert(1)>';
  const result=views.stepPlan(s,true),html=views.planningPreview(s,true,result);
  assert.match(html,/最晚开始：主任务前 6 天/);assert.match(html,/截止：主任务前 3 天/);
  assert.match(html,/为后续「&lt;img/);assert.ok(!html.includes('<img'));
  s.steps[0].estimateDays='';assert.match(views.planningPreview(s,true,views.stepPlan(s,true)),/请为.*填写保守预计耗时/);
});
