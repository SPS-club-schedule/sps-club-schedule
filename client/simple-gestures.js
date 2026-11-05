import {selectionRange} from '../shared/simple-calendar';

// Touch scrolls normally until a long press starts a block. A second finger
// always cancels creation and switches to anchored vertical zoom.
export function bindSimpleGestures({scroll,shell,getZoom,setZoom,onCreate,canCreate}) {
  const points=new Map(),listeners=[];
  let gesture=null,timer,preview,raf,suppress=false;
  const on=(target,type,fn,options)=>{target.addEventListener(type,fn,options);listeners.push(()=>target.removeEventListener(type,fn,options));};
  const clear=()=>{clearTimeout(timer);cancelAnimationFrame(raf);preview?.remove();preview=null;gesture=null;};
  const coordinate=(day,y)=>Math.max(0,Math.min(95,(y-day.getBoundingClientRect().top)/getZoom()));
  function draw() {
    if(gesture?.type!=='create')return;
    const g=gesture;g.end=coordinate(g.day,g.y);
    const lo=Math.min(Math.floor(g.anchor),Math.floor(g.end)),hi=Math.max(Math.floor(g.anchor),Math.floor(g.end))+1;
    if(!preview){preview=document.createElement('div');preview.className='simple-selection';g.day.append(preview);}
    preview.style.top=`${lo*getZoom()}px`;preview.style.height=`${(hi-lo)*getZoom()}px`;
    const fmt=q=>String(Math.floor(q/4)).padStart(2,'0')+':'+String(q%4*15).padStart(2,'0');
    preview.textContent=`${fmt(lo)} – ${fmt(hi)}`;
  }
  function animate() {
    if(gesture?.type!=='create')return;
    const rect=scroll.getBoundingClientRect(),g=gesture;
    const delta=g.y<rect.top+40?-Math.min(12,(rect.top+40-g.y)/3):g.y>rect.bottom-40?Math.min(12,(g.y-rect.bottom+40)/3):0;
    if(delta){scroll.scrollTop+=delta;draw();}
    raf=requestAnimationFrame(animate);
  }
  function beginCreate() {
    if(gesture?.type!=='pending'||points.size!==1||!gesture.day||!canCreate())return;
    gesture.type='create';suppress=true;draw();raf=requestAnimationFrame(animate);
  }
  on(scroll,'pointerdown',event=>{
    if(event.pointerType==='mouse'&&event.button!==0)return;
    const onTask=!!event.target.closest('button');
    if(onTask&&event.pointerType==='mouse')return;
    const day=onTask?null:event.target.closest('[data-simple-date]');
    points.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(event.pointerType==='mouse')scroll.setPointerCapture(event.pointerId);
    if(points.size===2){
      clear();suppress=true;const [a,b]=[...points.values()],rect=scroll.getBoundingClientRect();
      const center=(a.y+b.y)/2-rect.top;
      gesture={type:'pinch',distance:Math.max(20,Math.hypot(a.x-b.x,a.y-b.y)),zoom:getZoom(),anchor:(scroll.scrollTop+center)/getZoom()};return;
    }
    if(points.size!==1)return;
    suppress=false;
    gesture={type:'pending',day,anchor:day?coordinate(day,event.clientY):0,end:0,y:event.clientY,x:event.clientX,startY:event.clientY,startX:event.clientX,top:scroll.scrollTop,left:scroll.scrollLeft};
    if(event.pointerType==='mouse'){beginCreate();event.preventDefault();}else timer=setTimeout(beginCreate,330);
  });
  on(scroll,'pointermove',event=>{
    if(!points.has(event.pointerId)||!gesture)return;
    event.preventDefault();points.set(event.pointerId,{x:event.clientX,y:event.clientY});
    const g=gesture;
    if(g.type==='pinch'&&points.size>=2){
      const [a,b]=[...points.values()];setZoom(g.zoom*Math.hypot(a.x-b.x,a.y-b.y)/g.distance);shell.style.setProperty('--quarter',getZoom()+'px');
      scroll.scrollTop=g.anchor*getZoom()-((a.y+b.y)/2-scroll.getBoundingClientRect().top);return;
    }
    if(g.type==='pending'&&Math.hypot(event.clientY-g.startY,event.clientX-g.startX)>8){clearTimeout(timer);g.type='scroll';suppress=true;}
    if(g.type==='scroll'){scroll.scrollTop=g.top+g.startY-event.clientY;scroll.scrollLeft=g.left+g.startX-event.clientX;}
    if(g.type==='create'){g.y=event.clientY;draw();}
  },{passive:false});
  const release=(event,cancelled=false)=>{
    if(!points.has(event.pointerId))return;
    points.delete(event.pointerId);clearTimeout(timer);
    const g=gesture;
    if(g?.type==='pinch'){if(!points.size)clear();return;}
    const range=!cancelled&&g?.type==='create'?selectionRange(g.day.dataset.simpleDate,g.anchor,g.end):null;
    clear();if(range)onCreate(range);
  };
  on(scroll,'pointerup',event=>release(event));
  on(scroll,'pointercancel',event=>release(event,true));
  on(scroll,'lostpointercapture',event=>release(event,true));
  on(scroll,'click',event=>{if(suppress){event.preventDefault();event.stopImmediatePropagation();suppress=false;}},true);
  on(scroll,'keydown',event=>{
    if(event.target.matches('[data-simple-date]')&&['Enter',' '].includes(event.key)&&canCreate()){event.preventDefault();onCreate(selectionRange(event.target.dataset.simpleDate,36,39));}
  });
  const dispose=()=>{clear();for(const remove of listeners)remove();points.clear();};
  dispose.active=()=>points.size>0;
  return dispose;
}
