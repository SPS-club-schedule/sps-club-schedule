import { createHash, randomBytes } from 'node:crypto';
import permissions from '../shared/permissions.js';
import domain from '../shared/domain.js';
import { accountRevision } from './admin.mjs';

const hash = s => createHash('sha256').update(s).digest('hex');
const reject = (code, message) => { throw new domain.ClubError(code, message); };

export function createBookingIdentity({sql, store, env, mail}) {
  sql.exec(`CREATE TABLE IF NOT EXISTS booking_entry_codes (
    code_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, session_hash TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS booking_entry_expiry ON booking_entry_codes(expires_at)`);

  async function identity(id) {
    if (!env.BOOKING_CLUB_ID || !env.BOOKING_SYNC_KEY) reject('FORBIDDEN','预约登录尚未配置');
    const member = await store.get('members','m_'+hash(env.BOOKING_CLUB_ID+':'+id).slice(0,32));
    const account = sql.exec('SELECT id,username FROM accounts WHERE id=?',id).toArray()[0];
    if (!account || !member || member.archived || !permissions.isCoreMember(member.role)) {
      reject('FORBIDDEN','仅 SPS 在籍成员和管理员可以使用日程账号进入预约网站');
    }
    const address = mail.info(id);
    return {id, username:account.username, verifiedEmail:address.emailVerified ? address.email : '', revision:accountRevision(sql,id)};
  }

  async function issue(session) {
    await identity(session.id);
    const code = randomBytes(32).toString('hex'), expiresAt = Date.now()+90000;
    sql.exec('DELETE FROM booking_entry_codes WHERE expires_at<=?',Date.now());
    sql.exec('INSERT INTO booking_entry_codes VALUES(?,?,?,?)',hash(code),session.id,session.tokenHash,expiresAt);
    return {code,expiresAt};
  }

  async function fromCode(code, consume) {
    if (typeof code !== 'string' || !/^[0-9a-f]{64}$/.test(code)) reject('UNAUTHENTICATED','跳转凭证无效，请从日历重新打开');
    const entry = sql.exec('SELECT e.account_id FROM booking_entry_codes e JOIN sessions s ON s.token_hash=e.session_hash AND s.account_id=e.account_id WHERE e.code_hash=? AND e.expires_at>? AND s.expires_at>?',hash(code),Date.now(),Date.now()).toArray()[0];
    if (!entry) reject('UNAUTHENTICATED','跳转凭证已失效，请从日历重新打开');
    if (consume) sql.exec('DELETE FROM booking_entry_codes WHERE code_hash=?',hash(code));
    const profile = await identity(entry.account_id);
    return consume ? profile : {username:profile.username};
  }

  return {identity, issue, fromCode};
}
