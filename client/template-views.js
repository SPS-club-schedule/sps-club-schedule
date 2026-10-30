import { e, button, link, error, busy, field, syncRow, nav } from './ui';
import { parts } from '../shared/view';
import { draftDeadline, MAX_STEPS } from '../shared/templates';
import { resolveParticipants } from '../shared/assignments';
import { departmentLabel } from '../shared/departments';
import { assigneePicker } from './assignee-picker';
import { templateDurationEditor } from './schedule-editor';
import { durationText } from '../shared/template-duration';

const options = (values, selected) => values.map(([value, label]) => `<option value="${e(value)}" ${value===selected?'selected':''}>${e(label)}</option>`).join('');
const categories = b => [...new Set((b.templates || []).map(t => t.category))].sort((a,b)=>a.localeCompare(b,'zh'));
const memberNames = (ids, b) => ids.map(id=>b.members.find(m=>m.id===id)?.name || '已离开的成员').join('、');
const assignmentLabel = (item,b) => item.followMain ? '跟随主任务负责人' : item.participantDepartment ? departmentLabel(item.participantDepartment)+'全体成员' : memberNames(item.participantIds || [],b);
const fields = item => `${item.title} ${item.name || ''} ${item.category || ''} ${item.description}`;

export function templates(s) {
  const b = s.sync.board;
  if (!b?.club) return `<section class="page">${syncRow(s)}${error(s)}</section>${nav('templates',b)}`;
  const shown = (b.templates || []).filter(t => (!s.category || t.category===s.category) && fields(t).toLowerCase().includes(s.search.trim().toLowerCase())).sort((a,b)=>a.category.localeCompare(b.category,'zh') || a.name.localeCompare(b.name,'zh'));
  return `<section class="page"><div class="eyebrow space">SHARED PLAYBOOKS</div><h1 class="h1 space">把经验，变成模板。</h1><p class="muted space">全社团共享 · 每位成员都能创建、编辑和分类</p>${syncRow(s)}${error(s)}<div class="row between section"><h2 class="h2">任务模板</h2>${link('/template-edit','＋ 新建模板','primary compact')}</div><div class="search-box"><input name="search" aria-label="搜索模板" placeholder="搜索模板、分类或说明" value="${e(s.search)}"></div><label class="label" for="templateCategory">按分类查看</label><select id="templateCategory" name="templateCategory">${options([['','全部分类'],...categories(b).map(c=>[c,c])],s.category || '')}</select>
  <div class="section">${shown.map(t => `<article class="card template-card"><div class="row between"><span class="pill">${e(t.category)}</span><span class="small muted">${t.steps.length} 项子任务</span></div><h2 class="h2 space wrap">${e(t.name)}</h2>${t.durationMinutes?`<p class="task-duration space">默认时长：${e(durationText(t.durationMinutes))}</p>`:''}${t.description?`<p class="small muted space prewrap">${e(t.description)}</p>`:''}<ol class="template-timeline">${t.steps.map(step=>`<li><span class="offset-badge">${step.daysBefore?'提前 '+step.daysBefore+' 天':'当天'}</span><div class="grow wrap">${e(step.title)}${assignmentLabel(step,b)?`<div class="small muted">${e(assignmentLabel(step,b))}</div>`:''}</div></li>`).join('')}</ol><p class="hint">最近由 ${e(b.members.find(m=>m.id===t.updatedBy)?.name || '社团成员')} 更新</p><div class="row space">${link('/edit?template='+encodeURIComponent(t._id),'使用模板 →','primary compact grow center')}${link('/template-edit?id='+encodeURIComponent(t._id),'编辑 / 分类','secondary compact')}${link('/template-edit?copy='+encodeURIComponent(t._id),'复制','plain small')}</div>${t.creatorId===b.me.id || b.me.role==='owner'?button('archiveTemplate','归档模板','plain small space',`data-id="${e(t._id)}" ${busy(s)}`):''}</article>`).join('') || '<div class="card empty">没有匹配的模板，试试其他分类或创建一个。</div>'}</div></section>${nav('templates',b)}`;
}

export function templatePicker(s) {
  const templates = s.editBoard.templates || [];
  return `<aside class="card template-picker"><div class="row between"><h2 class="h2">从模板开始</h2>${link('/templates','管理模板 →','plain small')}</div><p class="hint">选择后可修改标题、负责人、提前天数和具体日期。</p><div class="row space"><select name="selectedTemplate" aria-label="任务模板"><option value="">选择共享模板</option>${categories(s.editBoard).map(c=>`<optgroup label="${e(c)}">${options(templates.filter(t=>t.category===c).map(t=>[t._id,t.name]),s.selectedTemplate)}</optgroup>`).join('')}</select>${button('applyTemplate','套用','secondary compact',busy(s))}</div>${s.appliedTemplate?`<p class="hint">已套用：${e(s.appliedTemplate.name)}。这里的修改仅用于本次任务。</p>`:''}</aside>`;
}

export function stepEditors(s, templateMode = false) {
  const b=s.editBoard, steps=s.steps || [];
  const renderStep = (step,index) => {
    const ids=resolveParticipants(step,b.members,s.form);
    const people=step.followMain ? '跟随主任务负责人'+(ids.length?' · '+memberNames(ids,b):'（使用时自动填入）') : assignmentLabel(step,b) || (templateMode?'负责人：使用时选择':'尚未指定负责人');
    const attr = key=>`data-step="${index}" data-field="${key}"`;
    const name = key=>`step-${index}-${key}`;
    let dueText='', invalid=false;
    if (!templateMode) {
      try {
        const due=draftDeadline(s.form,step), p=parts(due);
        dueText=p.date+' '+p.time;
        invalid=due<=Date.now();
        if (invalid) dueText+=' · 已过期，请调整';
        else if (due>draftDeadline(s.form,{daysBefore:0})) { invalid=true; dueText+=' · 晚于主任务，请调整'; }
      } catch { dueText='请设置有效的主任务日期和提前天数'; invalid=true; }
    }
    return `<details class="card step-card" data-step-panel="${index}" ${s.openSteps?.has(index)?'open':''}><summary><span class="step-number">${index+1}</span><div class="grow"><strong class="wrap">${e(step.title || '新子任务')}</strong><div class="small muted">${step.customDeadline&&!templateMode?'单独日期':step.daysBefore===0?'主任务当天':'提前 '+e(step.daysBefore)+' 天'}${!templateMode?` · <span class="${invalid?'due overdue':''}">${e(dueText)}</span>`:''}</div><div class="small ${ids.length||templateMode?'muted':'due soon'}">${e(people)}</div></div><span class="step-chevron">⌄</span></summary><div class="step-fields">
    <div data-tour="child-title">${field(name('title'),'子任务名称',step.title,'text',`required maxlength="80" ${attr('title')}`)}</div><div class="field"><label class="label" for="${name('description')}">任务说明</label><textarea id="${name('description')}" name="${name('description')}" maxlength="2000" ${attr('description')}>${e(step.description)}</textarea></div>
    <div data-tour="child-deadline">${field(name('daysBefore'),'比主任务提前几天',step.daysBefore,'number',`required min="0" max="365" step="1" ${attr('daysBefore')}`)}
    ${!templateMode?`<div class="deadline-preview ${invalid?'invalid':''}">${step.customDeadline?'单独截止':'自动计算'}：${e(dueText)}（北京时间）</div>${step.customDeadline?`<div class="row space">${field(name('date'),'子任务截止日期',step.date,'date',`required ${attr('date')}`)}${field(name('time'),'子任务时间',step.time,'time',`required ${attr('time')}`)}</div>${button('stepRelative','恢复按提前天数计算','plain small',`data-index="${index}"`)}`:button('stepCustom','单独调整日期 / 时间','plain small space',`data-index="${index}"`)}`:''}
    </div><div class="row space"><div class="field grow"><label class="label" for="${name('mode')}">完成方式</label><select id="${name('mode')}" name="${name('mode')}" ${attr('mode')}>${options([['individual','逐人完成'],['shared','协作完成']],step.mode)}</select></div><div class="field grow"><label class="label" for="${name('priority')}">优先级</label><select id="${name('priority')}" name="${name('priority')}" ${attr('priority')}>${options([['normal','普通'],['high','优先处理']],step.priority)}</select></div></div>
    <div data-tour="child-people"><div class="label">${templateMode?'默认负责人（可留空）':'子任务负责人'} · ${ids.length} 人</div><div class="chips">${[['manual','单独指定'],['main','跟随主任务负责人']].map(([value,label])=>button('stepFollow',label,'chip '+((value==='main')===!!step.followMain?'active':''),`data-index="${index}" data-value="${value}" aria-pressed="${(value==='main')===!!step.followMain}"`)).join('')}</div>${step.followMain?`<p class="hint">${ids.length?'当前：'+e(memberNames(ids,b))+'。':'使用模板时自动填入。'}主任务选中的所有人都会负责这一步；发布前修改主任务名单时同步更新。</p>`:assigneePicker(step,b,{stepIndex:index,templateMode})}
    </div><div class="row between space"><div class="row">${button('stepUp','↑ 上移','plain small',`data-index="${index}" ${index===0?'disabled':''}`)}${button('stepDown','↓ 下移','plain small',`data-index="${index}" ${index===steps.length-1?'disabled':''}`)}</div>${button('removeStep','移除这一步','danger compact',`data-index="${index}"`)}</div></div></details>`;
  };
  return `<section class="section"><div class="row between"><h2 class="h2">${templateMode?'预设子任务':'子任务与截止日期'} · ${steps.length}</h2>${!templateMode&&steps.length?button('assignStepsToMe','全部交给我','plain small'):''}</div><p class="hint">${templateMode?'提前天数相对主任务截止时间计算；负责人可以预设，也可在使用时选择。':'点击每一步展开编辑。调整主任务日期会重算相对日期，单独设置的日期会保留。'}</p><div class="space">${steps.map(renderStep).join('')}</div>${button('addStep','＋ 添加一步','secondary full',steps.length>=MAX_STEPS?'disabled':'')}<p class="hint">最多 ${MAX_STEPS} 步。${!templateMode?'发布后，各负责人可在“我的待办”和日历中查看自己的任务。':''}</p></section>`;
}

export function templateEditor(s) {
  const f=s.form,b=s.editBoard;
  return `<section class="page">${link('/templates','← 返回模板库','plain small')}<div class="eyebrow section">BUILD A PLAYBOOK</div><h1 class="h1 space">${s.id?'编辑共享模板':'创建共享模板'}</h1><p class="muted space">保留可复用的步骤，下次只需约定时间与分工。</p>${error(s)}${!b?(s.error?'':'<div class="empty">正在加载模板…</div>'):`<form id="template-form" data-form="template" class="section"><fieldset ${busy(s)}>${field('name','模板名称',f.name,'text','required maxlength="80" placeholder="例如：研讨班、招新活动"')}${field('category','分类',f.category,'text','required maxlength="30" list="template-categories" placeholder="输入新分类，或选择已有分类"')}<datalist id="template-categories">${categories(b).map(c=>`<option value="${e(c)}"></option>`).join('')}</datalist>${field('title','主任务默认名称',f.title,'text','required maxlength="80"')}<div class="field"><label class="label" for="description">主任务默认说明</label><textarea name="description" id="description" maxlength="2000">${e(f.description)}</textarea></div>${templateDurationEditor(f)}<div class="row"><div class="field grow"><label class="label" for="mode">主任务完成方式</label><select id="mode" name="mode">${options([['individual','逐人完成'],['shared','协作完成']],f.mode)}</select></div><div class="field grow"><label class="label" for="priority">优先级</label><select id="priority" name="priority">${options([['normal','普通'],['high','优先处理']],f.priority)}</select></div></div><div class="label">主任务默认参与成员 · ${resolveParticipants(f,b.members).length} 人</div>${assigneePicker(f,b,{templateMode:true})}<p class="hint">未选部门且名单留空时，使用模板默认选中当时的全体成员。</p>${stepEditors(s,true)}<p class="hint space">保存后，全社团成员都能使用与编辑。修改模板不会改动已经发布的任务。</p></fieldset></form>`}</section><footer class="footer"><button type="submit" form="template-form" class="primary full" ${s.busy||!b?'disabled':''}>${s.busy?'正在保存…':'保存共享模板 →'}</button></footer>`;
}
