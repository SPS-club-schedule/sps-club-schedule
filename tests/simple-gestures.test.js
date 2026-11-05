const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const vm=require('node:vm');
function fixture(){
  let zoom=20,timer,frame;const created=[];
  const listeners=new Map(),style=new Map();
  const scroll={scrollTop:640,scrollLeft:0,getBoundingClientRect:()=>({top:100,bottom:700}),setPointerCapture(){},addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(type){listeners.delete(type);}};
  const day={dataset:{simpleDate:'2026-11-06'},getBoundingClientRect:()=>({top:100-scroll.scrollTop}),append(){}};
  const shell={style:{setProperty:(k,v)=>style.set(k,v)}};
  const ctx={exports:{},document:{createElement:()=>({style:{},remove(){}})},setTimeout:fn=>(timer=fn,1),clearTimeout:()=>timer=null,requestAnimationFrame:fn=>(frame=fn,1),cancelAnimationFrame:()=>frame=null};
  vm.runInNewContext(buildSync({entryPoints:['client/simple-gestures.js'],bundle:true,format:'cjs',write:false}).outputFiles[0].text,Object.assign(ctx,{module:{exports:ctx.exports}}));
  const cleanup=ctx.module.exports.bindSimpleGestures({scroll,shell,getZoom:()=>zoom,setZoom:z=>zoom=Math.max(10,Math.min(44,z)),onCreate:r=>created.push(r),canCreate:()=>true});
  const dispatch=(type,{id=1,x=100,y=200,touch=true,onTask=false}={})=>{let prevented=false;listeners.get(type)?.({pointerId:id,pointerType:touch?'touch':'mouse',button:0,clientX:x,clientY:y,target:{closest:selector=>selector==='button'?(onTask?{}:null):day,matches:()=>false},preventDefault(){prevented=true;},stopImmediatePropagation(){prevented=true;}});return prevented;};
  return {dispatch,created,scroll,style,cleanup,getZoom:()=>zoom,hold:()=>timer?.(),frame:()=>frame?.()};
}
test('touch scroll does not create tasks; long press snaps a block; pointer cancellation creates nothing',()=>{
  const f=fixture();f.dispatch('pointerdown');f.dispatch('pointermove',{y:160});assert.equal(f.scroll.scrollTop,680);f.dispatch('pointerup',{y:160});assert.equal(f.created.length,0);
  f.dispatch('pointerdown',{y:200});f.hold();f.dispatch('pointermove',{y:250});f.dispatch('pointerup',{y:250});assert.equal(f.created.length,1);assert.equal(f.created[0].startsAt%900000,0);assert.equal(f.created[0].endsAt%900000,0);
  f.dispatch('pointerdown');f.hold();f.dispatch('pointercancel');assert.equal(f.created.length,1);assert.equal(f.cleanup.active(),false);f.cleanup();
});
test('two fingers zoom around a fixed time, including on task cards, and never create an accidental block',()=>{
  const f=fixture();f.dispatch('pointerdown',{x:100,y:300,onTask:true});f.dispatch('pointerdown',{id:2,x:100,y:500,onTask:true});
  const anchor=(640+300)/20;
  f.dispatch('pointermove',{id:2,x:100,y:600,onTask:true});assert.equal(f.getZoom(),30);assert.equal(f.scroll.scrollTop,anchor*30-350);assert.equal(f.style.get('--quarter'),'30px');
  f.dispatch('pointerup',{id:1});f.dispatch('pointermove',{id:2,x:100,y:650});f.dispatch('pointerup',{id:2});assert.equal(f.created.length,0);assert.equal(f.cleanup.active(),false);f.cleanup();
});
test('mouse dragging creates a block, a second touch cancels a pending long press, and zoom clamps safely',()=>{
  const f=fixture();f.dispatch('pointerdown',{touch:false,y:220});f.dispatch('pointermove',{touch:false,y:280});f.dispatch('pointerup',{touch:false,y:280});assert.equal(f.created.length,1);
  f.dispatch('pointerdown',{x:100,y:300});f.dispatch('pointerdown',{id:2,x:100,y:400});f.hold();f.dispatch('pointermove',{id:2,x:100,y:1000});assert.equal(f.getZoom(),44);
  f.dispatch('pointercancel');f.dispatch('pointercancel',{id:2});assert.equal(f.created.length,1);f.cleanup();
});
