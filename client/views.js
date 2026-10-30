import { taskView, parts } from '../shared/view';
import { user } from './api';
import { calendar } from './calendar';
import { e, button, link, error, busy, field, syncRow, nav } from './ui';
import { templatePicker, stepEditors } from './template-views';
import { roleLabel, isAdmin } from '../shared/permissions';
import { DEPARTMENTS, departmentLabel, invitationToken } from '../shared/departments';
import { resolveParticipants } from '../shared/assignments';
import { assigneePicker } from './assignee-picker';
import { scheduleEditor } from './schedule-editor';
export { e } from './ui';
export { templates, templateEditor } from './template-views';
export { admin, adminEditor, resetPassword } from './admin-views';
export { accountSettings } from './account-views';
export { archives } from './archive-views';
const brand = `<div class="brand-mark">SPS</div><div class="eyebrow">BETTER TOGETHER</div><h1 class="h1 space">社团的每一件事，<br>一起完成。</h1><p class="muted space">安排任务，约定时间，让每一份参与都有回应。</p>`;
const parentLink = t => t.parentTaskId ? link('/task?id='+encodeURIComponent(t.parentTaskId),'↳ '+e(t.parentTitle),'parent-task-link small') : '';
function subtasks(t, b, s) {
  if (t.parentTaskId) return '';
  const children = b.tasks.filter(child=>child.parentTaskId===t._id).map(child=>taskView(child,b)).sort((a,b)=>a.dueAt-b.dueAt);
  return `<section class="section subtask-section" aria-labelledby="subtasks-heading"><div class="row between"><h2 class="h2" id="subtasks-heading">子任务 · ${children.filter(c=>c.done).length}/${children.length} 完成</h2>${t.canManage?link('/edit?parent='+encodeURIComponent(t._id),'＋ 添加子任务','primary compact'):''}</div><p class="hint">各自分配负责人和截止时间，主任务与子任务分别标记完成。</p>${children.map(c=>`<article class="card space subtask-card">${link('/task?id='+encodeURIComponent(c._id),e(c.title),'subtask-title')}<div class="row between space"><span class="small muted wrap">${e(c.participantLabel)}</span><span class="pill ${c.status}">${c.statusLabel}</span></div><div class="row between space"><span class="small due ${c.status}">${c.fullDue} 截止</span>${c.canToggle?button('toggle',c.myDone?'撤销完成':'标记完成',c.myDone?'secondary compact':'primary compact',`data-id="${e(c._id)}" ${busy(s)}`):''}</div></article>`).join('') || '<p class="small muted space">尚未添加子任务。</p>'}</section>`;
}

export function auth(s) {
  if (s.recovery) return `<section class="page entry">${brand}<div class="card section"><h2 class="h2">保存你的账号恢复码</h2><p class="muted small">忘记密码时，可用它找回账号。请保存在只有你能访问的地方，仅显示这一次。</p><div class="invite-code space">${e(s.recovery)}</div>${button('copyRecovery','复制恢复码','secondary full space')}${button('continue','我已保存，进入社团 →','primary full space')}</div></section>`;
  const f = s.form, register = s.authMode === 'register', recover = s.authMode === 'recover';
  return `<section class="page entry">${brand}<div class="chips section">${button('authMode','登录','chip '+(!register&&!recover?'active':''),'data-value="login"')}${button('authMode','注册并加入','chip '+(register?'active':''),'data-value="register"')}</div>
  <form data-form="auth" class="section">
    ${field('username','用户名',f.username,'text','required minlength="3" maxlength="30" pattern="[a-zA-Z0-9_]+" autocomplete="username" autocapitalize="none" placeholder="英文字母、数字或下划线"')}
    ${field('password',recover?'新密码':'密码',f.password,'password',`required minlength="10" maxlength="128" autocomplete="${register||recover?'new-password':'current-password'}" placeholder="至少10个字符"`)}
    ${recover ? field('recoveryCode','账号恢复码',f.recoveryCode,'text','required maxlength="64" autocomplete="off"') : ''}
    ${register ? `${field('nickname','你在社团里的称呼',f.nickname,'text','required maxlength="20" autocomplete="nickname"')}<div class="chips field">${button('joinMode','加入已有社团','chip '+(s.joinMode==='join'?'active':''),'data-value="join"')}${button('joinMode','创建社团','chip '+(s.joinMode==='create'?'active':''),'data-value="create"')}</div>${s.joinMode==='join'?field('invite','社团邀请码',f.invite,'text','required maxlength="64" autocomplete="off" placeholder="粘贴管理员发来的邀请码"'):field('name','社团名称',f.name||'SPS 社团日程','text','required maxlength="30"')}` : ''}
    ${error(s)}<button class="primary full" type="submit" ${busy(s)}>${s.busy?'正在处理…':recover?'重设密码':register?'创建账号，开始协作 →':'登录，继续协作 →'}</button>
    ${!register ? button('authMode',recover?'返回登录':'忘记密码？用恢复码找回','plain small space',`data-value="${recover?'login':'recover'}"`) : '<p class="hint">使用部门邀请码会自动归入对应部门。社团成员可以看到彼此的称呼、部门、任务及完成情况。</p>'}
  </form></section>`;
}
export function entry(s) {
  const f = s.form;
  return `<section class="page entry">${brand}<div class="section"><h2 class="label">我的社团</h2>${(s.clubs||[]).map(c=>button('chooseClub',e(c.name)+' →','secondary full space',`data-id="${e(c.id)}"`)).join('')}${!s.clubs?.length?'<p class="muted small">加入一个社团，开始协作。</p>':''}</div>
  <div class="chips section">${button('joinMode','加入社团','chip '+(s.joinMode==='join'?'active':''),'data-value="join"')}${button('joinMode','创建社团','chip '+(s.joinMode==='create'?'active':''),'data-value="create"')}</div>
  <form data-form="club" class="section">${field('nickname','你在社团里的称呼',f.nickname,'text','required maxlength="20"')}${s.joinMode==='join'?field('invite','邀请码',f.invite,'text','required maxlength="64"'):field('name','社团名称',f.name||'SPS 社团日程','text','required maxlength="30"')}${error(s)}<button class="primary full" ${busy(s)}>${s.joinMode==='join'?'加入这个社团':'创建社团'} →</button></form>${link('/account','账号设置 · 用户名与密码','secondary full section center')}${button('logout','退出登录','plain full section',busy(s))}</section>`;
}
export function board(s, mine) {
  const b = s.sync.board;
  if (!b?.club) return `<section class="page">${syncRow(s)}${error(s)}<div class="empty">正在获取社团任务…</div></section>${nav(mine?'mine':'board',b)}`;
  const now = Date.now(), all = b.tasks.map(t=>taskView(t,b,now)), p=parts(now);
  const stats=[all.filter(t=>!t.done).length,all.filter(t=>t.assigned&&!t.myDone).length,all.filter(t=>t.done).length];
  let shown=mine?all.filter(t=>t.assigned):all;
  if (s.filter==='pending') shown=shown.filter(t=>mine?!t.myDone:!t.done);
  if (s.filter==='done') shown=shown.filter(t=>mine?t.myDone:t.done);
  if (s.search) shown=shown.filter(t=>(t.title+t.description+t.parentTitle).toLowerCase().includes(s.search.trim().toLowerCase()));
  shown.sort((a,b)=>Number(a.done)-Number(b.done)||a.dueAt-b.dueAt);
  return `<section class="page"><header class="row between masthead"><div class="row"><div class="logo">S</div><div><div class="club-name">${e(b.club.name)}</div><div class="eyebrow">CLUB WORKSPACE</div></div></div><div class="avatar owner">${e(b.me.name[0])}</div></header>${syncRow(s)}${error(s)}
  <div class="hero"><div class="row between"><div class="small hero-date">${e(p.date.slice(5).replace('-','月'))}日 · 星期${p.weekday}</div><span class="hero-dot">✦</span></div><h1 class="hero-title">把每一件事，<br>一起做好。</h1><div class="hero-sub">${b.members.length} 位伙伴，让想法一步步发生。</div><div class="hero-stats">${stats.map((n,i)=>`${i?'<div class="stat-divider"></div>':''}<div><div class="stat-number">${n}</div><div class="stat-label">${['进行中的任务','我的待办','已完成'][i]}</div></div>`).join('')}</div></div>
  ${calendar(all,s.calendar,mine,now)}
  <div class="section row between"><h2 class="h2">${mine?'我的任务':'社团任务'}</h2>${link('/edit','＋ 发布任务','primary compact')}</div><div class="search-box"><input name="search" aria-label="搜索任务" placeholder="搜索任务" value="${e(s.search)}"></div>
  <div class="row between filter-row"><div class="chips">${[['all','全部'],['pending','待完成'],['done','已完成']].map(([v,l])=>button('filter',l,'chip '+(s.filter===v?'active':''),`data-value="${v}"`)).join('')}</div><span class="small muted">${shown.length} 项</span></div>
  ${shown.map(t=>`<article class="card task-card ${t.done?'completed':''}"><div class="row between"><div class="chips"><span class="pill">${t.modeLabel}</span>${t.priority==='high'&&!t.done?'<span class="pill high">优先</span>':''}</div><span class="pill ${t.status}">${t.statusLabel}</span></div>${parentLink(t)}<div class="row task-title-row">${link('/task?id='+encodeURIComponent(t._id),e(t.title),'grow task-title')}${t.canToggle?button('toggle',t.myDone?'✓':'','check '+(t.myDone?'checked':''),`data-id="${e(t._id)}" aria-label="${t.actionLabel}" ${busy(s)}`):''}</div><div class="row between small"><span class="due ${t.status}">◷ ${t.dueLabel}</span><span class="muted">${e(t.progressLabel)}</span></div>${t.hasDuration?`<div class="task-duration space">时段：${e(t.durationLabel)}</div>`:''}<div class="progress space"><div class="progress-fill" style="width:${t.percent}%"></div></div><div class="task-bottom row between"><span class="small muted">${e(t.participantLabel)}</span>${link('/task?id='+encodeURIComponent(t._id),'↗','arrow')}</div></article>`).join('')||`<div class="card empty"><div class="empty-symbol">✓</div><h2 class="h2">${s.search?'没有找到相关任务':'这里暂时没有任务'}</h2><p class="small">发布一项任务，或看看其他分类。</p></div>`}
  <div class="bottom-note">每一个小小的完成，都让我们更近一步。</div></section>${nav(mine?'mine':'board',b)}`;
}
export function detail(s) {
  const b=s.sync.board, raw=b?.tasks.find(t=>t._id===s.id), t=raw?taskView(raw,b):null;
  return `<section class="page">${link('/board','← 返回任务看板','plain small')}${syncRow(s)}${error(s)}${!t?'<div class="empty">'+(b?'任务不存在或已归档':'正在加载任务…')+'</div>':`
  ${parentLink(t)}<div class="chips space">${t.parentTaskId?'<span class="pill">子任务</span>':''}<span class="pill">${t.modeLabel}</span><span class="pill ${t.status}">${t.statusLabel}</span></div><h1 class="h1 section wrap">${e(t.title)}</h1><div class="small muted space">由 ${e(t.creatorName)} 发布</div>
  <div class="card section"><div class="small muted">截止时间 · 北京时间</div><div class="h2 space">${t.fullDue}</div>${t.hasDuration?`<div class="divider"></div><div class="small muted">持续时段 · 北京时间</div><div class="task-duration space">${e(t.durationLabel)}</div>`:''}<div class="divider"></div><div class="prewrap">${e(t.description||'发布者暂未添加任务说明。')}</div></div>
  <div class="row between section"><h2 class="h2">${t.mode==='individual'?'成员进度':'协作成员'}</h2><span class="small muted">${e(t.progressLabel)}</span></div><div class="progress space"><div class="progress-fill" style="width:${t.percent}%"></div></div>
  <div class="card space">${t.participants.map(m=>`<div class="row between person-row"><div class="row"><div class="avatar">${e(m.initial)}</div><span>${e(m.name)}</span></div><span class="small ${m.done?'success-text':'muted'}">${m.done?'✓ '+m.completionLabel:t.mode==='shared'&&t.done?'协作已完成':'待完成'}</span></div>`).join('')}</div>
  ${subtasks(t,b,s)}
  ${t.canManage?`<div class="row section">${link('/edit?id='+encodeURIComponent(t._id),'编辑任务','secondary grow center')}${button('archive','归档','danger grow',busy(s))}</div>`:''}`}</section>
  ${t?`<footer class="footer">${t.canToggle?button('toggle',(t.myDone?'↶ ':'✓ ')+t.actionLabel,'full '+(t.myDone?'secondary':'primary'),`data-id="${e(t._id)}" ${busy(s)}`):'<span class="small muted">由指定成员完成，你可以查看进度。</span>'}</footer>`:''}`;
}
export function editor(s) {
  const f=s.form, b=s.editBoard, editing=!!s.id, child=!!s.parent, assignable=!editing || s.canReassign;
  const ids=b?resolveParticipants(f,b.members):[];
  return `<section class="page">${link(s.id?'/task?id='+encodeURIComponent(s.id):s.parent?'/task?id='+encodeURIComponent(s.parent._id):'/board','← 返回','plain small')}<div class="eyebrow section">MAKE THINGS HAPPEN</div><h1 class="h1 space">${editing?(child?'编辑子任务':'编辑任务'):(child?'分配一项子任务':'安排一件新事情')}</h1>${child?`<div class="space">${link('/task?id='+encodeURIComponent(s.parent._id),'主任务：'+e(s.parent.title),'parent-task-link')}</div>`:''}<p class="muted space">明确一件事，约好一个时间，一起向前。</p>${error(s)}
  ${!b?'<div class="empty">正在加载成员…</div>':`<form id="task-form" data-form="task" class="section"><fieldset ${busy(s)}>${!editing&&!child?templatePicker(s):''}${field('title',child?'子任务名称':'任务名称',f.title,'text','required maxlength="80" placeholder="例如：确认周末分享会的参加时间"')}<div class="field"><label class="label" for="description">任务说明 <span class="muted small">选填</span></label><textarea name="description" id="description" maxlength="2000" placeholder="要做什么？完成后需要交付什么？">${e(f.description)}</textarea></div>
  ${scheduleEditor(f,child)}<div class="field"><div class="label">完成方式</div>${[['individual','逐人完成','每位参与者分别打勾，全部完成后任务结束。'],['shared','协作完成','指定负责人，其中任一人完成后整项任务结束。']].map(([v,l,d])=>button('mode',`<span class="row between"><span class="option-title">${l}</span><span>${f.mode===v?'●':'○'}</span></span><span class="hint">${d}</span>`,'mode-option full '+(f.mode===v?'selected':''),`data-value="${v}" ${editing?'disabled':''}`)).join('')}</div>
  <div class="field"><div class="row between"><div class="label">${child?'子任务负责人':'参与成员'} · ${ids.length} 人</div>${assignable?button('allMembers',ids.length===b.members.length?'取消全选':'选择全体','plain small'):''}</div>${assigneePicker(f,b,{disabled:!assignable})}<p class="hint">${child?(assignable?'指定负责人后，子任务与截止时间会出现在对方的“我的待办”和日历中。':'子任务已有完成记录，撤销完成后可调整负责人。'):editing?'发布后保留完成方式和参与名单，以保护已有记录。':'名单以发布时为准，新加入的成员不会自动加入旧任务。'}</p></div>
  <div class="field"><div class="label">优先级</div><div class="chips">${[['normal','普通'],['high','优先处理']].map(([v,l])=>button('priority',l,'chip '+(f.priority===v?'active':''),`data-value="${v}"`)).join('')}</div></div>${!editing&&!child?stepEditors(s):''}</fieldset></form>`}</section>
  <footer class="footer"><button type="submit" form="task-form" class="primary full" ${s.busy||!b?'disabled':''}>${s.busy?'正在保存…':editing?'保存修改':child?'发布子任务':'发布任务'} →</button></footer>`;
}
export function members(s) {
  const b=s.sync.board;
  if (!b?.club) return `<section class="page">${syncRow(s)}${error(s)}</section>${nav('members',b)}`;
  const department=s.inviteDepartment || '', token=invitationToken(s.invites,department);
  return `<section class="page"><div class="eyebrow space">OUR PEOPLE</div><div class="row between space"><h1 class="h1">一起做事的人</h1>${link('/account','账号设置','secondary compact')}</div><p class="muted space">${e(b.club.name)} · ${b.members.length} 位成员</p>${syncRow(s)}${error(s)}
  ${isAdmin(b.me.role)?`<div class="card section"><div class="row between"><h2 class="h2">邀请新伙伴</h2><span class="invite-star">✦</span></div><div class="field space"><label class="label" for="inviteDepartment">邀请加入部门</label><select id="inviteDepartment" name="inviteDepartment" ${busy(s)}><option value="">社团通用 · 暂不分配部门</option>${DEPARTMENTS.map(d=>`<option value="${d.id}" ${department===d.id?'selected':''}>${d.name}</option>`).join('')}</select></div><p class="muted small space">${department?'用此邀请码或链接加入，将自动归入'+departmentLabel(department)+'。':'选择部门后分享对应邀请码，新成员会自动归入该部门。通用邀请码仅加入社团。'}</p><div class="invite-code space">${e(token||'正在获取邀请码…')}</div><div class="row space">${button('copyInvite','复制邀请码','secondary grow compact',token?'':'disabled')}${button('share','分享邀请','primary grow compact',token?'':'disabled')}</div>${b.me.role==='owner'?button('rotateInvite','更换此邀请码','plain small space',s.busy||!token?'disabled':''):''}</div>`:'<p class="hint section">邀请新成员请联系本社团管理员。</p>'}
  <div class="section row between"><h2 class="h2">社团成员</h2><span class="small muted">所有成员都能发布任务</span></div><div class="card space">${b.members.map(m=>`<div class="row between member-row"><div class="row grow"><div class="avatar ${isAdmin(m.role)?'owner':''}">${e(m.name[0])}</div><div class="grow"><div class="wrap">${e(m.name)}${m.id===b.me.id?' <span class="small muted">（我）</span>':''}</div><div class="small muted">${e(departmentLabel(m.department))}</div></div></div><span class="pill">${roleLabel(m.role)}</span></div>`).join('')}</div>
  <form data-form="name" class="section"><label class="label" for="nickname">我的社团称呼</label><div class="row"><input class="grow" id="nickname" name="nickname" value="${e(s.form.nickname??b.me.name)}" required maxlength="20"><button class="secondary compact" ${busy(s)}>保存</button></div></form>${link('/entry','切换、加入或创建社团 →','plain full section center')}<p class="small muted center">当前账号：${e(user()?.username)}</p>${button('logout','退出登录','plain full',busy(s))}</section>${nav('members',b)}`;
}
