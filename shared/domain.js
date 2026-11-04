'use strict';
const { seminarTemplate, MAX_STEPS, MAX_ROLES } = require('./templates');
const { DEPARTMENTS, validDepartment, departmentLabel } = require('./departments');
const { isAdmin, isSpeaker, isCoreMember } = require('./permissions');
const { resolveParticipants } = require('./assignments');
const { selectedRoleIds } = require('./role-bindings');
const {resolveGuestNames,participantKeys,canProxyFor}=require('./guest-assignments');
const { validDurationMinutes } = require('./template-duration');
const { normalizeStepDependencies } = require('./step-dependencies');
const { schedulingMode, planningFields, computeStepSchedule } = require('./backward-schedule');

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
const selfMember = m => ({...safeMember(m),...(!m.archived&&m.departmentTemplateGuide?{departmentTemplateGuide:m.departmentTemplateGuide}:{})});
const publicMember = (m, viewer) => m._id===viewer._id ? selfMember(m) : ({...safeMember(m), ...(!m.archived ? {role:isAdmin(m.role)?'admin':isSpeaker(m.role)?'speaker':'member'} : {})});
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
    if(isSpeaker(me.role)&&!task.participantIds.includes(me._id))fail('FORBIDDEN','主讲人只能访问分配给自己的任务');
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
    const location=range?text(input.location===undefined?previous?.location || '':input.location,'活动地点',80,true):'';
    if (child && input.location) fail('VALIDATION','子任务不设置活动地点');
    return {dueAt,startsAt,endsAt,deadlineFollowsStart:!!deadlineFollowsStart,location};
  }
  function content(input) {
    if (!['normal', 'high'].includes(input.priority)) fail('VALIDATION', '请选择任务优先级');
    return { title: text(input.title, '任务名称', 80), description: text(input.description || '', '任务说明', 2000, true), priority: input.priority };
  }
  function requireCore(me) {if(!isCoreMember(me.role))fail('FORBIDDEN','主讲人只能查看并完成分配给自己的任务');}
  function canManage(task, me) { return isCoreMember(me.role)&&(task.creatorId === me._id || task.parentCreatorId === me._id || me.role === 'owner'); }
  function assignment(input, roster, { optional = false, template = false, main = null, roles = [], coreOnly = false } = {}) {
    if (!['individual', 'shared'].includes(input.mode)) fail('VALIDATION', '请选择完成方式');
    const department = input.participantDepartment === undefined ? '' : input.participantDepartment;
    if (!validDepartment(department)) fail('VALIDATION', '请选择有效的负责部门');
    if (input.followMain !== undefined && typeof input.followMain !== 'boolean') fail('VALIDATION', '请选择有效的负责人设置');
    if (input.followMain && (!main || department)) fail('VALIDATION', '仅子任务可跟随主任务负责人，且不能同时指定部门');
    const roleId = input.roleId === undefined ? '' : input.roleId;
    if (typeof roleId !== 'string' || (input.roleIds !== undefined && (!Array.isArray(input.roleIds) || input.roleIds.length > MAX_ROLES || input.roleIds.some(id=>typeof id!=='string' || !id)))) fail('VALIDATION', '请选择模板中已有的角色');
    const roleIds=selectedRoleIds(input);
    if (roleId && input.roleIds !== undefined && (roleIds.length!==1 || roleIds[0]!==roleId)) fail('VALIDATION','负责角色设置不一致，请重新选择');
    if (roleIds.length && (!main || roleIds.some(id=>!roles.some(role=>role.id===id)))) fail('VALIDATION','请选择模板中已有的角色');
    if (roleIds.length && (department || input.followMain)) fail('VALIDATION', '按角色分配不能同时跟随主任务或指定部门');
    if (!Array.isArray(input.participantIds) || input.participantIds.length > 200) fail('VALIDATION', '负责人名单格式无效或超过200人');
    const participantIds = template && (department || input.followMain || roleIds.length) ? [] : [...new Set(resolveParticipants(input, roster, main ? {...main, roles} : null))];
    let guests=[];
    try{guests=template?[]:resolveGuestNames(input,main?{...main,roles}:null);}catch(error){fail('VALIDATION',error.message);}
    if(coreOnly&&(guests.length||participantIds.some(id=>isSpeaker(roster.find(m=>m._id===id)?.role))))fail('VALIDATION','此角色仅限社团部员，请调整负责人范围后再添加非部员或免注册姓名');
    if (!optional) for (const id of roleIds) {
      const role=roles.find(role=>role.id===id);
      if (!resolveParticipants(role,roster).length && !(role.coreMember===false && resolveGuestNames(role).length)) fail('VALIDATION', `请为角色「${role.name}」选择负责人或填写姓名`);
    }
    if ((!optional && !participantIds.length&&!guests.length) || participantIds.length+guests.length > 200) fail('VALIDATION', department ? `${departmentLabel(department)}须有1—200位参与者才能分配任务` : '请为每项任务选择或填写1—200位负责人');
    if (participantIds.some(id => !roster.some(m => m._id === id))) fail('VALIDATION', '注册负责人必须属于当前社团');
    return { mode: input.mode, participantIds, ...(guests.length?{guestParticipants:guests.map(name=>({id:'guest_'+hash(name).slice(0,24),name}))}:{}), ...(template ? { participantDepartment: department, ...(main ? { followMain: input.followMain === true, roleId:roleIds.length===1?roleIds[0]:'', ...(roleIds.length>1?{roleIds}:{}) } : {}) } : {}) };
  }
  function templateRoles(input) {
    if (input === undefined) return [];
    if (!Array.isArray(input) || input.length > MAX_ROLES) fail('VALIDATION', `模板最多设置${MAX_ROLES}个角色`);
    const ids=new Set(), names=new Set();
    return input.map(role=>{
      if (!role || typeof role !== 'object' || typeof role.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(role.id) || ids.has(role.id)) fail('VALIDATION','角色标识无效或重复，请重新添加角色');
      const name=text(role.name,'角色名称',30), key=name.toLocaleLowerCase();
      if (names.has(key)) fail('VALIDATION','角色名称不能重复');
      ids.add(role.id); names.add(key);
      if(role.coreMember!==undefined&&typeof role.coreMember!=='boolean')fail('VALIDATION','角色成员类型无效');
      return {id:role.id,name,...(role.coreMember===false?{coreMember:false}:{})};
    });
  }
  function offset(value) {
    if (!Number.isInteger(value) || value < 0 || value > 365) fail('VALIDATION', '提前天数须为0—365的整数');
    return value;
  }
  function dependencySteps(steps, previous = null) {
    // Old editors discard IDs and relations; never silently erase saved dependencies.
    if (previous?.steps.some(step=>step.dependsOn?.length) && steps.some(step=>step?.id===undefined || step?.dependsOn===undefined)) fail('CONFLICT','此模板已设置子任务依赖，请刷新页面后重新编辑或套用');
    // Old clients understand only roleId; do not let them silently erase a joint assignment.
    const jointlyAssigned=new Set((previous?.steps || []).filter(step=>selectedRoleIds(step).length>1).map(step=>step.id));
    if (jointlyAssigned.size && steps.some(step=>step?.id===undefined || jointlyAssigned.has(step.id)&&step.roleIds===undefined)) fail('CONFLICT','此模板已设置多个角色共同负责，请刷新页面后重新编辑或套用');
    try { return normalizeStepDependencies(steps); }
    catch (error) { fail('VALIDATION',error.message); }
  }
  function planningMode(input, previous = null) {
    if (input.schedulingMode===undefined && (previous?.schedulingMode==='backward'||previous?.steps.some(step=>step.estimateMinutes!=null||step.anchorToMain===false))) fail('CONFLICT','此模板已设置耗时倒排，请刷新页面后重新编辑或套用');
    try { return schedulingMode(input.schedulingMode); }
    catch (error) { fail('VALIDATION',error.message); }
  }
  function stepPlanning(step, mode) {
    try { return planningFields(step,mode==='backward'); }
    catch (error) { fail('VALIDATION',error.message); }
  }
  function templateContent(input, roster, previous = null) {
    if (!Array.isArray(input.steps) || !input.steps.length || input.steps.length > MAX_STEPS) fail('VALIDATION', `模板须包含1—${MAX_STEPS}项子任务`);
    // Old editors cannot safely match reordered steps to their role bindings.
    if (input.roles === undefined && previous?.roles?.length) fail('CONFLICT','此模板已设置角色分工，请刷新页面后重新编辑');
    if(previous?.roles?.some(role=>role.coreMember===false&&input.roles?.some(next=>next.id===role.id&&next.coreMember===undefined)))fail('CONFLICT','此模板包含可由非部员担任的角色，请刷新后重新编辑');
    const roles=templateRoles(input.roles);
    const schedulingMode=planningMode(input,previous);
    const main = assignment(input, roster, { optional: true, template: true });
    const durationMinutes=input.durationMinutes===undefined?previous?.durationMinutes ?? null:input.durationMinutes;
    if (durationMinutes!==null && !validDurationMinutes(durationMinutes)) fail('VALIDATION','默认时长须为正整数分钟，且不能超过五年');
    return {
      durationMinutes, roles, schedulingMode,
      name: text(input.name, '模板名称', 80), category: text(input.category || '', '分类', 30, true) || '未分类',
      ...content(input), ...main,
      steps: dependencySteps(input.steps,previous).map(step => {
        if (!step || typeof step !== 'object') fail('VALIDATION', '子任务格式无效');
        return { ...content(step), ...assignment(step, roster, { optional: true, template: true, main, roles }), ...stepPlanning(step,schedulingMode), daysBefore: offset(step.daysBefore), id:step.id, dependsOn:step.dependsOn };
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
    const viewer=members.find(m=>m._id===me._id)||me;
    const visibleTasks=isSpeaker(viewer.role)?tasks.filter(task=>task.participantIds.includes(viewer._id)):tasks;
    const related=new Set([viewer._id,...visibleTasks.flatMap(task=>[task.creatorId,...task.participantIds,...Object.values(task.completionActors||{}).map(record=>record.actorId),task.sharedCompletion?.actorId])]);
    const visibleMembers=isSpeaker(viewer.role)?members.filter(m=>related.has(m._id)):members;
    return {
      full: true, version, club: safeClub(club), me: selfMember(members.find(m => m._id === me._id) || me),
      members: visibleMembers.map(m=>publicMember(m,viewer)).sort((a, b) => a.joinedAt - b.joinedAt),
      tasks: visibleTasks.sort((a, b) => a.dueAt - b.dueAt), templates:isSpeaker(viewer.role)?[]:templates
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
      // Replacing the whole restricted board drops revoked assignments and stale
      // data on demotion; promotion must restore older tasks, not just new deltas.
      if(isSpeaker(me.role)||(me.taskVisibilityVersion||0)>since)return snapshot(club,me);
      const [members, tasks, templates] = await Promise.all([
        (club.membersVersion || 0) > since ? store.findSince('members', { clubId: input.clubId }, since) : [],
        (club.tasksVersion || 0) > since ? store.findSince('tasks', { clubId: input.clubId }, since) : [],
        (club.templatesVersion || 0) > since ? store.findSince('templates', { clubId: input.clubId }, since) : []
      ]);
      // Tabs opened before member deletion shipped cannot merge tombstones.
      if (input.memberTombstones !== true && members.some(m => m.archived)) return snapshot(club, me);
      // Archived documents (including members) are tombstones needed by deltas.
      return { full: false, version, club: safeClub(club), me: selfMember(members.find(m => m._id === me._id) || me), members: members.map(m=>publicMember(m,me)), tasks, templates };
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
        if(existing&&((isSpeaker(existing.role)&&department&&department!=='speaker')||(!isSpeaker(existing.role)&&department==='speaker')))fail('CONFLICT','身份变更请联系管理员');
        if (department && existing?.department && existing.department !== department) fail('CONFLICT', `你已属于${departmentLabel(existing.department)}，如需调换部门请联系管理员`);
        if (!existing || department && !existing.department) {
          const change = await stamp(tx, invite.clubId, 'members', club);
          await tx.put('members', id, { ...(existing || { clubId: invite.clubId, identity, name, role: department==='speaker'?'speaker':'member', joinedAt: now() }), department, syncVersion: change.version });
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
        if (me.name === name) return unchanged(tx, input.clubId, { member: selfMember(me) });
        const change = await stamp(tx, input.clubId, 'members');
        const updated = Object.assign({}, me, { name, syncVersion: change.version });
        await tx.put('members', me._id, updated);
        return Object.assign(change, { member: selfMember(updated) });
      });
    },
    async dismissDepartmentTutorial(input, identity) {
      if(input.version!==1 || !['skipped','completed'].includes(input.status))fail('VALIDATION','教程记录无效');
      return store.transaction(async tx=>{
        const me=await member(tx,input.clubId,identity);
        if(!isAdmin(me.role))fail('FORBIDDEN','仅管理员可以记录模板教程状态');
        const previous=me.departmentTemplateGuide;
        if(previous?.version===input.version&&(previous.status==='completed'||previous.status===input.status))return unchanged(tx,input.clubId,{member:selfMember(me)});
        const change=await stamp(tx,input.clubId,'members');
        const updated={...me,departmentTemplateGuide:{version:input.version,status:input.status,at:now()},syncVersion:change.version};
        await tx.put('members',me._id,updated);
        return {...change,member:selfMember(updated)};
      });
    },
    async createTemplate(input, identity) {
      const templateId = docKey('tpl_', input.clubId + ':' + identity, input.requestId);
      return store.transaction(async tx => {
        const me = await member(tx, input.clubId, identity);requireCore(me);
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
        const me = await member(tx, template.clubId, identity);requireCore(me);
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
        const me = await member(tx, template.clubId, identity);requireCore(me);
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
        const me = await member(tx, input.clubId, identity);requireCore(me);
        const previous = await tx.get('tasks', taskId);
        if (previous) {
          const children = (await tx.find('tasks', { clubId: input.clubId })).filter(t => t.parentTaskId === taskId);
          return unchanged(tx, input.clubId, { taskId, task: previous, tasks: [previous, ...children] });
        }
        if (input.parentTaskId) fail('VALIDATION', '模板只能用于创建主任务');
        if (!Array.isArray(input.subtasks) || !input.subtasks.length || input.subtasks.length > MAX_STEPS) fail('VALIDATION', `请保留1—${MAX_STEPS}项子任务`);
        const roster = await activeMembers(tx, { clubId: input.clubId });
        const roles=templateRoles(input.roles).map((role,index)=>({ ...role, ...assignment({...input.roles[index],mode:'individual'},roster,{optional:true,coreOnly:role.coreMember!==false}),guestNames:input.roles[index].guestNames || '', participantDepartment:input.roles[index].participantDepartment || '' }));
        const fields = { ...content(input), ...assignment(input, roster), ...schedule(input) };
        const {dueAt}=fields;
        let sourceTemplate, template;
        if (input.templateId) {
          template = await tx.get('templates', input.templateId);
          if (!template || template.clubId !== input.clubId) fail('NOT_FOUND', '模板不属于当前社团');
          if (template.archived) fail('ARCHIVED', '模板已归档，请选择其他模板');
          if(template.roles?.some(role=>role.coreMember===false&&input.roles?.some(next=>next.id===role.id&&next.coreMember===undefined)))fail('CONFLICT','此模板包含可由非部员担任的角色，请刷新后重新套用');
          sourceTemplate = { id: template._id, name: template.name };
        }
        const steps=dependencySteps(input.subtasks,template);
        const schedulingMode=planningMode(input,template);
        let plan;
        try { plan=computeStepSchedule(dueAt,steps,schedulingMode); }
        catch (error) { fail('VALIDATION',error.message); }
        const taskIds=new Map(steps.map((step,index)=>[step.id,taskId+'_'+index]));
        const children = steps.map((step, index) => {
          if (!step || typeof step !== 'object') fail('VALIDATION', '子任务格式无效');
          const daysBefore = offset(step.daysBefore);
          const childDue = plan[index].dueAt;
          if (!Number.isSafeInteger(childDue) || childDue <= now()) fail('VALIDATION', `子任务${index + 1}的截止时间已过，请调整日期或提前天数`);
          if (childDue > dueAt) fail('VALIDATION', `子任务${index + 1}不能晚于主任务截止`);
          if (schedulingMode==='backward'&&plan[index].startAt<now()) fail('VALIDATION',`「${step.title}」按预计耗时需在过去开始，请调迟主任务或调整计划`);
          return { ...content(step), ...assignment(step, roster, { main: fields, roles }), ...schedule({...step,dueAt:childDue},null,true), daysBefore, ...(schedulingMode==='backward'?{estimateMinutes:step.estimateMinutes}:{}), dependsOnTaskIds:step.dependsOn.map(id=>taskIds.get(id)) };
        });
        const change = await stamp(tx, input.clubId, 'tasks');
        const common = { clubId: input.clubId, creatorId: me._id, createdAt: now(), updatedAt: now(), revision: 1, syncVersion: change.version, archived: false, completions: {}, sharedCompletion: null };
        const task = { ...fields, ...common, _id: taskId, dueAt, schedulingMode, ...(sourceTemplate ? { sourceTemplate } : {}) };
        const tasks = [task, ...children.map((child, index) => ({ ...child, ...common, _id: taskId + '_' + index, parentTaskId: taskId, parentCreatorId: me._id }))];
        for (const item of tasks) await tx.put('tasks', item._id, item);
        return { ...change, taskId, task, tasks };
      });
    },
    async createTask(input, identity) {
      const fields = content(input);
      const taskId = docKey('t_', input.clubId + ':' + identity, input.requestId);
      return store.transaction(async tx => {
        const me = await member(tx, input.clubId, identity);requireCore(me);
        const previous = await tx.get('tasks', taskId);
        if (previous) return unchanged(tx, input.clubId, { taskId, task: previous });
        const roster = await activeMembers(tx, { clubId: input.clubId });
        const assigned = assignment(input, roster);
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
          clubId: input.clubId, creatorId: me._id, ...assigned,
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
        let participantIds = task.participantIds,guestParticipants=task.guestParticipants||[];
        if (task.parentTaskId && (input.participantIds !== undefined || input.participantDepartment || input.guestNames!==undefined)) {
          const roster = await activeMembers(tx, { clubId: task.clubId });
          const assigned=assignment({ ...input,guestNames:input.guestNames??guestParticipants.map(person=>person.name).join('\n'), mode: task.mode }, roster);
          const requested=assigned.participantIds,requestedGuests=assigned.guestParticipants||[];
          const changed = requested.length !== participantIds.length || requested.some(id => !participantIds.includes(id)) || JSON.stringify(requestedGuests)!==JSON.stringify(guestParticipants);
          if (changed) {
            if (Object.keys(task.completions).length || task.sharedCompletion) fail('CONFLICT', '子任务已有完成记录，请先撤销完成后再调整负责人');
            participantIds = requested;
            guestParticipants=requestedGuests;
          }
        }
        if (task.title === fields.title && task.description === fields.description && task.priority === fields.priority && Object.entries(timing).every(([key,value])=>(task[key] ?? (key==='deadlineFollowsStart'?false:null))===value) && participantIds === task.participantIds) return unchanged(tx, task.clubId, { taskId: task._id, task });
        const change = await stamp(tx, task.clubId, 'tasks');
        const updated = Object.assign({}, task, fields, timing, { participantIds,...(task.guestParticipants||guestParticipants.length?{guestParticipants}:{}), updatedAt: now(), revision: task.revision + 1, syncVersion: change.version });
        await tx.put('tasks', task._id, updated);
        return Object.assign(change, { taskId: task._id, task: updated });
      });
    },
    async complete(input, identity) {
      if (typeof input.done !== 'boolean') fail('VALIDATION', '无效的完成状态');
      return store.transaction(async tx => {
        const { task, me } = await taskAccess(tx, input.taskId, identity);
        if (task.archived) fail('ARCHIVED', '任务已归档');
        const before = JSON.stringify([task.completions, task.sharedCompletion,task.completionActors]);
        const target=input.participantId===undefined?me._id:input.participantId,proxy=target!==me._id;
        if(typeof target!=='string')fail('VALIDATION','请选择有效的负责人');
        if(proxy){
          requireCore(me);
          if(!canProxyFor(task,target,await activeMembers(tx,{clubId:task.clubId})))fail('FORBIDDEN','只能代主讲人或免注册负责人标记完成');
        }
        const assigned=participantKeys(task).includes(target);
        if (task.mode === 'individual') {
          if (!assigned) fail('FORBIDDEN', '你不是这项任务的参与人');
          if (input.done && !task.completions[target]) {
            task.completions[target] = now();
            if(proxy){task.completionActors||={};task.completionActors[target]={actorId:me._id,actorName:me.name,at:task.completions[target]};}
          }
          if (!input.done) {
            if(proxy&&task.completions[target]&&task.completionActors?.[target]?.actorId!==me._id&&!canManage(task,me))fail('FORBIDDEN','仅实际操作者、发布者或社团创建者可以撤销代完成');
            delete task.completions[target];if(task.completionActors)delete task.completionActors[target];
          }
        } else if (input.done) {
          if (!assigned) fail('FORBIDDEN', '只有指定成员可以完成这项任务');
          if (!task.sharedCompletion) task.sharedCompletion = { memberId: target, at: now(),...(proxy?{actorId:me._id,actorName:me.name}:{}) };
        } else {
          if(proxy&&task.sharedCompletion&&task.sharedCompletion.memberId!==target)fail('CONFLICT','此任务由另一位负责人完成，请刷新查看');
          if (task.sharedCompletion && task.sharedCompletion.memberId !== me._id && (task.sharedCompletion.actorId||task.sharedCompletion.memberId)!==me._id && !canManage(task, me)) fail('FORBIDDEN', '仅完成人、实际操作者、发布者或社团创建者可以重新打开任务');
          if (!task.sharedCompletion && !assigned && !canManage(task, me)) fail('FORBIDDEN', '无权修改此任务');
          task.sharedCompletion = null;
        }
        if (before === JSON.stringify([task.completions, task.sharedCompletion,task.completionActors])) return unchanged(tx, task.clubId, { taskId: task._id, task });
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
