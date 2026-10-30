import permissions from '../shared/permissions.js';
import domain from '../shared/domain.js';
const { isAdmin, canEditMember } = permissions;
const { ClubError, safeMember, safeClub } = domain;
const fail = (code, message) => { throw new ClubError(code, message); };
export const accountRevision = (sql, id) => sql.exec('SELECT revision FROM account_versions WHERE account_id=?', id).toArray()[0]?.revision || 1;
export function bumpAccountRevision(sql, id) {
  sql.exec('INSERT INTO account_versions VALUES(?,2) ON CONFLICT(account_id) DO UPDATE SET revision=revision+1', id);
}

export function createAdminService({ store, sql, hash, random, username, verifyPassword, now = Date.now }) {
  // Add separate tables to keep the original account schema rollback-compatible.
  sql.exec(`CREATE TABLE IF NOT EXISTS account_versions (account_id TEXT PRIMARY KEY, revision INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS account_resets (
    account_id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, expires_at INTEGER NOT NULL,
    club_id TEXT NOT NULL, actor_identity TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS admin_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT, club_id TEXT NOT NULL,
    actor_member_id TEXT NOT NULL, target_member_id TEXT NOT NULL,
    action TEXT NOT NULL, fields TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS admin_audit_club ON admin_audit(club_id,id);`);
  async function access(db, clubId, identity) {
    const actor = await db.get('members', 'm_' + hash(clubId + ':' + identity).slice(0, 32));
    if (!actor || !isAdmin(actor.role)) fail('FORBIDDEN', '仅本社团管理员可以使用成员管理');
    return actor;
  }
  async function accountAccess(db, actor, target) {
    if (!canEditMember(safeMember(actor), safeMember(target))) return '仅创建者可以管理其他管理员的账号';
    // A club-scoped privilege must not become access to an unrelated club.
    if (actor.identity !== target.identity && (await db.find('members', { identity: target.identity })).some(m => m.clubId !== target.clubId)) return '该账号已加入其他社团，登录信息须由本人维护';
    return '';
  }
  async function entry(db, actor, target) {
    const account = sql.exec('SELECT username,created_at FROM accounts WHERE id=?', target.identity).toArray()[0];
    const accountRestriction = account ? await accountAccess(db, actor, target) : '此成员没有网页账号';
    return { ...safeMember(target), username: account?.username || '', accountCreatedAt: account?.created_at || null,
      accountRevision: account ? accountRevision(sql,target.identity) : 0, canEdit: canEditMember(safeMember(actor), safeMember(target)),
      canEditAccount: !accountRestriction, accountRestriction };
  }
  function audit(clubId, actor, target, action, fields) {
    sql.exec('INSERT INTO admin_audit(club_id,actor_member_id,target_member_id,action,fields,created_at) VALUES(?,?,?,?,?,?)',
      clubId, actor._id, target._id, action, JSON.stringify(fields), now());
  }
  const execute = async (action, input, identity) => store.transaction(async db => {
    const actor = await access(db, input.clubId, identity);
    if (action === 'adminMembers') {
      const members = await db.find('members', { clubId: input.clubId });
      const events = sql.exec('SELECT actor_member_id,target_member_id,action,fields,created_at FROM admin_audit WHERE club_id=? ORDER BY id DESC LIMIT 30', input.clubId).toArray();
      return { me: safeMember(actor), members: await Promise.all(members.sort((a,b) => a.joinedAt-b.joinedAt).map(m => entry(db, actor, m))),
        events: events.map(r => ({ actorId:r.actor_member_id, targetId:r.target_member_id, action:r.action, fields:JSON.parse(r.fields), at:r.created_at })) };
    }
    if (!['adminEditMember','adminResetPassword'].includes(action)) fail('VALIDATION', '不支持的管理操作');
    const target = await db.get('members', input.memberId);
    if (!target || target.clubId !== input.clubId) fail('NOT_FOUND', '本社团中没有这位成员');
    if (!canEditMember(safeMember(actor), safeMember(target))) fail('FORBIDDEN', '仅创建者可以管理其他管理员');
    if (input.memberVersion !== (target.syncVersion || 0)) fail('CONFLICT', '成员资料已更新，请返回管理页后重新编辑');
    const account = sql.exec('SELECT * FROM accounts WHERE id=?', target.identity).toArray()[0];
    if (input.accountRevision !== (account ? accountRevision(sql,target.identity) : 0)) fail('CONFLICT', '账号资料已更新，请返回管理页后重新编辑');
    if (action === 'adminResetPassword') {
      const restriction = await accountAccess(db, actor, target);
      if (!account || restriction) fail('FORBIDDEN', restriction || '此成员没有网页账号');
      verifyPassword(identity, input.adminPassword);
      const resetToken = random(), expiresAt = now() + 30 * 60000;
      sql.exec('INSERT INTO account_resets VALUES(?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at,club_id=excluded.club_id,actor_identity=excluded.actor_identity',
        target.identity, hash(resetToken), expiresAt, input.clubId, identity);
      audit(input.clubId, actor, target, 'reset', []);
      return { resetToken, expiresAt, username:account.username };
    }
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 20) fail('VALIDATION', '社团内称呼须为1—20个字');
    const name = input.name.trim(), role = input.role;
    if (!['owner','admin','member'].includes(role)) fail('VALIDATION', '请选择有效的成员角色');
    if ((target.role === 'owner' && role !== 'owner') || (target.role !== 'owner' && role === 'owner')) fail('FORBIDDEN', '创建者身份不能在此修改');
    if (role !== target.role && actor.role !== 'owner') fail('FORBIDDEN', '仅创建者可以任免管理员');
    const login = input.username === undefined ? account?.username : username(input.username);
    const loginChanged = login !== account?.username;
    if (loginChanged) {
      const restriction = await accountAccess(db, actor, target);
      if (!account || restriction) fail('FORBIDDEN', restriction || '此成员没有网页账号');
      if (sql.exec('SELECT id FROM accounts WHERE username=? AND id<>?', login, target.identity).toArray().length) fail('CONFLICT', '这个用户名已被使用');
    }
    if (loginChanged || role !== target.role) verifyPassword(identity, input.adminPassword);
    const fields = [name !== target.name && 'name', role !== target.role && 'role', loginChanged && 'username'].filter(Boolean);
    const club = await db.get('clubs', input.clubId), baseVersion = club.syncVersion || 0;
    if (!fields.length) return { baseVersion, version:baseVersion, club:safeClub(club), member:safeMember(target), adminMember:await entry(db,actor,target) };
    if (loginChanged) {
      sql.exec('UPDATE accounts SET username=? WHERE id=?', login, target.identity);
      bumpAccountRevision(sql,target.identity);
      sql.exec('DELETE FROM account_resets WHERE account_id=?', target.identity);
    }
    // Demotion cancels every outstanding reset issued with these privileges.
    if (role !== target.role) sql.exec('DELETE FROM account_resets WHERE club_id=? AND (actor_identity=? OR account_id=?)', input.clubId, target.identity, target.identity);
    const version = baseVersion + 1, updated = { ...target, name, role, syncVersion:version };
    const updatedClub = { ...club, syncVersion:version, membersVersion:version };
    await db.put('members', target._id, updated); await db.put('clubs', club._id, updatedClub);
    audit(input.clubId, actor, target, 'edit', fields);
    return { baseVersion, version, club:safeClub(updatedClub), member:safeMember(updated), adminMember:await entry(db,actor,updated) };
  });
  async function validateReset(reset) {
    const actor = await access(store, reset.club_id, reset.actor_identity);
    const target = await store.get('members', 'm_' + hash(reset.club_id + ':' + reset.account_id).slice(0,32));
    if (!target || await accountAccess(store, actor, target)) fail('FORBIDDEN', '重设链接已失效，请联系管理员重新生成');
  }
  return { execute, validateReset };
}
