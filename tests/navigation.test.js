const {test}=require('node:test');
const assert=require('node:assert/strict');
const {authDestination,loginRedirect}=require('../shared/navigation');
test('guest calendar is public while full mode and task mutations require login with a safe return route',()=>{
  for(const path of ['/simple','/auth?next=%2Fmine','/reset','/experience'])assert.equal(loginRedirect(path,false),'');
  assert.equal(loginRedirect('/mine',false),'/auth?next=%2Fmine');
  assert.equal(loginRedirect('/calendar',false),'/auth?next=%2Fcalendar');
  assert.equal(loginRedirect('/edit',false),'/auth?next=%2Fmine');
  assert.equal(loginRedirect('/task?id=t_abc&club=c_123',false),'/auth?next=%2Ftask%3Fid%3Dt_abc%26club%3Dc_123');
  for(const path of ['/mine','/edit','/task?id=t_abc&club=c_123'])assert.equal(loginRedirect(path,true),'');
  assert.equal(authDestination('/simple'),'/simple');assert.equal(authDestination('/mine'),'/mine');
  for(const path of ['https://evil.test/simple','//evil.test/mine','javascript:alert(1)','/edit','/task?id=a','/task?id=x%3Cscript&club=c'])assert.equal(authDestination(path),'');
});
