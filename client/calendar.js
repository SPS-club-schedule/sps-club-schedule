import { deadlineCalendar } from '../shared/calendar';
import { parts, hasDuration, durationLabel } from '../shared/view';
import { bookingPage } from './booking';
import {compactTasks,selectedScope} from '../shared/planner';
import {departmentLabel} from '../shared/departments';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dateLabel = date => `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;

export function calendar(tasks, state, mine, now, booking={},board,settings={}) {
  const scope=board?selectedScope(board.me,settings.scope):null;
  if(board)tasks=compactTasks(board,scope,now);
  const c = deadlineCalendar(tasks, { ...state, mine:board?false:mine, now,activities:booking.activities || [] });
  const monthLabel = `${c.month.slice(0, 4)}年${Number(c.month.slice(5))}月`;
  return `<section class="card deadline-calendar section" aria-labelledby="calendar-heading">
    <div class="row between"><h2 class="h2" id="calendar-heading">任务日历</h2><a class="secondary compact" href="#/calendar" aria-label="打开大日历">展开日历 ↗</a></div>
    <p class="calendar-hint">${board?(scope.startsWith('department:')?departmentLabel(scope.slice(11))+'截止事项':{mine:'我的截止事项',department:'本部门截止事项',club:'全社团截止事项'}[scope]):mine ? '我的未完成任务' : '社团未完成任务'}与社团活动 · 北京时间</p>
    <div class="row between space"><button type="button" class="secondary compact" data-action="exportCalendar">导出我的日程 .ics</button><a class="plain small" href="${bookingPage}" target="_blank" rel="noopener noreferrer">预约总览 ↗</a></div>
    <p class="hint space">导出我负责的未结束活动与待办截止事项。文件是当前快照，任务变化后需重新导出。</p>
    <div class="row between calendar-toolbar">
      <div class="row calendar-month-nav">
        <button type="button" class="calendar-nav" data-action="calendarMonth" data-value="-1" aria-label="上个月">‹</button>
        <h3 class="calendar-month" aria-live="polite">${monthLabel}</h3>
        <button type="button" class="calendar-nav" data-action="calendarMonth" data-value="1" aria-label="下个月">›</button>
      </div>
      <button type="button" class="calendar-reset" data-action="calendarToday">今天</button>
    </div>
    <div class="calendar-grid" aria-label="${monthLabel}截止日期与持续时段">
      ${['一','二','三','四','五','六','日'].map(day => `<span class="calendar-weekday" aria-hidden="true">${day}</span>`).join('')}
      ${c.days.map(day => day ? `<button type="button" class="calendar-day${day.count ? ' has-deadline' : ''}${day.durationCount?' has-duration':''}${day.externalCount?' has-external':''}${day.overdue ? ' is-overdue' : ''}${day.today ? ' is-today' : ''}${c.selected === day.date ? ' is-selected' : ''}" data-action="calendarDate" data-value="${day.date}" aria-pressed="${c.selected === day.date}"${day.today ? ' aria-current="date"' : ''} aria-label="${day.date}，${day.today ? '今天，' : ''}${day.deadlineCount}项未完成任务截止${day.durationCount?'，'+day.durationCount+'项持续任务':''}${day.externalCount?'，'+day.externalCount+'项其他社团活动':''}${day.overdue ? '，含逾期任务' : ''}"><span>${day.day}</span><span class="calendar-count" aria-hidden="true">${day.count ? day.count + '项' : ''}</span>${day.durationCount?'<span class="calendar-duration-mark" aria-hidden="true"></span>':''}${day.externalCount?'<span class="calendar-external-mark" aria-hidden="true"></span>':''}</button>` : '<span aria-hidden="true"></span>').join('')}
    </div>
    <div class="row between calendar-legend"><span><i class="calendar-dot"></i>任务安排 <i class="calendar-duration-key"></i>持续时段</span>${c.overdueCount ? `<button type="button" class="calendar-overdue" data-action="calendarDate" data-value="${c.firstOverdue}">${c.overdueCount} 项已逾期 ↗</button>` : '<span>点日期查看</span>'}</div>
    <p class="hint space"><i class="calendar-external-key"></i> 其他社团活动（不含课程） · ${booking.error?escape(booking.error)+(booking.activities?'，保留上次内容':''):booking.activities?`${c.activityTotal} 项 · ${escape(booking.from)} 至 ${escape(booking.to)}`:'正在连接预约日历…'} <button type="button" class="plain small" data-action="refreshBooking">更新</button></p>
    ${booking.sync?.enabled?`<p class="hint space">SPS 时段同步：${booking.sync.sync && booking.sync.sync.delivered>=booking.sync.sync.desired?'已同步到预约页':booking.sync.sync?.attempts?'连接暂未成功，将自动重试':'正在同步到预约页…'}</p>`:''}
    <div class="calendar-agenda">
      <div class="row between calendar-agenda-heading"><h3 aria-live="polite">${c.selected ? dateLabel(c.selected) : '本月安排'} · ${c.tasks.length} 项</h3>${c.selected ? '<button type="button" class="calendar-reset" data-action="calendarClear">查看整月</button>' : ''}</div>
      ${c.tasks.length ? `<ul class="calendar-agenda-list" tabindex="0" aria-label="${c.selected ? dateLabel(c.selected) : monthLabel}未完成任务">${c.tasks.map(task => {
        if(task.external)return `<li><a class="calendar-task external-activity" href="${bookingPage}" target="_blank" rel="noopener noreferrer"><span class="calendar-task-time duration-tag">社团<br>活动</span><span class="calendar-task-title"><small class="external-club">${escape(task.club)}</small>${escape(task.title)}<small class="calendar-duration-label">${escape(durationLabel(task))}</small><small class="calendar-parent">地点：${escape(task.location || '未定')}</small></span><span class="calendar-task-arrow">↗</span></a></li>`;
        const p = parts(task.dueAt), duration=hasDuration(task);
        const time=duration?'<span class="calendar-task-time duration-tag">持续<br>时段</span>':`<time class="calendar-task-time" datetime="${p.date}T${p.time}:00+08:00">${c.selected ? '' : `<span>${dateLabel(p.date)}</span>`}<span>${p.time}</span></time>`;
        return `<li><a class="calendar-task" href="#/task?id=${encodeURIComponent(task._id)}">${time}<span class="calendar-task-title">${escape(task.title)}${duration?`<small class="calendar-duration-label">${escape(durationLabel(task))}</small><small class="calendar-parent">地点：${escape(task.location || '未定')}${task.calendarDeadlineVisible!==false?` · 截止：${dateLabel(p.date)} ${p.time}`:''}</small>`:''}${task.parentTaskId?`<small class="calendar-parent">${escape(task.parentTitle)}</small>`:''}</span>${task.status === 'overdue' && task.calendarDeadlineVisible!==false ? '<span class="pill overdue">已逾期</span>' : task.priority === 'high' ? '<span class="pill high">优先</span>' : '<span class="calendar-task-arrow" aria-hidden="true">↗</span>'}</a></li>`;
      }).join('')}</ul>` : `<p class="calendar-empty">${!c.total ? '暂无待完成任务，给自己一个小小的鼓励。' : c.selected ? '这一天没有待完成任务安排。' : '本月没有待完成任务安排，可切换月份查看。'}</p>`}
    </div>
  </section>`;
}
