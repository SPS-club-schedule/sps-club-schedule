import * as api from './api';
import * as views from './views';
import { parseDeadline, parts, taskView } from '../shared/view';
import { shiftMonth } from '../shared/calendar';
import { templateDraft, draftDeadline, MAX_STEPS } from '../shared/templates';
import { isAdmin } from '../shared/permissions';
import { departmentLabel, invitationToken } from '../shared/departments';
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
  const html = s.page === 'board' || s.page === 'mine' ? views.board(s, s.page === 'mine') : ({ auth: views.auth, entry: views.entry, task: views.detail, edit: views.editor, members: views.members, templates: views.templates, 'template-edit': views.templateEditor, admin:views.admin, 'admin-edit':views.adminEditor, reset:views.resetPassword }[s.page] || views.auth)(s);
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
const adminPage = () => ['admin','admin-edit'].includes(s.page);
function clearAdmin() { s.adminData=null; s.adminTarget=null; s.form={}; s.resetLink=''; }
async function loadAdmin() {
  const ticket=generation, club=s.sync.board?.club;
  if (!adminPage() || !club || !isAdmin(s.sync.board.me.role)) return;
  s.adminLoading=true;
  try {
    const data=await api.adminMembers(club.id);
    if (ticket!==generation) return;
    s.adminData=data; s.adminDenied=false;
    if (s.page==='admin-edit') {
      const target=data.members.find(m=>m.id===s.id);
      if (!target) { s.adminTarget=null; throw new Error('成员不存在，请返回管理页'); }
      if (!s.adminTarget || !target.canEdit || !target.canEditAccount && s.adminTarget.canEditAccount) {
        s.adminTarget=target;
        s.form={memberName:target.name,memberRole:target.role,memberUsername:target.username,memberDepartment:target.department || ''};
        s.resetLink='';
      }
    }
  } catch(error) {
    if (ticket!==generation) return;
    if (['FORBIDDEN','UNAUTHENTICATED'].includes(error.code)) { clearAdmin(); s.adminDenied=true; }
    s.error=error.message;
  } finally { if (ticket===generation) { s.adminLoading=false; render(); } }
}
function receive(state) {
  s.sync = state;
  if (s.page==='templates' && s.category && state.board && !(state.board.templates || []).some(t=>t.category===s.category)) s.category='';
  if (state.board && !state.board.club && ['board','mine','task','members','templates','admin','admin-edit'].includes(s.page)) { go('/entry'); return; }
  if (state.board?.club && !api.clubId()) api.setClub(state.board.club.id);
  if (adminPage()) {
    if (!isAdmin(state.board?.me?.role)) clearAdmin();
    else if (state.phase==='ready' && !s.adminLoading && s.adminCheckedAt!==state.checkedAt) {
      s.adminCheckedAt=state.checkedAt; loadAdmin();
    }
  }
  if (!isAdmin(state.board?.me?.role)) {
    inviteKey = ''; s.invites = null; api.clearInviteCache();
  } else if (s.page === 'members' && state.board?.club && state.phase === 'ready') {
    const key = api.user().id + ':' + state.board.club.id + ':' + state.board.club.inviteVersion;
    if (inviteKey !== key) {
      inviteKey = key; s.invites = null; const ticket = generation;
      api.getInvite(state.board).then(result => { if (ticket === generation && inviteKey === key) { s.invites = result; render(); } }).catch(error => { if (ticket === generation) { inviteKey = ''; s.error = error.message; render(); } });
    }
  }
  render();
}
async function route() {
  const ticket = ++generation; if (stop) stop(); stop = null;
  const url = new URL((location.hash.slice(1) || '/board'), 'https://local.invalid');
  const page = url.pathname.slice(1), invitation = url.searchParams.get('invite');
  if (!api.user() && !['auth','reset'].includes(page)) { go('/auth'); return; }
  if (api.user() && page === 'auth') { go(invitation ? '/entry?invite=' + encodeURIComponent(invitation) : '/board'); return; }
  s = { page, id: url.searchParams.get('id'), parentId: url.searchParams.get('parent'), selectedTemplate: url.searchParams.get('template') || '', steps: [], openSteps: new Set(), authMode: invitation ? 'register' : 'login', joinMode: 'join', form: { invite: invitation || '', name: 'SPS 社团日程' }, sync: api.sync.getState(), filter: page === 'mine' ? 'pending' : 'all', search: '', busy: false, error: '', requestId: api.requestId() };
  if (page==='reset') {
    s.resetToken=url.searchParams.get('token') || ''; s.form={username:url.searchParams.get('username') || ''};
    // Keep the bearer secret out of the URL after reading the reset link.
    history.replaceState(null,'','#/reset');
  }
  inviteKey = ''; window.scrollTo(0,0); render();
  if (['board','mine','task','members','templates','admin','admin-edit'].includes(page)) { stop = api.sync.watch(receive); return; }
  if (page === 'auth' || page==='reset') return;
  try {
    const b = await api.bootstrap({ includeClubs: page === 'entry' });
    if (ticket !== generation) return;
    if (page === 'entry') { s.clubs = b.clubs || []; s.form.nickname = b.me?.name || ''; }
    if (page === 'edit') {
      if (!b.club) { go('/entry'); return; }
      const task = s.id ? b.tasks.find(t => t._id === s.id) : null;
      if (s.id && !task) throw new Error('任务不存在或已归档');
      if (task && !taskView(task,b).canManage) throw new Error('你无权修改这项任务');
      const parentId = task?.parentTaskId || s.parentId;
      const parent = parentId ? b.tasks.find(t => t._id === parentId) : null;
      if (parentId && (!parent || parent.parentTaskId)) throw new Error('主任务不存在或已归档');
      if (!task && parent && !taskView(parent,b).canManage) throw new Error('仅主任务发布者或社团创建者可以分配子任务');
      s.parent = parent;
      s.canReassign = !!task?.parentTaskId && !Object.keys(task.completions).length && !task.sharedCompletion;
      const p = parts(task?.dueAt || (parent?.dueAt > Date.now() ? parent.dueAt : Date.now()+86400000));
      s.editBoard = b; s.revision = task?.revision;
      s.form = { title: task?.title || '', description: task?.description || '', date: p.date, time: task || parent ? p.time : '20:00', mode: task?.mode || 'individual', priority: task?.priority || 'normal', participantIds: task?.participantIds.slice() || (parent ? [] : b.members.map(m=>m.id)) };
      if (!task && !parent && s.selectedTemplate) applyTemplate();
    }
    if (page === 'template-edit') {
      if (!b.club) { go('/entry'); return; }
      const id=s.id || url.searchParams.get('copy');
      const template=id ? (b.templates || []).find(t=>t._id===id) : null;
      if (id&&!template) throw new Error('模板不存在或已归档');
      s.revision=template?.revision;
      const draft=template?templateDraft(template,b.members):{title:'',description:'',mode:'individual',priority:'normal',participantIds:[],steps:[]};
      s.steps=draft.steps;
      const { steps, ...main }=draft;
      s.form={...main,name:template?(s.id?template.name:template.name.slice(0,76)+'（副本）'):'',category:template?.category || '未分类'};
      s.editBoard = b;
    }
    render();
  } catch (error) { if (ticket === generation) { s.error = error.message; render(); } }
}
function applyTemplate() {
  const template=(s.editBoard.templates || []).find(t=>t._id===s.selectedTemplate);
  if (!template) throw new Error('请先选择一个模板');
  const draft=templateDraft(template,s.editBoard.members);
  const { steps, ...main }=draft;
  s.form={...s.form,...main,participantIds:main.participantIds.length?main.participantIds:s.editBoard.members.map(m=>m.id)};
  s.steps=steps; s.openSteps=new Set(); s.appliedTemplate={id:template._id,name:template.name};
}
const taskFields = f => ({ title:f.title,description:f.description,mode:f.mode,priority:f.priority,participantIds:f.participantIds });
function focusInvalidField(event) {
  const details=event.target.closest('details');
  if (details) { details.open=true; s.openSteps.add(Number(details.dataset.stepPanel)); }
}
root.addEventListener('invalid',focusInvalidField,true);
root.addEventListener('toggle',event=>{
  if (event.target.matches('details[data-step-panel]')) {
    const index=Number(event.target.dataset.stepPanel);
    if (event.target.open) s.openSteps.add(index); else s.openSteps.delete(index);
  }
},true);
async function perform(work) {
  if (s.busy) return;
  const ticket = generation; s.busy = true; s.error = ''; render();
  try { await work(); }
  catch (error) { if (ticket === generation) { s.error = error.message; render(); root.querySelector('[role="alert"]')?.scrollIntoView({block:'center'}); } }
  finally { if (ticket === generation) { s.busy = false; render(); } }
}
function inputChanged(event) {
  if (s.busy) return;
  const { name, value } = event.target;
  if (!name) return;
  const {step,field}=event.target.dataset;
  if (step!==undefined) {
    if (!s.steps[Number(step)]) return;
    s.steps[Number(step)][field]=field==='daysBefore'&&value!==''?Number(value):value;
    if (field==='daysBefore') s.steps[Number(step)].customDeadline=false;
    if (event.type==='change') render();
  } else if (name==='selectedTemplate') s.selectedTemplate=value;
  else if (name==='inviteDepartment') { s.inviteDepartment=value; render(); }
  else if (name==='templateCategory') { s.category=value; render(); }
  else if (name === 'search') { s.search = value; api.sync.touch(); render(); }
  else { s.form[name]=value; if(event.type==='change'&&['date','time'].includes(name)&&s.steps.length) render(); }
}
root.addEventListener('input', inputChanged);
root.addEventListener('change', inputChanged);
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
    if (kind==='resetPassword') {
      if (data.password!==data.confirmPassword) throw new Error('两次输入的密码不一致');
      const result=await api.authenticate('recover',{username:data.username,password:data.password,resetToken:s.resetToken});
      s.form={}; s.resetToken=''; s.recovery=result.recoveryCode;
    }
    if (kind==='adminMember') {
      const target=s.adminTarget;
      if (!target?.canEdit) throw new Error('没有管理这位成员的权限');
      const result=await api.call('adminEditMember',{clubId:s.sync.board.club.id,memberId:target.id,memberVersion:target.syncVersion,accountRevision:target.accountRevision,name:data.memberName,role:data.memberRole,department:data.memberDepartment,...(target.canEditAccount?{username:data.memberUsername}:{}),...(data.adminPassword?{adminPassword:data.adminPassword}:{})});
      s.form.adminPassword=''; s.adminTarget=result.adminMember; go('/admin'); toast('成员资料已保存');
    }
    if (kind === 'club') {
      const result = await api.call(s.joinMode==='create'?'createClub':'joinClub', { nickname: data.nickname, name: data.name, token: data.invite.trim(), requestId: s.requestId });
      api.setClub(result.clubId); go('/board'); if (result.department) toast('已加入'+departmentLabel(result.department));
    }
    if (kind === 'task') {
      const group=!s.id&&!s.parent&&s.steps.length>0;
      const subtasks=group?s.steps.map((step,index)=>{
        if (!step.participantIds.length) { s.openSteps.add(index); throw new Error(`请为子任务${index+1}「${step.title}」选择负责人`); }
        const dueAt=draftDeadline(data,step);
        if(dueAt<=Date.now()) { s.openSteps.add(index); throw new Error(`子任务${index+1}「${step.title}」的截止时间已过，请调整日期或提前天数`); }
        return {...taskFields(step),daysBefore:step.daysBefore,...(step.customDeadline?{dueAt}:{})};
      }):undefined;
      const result = await api.call(s.id?'editTask':group?'createTaskGroup':'createTask', { ...taskFields(data), dueAt: parseDeadline(data.date,data.time), clubId: s.editBoard.club.id, parentTaskId: s.parent?._id, taskId: s.id, revision: s.revision, requestId: s.requestId, ...(group?{subtasks,templateId:s.appliedTemplate?.id}:{}) });
      go('/task?id='+encodeURIComponent(result.taskId));
    }
    if (kind === 'template') {
      await api.call(s.id?'editTemplate':'createTemplate',{...taskFields(data),name:data.name,category:data.category,steps:s.steps.map(step=>({...taskFields(step),daysBefore:step.daysBefore})),clubId:s.editBoard.club.id,templateId:s.id,revision:s.revision,requestId:s.requestId});
      go('/templates'); toast('共享模板已保存');
    }
    if (kind === 'name') { await api.call('renameMe', { clubId: s.sync.board.club.id, name: data.nickname }); s.form.nickname = undefined; toast('称呼已更新'); }
  });
});
root.addEventListener('click', event => {
  const el = event.target.closest('[data-action]'); if (!el || el.disabled) return;
  const { action, value, id } = el.dataset;
  if (s.busy) return;
  if (action==='applyTemplate') {
    perform(async()=>{
      if ((s.form.title || s.steps.length) && !await confirmAction('套用这个模板？','将替换当前草稿的名称、说明、分工和子任务，保留主任务截止日期。')) return;
      applyTemplate();
    }); return;
  }
  if (['addStep','removeStep','stepUp','stepDown','stepParticipant','stepCustom','stepRelative','assignStepsToMe'].includes(action)) {
    const index=Number(el.dataset.index), step=s.steps[index];
    if(action==='addStep'&&s.steps.length<MAX_STEPS) { s.steps.push({title:'',description:'',daysBefore:1,mode:'individual',priority:'normal',participantIds:[],customDeadline:false}); s.openSteps.add(s.steps.length-1); }
    if(action==='removeStep') { s.steps.splice(index,1); s.openSteps=new Set(); }
    if(action==='stepUp'||action==='stepDown') {
      const target=index+(action==='stepUp'?-1:1);
      if(target>=0&&target<s.steps.length) { [s.steps[index],s.steps[target]]=[s.steps[target],s.steps[index]]; s.openSteps=new Set([target]); }
    }
    if(action==='stepParticipant') step.participantIds=step.participantIds.includes(id)?step.participantIds.filter(x=>x!==id):[...step.participantIds,id];
    if(action==='assignStepsToMe') for(const item of s.steps) item.participantIds=[s.editBoard.me.id];
    if(action==='stepRelative') step.customDeadline=false;
    if(action==='stepCustom') {
      try { const p=parts(draftDeadline(s.form,step)); Object.assign(step,{date:p.date,time:p.time,customDeadline:true}); }
      catch(error) { s.error=error.message; }
    }
    render(); return;
  }
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
  if (action === 'copyReset') { copy(s.resetLink); return; }
  if (['copyInvite','share','rotateInvite'].includes(action) && !isAdmin(s.sync.board?.me?.role)) return;
  if (action === 'copyInvite') { const token=invitationToken(s.invites,s.inviteDepartment); if(token) copy(token); return; }
  if (action === 'share') {
    const token=invitationToken(s.invites,s.inviteDepartment); if(!token) return;
    const url = inviteLink(token);
    if (navigator.share) navigator.share({ title: '邀请你加入 '+s.sync.board.club.name+(s.inviteDepartment?' · '+departmentLabel(s.inviteDepartment):''), url }).catch(error => { if (error.name!=='AbortError') copy(url); });
    else copy(url);
    return;
  }
  perform(async () => {
    if (action === 'refresh') { await api.bootstrap({ force: true }); if(adminPage()&&!s.adminLoading) await loadAdmin(); }
    if (action==='adminReset') {
      const target=s.adminTarget;
      if (!target?.canEditAccount) throw new Error('没有修改此账号的权限');
      if (!s.form.adminPassword) throw new Error('请先填写你自己的密码以确认操作');
      const result=await api.call('adminResetPassword',{clubId:s.sync.board.club.id,memberId:target.id,memberVersion:target.syncVersion,accountRevision:target.accountRevision,adminPassword:s.form.adminPassword});
      s.form.adminPassword='';
      const url=new URL(location.href); url.hash='/reset?token='+result.resetToken+'&username='+encodeURIComponent(result.username);
      s.resetLink=url.href; s.resetUsername=result.username; s.resetExpiresAt=result.expiresAt;
      toast('重设链接已生成');
    }
    if (action === 'toggle') {
      const b = s.sync.board, raw = b.tasks.find(t=>t._id===id); if (!raw) throw new Error('任务已归档');
      const t = taskView(raw,b);
      await api.call('complete', { taskId: id, done: !t.myDone }); toast(t.myDone?'已撤销完成':'已记录完成');
    }
    if (action === 'archive' && await confirmAction('归档这项任务？','归档后将从看板隐藏；如有子任务，也会一起归档。已有完成记录会保留。')) { await api.call('archiveTask', { taskId: s.id }); go('/board'); }
    if(action==='archiveTemplate') {
      const template=s.sync.board.templates.find(t=>t._id===id);
      if(template&&await confirmAction('归档这个模板？','模板将从共享模板库隐藏，已经发布的任务保持不变。')) await api.call('archiveTemplate',{templateId:id,revision:template.revision});
    }
    if (action === 'rotateInvite') {
      const department=s.inviteDepartment || '', label=department?departmentLabel(department):'社团通用';
      if (await confirmAction('更换'+label+'邀请码？','仅此入口的旧邀请码和邀请链接将失效，其他部门邀请码及已有成员不受影响。')) {
        await api.call('rotateInvite', { clubId: s.sync.board.club.id, department });
        s.invites=await api.getInvite(s.sync.board);
      }
    }
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
