const MAX_DURATION_MINUTES=5*366*24*60;
const validDurationMinutes=value=>Number.isInteger(value)&&value>0&&value<=MAX_DURATION_MINUTES;
function durationText(value) {
  if (!validDurationMinutes(value)) return '';
  const hours=Math.floor(value/60), minutes=value%60;
  return (hours?hours+' 小时':'')+(hours&&minutes?' ':'')+(minutes?minutes+' 分钟':'');
}
function templateDurationForm(value) {
  return {templateHasDuration:validDurationMinutes(value),durationHours:validDurationMinutes(value)?Math.floor(value/60):1,durationMinutesPart:validDurationMinutes(value)?value%60:0};
}
function templateDurationValue(form) {
  if (!form.templateHasDuration) return null;
  const hours=Number(form.durationHours), minutes=Number(form.durationMinutesPart), total=hours*60+minutes;
  if (String(form.durationHours).trim()==='' || String(form.durationMinutesPart).trim()==='' || !Number.isInteger(hours) || hours<0 || !Number.isInteger(minutes) || minutes<0 || minutes>59 || !validDurationMinutes(total)) throw new Error('默认时长须大于0，小时和分钟须为整数，分钟为0—59，总时长不能超过五年');
  return total;
}
module.exports={MAX_DURATION_MINUTES,validDurationMinutes,durationText,templateDurationForm,templateDurationValue};
