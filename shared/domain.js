'use strict';

// Shared by the cloud function and the local demonstration. Identity is injected
// by the adapter; no action trusts a member ID supplied as the caller.
class ClubError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new ClubError(code, message); };
function text(value, label, max, optional) {
  if (typeof value !== 'string') fail('VALIDATION', `请填写${label}`);
  const clean = value.trim();
  if ((!optional && !clean) || clean.length > max) fail('VALIDATION', `${label}须为${optional ? '0' : '1'}—${max}个字`);
  return clean;
}
const safeMember = m => ({ id: m._id, name: m.name, role: m.role, joinedAt: m.joinedAt, syncVersion: m.syncVersion || 0 });
const safeClub = c => ({ id: c._id, name: c.name, inviteVersion: c.inviteVersion || 0 });

function createService({ store, now, randomId, hash }) {
  const memberKey = (clubId, identity) => 'm_' + hash(clubId + ':' + identity).slice(0, 32);
  const docKey = (prefix, identity, requestId) => {
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)) fail('VALIDATION', '请刷新后重试');
    return prefix + hash(identity + ':' + requestId).slice(0, 32);
  };
  async function member(db, clubId, identity) {
    const m = await db.get('members', memberKey(clubId, identity));
    if (!m) fail('FORBIDDEN', '请先通过邀请加入这个社团');
    return m;
  }
  async function taskAccess(db, taskId, identity) {
    const task = await db.get('tasks', taskId);
    if (!task) fail('NOT_FOUND', '任务不存在');
    const me = await member(db, task.clubId, identity);
    return { task, me };
  }
  function deadline(value) {
    if (!Number.isSafeInteger(value) || value <= now()) fail('VALIDATION', '截止时间须晚于当前时间');
    if (value > now() + 5 * 366 * 86400000) fail('VALIDATION', '截止时间不能超过五年');
    return value;
  }
  function content(input) {
    if (!['normal', 'high'].includes(input.priority)) fail('VALIDATION', '请选择任务优先级');
    return { title: text(input.title, '任务名称', 80), description: text(input.description || '', '任务说明', 2000, true), priority: input.priority };
  }
  function canManage(task, me) { return task.creatorId === me._id || me.role === 'owner'; }
  // Cursor and changed document are written in the SAME transaction. A timestamp
  // cursor could skip simultaneous writes; this monotonic per-club cursor cannot.
  async function stamp(tx, clubId, kind, existing) {
    const club = existing || await tx.get('clubs', clubId);
    if (!club) fail('NOT_FOUND', '社团不存在');
    const baseVersion = club.syncVersion || 0;
    const version = baseVersion + 1;
    const updated = Object.assign({}, club, { syncVersion: version, [kind + 'Version']: version });
    await tx.put('clubs', clubId, updated);
    return { baseVersion, version, club: safeClub(updated) };
  }
  async function unchanged(tx, clubId, patch) {
    const club = await tx.get('clubs', clubId);
    const version = club.syncVersion || 0;
    return Object.assign({ baseVersion: version, version, club: safeClub(club) }, patch);
  }
  async function snapshot(club, me) {
    // Capture the cursor BEFORE scans. Writes that race these scans will be
    // fetched again next time; never return a cursor sampled after the scans.
    const version = club.syncVersion || 0;
    const [members, tasks] = await Promise.all([
      store.find('members', { clubId: club._id }), store.find('tasks', { clubId: club._id, archived: false })
    ]);
    return {
      full: true, version, club: safeClub(club), me: safeMember(members.find(m => m._id === me._id) || me),
      members: members.map(safeMember).sort((a, b) => a.joinedAt - b.joinedAt),
      tasks: tasks.sort((a, b) => a.dueAt - b.dueAt)
    };
  }
  const actions = {
    async bootstrap(input, identity) {
      const mine = await store.find('members', { identity });
      const clubs = (await Promise.all(mine.map(async m => {
        const c = await store.get('clubs', m.clubId);
        return c ? { id: c._id, name: c.name } : null;
      }))).filter(Boolean);
      if (!input.clubId && !clubs.length) return { clubs, club: null };
      const clubId = input.clubId || clubs[0].id;
      const me = await member(store, clubId, identity);
      const club = await store.get('clubs', clubId);
      if (!club) fail('NOT_FOUND', '社团不存在');
      return Object.assign({ clubs }, await snapshot(club, me));
    },
    async sync(input, identity) {
      // Membership is checked on EVERY probe, even when the cursor matches.
      const me = await member(store, input.clubId, identity);
      const club = await store.get('clubs', input.clubId);
      if (!club) fail('NOT_FOUND', '社团不存在');
      const version = club.syncVersion || 0;
      const since = input.since;
      if (!Number.isSafeInteger(since) || since < 0 || since > version) return snapshot(club, me);
      if (since === version) return { unchanged: true, version };
      const [members, tasks] = await Promise.all([
        (club.membersVersion || 0) > since ? store.findSince('members', { clubId: input.clubId }, since) : [],
        (club.tasksVersion || 0) > since ? store.findSince('tasks', { clubId: input.clubId }, since) : []
      ]);
      // Archived task documents are tombstones and must be included in deltas.
      return { full: false, version, club: safeClub(club), me: safeMember(members.find(m => m._id === me._id) || me), members: members.map(safeMember), tasks };
    },
    async createClub(input, identity) {
      const name = text(input.name, '社团名称', 30);
      const nickname = text(input.nickname, '社团内称呼', 20);
      const clubId = docKey('c_', identity, input.requestId);
      const token = randomId();
      const inviteHash = hash(token);
      await store.transaction(async tx => {
        if (await tx.get('clubs', clubId)) return;
        await tx.put('clubs', clubId, { name, ownerId: memberKey(clubId, identity), inviteHash, createdAt: now(), syncVersion: 1, membersVersion: 1, tasksVersion: 0, inviteVersion: 1 });
        await tx.put('invites', inviteHash, { clubId, token, createdAt: now() });
        await tx.put('members', memberKey(clubId, identity), { clubId, identity, name: nickname, role: 'owner', joinedAt: now(), syncVersion: 1 });
      });
      return { clubId };
    },
    async joinClub(input, identity) {
      const token = text(input.token, '邀请码', 64).replace(/\s/g, '').toLowerCase();
      if (!/^[a-f0-9]{32}$/.test(token)) fail('VALIDATION', '请输入完整的32位邀请码');
      const name = text(input.nickname, '社团内称呼', 20);
      return store.transaction(async tx => {
        const invite = await tx.get('invites', hash(token));
        if (!invite) fail('NOT_FOUND', '邀请已失效，请向社团成员获取新邀请');
        const club = await tx.get('clubs', invite.clubId);
        if (!club || club.inviteHash !== hash(token)) fail('NOT_FOUND', '邀请已失效');
        const id = memberKey(invite.clubId, identity);
        if (!await tx.get('members', id)) {
          const change = await stamp(tx, invite.clubId, 'members', club);
          await tx.put('members', id, { clubId: invite.clubId, identity, name, role: 'member', joinedAt: now(), syncVersion: change.version });
        }
        return { clubId: invite.clubId };
      });
    },
    async getInvite(input, identity) {
      await member(store, input.clubId, identity);
      const club = await store.get('clubs', input.clubId);
      const invite = await store.get('invites', club.inviteHash);
      return { token: invite.token, inviteVersion: club.inviteVersion || 0 };
    },
    async rotateInvite(input, identity) {
      const token = randomId();
      return store.transaction(async tx => {
        const me = await member(tx, input.clubId, identity);
        if (me.role !== 'owner') fail('FORBIDDEN', '仅社团创建者可以更换邀请码');
        const club = await tx.get('clubs', input.clubId);
        await tx.remove('invites', club.inviteHash);
        await tx.put('invites', hash(token), { clubId: input.clubId, token, createdAt: now() });
        const change = await stamp(tx, club._id, 'invite', Object.assign({}, club, { inviteHash: hash(token) }));
        return Object.assign(change, { token, inviteVersion: change.club.inviteVersion });
      });
    },
    async renameMe(input, identity) {
      const name = text(input.name, '社团内称呼', 20);
      return store.transaction(async tx => {
        const me = await member(tx, input.clubId, identity);
        if (me.name === name) return unchanged(tx, input.clubId, { member: safeMember(me) });
        const change = await stamp(tx, input.clubId, 'members');
        const updated = Object.assign({}, me, { name, syncVersion: change.version });
        await tx.put('members', me._id, updated);
        return Object.assign(change, { member: safeMember(updated) });
      });
    },
    async createTask(input, identity) {
      const fields = content(input);
      const dueAt = deadline(input.dueAt);
      if (!['individual', 'shared'].includes(input.mode)) fail('VALIDATION', '请选择完成方式');
      if (!Array.isArray(input.participantIds) || !input.participantIds.length || input.participantIds.length > 200) fail('VALIDATION', '请选择1—200位参与成员');
      const participantIds = [...new Set(input.participantIds)];
      await member(store, input.clubId, identity);
      const roster = await store.find('members', { clubId: input.clubId });
      if (participantIds.some(id => !roster.some(m => m._id === id))) fail('VALIDATION', '参与人必须是本社团成员');
      const taskId = docKey('t_', input.clubId + ':' + identity, input.requestId);
      return store.transaction(async tx => {
        const me = await member(tx, input.clubId, identity);
        const previous = await tx.get('tasks', taskId);
        if (previous) return unchanged(tx, input.clubId, { taskId, task: previous });
        const change = await stamp(tx, input.clubId, 'tasks');
        const task = Object.assign(fields, {
          _id: taskId, syncVersion: change.version,
          clubId: input.clubId, creatorId: me._id, participantIds, mode: input.mode,
          dueAt, createdAt: now(), updatedAt: now(), revision: 1, archived: false,
          completions: {}, sharedCompletion: null
        });
        await tx.put('tasks', taskId, task);
        return Object.assign(change, { taskId, task });
      });
    },
    async editTask(input, identity) {
      const fields = content(input);
      return store.transaction(async tx => {
        const { task, me } = await taskAccess(tx, input.taskId, identity);
        if (!canManage(task, me)) fail('FORBIDDEN', '仅发布者或社团创建者可以修改任务');
        if (task.archived) fail('ARCHIVED', '任务已归档');
        if (task.revision !== input.revision) fail('CONFLICT', '任务已被更新，请返回任务详情后重新编辑');
        // Existing past deadlines remain editable without silently shifting time.
        const dueAt = input.dueAt === task.dueAt ? task.dueAt : deadline(input.dueAt);
        if (task.title === fields.title && task.description === fields.description && task.priority === fields.priority && task.dueAt === dueAt) return unchanged(tx, task.clubId, { taskId: task._id, task });
        const change = await stamp(tx, task.clubId, 'tasks');
        const updated = Object.assign({}, task, fields, { dueAt, updatedAt: now(), revision: task.revision + 1, syncVersion: change.version });
        await tx.put('tasks', task._id, updated);
        return Object.assign(change, { taskId: task._id, task: updated });
      });
    },
    async complete(input, identity) {
      if (typeof input.done !== 'boolean') fail('VALIDATION', '无效的完成状态');
      return store.transaction(async tx => {
        const { task, me } = await taskAccess(tx, input.taskId, identity);
        if (task.archived) fail('ARCHIVED', '任务已归档');
        const before = JSON.stringify([task.completions, task.sharedCompletion]);
        if (task.mode === 'individual') {
          if (!task.participantIds.includes(me._id)) fail('FORBIDDEN', '你不是这项任务的参与人');
          if (input.done && !task.completions[me._id]) task.completions[me._id] = now();
          if (!input.done) delete task.completions[me._id];
        } else if (input.done) {
          if (!task.participantIds.includes(me._id)) fail('FORBIDDEN', '只有指定成员可以完成这项任务');
          if (!task.sharedCompletion) task.sharedCompletion = { memberId: me._id, at: now() };
        } else {
          if (task.sharedCompletion && task.sharedCompletion.memberId !== me._id && !canManage(task, me)) fail('FORBIDDEN', '仅完成人、发布者或社团创建者可以重新打开任务');
          if (!task.sharedCompletion && !task.participantIds.includes(me._id) && !canManage(task, me)) fail('FORBIDDEN', '无权修改此任务');
          task.sharedCompletion = null;
        }
        if (before === JSON.stringify([task.completions, task.sharedCompletion])) return unchanged(tx, task.clubId, { taskId: task._id, task });
        const change = await stamp(tx, task.clubId, 'tasks');
        task.updatedAt = now(); task.revision += 1; task.syncVersion = change.version;
        await tx.put('tasks', task._id, task);
        return Object.assign(change, { taskId: task._id, task });
      });
    },
    async archiveTask(input, identity) {
      return store.transaction(async tx => {
        const { task, me } = await taskAccess(tx, input.taskId, identity);
        if (!canManage(task, me)) fail('FORBIDDEN', '仅发布者或社团创建者可以归档任务');
        if (task.archived) return unchanged(tx, task.clubId, { task });
        const change = await stamp(tx, task.clubId, 'tasks');
        const updated = Object.assign({}, task, { archived: true, updatedAt: now(), revision: task.revision + 1, syncVersion: change.version });
        await tx.put('tasks', task._id, updated);
        return Object.assign(change, { ok: true, task: updated });
      });
    }
  };
  return async function execute(action, input, identity) {
    if (!identity || typeof identity !== 'string') fail('UNAUTHENTICATED', '请在微信中打开小程序');
    if (!Object.prototype.hasOwnProperty.call(actions, action)) fail('VALIDATION', '不支持的操作');
    return actions[action](input || {}, identity);
  };
}
module.exports = { createService, ClubError };
