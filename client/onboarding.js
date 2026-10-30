import {tutorialKey,tutorialPreferences,canOfferTutorial,spotlightLayout} from '../shared/onboarding';
import {resolveParticipants} from '../shared/assignments';

// Every selector points to the normal workspace controls. The guide never submits,
// synthesizes clicks, fills a draft, or creates a server-side task.
const steps=[
  {id:'calendar',page:'board',target:'[data-tour="calendar-open"]',title:'先看安排，再发起任务',text:'这是月历入口：按日期看活动和截止事项。点击高亮的「展开日历」，试试日 / 周视图。全程可跳过，以后从「新手指南」重开。',action:'a[href="#/calendar"]'},
  {id:'planner',page:'calendar',target:'.planner-toolbar',title:'在真实日历中切换日 / 周',text:'试着点「日」或「周」，切换日期或截止范围。活动是时间块，DDL 是截止事项；所有时间均为北京时间。',next:'看看日历导出'},
  {id:'export',page:'calendar',target:'.planner-foot',title:'预约日历与个人日历',text:'「预约总览」打开 club-booking，预约活动也会出现在本站（不含课程）。.ics 导出自己的活动与待办，是当前快照，变化后需重新导出。',next:'去发起任务'},
  {id:'create',page:'board',target:'[data-tour="create-task"]',title:'每位成员都能发起任务',text:'点击高亮的「＋ 发布任务」，打开实际编辑区。接下来填写的是未发布草稿，不会自动通知或分配给其他成员。',action:'a[href="#/edit"]'},
  {id:'title',page:'edit',target:'[data-tour="task-title"]',title:'写清楚要做什么',text:'在这里填写任务名称，例如「周六研讨班」。用自己的真实安排练习；任务说明里还可以补充交付要求。',next:'认识 DDL',ready:s=>!!s.form.title?.trim()},
  {id:'kind',page:'edit',target:'[data-tour="schedule-kind"]',title:'DDL 与持续时段有什么不同？',text:'「仅截止时间」表示最晚何时完成，如周五前交海报；「有持续时段」表示活动何时发生。点击「有持续时段」看看实际字段。',action:'[data-action="duration"][data-value="true"]'},
  {id:'duration',page:'edit',target:'[data-tour="duration-range"]',title:'设置活动的开始与结束',text:'在高亮处设置活动时段，例如周六 19:00–21:00。地点可稍后选填；启用预约同步的社团会将这个时段同步到 club-booking。',next:'再看截止时间'},
  {id:'deadline',page:'edit',target:'[data-tour="deadline"]',title:'时段任务也有独立的 DDL',text:'这里仍然是截止时间，默认跟随活动开始。你可以直接修改；修改后，再调整活动时段就不会覆盖这个 DDL。',next:'选择参与成员'},
  {id:'people',page:'edit',target:'[data-tour="task-people"]',title:'确定这件事由谁完成',text:'点击姓名或部门调整参与名单。逐人完成需每个人打勾；协作完成由指定成员中任一人完成即可。名单以发布时为准。',next:'拆分子任务',ready:s=>resolveParticipants(s.form,s.editBoard?.members||[]).length>0},
  {id:'add-child',page:'edit',target:'[data-action="addStep"]',title:'把准备工作拆开分配',text:'点击「＋ 添加一步」，实际添加一项子任务，例如海报、场地或讲义。每项工作都能有自己的负责人和截止时间。',action:'[data-action="addStep"]'},
  {id:'child-title',page:'edit',target:'[data-tour="child-title"]',child:true,title:'为这项子任务命名',text:'填写具体工作，例如「制作海报」。子任务与主任务分别标记完成，全部子任务完成后也要单独确认主任务。',next:'设置子任务 DDL',ready:(s,i)=>!!s.steps[i]?.title?.trim()},
  {id:'child-deadline',page:'edit',target:'[data-tour="child-deadline"]',child:true,title:'单独约定这一步的截止时间',text:'可以按主任务提前几天，也可以点「单独调整日期 / 时间」。这里设置的是 DDL，子任务没有活动时段；请确保截止时间仍在未来。',next:'分配子任务负责人'},
  {id:'child-people',page:'edit',target:'[data-tour="child-people"]',child:true,title:'把这一步交给具体的人',text:'点姓名或部门，给子任务单独指定负责人；也可以跟随主任务名单。发布后，它会进入负责人的「我的待办」和截止日历。',next:'检查发布入口',ready:(s,i)=>!!s.steps[i]&&resolveParticipants(s.steps[i],s.editBoard?.members||[],s.form).length>0},
  {id:'publish',page:'edit',target:'.editor-pane [form="task-form"], .footer [form="task-form"]',title:'确认后，再正式发布',text:'这是实际发布按钮。先完成指南，检查名称、时间与负责人，再决定是否发布。现在没有任何任务被提交；跳过或完成指南都会保留当前草稿。',next:'完成指南'}
];
const focusable='a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]';

export function createTutorial({navigate}) {
  // Create the overlay from the versioned bundle, including for cached older HTML.
  const overlay=document.createElement('div');overlay.id='member-guide';overlay.hidden=true;
  overlay.innerHTML='<div class="guide-shade"></div><div class="guide-shade"></div><div class="guide-shade"></div><div class="guide-shade"></div><div class="guide-outline"></div><section class="guide-coach" role="region" aria-label="新手操作指南"></section>';
  document.body.append(overlay);
  const card=overlay.querySelector('.guide-coach'),outline=overlay.querySelector('.guide-outline'),shades=[...overlay.querySelectorAll('.guide-shade')];
  const preferences=tutorialPreferences(()=>window.localStorage);
  let state,account,key='',index=-1,childIndex=0,target,frame=0,painted=-1,returnFocus,inerted=[],pendingPage='';
  const active=()=>index>=0;
  function releaseInert() { for(const el of inerted)el.inert=false;inerted=[]; }
  function isolate(el) {
    releaseInert();
    for(let branch=el;branch&&branch!==document.body;branch=branch.parentElement) {
      for(const sibling of branch.parentElement?.children||[]) {
        if(sibling!==branch && sibling!==overlay && !sibling.inert && !['SCRIPT','STYLE','LINK'].includes(sibling.tagName)) {sibling.inert=true;inerted.push(sibling);}
      }
    }
  }
  function stop(completed=false,remember=true) {
    if(!active())return;
    if(remember)preferences.dismiss(key,completed);
    index=-1;painted=-1;pendingPage='';target=null;overlay.hidden=true;releaseInert();
    document.body.classList.remove('member-guide-active');
    const focus=returnFocus?.isConnected?returnFocus:document.querySelector('[data-action="tutorial"]');
    focus?.focus({preventScroll:true});
  }
  function findTarget() {
    const step=steps[index];
    const scope=step.child?document.querySelector(`[data-step-panel="${childIndex}"]`):document;
    return [...scope?.querySelectorAll(step.target)||[]].find(el=>el.getClientRects().length);
  }
  function position() {
    if(!active()||!target?.isConnected)return;
    const view=window.visualViewport;
    const viewport={width:view?.width||innerWidth,height:view?.height||innerHeight,left:view?.offsetLeft||0,top:view?.offsetTop||0};
    const layout=spotlightLayout(target.getBoundingClientRect(),viewport,{width:card.offsetWidth,height:card.offsetHeight});
    const box=(el,r)=>Object.assign(el.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});
    box(outline,layout.hole);layout.shades.forEach((r,i)=>box(shades[i],r));
    card.style.left=layout.card.left+'px';card.style.top=layout.card.top+'px';
    card.style.maxHeight=Math.max(120,viewport.height-24)+'px';
  }
  function schedulePosition() {if(!active())return;cancelAnimationFrame(frame);frame=requestAnimationFrame(position);}
  function paint() {
    const step=steps[index],changed=painted!==index;
    const found=findTarget();
    if(!found) {target=null;releaseInert();overlay.hidden=true;return;}
    if(changed) {
      painted=index;
      card.innerHTML=`<div class="guide-top"><span class="eyebrow">操作指南 · ${index+1} / ${steps.length}</span><button type="button" class="plain small" data-guide="skip">跳过</button></div><h2 tabindex="-1">${step.title}</h2><p>${step.text}</p><div class="guide-actions">${step.next?`<button type="button" class="primary" data-guide="next">${step.next}</button>`:'<span class="guide-prompt">↖ 请操作高亮区域，完成后自动继续</span>'}</div>`;
    }
    const next=card.querySelector('[data-guide="next"]');
    if(next)next.disabled=!!step.ready&&!step.ready(state,childIndex);
    target=found;overlay.hidden=false;isolate(target);
    if(changed) {
      target.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
      card.querySelector('h2').focus({preventScroll:true});
    }
    position();schedulePosition();
  }
  function advance() {
    if(!active())return;
    const step=steps[index];
    if(step.ready&&!step.ready(state,childIndex))return;
    if(index===steps.length-1){stop(true);return;}
    if(step.id==='add-child')childIndex=state.steps.length-1;
    index++;painted=-1;
    pendingPage=steps[index].page!==state.page?steps[index].page:'';
    if(step.id==='export'){navigate('/board');return;}
    paint();
  }
  function open(s,accountId) {
    if(active()||document.querySelector('dialog[open]'))return;
    state=s;account=accountId;
    const club=s.sync?.board?.club || s.editBoard?.club;
    key=tutorialKey(accountId,club?.id);
    if(!key)return;
    index=['board','mine'].includes(s.page)?0:s.page==='calendar'?1:s.page==='edit'&&!s.id&&!s.parentId?4:-1;
    if(!active())return;
    returnFocus=document.activeElement;painted=-1;pendingPage='';
    document.body.classList.add('member-guide-active');paint();
  }
  overlay.addEventListener('click',event=>{
    const action=event.target.closest('[data-guide]')?.dataset.guide;
    if(action==='skip')stop();
    if(action==='next')advance();
  });
  document.addEventListener('click',event=>{
    if(!active()||overlay.contains(event.target))return;
    const step=steps[index];
    if(step.id==='publish'&&target?.contains(event.target)){stop(true);return;}
    if(step.action&&event.target.closest(step.action))advance();
  });
  document.addEventListener('submit',event=>{
    if(active()&&event.target.id==='task-form'){event.preventDefault();event.stopImmediatePropagation();}
  },true);
  document.addEventListener('input',()=>{if(active())paint();});
  document.addEventListener('keydown',event=>{
    if(!active())return;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();stop();return;}
    if(event.key==='Enter'&&event.target.matches('#task-form input')){event.preventDefault();return;}
    if(event.key==='Tab') {
      const elements=[...target?.querySelectorAll(focusable)||[],...(target?.matches(focusable)?[target]:[]),...card.querySelectorAll(focusable)].filter(el=>el.getClientRects().length&&!el.disabled&&!el.closest('[inert]'));
      if(!elements.length)return;
      const current=elements.indexOf(document.activeElement),next=current<0?(event.shiftKey?elements.length-1:0):(current+(event.shiftKey?-1:1)+elements.length)%elements.length;
      event.preventDefault();elements[next].focus();
    }
  },true);
  window.addEventListener('resize',schedulePosition);
  document.addEventListener('scroll',schedulePosition,true);
  window.visualViewport?.addEventListener('resize',schedulePosition);
  window.visualViewport?.addEventListener('scroll',schedulePosition);
  return {open,get active(){return active();},update(s,accountId) {
    state=s;account=accountId;
    if(active()) {
      const nextKey=tutorialKey(account,(s.sync?.board?.club||s.editBoard?.club)?.id);
      if(key!==nextKey){stop(false,false);return;}
      // A user's back/forward navigation ends the guide instead of trapping them.
      const expected=steps[index].page;
      const matches=expected==='board'?['board','mine'].includes(s.page):s.page===expected;
      // Navigation clicks update the step before the async route loads its controls.
      if(s.error){stop(false,false);return;}
      if(!matches) {
        const destination=location.hash.slice(2).split('?')[0];
        if(pendingPage&&destination===pendingPage){target=null;overlay.hidden=true;releaseInert();return;}
        stop();return;
      }
      pendingPage='';paint();return;
    }
    if(canOfferTutorial(s,accountId)&&!preferences.seen(tutorialKey(accountId,s.sync.board.club.id))&&!document.querySelector('dialog[open],#app form')&&!document.activeElement?.matches('input,textarea,select,[contenteditable="true"]'))open(s,accountId);
  }};
}
