import { createSyncClient } from '../shared/sync-client';
import { isAdmin } from '../shared/permissions';
let base = '';
const SESSION_KEY = 'sps-web-session';
let session;
try { session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { session = null; }
if (session && session.expiresAt <= Date.now()) session = null;
const clubKey = () => 'sps-web-club:' + (session?.user.id || 'guest');
export const user = () => session?.user || null;
export const clubId = () => sessionStorage.getItem(clubKey()) || '';
export const requestId = () => crypto.randomUUID();
export function configure(value) { base = value.replace(/\/$/, ''); }
export function setClub(value) { sessionStorage.setItem(clubKey(), value); sync.select(); }
function saveSession(value) {
  session = value; if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value)); else sessionStorage.removeItem(SESSION_KEY);
  inviteCache = null; sync.select();
}
async function request(path, data) {
  if (!navigator.onLine) throw Object.assign(new Error('网络已断开，请联网后重试'), { code: 'OFFLINE' });
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(base + path, {
      method: 'POST', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: 'Bearer ' + session.token } : {}) },
      body: JSON.stringify(data), signal: controller.signal
    });
    let result;
    try { result = await response.json(); } catch { throw new Error('服务返回异常，请稍后重试'); }
    if (!response.ok || !result.ok) {
      if (response.status === 401 && path === '/api') { saveSession(null); window.dispatchEvent(new Event('sps:logged-out')); }
      throw Object.assign(new Error(result.message || '操作失败'), { code: result.code || 'SERVER' });
    }
    if (result.data.currentUser && session && result.data.currentUser.id === session.user.id) {
      session = { ...session, user:result.data.currentUser };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    }
    return result.data;
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof TypeError) throw Object.assign(new Error('连接失败，请检查网络后重试'), { code: 'NETWORK' });
    throw error;
  } finally { clearTimeout(timeout); }
}
const transport = (action, input) => request('/api', { action, input });
export const sync = createSyncClient({ transport, context: () => ({ namespace: base + ':' + (session?.user.id || 'guest'), clubId: clubId() }) });
export const bootstrap = options => sync.refresh(options);
export const call = (action, input) => sync.mutate(action, input);
export const adminMembers = clubId => transport('adminMembers', { clubId });
export const adminArchives = clubId => transport('adminArchives', { clubId });
export const bookingStatus = clubId => transport('bookingStatus', {clubId});
export const accountSettings = () => transport('accountSettings', {});
export const changeUsername = input => transport('accountChangeUsername', input);
export const changePassword = input => transport('accountChangePassword', input);
export async function authenticate(mode, data) {
  const result = await request('/auth/' + mode, data);
  saveSession({ token: result.token, user: result.user, expiresAt: result.expiresAt });
  if (result.clubId) setClub(result.clubId);
  return result;
}
export async function logout() {
  // Invalidate on the server before removing the local token; a failed request
  // remains retryable instead of silently leaving a live session behind.
  await request('/auth/logout', {}); saveSession(null);
}
let inviteCache = null;
export function clearInviteCache() { inviteCache = null; }
export function getInvite(board) {
  if (!isAdmin(board?.me?.role)) {
    clearInviteCache();
    return Promise.reject(Object.assign(new Error('仅本社团管理员可以查看和分享邀请码'), { code:'FORBIDDEN' }));
  }
  const key = user().id + ':' + board.club.id + ':' + board.club.inviteVersion;
  if (inviteCache?.key === key) return inviteCache.promise;
  const cached = { key, promise: transport('getInvite', { clubId: board.club.id }) };
  inviteCache = cached; cached.promise.catch(() => { if (inviteCache === cached) inviteCache = null; });
  return cached.promise;
}
export function syncLabel(state) {
  if (state.phase === 'offline') return '离线 · 显示上次内容';
  if (state.phase === 'error') return state.board ? '同步失败 · 显示上次内容' : '同步失败，请重试';
  if (state.phase === 'syncing') return '正在同步…';
  return state.phase === 'ready' ? '已同步 · 自动更新' : '准备同步…';
}
