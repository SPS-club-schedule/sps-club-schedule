const {parts,parseDeadline,hasDuration,taskView}=require('./view');
const {canViewClubDeadlines}=require('./permissions');
const {DEPARTMENTS}=require('./departments');
const {isBookingActivity}=require('./booking-activities');
const DAY=86400000;
function calendarPolicy(me={}) {
  const broad=canViewClubDeadlines(me.role);
  const scopes=['mine',...(broad&&me.department?['department']:[]),...(broad?DEPARTMENTS.filter(d=>d.id!==me.department).map(d=>'department:'+d.id):[]),...(broad?['club']:[])];
  return {scopes,defaultScope:me.role==='department_admin'&&me.department?'department':['owner','admin'].includes(me.role)?'club':'mine'};
}
function selectedScope(me,requested) {
  const policy=calendarPolicy(me);
  return policy.scopes.includes(requested)?requested:policy.defaultScope;
}
function calendarEntries(board,{scope,showDeadlines=true,activities=[]}={},now=Date.now()) {
  if(!board?.me)return {scope:'mine',entries:[]};
  scope=selectedScope(board.me,scope);
  const department=scope.startsWith('department:')?scope.slice(11):board.me.department;
  const ids=new Set(scope==='mine'?[board.me.id]:(board.members||[]).filter(m=>scope==='club'||m.department===department).map(m=>m.id));
  const entries=[];
  for(const task of board.tasks||[]) {
    if(task.archived)continue;
    const base={taskId:task._id,title:task.title,location:task.location||'未定',club:board.club?.name||'SPS',href:'#/task?id='+encodeURIComponent(task._id)};
    if(hasDuration(task))entries.push({...base,key:'activity:'+task._id,kind:'activity',startsAt:task.startsAt,endsAt:task.endsAt});
    const pending=task.mode==='shared'?!task.sharedCompletion:task.participantIds.some(id=>ids.has(id)&&!task.completions?.[id]);
    if(showDeadlines && pending && task.participantIds.some(id=>ids.has(id)) && Number.isSafeInteger(task.dueAt)) {
      entries.push({...base,key:'deadline:'+task._id,kind:'deadline',startsAt:task.dueAt,endsAt:task.dueAt,
        people:task.participantIds.filter(id=>ids.has(id)).map(id=>board.members.find(m=>m.id===id)?.name||'已离开的成员').join('、'),overdue:task.dueAt<now});
    }
  }
  for(const activity of activities)if(isBookingActivity(activity))entries.push({...activity,key:'external:'+activity.id,kind:'external'});
  return {scope,entries};
}
function compactTasks(board,scope,now=Date.now()) {
  const {entries}=calendarEntries(board,{scope},now),byId=new Map();
  for(const entry of entries) {
    if(!byId.has(entry.taskId)) {
      const task=board.tasks.find(t=>t._id===entry.taskId);
      byId.set(entry.taskId,{...taskView(task,board,now),dueAt:undefined,calendarDeadlineVisible:false,done:false,myDone:false,assigned:true});
    }
    if(entry.kind==='deadline')Object.assign(byId.get(entry.taskId),{dueAt:entry.startsAt,calendarDeadlineVisible:true});
  }
  return [...byId.values()];
}
function shiftDate(date,amount) {return parts(parseDeadline(date,'00:00')+amount*DAY).date;}
function plannerDays(date,mode='week',now=Date.now()) {
  try {parseDeadline(date,'00:00');}catch {date=parts(now).date;}
  const first=mode==='day'?date:shiftDate(date,-(new Date(date+'T00:00:00Z').getUTCDay()+6)%7);
  return Array.from({length:mode==='day'?1:7},(_,i)=>{const key=shiftDate(first,i);return {date:key,start:parseDeadline(key,'00:00'),weekday:parts(parseDeadline(key,'12:00')).weekday,today:key===parts(now).date};});
}
// Pack connected overlap groups, so events keep useful widths outside busy hours.
function pack(items) {
  const sorted=items.slice().sort((a,b)=>a.minute-b.minute||b.endMinute-a.endMinute||a.key.localeCompare(b.key));
  let group=[],until=-1;
  const flush=()=>{
    const ends=[];
    for(const item of group){let lane=ends.findIndex(end=>end<=item.minute);if(lane<0)lane=ends.length;ends[lane]=item.visualEnd;item.lane=lane;}
    for(const item of group)item.lanes=ends.length;
  };
  for(const item of sorted){if(item.minute>=until){flush();group=[];until=-1;}group.push(item);until=Math.max(until,item.visualEnd);}
  flush();return sorted;
}
function dayLayout(entries,day) {
  const blocks=[],deadlines=[];
  for(const entry of entries) {
    const deadline=entry.kind==='deadline';
    if(deadline?entry.startsAt<day.start||entry.startsAt>=day.start+DAY:entry.startsAt>=day.start+DAY||entry.endsAt<=day.start)continue;
    const minute=Math.max(0,(entry.startsAt-day.start)/60000);
    const endMinute=deadline?minute:Math.min(1440,(entry.endsAt-day.start)/60000);
    const item={...entry,minute,endMinute,visualEnd:Math.min(1440,Math.max(endMinute,minute+(deadline?22:26)))};
    (deadline?deadlines:blocks).push(item);
  }
  return {blocks:pack(blocks),deadlines:pack(deadlines)};
}
module.exports={calendarPolicy,selectedScope,calendarEntries,compactTasks,shiftDate,plannerDays,dayLayout};
