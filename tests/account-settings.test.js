const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
async function views() {
  const result=buildSync({entryPoints:['client/views.js'],bundle:true,format:'esm',write:false});
  return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}
test('all member roles can discover account settings and edit username or password separately',async()=>{
  const v=await views();
  for(const role of ['member','admin','owner']) {
    const s={sync:{phase:'ready',board:{club:{id:'club',name:'SPS'},members:[{id:'me',name:'Member',role}],me:{id:'me',name:'Member',role}}},account:{username:'my_username'},form:{accountUsername:'my_username'}};
    assert.ok(v.members(s).includes('href="#/account"'));
    const html=v.accountSettings(s);
    assert.ok(html.includes('data-form="accountUsername"')); assert.ok(html.includes('data-form="accountPassword"'));
    assert.ok(html.includes('autocomplete="current-password"')); assert.ok(html.includes('autocomplete="new-password"'));
    assert.ok(!html.includes('adminPassword')); assert.ok(!html.includes('adminDelete'));
  }
  assert.ok(v.entry({form:{},clubs:[],joinMode:'join'}).includes('href="#/account"'));
});
test('account settings escape values and show recovery only after a successful password change',async()=>{
  const v=await views(),bad='<img src=x onerror=alert(1)>',s={sync:{},account:{username:bad},form:{accountUsername:bad,newPassword:bad}};
  const html=v.accountSettings(s); assert.ok(!html.includes('<img')); assert.ok(html.includes('&lt;img')); assert.ok(!html.includes('复制恢复码'));
  s.recovery=bad;
  const recovery=v.accountSettings(s); assert.ok(recovery.includes('密码已更新')); assert.ok(recovery.includes('旧恢复码和重设链接已失效')); assert.ok(!recovery.includes('<img')); assert.ok(!recovery.includes('data-form='));
  assert.ok(v.accountSettings({sync:{},form:{},error:'Offline'}).includes('重新加载账号资料'));
});
