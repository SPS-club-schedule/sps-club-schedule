import * as api from './api';
import * as views from './views';
import { parseDeadline, parts, taskView } from '../shared/view';
import { shiftMonth } from '../shared/calendar';
const root = document.getElementById('app');
let stop = null, generation = 0, inviteKey = '';
let s = { page: 'auth', authMode: 'login', joinMode: 'join', form: {}, sync: api.sync.getState(), filter: 'all', search: '', busy: false, error: '' };
function go(path) { if (location.hash === '#' + path) route(); else location.hash = path; }
function render() {
  const active = document.activeElement, name = active?.getAttribute('name');
  const start = active?.selectionStart, end = active?.selectionEnd;
  const calendarFocus = active?.matches('.deadline-calendar button') ? { action: active.dataset.action, value: active.dataset.value } : null;
  const calendarLink = active?.matches('.calendar-task') ? active.getAttribute('href') : null;
  const agendaScroll = root.querySelector('.calendar-agenda-list')?.scrollTop;
  const agendaFocus = active?.matches('.calendar-agenda-list');
  const scroll = window.scrollY;
  const html = s.page === 'board' || s.page === 'mine' ? views.board(s, s.page === 'mine') : ({ auth: views.auth, entry: views.entry, task: views.detail, edit: views.editor, members: views.members }[s.page] || views.auth)(s);
  root.innerHTML = html;
  if (name) {
    const next = root.querySelector(`[name="${CSS.escape(name)}"]`);
    if (next) { next.focus({ preventScroll: true }); if (start != null) next.setSelectionRange(start, end); }
  }
  if (calendarFocus) {
    const next = Array.from(root.querySelectorAll('.deadline-calendar button')).find(el => el.dataset.action === calendarFocus.action && el.dataset.value === calendarFocus.value);
    (next || root.querySelector('[data-action="calendarToday"]'))?.focus({ preventScroll: true });
  }
  if (calendarLink) {
    const next = Array.from(root.querySelectorAll('.calendar-task')).find(el => el.getAttribute('href') === calendarLink);
    (next || root.querySelector('[data-action="calendarToday"]'))?.focus({ preventScroll: true });
  }
  const agenda = root.querySelector('.calendar-agenda-list');
  if (agenda) { agenda.scrollTop = agendaScroll || 0; if (agendaFocus) agenda.focus({ preventScroll: true }); }
  window.scrollTo(0, scroll);
}
function toast(message) {
  const el = document.getElementById('toast'); el.textContent = message; el.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.hidden = true; }, 2400);
}
function confirmAction(title, message) {
  const dialog = document.getElementById('confirm');
  dialog.querySelector('h2').textContent = title; dialog.querySelector('p').textContent = message;
  return new Promise(resolve => {
    dialog.returnValue = 'cancel'; dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }); dialog.showModal();
  });
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('已复制'); }
  catch { toast('复制未成功，请长按选中内容复制'); }
}
function inviteLink(token) { const url = new URL(location.href); url.hash = '/auth?invite=' + token; return url.href; }
function receive(state) {
  s.sync = state;
  if (state.board && !state.board.club && ['board','mine','task','members'].includes(s.page)) { go('/entry'); return; }
  if (state.board?.club && !api.clubId()) api.setClub(state.board.club.id);
  if (s.page === 'members' && state.board?.club && state.phase === 'ready') {
    const key = api.user().id + ':' + state.board.club.id + ':' + state.board.club.inviteVersion;
    if (inviteKey !== key) {
      inviteKey = key; s.invite = ''; const ticket = generation;
      api.getInvite(state.board).then(result => { if (ticket === generation && inviteKey === key) { s.invite = result.token; render(); } }).catch(error => { if (ticket === generation) { inviteKey = ''; s.error = error.message; render(); } });
    }
  }
  render();
}
async function route() {
  const ticket = ++generation; if (stop) stop(); stop = null;
  const url = new URL((location.hash.slice(1) || '/board'), 'https://local.invalid');
  const page = url.pathname.slice(1), invitation = url.searchParams.get('invite');
  if (!api.user() && page !== 'auth') { go('/auth'); return; }
  if (api.user() && page === 'auth') { go(invitation ? '/entry?invite=' + encodeURIComponent(invitation) : '/board'); return; }
  s = { page, id: url.searchParams.get('id'), authMode: invitation ? 'register' : 'login', joinMode: 'join', form: { invite: invitation || '', name: 'SPS 社团日程' }, sync: api.sync.getState(), filter: page === 'mine' ? 'pending' : 'all', search: '', busy: false, error: '', requestId: api.requestId() };
  inviteKey = ''; window.scrollTo(0,0); render();
  if (['board','mine','task','members'].includes(page)) { stop = api.sync.watch(receive); return; }
  if (page === 'auth') return;
  try {
    const b = await api.bootstrap({ includeClubs: page === 'entry' });
    if (ticket !== generation) return;
    if (page === 'entry') { s.clubs = b.clubs || []; s.form.nickname = b.me?.name || ''; }
    if (page === 'edit') {
      if (!b.club) { go('/entry'); return; }
      const task = s.id ? b.tasks.find(t => t._id === s.id) : null;
      if (s.id && !task) throw new Error('任务不存在或已归档');
      if (task && !taskView(task,b).canManage) throw new Error('你无权修改这项任务');
      const p = parts(task?.dueAt || Date.now()+86400000);
      s.editBoard = b; s.revision = task?.revision;
      s.form = { title: task?.title || '', description: task?.description || '', date: p.date, time: task ? p.time : '20:00', mode: task?.mode || 'individual', priority: task?.priority || 'normal', participantIds: task?.participantIds.slice() || b.members.map(m=>m.id) };
    }
    render();
  } catch (error) { if (ticket === generation) { s.error = error.message; render(); } }
}
async function perform(work) {
  if (s.busy) return;
  const ticket = generation; s.busy = true; s.error = ''; render();
  try { await work(); }
  catch (error) { if (ticket === generation) { s.error = error.message; render(); } }
  finally { if (ticket === generation) { s.busy = false; render(); } }
}
root.addEventListener('input', event => {
  const { name, value } = event.target;
  if (!name) return;
  if (name === 'search') { s.search = value; api.sync.touch(); render(); }
  else s.form[name] = value;
});
root.addEventListener('change', event => { if (event.target.name) s.form[event.target.name] = event.target.value; });
root.addEventListener('submit', event => {
  event.preventDefault(); const kind = event.target.dataset.form;
  const data = { ...s.form, ...Object.fromEntries(new FormData(event.target)) };
  perform(async () => {
    if (kind === 'auth') {
      const result = await api.authenticate(s.authMode, { ...data, mode: s.joinMode });
      s.form.password = ''; s.form.recoveryCode = '';
      if (result.recoveryCode) { s.recovery = result.recoveryCode; render(); }
      else go(data.invite ? '/entry?invite='+encodeURIComponent(data.invite) : '/board');
    }
    if (kind === 'club') {
      const result = await api.call(s.joinMode==='create'?'createClub':'joinClub', { nickname: data.nickname, name: data.name, token: data.invite.trim(), requestId: s.requestId });
      api.setClub(result.clubId); go('/board');
    }
    if (kind === 'task') {
      const result = await api.call(s.id?'editTask':'createTask', { ...data, dueAt: parseDeadline(data.date,data.time), clubId: s.editBoard.club.id, taskId: s.id, revision: s.revision, requestId: s.requestId });
      go('/task?id='+encodeURIComponent(result.taskId));
    }
    if (kind === 'name') { await api.call('renameMe', { clubId: s.sync.board.club.id, name: data.nickname }); s.form.nickname = undefined; toast('称呼已更新'); }
  });
});
root.addEventListener('click', event => {
  const el = event.target.closest('[data-action]'); if (!el || el.disabled) return;
  const { action, value, id } = el.dataset;
  if (action === 'reload') { location.reload(); return; }
  if (action === 'authMode') { s.authMode = value; s.error = ''; render(); return; }
  if (action === 'joinMode') { s.joinMode = value; s.error = ''; render(); return; }
  if (action === 'filter') { s.filter = value; api.sync.touch(); render(); return; }
  if (action.startsWith('calendar')) {
    const today = parts(Date.now()).date;
    s.calendar ||= { month: today.slice(0,7), date: '' };
    if (action === 'calendarMonth') s.calendar = { month: shiftMonth(s.calendar.month, Number(value)), date: '' };
    if (action === 'calendarToday') s.calendar = { month: today.slice(0,7), date: today };
    if (action === 'calendarDate') s.calendar = { month: value.slice(0,7), date: s.calendar.date === value ? '' : value };
    if (action === 'calendarClear') s.calendar.date = '';
    const agenda = root.querySelector('.calendar-agenda-list'); if (agenda) agenda.scrollTop = 0;
    api.sync.touch(); render(); return;
  }
  if (action === 'mode' || action === 'priority') { s.form[action] = value; render(); return; }
  if (action === 'participant') { s.form.participantIds = s.form.participantIds.includes(id) ? s.form.participantIds.filter(x=>x!==id) : [...s.form.participantIds,id]; render(); return; }
  if (action === 'allMembers') { s.form.participantIds = s.form.participantIds.length===s.editBoard.members.length ? [] : s.editBoard.members.map(m=>m.id); render(); return; }
  if (action === 'chooseClub') { api.setClub(id); go('/board'); return; }
  if (action === 'continue') { s.recovery = ''; go('/board'); return; }
  if (action === 'copyRecovery') { copy(s.recovery); return; }
  if (action === 'copyInvite') { copy(s.invite); return; }
  if (action === 'share') {
    const url = inviteLink(s.invite);
    if (navigator.share) navigator.share({ title: '邀请你加入 '+s.sync.board.club.name, url }).catch(error => { if (error.name!=='AbortError') copy(url); });
    else copy(url);
    return;
  }
  perform(async () => {
    if (action === 'refresh') await api.bootstrap({ force: true });
    if (action === 'toggle') {
      const b = s.sync.board, raw = b.tasks.find(t=>t._id===id); if (!raw) throw new Error('任务已归档');
      const t = taskView(raw,b);
      await api.call('complete', { taskId: id, done: !t.myDone }); toast(t.myDone?'已撤销完成':'已记录完成');
    }
    if (action === 'archive' && await confirmAction('归档这项任务？','归档后将从看板隐藏，已有完成记录会保留。')) { await api.call('archiveTask', { taskId: s.id }); go('/board'); }
    if (action === 'rotateInvite' && await confirmAction('更换邀请码？','已有成员不受影响，旧邀请码和邀请链接将失效。')) { const result = await api.call('rotateInvite', { clubId: s.sync.board.club.id }); s.invite = result.token; }
    if (action === 'logout') { await api.logout(); go('/auth'); }
  });
});
window.addEventListener('hashchange', route);
window.addEventListener('sps:logged-out', () => go('/auth'));
window.addEventListener('online', () => api.sync.setOnline(true));
window.addEventListener('offline', () => api.sync.setOnline(false));
document.addEventListener('visibilitychange', () => api.sync.setVisible(!document.hidden));
// Deadline labels use local time and never initiate a request.
setInterval(() => { if (!document.hidden && ['board','mine','task'].includes(s.page)) render(); },30000);
async function start() {
  try {
    const response = await fetch(new URL('./config.json', location.href.split('#')[0]), { cache:'no-store' });
    if (!response.ok) throw new Error('配置加载失败，请刷新页面');
    const config = await response.json(); api.configure(config.apiBase);
    api.sync.setVisible(!document.hidden); api.sync.setOnline(navigator.onLine); await route();
  } catch (error) { root.innerHTML = `<section class="page"><h1 class="h1">暂时无法连接</h1><p class="error">${views.e(error.message)}</p><button data-action="reload">重新加载</button></section>`; }
}
start();
