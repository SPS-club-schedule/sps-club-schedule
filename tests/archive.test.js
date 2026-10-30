const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const {createMemoryStore}=require('../shared/memory-store');
async function views() {
  const result=buildSync({entryPoints:['client/views.js'],bundle:true,format:'esm',write:false});
  return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const state=()=>({sync:{phase:'ready',board:{club:{id:'club',name:'SPS'},me:{id:'owner',role:'owner'},members:[{id:'owner',name:'Owner',role:'owner'}],tasks:[]}},form:{},archiveData:{tasks:[],templates:[]},adminData:{members:[],events:[]}});
const task={_id:'task',clubId:'club',title:'History',description:'Original',creatorId:'deleted-member',participantIds:['deleted-member'],completions:{'deleted-member':100},sharedCompletion:null,mode:'individual',priority:'normal',dueAt:100,createdAt:50,updatedAt:200,revision:2,syncVersion:3,archived:true};

test('archives have one compact admin entry and never expose content or controls to ordinary members',async()=>{
  const v=await views(),s=state();
  assert.ok(v.admin(s).includes('href="#/admin-archives"'));
  s.archiveData.tasks=[task];
  assert.ok(!v.admin(s).includes('Original'));
  for(const role of ['member',undefined]) {
    s.sync.board.me.role=role;
    const html=v.archives(s); assert.ok(html.includes('仅管理员可用')); assert.ok(!html.includes('History')); assert.ok(!html.includes('restoreTask'));
  }
  s.sync.board.me.role='admin';s.adminDenied=true;
  assert.ok(!v.archives(s).includes('History'));
});

test('archive lists separate tasks and templates, escape content and block children of archived parents',async()=>{
  const v=await views(),s=state(),bad='<img src=x onerror=alert(1)>';
  s.archiveData.tasks=[{...task,title:bad,parentTaskId:'parent',parentTitle:bad,parentArchived:true}];
  s.archiveData.templates=[{_id:'tpl',name:'Saved template',category:'Category',updatedAt:200,steps:[{title:bad}],description:bad}];
  let html=v.archives(s); assert.ok(!html.includes('<img')); assert.ok(html.includes('&lt;img')); assert.ok(html.includes('请先恢复主任务')); assert.ok(html.includes('data-action="restoreTask" data-id="task" disabled')); assert.ok(!html.includes('Saved template'));
  s.archiveType='templates';html=v.archives(s); assert.ok(html.includes('Saved template')); assert.ok(html.includes('restoreTemplate')); assert.ok(!html.includes('restoreTask')); assert.ok(!html.includes('<img'));
  s.archiveOpen=new Set(['tpl']);assert.ok(v.archives(s).includes('data-archive-item="tpl" open'));
  s.search='no match'; assert.ok(v.archives(s).includes('没有匹配的归档内容'));
  s.search='';s.archiveData.templates=[];assert.ok(v.archives(s).includes('暂无已归档模板'));
});

test('restoring old deadlines and departed assignees keeps original history and requires a valid parent',async()=>{
  const {restoreArchive,listArchives}=await import('../server/archive.mjs');
  const store=createMemoryStore({clubs:{club:{_id:'club',name:'SPS',syncVersion:3}},tasks:{task}});
  const result=await store.transaction(db=>restoreArchive(db,'adminRestoreTask',{clubId:'club',taskId:'task',revision:2},{_id:'owner'},999999));
  assert.equal(result.task.dueAt,100);assert.deepEqual(result.task.participantIds,task.participantIds);assert.deepEqual(result.task.completions,task.completions);assert.equal(result.task.creatorId,task.creatorId);
  const orphan={...task,_id:'child',parentTaskId:'absent'};await store.transaction(db=>db.put('tasks','child',orphan));
  assert.equal((await listArchives(store,'club')).tasks[0].parentMissing,true);
  await assert.rejects(store.transaction(db=>restoreArchive(db,'adminRestoreTask',{clubId:'club',taskId:'child',revision:2},{_id:'owner'},999999)),{code:'CONFLICT'});
  assert.equal((await store.get('tasks','child')).archived,true);
});

test('a failed batch restoration rolls back parent, children and cursor together',async()=>{
  const {restoreArchive}=await import('../server/archive.mjs');
  const initial={clubs:{club:{_id:'club',name:'SPS',syncVersion:3}},tasks:{task,child:{...task,_id:'child',parentTaskId:'task'}}};
  const store=createMemoryStore(initial,()=>{throw new Error('Storage failure');});
  await assert.rejects(store.transaction(db=>restoreArchive(db,'adminRestoreTask',{clubId:'club',taskId:'task',revision:2},{_id:'owner'},999999)),/Storage failure/);
  assert.deepEqual(store.snapshot().tasks,initial.tasks);assert.equal((await store.get('clubs','club')).syncVersion,3);
});
