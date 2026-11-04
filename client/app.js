import * as api from './api';
import * as views from './views';
import { parts, taskView, parseDeadline } from '../shared/view';
import { shiftMonth } from '../shared/calendar';
import { templateDraft, draftDeadline, draftSchedule, MAX_STEPS, MAX_ROLES } from '../shared/templates';
import { draftPlanningFields } from '../shared/backward-schedule';
import { normalizeStepDependencies, canDependOn, removeStep } from '../shared/step-dependencies';
import { isAdmin,isSpeaker } from '../shared/permissions';
import { departmentLabel, invitationToken } from '../shared/departments';
import {resolveGuestNames} from '../shared/guest-assignments';
import { resolveParticipants, chooseDepartment, toggleParticipant, setFollowMain, setRole, removeRole } from '../shared/assignments';
import { scheduleDraft, enableDuration, followStart, followDuration, applyTemplateDuration, changeScheduleField, scheduleFields } from '../shared/schedule-draft';
import { templateDurationForm, templateDurationValue } from '../shared/template-duration';
import {personalCalendar} from '../shared/ical';
import {configureBooking,otherActivities} from './booking';
import {workspace} from './workspace';
import {shiftDate,selectedScope} from '../shared/planner';
import {archivePath,parentPath,MAX_FILE_BYTES} from '../shared/experience';
import {experienceRoute} from './experience';
import {startReleaseUpdates} from './release-updates';
import {createTutorial} from './onboarding';
import {tutorialDrafts,tutorialKey} from '../shared/onboarding';
import {VERSION as DEPARTMENT_GUIDE_VERSION,departmentTutorialKey,departmentPracticeDrafts} from '../shared/department-tutorial';
import {documentKind,documentTemplate,MAX_DOCUMENT_BYTES,documentDirty,readDocument,loadDocumentRenderer,previewDocument} from './experience-document';
const root = document.getElementById('app');
const guideDrafts=tutorialDrafts(),practiceDrafts=departmentPracticeDrafts();
let guideRestoreDocument;
const guideKey=()=>tutorialKey(api.user()?.id,api.clubId());
const practiceKey=()=>departmentTutorialKey(api.user()?.id,api.clubId());
const tutorial=createTutorial({
  hasDocumentDraft:()=>guideDrafts.hasDocument(guideKey()),
  onDepartmentDismiss:({clubId,completed})=>{
    api.call('dismissDepartmentTutorial',{clubId,version:DEPARTMENT_GUIDE_VERSION,status:completed?'completed':'skipped'}).catch(()=>toast('教程状态已记在本机，云端暂未同步'));
  },
  onDepartmentExit:({clubId,accountId,remember})=>{
    practiceDrafts.clear(departmentTutorialKey(accountId,clubId));
    if(remember&&s.guidePractice&&api.clubId()===clubId&&api.user()?.id===accountId)go('/templates');
  },
  navigate:(path,{restoreDocument=false}={})=>{
  guideDrafts.capture(s,guideKey());
  practiceDrafts.capture(s,practiceKey());
  guideRestoreDocument=restoreDocument;
  // The draft was parked above and will be restored on return, not discarded.
  if(s.experienceDocument?.editing)s.experienceDocument=null;
  go(path);
}});
const desktop=window.matchMedia('(min-width: 1000px)');
const workspaceUi={calendarOpen:false,context:'board',clubId:'',planner:{date:parts(Date.now()).date,mode:desktop.matches?'week':'day',showDeadlines:true}};
let stop = null, generation = 0, inviteKey = '', adminLoad = 0;
let activeRouteHash=location.hash,documentPreviewTimer;
let s = { page: 'auth', authMode: 'login', joinMode: 'join', form: {}, sync: api.sync.getState(), filter: 'all', search: '', busy: false, error: '' };
function go(path) { if (location.hash === '#' + path) route(); else location.hash = path; }
function render() {
  const active = document.activeElement, name = active?.getAttribute('name');
  const start = active?.selectionStart, end = active?.selectionEnd;
  const calendarFocus = active?.matches('.deadline-calendar button') ? { action: active.dataset.action, value: active.dataset.value } : null;
  const calendarLink = active?.matches('.calendar-task,.time-block,.deadline-line') ? active.getAttribute('href') : null;
  const panelFocus=active?.closest('.planner') && active.dataset.action?{action:active.dataset.action,value:active.dataset.value}:null;
  const regionScroll=new Map(Array.from(root.querySelectorAll('[data-scroll-key]')).map(el=>[el.dataset.scrollKey,[el.scrollTop,el.scrollLeft]]));
  const plannerScroll=root.querySelector('.planner-scroll');
  const plannerPosition=plannerScroll?[plannerScroll.scrollTop,plannerScroll.scrollLeft]:null;
  const agendaScroll = root.querySelector('.calendar-agenda-list')?.scrollTop;
  const agendaFocus = active?.matches('.calendar-agenda-list');
  const scroll = window.scrollY;
  const html = ['board','mine','calendar'].includes(s.page) ? views.board(s, s.page === 'mine') : ({ auth: views.auth, entry: views.entry, experience:views.experience, task: views.detail, edit: views.editor, members: views.members, templates: views.templates, 'template-edit': views.templateEditor, admin:views.admin, 'admin-edit':views.adminEditor, 'admin-archives':views.archives, reset:views.resetPassword, account:views.accountSettings }[s.page] || views.auth)(s);
  root.innerHTML = workspace(s,html,workspaceUi);
  const editorPage=root.querySelector('.editor-pane .page');if(editorPage)editorPage.dataset.scrollKey=s.page+'-'+(s.id||'new');
  for(const el of root.querySelectorAll('[data-scroll-key]')){const pos=regionScroll.get(el.dataset.scrollKey);if(pos){el.scrollTop=pos[0];el.scrollLeft=pos[1];}}
  const grid=root.querySelector('.planner-scroll');if(grid){grid.scrollTop=plannerPosition?.[0]??480;grid.scrollLeft=plannerPosition?.[1]||0;}
  if (name) {
    const next = root.querySelector(`[name="${CSS.escape(name)}"]`);
    if (next) { next.focus({ preventScroll: true }); if (start != null) next.setSelectionRange(start, end); }
  }
  if (calendarFocus) {
    const next = Array.from(root.querySelectorAll('.deadline-calendar button')).find(el => el.dataset.action === calendarFocus.action && el.dataset.value === calendarFocus.value);
    (next || root.querySelector('[data-action="calendarToday"]'))?.focus({ preventScroll: true });
  }
  if (calendarLink) {
    const next = Array.from(root.querySelectorAll('.calendar-task,.time-block,.deadline-line')).find(el => el.getAttribute('href') === calendarLink);
    (next || root.querySelector('[data-action="calendarToday"]'))?.focus({ preventScroll: true });
  }
  if(panelFocus)Array.from(root.querySelectorAll('.planner [data-action]')).find(el=>el.dataset.action===panelFocus.action&&el.dataset.value===panelFocus.value)?.focus({preventScroll:true});
  const agenda = root.querySelector('.calendar-agenda-list');
  if (agenda) { agenda.scrollTop = agendaScroll || 0; if (agendaFocus) agenda.focus({ preventScroll: true }); }
  window.scrollTo(0, scroll);
  tutorial.update(s,api.user()?.id);
}
function toast(message) {
  const el = document.getElementById('toast'); el.textContent = message; el.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.hidden = true; }, 2400);
}
function confirmAction(title, message, confirmLabel = '确定', dangerous = false) {
  const dialog = document.getElementById('confirm');
  dialog.querySelector('h2').textContent = title; dialog.querySelector('p').textContent = message;
  dialog.querySelector('[value="confirm"]').textContent = confirmLabel;
  dialog.querySelector('[value="confirm"]').className = (dangerous ? 'danger' : 'primary') + ' grow';
  return new Promise(resolve => {
    dialog.returnValue = 'cancel'; dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }); dialog.showModal();
  });
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('已复制'); }
  catch { toast('复制未成功，请长按选中内容复制'); }
}
function inviteLink(token) { const url = new URL(location.href); url.hash = '/auth?invite=' + token; return url.href; }
const adminPage = () => ['admin','admin-edit','admin-archives'].includes(s.page);
function clearAdmin() { adminLoad++; s.adminLoading=false; s.adminData=null; s.archiveData=null; s.adminTarget=null; s.form={}; s.resetLink=''; }
async function loadAccount() {
  const ticket=generation;
  const result=await api.accountSettings();
  if (ticket!==generation) return;
  s.account=result.account; s.form={accountUsername:result.account.username};
}
async function loadAdmin() {
  const ticket=generation, club=s.sync.board?.club;
  if (!adminPage() || !club || !isAdmin(s.sync.board.me.role)) return;
  const load=++adminLoad, archivePage=s.page==='admin-archives';
  s.adminLoading=true;
  try {
    const data=await (archivePage?api.adminArchives(club.id):api.adminMembers(club.id));
    if (ticket!==generation || load!==adminLoad) return;
    if (archivePage) { s.archiveData=data; s.adminDenied=false; return; }
    s.adminData=data; s.adminDenied=false;
    if (s.page==='admin-edit') {
      const target=data.members.find(m=>m.id===s.id);
      if (!target) { s.adminTarget=null; s.form={}; s.resetLink=''; throw new Error('成员不存在，请返回管理页'); }
      if (!s.adminTarget || !target.canEdit || !target.canEditAccount && s.adminTarget.canEditAccount || !target.canDeleteAccount && s.adminTarget.canDeleteAccount) {
        s.adminTarget=target;
        s.form={memberName:target.name,memberRole:target.role,memberUsername:target.username,memberDepartment:target.department || ''};
        s.resetLink='';
      }
    }
  } catch(error) {
    if (ticket!==generation || load!==adminLoad) return;
    if (['FORBIDDEN','UNAUTHENTICATED'].includes(error.code)) { clearAdmin(); s.adminDenied=true; }
    s.error=error.message;
  } finally { if (ticket===generation && (load===adminLoad || s.adminDenied)) { s.adminLoading=false; render(); } }
}
function receive(state) {
  s.sync = state;
  if(isSpeaker(state.board?.me?.role)){
    s.booking=undefined;workspaceUi.calendarOpen=false;
    if(['edit','template-edit','templates','members'].includes(s.page)||adminPage()){s.editBoard=null;go('/mine');return;}
  }
  if(state.board?.club && workspaceUi.clubId!==state.board.club.id){workspaceUi.clubId=state.board.club.id;workspaceUi.planner.scope=undefined;s.booking=undefined;s.bookingCheckedAt=0;}
  const accessKey=state.board?.me?[state.board.club?.id,state.board.me.id,state.board.me.role,state.board.me.department].join(':'):'';
  if(workspaceUi.accessKey!==accessKey){workspaceUi.accessKey=accessKey;workspaceUi.planner.scope=undefined;if(adminPage())clearAdmin();}
  if(state.board?.me)workspaceUi.planner.scope=selectedScope(state.board.me,workspaceUi.planner.scope);
  if ((['board','mine','calendar'].includes(s.page)||workspaceUi.calendarOpen) && state.phase==='ready' && state.board?.club && !s.bookingLoading && Date.now()-(s.bookingCheckedAt || 0)>30000) loadBooking();
  if (s.page==='templates' && s.category && state.board && !(state.board.templates || []).some(t=>t.category===s.category)) s.category='';
  if (state.board && !state.board.club && ['board','mine','calendar','task','members','templates','admin','admin-edit','admin-archives'].includes(s.page)) { go('/entry'); return; }
  if (state.board?.club && !api.clubId()) api.setClub(state.board.club.id);
  if (adminPage()) {
    if (!isAdmin(state.board?.me?.role)) clearAdmin();
    else if (state.phase==='ready' && !s.adminLoading && s.adminCheckedAt!==state.checkedAt) {
      s.adminCheckedAt=state.checkedAt; loadAdmin();
    }
  }
  if (!isAdmin(state.board?.me?.role)) {
    inviteKey = ''; s.invites = null; api.clearInviteCache();
  } else if (s.page === 'members' && state.board?.club && state.phase === 'ready') {
    const key = api.user().id + ':' + state.board.club.id + ':' + state.board.club.inviteVersion;
    if (inviteKey !== key) {
      inviteKey = key; s.invites = null; const ticket = generation;
      api.getInvite(state.board).then(result => { if (ticket === generation && inviteKey === key) { s.invites = result; render(); } }).catch(error => { if (ticket === generation) { inviteKey = ''; s.error = error.message; render(); } });
    }
  }
  render();
}
async function loadBooking() {
  if(isSpeaker(s.sync.board?.me?.role)||s.bookingLoading || !s.sync.board?.club || document.hidden)return;
  const ticket=generation,clubId=s.sync.board.club.id;
  s.bookingLoading=true;s.bookingCheckedAt=Date.now();
  try {
    const [data,status]=await Promise.all([otherActivities(),api.bookingStatus(clubId).catch(()=>null)]);
    if(ticket!==generation)return;
    s.booking={...data,sync:status};
  } catch(error) {if(ticket===generation)s.booking={...s.booking,error:error.message};}
  finally {if(ticket===generation){s.bookingLoading=false;render();}}
}
async function route() {
  const restoreGuideDocument=guideRestoreDocument!==false;guideRestoreDocument=undefined;
  if(documentDirty(s.experienceDocument)&&location.hash!==activeRouteHash) {
    const target=location.hash;
    history.replaceState(null,'',activeRouteHash||'#/experience');
    if(!await confirmAction('离开未保存的文档？','尚未保存的正文会丢失。可取消并先保存或下载源码。','放弃更改并离开'))return;
    s.experienceDocument=null;history.replaceState(null,'',target);
  }
  activeRouteHash=location.hash;
  const ticket = ++generation; if (stop) stop(); stop = null;
  const url = new URL((location.hash.slice(1) || '/board'), 'https://local.invalid');
  const page = url.pathname.slice(1), invitation = url.searchParams.get('invite');
  if (!api.user() && !['auth','reset','experience'].includes(page)) { go('/auth'); return; }
  if (api.user() && page === 'auth') { go(invitation ? '/entry?invite=' + encodeURIComponent(invitation) : url.searchParams.get('next')==='experience'?'/experience':'/board'); return; }
  if(['board','mine','templates'].includes(page))workspaceUi.context=page;
  if(page==='calendar')workspaceUi.calendarOpen=true;
  if(['auth','entry','reset'].includes(page)){workspaceUi.calendarOpen=false;workspaceUi.planner.scope=undefined;}
  s = { page, id: url.searchParams.get('id'), parentId: url.searchParams.get('parent'), selectedTemplate: url.searchParams.get('template') || '', steps: [], openSteps: new Set(), authMode: invitation ? 'register' : 'login', joinMode: 'join', form: { invite: invitation || '', name: 'SPS 社团日程' }, sync: api.sync.getState(), filter: page === 'mine' ? 'pending' : 'all', search: '', busy: false, error: '', requestId: api.requestId(),plannerSettings:workspaceUi.planner,booking:s.booking,bookingCheckedAt:s.bookingCheckedAt,experience:page==='experience'&&s.page==='experience'&&s.experienceViewer===(api.user()?.id||'')?s.experience:undefined,experienceViewer:api.user()?.id||'' };
  s.guidePractice=['edit','template-edit'].includes(page)&&url.searchParams.get('guide')==='department';
  if(s.guidePractice){s.id=null;s.parentId=null;s.selectedTemplate='';}
  s.afterAuth=url.searchParams.get('next')==='experience'?'/experience':'';
  if(page==='experience'){try{s.experiencePath=archivePath(url.searchParams.get('folder')||'',{empty:true});}catch{s.experiencePath='';}s.experienceForm={};s.experienceFiles=[];s.experienceDocumentId=url.searchParams.get('document');}
  if (page==='reset') {
    s.resetToken=url.searchParams.get('token') || ''; s.form={username:url.searchParams.get('username') || ''};
    // Keep the bearer secret out of the URL after reading the reset link.
    history.replaceState(null,'','#/reset');
  }
  inviteKey = ''; window.scrollTo(0,0); render();
  if (['board','mine','calendar','task','members','templates','admin','admin-edit','admin-archives'].includes(page)) { stop = api.sync.watch(receive); return; }
  if (page === 'auth' || page==='reset') return;
  if(page==='experience') {
    if(api.user()){try{await api.bootstrap();if(ticket!==generation)return;s.sync=api.sync.getState();}catch(error){if(ticket!==generation)return;s.error=error.message;}}
    await loadExperience();
    const parked=ticket===generation&&restoreGuideDocument&&!s.experienceDocumentId&&!s.experiencePath?guideDrafts.takeDocument(guideKey()):null;
    if(parked){s.experienceDocument=parked;await loadDocumentRenderer();if(ticket===generation)render();}
    else if(ticket===generation&&s.experienceDocumentId)await perform(async()=>{
      const item=s.experience?.entries.find(x=>x.id===s.experienceDocumentId&&!x.removed);
      if(!item||!documentKind(item.path))throw new Error('此文档不可在线查看，请返回目录刷新或下载文件');
      const doc=await readDocument(item);if(ticket===generation)s.experienceDocument=doc;
    });
    return;
  }
  try {
    if (page==='account') { await loadAccount(); if(ticket===generation) render(); return; }
    const b = await api.bootstrap({ includeClubs: page === 'entry' });
    if (ticket !== generation) return;
    if (page === 'entry') { s.clubs = b.clubs || []; s.form.nickname = b.me?.name || ''; }
    if(isSpeaker(b.me?.role)&&['edit','template-edit'].includes(page)){go('/mine');return;}
    if (page === 'edit') {
      if (!b.club) { go('/entry'); return; }
      const task = s.id ? b.tasks.find(t => t._id === s.id) : null;
      if (s.id && !task) throw new Error('任务不存在或已归档');
      if (task && !taskView(task,b).canManage) throw new Error('你无权修改这项任务');
      const parentId = task?.parentTaskId || s.parentId;
      const parent = parentId ? b.tasks.find(t => t._id === parentId) : null;
      if (parentId && (!parent || parent.parentTaskId)) throw new Error('主任务不存在或已归档');
      if (!task && parent && !taskView(parent,b).canManage) throw new Error('仅主任务发布者或社团创建者可以分配子任务');
      s.parent = parent;
      s.canReassign = !!task?.parentTaskId && !Object.keys(task.completions).length && !task.sharedCompletion;
      const p = parts(task?.dueAt || (parent?.dueAt > Date.now() ? parent.dueAt : Date.now()+86400000));
      s.editBoard = b; s.revision = task?.revision;
      s.form = { title: task?.title || '', description: task?.description || '', date: p.date, time: task || parent ? p.time : '20:00', mode: task?.mode || 'individual', priority: task?.priority || 'normal', guestNames:task?.guestParticipants?.map(person=>person.name).join('\n')||'',allowGuestNames:!!task?.guestParticipants?.length,participantIds: task?.participantIds.slice() || (parent ? [] : b.members.filter(m=>!isSpeaker(m.role)).map(m=>m.id)) };
      Object.assign(s.form,scheduleDraft(task));
      if (!task && !parent && s.selectedTemplate) applyTemplate();
      if(!task&&!parent&&!s.selectedTemplate&&!s.guidePractice)Object.assign(s,guideDrafts.takeTask(guideKey())||{});
      s.steps=normalizeStepDependencies(s.steps);
    }
    if (page === 'template-edit') {
      if (!b.club) { go('/entry'); return; }
      const id=s.guidePractice?null:s.id || url.searchParams.get('copy');
      const template=id ? (b.templates || []).find(t=>t._id===id) : null;
      if (id&&!template) throw new Error('模板不存在或已归档');
      s.revision=template?.revision;
      const draft=template?templateDraft(template,b.members):{title:'',description:'',mode:'individual',priority:'normal',participantIds:[],roles:[],steps:[]};
      s.steps=draft.steps;
      const { steps, ...main }=draft;
      s.form={...main,...templateDurationForm(template?.durationMinutes),name:template?(s.id?template.name:template.name.slice(0,76)+'（副本）'):'',category:template?.category || '未分类'};
      s.editBoard = b;
    }
    if(s.guidePractice) {
      if(!isAdmin(b.me?.role))throw new Error('模板教程仅供管理员进入');
      Object.assign(s,practiceDrafts.restore(page,practiceKey(),b.members));
    }
    render();
    if(['edit','template-edit'].includes(page))stop=api.sync.watch(receive);
  } catch (error) { if (ticket === generation) { s.error = error.message; render(); } }
}
function applyTemplate() {
  const template=(s.editBoard.templates || []).find(t=>t._id===s.selectedTemplate);
  if (!template) throw new Error('请先选择一个模板');
  const draft=templateDraft(template,s.editBoard.members);
  const { steps, ...main }=draft;
  s.form={...s.form,...main,participantIds:main.participantDepartment || main.participantIds.length?main.participantIds:s.editBoard.members.filter(m=>!isSpeaker(m.role)).map(m=>m.id)};
  applyTemplateDuration(s.form,main.durationMinutes);
  s.steps=steps; s.openSteps=new Set(); s.appliedTemplate={id:template._id,name:template.name};
}
const taskFields = f => ({ title:f.title,description:f.description,mode:f.mode,priority:f.priority,participantIds:f.participantIds,participantDepartment:f.participantDepartment || '',guestNames:f.guestNames||'' });
function focusInvalidField(event) {
  const details=event.target.closest('details');
  if (details) { details.open=true; s.openSteps.add(Number(details.dataset.stepPanel)); }
}
root.addEventListener('invalid',focusInvalidField,true);
root.addEventListener('toggle',event=>{
  if (event.target.matches('details[data-archive-item]')) {
    s.archiveOpen ||= new Set();
    const id=event.target.dataset.archiveItem;
    if (event.target.open) s.archiveOpen.add(id); else s.archiveOpen.delete(id);
  }
  if (event.target.matches('details[data-step-panel]')) {
    const index=Number(event.target.dataset.stepPanel);
    if (event.target.open) s.openSteps.add(index); else s.openSteps.delete(index);
  }
},true);
async function perform(work) {
  if (s.busy) return;
  const ticket = generation; s.busy = true; s.error = ''; render();
  try { await work(); }
  catch (error) { if (ticket === generation) { s.error = error.message; render(); root.querySelector('[role="alert"]')?.scrollIntoView({block:'center'}); } }
  finally { if (ticket === generation) { s.busy = false; render(); } }
}
async function loadExperience() {
  const ticket=generation;
  const results=await Promise.allSettled([api.experienceList(),fetch(new URL('./experience-index.json',location.href.split('#')[0]),{cache:'no-store'}).then(async response=>{if(!response.ok)throw new Error('仓库档案暂未载入');return response.json();})]);
  if(ticket!==generation)return;
  const native=results[0].status==='fulfilled'?results[0].value:{entries:[],canWrite:false};
  const repo=results[1].status==='fulfilled'?results[1].value:{entries:[]};
  s.experience={...native,entries:[...(native.entries||[]),...(repo.entries||[])]};
  s.experienceWarning=results.map((r,i)=>r.status==='rejected'?(i===0?'网页上传档案暂未载入：'+r.reason.message:'仓库档案暂未载入，请刷新重试'):'').filter(Boolean).join('；');
  render();
}
function fileBase64(file) {
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('文件读取失败，请重新选择'));reader.readAsDataURL(file);});
}
function submitExperience(kind,event) {
  const ticket=generation,form={...s.experienceForm,...Object.fromEntries(new FormData(event.target))},files=[...(s.experienceFiles||[])],editing=s.experienceEditing,path=s.experiencePath;
  perform(async()=>{
    if(kind==='experienceDocument'){
      const doc=s.experienceDocument,source=doc.source;
      const path=archivePath(doc.path,{file:true});
      if(!documentKind(path))throw new Error('在线文档请使用 .md、.tex 或 .txt 扩展名');
      if(!source.trim())throw new Error('文档内容不能为空');
      if(new TextEncoder().encode(source).length>MAX_DOCUMENT_BYTES)throw new Error('在线文档最多 256 KB');
      const result=doc.newFile?await api.experienceUpload({path,requestId:doc.requestId,content:await fileBase64(new Blob([source]))}):await api.experienceManage({action:'content',id:doc.item.id,revision:doc.item.revision,content:source});
      if(ticket!==generation)return;
      doc.item=result.entry;doc.newFile=false;doc.original=source;doc.path=result.entry.path;doc.baseUrl=api.experienceFileUrl(result.entry.id);
      s.experiencePath=parentPath(doc.path);s.experienceDocumentId=doc.item.id;
      activeRouteHash='#'+experienceRoute(s.experiencePath)+(s.experiencePath?'&':'?')+'document='+encodeURIComponent(doc.item.id);
      history.replaceState(null,'',activeRouteHash);
      await loadExperience();toast('正文已保存并公开');return;
    }
    if(kind==='experienceFolder') {
      const folder=archivePath((path?path+'/':'')+(form.experienceFolder||''));
      await api.experienceManage({action:'folder',path:folder});
      if(ticket===generation){go(experienceRoute(folder));toast('文件夹已创建');}return;
    }
    if(kind==='experienceEdit') {
      await api.experienceManage({action:'edit',id:editing.id,revision:editing.revision,path:form.experienceFullPath,description:form.experienceDescription});
      if(ticket===generation){s.experienceEditing=null;s.experienceForm={};await loadExperience();toast('资料已整理');}return;
    }
    if(!files.length)throw new Error('请先选择文件');
    const folder=archivePath(form.experienceFolder||'',{empty:true});
    for(let i=0;i<files.length;i++) {
      const item=files[i],fullPath=archivePath((folder?folder+'/':'')+item.file.name,{file:true});
      if(!item.file.size||item.file.size>MAX_FILE_BYTES)throw new Error(item.file.name+'：文件不能为空，且最多 10 MB');
      if(ticket===generation){s.experienceProgress=`正在上传 ${i+1} / ${files.length}`;render();}
      try {await api.experienceUpload({path:fullPath,description:form.experienceDescription,requestId:item.requestId,content:await fileBase64(item.file)});}
      catch(error){if(ticket===generation)s.experienceProgress='重试剩余文件';throw error;}
      if(ticket===generation)s.experienceFiles=s.experienceFiles.filter(x=>x.requestId!==item.requestId);
    }
    if(ticket===generation){s.experienceFormMode='';s.experienceForm={};s.experienceProgress='';go(experienceRoute(folder));toast('资料已公开');}
  });
}
async function experienceAction(action,id) {
  if(action.startsWith('experienceDocument')) {
    const doc=s.experienceDocument;
    if(action==='experienceDocumentNew')return perform(async()=>{
      const ticket=generation;await loadDocumentRenderer();if(ticket!==generation)return;
      s.experienceDocument={path:(s.experiencePath?s.experiencePath+'/':'')+'未命名.md',source:documentTemplate('markdown'),original:'',editing:true,newFile:true,requestId:api.requestId()};
    });
    if(!doc)return;
    if(action==='experienceDocumentDownload'){
      const url=URL.createObjectURL(new Blob([doc.source],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=doc.path.split('/').at(-1);a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;
    }
    if(s.busy)return;
    if(action==='experienceDocumentEdit'&&doc.item?.canEdit){doc.editing=true;render();return;}
    if(action==='experienceDocumentCopy'&&s.experience?.canWrite){
      doc.path=doc.path.replace(/\.(md|tex|txt)$/i,'-网页副本.$1');doc.newFile=true;doc.editing=true;doc.requestId=api.requestId();render();return;
    }
    if(['experienceDocumentClose','experienceDocumentCancel'].includes(action)){
      const ticket=generation;
      if(documentDirty(doc)&&!await confirmAction('放弃未保存的更改？','可以取消并先保存，或下载源码保留当前正文。','放弃更改'))return;
      if(ticket!==generation)return;
      if(action==='experienceDocumentCancel'&&!doc.newFile){doc.source=doc.original;doc.editing=false;render();}
      else{s.experienceDocument=null;go(experienceRoute(s.experiencePath));}return;
    }
    return;
  }
  if(action==='experienceRefresh'){perform(loadExperience);return;}
  if(action==='experienceUploadForm'||action==='experienceFolderForm'){s.experienceEditing=null;s.experienceFormMode=action==='experienceUploadForm'?'upload':'folder';s.experienceForm={experienceFolder:action==='experienceUploadForm'?s.experiencePath:''};s.experienceFiles=[];s.experienceProgress='';s.experienceTrash=false;render();return;}
  if(action==='experienceCancel'){s.experienceEditing=null;s.experienceFormMode='';s.experienceForm={};s.experienceFiles=[];render();return;}
  if(action==='experienceTrash'){s.experienceTrash=!s.experienceTrash;s.experienceFormMode='';s.experienceEditing=null;render();return;}
  const item=s.experience?.entries.find(x=>x.id===id);if(!item?.canEdit)return;
  if(action==='experienceEdit'){s.experienceEditing=item;s.experienceFormMode='';s.experienceForm={experienceFullPath:item.path,experienceDescription:item.description};render();root.querySelector('.experience-compose')?.scrollIntoView({block:'start'});return;}
  if(['experienceHide','experienceRestore'].includes(action))perform(async()=>{
    const ticket=generation;
    if(action==='experienceHide'&&!await confirmAction('收起这份资料？','资料将从公开档案中隐藏，你仍可在“已收起资料”中恢复。','收起资料'))return;
    await api.experienceManage({action:action==='experienceHide'?'hide':'restore',id:item.id,revision:item.revision});
    if(ticket===generation){s.experienceEditing=null;await loadExperience();toast(action==='experienceHide'?'资料已收起':'资料已恢复');}
  });
}
function inputChanged(event) {
  if (s.busy) return;
  const { name, value } = event.target;
  if (!name) return;
  if(name.startsWith('experience')) {
    if(name==='experienceDocumentSource'||name==='experienceDocumentPath'||name==='experienceDocumentFormat'){
      const doc=s.experienceDocument;if(!doc?.editing)return;
      if(name==='experienceDocumentFormat'){const template=doc.newFile&&doc.source===documentTemplate(documentKind(doc.path));doc.path=doc.path.replace(/\.[^.\/]*$/, '')+'.'+value;if(template)doc.source=documentTemplate(documentKind(doc.path));render();return;}
      if(name==='experienceDocumentSource')doc.source=value;else doc.path=value;
      const status=root.querySelector('[data-document-status]');if(status)status.textContent=(documentDirty(doc)?'有未保存的更改':'所有更改已保存')+' · 保存后公开可读';
      clearTimeout(documentPreviewTimer);documentPreviewTimer=setTimeout(()=>{
        if(s.experienceDocument!==doc)return;
        const preview=root.querySelector('[data-document-preview]');if(preview)preview.innerHTML=previewDocument(doc);
      },180);return;
    }
    if(name==='experienceSearch'){s.experienceSearch=value;s.experienceTrash=false;render();}
    else if(name==='experienceFiles'){if(event.type==='change'){s.experienceFiles=Array.from(event.target.files||[]).map(file=>({file,requestId:api.requestId()}));s.experienceProgress='';render();}}
    else{s.experienceForm||={};s.experienceForm[name]=value;}
    return;
  }
  if(name.startsWith('planner')) {
    if(name==='plannerDate'&&value)workspaceUi.planner.date=value;
    if(name==='plannerScope')workspaceUi.planner.scope=selectedScope(s.sync.board?.me,value);
    if(name==='plannerDeadlines')workspaceUi.planner.showDeadlines=event.target.checked;
    if(event.type==='change')render();return;
  }
  const {step,field,role}=event.target.dataset;
  if (role!==undefined) {
    if (!s.form.roles?.[Number(role)]) return;
    const key=event.target.dataset.roleField||'name',item=s.form.roles[Number(role)];
    if(key==='coreMember'){item.coreMember=value==='true';item.participantIds=[];item.participantDepartment='';item.guestNames='';}
    else if(['name','guestNames'].includes(key))item[key]=value;
    if (event.type==='change') render();
  } else if (step!==undefined) {
    if (!s.steps[Number(step)]) return;
    if (field==='roleId') setRole(s.steps[Number(step)],value,s.form,s.editBoard.members);
    else s.steps[Number(step)][field]=['daysBefore','estimateDays'].includes(field)&&value!==''?Number(value):value;
    if (field==='daysBefore') s.steps[Number(step)].customDeadline=false;
    if (event.type==='change') render();
  } else if (name==='selectedTemplate') s.selectedTemplate=value;
  else if (name==='inviteDepartment') { s.inviteDepartment=value; render(); }
  else if (name==='templateCategory') { s.category=value; render(); }
  else if(name==='memberDepartment'){s.form.memberDepartment=value;if(value==='speaker')s.form.memberRole='speaker';else if(s.form.memberRole==='speaker')s.form.memberRole='member';render();}
  else if(name==='memberRole'){s.form.memberRole=value;if(value==='speaker')s.form.memberDepartment='speaker';else if(s.form.memberDepartment==='speaker')s.form.memberDepartment='';render();}
  else if (name === 'search') { if(['edit','template-edit','calendar'].includes(s.page))s.contextSearch=value;else s.search = value; api.sync.touch(); render(); }
  else { changeScheduleField(s.form,name,value); if(event.type==='change'&&['date','time','startDate','startTime','endDate','endTime'].includes(name)) render(); }
}
root.addEventListener('input', inputChanged);
root.addEventListener('change', inputChanged);
root.addEventListener('submit', event => {
  event.preventDefault(); const kind = event.target.dataset.form;
  if(isSpeaker(s.sync.board?.me?.role)&&['task','template'].includes(kind)){toast('主讲人只能查看并完成分配给自己的任务');return;}
  if(s.guidePractice&&['task','template'].includes(kind)){toast('这是本地练习，请返回模板库后正式创建');return;}
  if(kind?.startsWith('experience')){submitExperience(kind,event);return;}
  const data = { ...s.form, ...Object.fromEntries(new FormData(event.target)) };
  perform(async () => {
    if (kind === 'auth') {
      const result = await api.authenticate(s.authMode, { ...data, mode: s.joinMode });
      s.form.password = ''; s.form.recoveryCode = '';
      if (result.recoveryCode) { s.recovery = result.recoveryCode; render(); }
      else go(data.invite ? '/entry?invite='+encodeURIComponent(data.invite) : s.afterAuth||'/board');
    }
    if (kind==='resetPassword') {
      if (data.password!==data.confirmPassword) throw new Error('两次输入的密码不一致');
      const result=await api.authenticate('recover',{username:data.username,password:data.password,resetToken:s.resetToken});
      s.form={}; s.resetToken=''; s.recovery=result.recoveryCode;
    }
    if (kind==='accountUsername' || kind==='accountPassword') {
      if (!s.account) throw new Error('请先重新加载账号资料');
      if (kind==='accountPassword' && data.newPassword!==data.confirmPassword) throw new Error('两次输入的新密码不一致');
      const ticket=generation;
      const result=kind==='accountUsername'
        ? await api.changeUsername({revision:s.account.revision,username:data.accountUsername,currentPassword:data.usernamePassword})
        : await api.changePassword({revision:s.account.revision,currentPassword:data.currentPassword,newPassword:data.newPassword});
      if (ticket!==generation) return;
      s.account=result.account; s.form={accountUsername:result.account.username};
      if (result.recoveryCode) { s.recovery=result.recoveryCode; render(); window.scrollTo(0,0); }
      else toast('用户名已保存，请使用新用户名登录');
    }
    if (kind==='adminMember') {
      const target=s.adminTarget;
      if (!target?.canEdit) throw new Error('没有管理这位成员的权限');
      const result=await api.call('adminEditMember',{clubId:s.sync.board.club.id,memberId:target.id,memberVersion:target.syncVersion,accountRevision:target.accountRevision,name:data.memberName,role:data.memberRole,department:data.memberDepartment,...(target.canEditAccount?{username:data.memberUsername}:{}),...(data.adminPassword?{adminPassword:data.adminPassword}:{})});
      s.form.adminPassword=''; s.adminTarget=result.adminMember; go('/admin'); toast('成员资料已保存');
    }
    if (kind === 'club') {
      const result = await api.call(s.joinMode==='create'?'createClub':'joinClub', { nickname: data.nickname, name: data.name, token: data.invite.trim(), requestId: s.requestId });
      api.setClub(result.clubId); go('/board'); if (result.department) toast('已加入'+departmentLabel(result.department));
    }
    if (kind === 'task') {
      if (data.hasDuration && data.endFollowsDuration) followDuration(data);
      if (data.hasDuration && data.deadlineFollowsStart) followStart(data);
      const group=!s.id&&!s.parent&&s.steps.length>0;
      const plan=group?draftSchedule(data,s.steps):[];
      const subtasks=group?s.steps.map((step,index)=>{
        if (!resolveParticipants(step,s.editBoard.members,data).length&&!resolveGuestNames(step,data).length) { s.openSteps.add(index); throw new Error(step.roleId?`请为角色「${data.roles.find(role=>role.id===step.roleId)?.name || '未命名'}」选择负责人`:`请为子任务${index+1}「${step.title}」选择负责人`); }
        const dueAt=plan[index].dueAt;
        if(dueAt<=Date.now()) { s.openSteps.add(index); throw new Error(`子任务${index+1}「${step.title}」的截止时间已过，请调整日期或提前天数`); }
        if(data.schedulingMode==='backward'&&plan[index].startAt<Date.now()) {s.openSteps.add(index);throw new Error(`「${step.title}」按预计耗时需在过去开始，请调迟主任务或调整计划`);}
        return {...taskFields(step),...draftPlanningFields(step,data.schedulingMode==='backward'),id:step.id,dependsOn:step.dependsOn || [],roleId:step.roleId || '',followMain:step.followMain === true,daysBefore:step.daysBefore,...(step.customDeadline?{dueAt:parseDeadline(step.date,step.time)}:{})};
      }):undefined;
      const result = await api.call(s.id?'editTask':group?'createTaskGroup':'createTask', { ...taskFields(data), ...scheduleFields(data), clubId: s.editBoard.club.id, parentTaskId: s.parent?._id, taskId: s.id, revision: s.revision, requestId: s.requestId, ...(group?{subtasks,schedulingMode:data.schedulingMode || 'independent',roles:(data.roles || []).map(role=>({id:role.id,name:role.name,coreMember:role.coreMember!==false,guestNames:role.guestNames||'',participantIds:role.participantIds,participantDepartment:role.participantDepartment || ''})),templateId:s.appliedTemplate?.id}:{}) });
      go('/task?id='+encodeURIComponent(result.taskId));
    }
    if (kind === 'template') {
      await api.call(s.id?'editTemplate':'createTemplate',{...taskFields(data),schedulingMode:data.schedulingMode || 'independent',durationMinutes:templateDurationValue(data),name:data.name,category:data.category,roles:(data.roles || []).map(role=>({id:role.id,name:role.name,coreMember:role.coreMember!==false})),steps:s.steps.map(step=>({...taskFields(step),...draftPlanningFields(step,data.schedulingMode==='backward'),id:step.id,dependsOn:step.dependsOn || [],roleId:step.roleId || '',followMain:step.followMain === true,daysBefore:step.daysBefore})),clubId:s.editBoard.club.id,templateId:s.id,revision:s.revision,requestId:s.requestId});
      go('/templates'); toast('共享模板已保存');
    }
    if (kind === 'name') { await api.call('renameMe', { clubId: s.sync.board.club.id, name: data.nickname }); s.form.nickname = undefined; toast('称呼已更新'); }
  });
});
root.addEventListener('click', event => {
  const el = event.target.closest('[data-action]'); if (!el || el.disabled) return;
  const { action, value, id } = el.dataset;
  if (s.busy) return;
  if(action==='tutorial'){tutorial.open(s,api.user()?.id);return;}
  if(action==='departmentTutorial'){practiceDrafts.clear(practiceKey());tutorial.open(s,api.user()?.id,'department');return;}
  if(action.startsWith('experience')){experienceAction(action,id);return;}
  if(action==='closePlanner'){workspaceUi.calendarOpen=false;if(s.page==='calendar')go('/'+(workspaceUi.context==='mine'?'mine':'board'));else render();return;}
  if(action==='plannerMove'){workspaceUi.planner.date=shiftDate(workspaceUi.planner.date,Number(value)*(workspaceUi.planner.mode==='day'?1:7));render();return;}
  if(action==='plannerToday'){workspaceUi.planner.date=parts(Date.now()).date;render();return;}
  if(action==='plannerMode'){workspaceUi.planner.mode=value==='day'?'day':'week';render();return;}
  if(action==='plannerDay'){workspaceUi.planner.date=value;workspaceUi.planner.mode='day';render();return;}
  if (action==='duration') { enableDuration(s.form,value==='true'); render(); return; }
  if (action==='templateDuration') { s.form.templateHasDuration=value==='true'; render(); return; }
  if (action==='schedulingMode'&&['independent','backward'].includes(value)) {s.form.schedulingMode=value;render();return;}
  if (action==='followDuration') { perform(async()=>followDuration(s.form)); return; }
  if (action==='followStart') { followStart(s.form); render(); return; }
  if (action==='applyTemplate') {
    perform(async()=>{
      if ((s.form.title || s.steps.length) && !await confirmAction('套用这个模板？','将替换当前草稿的名称、说明、分工、默认时长和子任务，沿用已选择的开始或截止时间。')) return;
      applyTemplate();
    }); return;
  }
  if (action==='addRole') {
    s.form.roles ||= [];
    if (s.form.roles.length<MAX_ROLES) s.form.roles.push({id:api.requestId(),name:'',coreMember:true,guestNames:'',participantIds:[],participantDepartment:''});
    render(); root.querySelector(`[name="role-${s.form.roles.length-1}-name"]`)?.focus(); return;
  }
  if (action==='removeRole') { removeRole(s.form,s.steps,id,s.editBoard.members); render(); return; }
  if (action==='roleParticipant' || action==='roleDepartment') {
    const role=s.form.roles?.[Number(el.dataset.index)];
    if (!role) return;
    const roster=s.editBoard.members.filter(member=>role.coreMember===false?isSpeaker(member.role):!isSpeaker(member.role));
    if (action==='roleParticipant') toggleParticipant(role,id,roster);
    else chooseDepartment(role,value,roster);
    render(); return;
  }
  if (['addStep','removeStep','stepUp','stepDown','stepDependency','stepAnchor','stepParticipant','stepDepartment','stepFollow','stepCustom','stepRelative','assignStepsToMe'].includes(action)) {
    const index=Number(el.dataset.index), step=s.steps[index];
    if(action==='addStep'&&s.steps.length<MAX_STEPS) { s.steps.push({id:api.requestId(),dependsOn:[],title:'',description:'',estimateDays:'',anchorToMain:s.form.schedulingMode!=='backward',daysBefore:1,mode:'individual',priority:'normal',participantIds:[],customDeadline:false}); s.openSteps.add(s.steps.length-1); }
    if(action==='stepAnchor'&&step) {
      step.anchorToMain=value==='true';step.customDeadline=false;
      if(!step.anchorToMain&&(!Number.isInteger(step.daysBefore)||step.daysBefore<0||step.daysBefore>365))step.daysBefore=0;
    }
    if(action==='removeStep') { removeStep(s.steps,index); s.openSteps=new Set(); }
    if(action==='stepDependency'&&step&&s.steps.some(item=>item.id===id)) {
      if(step.dependsOn?.includes(id)) step.dependsOn=step.dependsOn.filter(ref=>ref!==id);
      else if(canDependOn(s.steps,step.id,id)) step.dependsOn=[...(step.dependsOn || []),id];
    }
    if(action==='stepUp'||action==='stepDown') {
      const target=index+(action==='stepUp'?-1:1);
      if(target>=0&&target<s.steps.length) { [s.steps[index],s.steps[target]]=[s.steps[target],s.steps[index]]; s.openSteps=new Set([target]); }
    }
    if(action==='stepParticipant') toggleParticipant(step,id,s.editBoard.members,s.form);
    if(action==='stepDepartment') chooseDepartment(step,value,s.editBoard.members);
    if(action==='stepFollow') {
      if(value==='role' && s.form.roles?.length) setRole(step,step.roleId || s.form.roles[0].id,s.form,s.editBoard.members);
      else setFollowMain(step,value==='main',s.form,s.editBoard.members);
    }
    if(action==='assignStepsToMe') for(const item of s.steps) { item.participantIds=[s.editBoard.me.id]; item.participantDepartment=''; item.followMain=false; item.roleId=''; item.guestNames=''; }
    if(action==='stepRelative') step.customDeadline=false;
    if(action==='stepCustom') {
      try { const p=parts(draftDeadline(s.form,step,s.steps)); Object.assign(step,{date:p.date,time:p.time,customDeadline:true}); }
      catch(error) { s.error=error.message; }
    }
    render(); return;
  }
  if (action === 'reload') { location.reload(); return; }
  if (action==='locationMode') {s.form.hasLocation=value==='true';render();return;}
  if (action==='refreshBooking') {loadBooking();return;}
  if (action==='exportCalendar') {
    const result=personalCalendar(s.sync.board);
    if(!result.count){toast('当前没有需要导出的个人日程');return;}
    const blob=new Blob([result.text],{type:'text/calendar;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='SPS-我的日程-'+parts(Date.now()).date+'.ics';document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);toast('已导出 '+result.count+' 项个人日程，可导入系统日历');return;
  }
  if (action === 'authMode') { s.authMode = value; s.error = ''; render(); return; }
  if (action === 'joinMode') { s.joinMode = value; s.error = ''; render(); return; }
  if (action === 'filter') { if(['edit','template-edit','calendar'].includes(s.page))s.contextFilter=value;else s.filter = value; api.sync.touch(); render(); return; }
  if (action.startsWith('calendar')) {
    const today = parts(Date.now()).date;
    s.calendar ||= { month: today.slice(0,7), date: '' };
    if (action === 'calendarMonth') s.calendar = { month: shiftMonth(s.calendar.month, Number(value)), date: '' };
    if (action === 'calendarToday') s.calendar = { month: today.slice(0,7), date: today };
    if (action === 'calendarDate') s.calendar = { month: value.slice(0,7), date: s.calendar.date === value ? '' : value };
    if (action === 'calendarClear') s.calendar.date = '';
    const agenda = root.querySelector('.calendar-agenda-list'); if (agenda) agenda.scrollTop = 0;
    api.sync.touch(); render(); return;
  }
  if (action === 'mode' || action === 'priority') { s.form[action] = value; render(); return; }
  if (action === 'department') { chooseDepartment(s.form,value,s.editBoard.members); render(); return; }
  if (action === 'participant') { toggleParticipant(s.form,id,s.editBoard.members); render(); return; }
  if (action === 'allMembers') { const ids=resolveParticipants(s.form,s.editBoard.members),core=s.editBoard.members.filter(m=>!isSpeaker(m.role));s.form.participantIds = core.length===ids.length&&core.every(m=>ids.includes(m.id)) ? [] : core.map(m=>m.id);s.form.participantDepartment=''; render(); return; }
  if (action === 'chooseClub') { api.setClub(id); go('/board'); return; }
  if (action === 'continue') { s.recovery = ''; go('/board'); return; }
  if (action === 'copyRecovery') { copy(s.recovery); return; }
  if (action === 'archiveType' && ['tasks','templates'].includes(value)) { s.archiveType=value; s.search=''; render(); return; }
  if (action === 'accountRecoverySaved') { s.recovery=''; render(); window.scrollTo(0,0); return; }
  if (action === 'copyReset') { copy(s.resetLink); return; }
  if (['copyInvite','share','rotateInvite'].includes(action) && !isAdmin(s.sync.board?.me?.role)) return;
  if (action === 'copyInvite') { const token=invitationToken(s.invites,s.inviteDepartment); if(token) copy(token); return; }
  if (action === 'share') {
    const token=invitationToken(s.invites,s.inviteDepartment); if(!token) return;
    const url = inviteLink(token);
    if (navigator.share) navigator.share({ title: '邀请你加入 '+s.sync.board.club.name+(s.inviteDepartment?' · '+departmentLabel(s.inviteDepartment):''), url }).catch(error => { if (error.name!=='AbortError') copy(url); });
    else copy(url);
    return;
  }
  perform(async () => {
    if (action==='restoreTask' || action==='restoreTemplate') {
      if (!isAdmin(s.sync.board?.me?.role)) throw new Error('仅管理员可以恢复归档内容');
      const template=action==='restoreTemplate', type=template?'templates':'tasks', target=s.archiveData?.[type].find(t=>t._id===id);
      if (!target) throw new Error('归档内容已更新，请刷新后重试');
      if (!template && (target.parentArchived || target.parentMissing)) throw new Error('请先恢复主任务，再恢复这项子任务');
      const ticket=generation, clubId=s.sync.board.club.id;
      const message=template?`将“${target.name}”恢复到模板库，保留原内容和默认设置。已发布的任务保持不变。`:`将“${target.title}”恢复到任务看板${target.restoreChildCount?'，并一并恢复 '+target.restoreChildCount+' 项子任务':''}。原分工、截止时间和完成记录保留，已过期的未完成任务会显示为逾期。`;
      if (!await confirmAction(template?'恢复这个模板？':'恢复这项任务？',message,'确认恢复')) return;
      const result=await api.call(template?'adminRestoreTemplate':'adminRestoreTask',{clubId,revision:target.revision,...(template?{templateId:id}:{taskId:id})});
      if (ticket!==generation || !s.archiveData || !isAdmin(s.sync.board?.me?.role)) return;
      const ids=new Set(template?[result.template._id]:result.tasks.map(t=>t._id));
      // Remove acknowledged restores even if a following refresh loses network.
      s.archiveData[type]=s.archiveData[type].filter(t=>!ids.has(t._id)).map(t=>ids.has(t.parentTaskId)?{...t,parentArchived:false}:t);
      await loadAdmin(); toast(template?'模板已恢复到模板库':'任务已恢复，原分工和完成记录已保留');
    }
    if (action === 'reloadAccount') { await loadAccount(); toast('账号资料已更新'); }
    if (action === 'refresh') { await api.bootstrap({ force: true }); if(adminPage()&&!s.adminLoading) await loadAdmin(); }
    if (action==='adminDelete') {
      const target=s.adminTarget, clubId=s.sync.board.club.id, adminPassword=s.form.adminPassword;
      if (!target?.canDeleteAccount) throw new Error(target?.deleteAccountRestriction || '没有删除此账号的权限');
      if (!adminPassword) throw new Error('请先填写你自己的密码以确认操作');
      if (!await confirmAction('永久删除这个账号？',`将删除 ${target.name}（@${target.username}）的登录账号并移出成员列表，所有登录与恢复方式立即失效。已有任务、分工和完成记录会保留，历史姓名显示为“已离开的成员”。此操作不能撤销。`,'永久删除账号',true)) return;
      await api.call('adminDeleteAccount',{clubId,memberId:target.id,memberVersion:target.syncVersion,accountRevision:target.accountRevision,adminPassword});
      clearAdmin(); go('/admin'); toast('账号已删除，历史任务与完成记录已保留');
    }
    if (action==='adminReset') {
      const target=s.adminTarget;
      if (!target?.canEditAccount) throw new Error('没有修改此账号的权限');
      if (!s.form.adminPassword) throw new Error('请先填写你自己的密码以确认操作');
      const result=await api.call('adminResetPassword',{clubId:s.sync.board.club.id,memberId:target.id,memberVersion:target.syncVersion,accountRevision:target.accountRevision,adminPassword:s.form.adminPassword});
      s.form.adminPassword='';
      const url=new URL(location.href); url.hash='/reset?token='+result.resetToken+'&username='+encodeURIComponent(result.username);
      s.resetLink=url.href; s.resetUsername=result.username; s.resetExpiresAt=result.expiresAt;
      toast('重设链接已生成');
    }
    if(action==='proxyComplete'){
      const task=s.sync.board.tasks.find(t=>t._id===id),person=task&&taskView(task,s.sync.board).participants.find(p=>p.id===el.dataset.participant);
      if(!person?.canProxyToggle)throw new Error('当前不能代这位负责人修改完成状态，请刷新重试');
      await api.call('complete',{taskId:id,participantId:person.id,done:!person.done});toast(person.done?'已撤销代完成':'已记录代完成及操作者');
    }
    if (action === 'toggle') {
      const b = s.sync.board, raw = b.tasks.find(t=>t._id===id); if (!raw) throw new Error('任务已归档');
      const t = taskView(raw,b);
      await api.call('complete', { taskId: id, done: !t.myDone }); toast(t.myDone?'已撤销完成':'已记录完成');
    }
    if (action === 'archive' && await confirmAction('归档这项任务？','归档后将从看板隐藏；如有子任务，也会一起归档。已有完成记录会保留。')) { await api.call('archiveTask', { taskId: s.id }); go('/board'); }
    if(action==='archiveTemplate') {
      const template=s.sync.board.templates.find(t=>t._id===id);
      if(template&&await confirmAction('归档这个模板？','模板将从共享模板库隐藏，已经发布的任务保持不变。')) await api.call('archiveTemplate',{templateId:id,revision:template.revision});
    }
    if (action === 'rotateInvite') {
      const department=s.inviteDepartment || '', label=department?departmentLabel(department):'社团通用';
      if (await confirmAction('更换'+label+'邀请码？','仅此入口的旧邀请码和邀请链接将失效，其他部门邀请码及已有成员不受影响。')) {
        await api.call('rotateInvite', { clubId: s.sync.board.club.id, department });
        s.invites=await api.getInvite(s.sync.board);
      }
    }
    if (action === 'logout') { await api.logout(); go('/auth'); }
  });
});
window.addEventListener('hashchange', route);
window.addEventListener('beforeunload',event=>{if(documentDirty(s.experienceDocument)||guideDrafts.hasDraft(guideKey())){event.preventDefault();event.returnValue='';}});
window.addEventListener('sps:logged-out', () => go(s.page==='experience'?experienceRoute(s.experiencePath):'/auth'));
window.addEventListener('online', () => api.sync.setOnline(true));
window.addEventListener('offline', () => api.sync.setOnline(false));
document.addEventListener('visibilitychange', () => api.sync.setVisible(!document.hidden));
// Deadline labels use local time and never initiate a request.
setInterval(() => { if (!document.hidden && ['board','mine','calendar','task'].includes(s.page)) render(); },30000);
async function start() {
  try {
    const response = await fetch(new URL('./config.json', location.href.split('#')[0]), { cache:'no-store' });
    if (!response.ok) throw new Error('配置加载失败，请刷新页面');
    const config = await response.json(); api.configure(config.apiBase);configureBooking(config.bookingApiBase);
    api.sync.setVisible(!document.hidden); api.sync.setOnline(navigator.onLine); await route();
    startReleaseUpdates({safe:()=>!tutorial.active&&!guideDrafts.hasDraft(guideKey())&&!s.busy&&!s.recovery&&!s.resetLink&&!s.resetToken&&!s.experienceDocument?.editing&&!s.experienceFiles?.length&&!root.querySelector('form')&&!document.querySelector('dialog[open]')&&!document.activeElement?.matches('input,textarea,select,[contenteditable="true"]')});
  } catch (error) { root.innerHTML = `<section class="page"><h1 class="h1">暂时无法连接</h1><p class="error">${views.e(error.message)}</p><button data-action="reload">重新加载</button></section>`; }
}
start();
