const pad = value => String(value).padStart(2, '0');
function parts(time) {
  const d = new Date(time + 8 * 3600000);
  return { date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`, weekday: '日一二三四五六'[d.getUTCDay()] };
}
function parseDeadline(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new Error('请选择截止日期和时间');
  const value = Date.parse(`${date}T${time}:00+08:00`);
  if (!Number.isFinite(value) || parts(value).date !== date || parts(value).time !== time) throw new Error('截止日期或时间无效');
  return value;
}
function dueLabel(timestamp, now) {
  const p = parts(timestamp); const today = parts(now).date;
  const tomorrow = parts(now + 86400000).date;
  return `${p.date === today ? '今天' : p.date === tomorrow ? '明天' : p.date.slice(5).replace('-', '月') + '日'} ${p.time}`;
}
function hasDuration(task) {
  return !task.parentTaskId && Number.isSafeInteger(task.startsAt) && Number.isSafeInteger(task.endsAt) && task.endsAt>task.startsAt;
}
function durationLabel(task) {
  if (!hasDuration(task)) return '';
  const start=parts(task.startsAt), end=parts(task.endsAt);
  return `${start.date} ${start.time} — ${start.date===end.date?'':end.date+' '}${end.time}`;
}
function taskView(task, board, now = Date.now()) {
  const { me, members } = board;
  const participants = task.participantIds.map(id => {
    const member = members.find(m => m.id === id) || { id, name: '已离开的成员' };
    const completedAt = task.mode === 'individual' ? task.completions[id] : task.sharedCompletion && task.sharedCompletion.memberId === id ? task.sharedCompletion.at : null;
    return Object.assign({}, member, { initial: member.name.slice(0, 1), done: !!completedAt, completionLabel: completedAt ? dueLabel(completedAt, now) : '待完成' });
  });
  const count = task.mode === 'individual' ? participants.filter(p => p.done).length : task.sharedCompletion ? 1 : 0;
  const total = task.mode === 'individual' ? participants.length : 1;
  const done = count === total;
  const assigned = task.participantIds.includes(me.id);
  const myDone = task.mode === 'individual' ? !!task.completions[me.id] : done;
  const canManage = me.role === 'owner' || me.id === task.creatorId || me.id === task.parentCreatorId;
  const canToggle = task.mode === 'individual' ? assigned : done ? canManage || task.sharedCompletion.memberId === me.id : assigned;
  const creator = members.find(m => m.id === task.creatorId);
  return Object.assign({}, task, {
    hasDuration:hasDuration(task), durationLabel:durationLabel(task),
    parentTitle: task.parentTaskId ? (board.tasks || []).find(t => t._id === task.parentTaskId)?.title || '主任务' : '',
    participants, count, total, done, assigned, myDone, canToggle, canManage,
    creatorName: creator ? creator.name : '社团成员',
    modeLabel: task.mode === 'individual' ? '逐人完成' : '协作完成',
    status: done ? 'done' : task.dueAt < now ? 'overdue' : task.dueAt - now < 86400000 ? 'soon' : 'open',
    statusLabel: done ? '已完成' : task.dueAt < now ? '已逾期' : task.dueAt - now < 86400000 ? '即将截止' : '进行中',
    dueLabel: dueLabel(task.dueAt, now), fullDue: parts(task.dueAt).date + ' ' + parts(task.dueAt).time,
    percent: Math.round(count / total * 100),
    participantLabel: participants.length === members.length ? '全体成员' : participants.map(p => p.name).join('、'),
    progressLabel: task.mode === 'individual' ? `${count}/${total} 人完成` : done ? `${(members.find(m => m.id === task.sharedCompletion.memberId) || {}).name || '成员'}已完成` : `${participants.length} 位负责人`,
    actionLabel: myDone ? task.mode === 'shared' ? '重新打开任务' : '撤销我的完成' : task.mode === 'shared' ? '完成这项任务' : '标记我已完成'
  });
}
module.exports = { parts, parseDeadline, taskView, hasDuration, durationLabel };
