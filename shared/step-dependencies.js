// Step IDs belong to a template/draft, not to array positions or titles.
function normalizeStepDependencies(steps) {
  const ids=new Set();
  for (const step of steps) {
    if (!step || typeof step !== 'object') throw new Error('子任务格式无效');
    if (step.id === undefined) continue;
    if (typeof step.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(step.id) || ids.has(step.id)) throw new Error('子任务标识无效或重复，请重新添加子任务');
    ids.add(step.id);
  }
  const normalized=steps.map((step,index)=>{
    let id=step.id;
    if (id===undefined) {
      id='legacy_step_'+index;
      while (ids.has(id)) id+='_' ;
      ids.add(id);
    }
    const dependsOn=step.dependsOn===undefined?[]:step.dependsOn;
    if (!Array.isArray(dependsOn) || dependsOn.length>steps.length || dependsOn.some(ref=>typeof ref!=='string')) throw new Error('请选择有效的依赖子任务');
    return {...step,id,dependsOn:[...new Set(dependsOn)]};
  });
  for (const step of normalized) {
    if (step.dependsOn.includes(step.id)) throw new Error('子任务不能依赖自己');
    if (step.dependsOn.some(id=>!ids.has(id))) throw new Error('依赖的子任务不存在，请重新选择');
    if (step.dependsOn.some(id=>!canDependOn(normalized,step.id,id))) throw new Error('子任务依赖不能形成循环，请调整依赖关系');
  }
  return normalized;
}
function canDependOn(steps, stepId, dependencyId) {
  const seen=new Set(), pending=[dependencyId];
  while (pending.length) {
    const id=pending.pop();
    if (id===stepId) return false;
    if (seen.has(id)) continue;
    seen.add(id);
    pending.push(...(steps.find(step=>step.id===id)?.dependsOn || []));
  }
  return true;
}
function removeStep(steps, index) {
  const [removed]=steps.splice(index,1);
  if (removed) for (const step of steps) step.dependsOn=(step.dependsOn || []).filter(id=>id!==removed.id);
}
module.exports={normalizeStepDependencies,canDependOn,removeStep};
