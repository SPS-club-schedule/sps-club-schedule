import { deadlineCalendar } from '../shared/calendar';
import { parts } from '../shared/view';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dateLabel = date => `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;

export function calendar(tasks, state, mine, now) {
  const c = deadlineCalendar(tasks, { ...state, mine, now });
  const monthLabel = `${c.month.slice(0, 4)}年${Number(c.month.slice(5))}月`;
  return `<section class="card deadline-calendar section" aria-labelledby="calendar-heading">
    <div class="row between"><h2 class="h2" id="calendar-heading">截止日历</h2><span class="calendar-total">${c.total} 项待完成</span></div>
    <p class="calendar-hint">${mine ? '我的未完成任务' : '社团未完成任务'} · 北京时间</p>
    <div class="row between calendar-toolbar">
      <div class="row calendar-month-nav">
        <button type="button" class="calendar-nav" data-action="calendarMonth" data-value="-1" aria-label="上个月">‹</button>
        <h3 class="calendar-month" aria-live="polite">${monthLabel}</h3>
        <button type="button" class="calendar-nav" data-action="calendarMonth" data-value="1" aria-label="下个月">›</button>
      </div>
      <button type="button" class="calendar-reset" data-action="calendarToday">今天</button>
    </div>
    <div class="calendar-grid" aria-label="${monthLabel}截止日期">
      ${['一','二','三','四','五','六','日'].map(day => `<span class="calendar-weekday" aria-hidden="true">${day}</span>`).join('')}
      ${c.days.map(day => day ? `<button type="button" class="calendar-day${day.count ? ' has-deadline' : ''}${day.overdue ? ' is-overdue' : ''}${day.today ? ' is-today' : ''}${c.selected === day.date ? ' is-selected' : ''}" data-action="calendarDate" data-value="${day.date}" aria-pressed="${c.selected === day.date}"${day.today ? ' aria-current="date"' : ''} aria-label="${day.date}，${day.today ? '今天，' : ''}${day.count}项未完成任务截止${day.overdue ? '，含逾期任务' : ''}"><span>${day.day}</span><span class="calendar-count" aria-hidden="true">${day.count ? day.count + '项' : ''}</span></button>` : '<span aria-hidden="true"></span>').join('')}
    </div>
    <div class="row between calendar-legend"><span><i class="calendar-dot"></i>有任务截止</span>${c.overdueCount ? `<button type="button" class="calendar-overdue" data-action="calendarDate" data-value="${c.firstOverdue}">${c.overdueCount} 项已逾期 ↗</button>` : '<span>点日期查看任务</span>'}</div>
    <div class="calendar-agenda">
      <div class="row between calendar-agenda-heading"><h3 aria-live="polite">${c.selected ? dateLabel(c.selected) : '本月截止'} · ${c.tasks.length} 项</h3>${c.selected ? '<button type="button" class="calendar-reset" data-action="calendarClear">查看整月</button>' : ''}</div>
      ${c.tasks.length ? `<ul class="calendar-agenda-list" tabindex="0" aria-label="${c.selected ? dateLabel(c.selected) : monthLabel}未完成任务">${c.tasks.map(task => {
        const p = parts(task.dueAt);
        return `<li><a class="calendar-task" href="#/task?id=${encodeURIComponent(task._id)}"><time class="calendar-task-time" datetime="${p.date}T${p.time}:00+08:00">${c.selected ? '' : `<span>${dateLabel(p.date)}</span>`}<span>${p.time}</span></time><span class="calendar-task-title">${escape(task.title)}${task.parentTaskId?`<small class="calendar-parent">${escape(task.parentTitle)}</small>`:''}</span>${task.status === 'overdue' ? '<span class="pill overdue">已逾期</span>' : task.priority === 'high' ? '<span class="pill high">优先</span>' : '<span class="calendar-task-arrow" aria-hidden="true">↗</span>'}</a></li>`;
      }).join('')}</ul>` : `<p class="calendar-empty">${!c.total ? '暂无待完成任务，给自己一个小小的鼓励。' : c.selected ? '这一天没有待完成任务截止。' : '本月没有待完成任务截止，可切换月份查看。'}</p>`}
    </div>
  </section>`;
}
