const {normalizeStepDependencies}=require('./step-dependencies');
const DAY=86400000, MINUTE=60000, MAX_ESTIMATE_MINUTES=365*24*60;
function schedulingMode(value) {
  if (value===undefined) return 'independent';
  if (!['independent','backward'].includes(value)) throw new Error('请选择有效的子任务截止方式');
  return value;
}
function planningFields(step, required=false) {
  const estimateMinutes=step.estimateMinutes===undefined?null:step.estimateMinutes;
  if ((required&&estimateMinutes===null) || (estimateMinutes!==null&&(!Number.isInteger(estimateMinutes)||estimateMinutes<0||estimateMinutes>MAX_ESTIMATE_MINUTES))) throw new Error(`请为「${step.title || '未命名子任务'}」填写保守预计耗时（0—365天）`);
  const anchorToMain=step.anchorToMain===undefined?true:step.anchorToMain;
  if (typeof anchorToMain!=='boolean') throw new Error('请选择有效的子任务截止约束');
  return {estimateMinutes,anchorToMain};
}
function draftPlanningFields(step, required=false) {
  let estimateMinutes=step.estimateMinutes;
  if (step.estimateDays!==undefined) {
    const days=Number(step.estimateDays), minutes=days*1440;
    estimateMinutes=String(step.estimateDays).trim()===''?null:Number.isFinite(minutes)&&Math.abs(minutes-Math.round(minutes))<1e-6?Math.round(minutes):NaN;
  }
  return planningFields({...step,estimateMinutes},required);
}
// Finish-to-start constraints. Visit successors first: each predecessor must
// finish before EVERY successor's latest start, hence min(), not max() or sum().
function computeStepSchedule(mainDueAt, input, mode='independent') {
  mode=schedulingMode(mode);
  if (!Number.isSafeInteger(mainDueAt)) throw new Error('请先设置主任务的截止日期和时间');
  const steps=normalizeStepDependencies(input), result=new Map(), successors=new Map(steps.map(s=>[s.id,[]]));
  for (const step of steps) for (const id of step.dependsOn) successors.get(id).push(step.id);
  const byId=new Map(steps.map(s=>[s.id,s]));
  function visit(id) {
    if (result.has(id)) return result.get(id);
    const step=byId.get(id), {estimateMinutes,anchorToMain}=planningFields(step,mode==='backward');
    if (!Number.isInteger(step.daysBefore)||step.daysBefore<0||step.daysBefore>365) throw new Error('提前天数须为0—365的整数');
    if (step.dueAt!==undefined&&(!Number.isSafeInteger(step.dueAt)||step.dueAt>mainDueAt)) throw new Error(`「${step.title || '子任务'}」的指定截止时间无效或晚于主任务`);
    let dueAt=step.dueAt ?? mainDueAt-((mode==='independent'||anchorToMain)?step.daysBefore:0)*DAY;
    let reason=step.dueAt!==undefined?{kind:'custom'}:mode==='independent'||anchorToMain?{kind:'anchor',daysBefore:step.daysBefore}:{kind:'main'};
    if (mode==='backward') for (const successorId of successors.get(id)) {
      const successor=visit(successorId);
      if (successor.startAt<dueAt) {dueAt=successor.startAt;reason={kind:'successor',ids:[successorId]};}
      else if (successor.startAt===dueAt&&reason.kind==='successor') reason.ids.push(successorId);
    }
    const row={id,dueAt,startAt:mode==='backward'?dueAt-estimateMinutes*MINUTE:null,reason};
    result.set(id,row);return row;
  }
  return steps.map(step=>visit(step.id));
}
module.exports={DAY,MINUTE,MAX_ESTIMATE_MINUTES,schedulingMode,planningFields,draftPlanningFields,computeStepSchedule};
