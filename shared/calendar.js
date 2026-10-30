const { parts, parseDeadline, hasDuration } = require('./view');

// Calendar arithmetic uses UTC month anchors; deadlines use the app's UTC+8 dates.
function shiftMonth(month, amount) {
  const anchor = new Date(`${month}-01T00:00:00Z`);
  anchor.setUTCMonth(anchor.getUTCMonth() + amount);
  return anchor.toISOString().slice(0, 7);
}

function deadlineCalendar(tasks, { mine = false, month, date = '', now = Date.now() } = {}) {
  const today = parts(now).date;
  month = month || today.slice(0, 7);
  const pending = tasks.filter(t => !t.archived && (mine ? t.assigned && !t.myDone : !t.done))
    .slice().sort((a, b) => a.dueAt - b.dueAt || a.title.localeCompare(b.title, 'zh-CN'));
  const monthStart=parseDeadline(month+'-01','00:00'), monthEnd=parseDeadline(shiftMonth(month,1)+'-01','00:00');
  const overlaps=(task,start,end)=>hasDuration(task) && task.startsAt<end && task.endsAt>start;
  const monthTasks = pending.filter(t => (t.dueAt>=monthStart && t.dueAt<monthEnd) || overlaps(t,monthStart,monthEnd));
  const grouped = new Map();
  const order=start=>(a,b)=>{
    const time=t=>overlaps(t,start,start+86400000)?Math.max(t.startsAt,start):t.dueAt;
    return time(a)-time(b) || a.title.localeCompare(b.title,'zh-CN');
  };
  const first = new Date(`${month}-01T00:00:00Z`);
  const offset = (first.getUTCDay() + 6) % 7; // Monday first.
  const count = new Date(`${shiftMonth(month, 1)}-01T00:00:00Z`).getTime() - first.getTime();
  const dayCount = count / 86400000;
  const days = Array.from({ length: Math.ceil((offset + dayCount) / 7) * 7 }, (_, index) => {
    const day = index - offset + 1;
    if (day < 1 || day > dayCount) return null;
    const key = `${month}-${String(day).padStart(2, '0')}`;
    const start=monthStart+(day-1)*86400000, end=start+86400000;
    const due = monthTasks.filter(t=>t.dueAt>=start && t.dueAt<end);
    const durations=monthTasks.filter(t=>overlaps(t,start,end));
    const entries=[...new Set([...due,...durations])].sort(order(start));
    grouped.set(key,entries);
    return { date: key, day, count: entries.length, deadlineCount:due.length, durationCount:durations.length, overdue: due.some(t => t.dueAt < now), today: key === today };
  });
  const selected = date.startsWith(month + '-') && days.some(d => d?.date === date) ? date : '';
  const overdue = pending.filter(t => t.dueAt < now);
  return {
    month, today, days, selected, total: pending.length, monthCount: monthTasks.length,
    overdueCount: overdue.length, firstOverdue: overdue.length ? parts(overdue[0].dueAt).date : '',
    tasks: selected ? grouped.get(selected) || [] : monthTasks.sort((a,b)=>{
      const time=t=>overlaps(t,monthStart,monthEnd)?Math.max(t.startsAt,monthStart):t.dueAt;
      return time(a)-time(b) || a.title.localeCompare(b.title,'zh-CN');
    })
  };
}

module.exports = { deadlineCalendar, shiftMonth };
