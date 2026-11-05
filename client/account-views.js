import { e, button, link, error, busy, field } from './ui';

export function emailReminder(user) {
  if(!user || user.emailVerified || user.emailNotificationsEnabled===false)return '';
  return `<aside class="email-reminder" role="status"><strong>${user.email?'请验证常用邮箱':'请补充常用邮箱'}</strong><span>验证后才能收到任务分配、截止和前置依赖提醒。</span>${link('/account',user.email?'去验证邮箱 →':'填写邮箱 →','secondary compact')}</aside>`;
}

function emailSettings(a,f,s) {
  return `<div class="card section"><div class="row between"><h2 class="h2">邮件提醒</h2>${button('accountNotifications',a.emailNotificationsEnabled===false?'已关闭':'已开启','secondary compact',`role="switch" aria-checked="${a.emailNotificationsEnabled!==false}" aria-label="接收任务邮件提醒" ${busy(s)}`)}</div><p class="hint space">关闭后不再接收任务分配、截止、逾期或依赖提醒；你的逾期也不会触发给部门负责人的邮件。邮箱验证码仍可正常接收。此设置对你的所有社团生效。</p><div class="divider"></div><h2 class="h2">常用邮箱</h2><p class="small space">${a.email?`${e(a.email)} · ${a.emailVerified?'已验证':'待验证'}`:'尚未填写，请补充常用邮箱。'}</p><p class="hint space">用于负责人分配、截止前24小时、到期及依赖完成提醒。逾期任务还会通知对应部门管理员。邮箱仅自己可见。</p>
  ${a.email&&!a.emailVerified?`<form data-form="accountEmailVerify" class="space"><fieldset ${busy(s)}>${field('emailCode','邮箱中的6位验证码',f.emailCode,'text','required pattern="[0-9]{6}" maxlength="6" inputmode="numeric" autocomplete="one-time-code"')}<p class="hint">验证码15分钟内有效。未收到时请检查垃圾邮件，或一分钟后重新发送。</p><button type="submit" class="primary full">验证邮箱</button>${button('resendEmail','重新发送验证码','plain full space',busy(s))}</fieldset></form>`:''}
  <form data-form="accountEmail" class="section"><fieldset ${busy(s)}>${field('accountEmail',a.email?'修改常用邮箱':'常用邮箱',f.accountEmail,'email','required maxlength="254" autocomplete="email" autocapitalize="none" spellcheck="false" placeholder="name@example.com"')}${field('emailPassword','当前密码 · 确认邮箱绑定',f.emailPassword,'password','required minlength="10" maxlength="128" autocomplete="current-password"')}<button type="submit" class="secondary full">保存邮箱并发送验证码</button></fieldset></form></div>`;
}

export function accountSettings(s) {
  const back=link(s.simpleMode?'/simple':s.sync.board?.club?'/members':'/entry','← 返回社团','plain small');
  if (s.recovery) return `<section class="page">${back}<div class="eyebrow section">ACCOUNT SECURITY</div><h1 class="h1 space">密码已更新</h1><p class="muted space">其他登录已退出，当前页面保持登录。旧恢复码和重设链接已失效。</p><div class="card section"><h2 class="h2">保存新的账号恢复码</h2><p class="small muted space">仅显示这一次，请保存在只有你能访问的地方。忘记密码时，可用它找回账号。</p><div class="invite-code space">${e(s.recovery)}</div>${button('copyRecovery','复制恢复码','secondary full space')}${button('accountRecoverySaved','我已保存，返回账号设置','primary full section')}</div></section>`;
  const a=s.account, f=s.form;
  return `<section class="page">${back}<div class="eyebrow section">MY ACCOUNT</div><h1 class="h1 space">账号设置</h1><p class="muted small space">管理常用邮箱、登录用户名和密码，所有社团共用此账号。</p>${error(s)}
  ${!a?`<p class="empty">${s.error?'暂时无法读取账号资料。':'正在读取账号资料…'}</p>${s.error?button('reloadAccount','重新加载账号资料','secondary full',busy(s)):''}`:`
  ${emailSettings(a,f,s)}
  <div class="card section"><div class="small muted">当前登录用户名</div><strong class="wrap">@${e(a.username)}</strong><p class="hint space">修改登录信息不会改变姓名、部门、角色或已有任务。</p></div>
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
