import { DurableObject } from 'cloudflare:workers';
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import domain from '../shared/domain.js';
import { createStore } from './store.mjs';
import { createAdminService, bumpAccountRevision } from './admin.mjs';
import { createAccountService } from './account.mjs';
const { createService, ClubError } = domain;
const hash = value => createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(32).toString('hex');
const fail = (code, message) => { throw new ClubError(code, message); };
const SESSION_AGE = 7 * 86400000;
const STATUS = { VALIDATION: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, ARCHIVED: 409, RATE_LIMIT: 429 };
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
// Cross-zone Worker fetches mask CF-Connecting-IP. Only accept a client IP
// authenticated by our gateway; unsigned direct requests retain the old path.
function clientIp(request, env) {
  const ip = request.headers.get('X-SPS-Gateway-IP');
  const time = request.headers.get('X-SPS-Gateway-Time');
  const proof = request.headers.get('X-SPS-Gateway-Signature');
  if (env.GATEWAY_SIGNING_KEY && ip && ip.length <= 64 && /^\d{13}$/.test(time || '') &&
      Math.abs(Date.now() - Number(time)) <= 60000 && /^[a-f0-9]{64}$/.test(proof || '')) {
    const expected = createHmac('sha256', env.GATEWAY_SIGNING_KEY).update(`${time}\n${ip}`).digest('hex');
    if (timingSafeEqual(Buffer.from(proof, 'hex'), Buffer.from(expected, 'hex'))) return ip;
  }
  return request.headers.get('CF-Connecting-IP') || 'local';
}
function username(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_]{3,30}$/.test(value)) fail('VALIDATION', '用户名须为3—30位英文字母、数字或下划线');
  return value.toLowerCase();
}
function password(value) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128) fail('VALIDATION', '密码须为10—128个字符');
  return value;
}
function passwordHash(value, salt) {
  // Native scrypt runs inside the Durable Object, not the thin edge router.
  return scryptSync(value, salt, 32, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }).toString('hex');
}
function equal(a, b) { return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex')); }
async function readBody(request) {
  if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) fail('VALIDATION', '请求格式无效');
  const reader = request.body?.getReader(); if (!reader) fail('VALIDATION', '请求内容为空');
  const chunks = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > 32768) { await reader.cancel(); fail('VALIDATION', '请求内容过长'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { const body = JSON.parse(new TextDecoder().decode(bytes)); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); return body; }
  catch { fail('VALIDATION', '请求格式无效'); }
}

export class ClubService extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env); this.env = env; this.sql = ctx.storage.sql;
    this.store = createStore(ctx.storage);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, salt TEXT NOT NULL,
      password_hash TEXT NOT NULL, recovery_hash TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);`);
    this.run = createService({ store: this.store, now: Date.now, hash, randomId: () => randomBytes(16).toString('hex') });
    this.admin = createAdminService({ store:this.store, sql:this.sql, hash, random, username, verifyPassword:(id,pass) => this.verifyPassword(id,pass,'admin-password') });
    this.account = createAccountService({ store:this.store, sql:this.sql, hash, random, username, password, passwordHash, verifyPassword:(id,pass) => this.verifyPassword(id,pass,'account-password') });
  }
  verifyPassword(id, pass, limitPrefix) {
    const row = this.sql.exec('SELECT salt,password_hash FROM accounts WHERE id=?', id).toArray()[0];
    if (typeof pass !== 'string' || pass.length < 10 || pass.length > 128 || !row || !equal(passwordHash(pass,row.salt),row.password_hash)) fail('FORBIDDEN', '请输入你自己的正确密码以确认操作');
    this.sql.exec('DELETE FROM rate_limits WHERE key=?', limitPrefix + ':' + id);
  }
  limit(key, maximum, window) {
    const now = Date.now();
    const row = this.sql.exec('SELECT count,expires_at FROM rate_limits WHERE key=?', key).toArray()[0];
    if (row && row.expires_at > now && row.count >= maximum) fail('RATE_LIMIT', '尝试过于频繁，请稍后再试');
    this.sql.exec('INSERT INTO rate_limits VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,expires_at=excluded.expires_at',
      key, row && row.expires_at > now ? row.count + 1 : 1, row && row.expires_at > now ? row.expires_at : now + window);
  }
  session(account) {
    const token = random(), expiresAt = Date.now() + SESSION_AGE;
    this.sql.exec('INSERT INTO sessions VALUES(?,?,?)', hash(token), account.id, expiresAt);
    return { token, expiresAt, user: { id: account.id, username: account.username } };
  }
  authenticate(request) {
    const bearer = request.headers.get('Authorization') || '';
    if (!/^Bearer [a-f0-9]{64}$/.test(bearer)) fail('UNAUTHENTICATED', '请先登录');
    const tokenHash = hash(bearer.slice(7));
    const session = this.sql.exec('SELECT account_id,expires_at FROM sessions WHERE token_hash=?', tokenHash).toArray()[0];
    if (!session || session.expires_at <= Date.now()) fail('UNAUTHENTICATED', '登录已过期，请重新登录');
    return { id: session.account_id, tokenHash };
  }
  async handle(request, data) {
    const path = new URL(request.url).pathname;
    const ip = request.headers.get('X-SPS-IP');
    if (['/auth/register', '/auth/login', '/auth/recover'].includes(path)) {
      this.sql.exec('DELETE FROM rate_limits WHERE expires_at < ?', Date.now());
      this.sql.exec('DELETE FROM sessions WHERE expires_at < ?', Date.now());
      this.limit('ip:' + ip, 120, 15 * 60000);
    }
    if (path === '/auth/register') {
      if (this.env.REGISTRATION_OPEN !== 'true') fail('FORBIDDEN', '当前暂不接受新账号');
      this.limit('register:' + ip, 30, 3600000);
      const name = username(data.username), pass = password(data.password);
      if (!['join', 'create'].includes(data.mode)) fail('VALIDATION', '请选择加入或创建社团');
      if (this.sql.exec('SELECT id FROM accounts WHERE username=?', name).toArray().length) fail('CONFLICT', '这个用户名已被使用');
      const account = { id: random(), username: name }, salt = random(), recoveryCode = random();
      const digest = passwordHash(pass, salt);
      // Account, membership, club and session commit or roll back together.
      return this.store.transaction(async () => {
        this.sql.exec('INSERT INTO accounts(id,username,salt,password_hash,recovery_hash,created_at) VALUES(?,?,?,?,?,?)', account.id, name, salt, digest, hash(recoveryCode), Date.now());
        const result = await this.run(data.mode === 'create' ? 'createClub' : 'joinClub', {
          nickname: data.nickname, name: data.name, token: data.invite,
          requestId: 'register_' + account.id
        }, account.id);
        return { ...this.session(account), clubId: result.clubId, recoveryCode };
      });
    }
    if (path === '/auth/login') {
      const name = username(data.username); password(data.password);
      this.limit('login:' + name, 10, 15 * 60000);
      const row = this.sql.exec('SELECT * FROM accounts WHERE username=?', name).toArray()[0];
      const digest = passwordHash(data.password, row?.salt || '0'.repeat(64));
      if (!row || !equal(digest, row.password_hash)) fail('UNAUTHENTICATED', '用户名或密码不正确');
      this.sql.exec('DELETE FROM rate_limits WHERE key=?', 'login:' + name);
      return this.session(row);
    }
    if (path === '/auth/recover') {
      const name = username(data.username); password(data.password);
      this.limit('recover:' + name, 5, 15 * 60000);
      const row = this.sql.exec('SELECT * FROM accounts WHERE username=?', name).toArray()[0];
      if (data.resetToken !== undefined) {
        const reset = typeof data.resetToken === 'string' && /^[a-f0-9]{64}$/.test(data.resetToken) ? this.sql.exec('SELECT * FROM account_resets WHERE token_hash=?', hash(data.resetToken)).toArray()[0] : null;
        if (!row || !reset || reset.account_id !== row.id || reset.expires_at <= Date.now()) fail('UNAUTHENTICATED', '重设链接无效或已过期，请联系管理员重新生成');
        await this.admin.validateReset(reset);
      } else if (typeof data.recoveryCode !== 'string' || !/^[a-f0-9]{64}$/.test(data.recoveryCode) || !row || !equal(hash(data.recoveryCode), row.recovery_hash)) fail('UNAUTHENTICATED', '用户名或恢复码不正确');
      const salt = random(), digest = passwordHash(data.password, salt), recoveryCode = random();
      return this.store.transaction(async () => {
        this.sql.exec('UPDATE accounts SET salt=?,password_hash=?,recovery_hash=? WHERE id=?', salt, digest, hash(recoveryCode), row.id);
        bumpAccountRevision(this.sql,row.id);
        this.sql.exec('DELETE FROM sessions WHERE account_id=?', row.id);
        this.sql.exec('DELETE FROM account_resets WHERE account_id=?', row.id);
        this.sql.exec('DELETE FROM rate_limits WHERE key IN (?,?)', 'recover:' + name, 'login:' + name);
        return { ...this.session(row), recoveryCode };
      });
    }
    const account = this.authenticate(request);
    if (path === '/auth/logout') { this.sql.exec('DELETE FROM sessions WHERE token_hash=?', account.tokenHash); return { ok: true }; }
    if (path !== '/api') fail('NOT_FOUND', '接口不存在');
    const selfAccount = typeof data.action === 'string' && data.action.startsWith('account');
    if (selfAccount && data.action !== 'accountSettings') {
      this.limit('account-write:' + account.id, 60, 15 * 60000);
      this.limit('account-password:' + account.id, 10, 15 * 60000);
    }
    // Caller identity comes only from the opaque server-side session.
    if (typeof data.action === 'string' && data.action.startsWith('admin') && !['adminMembers','adminArchives'].includes(data.action)) this.limit('admin-write:' + account.id, 60, 15 * 60000);
    // Count attempts outside the edit transaction so failed verification cannot roll the limit back.
    if (typeof data.action === 'string' && data.action.startsWith('admin') && data.input?.adminPassword !== undefined) this.limit('admin-password:' + account.id, 10, 15 * 60000);
    const result = await (selfAccount ? this.account(data.action, data.input || {}, account) : typeof data.action === 'string' && data.action.startsWith('admin') ? this.admin.execute(data.action, data.input || {}, account.id) : this.run(data.action, data.input, account.id));
    const currentUser = this.sql.exec('SELECT id,username FROM accounts WHERE id=?', account.id).toArray()[0];
    return { ...result, currentUser };
  }
  async fetch(request) {
    let data;
    try { data = await readBody(request); }
    catch (e) { return json({ ok: false, code: e.code || 'VALIDATION', message: e.message }, 400); }
    // The legacy domain is asynchronous. Serialize its read/modify/write flow;
    // catch inside this gate so ordinary validation failures do not reset it.
    return this.ctx.blockConcurrencyWhile(async () => {
      try { return json({ ok: true, data: await this.handle(request, data) }); }
      catch (error) {
        if (error instanceof ClubError) return json({ ok: false, code: error.code, message: error.message }, STATUS[error.code] || 400);
        console.error('SPS request failed', error.name, error.message);
        return json({ ok: false, code: 'INTERNAL', message: '服务暂时不可用，请稍后重试' }, 500);
      }
    });
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (origin && !allowed.includes(origin)) return json({ ok: false, message: '此网站未获授权' }, 403);
    const headers = { Vary: 'Origin', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (origin) Object.assign(headers, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST,GET,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization', 'Access-Control-Max-Age': '86400' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const path = new URL(request.url).pathname;
    if (path === '/health' && request.method === 'GET') return Response.json({ ok: true, service: 'sps-club-api' }, { headers });
    if (request.method !== 'POST' || !['/api', '/auth/register', '/auth/login', '/auth/logout', '/auth/recover'].includes(path)) return Response.json({ ok: false, message: '接口不存在' }, { status: 404, headers });
    const forwarded = new Request(request);
    forwarded.headers.set('X-SPS-IP', hash(clientIp(request, env)));
    const stub = env.CLUB_SERVICE.get(env.CLUB_SERVICE.idFromName('sps-club-service-v1'));
    const response = await stub.fetch(forwarded);
    return new Response(response.body, { status: response.status, headers: { ...Object.fromEntries(response.headers), ...headers } });
  }
};
