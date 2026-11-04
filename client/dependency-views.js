import { e, button, link } from './ui';
import { canDependOn } from '../shared/step-dependencies';
import { taskView } from '../shared/view';

export function stepDependencies(step, steps) {
  if (!step.dependsOn?.length) return '';
  return `<div class="dependency-summary small wrap">依赖：${step.dependsOn.map(id=>e(steps.find(item=>item.id===id)?.title || '未命名子任务')).join('、')}</div>`;
}
export function dependencyPicker(step, steps, index) {
  const choices=steps.filter(item=>item.id!==step.id);
  return `<div class="field dependency-picker"><div class="label" id="step-${index}-dependencies">依赖哪些子任务 <span class="small muted">可多选</span></div><p class="hint">仅作协作提示，不限制完成顺序，也不自动调整截止时间。</p><div class="chips space" role="group" aria-labelledby="step-${index}-dependencies">${choices.map(item=>{
    const selected=step.dependsOn?.includes(item.id), disabled=!selected&&!canDependOn(steps,step.id,item.id);
    return button('stepDependency',(selected?'✓ ':'')+e(item.title || '未命名子任务'),'chip '+(selected?'active':''),`data-index="${index}" data-id="${e(item.id)}" aria-pressed="${!!selected}" ${disabled?'disabled title="此选择会形成循环依赖"':''}`);
  }).join('') || '<span class="small muted">添加其他子任务后即可选择。</span>'}</div><p class="hint">${choices.length?'再次点击可取消。不能依赖自己或形成循环。':''}</p></div>`;
}
export function taskDependencies(task, board, detailed = false) {
  if (!task.dependsOnTaskIds?.length) return '';
  const items=task.dependsOnTaskIds.map(id=>{
    const target=board.tasks.find(item=>item._id===id&&!item.archived);
    if (!target) return '<span class="muted">已归档或不可用的子任务</span>';
    const done=taskView(target,board).done;
    return link('/task?id='+encodeURIComponent(id),e(target.title)+(detailed?` <span class="muted">· ${done?'已完成':'未完成'}</span>`:''),'dependency-link');
  });
  return `<div class="dependency-summary small wrap ${detailed?'card section':'space'}">${detailed?'<div class="label">依赖的子任务</div>':'依赖：'}${items.join('、')}${detailed?'<p class="hint">仅作协作提示；依赖任务尚未完成时，你仍可标记本任务完成。</p>':''}</div>`;
}
