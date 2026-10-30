const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createService } = require('../shared/domain');
const { createMemoryStore } = require('../shared/memory-store');
const { taskView, parseDeadline, parts } = require('../shared/view');

async function fixture() {
  let clock = Date.parse('2026-10-29T10:00:00+08:00');
  const store = createMemoryStore();
  const run = createService({ store, now: () => clock, randomId: () => crypto.randomBytes(16).toString('hex'), hash: s => crypto.createHash('sha256').update(s).digest('hex') });
  const { clubId } = await run('createClub', { name: 'SPS', nickname: 'Owner', requestId: 'create-club-1' }, 'owner');
  const invite = await run('getInvite', { clubId }, 'owner');
  await run('joinClub', { token: invite.token, nickname: 'Alice' }, 'alice');
  await run('joinClub', { token: invite.token, nickname: 'Bob' }, 'bob');
  const board = () => run('bootstrap', { clubId }, 'owner');
  const initial = await board();
  const ids = Object.fromEntries(initial.members.map(m => [m.name.toLowerCase(), m.id]));
  let sequence = 0;
  const create = (overrides = {}, identity = 'owner') => run('createTask', Object.assign({ clubId, requestId: 'create-task-' + sequence++, title: '活动准备', description: '', dueAt: clock + 86400000, mode: 'individual', priority: 'normal', participantIds: Object.values(ids) }, overrides), identity);
  return { run, store, clubId, invite, ids, board, create, time: () => clock, advance: amount => { clock += amount; } };
}

test('deleted membership tombstones cannot authenticate, rejoin or receive new assignments',async()=>{
  const f=await fixture();
  await f.create({participantIds:[f.ids.alice,f.ids.bob]},'alice');
  const before=await f.board();
  await f.store.transaction(async tx=>{
    const club=await tx.get('clubs',f.clubId),version=club.syncVersion+1;
    await tx.put('members',f.ids.alice,{clubId:f.clubId,archived:true,syncVersion:version});
    await tx.put('clubs',f.clubId,{...club,syncVersion:version,membersVersion:version});
  });
  const board=await f.board(); assert.equal(board.members.length,2);
  assert.deepEqual(board.tasks,before.tasks);
  const rendered=taskView(board.tasks[0],board,f.time());
  assert.equal(rendered.creatorName,'已离开的成员');
  assert.equal(rendered.participantLabel,'已离开的成员、Bob');
  for(const [action,input] of [['bootstrap',{clubId:f.clubId}],['sync',{clubId:f.clubId,since:board.version}],['joinClub',{token:f.invite.token,nickname:'Return'}]]) {
    await assert.rejects(f.run(action,input,'alice'),{code:'FORBIDDEN'});
  }
  await assert.rejects(f.create({participantIds:[f.ids.alice]}),{code:'VALIDATION'});
  const delta=await f.run('sync',{clubId:f.clubId,since:before.version,memberTombstones:true},'bob');
  assert.deepEqual(delta.members,[{id:f.ids.alice,archived:true,syncVersion:board.version}]);
  const oldClient=await f.run('sync',{clubId:f.clubId,since:before.version},'bob');
  assert.equal(oldClient.full,true); assert.ok(oldClient.members.every(m=>m.id!==f.ids.alice && m.name));
});
test('all members can publish; independent completions and undo do not change peers', async () => {
  const f = await fixture(); const { taskId } = await f.create({}, 'alice');
  await Promise.all(['owner', 'alice', 'bob'].map(identity => f.run('complete', { taskId, done: true }, identity)));
  let b = await f.board(); assert.equal(taskView(b.tasks[0], b).done, true);
  await f.run('complete', { taskId, done: false, memberId: f.ids.bob }, 'alice');
  b = await f.board(); assert.equal(Object.keys(b.tasks[0].completions).length, 2);
  assert.ok(b.tasks[0].completions[f.ids.bob]); assert.ok(!b.tasks[0].completions[f.ids.alice]);
});
test('outsiders cannot read, invite, create, complete, edit or archive club data', async () => {
  const f = await fixture(); const { taskId } = await f.create();
  for (const [action, input] of [['bootstrap', { clubId: f.clubId }], ['getInvite', { clubId: f.clubId }], ['complete', { taskId, done: true }], ['editTask', { taskId, title: 'x', priority: 'normal' }], ['archiveTask', { taskId }]]) {
    await assert.rejects(f.run(action, input, 'outsider'), { code: 'FORBIDDEN' });
  }
  await assert.rejects(f.create({}, 'outsider'), { code: 'FORBIDDEN' });
});
test('shared completion permits assignees and preserves the first completer under concurrency', async () => {
  const f = await fixture(); const { taskId } = await f.create({ mode: 'shared', participantIds: [f.ids.alice, f.ids.bob] });
  await assert.rejects(f.run('complete', { taskId, done: true }, 'owner'), { code: 'FORBIDDEN' });
  await Promise.all(['alice', 'bob'].map(identity => f.run('complete', { taskId, done: true }, identity)));
  let b = await f.board(); assert.equal(b.tasks[0].sharedCompletion.memberId, f.ids.alice);
  await assert.rejects(f.run('complete', { taskId, done: false }, 'bob'), { code: 'FORBIDDEN' });
  await f.run('complete', { taskId, done: false }, 'owner');
  b = await f.board(); assert.equal(b.tasks[0].sharedCompletion, null);
});
test('only publisher and owner manage tasks; stale edits cannot overwrite updates', async () => {
  const f = await fixture(); const { taskId } = await f.create({}, 'alice');
  const edit = { taskId, title: '调整任务', description: '', priority: 'normal', dueAt: f.time() + 86400000, revision: 1 };
  await assert.rejects(f.run('editTask', edit, 'bob'), { code: 'FORBIDDEN' });
  await assert.rejects(f.run('archiveTask', { taskId }, 'bob'), { code: 'FORBIDDEN' });
  await f.run('complete', { taskId, done: true }, 'bob');
  await assert.rejects(f.run('editTask', edit, 'alice'), { code: 'CONFLICT' });
  await f.run('editTask', Object.assign(edit, { revision: 2 }), 'alice');
  await f.run('archiveTask', { taskId }, 'owner');
  assert.equal((await f.board()).tasks.length, 0);
  await assert.rejects(f.run('complete', { taskId, done: true }, 'alice'), { code: 'ARCHIVED' });
  assert.ok((await f.store.get('tasks', taskId)).completions[f.ids.bob]);
});
test('expired deadlines remain visible and can be completed late; new invalid deadlines rejected', async () => {
  const f = await fixture(); const { taskId } = await f.create(); f.advance(2 * 86400000);
  let b = await f.board(); assert.equal(taskView(b.tasks[0], b, f.time()).status, 'overdue');
  await f.run('editTask', { taskId, title: '仍可编辑说明', priority: 'normal', dueAt: b.tasks[0].dueAt, revision: 1 }, 'owner');
  await f.run('complete', { taskId, done: true }, 'alice');
  await assert.rejects(f.create({ dueAt: NaN }), { code: 'VALIDATION' });
  await assert.rejects(f.create({ dueAt: f.time() - 1 }), { code: 'VALIDATION' });
});
test('input validation rejects empty titles, invalid assignees, mode and completion state', async () => {
  const f = await fixture();
  for (const patch of [{ title: '   ' }, { title: 'a'.repeat(81) }, { participantIds: [] }, { participantIds: ['foreign-id'] }, { mode: 'fake' }, { priority: 'urgent' }]) await assert.rejects(f.create(patch), { code: 'VALIDATION' });
  const { taskId } = await f.create({ participantIds: [f.ids.alice] });
  await assert.rejects(f.run('complete', { taskId, done: 'true' }, 'alice'), { code: 'VALIDATION' });
  await assert.rejects(f.run('complete', { taskId, done: true }, 'bob'), { code: 'FORBIDDEN' });
  await assert.rejects(f.run('__proto__', {}, 'alice'), { code: 'VALIDATION' });
  await assert.rejects(f.run('bootstrap', {}, ''), { code: 'UNAUTHENTICATED' });
});
test('create and join retries are idempotent', async () => {
  const f = await fixture();
  const [a, b] = await Promise.all([f.create({ requestId: 'retry-test-id' }), f.create({ requestId: 'retry-test-id' })]);
  assert.equal(a.taskId, b.taskId); assert.equal((await f.board()).tasks.length, 1);
  await Promise.all([1, 2].map(() => f.run('joinClub', { token: f.invite.token, nickname: 'Alice changed' }, 'alice')));
  assert.equal((await f.board()).members.length, 3);
  const club = await f.run('createClub', { name: 'duplicate', nickname: 'owner', requestId: 'create-club-1' }, 'owner');
  assert.equal(club.clubId, f.clubId);
});
test('rotating invitation revokes old codes without removing existing members', async () => {
  const f = await fixture();
  await assert.rejects(f.run('rotateInvite', { clubId: f.clubId }, 'alice'), { code: 'FORBIDDEN' });
  const invite = await f.run('rotateInvite', { clubId: f.clubId }, 'owner');
  await assert.rejects(f.run('joinClub', { token: f.invite.token, nickname: 'New' }, 'new'), { code: 'NOT_FOUND' });
  await f.run('joinClub', { token: invite.token, nickname: 'New' }, 'new');
  assert.equal((await f.board()).members.length, 4);
});
test('club boundaries, stored participant snapshots and public member records stay isolated', async () => {
  const f = await fixture(); await f.create();
  await f.run('joinClub', { token: f.invite.token, nickname: 'New' }, 'new');
  const b = await f.board(); assert.equal(b.members.length, 4); assert.equal(b.tasks[0].participantIds.length, 3);
  assert.ok(b.members.every(m => !('identity' in m)));
  const other = await f.run('createClub', { name: 'Other', nickname: 'Other owner', requestId: 'other-club-1' }, 'other');
  await assert.rejects(f.run('bootstrap', { clubId: other.clubId }, 'alice'), { code: 'FORBIDDEN' });
  await assert.rejects(f.create({ clubId: other.clubId }, 'other'), { code: 'VALIDATION' });
});
test('Asia/Shanghai deadlines are independent of host timezone and reject overflow dates', () => {
  const timestamp = parseDeadline('2026-10-29', '20:30');
  assert.equal(timestamp, Date.parse('2026-10-29T12:30:00Z'));
  assert.deepEqual(parts(timestamp), { date: '2026-10-29', time: '20:30', weekday: '四' });
  assert.throws(() => parseDeadline('2026-02-30', '20:00'));
  assert.throws(() => parseDeadline('2026-10-29', '25:30'));
});
test('failed transactions roll back partially written state', async () => {
  const store = createMemoryStore();
  await assert.rejects(store.transaction(async tx => { await tx.put('clubs', 'temp', { name: 'temp' }); throw new Error('rollback'); }));
  assert.equal(await store.get('clubs', 'temp'), null);
});

test('unchanged sync authorizes membership with two point reads and no list scans', async () => {
  const f = await fixture(); const initial = await f.board(); const calls = [];
  for (const name of ['get', 'find', 'findSince']) {
    const original = f.store[name]; f.store[name] = (...args) => { calls.push([name, ...args]); return original(...args); };
  }
  assert.deepEqual(await f.run('sync', { clubId: f.clubId, since: initial.version }, 'owner'), { unchanged: true, version: initial.version });
  assert.deepEqual(calls.map(c => c.slice(0, 2)), [['get', 'members'], ['get', 'clubs']]);
  await assert.rejects(f.run('sync', { clubId: f.clubId, since: initial.version }, 'outsider'), { code: 'FORBIDDEN' });
});

test('same-timestamp concurrent writes have distinct cursors and archive tombstones sync', async () => {
  const f = await fixture(); const initial = await f.board();
  const [a, b] = await Promise.all([f.create(), f.create()]);
  assert.notEqual(a.version, b.version);
  let delta = await f.run('sync', { clubId: f.clubId, since: initial.version }, 'owner');
  assert.equal(delta.full, false); assert.equal(delta.tasks.length, 2); assert.deepEqual(delta.members, []);
  assert.equal(delta.tasks[0].updatedAt, delta.tasks[1].updatedAt);
  await f.run('archiveTask', { taskId: a.taskId }, 'owner');
  delta = await f.run('sync', { clubId: f.clubId, since: delta.version }, 'owner');
  assert.equal(delta.tasks.length, 1); assert.equal(delta.tasks[0].archived, true);
});

test('member-only updates avoid task scans and update the current member record', async () => {
  const f = await fixture(); const initial = await f.board();
  await f.run('renameMe', { clubId: f.clubId, name: '新称呼' }, 'owner');
  const original = f.store.findSince; const scanned = [];
  f.store.findSince = (...args) => { scanned.push(args[0]); return original(...args); };
  const delta = await f.run('sync', { clubId: f.clubId, since: initial.version }, 'owner');
  assert.deepEqual(scanned, ['members']); assert.equal(delta.me.name, '新称呼'); assert.equal(delta.members.length, 1);
});

test('no-op completions, renames and repeat archives do not consume new revisions', async () => {
  const f = await fixture(); const t = await f.create();
  const done = await f.run('complete', { taskId: t.taskId, done: true }, 'owner');
  assert.equal((await f.run('complete', { taskId: t.taskId, done: true }, 'owner')).version, done.version);
  assert.equal((await f.run('renameMe', { clubId: f.clubId, name: 'Owner' }, 'owner')).version, done.version);
  const archived = await f.run('archiveTask', { taskId: t.taskId }, 'owner');
  assert.equal((await f.run('archiveTask', { taskId: t.taskId }, 'owner')).version, archived.version);
});

test('legacy records without cursors upgrade on first write; invalid cursor gets full state', async () => {
  const f = await fixture(); const t = await f.create();
  await f.store.transaction(async tx => {
    const club = await tx.get('clubs', f.clubId);
    for (const key of ['syncVersion', 'membersVersion', 'tasksVersion', 'inviteVersion']) delete club[key];
    await tx.put('clubs', f.clubId, club);
    const task = await tx.get('tasks', t.taskId); delete task.syncVersion; await tx.put('tasks', t.taskId, task);
  });
  assert.equal((await f.board()).version, 0);
  await f.run('complete', { taskId: t.taskId, done: true }, 'owner');
  const delta = await f.run('sync', { clubId: f.clubId, since: 0 }, 'owner');
  assert.equal(delta.version, 1); assert.equal(delta.tasks.length, 1);
  const full = await f.run('sync', { clubId: f.clubId, since: 999 }, 'owner');
  assert.equal(full.full, true); assert.equal(full.tasks.length, 1);
});

test('subtasks have independent assignees and deadlines, with parent links in each member calendar', async () => {
  const { deadlineCalendar } = require('../shared/calendar');
  const f = await fixture(); const parent = await f.create({ participantIds: [f.ids.owner] });
  const alice = await f.create({ parentTaskId: parent.taskId, title: 'Alice work', participantIds: [f.ids.alice], dueAt: f.time()+3600000 });
  const bob = await f.create({ parentTaskId: parent.taskId, title: 'Bob work', participantIds: [f.ids.bob], dueAt: f.time()+7200000 });
  const board = await f.run('bootstrap', { clubId: f.clubId }, 'alice');
  const views = board.tasks.map(t => taskView(t,board,f.time()));
  assert.equal(views.find(t=>t._id===alice.taskId).parentTitle, '活动准备');
  assert.deepEqual(deadlineCalendar(views,{mine:true,now:f.time()}).tasks.map(t=>t._id),[alice.taskId]);
  await assert.rejects(f.run('complete',{taskId:bob.taskId,done:true},'alice'),{code:'FORBIDDEN'});
  await f.run('complete',{taskId:alice.taskId,done:true},'alice');
  assert.equal((await f.store.get('tasks',bob.taskId)).completions[f.ids.bob],undefined);
  assert.deepEqual((await f.store.get('tasks',parent.taskId)).completions,{});
});

test('subtasks require an active same-club root and the parent publisher or owner permission', async () => {
  const f = await fixture(); const parent = await f.create({},'alice');
  await assert.rejects(f.create({parentTaskId:parent.taskId},'bob'),{code:'FORBIDDEN'});
  const child = await f.create({parentTaskId:parent.taskId},'owner');
  await assert.rejects(f.create({parentTaskId:child.taskId}),{code:'VALIDATION'});
  await assert.rejects(f.create({parentTaskId:'missing'}),{code:'NOT_FOUND'});
  const other = await f.run('createClub',{name:'Other',nickname:'Owner',requestId:'subtask-other-club'},'owner');
  const otherBoard=await f.run('bootstrap',{clubId:other.clubId},'owner');
  await assert.rejects(f.create({clubId:other.clubId,participantIds:[otherBoard.me.id],parentTaskId:parent.taskId}),{code:'NOT_FOUND'});
  // Parent publisher retains management even when the club owner added the child.
  await f.run('editTask',{taskId:child.taskId,title:'Updated by parent author',priority:'normal',dueAt:child.task.dueAt,revision:1},'alice');
  await f.run('archiveTask',{taskId:parent.taskId},'alice');
  await assert.rejects(f.create({parentTaskId:parent.taskId},'alice'),{code:'ARCHIVED'});
});

test('subtask reassignment is revision checked, club scoped and preserves completion history', async () => {
  const f = await fixture(); const parent=await f.create();
  const child=await f.create({parentTaskId:parent.taskId,participantIds:[f.ids.alice]});
  const edit={taskId:child.taskId,title:child.task.title,priority:'normal',dueAt:child.task.dueAt,revision:1};
  await assert.rejects(f.run('editTask',{...edit,participantIds:['foreign']},'owner'),{code:'VALIDATION'});
  await assert.rejects(f.run('editTask',{...edit,participantIds:[]},'owner'),{code:'VALIDATION'});
  const updated=await f.run('editTask',{...edit,participantIds:[f.ids.bob]},'owner');
  await assert.rejects(f.run('editTask',{...edit,participantIds:[f.ids.alice]},'owner'),{code:'CONFLICT'});
  await assert.rejects(f.run('complete',{taskId:child.taskId,done:true},'alice'),{code:'FORBIDDEN'});
  const done=await f.run('complete',{taskId:child.taskId,done:true},'bob');
  await assert.rejects(f.run('editTask',{...edit,revision:done.task.revision,participantIds:[f.ids.alice]},'owner'),{code:'CONFLICT'});
  assert.deepEqual(updated.task.participantIds,[f.ids.bob]);
});

test('archiving a parent atomically archives children and sync returns every tombstone', async () => {
  const f=await fixture(); const parent=await f.create();
  const children=await Promise.all([f.create({parentTaskId:parent.taskId,participantIds:[f.ids.alice]}),f.create({parentTaskId:parent.taskId,participantIds:[f.ids.bob]})]);
  await f.run('complete',{taskId:children[0].taskId,done:true},'alice');
  const before=await f.board();
  const archived=await f.run('archiveTask',{taskId:parent.taskId},'owner');
  assert.equal(archived.tasks.length,3);
  assert.ok(archived.tasks.every(t=>t.archived&&t.syncVersion===archived.version));
  assert.ok(archived.tasks.find(t=>t._id===children[0].taskId).completions[f.ids.alice]);
  assert.equal((await f.board()).tasks.length,0);
  const delta=await f.run('sync',{clubId:f.clubId,since:before.version},'alice');
  assert.equal(delta.tasks.length,3);
  await assert.rejects(f.run('complete',{taskId:children[1].taskId,done:true},'bob'),{code:'ARCHIVED'});
});
