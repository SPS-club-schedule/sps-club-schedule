const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const {calendarPolicy,calendarEntries,compactTasks,plannerDays,dayLayout}=require('../shared/planner');
const {parseDeadline}=require('../shared/view');
const {canEditMember,canAssignRole,canEditLogin,canEditProfile,roleLabel}=require('../shared/permissions');
const at=(day,time='12:00')=>parseDeadline(day,time),now=at('2026-10-30');
const members=[{id:'me',name:'我',role:'member',department:'academic'},{id:'same',name:'同部门',role:'member',department:'academic'},{id:'other',name:'其他部门',role:'member',department:'publicity'}];
const task=(id,ids,extra={})=>({_id:id,title:id,participantIds:ids,mode:'individual',completions:{},dueAt:now+3600000,creatorId:'me',...extra});
const board={club:{name:'SPS'},me:members[0],members,tasks:[task('mine',['me']),task('department',['same']),task('other',['other']),task('activity',['other'],{startsAt:now,endsAt:now+7200000}),task('child',['me'],{parentTaskId:'activity'}),task('done',['me'],{completions:{me:now}})]};
const deadlines=result=>result.entries.filter(e=>e.kind==='deadline').map(e=>e.taskId);
test('deadline scopes clamp ordinary and web admins to self; department and combined admins have deliberate broader scopes',()=>{
  for(const role of ['member','web_admin']){
    const b={...board,me:{...board.me,role}};
    assert.deepEqual(calendarPolicy(b.me).scopes,['mine']);
    assert.deepEqual(deadlines(calendarEntries(b,{scope:'club'},now)),['mine','child']);
  }
  const b={...board,me:{...board.me,role:'department_admin'}};
  assert.deepEqual(deadlines(calendarEntries(b,{},now)),['mine','department','child']);
  assert.deepEqual(deadlines(calendarEntries(b,{scope:'club'},now)),['mine','department','other','activity','child']);
  assert.ok(calendarPolicy({role:'owner'}).scopes.includes('department:academic'));
  assert.deepEqual(deadlines(calendarEntries(b,{scope:'department:publicity'},now)),['other','activity']);
  assert.equal(calendarEntries({...b,me:{...b.me,role:'member'}},{scope:'club'},now).scope,'mine');
});
test('turning deadlines off preserves duration blocks and external activities without leaking hidden deadlines through the compact agenda',()=>{
  const activities=[{id:'a',club:'torchwood',title:'活动',startsAt:now,endsAt:now+3600000},{id:'sps',club:'SPS',startsAt:now,endsAt:now+3600000}];
  const result=calendarEntries(board,{showDeadlines:false,activities},now);
  assert.deepEqual(result.entries.map(e=>e.kind),['activity','external']);
  const compact=compactTasks(board,'club',now);
  assert.equal(compact.find(t=>t._id==='activity').dueAt,undefined);
  assert.equal(compact.find(t=>t._id==='activity').calendarDeadlineVisible,false);
  assert.ok(!compact.some(t=>t._id==='other'));
  const b={...board,tasks:[task('part',['me','same'],{completions:{me:now}})]};
  assert.equal(deadlines(calendarEntries(b,{},now)).length,0);
  assert.equal(deadlines(calendarEntries({...b,me:{...b.me,role:'department_admin'}},{},now)).length,1);
});
test('time grid packs simultaneous activities, splits overnight blocks, keeps deadlines at exact minutes and excludes midnight endings',()=>{
  const days=plannerDays('2026-11-01','week',now);
  assert.equal(days[0].date,'2026-10-26');assert.equal(days[6].date,'2026-11-01');
  const d=plannerDays('2026-11-01','day',now)[0];
  const entries=[{key:'a',kind:'activity',startsAt:at('2026-10-31','23:00'),endsAt:at('2026-11-02','00:00')},{key:'b',kind:'activity',startsAt:at('2026-11-01','10:00'),endsAt:at('2026-11-01','11:00')},{key:'ddl',kind:'deadline',startsAt:at('2026-11-01','23:59')},{key:'ended',kind:'activity',startsAt:at('2026-10-31','22:00'),endsAt:d.start}];
  const layout=dayLayout(entries,d);
  assert.equal(layout.blocks.length,2);assert.equal(layout.blocks[0].minute,0);assert.equal(layout.blocks[0].endMinute,1440);
  assert.equal(layout.blocks[0].lanes,2);assert.notEqual(layout.blocks[0].lane,layout.blocks[1].lane);
  assert.equal(layout.deadlines[0].minute,1439);
  assert.equal(dayLayout(entries,plannerDays('2026-11-02','day',now)[0]).blocks.length,0);
});
test('public labels hide hierarchy; account/profile capabilities and role assignment respect both rank and department',()=>{
  const member={id:'member',role:'member',department:'academic'},dept={id:'dept',role:'department_admin',department:'academic'},web={id:'web',role:'web_admin'},general={id:'general',role:'admin'};
  for(const role of ['owner','admin','department_admin','web_admin'])assert.equal(roleLabel(role),'管理员');
  assert.equal(canEditMember(dept,member),true);assert.equal(canEditMember(dept,{...member,department:'publicity'}),false);
  assert.equal(canEditMember(dept,web),false);assert.equal(canEditMember(web,dept),false);
  assert.equal(canEditMember(general,general),false);
  assert.equal(canEditLogin(dept,member),false);assert.equal(canEditProfile(web,member),false);
  assert.equal(canAssignRole(general,member,'department_admin'),true);assert.equal(canAssignRole(general,member,'admin'),false);
  assert.equal(canAssignRole(dept,member,'web_admin'),false);
});
test('large calendar renders only permitted deadline titles, escapes content, and keeps all-day controls reachable',async()=>{
  const bundle=buildSync({entryPoints:['client/planner.js'],bundle:true,format:'esm',write:false});
  const {planner}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const b={...board,tasks:board.tasks.map(t=>({...t,title:t._id==='mine'?'<img src=x>':t.title}))};
  const html=planner({sync:{board:b},booking:{activities:[]}},{date:'2026-10-30',mode:'day',scope:'club'});
  assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;img src=x&gt;'));
  assert.ok(!html.includes('value="club"'));assert.ok(!html.includes('value="department"'));
  assert.match(html,/class="deadline-line/);assert.match(html,/显示截止事项/);
  const hidden=planner({sync:{board:b}},{date:'2026-10-30',showDeadlines:false});assert.ok(!hidden.includes('class="deadline-line'));
});
