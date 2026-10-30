const { parts, parseDeadline, hasDuration } = require('./view');

function scheduleDraft(task) {
  if (!hasDuration(task || {})) return { hasDuration: false, deadlineFollowsStart: false };
  const start=parts(task.startsAt), end=parts(task.endsAt);
  return { hasDuration:true, startDate:start.date, startTime:start.time, endDate:end.date, endTime:end.time,
    deadlineFollowsStart:task.deadlineFollowsStart ?? task.dueAt===task.startsAt };
}
function followStart(form) {
  form.deadlineFollowsStart=true;
  form.date=form.startDate; form.time=form.startTime;
}
function enableDuration(form, enabled) {
  if (!!form.hasDuration===enabled) return;
  form.hasDuration=enabled;
  if (!enabled) { form.deadlineFollowsStart=false; return; }
  form.startDate=form.date; form.startTime=form.time;
  try { const end=parts(parseDeadline(form.date,form.time)+3600000); form.endDate=end.date; form.endTime=end.time; }
  catch { form.endDate=form.date; form.endTime=form.time; }
  followStart(form);
}
function changeScheduleField(form, name, value) {
  form[name]=value;
  if (form.hasDuration && ['date','time'].includes(name)) form.deadlineFollowsStart=false;
  if (form.hasDuration && form.deadlineFollowsStart && ['startDate','startTime'].includes(name)) followStart(form);
}
function scheduleFields(form) {
  return { dueAt:parseDeadline(form.date,form.time),
    startsAt:form.hasDuration?parseDeadline(form.startDate,form.startTime):null,
    endsAt:form.hasDuration?parseDeadline(form.endDate,form.endTime):null,
    deadlineFollowsStart:!!form.hasDuration && !!form.deadlineFollowsStart };
}
module.exports={scheduleDraft,enableDuration,followStart,changeScheduleField,scheduleFields};
