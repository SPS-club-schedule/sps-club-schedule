import {tutorialKey,tutorialPreferences,canOfferTutorial,spotlightLayout} from '../shared/onboarding';
import {documentKind} from '../shared/document-rules';
import {departmentTutorialKey,canOfferDepartmentTutorial} from '../shared/department-tutorial';
import {isAdmin} from '../shared/permissions';
import {departmentSteps} from './department-tutorial';

import {memberSteps} from './member-tutorial';

const focusable='a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]';

export function createTutorial({navigate,hasDocumentDraft,onDepartmentDismiss=()=>{},onDepartmentExit=()=>{}}) {
  // Create the overlay from the versioned bundle, including for cached older HTML.
  const overlay=document.createElement('div');overlay.id='member-guide';overlay.hidden=true;
  overlay.innerHTML='<div class="guide-shade"></div><div class="guide-shade"></div><div class="guide-shade"></div><div class="guide-shade"></div><div class="guide-outline"></div><section class="guide-coach" role="region" aria-label="新手操作指南"></section>';
  document.body.append(overlay);
  const card=overlay.querySelector('.guide-coach'),outline=overlay.querySelector('.guide-outline'),shades=[...overlay.querySelectorAll('.guide-shade')];
  const preferences=tutorialPreferences(()=>window.localStorage);
  let kind='member',steps=memberSteps,clubId='',startedAccount='';
  const guideKey=(accountId,id)=>kind==='department'?departmentTutorialKey(accountId,id):tutorialKey(accountId,id);
  let state,account,key='',index=-1,childIndex=-1,target,frame=0,painted=-1,returnFocus,inerted=[],pendingPage='',history=[],cursor=0,readUrl='',canWrite=false;
  const stepIndex=id=>steps.findIndex(step=>step.id===id);
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
    const department=kind==='department',dismissedClub=clubId;
    index=-1;painted=-1;pendingPage='';target=null;overlay.hidden=true;releaseInert();
    document.querySelectorAll('[data-guide-target]').forEach(el=>el.removeAttribute('data-guide-target'));
    document.body.classList.remove('member-guide-active');
    const focus=returnFocus?.isConnected?returnFocus:document.querySelector('[data-action="tutorial"]');
    focus?.focus({preventScroll:true});
    if(department){onDepartmentExit({clubId:dismissedClub,accountId:startedAccount,remember});if(remember)onDepartmentDismiss({clubId:dismissedClub,completed});}
  }
  function findTarget() {
    const step=steps[index];
    const panelIndex=step.childIndex??(step.child?childIndex:undefined);
    if(panelIndex!==undefined){
      const panel=document.querySelector(`[data-step-panel="${panelIndex}"]`);
      if(panel){panel.open=true;state.openSteps?.add(panelIndex);}
    }
    const scope=step.childIndex!==undefined?document.querySelector(`[data-step-panel="${step.childIndex}"]`):step.child?document.querySelector(`[data-step-panel="${childIndex}"]`):document;
    const visible=selector=>[...scope?.querySelectorAll(selector)||[]].find(el=>el.getClientRects().length);
    const element=visible(step.target);
    if(element)return {element,content:step};
    const fallback=step.fallback&&visible(step.fallback.target);
    return {element:fallback||null,content:fallback?{...step,...step.fallback}:step,fallback:!!fallback};
  }
  function position() {
    if(!active())return;
    const view=window.visualViewport;
    const viewport={width:view?.width||innerWidth,height:view?.height||innerHeight,left:view?.offsetLeft||0,top:view?.offsetTop||0};
    if(!target?.isConnected){
      outline.hidden=true;shades.forEach((el,i)=>Object.assign(el.style,{left:viewport.left+'px',top:viewport.top+'px',width:i?'0':viewport.width+'px',height:i?'0':viewport.height+'px'}));
      Object.assign(card.style,{left:viewport.left+12+'px',top:viewport.top+12+'px',maxHeight:viewport.height-24+'px'});return;
    }
    outline.hidden=false;
    const rect=target.getBoundingClientRect(),gap=36;
    card.style.maxHeight=Math.max(120,viewport.height-24)+'px';
    // A phone keyboard leaves less vertical room. Scroll the coach instead of
    // shrinking the spotlight away from the input it is explaining.
    if(viewport.left+viewport.width-rect.right<card.offsetWidth+gap&&rect.left-viewport.left<card.offsetWidth+gap){
      const space=Math.max(rect.top-viewport.top-gap,viewport.top+viewport.height-rect.bottom-gap);
      if(space>=100)card.style.maxHeight=Math.min(viewport.height-24,space)+'px';
    }
    const layout=spotlightLayout(rect,viewport,{width:card.offsetWidth,height:card.offsetHeight});
    const box=(el,r)=>Object.assign(el.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});
    box(outline,layout.hole);layout.shades.forEach((r,i)=>box(shades[i],r));
    card.style.left=layout.card.left+'px';card.style.top=layout.card.top+'px';
  }
  function schedulePosition() {if(!active())return;cancelAnimationFrame(frame);frame=requestAnimationFrame(position);}
  function paint(focusCoach=true) {
    const step=steps[index],resume=!!(step.id==='kind'&&state.form.hasDuration||step.id==='add-child'&&state.steps?.[childIndex]);
    const {element:found,content,fallback}=findTarget();
    const paintKey=index+':'+resume+':'+fallback+':'+!!found,changed=painted!==paintKey;
    overlay.dataset.guideStep=step.id;overlay.dataset.guideMissing=String(!found);
    if(changed) {
      painted=paintKey;
      card.innerHTML=`<div class="guide-top"><span class="eyebrow">${kind==='department'?'管理员指南':'操作指南'} · ${index+1} / ${steps.length}</span><button type="button" class="plain small" data-guide="skip">跳过</button></div><h2 tabindex="-1">${content.title}</h2><p>${found?content.text:'当前页面还没有可用的操作控件。可以等待加载后重新定位，或返回上一步、跳过指南。'}</p><div class="guide-actions"><button type="button" class="secondary" data-guide="previous" ${cursor===0?'disabled':''}>上一步</button>${!found?'<button type="button" class="primary" data-guide="retry">重新定位</button>':step.next?`<button type="button" class="primary" data-guide="next">${step.next}</button>`:'<span class="guide-prompt">请操作高亮控件，完成后自动继续</span>'}</div>`;
    }
    if(!step.next&&resume) {
      card.querySelector('.guide-prompt')?.remove();
      if(step.id==='add-child')card.querySelector('p').textContent='这一步已经添加过子任务。点「继续已填写内容」返回原来的子任务，不会重复新增；名称、时间与负责人都会保留。';
      if(!card.querySelector('[data-guide="next"]'))card.querySelector('.guide-actions').insertAdjacentHTML('beforeend','<button type="button" class="primary" data-guide="next">继续已填写内容</button>');
    }
    const next=card.querySelector('[data-guide="next"]');
    if(next&&step.id==='experience-contribute')next.textContent=canWrite&&hasDocumentDraft()?'继续文档草稿':'完成指南';
    if(next)next.disabled=!!state.busy||(step.page==='experience'&&!state.experience)||!!step.ready&&!step.ready(state,childIndex);
    card.querySelector('[data-guide="previous"]').disabled=cursor===0||!!state.busy;
    document.querySelectorAll('[data-guide-target]').forEach(el=>el.removeAttribute('data-guide-target'));
    target=found;target?.setAttribute('data-guide-target',step.id);overlay.hidden=false;isolate(target);
    if(target&&step.interactive===false&&!target.inert){target.inert=true;inerted.push(target);}
    if(changed) {
      target?.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
      if(focusCoach)card.querySelector('h2').focus({preventScroll:true});
    }
    position();schedulePosition();
  }
  function moveTo(nextIndex) {
    index=nextIndex;painted=-1;
    const step=steps[index];
    const directory=['experience-search','experience-list','experience-upload','experience-folder','experience-contribute'].includes(step.id);
    const reading=['experience-read','experience-edit-entry'].includes(step.id);
    const needsDoc=reading||['experience-source','experience-preview','experience-format','experience-path','experience-save'].includes(step.id);
    const page=step.page;
    pendingPage=page;
    if(page!==state.page) {
      navigate(page==='experience'&&reading?(readUrl||'/experience'):'/'+page+(kind==='department'&&['edit','template-edit'].includes(page)?'?guide=department':''),{restoreDocument:!!step.writeOnly});return;
    }
    if(directory&&state.experienceDocument){navigate('/experience');return;}
    if(needsDoc&&!state.experienceDocument){navigate(reading?(readUrl||'/experience'):'/experience',{restoreDocument:!!step.writeOnly});return;}
    pendingPage='';paint();
  }
  function advance(fromAction=false) {
    if(!active()||state.busy)return;
    const step=steps[index];
    if(step.ready&&!step.ready(state,childIndex))return;
    if(index===steps.length-1){stop(true);return;}
    if(step.id==='add-child'&&fromAction)childIndex=state.steps.length-1;
    let nextIndex=index+1;
    if(step.id==='experience-list'&&!readUrl) {
      const item=state.experience?.entries.find(item=>item.kind==='file'&&!item.removed&&documentKind(item.path)&&item.size<=256*1024);
      if(item)readUrl='/experience?document='+encodeURIComponent(item.id);
      else nextIndex=stepIndex('experience-contribute');
    }
    if(step.id==='experience-contribute'&&!fromAction&&(!canWrite||!hasDocumentDraft())){stop(true);return;}
    if(steps[nextIndex]?.writeOnly&&!canWrite)nextIndex=stepIndex('experience-contribute');
    history=history.slice(0,cursor+1);history.push(nextIndex);cursor++;
    if(fromAction&&['create','experience-entry','experience-list'].includes(step.id)){
      index=nextIndex;painted=-1;pendingPage=steps[index].page;target=null;overlay.hidden=true;releaseInert();return;
    }
    moveTo(nextIndex);
  }
  function open(s,accountId,requestedKind='member') {
    if(active()||document.querySelector('dialog[open]'))return;
    state=s;account=accountId;
    const club=s.sync?.board?.club || s.editBoard?.club;
    if(requestedKind==='department'&&!isAdmin((s.sync?.board||s.editBoard)?.me?.role))return;
    if(requestedKind==='member'&&s.guidePractice)return;
    kind=requestedKind;steps=kind==='department'?departmentSteps:memberSteps;clubId=club?.id;startedAccount=accountId;
    card.setAttribute('aria-label',kind==='department'?'管理员指南':'新手操作指南');
    key=guideKey(accountId,clubId);
    if(!key)return;
    index=kind==='department'?0:['mine','board','calendar'].includes(s.page)?stepIndex('todos'):s.page==='experience'&&!s.experienceDocument?stepIndex('experience-search'):s.page==='edit'&&!s.id&&!s.parentId?stepIndex('title'):-1;
    if(!active())return;
    returnFocus=document.activeElement;painted=-1;pendingPage='';history=[index];cursor=0;childIndex=(s.steps?.length||0)-1;readUrl='';canWrite=!!s.experience?.canWrite;
    document.body.classList.add('member-guide-active');
    if(kind==='department'||steps[index].page!==s.page)moveTo(index);else paint();
  }
  overlay.addEventListener('click',event=>{
    const action=event.target.closest('[data-guide]')?.dataset.guide;
    if(action==='skip')stop();
    if(action==='next')advance();
    if(action==='retry'){painted=-1;paint();}
    if(action==='previous'&&cursor>0&&!state.busy){cursor--;moveTo(history[cursor]);}
  });
  document.addEventListener('click',event=>{
    if(active()&&event.target.closest('[data-action="experienceDocumentCancel"]')){stop();return;}
    if(active()&&steps[index].id==='add-child'&&state.steps?.[childIndex]&&event.target.closest('[data-action="addStep"]')){event.preventDefault();event.stopImmediatePropagation();advance();return;}
    if(active()&&steps[index].id==='experience-contribute'&&hasDocumentDraft()&&event.target.closest('[data-action="experienceDocumentNew"]')) {
      event.preventDefault();event.stopImmediatePropagation();advance(true);
    }
  },true);
  document.addEventListener('click',event=>{
    if(!active()||overlay.contains(event.target))return;
    const step=steps[index];
    if(step.action&&event.target.closest(step.action)) {
      if(step.id==='experience-list')readUrl=event.target.closest('a').getAttribute('href').slice(1);
      // New-document initialization awaits the renderer, then update() advances.
      if(step.id==='experience-contribute') {pendingPage='experience';return;}
      advance(true);
    }
  });
  document.addEventListener('submit',event=>{
    if(active()&&(event.target.id==='task-form'||event.target.id==='template-form'||event.target.dataset.form?.startsWith('experience'))){event.preventDefault();event.stopImmediatePropagation();}
  },true);
  document.addEventListener('input',()=>{if(active())paint();});
  document.addEventListener('keydown',event=>{
    if(!active())return;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();stop();return;}
    if(event.key==='Enter'&&event.target.matches('#task-form input,#template-form input')){event.preventDefault();return;}
    if(event.key==='Tab') {
      const elements=[...target?.querySelectorAll(focusable)||[],...(target?.matches(focusable)?[target]:[]),...card.querySelectorAll(focusable)].filter(el=>el.getClientRects().length&&!el.disabled&&!el.closest('[inert]'));
      if(!elements.length)return;
      const current=elements.indexOf(document.activeElement),next=current<0?(event.shiftKey?elements.length-1:0):(current+(event.shiftKey?-1:1)+elements.length)%elements.length;
      event.preventDefault();elements[next].focus();
    }
  },true);
  window.addEventListener('resize',()=>{
    if(active()){painted=-1;paint(false);}
  });
  document.addEventListener('scroll',schedulePosition,true);
  window.visualViewport?.addEventListener('resize',()=>{
    if(active()){target?.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});schedulePosition();}
  });
  window.visualViewport?.addEventListener('scroll',schedulePosition);
  return {open,get active(){return active();},update(s,accountId) {
    state=s;account=accountId;
    if(s.experience)canWrite=!!s.experience.canWrite;
    if(active()) {
      if(s.sync?.board?.me?.role==='speaker'){stop(false,false);return;}
      const nextKey=guideKey(account,(s.sync?.board?.club||s.editBoard?.club)?.id);
      if(kind==='department'&&!isAdmin(s.sync?.board?.me?.role)){stop(false,false);return;}
      if(key!==nextKey){stop(false,false);return;}
      // A user's back/forward navigation ends the guide instead of trapping them.
      const expected=steps[index].page;
      const matches=s.page===expected;
      // Navigation clicks update the step before the async route loads its controls.
      if(s.error){stop(false,false);return;}
      if(!matches) {
        const destination=location.hash.slice(2).split('?')[0];
        if(pendingPage&&destination===pendingPage){target=null;overlay.hidden=true;releaseInert();return;}
        stop();return;
      }
      pendingPage='';
      if(steps[index].id==='experience-contribute'&&s.experienceDocument?.editing&&!s.busy){advance(true);return;}
      paint();return;
    }
    const safe=!document.querySelector('dialog[open],#app form')&&!document.activeElement?.matches('input,textarea,select,[contenteditable="true"]');
    if(safe&&canOfferDepartmentTutorial(s,accountId)&&!preferences.seen(departmentTutorialKey(accountId,s.sync.board.club.id))){open(s,accountId,'department');return;}
    if(safe&&canOfferTutorial(s,accountId)&&!preferences.seen(tutorialKey(accountId,s.sync.board.club.id)))open(s,accountId);
  }};
}
