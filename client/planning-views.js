import {e,button,field} from './ui';
import {parts} from '../shared/view';
import {draftSchedule} from '../shared/templates';
import {computeStepSchedule} from '../shared/backward-schedule';

export function estimateText(minutes) {
  const days=Math.floor(minutes/1440),hours=Math.floor(minutes%1440/60),rest=minutes%60;
  return [days?days+' 天':'',hours?hours+' 小时':'',rest?rest+' 分钟':''].filter(Boolean).join(' ') || '0 分钟';
}
export function planMoment(value,relative=false) {
  if (relative) return value===0?'主任务截止时':'主任务前 '+estimateText(-value/60000);
  const p=parts(value);return p.date+' '+p.time;
}
export function templateStepTiming(template,step,index) {
  if (template.schedulingMode!=='backward') return step.daysBefore?'提前 '+step.daysBefore+' 天':'当天';
  try {return planMoment(computeStepSchedule(0,template.steps,'backward')[index].dueAt,true)+'截止';}
  catch {return '按依赖倒排';}
}
export function stepPlan(s,templateMode) {
  try {return {rows:draftSchedule(s.form,s.steps || [],templateMode?0:undefined)};}
  catch(error) {return {rows:[],error:error.message};}
}
export function schedulingSelector(s) {
  const backward=s.form.schedulingMode==='backward';
  return `<div class="field planning-selector"><div class="label">子任务截止方式</div><div class="chips">${[['independent','按各步提前天数'],['backward','按依赖与耗时倒排']].map(([value,label])=>button('schedulingMode',label,'chip '+((backward?'backward':'independent')===value?'active':''),`data-value="${value}" aria-pressed="${(backward?'backward':'independent')===value}"`)).join('')}</div><p class="hint">${backward?'按自然日计算，1天为24小时。每步填写保守耗时；可设置“至少提前主任务几天”。多条依赖约束取更早的截止，独立分支可并行。':'每步单独设置提前天数，依赖关系只作提示。'}</p>${backward?'<p class="hint">未设提前要求且没有后续任务时，以主任务截止为界。旧步骤的提前天数会保留为约束，可切换为“按依赖倒排”。完成操作始终不受依赖限制。</p>':''}</div>`;
}
export function planningPreview(s,templateMode,plan) {
  if(s.form.schedulingMode!=='backward')return '';
  const warning=!templateMode&&plan.rows.some(row=>row.startAt<Date.now());
  return `<aside class="card planning-preview"><h3 class="h2">倒排预览</h3><p class="hint">${templateMode?'相对主任务截止时间的安排；使用模板时换算为具体日期。':'按北京时间显示。调整主任务日期、耗时或依赖后自动重算。'}</p>${plan.error?`<p class="due soon space" role="status">${e(plan.error)}</p>`:plan.rows.map((row,index)=>{
    const reason=row.reason.kind==='successor'?'为后续「'+row.reason.ids.map(id=>s.steps.find(step=>step.id===id)?.title || '未命名子任务').join('、')+'」预留耗时':row.reason.kind==='custom'?'不晚于指定日期':row.reason.kind==='anchor'?'至少提前主任务 '+row.reason.daysBefore+' 天':'以主任务截止为界';
    return `<div class="planning-row"><strong class="wrap">${e(s.steps[index].title || '未命名子任务')}</strong><div class="small wrap">最晚开始：${e(planMoment(row.startAt,templateMode))}</div><div class="small wrap">截止：${e(planMoment(row.dueAt,templateMode))}</div><p class="hint wrap">${e(reason)}</p></div>`;
  }).join('')}${warning?'<p class="due overdue space" role="alert">按保守耗时，部分任务已来不及从现在开始。请调迟主任务或调整计划后发布。</p>':''}<p class="hint space">${templateMode?'':'发布后保存本次截止日期；后续修改主任务或模板，不会自动重排已发布的子任务。'}</p></aside>`;
}
export function stepDeadlineEditor(s,step,index,templateMode,plan) {
  const backward=s.form.schedulingMode==='backward',row=plan.rows[index],attr=key=>`data-step="${index}" data-field="${key}"`,name=key=>'step-'+index+'-'+key;
  const anchored=step.anchorToMain!==false;
  const dateText=plan.error || (row?planMoment(row.dueAt):'请补全日期'),invalid=!!plan.error||(!templateMode&&row&&(row.dueAt<=Date.now()||(backward&&row.startAt<Date.now())));
  return `${backward?`${field(name('estimateDays'),'保守预计耗时（天）',step.estimateDays ?? (step.estimateMinutes==null?'':step.estimateMinutes/1440),'number',`required min="0" max="365" step="any" placeholder="例如：3 或 0.5" ${attr('estimateDays')}`)}<p class="hint">可填小数，精确到分钟。0 表示不占用时间的里程碑。</p><div class="label space">截止约束</div><div class="chips">${[[false,'按依赖倒排'],[true,'至少提前主任务']].map(([value,label])=>button('stepAnchor',label,'chip '+(anchored===value?'active':''),`data-index="${index}" data-value="${value}" aria-pressed="${anchored===value}"`)).join('')}</div>`:''}
  ${!backward||anchored?field(name('daysBefore'),backward?'至少提前主任务几天完成':'比主任务提前几天',step.daysBefore,'number',`required min="0" max="365" step="1" ${attr('daysBefore')}`):''}
  ${!templateMode?`<div class="deadline-preview ${invalid?'invalid':''}">${backward?'倒排截止':step.customDeadline?'单独截止':'自动计算'}：${e(dateText)}${plan.error?'':'（北京时间）'}${backward&&row?`<div class="small">最晚开始：${e(planMoment(row.startAt))}</div>`:''}</div>${step.customDeadline?`<div class="row space">${field(name('date'),backward?'不晚于指定日期':'子任务截止日期',step.date,'date',`required ${attr('date')}`)}${field(name('time'),'子任务时间',step.time,'time',`required ${attr('time')}`)}</div>${backward?'<p class="hint">此日期替代本步的提前天数约束；依赖链仍可能要求更早完成。</p>':''}${button('stepRelative',backward?'恢复模板截止约束':'恢复按提前天数计算','plain small',`data-index="${index}"`)}`:button('stepCustom',backward?'为本次设置最晚完成日期':'单独调整日期 / 时间','plain small space',`data-index="${index}"`)}`:''}`;
}
export function publishedPlanning(task) {
  if (task.estimateMinutes==null) return '';
  return `<div class="divider"></div><div class="small muted">保守预计耗时：${e(estimateText(task.estimateMinutes))}</div><div class="small space">建议最晚开始：${e(planMoment(task.dueAt-task.estimateMinutes*60000))}</div><p class="hint">根据本任务截止时间与预计耗时计算，不限制实际开始或完成操作。</p>`;
}
