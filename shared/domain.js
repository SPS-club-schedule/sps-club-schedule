'use strict';
const { seminarTemplate, relativeDeadline, MAX_STEPS } = require('./templates');
const { DEPARTMENTS, validDepartment, departmentLabel } = require('./departments');
const { isAdmin } = require('./permissions');
const { resolveParticipants } = require('./assignments');
const { validDurationMinutes } = require('./template-duration');

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
const safeMember = m => m.archived ? { id: m._id, archived: true, syncVersion: m.syncVersion } : ({ id: m._id, name: m.name, role: m.role, department: m.department || '', joinedAt: m.joinedAt, syncVersion: m.syncVersion || 0 });
// Older memberships have no archived field. Only explicit tombstones are removed.
const activeMembers = async (db, fields) => (await db.find('members', fields)).filter(m => !m.archived);
const safeClub = c => ({ id: c._id, name: c.name, inviteVersion: c.inviteVersion || 0 });

function createService({ store, now, randomId, hash }) {
  const memberKey = (clubId, identity) => 'm_' + hash(clubId + ':' + identity).slice(0, 32);
  const docKey = (prefix, identity, requestId) => {
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)) fail('VALIDATION', '请刷新后重试');
    return prefix + hash(identity + ':' + requestId).slice(0, 32);
  };
  async function member(db, clubId, identity) {
    const m = await db.get('members', memberKey(clubId, identity));
    if (!m || m.archived) fail('FORBIDDEN', '请先通过邀请加入这个社团');
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
  function schedule(input, previous = null, child = false) {
    const startsAt=input.startsAt===undefined?previous?.startsAt ?? null:input.startsAt;
    const endsAt=input.endsAt===undefined?previous?.endsAt ?? null:input.endsAt;
    const range=startsAt!==null || endsAt!==null;
    if (input.deadlineFollowsStart!==undefined && typeof input.deadlineFollowsStart!=='boolean') fail('VALIDATION','截止时间跟随设置无效');
    if (child && (range || input.deadlineFollowsStart)) fail('VALIDATION','子任务只设置截止时间，不设置持续时段');
    if (range && (!Number.isSafeInteger(startsAt) || !Number.isSafeInteger(endsAt) || startsAt<0 || endsAt<=startsAt || endsAt>now()+5*366*86400000)) fail('VALIDATION','请设置有效的持续时段：结束时间须晚于开始时间，且不能超过五年');
    if (!range && input.deadlineFollowsStart) fail('VALIDATION','请先启用持续时段');
    const wasFollowing=previous && (previous.deadlineFollowsStart ?? previous.dueAt===previous.startsAt);
    const deadlineFollowsStart=range && (input.deadlineFollowsStart ?? (previous?.startsAt!=null ? wasFollowing && (input.dueAt===undefined || input.dueAt===previous.dueAt) : input.dueAt===undefined));
    const dueAt=deadlineFollowsStart?startsAt:input.dueAt===undefined?previous?.dueAt:input.dueAt;
    // Preserve existing past deadlines when editing unrelated fields.
    if (!previous || dueAt!==previous.dueAt) deadline(dueAt);
    return {dueAt,startsAt,endsAt,deadlineFollowsStart:!!deadlineFollowsStart};
  }
  function content(input) {
    if (!['normal', 'high'].includes(input.priority)) fail('VALIDATION', '请选择任务优先级');
    return { title: text(input.title, '任务名称', 80), description: text(input.description || '', '任务说明', 2000, true), priority: input.priority };
  }
  function canManage(task, me) { return task.creatorId === me._id || task.parentCreatorId === me._id || me.role === 'owner'; }
  function assignment(input, roster, { optional = false, template = false, main = null } = {}) {
    if (!['individual', 'shared'].includes(input.mode)) fail('VALIDATION', '请选择完成方式');
    const department = input.participantDepartment === undefined ? '' : input.participantDepartment;
    if (!validDepartment(department)) fail('VALIDATION', '请选择有效的负责部门');
    if (input.followMain !== undefined && typeof input.followMain !== 'boolean') fail('VALIDATION', '请选择有效的负责人设置');
    if (input.followMain && (!main || department)) fail('VALIDATION', '仅子任务可跟随主任务负责人，且不能同时指定部门');
    if (!Array.isArray(input.participantIds) || input.participantIds.length > 200) fail('VALIDATION', '负责人名单格式无效或超过200人');
    const participantIds = template && (department || input.followMain) ? [] : [...new Set(resolveParticipants(input, roster, main))];
    if ((!optional && !participantIds.length) || participantIds.length > 200) fail('VALIDATION', department ? `${departmentLabel(department)}须有1—200位成员才能分配任务` : '请为每项任务选择1—200位负责人');
    if (participantIds.some(id => !roster.some(m => m._id === id))) fail('VALIDATION', '负责人必须是本社团成员');
    return { mode: input.mode, participantIds, ...(template ? { participantDepartment: department, ...(main ? { followMain: input.followMain === true } : {}) } : {}) };
  }
  function offset(value) {
    if (!Number.isInteger(value) || value < 0 || value > 365) fail('VALIDATION', '提前天数须为0—365的整数');
    return value;
  }
  function templateContent(input, roster, previous = null) {
    if (!Array.isArray(input.steps) || !input.steps.length || input.steps.length > MAX_STEPS) fail('VALIDATION', `模板须包含1—${MAX_STEPS}项子任务`);
    const main = assignment(input, roster, { optional: true, template: true });
    const durationMinutes=input.durationMinutes===undefined?previous?.durationMinutes ?? null:input.durationMinutes;
    if (durationMinutes!==null && !validDurationMinutes(durationMinutes)) fail('VALIDATION','默认时长须为正整数分钟，且不能超过五年');
    return {
      durationMinutes,
      name: text(input.name, '模板名称', 80), category: text(input.category || '', '分类', 30, true) || '未分类',
      ...content(input), ...main,
      steps: input.steps.map(step => {
        if (!step || typeof step !== 'object') fail('VALIDATION', '子任务格式无效');
        return { ...content(step), ...assignment(step, roster, { optional: true, template: true, main }), daysBefore: offset(step.daysBefore) };
      })
    };
  }
  async function seedTemplate(tx, club, version) {
    const id = 'tpl_' + hash(club._id + ':seminar').slice(0, 32);
    await tx.put('templates', id, { ...seminarTemplate(), clubId: club._id, creatorId: club.ownerId, updatedBy: club.ownerId, createdAt: now(), updatedAt: now(), revision: 1, syncVersion: version, archived: false });
  }
  async function ensureTemplates(club) {
    if (club.templatesInitialized) return club;
    return store.transaction(async tx => {
      const latest = await tx.get('clubs', club._id);
      if (latest.templatesInitialized) return latest;
      const updated = { ...latest, templatesInitialized: true };
      const change = await stamp(tx, club._id, 'templates', updated);
      await seedTemplate(tx, latest, change.version);
      return { ...updated, syncVersion: change.version, templatesVersion: change.version };
    });
  }
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
    const [members, tasks, templates] = await Promise.all([
      activeMembers(store, { clubId: club._id }), store.find('tasks', { clubId: club._id, archived: false }),
      store.find('templates', { clubId: club._id, archived: false })
    ]);
    return {
      full: true, version, club: safeClub(club), me: safeMember(members.find(m => m._id === me._id) || me),
      members: members.map(safeMember).sort((a, b) => a.joinedAt - b.joinedAt),
      tasks: tasks.sort((a, b) => a.dueAt - b.dueAt), templates
    };
  }
  const actions = {
    async bootstrap(input, identity) {
      const mine = await activeMembers(store, { identity });
      const clubs = (await Promise.all(mine.map(async m => {
        const c = await store.get('clubs', m.clubId);
        return c ? { id: c._id, name: c.name } : null;
      }))).filter(Boolean);
      if (!input.clubId && !clubs.length) return { clubs, club: null };
      const clubId = input.clubId || clubs[0].id;
      const me = await member(store, clubId, identity);
      const club = await store.get('clubs', clubId);
      if (!club) fail('NOT_FOUND', '社团不存在');
      return Object.assign({ clubs }, await snapshot(await ensureTemplates(club), me));
    },
    async sync(input, identity) {
      // Membership is checked on EVERY probe, even when the cursor matches.
      const me = await member(store, input.clubId, identity);
      let club = await store.get('clubs', input.clubId);
      if (!club) fail('NOT_FOUND', '社团不存在');
      club = await ensureTemplates(club);
      const version = club.syncVersion || 0;
      const since = input.since;
      if (!Number.isSafeInteger(since) || since < 0 || since > version) return snapshot(club, me);
      if (since === version) return { unchanged: true, version };
      const [members, tasks, templates] = await Promise.all([
        (club.membersVersion || 0) > since ? store.findSince('members', { clubId: input.clubId }, since) : [],
        (club.tasksVersion || 0) > since ? store.findSince('tasks', { clubId: input.clubId }, since) : [],
        (club.templatesVersion || 0) > since ? store.findSince('templates', { clubId: input.clubId }, since) : []
      ]);
      // Tabs opened before member deletion shipped cannot merge tombstones.
      if (input.memberTombstones !== true && members.some(m => m.archived)) return snapshot(club, me);
      // Archived documents (including members) are tombstones needed by deltas.
      return { full: false, version, club: safeClub(club), me: safeMember(members.find(m => m._id === me._id) || me), members: members.map(safeMember), tasks, templates };
    },
    async createClub(input, identity) {
      const name = text(input.name, '社团名称', 30);
      const nickname = text(input.nickname, '社团内称呼', 20);
      const clubId = docKey('c_', identity, input.requestId);
      const token = randomId();
      const inviteHash = hash(token);
      await store.transaction(async tx => {
        if (await tx.get('clubs', clubId)) return;
        const club = { _id: clubId, name, ownerId: memberKey(clubId, identity), inviteHash, createdAt: now(), syncVersion: 1, membersVersion: 1, tasksVersion: 0, inviteVersion: 1, templatesVersion: 1, templatesInitialized: true };
        await tx.put('clubs', clubId, club);
        await seedTemplate(tx, club, 1);
        await tx.put('invites', inviteHash, { clubId, token, createdAt: now() });
        await tx.put('members', memberKey(clubId, identity), { clubId, identity, name: nickname, role: 'owner', department: '', joinedAt: now(), syncVersion: 1 });
      });
      return { clubId };
    },
    async joinClub(input, identity) {
      const token = text(input.token, '邀请码', 64).replace(/\s/g, '').toLowerCase();
      if (!/^[a-f0-9]{32}$/.test(token)) fail('VALIDATION', '请输入完整的32位邀请码');
      const name = text(input.nickname, '社团内称呼', 20);
      return store.transaction(async tx => {
        const invite = await tx.get('invites', hash(token));
        if (!invite) fail('NOT_FOUND', '邀请已失效，请向管理员获取新邀请');
        const club = await tx.get('clubs', invite.clubId);
        const department = invite.department || '';
        if (!validDepartment(department) || !club || (department ? club.departmentInviteHashes?.[department] : club.inviteHash) !== hash(token)) fail('NOT_FOUND', '邀请已失效');
        const id = memberKey(invite.clubId, identity);
        const existing = await tx.get('members', id);
        if (existing?.archived) fail('FORBIDDEN', '此账号已删除，请重新注册');
        if (department && existing?.department && existing.department !== department) fail('CONFLICT', `你已属于${departmentLabel(existing.department)}，如需调换部门请联系管理员`);
        if (!existing || department && !existing.department) {
          const change = await stamp(tx, invite.clubId, 'members', club);
          await tx.put('members', id, { ...(existing || { clubId: invite.clubId, identity, name, role: 'member', joinedAt: now() }), department, syncVersion: change.version });
        }
        return { clubId: invite.clubId, department: department || existing?.department || '' };
      });
    },
    async getInvite(input, identity) {
      return store.transaction(async tx => {
        const me = await member(tx, input.clubId, identity);
        if (!isAdmin(me.role)) fail('FORBIDDEN', '仅本社团管理员可以查看和分享邀请码');
        let club = await tx.get('clubs', input.clubId);
        // Existing clubs acquire department codes on first use; their old code
        // and all memberships remain valid. Initialization is atomic/retry-safe.
        const hashes = { ...club.departmentInviteHashes };
        let changed = false;
        for (const department of DEPARTMENTS) {
          if (hashes[department.id]) continue;
          const token = randomId(); hashes[department.id] = hash(token); changed = true;
          await tx.put('invites', hash(token), { clubId: input.clubId, token, department: department.id, createdAt: now() });
        }
        if (changed) {
          const change = await stamp(tx, club._id, 'invite', { ...club, departmentInviteHashes: hashes });
          club = { ...club, departmentInviteHashes: hashes, inviteVersion: change.version };
        }
        const invite = await tx.get('invites', club.inviteHash);
        const departments = await Promise.all(DEPARTMENTS.map(async d => ({ ...d, token: (await tx.get('invites', hashes[d.id])).token })));
        return { token: invite.token, departments, inviteVersion: club.inviteVersion || 0 };
      });
    },
    async rotateInvite(input, identity) {
      const department = input.department === undefined ? '' : input.department;
      if (!validDepartment(department)) fail('VALIDATION', '请选择有效的部门');
      const token = randomId();
      return store.transaction(async tx => {
        const me = await member(tx, input.clubId, identity);
        if (me.role !== 'owner') fail('FORBIDDEN', '仅社团创建者可以更换邀请码');
        const club = await tx.get('clubs', input.clubId);
        const previous = department ? club.departmentInviteHashes?.[department] : club.inviteHash;
        if (previous) await tx.remove('invites', previous);
        await tx.put('invites', hash(token), { clubId: input.clubId, token, department, createdAt: now() });
        const updated = department ? { ...club, departmentInviteHashes: { ...club.departmentInviteHashes, [department]: hash(token) } } : { ...club, inviteHash: hash(token) };
        const change = await stamp(tx, club._id, 'invite', updated);
        return Object.assign(change, { token, department, inviteVersion: change.club.inviteVersion });
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
    async createTemplate(input, identity) {
      const templateId = docKey('tpl_', input.clubId + ':' + identity, input.requestId);
      return store.transaction(async tx => {
        const me = await member(tx, input.clubId, identity);
        const previous = await tx.get('templates', templateId);
        if (previous) return unchanged(tx, input.clubId, { template: previous });
        const fields = templateContent(input, await activeMembers(tx, { clubId: input.clubId }));
        const change = await stamp(tx, input.clubId, 'templates');
        const template = { ...fields, _id: templateId, clubId: input.clubId, creatorId: me._id, updatedBy: me._id, createdAt: now(), updatedAt: now(), revision: 1, syncVersion: change.version, archived: false };
        await tx.put('templates', templateId, template);
        return { ...change, template };
      });
    },
    async editTemplate(input, identity) {
      return store.transaction(async tx => {
        const template = await tx.get('templates', input.templateId);
        if (!template) fail('NOT_FOUND', '模板不存在');
        const me = await member(tx, template.clubId, identity);
        if (template.archived) fail('ARCHIVED', '模板已归档');
        if (template.revision !== input.revision) fail('CONFLICT', '模板已被其他成员更新，请返回模板库后重新编辑');
        const fields = templateContent(input, await activeMembers(tx, { clubId: template.clubId }),template);
        const change = await stamp(tx, template.clubId, 'templates');
        const updated = { ...template, ...fields, updatedBy: me._id, updatedAt: now(), revision: template.revision + 1, syncVersion: change.version };
        await tx.put('templates', template._id, updated);
        return { ...change, template: updated };
      });
    },
    async archiveTemplate(input, identity) {
      return store.transaction(async tx => {
        const template = await tx.get('templates', input.templateId);
        if (!template) fail('NOT_FOUND', '模板不存在');
        const me = await member(tx, template.clubId, identity);
        if (template.creatorId !== me._id && me.role !== 'owner') fail('FORBIDDEN', '仅模板创建者或社团创建者可以归档模板');
        if (template.archived) return unchanged(tx, template.clubId, { template });
        if (template.revision !== input.revision) fail('CONFLICT', '模板已更新，请刷新后重试');
        const change = await stamp(tx, template.clubId, 'templates');
        const updated = { ...template, archived: true, updatedAt: now(), updatedBy: me._id, revision: template.revision + 1, syncVersion: change.version };
        await tx.put('templates', template._id, updated);
        return { ...change, template: updated };
      });
    },
    async createTaskGroup(input, identity) {
      const taskId = docKey('tg_', input.clubId + ':' + identity, input.requestId);
      return store.transaction(async tx => {
        const me = await member(tx, input.clubId, identity);
        const previous = await tx.get('tasks', taskId);
        if (previous) {
          const children = (await tx.find('tasks', { clubId: input.clubId })).filter(t => t.parentTaskId === taskId);
          return unchanged(tx, input.clubId, { taskId, task: previous, tasks: [previous, ...children] });
        }
        if (input.parentTaskId) fail('VALIDATION', '模板只能用于创建主任务');
        if (!Array.isArray(input.subtasks) || !input.subtasks.length || input.subtasks.length > MAX_STEPS) fail('VALIDATION', `请保留1—${MAX_STEPS}项子任务`);
        const roster = await activeMembers(tx, { clubId: input.clubId });
        const fields = { ...content(input), ...assignment(input, roster), ...schedule(input) };
        const {dueAt}=fields;
        let sourceTemplate;
        if (input.templateId) {
          const template = await tx.get('templates', input.templateId);
          if (!template || template.clubId !== input.clubId) fail('NOT_FOUND', '模板不属于当前社团');
          if (template.archived) fail('ARCHIVED', '模板已归档，请选择其他模板');
          sourceTemplate = { id: template._id, name: template.name };
        }
        const children = input.subtasks.map((step, index) => {
          if (!step || typeof step !== 'object') fail('VALIDATION', '子任务格式无效');
          const daysBefore = offset(step.daysBefore);
          const childDue = step.dueAt === undefined ? relativeDeadline(dueAt, daysBefore) : step.dueAt;
          if (!Number.isSafeInteger(childDue) || childDue <= now()) fail('VALIDATION', `子任务${index + 1}的截止时间已过，请调整日期或提前天数`);
          if (childDue > dueAt) fail('VALIDATION', `子任务${index + 1}不能晚于主任务截止`);
          return { ...content(step), ...assignment(step, roster, { main: fields }), ...schedule({...step,dueAt:childDue},null,true), daysBefore };
        });
        const change = await stamp(tx, input.clubId, 'tasks');
        const common = { clubId: input.clubId, creatorId: me._id, createdAt: now(), updatedAt: now(), revision: 1, syncVersion: change.version, archived: false, completions: {}, sharedCompletion: null };
        const task = { ...fields, ...common, _id: taskId, dueAt, ...(sourceTemplate ? { sourceTemplate } : {}) };
        const tasks = [task, ...children.map((child, index) => ({ ...child, ...common, _id: taskId + '_' + index, parentTaskId: taskId, parentCreatorId: me._id }))];
        for (const item of tasks) await tx.put('tasks', item._id, item);
        return { ...change, taskId, task, tasks };
      });
    },
    async createTask(input, identity) {
      const fields = content(input);
      const taskId = docKey('t_', input.clubId + ':' + identity, input.requestId);
      return store.transaction(async tx => {
        const me = await member(tx, input.clubId, identity);
        const previous = await tx.get('tasks', taskId);
        if (previous) return unchanged(tx, input.clubId, { taskId, task: previous });
        const roster = await activeMembers(tx, { clubId: input.clubId });
        const { participantIds } = assignment(input, roster);
        let parent = null;
        if (input.parentTaskId != null && input.parentTaskId !== '') {
          parent = await tx.get('tasks', input.parentTaskId);
          if (!parent || parent.clubId !== input.clubId) fail('NOT_FOUND', '主任务不存在');
          if (parent.archived) fail('ARCHIVED', '主任务已归档');
          if (parent.parentTaskId) fail('VALIDATION', '请在主任务下添加子任务');
          if (!canManage(parent, me)) fail('FORBIDDEN', '仅主任务发布者或社团创建者可以分配子任务');
        }
        const change = await stamp(tx, input.clubId, 'tasks');
        const task = Object.assign(fields, {
          ...(parent ? { parentTaskId: parent._id, parentCreatorId: parent.creatorId } : {}),
          _id: taskId, syncVersion: change.version,
          clubId: input.clubId, creatorId: me._id, participantIds, mode: input.mode,
          ...schedule(input,null,!!parent), createdAt: now(), updatedAt: now(), revision: 1, archived: false,
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
        const timing=schedule(input,task,!!task.parentTaskId);
        let participantIds = task.participantIds;
        if (task.parentTaskId && (input.participantIds !== undefined || input.participantDepartment)) {
          const roster = await activeMembers(tx, { clubId: task.clubId });
          const { participantIds: requested } = assignment({ ...input, mode: task.mode }, roster);
          const changed = requested.length !== participantIds.length || requested.some(id => !participantIds.includes(id));
          if (changed) {
            if (Object.keys(task.completions).length || task.sharedCompletion) fail('CONFLICT', '子任务已有完成记录，请先撤销完成后再调整负责人');
            participantIds = requested;
          }
        }
        if (task.title === fields.title && task.description === fields.description && task.priority === fields.priority && Object.entries(timing).every(([key,value])=>(task[key] ?? (key==='deadlineFollowsStart'?false:null))===value) && participantIds === task.participantIds) return unchanged(tx, task.clubId, { taskId: task._id, task });
        const change = await stamp(tx, task.clubId, 'tasks');
        const updated = Object.assign({}, task, fields, timing, { participantIds, updatedAt: now(), revision: task.revision + 1, syncVersion: change.version });
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
        const children = task.parentTaskId ? [] : (await tx.find('tasks', { clubId: task.clubId, archived: false })).filter(t => t.parentTaskId === task._id);
        const change = await stamp(tx, task.clubId, 'tasks');
        const updated = Object.assign({}, task, { archived: true, updatedAt: now(), revision: task.revision + 1, syncVersion: change.version });
        await tx.put('tasks', task._id, updated);
        const tasks = [updated];
        for (const child of children) {
          const archived = Object.assign({}, child, { archived: true, updatedAt: now(), revision: child.revision + 1, syncVersion: change.version });
          await tx.put('tasks', child._id, archived); tasks.push(archived);
        }
        return Object.assign(change, { ok: true, task: updated, tasks });
      });
    }
  };
  return async function execute(action, input, identity) {
    if (!identity || typeof identity !== 'string') fail('UNAUTHENTICATED', '请在微信中打开小程序');
    if (!Object.prototype.hasOwnProperty.call(actions, action)) fail('VALIDATION', '不支持的操作');
    return actions[action](input || {}, identity);
  };
}
module.exports = { createService, ClubError, safeMember, safeClub, activeMembers };
