const { test }=require('node:test');
const assert=require('node:assert/strict');
const { buildSync }=require('esbuild');

test('admin navigation and pages are hidden from members even when private state is accidentally supplied',async()=>{
  const bundle=buildSync({entryPoints:['client/admin-views.js'],bundle:true,format:'esm',write:false});
  const views=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const state={sync:{board:{club:{id:'club'},me:{role:'member'}}},adminData:{members:[{username:'private_login'}]},adminTarget:{username:'private_login',canEdit:true},form:{}};
  for(const html of [views.admin(state),views.adminEditor(state)]) {
    assert.ok(!html.includes('private_login'));assert.ok(!html.includes('href="#/admin"'));assert.ok(html.includes('仅管理员可用'));
  }
  state.sync.board.me.role='owner';state.adminDenied=true;
  assert.ok(!views.admin(state).includes('private_login'));
});

test('admin views escape names, account fields, audit records and reset links',async()=>{
  const bundle=buildSync({entryPoints:['client/admin-views.js'],bundle:true,format:'esm',write:false});
  const views=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const bad='<img src=x onerror=alert(1)>',m={id:'id&other',name:bad,username:bad,role:'member',canEdit:true,canEditAccount:true};
  const state={sync:{phase:'ready',board:{club:{id:'club',name:bad},me:{id:'owner',role:'owner'}}},adminData:{members:[m],events:[{actorId:m.id,targetId:m.id,action:'edit',fields:['name'],at:Date.now()}]},adminTarget:m,form:{memberName:bad,memberUsername:bad,memberRole:'member'},resetLink:'</textarea><script>bad()</script>',resetUsername:bad,resetExpiresAt:Date.now()};
  for(const html of [views.admin(state),views.adminEditor(state)]) {assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;img'));}
  assert.ok(views.admin(state).includes('id=id%26other'));
  assert.ok(views.admin(state).includes('href="#/admin"'));
});
