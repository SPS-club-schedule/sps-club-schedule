const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const {personalCalendar}=require('../shared/ical');
const {deadlineCalendar}=require('../shared/calendar');
const {parseDeadline}=require('../shared/view');
const {scheduleDraft,scheduleFields}=require('../shared/schedule-draft');
const {calendarEntries}=require('../shared/planner');
const {isBookingActivity}=require('../shared/booking-activities');
const at=(date,time='12:00')=>parseDeadline(date,time),now=at('2026-10-30');
const board={club:{name:'SPS'},me:{id:'me'},members:[{id:'me',name:'我'}],tasks:[]};
const task=(id,patch={})=>({_id:id,title:id,description:'',participantIds:['me'],completions:{},mode:'individual',dueAt:now+86400000,updatedAt:now,revision:3,...patch});
test('personal ICS exports only my active events/deadlines, including assigned child deadlines',()=>{
  const b={...board,tasks:[task('duration',{startsAt:now+86400000,endsAt:now+90000000,location:'物理楼 301',completions:{me:now}}),task('ddl'),task('child',{parentTaskId:'duration'}),task('done',{completions:{me:now}}),task('other',{participantIds:['other']}),task('archived',{archived:true}),task('ended',{startsAt:now-7200000,endsAt:now-3600000})]};
  const {text,count}=personalCalendar(b,now);assert.equal(count,3);
  assert.equal((text.match(/BEGIN:VEVENT/g)||[]).length,3);assert.equal((text.match(/DTEND:/g)||[]).length,1);
  assert.match(text,/DTSTART:20261031T040000Z/);assert.match(text,/LOCATION:物理楼 301/);assert.match(text,/SUMMARY:\[截止\] child/);
  assert.doesNotMatch(text,/SUMMARY:(done|other|archived|ended)/);assert.match(text,/SEQUENCE:3/);
  assert.equal(personalCalendar(b,now+1000).text,text,'stable IDs/timestamps on repeated export');
});
test('ICS escapes injection and folds Unicode by octets, without losing characters',()=>{
  const title='中文😀'.repeat(35)+'\r\nBEGIN:VEVENT,;\\', result=personalCalendar({...board,tasks:[task('safe',{title,description:'text\nEND:VCALENDAR'})]},now).text;
  assert.equal((result.match(/^BEGIN:VEVENT$/gm)||[]).length,1);
  for(const line of result.split('\r\n'))assert.ok(Buffer.byteLength(line)<=75);
  const unfolded=result.replace(/\r\n /g,'');assert.ok(unfolded.includes('中文😀'.repeat(35)));assert.match(unfolded,/\\nBEGIN:VEVENT\\,\\;\\\\/);
});
test('location opt-in drafts preserve edits and clear published location when disabled',()=>{
  const f={...scheduleDraft({startsAt:now,endsAt:now+3600000,dueAt:now,location:'301'}),date:'2026-10-30',time:'12:00'};
  assert.equal(f.hasLocation,true);assert.equal(scheduleFields(f).location,'301');f.hasLocation=false;assert.equal(scheduleFields(f).location,'');f.hasLocation=true;f.hasDuration=false;assert.equal(scheduleFields(f).location,'');
});
test('other-club activities appear for all members across days/months without changing task overdue counts',()=>{
  const activities=[{id:'external',club:'torchwood',title:'活动',startsAt:at('2026-10-31','23:00'),endsAt:at('2026-11-02','00:00')},{id:'sps:t_'+ 'a'.repeat(32)+':2026-10-30',club:'SPS',title:'不重复',startsAt:now,endsAt:now+3600000}];
  const c=deadlineCalendar([],{mine:true,month:'2026-11',now,activities});
  assert.equal(c.total,0);assert.equal(c.activityTotal,1);assert.equal(c.tasks.length,1);assert.equal(c.overdueCount,0);
  assert.equal(c.days.find(d=>d?.date==='2026-11-01').externalCount,1);assert.equal(c.days.find(d=>d?.date==='2026-11-02').count,0);
});
test('external calendar text is escaped and links only to the booking page; location controls exclude subtasks',async()=>{
  const bundle=buildSync({entryPoints:['client/calendar.js','client/schedule-editor.js'],bundle:true,format:'esm',outdir:'out',write:false});
  const load=file=>import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles.find(f=>f.path.endsWith(file)).text).toString('base64'));
  const {calendar}=await load('calendar.js'),{scheduleEditor}=await load('schedule-editor.js');
  const html=calendar([],{month:'2026-10'},true,now,{activities:[{club:'<img src=x>',title:'<script>',location:'<svg>',startsAt:now,endsAt:now+3600000}],from:'2026-10-30',to:'2026-12-30'});
  assert.doesNotMatch(html,/<script>|<img|<svg/);assert.match(html,/&lt;script&gt;/);assert.match(html,/导出我的日程/);
  assert.match(scheduleEditor({hasDuration:true,hasLocation:true},false,true),/name="location"/);
  assert.doesNotMatch(scheduleEditor({hasDuration:true},true,true),/name="location"/);
});
test('manual SPS bookings survive the API and both calendars while schedule copies are excluded by origin',async()=>{
  const activity={club:'SPS',title:'前沿物理简介',location:'哲生堂 405',startsAt:now,endsAt:now+3600000};
  const manual={...activity,id:'22501ab4-c275-4548-b9b1-920864884151'};
  const second={...activity,id:'292993cb-8207-4ab9-ae9b-6ee2541b9844',title:'线性代数研讨班'};
  const taskId='t_'+'a'.repeat(32),copies=[{...activity,id:'sps:'+taskId+':2026-10-30'},{...activity,id:'sps:tg_'+'b'.repeat(32)+':2026-10-31'}, {...activity,id:'future-origin',source:'sps-schedule'}];
  const activities=[manual,second,{...activity,id:'other',club:'torchwood'},...copies,null,{...manual,endsAt:now}];
  assert.deepEqual(activities.filter(isBookingActivity).map(x=>x.id),[manual.id,second.id,'other']);
  const compact=deadlineCalendar([],{month:'2026-10',date:'2026-10-30',now,activities});
  assert.equal(compact.activityTotal,3);assert.equal(compact.days.find(d=>d?.date==='2026-10-30').externalCount,3);
  assert.ok(compact.tasks.some(x=>x.title===second.title));
  const b={...board,tasks:[task(taskId,{...activity})]};
  const expanded=calendarEntries(b,{showDeadlines:false,activities},now);
  assert.equal(expanded.entries.filter(x=>x.kind==='activity').length,1);
  assert.equal(expanded.entries.filter(x=>x.kind==='external').length,3);
  assert.equal(expanded.entries.filter(x=>x.title===activity.title).length,3,'native task, manual SPS booking and another club retain their own identities');
  const bundle=buildSync({entryPoints:['client/booking.js'],bundle:true,format:'esm',write:false});
  const client=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const originalFetch=global.fetch;
  try {
    global.fetch=async()=>Response.json({from:'2026-10-30',to:'2026-12-30',activities});
    assert.deepEqual((await client.otherActivities()).activities.map(x=>x.id),[manual.id,second.id,'other']);
  }finally{global.fetch=originalFetch;}
});
