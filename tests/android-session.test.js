const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {buildSync}=require('esbuild');
const source=fs.readFileSync('android/app/src/main/assets/session-bridge.js','utf8');
const SESSION='sps-web-session';
const session=()=>({token:'a'.repeat(64),user:{id:'account-1',username:'test_member'},expiresAt:Date.now()+3600000});
function page(snapshot={},options={}) {
  const messages=[];
  const context=vm.createContext({URL,Response,AbortController,crypto:require('node:crypto').webcrypto,setTimeout,clearTimeout,navigator:{onLine:true},console,fetch:options.fetch});
  vm.runInContext(`
    class Storage { constructor(){this.data=new Map();} getItem(k){return this.data.get(String(k))??null;}
      setItem(k,v){this.data.set(String(k),String(v));} removeItem(k){this.data.delete(String(k));} clear(){this.data.clear();} }
    class HTMLAnchorElement {click(){}}
    var window=globalThis;window.top=window;
    var location={origin:'https://sps-club-schedule.github.io',pathname:'/sps-club-schedule/'};
    var sessionStorage=new Storage(),localStorage=new Storage();
    var document={addEventListener(){}};
    var events={};window.addEventListener=(name,callback)=>{events[name]=callback;};window.dispatchEvent=event=>events[event.type]?.();
  `,context);
  if(options.foreign)context.location.origin='https://example.com';
  if(options.attachment)context.location.pathname='/sps-club-schedule/experience/untrusted.html';
  if(options.frame)context.top={};
  context.SPSNative={postMessage:value=>messages.push(JSON.parse(value))};
  vm.runInContext(source.replace('__SPS_SNAPSHOT__',JSON.stringify(snapshot)),context);
  return {context,messages,run:code=>vm.runInContext(code,context)};
}
test('Android restores login and club before the actual API module initializes',()=>{
  const original=session(); const p=page({session:original,clubId:'club-a'});
  const bundle=buildSync({entryPoints:['client/api.js'],bundle:true,format:'iife',globalName:'api',write:false}).outputFiles[0].text;
  p.run(bundle);
  assert.equal(p.run('api.user().id'),'account-1'); assert.equal(p.run('api.clubId()'),'club-a');
  p.run('api.setClub("club-b")'); assert.equal(p.messages.at(-1).clubId,'club-b');
  const reopened=page(p.messages.at(-1)); reopened.run(bundle);
  assert.equal(reopened.run('api.clubId()'),'club-b');
});
test('real website authentication and successful logout update the native snapshot',async()=>{
  const p=page(); const value=session();
  p.context.fetch=async()=>({ok:true,json:async()=>({ok:true,data:{...value,clubId:'club-a'}})});
  p.run(buildSync({entryPoints:['client/api.js'],bundle:true,format:'iife',globalName:'api',write:false}).outputFiles[0].text);
  await p.run('api.authenticate("login",{username:"test_member",password:"not-persisted"})');
  assert.equal(p.messages.at(-1).session.token,value.token);
  assert.equal(p.messages.at(-1).clubId,'club-a');
  p.context.fetch=async()=>{throw Error('offline');};
  await assert.rejects(p.run('api.logout()')); assert.equal(p.messages.at(-1).session.token,value.token);
  p.context.fetch=async()=>({ok:true,json:async()=>({ok:true,data:{}})});
  await p.run('api.logout()'); assert.equal(p.messages.at(-1).session,null);
  const reopened=page(p.messages.at(-1)); assert.equal(reopened.run(`sessionStorage.getItem('${SESSION}')`),null);
});
test('expiration, malformed data, removal and clear cannot resurrect a saved login',()=>{
  for(const value of [{...session(),expiresAt:1},{...session(),token:'invalid'},null]) {
    const p=page({session:value,clubId:'club-a'}); assert.equal(p.run(`sessionStorage.getItem('${SESSION}')`),null);
    assert.equal(p.messages.at(-1).session,null);
  }
  for(const operation of [`sessionStorage.removeItem('${SESSION}')`,'sessionStorage.clear()']) {
    const p=page({session:session()}); p.run(operation); assert.equal(p.messages.at(-1).session,null);
  }
});
test('snapshot only captures the session allowlist and never localStorage or form data',()=>{
  const p=page(); const value={...session(),password:'secret',user:{...session().user,recoveryCode:'secret'}};
  p.run(`sessionStorage.setItem('${SESSION}',${JSON.stringify(JSON.stringify(value))})`);
  assert.equal(JSON.stringify(p.messages).includes('secret'),false);
  const count=p.messages.length;
  p.run(`localStorage.setItem('${SESSION}','private');sessionStorage.setItem('draft','private')`);
  assert.equal(p.messages.length,count);
});
test('bridge is inert in foreign origins, attachments, and subframes',()=>{
  for(const options of [{foreign:true},{attachment:true},{frame:true}]) {
    const p=page({session:session()},options);
    assert.equal(p.messages.length,0); assert.equal(p.run(`sessionStorage.getItem('${SESSION}')`),null);
  }
});
test('only successful trusted logout clears remembered credentials; failures and unrelated URLs do not',async()=>{
  for(const [url,status,ok,expected] of [
    ['https://sps-schedule.folderrewind.top/auth/logout',200,true,'signedOut'],
    ['https://sps-schedule.folderrewind.top/auth/logout',500,false,undefined],
    ['https://sps-schedule.folderrewind.top/auth/logout',200,false,undefined],
    ['https://example.com/auth/logout',200,true,undefined],
    ['https://sps-schedule.folderrewind.top/auth/recover',200,true,'credentialsChanged']
  ]){
    const p=page({}, {fetch:async()=>new Response(JSON.stringify({ok}),{status})});
    const before=p.messages.length;
    const response=await p.run(`fetch(${JSON.stringify(url)},{method:'POST'})`);
    assert.equal(response.status,status);
    assert.equal(p.messages.length,before+(expected?1:0));
    if(expected)assert.equal(p.messages.at(-1).type,expected);
  }
});
test('password changes clear saved credentials without copying password; invalidation requests native re-login',async()=>{
  const p=page({}, {fetch:async()=>new Response('{"ok":true}')});
  await p.run(`fetch('https://sps-schedule.folderrewind.top/api',{method:'POST',body:JSON.stringify({action:'accountChangePassword',input:{newPassword:'not-sent-to-native'}})})`);
  assert.equal(p.messages.at(-1).type,'credentialsChanged');
  assert.ok(!JSON.stringify(p.messages).includes('not-sent-to-native'));
  p.run(`window.dispatchEvent({type:'sps:logged-out'})`);
  assert.equal(p.messages.at(-1).type,'sessionExpired');
});
test('ordinary website login remembers by default only after success, without a second request',async()=>{
  let requests=0;
  const p=page({}, {fetch:async()=>{requests++;return new Response(JSON.stringify({ok:true,data:{...session(),clubId:'club-a',recoveryCode:'not-native'}}));}});
  p.run(buildSync({entryPoints:['client/api.js'],bundle:true,format:'iife',globalName:'api',write:false}).outputFiles[0].text);
  p.run(`api.configure('https://sps-schedule.folderrewind.top')`);
  await p.run(`api.authenticate('login',{username:'TEST_MEMBER',password:'fictional-password-123'})`);
  assert.equal(requests,1);
  const saved=p.messages.filter(x=>x.type==='webLogin');assert.equal(saved.length,1);
  assert.equal(saved[0].remember,true);assert.equal(saved[0].password,'fictional-password-123');
  assert.equal(saved[0].username,'test_member');assert.equal(saved[0].session.user.id,'account-1');
  assert.ok(!JSON.stringify(saved).includes('not-native'));assert.equal(p.run('api.clubId()'),'club-a');
});
test('failed, malformed, foreign and mismatched authentication never forwards a password',async()=>{
  for(const option of [
    {status:401,ok:false}, {ok:false}, {data:{...session(),token:'bad'}},
    {data:{...session(),user:{id:'other',username:'other_user'}}}, {url:'https://example.com/auth/login'}, {method:'GET'}
  ]){
    const p=page({}, {fetch:async()=>new Response(JSON.stringify({ok:option.ok??true,data:option.data??session()}),{status:option.status??200})});
    await p.run(`fetch(${JSON.stringify(option.url||'https://sps-schedule.folderrewind.top/auth/login')},{method:${JSON.stringify(option.method||'POST')},body:JSON.stringify({username:'test_member',password:'fictional-password-123'})})`);
    assert.equal(p.messages.some(x=>x.type==='webLogin'),false);assert.ok(!JSON.stringify(p.messages).includes('fictional-password'));
  }
});
test('opting out still logs in and explicitly removes saved credentials without forwarding the password',async()=>{
  const p=page({}, {fetch:async()=>new Response(JSON.stringify({ok:true,data:session()}))});
  p.run(`document.querySelector=()=>({checked:false})`);
  await p.run(`fetch('https://sps-schedule.folderrewind.top/auth/login',{method:'POST',body:JSON.stringify({username:'test_member',password:'fictional-password-123'})})`);
  assert.equal(p.messages.at(-1).type,'webLogin');assert.equal(p.messages.at(-1).remember,false);
  assert.ok(!JSON.stringify(p.messages).includes('fictional-password'));assert.ok(!('password' in p.messages.at(-1)));
});
test('opting out while a login is pending prevents its password from being saved',async()=>{
  let finish;const p=page({}, {fetch:()=>new Promise(resolve=>{finish=resolve;})});
  const pending=p.run(`fetch('https://sps-schedule.folderrewind.top/auth/login',{method:'POST',body:JSON.stringify({username:'test_member',password:'fictional-password-123'})})`);
  p.run(`document.querySelector=()=>({checked:false})`);finish(new Response(JSON.stringify({ok:true,data:session()})));await pending;
  assert.equal(p.messages.at(-1).remember,false);assert.ok(!('password' in p.messages.at(-1)));
});
test('registration and recovery save the verified new credential without a later clear message',async()=>{
  for(const path of ['register','recover']){
    const p=page({}, {fetch:async()=>new Response(JSON.stringify({ok:true,data:session()}))});
    await p.run(`fetch('https://sps-schedule.folderrewind.top/auth/${path}',{method:'POST',body:JSON.stringify({username:'test_member',password:'fictional-password-123'})})`);
    assert.equal(p.messages.at(-1).type,'webLogin');assert.equal(p.messages.at(-1).remember,true);
    assert.equal(p.messages.some(x=>x.type==='credentialsChanged'),false);
  }
});
const modeBundle=buildSync({entryPoints:['client/display-mode.js'],bundle:true,format:'iife',globalName:'mode',write:false}).outputFiles[0].text;
test('display mode defaults to simple and persists through web logout and a fresh native document',()=>{
  const fresh=page();fresh.run(modeBundle);assert.equal(fresh.run('mode.simplePreferred()'),true);
  fresh.run('mode.setSimplePreferred(false)');assert.deepEqual(fresh.messages.at(-1),{type:'displayMode',mode:'full'});
  assert.equal(fresh.run('mode.preferredRoute()'),'/mine');
  fresh.run('sessionStorage.clear()');assert.equal(fresh.run('mode.simplePreferred()'),false);
  const reopened=page({displayMode:'full'});reopened.run(modeBundle);
  assert.equal(reopened.run('mode.preferredRoute()'),'/mine');
  reopened.run('mode.setSimplePreferred(true)');assert.deepEqual(reopened.messages.at(-1),{type:'displayMode',mode:'simple'});
  const next=page({displayMode:'simple'});next.run(modeBundle);assert.equal(next.run('mode.preferredRoute()'),'/simple');
});
test('native mode injection and persistence cannot introduce arbitrary routes or cross the bridge boundary',()=>{
  const invalid=page({displayMode:'https://evil.test'});invalid.run(modeBundle);
  assert.equal(invalid.run('mode.preferredRoute()'),'/simple');
  invalid.run("localStorage.setItem('sps-display-mode','javascript:evil')");assert.equal(invalid.messages.some(m=>m.type==='displayMode'),false);
  for(const options of [{foreign:true},{attachment:true},{frame:true}]){
    const p=page({displayMode:'full'},options);p.run("localStorage.setItem('sps-display-mode','full')");assert.equal(p.messages.length,0);
  }
});
