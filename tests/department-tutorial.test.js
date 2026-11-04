const {test}=require('node:test');
const assert=require('node:assert/strict');
const {VERSION,departmentTutorialKey,canOfferDepartmentTutorial,departmentPracticeTemplate,departmentPracticeTask,departmentPracticeDrafts}=require('../shared/department-tutorial');
const {draftSchedule}=require('../shared/templates');

test('department tutorial is offered after promotion, independently per membership and only on safe loaded pages',()=>{
  const s={page:'board',sync:{phase:'ready',board:{club:{id:'club'},me:{id:'member',role:'member'}}}};
  assert.equal(canOfferDepartmentTutorial(s,'alice'),false);
  s.sync.board.me.role='department_admin';assert.equal(canOfferDepartmentTutorial(s,'alice'),true);
  for(const page of ['auth','edit','template-edit','experience','account','admin-edit'])assert.equal(canOfferDepartmentTutorial({...s,page},'alice'),false);
  for(const flag of ['busy','error','recovery'])assert.equal(canOfferDepartmentTutorial({...s,[flag]:true},'alice'),false);
  assert.equal(canOfferDepartmentTutorial({...s,sync:{...s.sync,phase:'syncing'}},'alice'),false);
  assert.equal(canOfferDepartmentTutorial(s,null),false);
  for(const status of ['completed','skipped']){
    s.sync.board.me.departmentTemplateGuide={version:VERSION,status};assert.equal(canOfferDepartmentTutorial(s,'alice'),false);
  }
  assert.notEqual(departmentTutorialKey('alice','club'),departmentTutorialKey('alice','other'));
  assert.notEqual(departmentTutorialKey('alice','club'),departmentTutorialKey('bob','club'));
  assert.notEqual(departmentTutorialKey('a:b','c'),departmentTutorialKey('a','b:c'));
});
test('practice example demonstrates the conservative 3 + 1 + 1 day chain and 1 day advance requirement',()=>{
  const t=departmentPracticeTemplate();t.form.schedulingMode='backward';
  const plan=draftSchedule(t.form,t.steps,0),day=86400000;
  assert.deepEqual(plan.map(row=>[row.startAt/day,row.dueAt/day]),[[-6,-3],[-3,-2],[-2,-1]]);
  const task=departmentPracticeTask(t,[{id:'alice'}],Date.parse('2026-11-04T03:00:00Z'));
  assert.equal(task.form.date,'2026-11-18');assert.equal(task.form.hasDuration,true);
  assert.equal(task.form.startTime,'19:00');assert.equal(task.form.endTime,'21:00');
  assert.deepEqual(task.form.participantIds,['alice']);assert.deepEqual(task.form.roles.map(role=>role.participantIds),[[],[]]);
  assert.equal(task.steps[1].dependsOn[0],'copy');assert.ok(draftSchedule(task.form,task.steps)[0].startAt>Date.parse('2026-11-04'));
});
test('practice navigation isolates memberships and preserves edits and role selection on Previous',()=>{
  const store=departmentPracticeDrafts(),key=departmentTutorialKey('alice','club'),members=[{id:'alice'}];
  const template=store.restore('template-edit',key,members);template.form.name='本地改名';template.steps[0].estimateDays=4;
  store.capture({...template,page:'template-edit',guidePractice:true,editBoard:{}},key);
  const task=store.restore('edit',key,members);assert.equal(task.form.name,'本地改名');assert.equal(task.steps[0].estimateDays,4);
  task.form.roles[0].participantIds=['alice'];store.capture({...task,page:'edit',guidePractice:true,editBoard:{}},key);
  const back=store.restore('template-edit',key,members);store.capture({...back,page:'template-edit',guidePractice:true,editBoard:{}},key);
  assert.deepEqual(store.restore('edit',key,members).form.roles[0].participantIds,['alice']);
  assert.notEqual(store.restore('template-edit',departmentTutorialKey('alice','other'),members).form.name,'本地改名');
  back.form.name='真实草稿不能被练习捕获';store.capture({...back,page:'template-edit',editBoard:{}},key);
  assert.equal(store.restore('template-edit',key,members).form.name,'本地改名');
  store.clear(key);assert.equal(store.restore('template-edit',key,members).form.name,'研讨班 · 教程练习');
});
