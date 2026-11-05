// Runs BEFORE the website's modules, only in its own top-level entry document.
// Persist the website's session contract and successful, opted-in authentication.
(() => {
  if (window.top !== window || location.origin !== 'https://sps-club-schedule.github.io'
      || !['/sps-club-schedule/', '/sps-club-schedule/index.html'].includes(location.pathname)
      || window.__spsAndroidInstalled || !window.SPSNative) return;
  window.__spsAndroidInstalled = true;
  const initial = __SPS_SNAPSHOT__;
  const key = 'sps-web-session', store = window.sessionStorage;
  const proto = Storage.prototype, set = proto.setItem, remove = proto.removeItem, clear = proto.clear;
  const valid = value => value && /^[a-f0-9]{64}$/.test(value.token)
    && Number.isFinite(value.expiresAt) && value.expiresAt > Date.now()
    && typeof value.user?.id === 'string' && typeof value.user?.username === 'string';
  const read = () => { try { return JSON.parse(store.getItem(key)); } catch { return null; } };
  const send = value => window.SPSNative.postMessage(JSON.stringify(value));
  const modeKey='sps-display-mode',validMode=value=>value==='simple'||value==='full';
  // Native preferences survive WebView cache cleanup and logout.
  if(validMode(initial.displayMode))set.call(window.localStorage,modeKey,initial.displayMode);
  function persistMode(storage,name) {
    if(storage!==window.localStorage||name!==modeKey)return;
    const mode=storage.getItem(modeKey);if(validMode(mode))send({type:'displayMode',mode});
  }
  if (!valid(read())) {
    remove.call(store, key);
    if (valid(initial.session)) {
      set.call(store, key, JSON.stringify(initial.session));
      if (initial.clubId) set.call(store, 'sps-web-club:' + initial.session.user.id, initial.clubId);
    }
  }
  function persist() {
    const value = read();
    // Copy a strict allowlist so future form/password fields cannot be saved.
    const session = valid(value) ? {
      token: value.token, expiresAt: value.expiresAt,
      user: { id: value.user.id, username: value.user.username }
    } : null;
    send({ type: 'session', session, clubId: session ? store.getItem('sps-web-club:' + session.user.id) || '' : '' });
  }
  function relevant(storage, name) {
    return storage === store && (name === key || name === 'sps-web-club:' + read()?.user?.id);
  }
  proto.setItem = function (name, value) {
    set.call(this, name, value);
    if (relevant(this, String(name))) persist();
    persistMode(this,String(name));
  };
  proto.removeItem = function (name) {
    const changed = relevant(this, String(name)); remove.call(this, name);
    if (changed) persist();
  };
  proto.clear = function () { clear.call(this); if (this === store) persist(); };
  persist();
  // Keep the choice across the site's form rerenders and failed attempts. No
  // password is read while typing or saved before authentication succeeds.
  let rememberLogin = true;
  function addRememberControls() {
    for (const form of document.querySelectorAll('form[data-form="auth"],form[data-form="resetPassword"]')) {
      if (form.querySelector('[data-sps-remember]')) continue;
      const label = document.createElement('label'), input = document.createElement('input');
      input.type = 'checkbox'; input.dataset.spsRemember = ''; input.checked = rememberLogin;
      input.style.cssText = 'width:1.1em;height:1.1em;flex:none;margin:0;accent-color:#245540';
      label.style.cssText = 'display:flex;align-items:center;gap:.6rem;margin:1rem 0;font-size:.9rem;color:#245540;cursor:pointer';
      label.append(input, document.createTextNode('在这台手机记住密码，下次自动登录'));
      // This native-only option has no form name and is not a website field.
      for (const event of ['input', 'change']) input.addEventListener(event, e => {
        rememberLogin = input.checked; e.stopPropagation();
      });
      form.insertBefore(label, form.querySelector('button[type="submit"]'));
    }
  }
  if (typeof document.querySelectorAll === 'function') {
    const start = () => {
      addRememberControls();
      new MutationObserver(addRememberControls).observe(document.documentElement, {childList:true, subtree:true});
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
    else start();
  }

  // Only the submitted credential of a successful auth response crosses into
  // encrypted native storage. Stored passwords are never returned to the page.
  const wantsRemember = () => document.querySelector?.('[data-sps-remember]')?.checked ?? rememberLogin;
  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') window.fetch = async function (input, options) {
    let url, submitted, action;
    const rememberAtSubmit = wantsRemember();
    try {
      url = new URL(typeof input === 'string' ? input : input.url, location.origin);
      const method = (options?.method || input?.method || 'GET').toUpperCase();
      if (url.origin === 'https://sps-schedule.folderrewind.top' && !url.search
          && method === 'POST' && typeof options?.body === 'string') {
        const body = JSON.parse(options.body);
        if (['/auth/login','/auth/register','/auth/recover'].includes(url.pathname)
            && typeof body.username === 'string' && /^[a-zA-Z0-9_]{3,30}$/.test(body.username) && typeof body.password === 'string'
            && body.password.length >= 10 && body.password.length <= 128) {
          submitted = {username:body.username, password:body.password};
        }
        if (url.pathname === '/api') action = body.action;
      }
    } catch { /* Unrecognized requests retain ordinary fetch behavior. */ }
    if(submitted)send({type:'loginStarted'});
    const response = await originalFetch.call(this, input, options);
    try {
      if (url?.origin === 'https://sps-schedule.folderrewind.top' && response.ok) {
        let type;
        if (url.pathname === '/auth/logout') type = 'signedOut';
        if (url.pathname === '/auth/recover') type = 'credentialsChanged';
        if (action === 'accountChangePassword') type = 'credentialsChanged';
        if (type || submitted) {
          const result = await response.clone().json();
          if (result.ok && submitted && valid(result.data)
              && result.data.user.username.toLowerCase() === submitted.username.toLowerCase()) {
            const {token, expiresAt, user} = result.data;
            const remember = rememberAtSubmit && wantsRemember();
            send({type:'webLogin', remember, username:user.username,
              ...(remember ? {password:submitted.password} : {}),
              session:{token, expiresAt, user:{id:user.id, username:user.username}},
              clubId:typeof result.data.clubId === 'string' ? result.data.clubId : ''});
          } else if (type && result.ok) send({ type });
        }
      }
    } catch { /* A compatibility observer never changes a website response. */ }
    submitted = null;
    return response;
  };
  window.addEventListener('sps:logged-out', () => send({ type: 'sessionExpired' }));
  window.addEventListener('online',()=>{if(!valid(read()))send({type:'sessionExpired'});});

  // WebView cannot download a blob URL through Android's browser/download manager.
  // Use the system Save dialog for generated calendar/source files instead.
  async function download(anchor) {
    try {
      const blob = await (await fetch(anchor.href)).blob();
      if (blob.size > 2 * 1024 * 1024) throw new Error('文件超过 App 导出上限，请在浏览器中下载');
      send({ type: 'saveText', name: anchor.download, text: await blob.text(),
        mime: blob.type.startsWith('text/calendar') ? 'text/calendar' : 'text/plain' });
    } catch (error) { send({ type: 'notice', text: error.message }); }
  }
  const isBlob = anchor => anchor && anchor.hasAttribute('download') && anchor.href.startsWith('blob:' + location.origin + '/');
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (isBlob(this)) download(this); else click.call(this); };
  document.addEventListener('click', event => {
    const anchor = event.target.closest?.('a[download]');
    if (isBlob(anchor)) { event.preventDefault(); event.stopImmediatePropagation(); download(anchor); }
    else if (anchor && /^https:\/\//.test(anchor.href)) {
      event.preventDefault(); send({ type: 'download', url: anchor.href });
    }
  }, true);
})();
