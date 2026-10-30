import domain from '../shared/domain.js';
import { accountRevision, bumpAccountRevision } from './admin.mjs';
const { ClubError } = domain;
const fail = (code, message) => { throw new ClubError(code, message); };

export function createAccountService({ store, sql, username, password, passwordHash, verifyPassword, random, hash }) {
  const info = row => ({ username:row.username, createdAt:row.created_at, revision:accountRevision(sql,row.id) });
  return async function execute(action, input, actor) {
    return store.transaction(async () => {
      // The session identifies the account; no supplied user/member/club ID is used.
      const row = sql.exec('SELECT * FROM accounts WHERE id=?', actor.id).toArray()[0];
      if (!row) fail('UNAUTHENTICATED', '账号已失效，请重新登录');
      if (action === 'accountSettings') return { account:info(row) };
      if (!['accountChangeUsername','accountChangePassword'].includes(action)) fail('VALIDATION', '不支持的账号操作');
      if (input.revision !== accountRevision(sql,row.id)) fail('CONFLICT', '账号资料已更新，请重新加载后再修改');
      verifyPassword(row.id,input.currentPassword);
      if (action === 'accountChangeUsername') {
        const name = username(input.username);
        if (name === row.username) return { account:info(row) };
        if (sql.exec('SELECT id FROM accounts WHERE username=? AND id<>?', name, row.id).toArray().length) fail('CONFLICT', '这个用户名已被使用');
        sql.exec('UPDATE accounts SET username=? WHERE id=?', name, row.id);
        bumpAccountRevision(sql,row.id);
        sql.exec('DELETE FROM account_resets WHERE account_id=?', row.id);
        return { account:info({ ...row, username:name }) };
      }
      const nextPassword = password(input.newPassword);
      if (nextPassword === input.currentPassword) fail('VALIDATION', '新密码不能与当前密码相同');
      const salt = random(), recoveryCode = random();
      sql.exec('UPDATE accounts SET salt=?,password_hash=?,recovery_hash=? WHERE id=?', salt, passwordHash(nextPassword,salt), hash(recoveryCode), row.id);
      bumpAccountRevision(sql,row.id);
      // Keep this authenticated session; revoke every other device/tab atomically.
      sql.exec('DELETE FROM sessions WHERE account_id=? AND token_hash<>?', row.id, actor.tokenHash);
      sql.exec('DELETE FROM account_resets WHERE account_id=? OR actor_identity=?', row.id, row.id);
      sql.exec('DELETE FROM rate_limits WHERE key IN (?,?)', 'recover:' + row.username, 'login:' + row.username);
      return { account:info(row), recoveryCode };
    });
  };
}
