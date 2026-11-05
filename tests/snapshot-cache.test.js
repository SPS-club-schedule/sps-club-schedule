const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createSnapshotCache}=require('../shared/snapshot-cache');
const {createSyncClient}=require('../shared/sync-client');
const {buildSync}=require('esbuild');
const vm=require('node:vm');
const clone=x=>JSON.parse(JSON.stringify(x));
const storage=()=>Object.create({getItem(k){return this[k]??null;},setItem(k,v){this[k]=v;},removeItem(k){delete this[k];}});
const context={namespace:'https://api.test:account-a',clubId:'club-a'};
const board=(version=1,ids=['task-a'])=>({full:true,version,club:{id:'club-a'},me:{id:'member-a',role:'owner'},members:[{id:'member-a',name:'姓名',role:'owner'}],tasks:ids.map(id=>({_id:id,revision:version,title:id,dueAt:1,completions:{}})),templates:[],currentUser:{email:'not-in-cache'},clubs:[],token:'not-in-cache'});
const fixture=()=>{const disk=storage(),cache=createSnapshotCache({storage:()=>disk,now:()=>1000});return {disk,cache};};
const adapter=cache=>({read:c=>cache.readBoard(c),write:(c,b,t)=>cache.writeBoard(c,b,t),remove:c=>cache.removeBoard(c)});
const flush=()=>new Promise(r=>setImmediate(r));
function client(cache,transport,selected=context){return createSyncClient({cache:adapter(cache),context:()=>({...selected}),now:()=>1000,transport,setTimer:()=>1,clearTimer:()=>{}});}

test('confirmed board survives restart, renders before network, and fully revalidates removals and roles',async()=>{
 const {cache}=fixture();const first=client(cache,async()=>board());await first.refresh();
 let release;const pending=new Promise(r=>release=r),calls=[];
 const second=client(cache,async(action,input)=>{calls.push({action,input});return pending;});
 const states=[],stop=second.watch(s=>states.push(clone(s)));await flush();
 assert.equal(states[0].board.tasks[0]._id,'task-a');assert.equal(states[0].cached,true);
 assert.equal(calls[0].action,'bootstrap');assert.equal(calls[0].input.since,undefined);
 release({...board(4,[]),me:{id:'member-a',role:'speaker'},members:[{id:'member-a',role:'speaker'}]});await flush();stop();
 assert.equal(second.getState().cached,false);assert.deepEqual(second.getState().board.tasks,[]);
 const third=client(cache,async()=>{throw Error('offline');});third.setOnline(false);
 assert.equal(third.getState().board.me.role,'speaker');assert.deepEqual(third.getState().board.tasks,[]);
});

test('offline restart and failed sync keep cached data; reconnect refreshes immediately',async()=>{
 const {cache}=fixture();cache.writeBoard(context,board(),900);let calls=0;
 const c=client(cache,async()=>{calls++;if(calls===1)throw Error('network');return board(2,['replacement']);});c.setOnline(false);
 const stop=c.watch(()=>{});await flush();assert.equal(calls,0);assert.equal(c.getState().phase,'offline');
 assert.equal(c.getState().board.tasks.length,1);c.setOnline(true);await flush();assert.equal(calls,1);
 assert.equal(c.getState().phase,'error');assert.equal(c.getState().board.version,1);
 await c.refresh({force:true});assert.equal(c.getState().board.tasks[0]._id,'replacement');stop();
});

test('account/club contexts isolate caches and late old reads cannot populate another account',async()=>{
 const {cache}=fixture();cache.writeBoard(context,board(),900);
 assert.equal(cache.readBoard({...context,namespace:'account-b'}),null);
 assert.equal(cache.readBoard({...context,clubId:'club-b'}),null);
 let release;const selected={...context},c=client(cache,()=>new Promise(r=>release=r),selected);
 const pending=c.refresh();await flush();selected.namespace='account-b';c.select();assert.equal(c.getState().board,null);
 release(board(3));await assert.rejects(pending,{code:'STALE_CONTEXT'});
 assert.equal(cache.readBoard(selected),null);assert.equal(cache.readBoard(context).board.version,1);
});

test('revoked access removes disk data and failed writes never become persisted changes',async()=>{
 const {cache}=fixture();cache.writeBoard(context,board(),900);
 const c=client(cache,async()=>{throw Object.assign(Error('revoked'),{code:'FORBIDDEN'});});
 await assert.rejects(c.refresh());assert.equal(c.getState().board,null);assert.equal(cache.readBoard(context),null);
 const d=client(cache,async action=>{if(action==='bootstrap')return board();throw Error('timeout');});
 await d.refresh();await assert.rejects(d.mutate('complete',{}));assert.deepEqual(cache.readBoard(context).board.tasks[0].completions,{});
});

test('acknowledged edits and archives survive relaunch; only board data is persisted',async()=>{
 const {cache,disk}=fixture();const c=client(cache,async action=>action==='bootstrap'?board():{baseVersion:1,version:2,club:{id:'club-a'},task:{_id:'task-a',revision:2,archived:true}});
 await c.refresh();await c.mutate('archive',{});
 assert.deepEqual(client(cache,async()=>board()).getState().board.tasks,[]);
 assert.doesNotMatch(JSON.stringify(disk),/not-in-cache|currentUser|email|token/);
});

test('public bookings persist independently, replace canceled bookings, and survive private cache cleanup',()=>{
 const {cache}=fixture(),origin='https://booking.test';
 cache.writeBoard(context,board(),900);cache.writeBooking(origin,{from:'2026-11-05',to:'2027-01-05',activities:[{id:'b'}],sync:{private:true}});
 cache.clearPrivate();assert.equal(cache.readBoard(context),null);
 assert.equal(cache.readBooking(origin).activities[0].id,'b');assert.equal(cache.readBooking(origin).sync,undefined);
 assert.equal(cache.readBooking('https://other.test'),null);
 cache.writeBooking(origin,{from:'2026-11-05',to:'2027-01-05',activities:[]});assert.deepEqual(cache.readBooking(origin).activities,[]);
});

test('corrupt, incompatible and unavailable storage never prevents live reads',async()=>{
 const {cache,disk}=fixture();cache.writeBoard(context,board(),900);const key=Object.keys(disk)[0];
 for(const value of ['{','{"schema":2,"savedAt":900}',JSON.stringify({schema:1,savedAt:900,data:{...board(),tasks:null}})]){disk[key]=value;assert.equal(cache.readBoard(context),null);}
 const broken=createSnapshotCache({storage:()=>{throw Error('quota/access');}});
 const c=client(broken,async()=>board());await c.refresh();assert.equal(c.getState().board.version,1);
});

test('App API logout clears private snapshots while browser API never stores them',async()=>{
 for(const bundled of [true,false]){
  const disk=storage(),sessions=storage();sessions.setItem('sps-web-session',JSON.stringify({token:'a'.repeat(64),user:{id:'account-a',username:'cache_test'},expiresAt:Date.now()+60000}));sessions.setItem('sps-web-club:account-a','club-a');
  const ctx={exports:{},localStorage:disk,sessionStorage:sessions,navigator:{onLine:true},AbortController,setTimeout,clearTimeout,window:{dispatchEvent(){}},Event,fetch:async()=>({ok:true,json:async()=>({ok:true,data:board()})})};ctx.module={exports:ctx.exports};
  vm.runInNewContext(buildSync({entryPoints:['client/api.js'],bundle:true,format:'cjs',write:false,define:{__BUNDLED_APP__:String(bundled)}}).outputFiles[0].text,ctx);
  const api=ctx.module.exports;api.configure('https://api.test');await api.bootstrap();assert.equal(Object.keys(disk).length,bundled?1:0);
  await api.logout();assert.equal(Object.keys(disk).length,0);assert.equal(api.sync.getState().board,null);
 }
});

test('booking fetch caches all public sources before filtering and retains them on failure',async()=>{
 const disk=storage(),activities=[{id:'manual',club:'SPS',title:'预约',startsAt:1000,endsAt:2000},{id:'linked',source:'sps-schedule',club:'SPS',title:'任务预约',startsAt:1000,endsAt:2000}];
 const source=buildSync({entryPoints:['client/booking.js'],bundle:true,format:'cjs',write:false,define:{__BUNDLED_APP__:'true'}}).outputFiles[0].text;
 const load=()=>{const ctx={exports:{},localStorage:disk,navigator:{onLine:true},AbortController,setTimeout,clearTimeout,fetch:async()=>({ok:true,json:async()=>({activities,from:'2026-11-05',to:'2027-01-05'})})};ctx.module={exports:ctx.exports};vm.runInNewContext(source,ctx);return {api:ctx.module.exports,ctx};};
 const first=load();assert.equal((await first.api.otherActivities()).activities.length,1);
 const second=load();assert.equal(second.api.cachedActivities().activities.length,2);
 second.ctx.fetch=async()=>{throw Error('offline');};await assert.rejects(second.api.otherActivities());assert.equal(second.api.cachedActivities().activities.length,2);
 second.ctx.fetch=async()=>({ok:true,json:async()=>({activities:[],from:'2026-11-05',to:'2027-01-05'})});await second.api.otherActivities();assert.equal(load().api.cachedActivities().activities.length,0);
});
