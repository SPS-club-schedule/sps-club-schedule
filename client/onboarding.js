import {tutorialKey,tutorialPreferences,canOfferTutorial,spotlightLayout} from '../shared/onboarding';
import {documentKind} from '../shared/document-rules';
import {resolveParticipants} from '../shared/assignments';

// Every selector points to the normal workspace controls. The guide never submits,
// synthesizes clicks, fills a draft, or creates a server-side task.
const steps=[
  {id:'calendar',page:'board',target:'[data-tour="calendar-open"]',title:'先看安排，再发起任务',text:'这是月历入口：按日期看活动和截止事项。点击高亮的「展开日历」，试试日 / 周视图。全程可跳过，以后从「新手指南」重开。',action:'a[href="#/calendar"]'},
  {id:'planner',page:'calendar',target:'.planner-toolbar',title:'在真实日历中切换日 / 周',text:'试着点「日」或「周」，切换日期或截止范围。活动是时间块，DDL 是截止事项；所有时间均为北京时间。',next:'看看日历导出'},
  {id:'export',page:'calendar',target:'.planner-foot',title:'预约日历与个人日历',text:'「预约总览」打开 club-booking，预约活动也会出现在本站（不含课程）。.ics 导出自己的活动与待办，是当前快照，变化后需重新导出。',next:'认识经验档案'},
  {id:'experience-entry',page:'board',target:'a[href="#/experience"]',title:'经验档案：把经验留给下一届',text:'点击高亮的「经验档案」。这里保存交接资料、活动复盘和学习材料，公开可读，成员共同整理。',action:'a[href="#/experience"]'},
  {id:'experience-search',page:'experience',target:'.experience-search-row input',title:'先找到你需要的经验',text:'在这里搜索文件名、路径或说明，搜索范围包括所有文件夹。清空搜索可以重新浏览目录。',next:'浏览资料'},
  {id:'experience-list',page:'experience',target:'.experience-list',title:'打开文件夹，在线阅读文档',text:'点击文件夹进入目录；Markdown、LaTeX 和文本资料可点「在线阅读」，其他附件可以下载。你也可以用下方按钮打开一份现有文档。',next:'打开一份文档',action:'.experience-list a[href*="document="]'},
  {id:'experience-read',page:'experience',target:'[data-document-preview]',title:'直接在线阅读',text:'这里会渲染 Markdown 的标题、表格和公式。LaTeX 文档用于公式预览；需要完整源文件时，可以下载源码。',next:'看看贡献入口'},
  {id:'experience-contribute',page:'experience',target:'.experience-search-row',title:'上传、整理或新建经验',text:'SPS 成员可以上传资料、新建文件夹或在线新建文档。已上传文档有权限时可编辑正文；仓库文档可另存网页副本。点「新建文档」试用编辑器，或直接继续任务指南。',next:'去发起任务',action:'[data-action="experienceDocumentNew"]'},
  {id:'experience-source',page:'experience',target:'.document-editor-grid > div',writeOnly:true,title:'试写 Markdown 与 LaTeX',text:'在真实编辑器里试写标题、列表或公式，例如 $E=mc^2$。这是未发布的新文档；修改后下一步查看渲染效果。',next:'查看实时预览'},
  {id:'experience-preview',page:'experience',target:'[data-document-preview]',writeOnly:true,title:'实时查看排版与公式',text:'Markdown 和公式会随输入更新。用「上一步」回到源代码继续修改，再回来检查效果；当前内容仍是草稿。',next:'了解保存方式'},
  {id:'experience-save',page:'experience',target:'.document-save-row',writeOnly:true,title:'选择格式、路径，再决定公开',text:'可选择 Markdown、LaTeX 公式或纯文本，并用路径指定目录。「保存并公开」才会发布。指南期间不会保存；继续后会暂存草稿，刷新或关闭页面前返回档案可恢复。',next:'去发起任务'},
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

export function createTutorial({navigate,hasDocumentDraft}) {
  // Create the overlay from the versioned bundle, including for cached older HTML.
  const overlay=document.createElement('div');overlay.id='member-guide';overlay.hidden=true;
  overlay.innerHTML='<div class="guide-shade"></div><div class="guide-shade"></div><div class="guide-shade"></div><div class="guide-shade"></div><div class="guide-outline"></div><section class="guide-coach" role="region" aria-label="新手操作指南"></section>';
  document.body.append(overlay);
  const card=overlay.querySelector('.guide-coach'),outline=overlay.querySelector('.guide-outline'),shades=[...overlay.querySelectorAll('.guide-shade')];
  const preferences=tutorialPreferences(()=>window.localStorage);
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
    index=-1;painted=-1;pendingPage='';target=null;overlay.hidden=true;releaseInert();
    document.body.classList.remove('member-guide-active');
    const focus=returnFocus?.isConnected?returnFocus:document.querySelector('[data-action="tutorial"]');
    focus?.focus({preventScroll:true});
  }
  function findTarget() {
    const step=steps[index];
    const scope=step.child?document.querySelector(`[data-step-panel="${childIndex}"]`):document;
    const selector=step.id==='experience-contribute'&&state.experience?.canWrite?'[data-action="experienceDocumentNew"]':step.target;
    return [...scope?.querySelectorAll(selector)||[]].find(el=>el.getClientRects().length);
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
    const step=steps[index],resume=!!(step.id==='kind'&&state.form.hasDuration||step.id==='add-child'&&state.steps?.[childIndex]);
    const paintKey=index+':'+resume,changed=painted!==paintKey;
    const found=findTarget();
    if(!found) {target=null;releaseInert();overlay.hidden=true;return;}
    if(changed) {
      painted=paintKey;
      card.innerHTML=`<div class="guide-top"><span class="eyebrow">操作指南 · ${index+1} / ${steps.length}</span><button type="button" class="plain small" data-guide="skip">跳过</button></div><h2 tabindex="-1">${step.title}</h2><p>${step.text}</p><div class="guide-actions"><button type="button" class="secondary" data-guide="previous" ${cursor===0?'disabled':''}>上一步</button>${step.next?`<button type="button" class="primary" data-guide="next">${step.next}</button>`:'<span class="guide-prompt">↖ 请操作高亮区域，完成后自动继续</span>'}</div>`;
    }
    if(!step.next&&resume) {
      card.querySelector('.guide-prompt')?.remove();
      if(step.id==='add-child')card.querySelector('p').textContent='这一步已经添加过子任务。点「继续已填写内容」返回原来的子任务，不会重复新增；名称、时间与负责人都会保留。';
      if(!card.querySelector('[data-guide="next"]'))card.querySelector('.guide-actions').insertAdjacentHTML('beforeend','<button type="button" class="primary" data-guide="next">继续已填写内容</button>');
    }
    const next=card.querySelector('[data-guide="next"]');
    if(next&&step.id==='experience-contribute')next.textContent=hasDocumentDraft()?'继续文档草稿':'去发起任务';
    if(next)next.disabled=!!state.busy||(step.page==='experience'&&!state.experience)||!!step.ready&&!step.ready(state,childIndex);
    card.querySelector('[data-guide="previous"]').disabled=cursor===0||!!state.busy;
    target=found;overlay.hidden=false;isolate(target);
    if(changed) {
      target.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
      card.querySelector('h2').focus({preventScroll:true});
    }
    position();schedulePosition();
  }
  function moveTo(nextIndex) {
    index=nextIndex;painted=-1;
    const step=steps[index];
    const directory=['experience-search','experience-list','experience-contribute'].includes(step.id);
    const needsDoc=['experience-read','experience-source','experience-preview','experience-save'].includes(step.id);
    const page=step.page;
    pendingPage=page;
    if(page!==state.page && !(page==='board'&&state.page==='mine')) {
      navigate(page==='experience'&&step.id==='experience-read'?(readUrl||'/experience'):'/'+page,{restoreDocument:!!step.writeOnly});return;
    }
    if(directory&&state.experienceDocument){navigate('/experience');return;}
    if(needsDoc&&!state.experienceDocument){navigate(step.id==='experience-read'?(readUrl||'/experience'):'/experience',{restoreDocument:!!step.writeOnly});return;}
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
    if(step.id==='experience-contribute'&&!fromAction&&!hasDocumentDraft())nextIndex=stepIndex('create');
    if(steps[nextIndex]?.writeOnly&&!canWrite)nextIndex=stepIndex('create');
    history=history.slice(0,cursor+1);history.push(nextIndex);cursor++;
    if(fromAction&&['calendar','create','experience-entry','experience-list'].includes(step.id)){
      index=nextIndex;painted=-1;pendingPage=steps[index].page;target=null;overlay.hidden=true;releaseInert();return;
    }
    moveTo(nextIndex);
  }
  function open(s,accountId) {
    if(active()||document.querySelector('dialog[open]'))return;
    state=s;account=accountId;
    const club=s.sync?.board?.club || s.editBoard?.club;
    key=tutorialKey(accountId,club?.id);
    if(!key)return;
    index=['board','mine'].includes(s.page)?0:s.page==='calendar'?1:s.page==='experience'&&!s.experienceDocument?stepIndex('experience-search'):s.page==='edit'&&!s.id&&!s.parentId?stepIndex('title'):-1;
    if(!active())return;
    returnFocus=document.activeElement;painted=-1;pendingPage='';history=[index];cursor=0;childIndex=(s.steps?.length||0)-1;readUrl='';canWrite=!!s.experience?.canWrite;
    document.body.classList.add('member-guide-active');paint();
  }
  overlay.addEventListener('click',event=>{
    const action=event.target.closest('[data-guide]')?.dataset.guide;
    if(action==='skip')stop();
    if(action==='next')advance();
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
    if(step.id==='publish'&&target?.contains(event.target)){stop(true);return;}
    if(step.action&&event.target.closest(step.action)) {
      if(step.id==='experience-list')readUrl=event.target.closest('a').getAttribute('href').slice(1);
      // New-document initialization awaits the renderer, then update() advances.
      if(step.id==='experience-contribute') {pendingPage='experience';return;}
      advance(true);
    }
  });
  document.addEventListener('submit',event=>{
    if(active()&&(event.target.id==='task-form'||event.target.dataset.form?.startsWith('experience'))){event.preventDefault();event.stopImmediatePropagation();}
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
  let viewportWidth=innerWidth;
  window.addEventListener('resize',()=>{
    if(innerWidth!==viewportWidth){viewportWidth=innerWidth;if(active()){painted=-1;paint();}}
    else schedulePosition();
  });
  document.addEventListener('scroll',schedulePosition,true);
  window.visualViewport?.addEventListener('resize',schedulePosition);
  window.visualViewport?.addEventListener('scroll',schedulePosition);
  return {open,get active(){return active();},update(s,accountId) {
    state=s;account=accountId;
    if(s.experience)canWrite=!!s.experience.canWrite;
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
      pendingPage='';
      if(steps[index].id==='experience-contribute'&&s.experienceDocument?.editing&&!s.busy){advance(true);return;}
      paint();return;
    }
    if(canOfferTutorial(s,accountId)&&!preferences.seen(tutorialKey(accountId,s.sync.board.club.id))&&!document.querySelector('dialog[open],#app form')&&!document.activeElement?.matches('input,textarea,select,[contenteditable="true"]'))open(s,accountId);
  }};
}
