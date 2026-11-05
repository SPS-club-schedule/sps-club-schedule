'use strict';
const {hasDuration, parts, parseDeadline}=require('./view');
const {plannerDays,selectedScope}=require('./planner');
const QUARTER=15*60000;
// Match only whole headings in the same club, never a fuzzy or substring match.
const normalizeHeading=value=>String(value||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
function matchingParents(tasks,title) {
  const key=normalizeHeading(title);
  return key?tasks.filter(t=>!t.archived&&!t.parentTaskId&&normalizeHeading(t.title)===key):[];
}
function simpleEntries(board,scope='mine') {
  const tasks=board?.tasks||[], members=board?.members||[];
  scope=selectedScope(board.me,scope);
  const department=scope.startsWith('department:')?scope.slice(11):board.me.department;
  const ids=new Set(scope==='mine'?[board.me.id]:members.filter(m=>scope==='club'||m.department===department).map(m=>m.id));
  return tasks.filter(t=>!t.archived&&!t.simpleContainer&&(t.participantIds.some(id=>ids.has(id))||scope==='club'&&t.guestParticipants?.length)).map(t=>{
    const parent=t.parentTaskId?tasks.find(p=>p._id===t.parentTaskId):null;
    return {key:t._id,taskId:t._id,major:parent?.title||(t.parentTaskId?'相关活动':t.title),minor:t.parentTaskId?t.title:'',
      startsAt:hasDuration(t)?t.startsAt:t.dueAt,endsAt:hasDuration(t)?t.endsAt:t.dueAt,kind:hasDuration(t)?'block':'deadline',
      people:[...t.participantIds.map(id=>members.find(m=>m.id===id)?.name||'已离开的成员'),...(t.guestParticipants||[]).map(p=>p.name)].join('、')};
  });
}
function simpleDays(date,mode) {
  if(mode==='three')return [0,1,2].map(n=>plannerDays(parts(parseDeadline(date,'00:00')+n*86400000).date,'day')[0]);
  return plannerDays(date,mode);
}
function blockLayout(entries,day) {
  const items=entries.filter(t=>t.kind==='block'&&t.startsAt<day.start+86400000&&t.endsAt>day.start).map(t=>({...t,
    start:Math.max(0,(t.startsAt-day.start)/QUARTER),end:Math.min(96,(t.endsAt-day.start)/QUARTER)})).sort((a,b)=>a.start-b.start||b.end-a.end||a.key.localeCompare(b.key));
  let group=[],until=-1;
  const flush=()=>{const ends=[];for(const t of group){let lane=ends.findIndex(end=>end<=t.start);if(lane<0)lane=ends.length;ends[lane]=Math.max(t.end,t.start+1);t.lane=lane;}for(const t of group)t.lanes=ends.length;};
  for(const t of items){if(t.start>=until){flush();group=[];until=-1;}group.push(t);until=Math.max(until,t.end,t.start+1);}flush();return items;
}
function selectionRange(date,anchor,current) {
  const a=Math.max(0,Math.min(95,Math.floor(anchor))),b=Math.max(0,Math.min(95,Math.floor(current)));
  const day=parseDeadline(date,'00:00');
  return {startsAt:day+Math.min(a,b)*QUARTER,endsAt:day+(Math.max(a,b)+1)*QUARTER};
}
module.exports={QUARTER,normalizeHeading,matchingParents,simpleEntries,simpleDays,blockLayout,selectionRange};
