const { parts } = require('./view');

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
  const monthTasks = pending.filter(t => parts(t.dueAt).date.startsWith(month + '-'));
  const grouped = new Map();
  for (const task of monthTasks) {
    const key = parts(task.dueAt).date;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(task);
  }
  const first = new Date(`${month}-01T00:00:00Z`);
  const offset = (first.getUTCDay() + 6) % 7; // Monday first.
  const count = new Date(`${shiftMonth(month, 1)}-01T00:00:00Z`).getTime() - first.getTime();
  const dayCount = count / 86400000;
  const days = Array.from({ length: Math.ceil((offset + dayCount) / 7) * 7 }, (_, index) => {
    const day = index - offset + 1;
    if (day < 1 || day > dayCount) return null;
    const key = `${month}-${String(day).padStart(2, '0')}`;
    const due = grouped.get(key) || [];
    return { date: key, day, count: due.length, overdue: due.some(t => t.dueAt < now), today: key === today };
  });
  const selected = date.startsWith(month + '-') && days.some(d => d?.date === date) ? date : '';
  const overdue = pending.filter(t => t.dueAt < now);
  return {
    month, today, days, selected, total: pending.length, monthCount: monthTasks.length,
    overdueCount: overdue.length, firstOverdue: overdue.length ? parts(overdue[0].dueAt).date : '',
    tasks: selected ? grouped.get(selected) || [] : monthTasks
  };
}

module.exports = { deadlineCalendar, shiftMonth };
