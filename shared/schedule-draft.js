const { parts, parseDeadline, hasDuration } = require('./view');
const { validDurationMinutes } = require('./template-duration');

function scheduleDraft(task) {
  if (!hasDuration(task || {})) return { hasDuration: false, deadlineFollowsStart: false };
  const start=parts(task.startsAt), end=parts(task.endsAt);
  return { hasDuration:true, startDate:start.date, startTime:start.time, endDate:end.date, endTime:end.time,
    deadlineFollowsStart:task.deadlineFollowsStart ?? task.dueAt===task.startsAt,location:task.location || '',hasLocation:!!task.location };
}
function followStart(form) {
  form.deadlineFollowsStart=true;
  form.date=form.startDate; form.time=form.startTime;
}
function enableDuration(form, enabled) {
  if (!!form.hasDuration===enabled) return;
  form.hasDuration=enabled;
  if (!enabled) { form.deadlineFollowsStart=false; form.endFollowsDuration=false; return; }
  form.startDate=form.date; form.startTime=form.time;
  form.endFollowsDuration=validDurationMinutes(form.durationMinutes);
  try { const end=parts(parseDeadline(form.date,form.time)+(form.endFollowsDuration?form.durationMinutes:60)*60000); form.endDate=end.date; form.endTime=end.time; }
  catch { form.endDate=form.date; form.endTime=form.time; }
  followStart(form);
}
function followDuration(form) {
  if (!form.hasDuration || !validDurationMinutes(form.durationMinutes)) return;
  form.endFollowsDuration=true;
  const end=parts(parseDeadline(form.startDate,form.startTime)+form.durationMinutes*60000);
  form.endDate=end.date; form.endTime=end.time;
}
function applyTemplateDuration(form, minutes) {
  form.durationMinutes=minutes;
  if (!validDurationMinutes(minutes)) { enableDuration(form,false); return; }
  enableDuration(form,true);
  // Keep an already-chosen start and any manual deadline when replacing a template.
  followDuration(form);
}
function changeScheduleField(form, name, value) {
  form[name]=value;
  if (form.hasDuration && ['date','time'].includes(name)) form.deadlineFollowsStart=false;
  if (form.hasDuration && ['endDate','endTime'].includes(name)) form.endFollowsDuration=false;
  if (form.hasDuration && form.endFollowsDuration && ['startDate','startTime'].includes(name)) {
    // Date/time inputs may be incomplete while typing. Submit validates them.
    try { followDuration(form); } catch {}
  }
  if (form.hasDuration && form.deadlineFollowsStart && ['startDate','startTime'].includes(name)) followStart(form);
}
function scheduleFields(form) {
  return { dueAt:parseDeadline(form.date,form.time),
    startsAt:form.hasDuration?parseDeadline(form.startDate,form.startTime):null,
    endsAt:form.hasDuration?parseDeadline(form.endDate,form.endTime):null,
    deadlineFollowsStart:!!form.hasDuration && !!form.deadlineFollowsStart,
    location:form.hasDuration && form.hasLocation?form.location || '':'' };
}
module.exports={scheduleDraft,enableDuration,followStart,followDuration,applyTemplateDuration,changeScheduleField,scheduleFields};
