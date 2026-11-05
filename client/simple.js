import * as api from './api';
import {e,button,field,error} from './ui';
import {parts,parseDeadline,hasDuration,taskView} from '../shared/view';
import {shiftDate,calendarPolicy,selectedScope} from '../shared/planner';
import {departmentLabel} from '../shared/departments';
import {matchingParents,simpleEntries,simpleDays,blockLayout,QUARTER} from '../shared/simple-calendar';
import {bindSimpleGestures} from './simple-gestures';

const read=(key,fallback)=>{try{return localStorage.getItem(key)??fallback;}catch{return fallback;}};
const write=(key,value)=>{try{localStorage.setItem(key,value);}catch{}};
const key=()=>`sps-simple:${api.user()?.id||'guest'}`;
const nativeDefault=()=>new URL(location.href).searchParams.get('mode')==='simple';
export const simplePreferred=()=>read(key(),nativeDefault()?'true':'false')==='true';
export const setSimplePreferred=value=>write(key(),String(value));
const localDate=time=>{const p=parts(time);return p.date+'T'+p.time;};
const parseLocal=value=>{const [date,time]=String(value||'').split('T');return parseDeadline(date,time);};
const label=time=>parts(time).time;
const scopeLabel=scope=>scope.startsWith('department:')?departmentLabel(scope.slice(11)):({mine:'我的日程',department:'本部门日程',club:'全社团日程'}[scope]);
export function createSimple({root,getState,render,go,perform,toast,confirmAction}) {
  const ui={date:parts(Date.now()).date,mode:window.matchMedia('(min-width: 800px)').matches?'week':'day',scope:undefined,zoom:20,editor:null,detail:null,account:null,prompt:false,entry:0,owner:null};
  let unbind,scrollTop=null;
  const board=()=>getState().sync.board;
  const state=()=>getState();
  const saveZoom=z=>{ui.zoom=Math.max(10,Math.min(44,z));write(key()+':zoom',String(ui.zoom));};
  async function enter() {
    setSimplePreferred(true);
    ui.owner=api.user()?.id;ui.editor=null;ui.detail=null;ui.account=null;ui.prompt=false;
    ui.zoom=Math.max(10,Math.min(44,Number(read(key()+':zoom','20'))||20));
    const entry=++ui.entry,owner=ui.owner;
    try {const result=await api.accountSettings();if(state().page!=='simple'||entry!==ui.entry||owner!==api.user()?.id)return;ui.account=result.account;ui.prompt=result.account.emailNotificationsEnabled!==false;render();}
    catch(error){if(state().page==='simple'&&entry===ui.entry){state().error='邮件偏好暂未载入，可在账号设置中关闭提醒：'+error.message;render();}}
  }
  function newTask(range) {
    if(board()?.me?.role==='speaker')return;
    const start=range?.startsAt??(ui.date===parts(Date.now()).date?Math.ceil((Date.now()+QUARTER)/QUARTER)*QUARTER:parseDeadline(ui.date,'09:00')); 
    const end=range?.endsAt??start+3600000;
    ui.detail=null;ui.editor={requestId:api.requestId(),major:'',minor:'',start:localDate(start),end:localDate(end),participantIds:[board().me.id],parentTaskId:''};
    state().error='';render();
  }
  function editTask(id) {
    const task=board().tasks.find(t=>t._id===id);if(!task||!taskView(task,board()).canManage)return;
    const parent=task.parentTaskId?board().tasks.find(t=>t._id===task.parentTaskId):null;
    ui.detail=null;ui.editor={id,revision:task.revision,major:parent?.title||task.title,minor:parent?task.title:'',child:!!parent,start:localDate(hasDuration(task)?task.startsAt:task.dueAt),end:localDate(hasDuration(task)?task.endsAt:task.dueAt),participantIds:[...task.participantIds]};
    state().error='';render();
  }
  function editorView(b,s) {
    const f=ui.editor;if(!f)return '';
    const matches=matchingParents(b.tasks,f.major),editing=!!f.id;
    return `<dialog class="simple-dialog" data-simple-dialog aria-labelledby="simple-dialog-title"><form data-form="simpleTask"><header class="row between"><h2 id="simple-dialog-title">${editing?'编辑日程':'新建日程'}</h2>${button('simpleClose','×','simple-icon','aria-label="关闭"')}</header><fieldset ${s.busy?'disabled':''}>
      ${field('simpleMajor','大标题',f.major,'text',`required maxlength="80" list="simple-headings" placeholder="例如：科研分享会" ${f.child?'readonly':''}`)}
      <datalist id="simple-headings">${[...new Set(b.tasks.filter(t=>!t.parentTaskId).map(t=>t.title))].map(title=>`<option value="${e(title)}"></option>`).join('')}</datalist>
      ${!editing||f.child?field('simpleMinor','小标题 · 可留空',f.minor,'text',`maxlength="80" placeholder="例如：预约教室" ${f.child?'required':''}`):''}
      ${!editing&&matches.length>1?`<div class="field"><label for="simpleParent" class="label">选择同名的大标题</label><select id="simpleParent" name="simpleParent" required><option value="">请选择对应日程</option>${matches.map(t=>`<option value="${e(t._id)}" ${f.parentTaskId===t._id?'selected':''}>${e(parts(t.dueAt).date+' '+parts(t.dueAt).time+' · '+(b.members.find(m=>m.id===t.creatorId)?.name||'成员'))}</option>`).join('')}</select></div>`:''}
      ${!editing?`<p class="hint">${f.minor?(matches.length?'会放入已有的「'+e(f.major)+'」下。':'将为「'+e(f.major||'大标题')+'」建立分组。'):'小标题留空，为大标题安排独立日程。'}</p>`:''}
      <div class="simple-time-fields">${field('simpleStart','开始 · 北京时间',f.start,'datetime-local','required step="60"')}${field('simpleEnd','结束 · 北京时间',f.end,'datetime-local','required step="60"')}</div>
      <p class="hint">起止相同为 DDL。只有带持续时段的大标题日程会同步到物院社团预约。</p>
      <div class="field"><span class="label" id="simple-people-label">负责人</span><div class="simple-people" role="group" aria-labelledby="simple-people-label">${b.members.map(m=>`<label><input type="checkbox" name="simplePerson" value="${e(m.id)}" ${f.participantIds.includes(m.id)?'checked':''}><span>${e(m.name)}</span></label>`).join('')}</div></div>
      ${error(s)}<button class="primary full" type="submit">${s.busy?'正在保存…':'保存日程'}</button></fieldset></form></dialog>`;
  }
  function detailView(b,s) {
    const task=b.tasks.find(t=>t._id===ui.detail);if(!task)return '';
    const entry=simpleEntries(b,'club').find(t=>t.taskId===task._id)||simpleEntries(b,'mine').find(t=>t.taskId===task._id);if(!entry)return '';
    const manageable=taskView(task,b).canManage;
    return `<dialog class="simple-dialog" data-simple-dialog aria-labelledby="simple-detail-title"><header class="row between"><h2 id="simple-detail-title">${e(entry.major)}</h2>${button('simpleClose','×','simple-icon','aria-label="关闭"')}</header>${entry.minor?`<h3 class="simple-subtitle">${e(entry.minor)}</h3>`:''}<p class="simple-detail-time">${e(localDate(entry.startsAt).replace('T',' '))}${entry.kind==='deadline'?' · DDL':' — '+e(localDate(entry.endsAt).replace('T',' '))}</p><p class="small">负责人：${e(entry.people)}</p>${error(s)}${manageable?`<footer class="simple-dialog-actions">${button('simpleEdit','编辑','primary',`data-id="${e(task._id)}"`)}${button('simpleArchive','移除日程','plain',`data-id="${e(task._id)}"`)}</footer>`:''}</dialog>`;
  }
  function view(s) {
    const b=s.sync.board;
    if(!b?.club)return `<main class="simple-loading"><h1>SPS 极简日程</h1><p>${s.sync.phase==='error'?e(s.sync.message):'正在载入日程…'}</p>${button('refresh','重新加载','secondary')}<a href="#/entry">选择社团</a></main>`;
    const days=simpleDays(ui.date,ui.mode),entries=simpleEntries(b,ui.scope=selectedScope(b.me,ui.scope)),canCreate=b.me.role!=='speaker';
    const cols=`--days:${days.length};--quarter:${ui.zoom}px`;
    const taskButton=(entry,cls,style='')=>`<button type="button" class="${cls}" data-action="simpleDetail" data-id="${e(entry.taskId)}" style="${style}" aria-label="${e(entry.major+(entry.minor?' · '+entry.minor:'')+'，'+label(entry.startsAt)+(entry.kind==='deadline'?' DDL':' 至 '+label(entry.endsAt))+'，'+entry.people)}"><strong>${e(entry.major)}</strong>${entry.minor?`<span>${e(entry.minor)}</span>`:''}<small>${label(entry.startsAt)}${entry.kind==='deadline'?' · DDL':'–'+label(entry.endsAt)}</small></button>`;
    return `<main class="simple-shell" style="${cols}"><header class="simple-header"><a href="#/simple" class="simple-brand">SPS<span>极简日程</span></a><div class="row">${button('simpleFull','完整模式','plain small')}<a href="#/account" class="simple-settings" aria-label="账号设置">⚙</a></div></header>
    ${ui.prompt?`<aside class="simple-mail" role="status"><div><strong>建议关闭任务邮件提醒</strong><p>极简模式不标记完成。关闭后，你的逾期也不会触发给部门负责人的邮件。</p></div><div class="row">${button('simpleMailOff','关闭提醒','secondary compact',s.busy?'disabled':'')}${button('simpleMailKeep','保留提醒','plain small',s.busy?'disabled':'')}</div></aside>`:''}
    <section class="simple-toolbar" aria-label="日历工具"><div class="row"><button class="simple-icon" type="button" data-action="simpleMove" data-value="-1" aria-label="上一页">‹</button><label class="simple-date-label"><span class="sr-only">选择日期</span><input type="date" name="simpleDate" aria-label="选择日期" value="${ui.date}"></label><button class="simple-icon" type="button" data-action="simpleMove" data-value="1" aria-label="下一页">›</button>${button('simpleToday','今天','secondary compact')}</div><div class="row simple-tools"><select name="simpleScope" aria-label="日程范围">${calendarPolicy(b.me).scopes.map(scope=>`<option value="${scope}" ${scope===ui.scope?'selected':''}>${e(scopeLabel(scope))}</option>`).join('')}</select><select name="simpleMode" aria-label="日历视图">${[['day','日'],['three','3天'],['week','周']].map(([value,name])=>`<option value="${value}" ${ui.mode===value?'selected':''}>${name}</option>`).join('')}</select>${button('simpleZoom','−','simple-icon','data-value="-4" aria-label="缩小时间格"')}${button('simpleZoom','＋','simple-icon','data-value="4" aria-label="放大时间格"')}${canCreate?button('simpleNew','＋ 新建','primary compact'):''}</div></section>
    ${s.error&&!ui.editor&&!ui.detail?error(s):''}<div class="simple-calendar-body"><div class="simple-day-head"><div class="simple-zone">GMT+8</div>${days.map(day=>`<div class="${day.today?'today':''}"><strong>${Number(day.date.slice(5,7))}/${Number(day.date.slice(8))}</strong><span>周${day.weekday}</span></div>`).join('')}</div>
    <section class="simple-deadlines" aria-label="DDL 日程"><div class="simple-ddl-label">DDL</div>${days.map(day=>`<div>${entries.filter(t=>t.kind==='deadline'&&t.startsAt>=day.start&&t.startsAt<day.start+86400000).map(t=>taskButton(t,'simple-ddl')).join('')||'<span class="simple-no-ddl">—</span>'}</div>`).join('')}</section>
    <div class="simple-scroll" data-scroll-key="simple-timeline"><div class="simple-grid"><div class="simple-hours" aria-hidden="true">${Array.from({length:24},(_,i)=>`<span style="top:calc(${i*4} * var(--quarter))">${String(i).padStart(2,'0')}:00</span>`).join('')}</div>${days.map(day=>`<div class="simple-day" data-simple-date="${day.date}" ${canCreate?'tabindex="0" role="group"':''} aria-label="${day.date} 日程${canCreate?'，长按拖动创建；键盘回车创建':''}">${blockLayout(entries,day).map(t=>taskButton(t,'simple-block',`top:calc(${t.start} * var(--quarter));height:calc(${Math.max(1,t.end-t.start)} * var(--quarter) - 2px);left:calc(${t.lane/t.lanes*100}% + 2px);width:calc(${100/t.lanes}% - 4px)`)).join('')}${day.today?`<div class="simple-now" style="top:calc(${(Date.now()-day.start)/QUARTER} * var(--quarter))" aria-hidden="true"></div>`:''}</div>`).join('')}</div></div></div>
    <footer class="simple-foot"><span>${canCreate?'长按拖动建日程 · 双指缩放 · 15分钟一格':'双指缩放 · 15分钟一格'}</span><span>${e(api.syncLabel(s.sync))} ${button('refresh','刷新','plain small')}</span></footer>${editorView(b,s)}${detailView(b,s)}</main>`;
  }
  function beforeRender() {unbind?.();unbind=null;const scroll=root.querySelector('.simple-scroll');if(scroll)scrollTop=scroll.scrollTop;}
  function afterRender() {
    const shell=root.querySelector('.simple-shell');if(!shell)return;
    const scroll=root.querySelector('.simple-scroll');
    if(scroll){scroll.scrollTop=scrollTop??ui.zoom*4*8;unbind=bindSimpleGestures({scroll,shell,getZoom:()=>ui.zoom,setZoom:saveZoom,onCreate:newTask,canCreate:()=>board()?.me.role!=='speaker'});}
    const dialog=root.querySelector('[data-simple-dialog]');if(dialog){dialog.showModal();dialog.addEventListener('cancel',event=>{event.preventDefault();if(!state().busy){ui.editor=null;ui.detail=null;state().error='';render();}});}
  }
  function input(event) {
    const {name,value}=event.target;if(!name?.startsWith('simple'))return false;
    if(name==='simpleDate'&&value&&event.type==='change'){ui.date=value;render();}
    if(name==='simpleMode'&&event.type==='change'){ui.mode=value;render();}
    if(name==='simpleScope'&&event.type==='change'){ui.scope=value;render();}
    if(ui.editor){const f=ui.editor;
      if(name==='simpleMajor'){f.major=value;f.parentTaskId='';}
      if(name==='simpleMinor')f.minor=value;
      if(name==='simpleParent')f.parentTaskId=value;
      if(name==='simpleStart')f.start=value;
      if(name==='simpleEnd')f.end=value;
      if(name==='simplePerson'){f.participantIds=Array.from(root.querySelectorAll('[name="simplePerson"]:checked')).map(el=>el.value);}
      if(['simpleMajor','simpleMinor'].includes(name)&&event.type==='change')render();
    }return true;
  }
  function submit(event) {
    if(event.target.dataset.form!=='simpleTask')return false;
    const f=ui.editor;
    perform(async()=>{
      const input={major:f.major,minor:f.minor,startsAt:parseLocal(f.start),endsAt:parseLocal(f.end),participantIds:f.participantIds,parentTaskId:f.parentTaskId,requestId:f.requestId,taskId:f.id,revision:f.revision,clubId:board().club.id};
      await api.call(f.id?'editSimpleTask':'createSimpleTask',input);
      if(ui.editor===f){ui.editor=null;ui.date=parts(input.startsAt).date;toast('日程已保存');}
    });return true;
  }
  function action(action,value,id) {
    if(!action.startsWith('simple'))return false;
    if(action==='simpleFull'){setSimplePreferred(false);go('/mine');}
    if(action==='simpleEnter'){setSimplePreferred(true);go('/simple');}
    if(action==='simpleNew')newTask();
    if(action==='simpleClose'){ui.editor=null;ui.detail=null;state().error='';render();}
    if(action==='simpleMove'){ui.date=shiftDate(ui.date,Number(value)*(ui.mode==='week'?7:ui.mode==='three'?3:1));render();}
    if(action==='simpleToday'){ui.date=parts(Date.now()).date;render();}
    if(action==='simpleZoom'){const scroll=root.querySelector('.simple-scroll');const ratio=ui.zoom;saveZoom(ui.zoom+Number(value));if(scroll)scroll.scrollTop*=ui.zoom/ratio;render();}
    if(action==='simpleDetail'){ui.detail=id;state().error='';render();}
    if(action==='simpleEdit')editTask(id);
    if(action==='simpleMailKeep'){ui.prompt=false;render();}
    if(action==='simpleMailOff')perform(async()=>{const a=ui.account||(await api.accountSettings()).account;try{const result=await api.setNotifications({revision:a.revision,enabled:false});ui.account=result.account;ui.prompt=false;toast('已关闭邮件提醒');}catch(error){ui.account=null;throw error;}});
    if(action==='simpleArchive')perform(async()=>{const task=board().tasks.find(t=>t._id===id);const count=board().tasks.filter(t=>t.parentTaskId===id).length;if(!await confirmAction('移除这项日程？',count?`「${task.title}」及其下的 ${count} 项日程都会被移除，可由管理员恢复。`:'移除后不再显示，可由管理员恢复。','移除',true))return;await api.call('archiveTask',{taskId:id});ui.detail=null;toast('日程已移除');});
    return true;
  }
  return {enter,view,beforeRender,afterRender,input,submit,action,interacting:()=>!!unbind?.active(),hasDraft:()=>!!ui.editor};
}
