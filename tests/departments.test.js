const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { buildSync } = require('esbuild');
const { createService } = require('../shared/domain');
const { createMemoryStore } = require('../shared/memory-store');
const { DEPARTMENTS, invitationToken } = require('../shared/departments');
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
async function fixture() {
  const store = createMemoryStore();
  const run = createService({ store, now: Date.now, hash, randomId: () => crypto.randomBytes(16).toString('hex') });
  const { clubId } = await run('createClub', { name: 'SPS', nickname: 'Owner', requestId: 'department-club' }, 'owner');
  return { store, run, clubId, board: (identity = 'owner') => run('bootstrap', { clubId }, identity) };
}
test('existing clubs get three stable department invitations atomically without replacing the original code', async () => {
  const f = await fixture(), before = await f.store.get('clubs', f.clubId);
  const oldToken = (await f.store.get('invites', before.inviteHash)).token;
  await assert.rejects(f.run('getInvite', { clubId: f.clubId }, 'outsider'), { code: 'FORBIDDEN' });
  assert.equal((await f.store.get('clubs', f.clubId)).departmentInviteHashes, undefined);
  const [a,b] = await Promise.all([1,2].map(() => f.run('getInvite', { clubId: f.clubId }, 'owner')));
  assert.deepEqual(a,b); assert.equal(a.token,oldToken);
  assert.deepEqual(a.departments.map(d=>d.name),['宣传部','联络部','学术部']);
  assert.equal(new Set([a.token,...a.departments.map(d=>d.token)]).size,4);
  assert.equal((await f.board()).version,before.syncVersion+1);
  await f.run('joinClub',{token:oldToken,nickname:'Legacy member',department:'academic'},'legacy');
  assert.equal((await f.board('legacy')).me.department,'');
  const publicBoard=JSON.stringify(await f.board());
  for(const token of [a.token,...a.departments.map(d=>d.token)]) assert.ok(!publicBoard.includes(token));
});
test('the invitation determines the department for all three departments and deltas expose the assignment', async () => {
  const f=await fixture(), invites=await f.run('getInvite',{clubId:f.clubId},'owner');
  for(const d of invites.departments) {
    const before=await f.board();
    await f.run('joinClub',{token:d.token,nickname:d.name,department:'forged',role:'owner',clubId:'foreign'},d.id);
    const me=(await f.board(d.id)).me;
    assert.equal(me.department,d.id); assert.equal(me.role,'member');
    const delta=await f.run('sync',{clubId:f.clubId,since:before.version},'owner');
    assert.equal(delta.members.find(m=>m.id===me.id).department,d.id);
  }
  assert.equal((await f.board()).members.length,4);
});
test('unassigned existing members can join a department once without losing their name, role, history or membership', async () => {
  const f=await fixture(), invites=await f.run('getInvite',{clubId:f.clubId},'owner');
  const before=await f.board(), token=invites.departments[0].token;
  await Promise.all([1,2].map(()=>f.run('joinClub',{token,nickname:'Do not overwrite'},'owner')));
  const joined=await f.board();
  assert.equal(joined.members.length,1); assert.equal(joined.me.id,before.me.id);
  assert.equal(joined.me.name,before.me.name); assert.equal(joined.me.role,'owner');
  assert.equal(joined.me.joinedAt,before.me.joinedAt); assert.equal(joined.me.department,'publicity');
  assert.equal(joined.version,before.version+1);
  await assert.rejects(f.run('joinClub',{token:invites.departments[1].token,nickname:'Changed'},'owner'),{code:'CONFLICT'});
  await f.run('joinClub',{token:invites.token,nickname:'Changed'},'owner');
  assert.deepEqual(await f.board(),joined);
});
test('department invitation rotation revokes only that department and preserves member assignments', async () => {
  const f=await fixture(), invites=await f.run('getInvite',{clubId:f.clubId},'owner');
  await f.run('joinClub',{token:invites.departments[0].token,nickname:'Member'},'member');
  await assert.rejects(f.run('rotateInvite',{clubId:f.clubId,department:'publicity'},'member'),{code:'FORBIDDEN'});
  for(const department of ['__proto__','fake',null,{}]) await assert.rejects(f.run('rotateInvite',{clubId:f.clubId,department},'owner'),{code:'VALIDATION'});
  const rotated=await f.run('rotateInvite',{clubId:f.clubId,department:'publicity'},'owner');
  await assert.rejects(f.run('joinClub',{token:invites.departments[0].token,nickname:'New'},'new'),{code:'NOT_FOUND'});
  await f.run('joinClub',{token:rotated.token,nickname:'New'},'new');
  const current=await f.run('getInvite',{clubId:f.clubId},'owner');
  assert.equal(current.token,invites.token); assert.deepEqual(current.departments.slice(1),invites.departments.slice(1));
  assert.equal((await f.board('member')).me.department,'publicity');
  const general=await f.run('rotateInvite',{clubId:f.clubId},'owner');
  assert.deepEqual((await f.run('getInvite',{clubId:f.clubId},'owner')).departments,current.departments);
  assert.equal((await f.run('sync',{clubId:f.clubId,since:rotated.version},'owner')).club.inviteVersion,general.version);
});
test('failed department initialization leaves no partial invitations and can be retried', async () => {
  const f=await fixture(), before=f.store.snapshot(), transaction=f.store.transaction;
  f.store.transaction=work=>transaction(async tx=>{
    const put=tx.put; let count=0;
    tx.put=async (...args)=>{if(args[0]==='invites'&&++count===2) throw new Error('storage failure'); return put(...args);};
    return work(tx);
  });
  await assert.rejects(f.run('getInvite',{clubId:f.clubId},'owner'),/storage failure/);
  assert.deepEqual(f.store.snapshot(),before); f.store.transaction=transaction;
  assert.equal((await f.run('getInvite',{clubId:f.clubId},'owner')).departments.length,3);
});
test('member and admin pages show departments, select matching invitation codes and support department search/editing', async () => {
  const bundle=buildSync({entryPoints:['client/views.js'],bundle:true,format:'esm',write:false});
  const views=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const members=[{id:'owner',name:'Old member',role:'owner'},...DEPARTMENTS.map(d=>({id:d.id,name:d.name+'成员',role:'member',department:d.id,username:d.id,canEdit:true}))];
  const invites={token:'general-code',departments:DEPARTMENTS.map(d=>({...d,token:d.id+'-code'}))};
  const state={sync:{phase:'ready',board:{club:{id:'club',name:'SPS'},me:members[0],members}},form:{},invites,adminData:{members,events:[]}};
  assert.ok(views.members(state).includes('未分配'));
  for(const d of DEPARTMENTS) {
    state.inviteDepartment=d.id;
    const html=views.members(state);
    assert.ok(html.includes('自动归入'+d.name)); assert.ok(html.includes(d.id+'-code')); assert.ok(!html.includes('general-code'));
    assert.equal(invitationToken(invites,d.id),d.id+'-code');
    state.search=d.name;
    const admin=views.admin(state);
    assert.ok(admin.includes(d.name+'成员')); assert.ok(!admin.includes('Old member'));
  }
  state.adminTarget={...members[1],canEditAccount:true}; state.form.memberDepartment='publicity';
  assert.match(views.adminEditor(state),/value="publicity" selected/);
  assert.equal(invitationToken(invites,'unknown'),'');
});
