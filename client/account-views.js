import { e, button, link, error, busy, field } from './ui';

export function accountSettings(s) {
  const back=link(s.sync.board?.club?'/members':'/entry','← 返回社团','plain small');
  if (s.recovery) return `<section class="page">${back}<div class="eyebrow section">ACCOUNT SECURITY</div><h1 class="h1 space">密码已更新</h1><p class="muted space">其他登录已退出，当前页面保持登录。旧恢复码和重设链接已失效。</p><div class="card section"><h2 class="h2">保存新的账号恢复码</h2><p class="small muted space">仅显示这一次，请保存在只有你能访问的地方。忘记密码时，可用它找回账号。</p><div class="invite-code space">${e(s.recovery)}</div>${button('copyRecovery','复制恢复码','secondary full space')}${button('accountRecoverySaved','我已保存，返回账号设置','primary full section')}</div></section>`;
  const a=s.account, f=s.form;
  return `<section class="page">${back}<div class="eyebrow section">MY ACCOUNT</div><h1 class="h1 space">账号设置</h1><p class="muted small space">管理自己的登录用户名和密码，所有社团共用此账号。</p>${error(s)}
  ${!a?`<p class="empty">${s.error?'暂时无法读取账号资料。':'正在读取账号资料…'}</p>${s.error?button('reloadAccount','重新加载账号资料','secondary full',busy(s)):''}`:`
  <div class="card section"><div class="small muted">当前登录用户名</div><strong class="wrap">@${e(a.username)}</strong><p class="hint space">修改登录信息不会改变社团称呼、部门、角色或已有任务。</p></div>
  <form data-form="accountUsername" class="card section"><fieldset ${busy(s)}><h2 class="h2">修改用户名</h2><p class="small muted space">保存后使用新用户名登录，当前密码和恢复码保持有效。</p>
  ${field('accountUsername','新用户名',f.accountUsername,'text','required minlength="3" maxlength="30" pattern="[a-zA-Z0-9_]+" autocomplete="username" autocapitalize="none" spellcheck="false"')}
  <p class="hint">3—30位英文字母、数字或下划线，不区分大小写。</p>
  <div class="space">${field('usernamePassword','当前密码 · 确认用户名修改',f.usernamePassword,'password','required minlength="10" maxlength="128" autocomplete="current-password"')}</div>
  <button type="submit" class="primary full" ${busy(s)}>保存用户名</button></fieldset></form>
  <form data-form="accountPassword" class="card section"><fieldset ${busy(s)}><h2 class="h2">修改密码</h2><p class="small muted space">修改后退出其他登录，并生成新的恢复码。当前页面保持登录。</p>
  ${field('currentPassword','当前密码',f.currentPassword,'password','required minlength="10" maxlength="128" autocomplete="current-password"')}
  ${field('newPassword','新密码',f.newPassword,'password','required minlength="10" maxlength="128" autocomplete="new-password" placeholder="10—128个字符，与当前密码不同"')}
  ${field('confirmPassword','再次输入新密码',f.confirmPassword,'password','required minlength="10" maxlength="128" autocomplete="new-password"')}
  <button type="submit" class="primary full" ${busy(s)}>更新密码</button></fieldset></form>
  ${button('reloadAccount','重新加载账号资料','plain full section',busy(s))}<p class="hint center">资料被修改或页面过期时，可重新加载后再操作。</p>`}
  </section>`;
}
