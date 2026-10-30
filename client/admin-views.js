import { isAdmin, roleLabel } from '../shared/permissions';
import { DEPARTMENTS, departmentLabel } from '../shared/departments';
import { parts } from '../shared/view';
import { e, button, link, error, busy, field, syncRow, nav } from './ui';
const date = value => value ? parts(value).date : '—';
const stamp = value => { const p=parts(value); return p.date+' '+p.time; };
function guard(s) {
  if (!s.sync.board?.club) return `<section class="page">${syncRow(s)}${error(s)}<p class="empty">正在检查管理权限…</p></section>`;
  if (!isAdmin(s.sync.board.me.role) || s.adminDenied) return `<section class="page">${link('/members','← 返回成员页','plain small')}<h1 class="h1 section">仅管理员可用</h1><p class="muted space">你没有本社团的成员管理权限。</p></section>${nav('members',s.sync.board)}`;
  return '';
}
export function admin(s) {
  const denied=guard(s); if (denied) return denied;
  const b=s.sync.board, data=s.adminData, query=(s.search||'').trim().toLowerCase();
  const members=(data?.members||[]).filter(m=>(m.name+' '+m.username+' '+departmentLabel(m.department)).toLowerCase().includes(query));
  const name=id=>data.members.find(m=>m.id===id)?.name || '社团成员';
  const labels={name:'称呼',role:'角色',username:'用户名',department:'所属部门'};
  return `<section class="page"><div class="eyebrow space">MEMBER ADMINISTRATION</div><div class="row between space"><h1 class="h1">成员与账号管理</h1><span class="pill">${roleLabel(b.me.role)}</span></div><p class="muted small space">${e(b.club.name)} · 管理成员资料与登录账号</p>${syncRow(s)}${error(s)}
  <div class="banner space">创建者可以任免管理员；管理员可以管理普通成员及其所属部门。</div>${link('/members','获取部门邀请码 →','plain small space')}<div class="search-box"><input name="search" aria-label="搜索成员、用户名或部门" placeholder="搜索成员、用户名或部门" value="${e(s.search)}"></div>
  ${!data?'<p class="empty">正在加载成员账号…</p>':`<div class="small muted space">${members.length} 位成员</div>${members.map(m=>`<article class="card admin-member space"><div class="row"><div class="avatar ${isAdmin(m.role)?'owner':''}">${e(m.name[0])}</div><div class="grow"><div class="row between"><strong class="wrap">${e(m.name)}${m.id===b.me.id?'（我）':''}</strong><span class="pill">${roleLabel(m.role)}</span></div><p class="small muted wrap">@${e(m.username||'无网页账号')} · ${e(departmentLabel(m.department))}</p></div></div><div class="row between space"><span class="small muted">加入于 ${date(m.joinedAt)}</span>${m.canEdit?link('/admin-edit?id='+encodeURIComponent(m.id),'编辑资料 →','secondary compact'):'<span class="small muted">由创建者管理</span>'}</div></article>`).join('')||'<p class="empty">没有匹配的成员。</p>'}
  <h2 class="h2 section">最近管理记录</h2><div class="card space">${data.events.map(event=>`<div class="admin-event"><p class="small wrap">${e(name(event.actorId))} ${event.action==='reset'?'生成密码重设链接：':'修改'+event.fields.map(f=>labels[f]||f).map(e).join('、')+'：'}${e(name(event.targetId))}</p><span class="hint">${stamp(event.at)} · 北京时间</span></div>`).join('')||'<p class="small muted">还没有管理操作。</p>'}</div>`}</section>${nav('admin',b)}`;
}
export function adminEditor(s) {
  const denied=guard(s); if (denied) return denied;
  const b=s.sync.board, m=s.adminTarget, f=s.form;
  const back=link('/admin','← 返回成员管理','plain small');
  if (!m) return `<section class="page">${back}${error(s)}${s.error?'':'<p class="empty">正在加载成员资料…</p>'}</section>`;
  if (!m.canEdit) return `<section class="page">${back}<p class="error section">仅创建者可以管理这位管理员。</p></section>`;
  return `<section class="page">${back}<div class="eyebrow section">MEMBER PROFILE</div><h1 class="h1 space">编辑成员资料</h1><p class="muted small space">${e(m.name)} · ${roleLabel(m.role)}</p>${error(s)}
  <form id="admin-member-form" data-form="adminMember" class="section"><fieldset ${busy(s)}>
  ${field('memberName','社团内称呼',f.memberName,'text','required maxlength="20" autocomplete="off"')}
  <div class="field"><label class="label" for="memberDepartment">所属部门</label><select id="memberDepartment" name="memberDepartment"><option value="">未分配</option>${DEPARTMENTS.map(d=>`<option value="${d.id}" ${f.memberDepartment===d.id?'selected':''}>${d.name}</option>`).join('')}</select><p class="hint">使用部门邀请码加入会自动归入该部门，也可在这里调整。</p></div>
  <div class="field"><label class="label" for="memberRole">社团角色</label>${b.me.role==='owner'&&m.role!=='owner'?`<select id="memberRole" name="memberRole"><option value="member" ${f.memberRole==='member'?'selected':''}>成员</option><option value="admin" ${f.memberRole==='admin'?'selected':''}>管理员</option></select>`:`<div class="picker-value">${roleLabel(m.role)}</div>`}<p class="hint">创建者身份保留；仅创建者可以任免管理员。</p></div>
  ${field('memberUsername','登录用户名',f.memberUsername,'text',`required minlength="3" maxlength="30" pattern="[a-zA-Z0-9_]+" autocomplete="off" autocapitalize="none" ${m.canEditAccount?'':'disabled'}`)}
  ${m.accountRestriction?`<p class="hint">${e(m.accountRestriction)}；仍可维护本社团内的资料。</p>`:'<p class="hint">用户名须为3—30位字母、数字或下划线。修改后请告知成员使用新用户名登录。</p>'}
  <div class="section">${field('adminPassword','你的密码 · 确认账号或角色变更',f.adminPassword,'password','minlength="10" maxlength="128" autocomplete="current-password" placeholder="仅修改称呼或部门时可留空"')}</div>
  <div class="small muted">账号创建于 ${date(m.accountCreatedAt)} · 加入社团于 ${date(m.joinedAt)}</div>
  <button class="primary full section" type="submit" ${busy(s)}>${s.busy?'正在保存…':'保存修改'}</button>
  </fieldset></form>
  ${m.canEditAccount?`<section class="card section"><h2 class="h2">帮助成员重设密码</h2><p class="small muted space">生成一个30分钟内有效、仅能使用一次的链接，交给该成员自行设置新密码。完成后会退出所有旧会话，并生成新的账号恢复码。</p>${button('adminReset','生成密码重设链接','secondary full space',busy(s))}${s.resetLink?`<div class="space" role="status"><label class="label" for="reset-link">发送给 ${e(s.resetUsername)}</label><textarea id="reset-link" readonly aria-label="密码重设链接">${e(s.resetLink)}</textarea><p class="hint">有效至 ${stamp(s.resetExpiresAt)}（北京时间）。再次生成将使旧链接失效。</p>${button('copyReset','复制重设链接','primary full space')}</div>`:''}</section>`:''}
  </section>`;
}
export function resetPassword(s) {
  if (s.recovery) return `<section class="page entry"><h1 class="h1">密码已更新</h1><p class="muted space">旧会话已退出。请保存新的账号恢复码，仅显示这一次。</p><div class="invite-code space">${e(s.recovery)}</div>${button('copyRecovery','复制恢复码','secondary full space')}${button('continue','我已保存，进入社团 →','primary full section')}</section>`;
  if (!/^[a-f0-9]{64}$/.test(s.resetToken || '')) return `<section class="page entry"><h1 class="h1">请重新打开重设链接</h1><p class="error section" role="alert">请打开管理员发送的完整链接。为保护账号，刷新页面后需要重新打开原链接。</p>${link('/auth','返回登录','plain full section center')}</section>`;
  return `<section class="page entry"><div class="brand-mark">SPS</div><h1 class="h1">设置新密码</h1><p class="muted space">这是管理员提供的一次性重设链接。请在有效期内设置新密码。</p><form data-form="resetPassword" class="section"><fieldset ${busy(s)}>${field('username','用户名',s.form.username,'text','required minlength="3" maxlength="30" autocomplete="username"')}${field('password','新密码',s.form.password,'password','required minlength="10" maxlength="128" autocomplete="new-password"')}${field('confirmPassword','再次输入新密码',s.form.confirmPassword,'password','required minlength="10" maxlength="128" autocomplete="new-password"')}${error(s)}<button type="submit" class="primary full" ${busy(s)}>${s.busy?'正在更新…':'设置新密码'}</button></fieldset></form>${link('/auth','返回登录','plain full section center')}</section>`;
}
