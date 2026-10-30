const DAY = 86400000;
const MAX_STEPS = 20;
const { parseDeadline } = require('./view');
const { resolveParticipants } = require('./assignments');
function seminarTemplate() {
  return {
    name: '研讨班 Seminar', category: '学术活动', title: '研讨班', description: '',
    mode: 'individual', priority: 'normal', participantIds: [],
    steps: [
      ['预约教室', 4], ['制作海报', 3], ['撰写宣传文案', 3],
      ['向各院系群转发宣传', 2], ['完成 PPT 或讲义', 1]
    ].map(([title, daysBefore]) => ({ title, daysBefore, description: '', mode: 'individual', priority: 'normal', participantIds: [] }))
  };
}
function relativeDeadline(mainDueAt, daysBefore) {
  if (!Number.isSafeInteger(mainDueAt)) throw new Error('请先设置主任务的截止日期和时间');
  if (!Number.isInteger(daysBefore) || daysBefore < 0 || daysBefore > 365) throw new Error('提前天数须为0—365的整数');
  // Beijing has no daylight-saving shift: retain the main task's clock time.
  return mainDueAt - daysBefore * DAY;
}
function templateDraft(template, members) {
  const ids = new Set(members.map(m => m.id));
  const copy = item => ({ title: item.title, description: item.description, mode: item.mode, priority: item.priority, participantDepartment: item.participantDepartment || '', participantIds: resolveParticipants({ ...item, followMain: false }, members).filter(id => ids.has(id)) });
  return { ...copy(template), steps: template.steps.map(step => ({ ...copy(step), followMain: step.followMain === true, daysBefore: step.daysBefore, customDeadline: false })) };
}
function draftDeadline(main, step) {
  return step.customDeadline ? parseDeadline(step.date, step.time) : relativeDeadline(parseDeadline(main.date, main.time), step.daysBefore);
}
module.exports = { DAY, MAX_STEPS, seminarTemplate, relativeDeadline, templateDraft, draftDeadline };
