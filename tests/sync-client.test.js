const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSyncClient } = require('../shared/sync-client');
const { createService } = require('../shared/domain');
const { createMemoryStore } = require('../shared/memory-store');
const crypto = require('node:crypto');
const copy = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const task = (revision = 1, patch = {}) => Object.assign({ _id: 'task', revision, dueAt: 100, archived: false, completions: {} }, patch);
const snapshot = (version = 1, tasks = [task()]) => ({ full: true, version, club: { id: 'club', name: 'SPS', inviteVersion: 1 }, me: { id: 'me', name: '我' }, members: [{ id: 'me', name: '我', syncVersion: 1 }], tasks, clubs: [] });
const mutation = (baseVersion, changed) => ({ baseVersion, version: baseVersion + 1, club: snapshot().club, task: changed });
function harness(handler) {
  let time = 100000, sequence = 0;
  const timers = new Map(), calls = [];
  const selected = { namespace: 'person-a', clubId: 'club' };
  const client = createSyncClient({
    context: () => ({ ...selected }), now: () => time,
    setTimer: (fn, delay) => { const id = ++sequence; timers.set(id, { fn, at: time + delay }); return id; },
    clearTimer: id => timers.delete(id),
    transport: async (action, input) => { calls.push({ action, input, at: time }); return handler ? handler(action, input) : action === 'bootstrap' ? snapshot() : { unchanged: true, version: 1 }; }
  });
  async function tick(ms) {
    const end = time + ms;
    for (let limit = 0; limit < 1000; limit++) {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) { time = end; await flush(); return; }
      time = next[1].at; timers.delete(next[0]); next[1].fn(); await flush();
    }
    throw new Error('runaway timer');
  }
  return { client, selected, calls, timers, tick };
}

test('pages share one in-flight read and a ten-second memory cache', async () => {
  const gate = deferred(); const h = harness(() => gate.promise);
  const a = h.client.refresh(), b = h.client.refresh();
  await flush(); assert.equal(h.calls.length, 1);
  gate.resolve(snapshot()); assert.equal(await a, await b);
  const stop = h.client.watch(() => {}); await flush(); stop();
  await h.tick(9999); await h.client.refresh(); assert.equal(h.calls.length, 1);
  await h.tick(1); await h.client.refresh(); assert.equal(h.calls.length, 2);
});

test('idle probes back off 15 → 30 → 60 seconds and interaction never postpones a due probe', async () => {
  const h = harness(); h.client.watch(() => {}); await flush(); await h.tick(600000);
  assert.deepEqual(h.calls.slice(1).map(c => (c.at - 100000) / 1000), [15, 30, 60, 90, 150, 210, 270, 330, 390, 450, 510, 570]);
  assert.ok(h.calls.slice(1).every(c => c.action === 'sync'));
  h.client.touch(); await h.tick(14000); h.client.touch(); await h.tick(1000);
  assert.equal(h.calls.length, 14);
});

test('hidden and offline clients make zero timer requests; return and reconnect refresh immediately', async () => {
  const h = harness(); h.client.watch(() => {}); await flush();
  h.client.setVisible(false); await h.tick(600000); assert.equal(h.calls.length, 1);
  h.client.setVisible(true); await flush(); assert.equal(h.calls.length, 2);
  h.client.setOnline(false); await h.tick(600000); assert.equal(h.calls.length, 2);
  await assert.rejects(h.client.mutate('complete', {}), { code: 'OFFLINE' });
  assert.equal(h.client.getState().board.version, 1);
  h.client.setOnline(true); await flush(); assert.equal(h.calls.length, 3);
  assert.equal(h.client.getState().phase, 'ready');
});

test('last subscriber leaving stops polling', async () => {
  const h = harness(); const a = h.client.watch(() => {}), b = h.client.watch(() => {}); await flush();
  a(); assert.equal(h.timers.size, 1); b(); await h.tick(600000); assert.equal(h.calls.length, 1);
});

test('acknowledged completion updates immediately with no follow-up full read', async () => {
  const h = harness(action => action === 'bootstrap' ? snapshot() : mutation(1, task(2, { completions: { me: 123 } })));
  await h.client.refresh(); await h.client.mutate('complete', {});
  assert.equal(h.client.getState().board.tasks[0].completions.me, 123);
  assert.equal(h.client.getState().board.version, 2); assert.equal(h.calls.length, 2);
  await h.client.refresh(); assert.equal(h.calls.length, 2);
});

test('an older read cannot undo a completion acknowledged while it was in flight', async () => {
  const gate = deferred();
  const h = harness(action => action === 'bootstrap' ? snapshot() : action === 'sync' ? gate.promise : mutation(1, task(2, { completions: { me: 123 } })));
  await h.client.refresh(); const old = h.client.refresh({ force: true }); await flush();
  await h.client.mutate('complete', {}); gate.resolve({ ...snapshot(), full: false }); await old;
  assert.equal(h.client.getState().board.version, 2); assert.equal(h.client.getState().board.tasks[0].revision, 2);
});

test('out-of-order mutation acknowledgements cannot resurrect archived tasks', async () => {
  const edit = deferred();
  const h = harness(action => action === 'bootstrap' ? snapshot() : action === 'editTask' ? edit.promise : mutation(2, task(3, { archived: true })));
  await h.client.refresh(); const late = h.client.mutate('editTask', {});
  await h.client.mutate('archiveTask', {}); edit.resolve(mutation(1, task(2))); await late;
  assert.deepEqual(h.client.getState().board.tasks, []);
});

test('restores add tasks and templates back to the board and ignore earlier archive acknowledgements',async()=>{
  for(const template of [false,true]) {
    const lateArchive=deferred(),record=task(3),start={...snapshot(1,[]),templates:[]};
    const patch=(base,item)=>({baseVersion:base,version:base+1,club:start.club,...(template?{template:item}:{tasks:[item]})});
    const h=harness(action=>action==='bootstrap'?start:action==='archive'?lateArchive.promise:patch(2,record));
    await h.client.refresh(); const late=h.client.mutate('archive',{});
    await h.client.mutate('restore',{}); lateArchive.resolve(patch(1,task(2,{archived:true}))); await late;
    assert.deepEqual(h.client.getState().board[template?'templates':'tasks'],[record]);
  }
});

test('a full snapshot after re-archiving prevents a delayed restore from reviving the item',async()=>{
  for(const template of [false,true]) {
    const restore=deferred();let reads=0;
    const h=harness(action=>action==='restore'?restore.promise:{...snapshot(++reads===1?2:4,[]),templates:[]});
    await h.client.refresh();const late=h.client.mutate('restore',{});
    await h.client.refresh({force:true,includeClubs:true});
    restore.resolve({baseVersion:2,version:3,club:snapshot().club,...(template?{template:task(3)}:{tasks:[task(3)]})});await late;
    assert.equal(h.client.getState().board.version,4);assert.deepEqual(h.client.getState().board[template?'templates':'tasks'],[]);
  }
});

test('member deletion patches remove the member immediately and ignore late edit acknowledgements', async () => {
  const person={id:'departed',name:'Former member',syncVersion:1}, edit=deferred();
  const initial={...snapshot(),members:[...snapshot().members,person]};
  const h=harness(action=>action==='bootstrap'?initial:action==='adminEditMember'?edit.promise:{baseVersion:2,version:3,club:initial.club,member:{id:person.id,archived:true,syncVersion:3}});
  await h.client.refresh(); const late=h.client.mutate('adminEditMember',{});
  await h.client.mutate('adminDeleteAccount',{});
  assert.deepEqual(h.client.getState().board.members,snapshot().members);
  edit.resolve({baseVersion:1,version:2,club:initial.club,member:{...person,name:'Late name',syncVersion:2}}); await late;
  assert.deepEqual(h.client.getState().board.members,snapshot().members);
});

test('other browsers apply member tombstones and full refreshes remember missing members', async () => {
  const person={id:'departed',name:'Former member',syncVersion:1};
  for(const full of [false,true]) {
    const edit=deferred(); let reads=0;
    const h=harness(action=>action==='adminEditMember'?edit.promise:++reads===1?{...snapshot(),members:[...snapshot().members,person]}:full?snapshot(3):{...snapshot(3),full:false,members:[{id:person.id,archived:true,syncVersion:3}],tasks:[]});
    await h.client.refresh(); const late=h.client.mutate('adminEditMember',{});
    await h.client.refresh({force:true});
    assert.deepEqual(h.client.getState().board.members,snapshot().members);
    edit.resolve({baseVersion:1,version:2,club:snapshot().club,member:{...person,syncVersion:2}}); await late;
    assert.deepEqual(h.client.getState().board.members,snapshot().members);
  }
});

test('changing identity discards late reads and does not expose the prior club cache', async () => {
  const gate = deferred(); const h = harness(() => gate.promise);
  const old = h.client.refresh(); await flush(); h.selected.namespace = 'person-b'; h.client.select();
  assert.equal(h.client.getState().board, null); gate.resolve(snapshot());
  await assert.rejects(old, { code: 'STALE_CONTEXT' }); assert.equal(h.client.getState().board, null);
});

test('failed reads retain confirmed state, back off and clear data on revoked access', async () => {
  let code = 'NETWORK'; const h = harness(action => { if (action === 'bootstrap') return snapshot(); throw Object.assign(new Error(code), { code }); });
  h.client.watch(() => {}); await flush(); await h.tick(15000);
  assert.equal(h.client.getState().phase, 'error'); assert.equal(h.client.getState().board.version, 1);
  await h.tick(29999); assert.equal(h.calls.length, 2); await h.tick(1); assert.equal(h.calls.length, 3);
  code = 'FORBIDDEN'; await h.tick(60000); assert.equal(h.client.getState().board, null);
  await h.tick(600000); assert.equal(h.calls.length, 4);
});

test('a failed write never displays unconfirmed completion', async () => {
  const h = harness(action => { if (action === 'bootstrap') return snapshot(); throw new Error('timeout'); });
  await h.client.refresh(); await assert.rejects(h.client.mutate('complete', {}), /timeout/);
  assert.deepEqual(h.client.getState().board.tasks[0].completions, {});
});

test('full refresh requested while delta is in flight waits, then fetches club membership', async () => {
  const gate = deferred(); let bootstraps = 0;
  const h = harness(action => { if (action === 'bootstrap') { bootstraps++; return snapshot(); } return gate.promise; });
  await h.client.refresh(); const delta = h.client.refresh({ force: true }); await flush();
  const full = h.client.refresh({ includeClubs: true }); gate.resolve({ unchanged: true, version: 1 });
  await Promise.all([delta, full]); assert.equal(bootstraps, 2);
});

test('two clients converge without skipping a remote change before a local acknowledgement', async () => {
  const store = createMemoryStore();
  const run = createService({ store, now: () => 100000, randomId: () => crypto.randomBytes(16).toString('hex'), hash: s => crypto.createHash('sha256').update(s).digest('hex') });
  const { clubId } = await run('createClub', { name: 'SPS', nickname: 'A', requestId: 'club-123' }, 'a');
  const invite = await run('getInvite', { clubId }, 'a');
  await run('joinClub', { token: invite.token, nickname: 'B' }, 'b');
  const members = (await run('bootstrap', { clubId }, 'a')).members;
  const input = { clubId, title: 'Task', description: '', dueAt: 200000, mode: 'individual', priority: 'normal', participantIds: members.map(m => m.id) };
  const t1 = await run('createTask', { ...input, requestId: 'task-111' }, 'a');
  const t2 = await run('createTask', { ...input, requestId: 'task-222' }, 'a');
  const a = harness((action, data) => run(action, data, 'a')), b = harness((action, data) => run(action, data, 'b'));
  a.selected.clubId = b.selected.clubId = clubId;
  await Promise.all([a.client.refresh(), b.client.refresh()]);
  const before = a.client.getState().board.version;
  await b.client.mutate('complete', { taskId: t1.taskId, done: true });
  await a.client.mutate('complete', { taskId: t2.taskId, done: true });
  assert.equal(a.client.getState().board.version, before, 'cursor must not jump over B’s unseen write');
  await a.client.refresh(); await b.client.refresh({ force: true });
  assert.deepEqual(copy(a.client.getState().board.tasks), copy(b.client.getState().board.tasks));
  await a.client.mutate('archiveTask', { taskId: t1.taskId }); await b.client.refresh({ force: true });
  assert.equal(b.client.getState().board.tasks.length, 1);
});

test('parent archive removes every subtask immediately and late child edits cannot resurrect them', async () => {
  const parent=task(1,{_id:'parent'}),child=task(1,{_id:'child',parentTaskId:'parent'});
  const late=deferred();
  const h=harness(action=>action==='bootstrap'?snapshot(1,[parent,child]):action==='editTask'?late.promise:{baseVersion:2,version:3,club:snapshot().club,task:{...parent,revision:2,archived:true},tasks:[{...parent,revision:2,archived:true},{...child,revision:3,archived:true}]});
  await h.client.refresh();
  const pending=h.client.mutate('editTask',{});
  await h.client.mutate('archiveTask',{});
  assert.deepEqual(h.client.getState().board.tasks,[]);
  late.resolve(mutation(1,{...child,revision:2,title:'Late title'}));await pending;
  assert.deepEqual(h.client.getState().board.tasks,[]);
});

test('template edits, categories and tombstones merge without dropping untouched templates or reviving archived ones',async()=>{
  const one={_id:'tpl-one',name:'Seminar',category:'Academic',revision:1,archived:false};
  const two={...one,_id:'tpl-two',name:'Workshop'};
  const late=deferred();
  const h=harness(action=>action==='bootstrap'?{...snapshot(),templates:[one,two]}:action==='editTemplate'?late.promise:{baseVersion:2,version:3,club:snapshot().club,template:{...one,revision:3,archived:true}});
  await h.client.refresh(); const pending=h.client.mutate('editTemplate',{});
  await h.client.mutate('archiveTemplate',{});
  late.resolve({baseVersion:1,version:2,club:snapshot().club,template:{...one,revision:2,category:'Changed'}}); await pending;
  assert.deepEqual(h.client.getState().board.templates,[two]);
  h.selected.namespace='other-person';h.client.select();assert.equal(h.client.getState().board,null);
});

test('a template-only remote delta preserves tasks and unrelated shared templates',async()=>{
  const one={_id:'tpl-one',revision:1,name:'Seminar',category:'Academic'},two={...{_id:'tpl-two',revision:1,name:'Workshop'}};
  const h=harness(action=>action==='bootstrap'?{...snapshot(),templates:[one,two]}:{...snapshot(2,[]),full:false,members:[],templates:[{...one,revision:2,category:'Talks'}]});
  await h.client.refresh();await h.client.refresh({force:true});
  assert.equal(h.client.getState().board.tasks.length,1);assert.equal(h.client.getState().board.templates.length,2);
  assert.equal(h.client.getState().board.templates.find(t=>t._id==='tpl-one').category,'Talks');
});
