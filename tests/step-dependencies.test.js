const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createService}=require('../shared/domain');
const {createMemoryStore}=require('../shared/memory-store');
const {seminarTemplate,templateDraft}=require('../shared/templates');
const {normalizeStepDependencies,canDependOn,removeStep}=require('../shared/step-dependencies');
const {taskView}=require('../shared/view');

function definition() {
  const t=seminarTemplate();
  t.steps=t.steps.map((step,i)=>({...step,id:['room','poster','copy','share','slides'][i],dependsOn:[]}));
  t.steps[1].dependsOn=['copy'];
  t.steps[3].dependsOn=['copy','poster'];
  return t;
}
async function fixture() {
  const now=Date.now(),store=createMemoryStore();
  const run=createService({store,now:()=>now,randomId:()=>crypto.randomBytes(16).toString('hex'),hash:s=>crypto.createHash('sha256').update(s).digest('hex')});
  const {clubId}=await run('createClub',{name:'依赖测试',nickname:'Owner',requestId:'dependencies-club'},'owner');
  const board=()=>run('bootstrap',{clubId},'owner'), b=await board();
  const create=(patch={})=>run('createTemplate',{...definition(),clubId,requestId:'dependencies-template',...patch},'owner');
  const group=(template,patch={})=>run('createTaskGroup',{...template,clubId,templateId:template._id,participantIds:[b.me.id],dueAt:now+14*86400000,requestId:'dependencies-group',subtasks:template.steps.map(step=>({...step,participantIds:[b.me.id]})),...patch},'owner');
  return {now,store,run,clubId,board,create,group};
}

test('relations survive save, delta sync, copy, rename and reorder; published groups have independent task references',async()=>{
  const f=await fixture(),before=await f.board();
  let {template}=await f.create();
  const copy=(await f.create({...template,requestId:'dependencies-copy'})).template;
  const delta=await f.run('sync',{clubId:f.clubId,since:before.version},'owner');
  assert.deepEqual(delta.templates.find(t=>t._id===template._id).steps[1].dependsOn,['copy']);
  template=(await f.run('editTemplate',{...template,templateId:template._id,steps:template.steps.map(s=>s.id==='copy'?{...s,title:'定稿文案'}:s).reverse()},'owner')).template;
  const first=await f.group(template),second=await f.group(template,{requestId:'dependencies-group-two'});
  for (const group of [first,second]) {
    const poster=group.tasks.find(t=>t.title==='制作海报'),copy=group.tasks.find(t=>t.title==='定稿文案'),share=group.tasks.find(t=>t.title==='向各院系群转发宣传');
    assert.deepEqual(poster.dependsOnTaskIds,[copy._id]);
    assert.deepEqual(share.dependsOnTaskIds,[copy._id,poster._id]);
    assert.equal('dependsOn' in poster,false);
  }
  assert.notDeepEqual(first.tasks.find(t=>t.title==='制作海报').dependsOnTaskIds,second.tasks.find(t=>t.title==='制作海报').dependsOnTaskIds);
  assert.equal((await f.group(template)).taskId,first.taskId);
  assert.equal(copy.steps[2].title,'撰写宣传文案');
  await f.run('editTemplate',{...template,templateId:template._id,steps:template.steps.map(step=>({...step,dependsOn:[]}))},'owner');
  assert.deepEqual((await f.board()).tasks.find(t=>t.title==='制作海报').dependsOnTaskIds,first.tasks.find(t=>t.title==='制作海报').dependsOnTaskIds);
});

test('dependencies never gate individual/shared completion, undo or deadline editing',async()=>{
  const f=await fixture(),{template}=await f.create();
  for (const mode of ['individual','shared']) {
    const group=await f.group(template,{requestId:'completion-'+mode,subtasks:template.steps.map(step=>({...step,mode,followMain:true}))});
    const poster=group.tasks.find(t=>t.title==='制作海报'),copy=group.tasks.find(t=>t.title==='撰写宣传文案');
    let b=await f.board();
    assert.equal(taskView(poster,b).canToggle,true); assert.equal(taskView(copy,b).done,false);
    const completed=await f.run('complete',{taskId:poster._id,done:true},'owner');
    b=await f.board();
    assert.equal(taskView(b.tasks.find(t=>t._id===poster._id),b).done,true);
    assert.equal(taskView(b.tasks.find(t=>t._id===copy._id),b).done,false);
    await f.run('complete',{taskId:poster._id,done:false},'owner');
    const current=(await f.board()).tasks.find(t=>t._id===poster._id);
    const edited=await f.run('editTask',{...current,taskId:current._id,title:'先完成海报',dueAt:f.now+86400000},'owner');
    assert.deepEqual(edited.task.dependsOnTaskIds,[copy._id]);
    assert.ok(completed.task);
  }
});

test('invalid dependency graphs fail atomically and old clients cannot erase or drop existing relations',async()=>{
  const f=await fixture(),before=f.store.snapshot();
  const bad=[
    steps=>{steps[1].dependsOn=['poster'];},
    steps=>{steps[2].dependsOn=['share'];},
    steps=>{steps[1].dependsOn=['other-club-task'];},
    steps=>{steps[1].dependsOn=null;},
    steps=>{steps[1].dependsOn='copy';},
    steps=>{steps[1].dependsOn=[{}];},
    steps=>{steps[1].id=steps[0].id;},
    steps=>{steps[1].id='<invalid>';},
  ];
  for (const change of bad) {const t=definition();change(t.steps);await assert.rejects(f.create(t),{code:'VALIDATION'});}
  assert.deepEqual(f.store.snapshot(),before);
  const {template}=await f.create(),saved=f.store.snapshot();
  for (const change of bad) {const t=structuredClone(template);change(t.steps);await assert.rejects(f.group(t),{code:'VALIDATION'});}
  const oldSteps=template.steps.map(({id,dependsOn,...step})=>step);
  await assert.rejects(f.run('editTemplate',{...template,templateId:template._id,steps:oldSteps},'owner'),{code:'CONFLICT'});
  await assert.rejects(f.group({...template,steps:oldSteps}),{code:'CONFLICT'});
  assert.deepEqual(f.store.snapshot(),saved);
  const legacy=(await f.create({...seminarTemplate(),requestId:'legacy-dependencies-template'})).template;
  assert.ok(legacy.steps.every(step=>step.id&&step.dependsOn.length===0));
});

test('draft copies isolate arrays, deletion clears incoming relations, and duplicate titles retain distinct identities',()=>{
  const t=definition(),draft=templateDraft(t,[]);
  draft.steps.reverse();draft.steps.find(s=>s.id==='copy').title='制作海报';
  assert.deepEqual(draft.steps.find(s=>s.id==='poster').dependsOn,['copy']);
  assert.equal(canDependOn(draft.steps,'copy','share'),false);
  removeStep(draft.steps,draft.steps.findIndex(s=>s.id==='copy'));
  assert.deepEqual(draft.steps.find(s=>s.id==='poster').dependsOn,[]);
  assert.deepEqual(draft.steps.find(s=>s.id==='share').dependsOn,['poster']);
  assert.deepEqual(t.steps[1].dependsOn,['copy']);
  const legacy=normalizeStepDependencies([{id:'legacy_step_1'},{title:'B'}]);
  assert.notEqual(legacy[0].id,legacy[1].id);
});

test('dependency UI escapes labels, marks selected and circular choices, and links published dependencies without disabling completion',async()=>{
  const {buildSync}=require('esbuild'),bundle=buildSync({entryPoints:['client/dependency-views.js'],bundle:true,format:'esm',write:false});
  const views=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const f=await fixture(),{template}=await f.create(),group=await f.group(template),board=await f.board();
  const poster=group.tasks.find(t=>t.title==='制作海报'),copy=board.tasks.find(t=>t.title==='撰写宣传文案');
  const unsafe='<img src=x onerror=alert(1)>';
  template.steps[2].title=copy.title=unsafe;
  for (const html of [views.stepDependencies(template.steps[1],template.steps),views.dependencyPicker(template.steps[1],template.steps,1),views.taskDependencies(poster,board,true)]) {
    assert.ok(html.includes('&lt;img')); assert.ok(!html.includes('<img'));
  }
  const picker=views.dependencyPicker(template.steps[2],template.steps,2);
  assert.match(picker,/data-id="poster" aria-pressed="false" disabled/);
  const detail=views.taskDependencies(poster,board,true);
  assert.ok(detail.includes('/task?id='+copy._id)); assert.match(detail,/未完成/); assert.match(detail,/仍可标记本任务完成/);
  board.tasks=board.tasks.filter(t=>t._id!==copy._id);
  assert.match(views.taskDependencies(poster,board,true),/已归档或不可用/);
});
