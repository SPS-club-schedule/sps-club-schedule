const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const { taskView, parseDeadline } = require('../shared/view');
const { deadlineCalendar, shiftMonth } = require('../shared/calendar');

const now = parseDeadline('2026-10-29', '12:00');
const board = { me: { id: 'me', role: 'member' }, members: [{ id: 'me', name: '我' }, { id: 'other', name: '同学' }] };
const task = (id, date, time = '20:00', patch = {}) => ({
  _id: id, title: id, dueAt: parseDeadline(date, time), mode: 'individual',
  participantIds: ['me', 'other'], creatorId: 'me', completions: {}, priority: 'normal', ...patch
});
const calendar = (tasks, options = {}) => deadlineCalendar(tasks.map(t => taskView(t, board, now)), { now, ...options });

test('club and personal calendars follow individual and shared completion rules', () => {
  const tasks = [
    task('pending', '2026-10-29'),
    task('my-part-done', '2026-10-29', '20:00', { completions: { me: now } }),
    task('fully-done', '2026-10-29', '20:00', { completions: { me: now, other: now } }),
    task('unassigned', '2026-10-29', '20:00', { participantIds: ['other'] }),
    task('shared-open', '2026-10-29', '20:00', { mode: 'shared' }),
    task('shared-done', '2026-10-29', '20:00', { mode: 'shared', sharedCompletion: { memberId: 'other', at: now } }),
    task('archived', '2026-10-29', '20:00', { archived: true })
  ];
  assert.deepEqual(new Set(calendar(tasks).tasks.map(t => t._id)), new Set(['pending', 'my-part-done', 'unassigned', 'shared-open']));
  assert.deepEqual(new Set(calendar(tasks, { mine: true }).tasks.map(t => t._id)), new Set(['pending', 'shared-open']));
});

test('UTC+8 midnight and month boundaries group deadlines independent of host time zone', () => {
  const tasks = [task('last-minute', '2026-10-31', '23:59'), task('midnight', '2026-11-01', '00:00')];
  const oct = calendar(tasks);
  assert.equal(oct.total, 2);
  assert.deepEqual(oct.tasks.map(t => t._id), ['last-minute']);
  const nov = calendar(tasks, { month: '2026-11', now: Date.parse('2026-10-31T16:00:00Z') });
  assert.equal(nov.today, '2026-11-01');
  assert.equal(nov.days.find(d => d?.today).date, '2026-11-01');
  assert.deepEqual(nov.tasks.map(t => t._id), ['midnight']);
});

test('multiple deadlines are sorted and counted; old overdue tasks remain reachable across months', () => {
  const tasks = [task('late', '2026-10-29', '23:00'), task('previous-month', '2026-09-30'), task('early', '2026-10-29', '09:00')];
  const result = calendar(tasks, { date: '2026-10-29' });
  assert.equal(result.monthCount, 2);
  assert.equal(result.overdueCount, 2);
  assert.equal(result.firstOverdue, '2026-09-30');
  assert.deepEqual(result.tasks.map(t => t._id), ['early', 'late']);
  const day = result.days.find(d => d?.date === '2026-10-29');
  assert.equal(day.count, 2); assert.equal(day.overdue, true); assert.equal(day.today, true);
  assert.equal(calendar(tasks, { date: '2026-10-30' }).tasks.length, 0);
});

test('month grids handle Monday starts, Sunday starts, leap years and four to six weeks', () => {
  for (const [month, offset, count, cells] of [['2021-02', 0, 28, 28], ['2024-02', 3, 29, 35], ['2026-11', 6, 30, 42]]) {
    const result = calendar([], { month });
    assert.equal(result.days.length, cells);
    assert.equal(result.days.findIndex(Boolean), offset);
    assert.equal(result.days.filter(Boolean).length, count);
    assert.equal(result.days.filter(Boolean).at(-1).day, count);
  }
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
});

test('calendar recomputes completion, reopening, changed deadlines and archives without stale markers', () => {
  const t = task('live', '2026-10-29');
  assert.equal(calendar([t], { mine: true }).total, 1);
  t.completions.me = now;
  assert.equal(calendar([t], { mine: true }).total, 0);
  assert.equal(calendar([t]).total, 1);
  t.completions.other = now;
  assert.equal(calendar([t]).total, 0);
  delete t.completions.me;
  assert.equal(calendar([t]).total, 1);
  t.dueAt = parseDeadline('2026-11-01', '10:00');
  assert.equal(calendar([t]).monthCount, 0);
  assert.equal(calendar([t], { month: '2026-11' }).monthCount, 1);
  t.archived = true;
  assert.equal(calendar([t], { month: '2026-11' }).total, 0);
});

test('empty months and stale date selections return a usable month view', () => {
  const tasks = [task('next-month', '2026-11-01')];
  assert.equal(calendar(tasks).tasks.length, 0);
  const next = calendar(tasks, { month: '2026-11', date: '2026-10-31' });
  assert.equal(next.selected, '');
  assert.equal(next.tasks.length, 1);
  assert.equal(calendar(tasks, { month: '2026-11', date: '2026-11-31' }).selected, '');
});

test('duration covers every intersecting date across months, excluding an end at midnight, with no duplicate deadline counts',()=>{
  const t=task('overnight','2026-10-31','23:00',{startsAt:parseDeadline('2026-10-31','23:00'),endsAt:parseDeadline('2026-11-03','00:00')});
  const oct=calendar([t]);
  const day=oct.days.find(d=>d?.date==='2026-10-31');
  assert.equal(day.count,1); assert.equal(day.deadlineCount,1); assert.equal(day.durationCount,1);
  const nov=calendar([t],{month:'2026-11'});
  assert.equal(nov.monthCount,1); assert.equal(nov.tasks.length,1);
  assert.equal(nov.days.find(d=>d?.day===1).durationCount,1);
  assert.equal(nov.days.find(d=>d?.day===2).durationCount,1);
  assert.equal(nov.days.find(d=>d?.day===3).count,0);
  assert.equal(calendar([t],{month:'2026-11',date:'2026-11-02'}).tasks[0]._id,t._id);
});

test('manual deadlines outside duration remain visible; completion, removal and subtasks obey existing calendar rules',()=>{
  const t=task('range','2026-10-29','20:00',{startsAt:parseDeadline('2026-11-02','10:00'),endsAt:parseDeadline('2026-11-02','12:00')});
  assert.equal(calendar([t],{date:'2026-10-29'}).tasks.length,1);
  assert.equal(calendar([t],{month:'2026-11',date:'2026-11-02'}).tasks.length,1);
  assert.equal(calendar([{...t,parentTaskId:'parent'}],{month:'2026-11'}).monthCount,0);
  assert.equal(calendar([{...t,startsAt:null,endsAt:null}],{month:'2026-11'}).monthCount,0);
  t.completions.me=now;
  assert.equal(calendar([t],{mine:true,month:'2026-11'}).monthCount,0);
  assert.equal(calendar([t],{month:'2026-11'}).monthCount,1);
  t.completions.other=now;
  assert.equal(calendar([t],{month:'2026-11'}).monthCount,0);
});

test('duration calendar renders start/end times, an independent deadline and accessible day markers',async()=>{
  const bundle=buildSync({entryPoints:['client/calendar.js'],bundle:true,format:'esm',write:false});
  const {calendar:render}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const t=task('duration','2026-10-30','18:00',{startsAt:parseDeadline('2026-11-01','09:00'),endsAt:parseDeadline('2026-11-02','12:00')});
  const html=render([taskView(t,board,now)],{month:'2026-11',date:'2026-11-02'},false,now);
  assert.ok(html.includes('2026-11-01 09:00 — 2026-11-02 12:00'));
  assert.ok(html.includes('截止：10月30日 18:00'));
  assert.ok(html.includes('2026-11-02，0项未完成任务截止，1项持续任务'));
});

test('rendered calendar escapes task titles, links to details and labels dates for assistive technology', async () => {
  const bundle = buildSync({ entryPoints: ['client/calendar.js'], bundle: true, format: 'esm', write: false });
  const { calendar: render } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const t = task('id&other', '2026-10-29', '09:00', { title: '<img src=x onerror=alert(1)>' });
  const html = render([taskView(t, board, now)], { date: '2026-10-29' }, false, now);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('href="#/task?id=id%26other"'));
  assert.ok(html.includes('aria-current="date"'));
  assert.ok(html.includes('aria-pressed="true"'));
  assert.ok(html.includes('2026-10-29，今天，1项未完成任务截止，含逾期任务'));
  assert.ok(render([], {}, true, now).includes('暂无待完成任务'));
});
