import {e,link,button,busy} from './ui';

export function todoList(tasks,s) {
  if(!tasks.length)return '';
  return `<ul class="todo-list" aria-label="我的任务">${tasks.map(t=>{
    const status=t.myDone?'done':t.status;
    const label=t.canToggle?t.actionLabel+'：'+t.title:'任务已由其他负责人完成：'+t.title;
    return `<li class="todo-item ${t.myDone?'completed':''}">
      ${link('/task?id='+encodeURIComponent(t._id),`${t.parentTaskId&&t.parentVisible!==false?`<span class="todo-parent">↳ ${e(t.parentTitle)}</span>`:''}<span class="todo-title">${e(t.title)}</span><span class="todo-meta"><span class="due ${status}">${t.myDone?'✓ 已完成':'◷ '+e(t.dueLabel)}</span><span>${e(t.modeLabel)}</span>${t.priority==='high'&&!t.myDone?'<span class="todo-priority">优先</span>':''}</span>${t.hasDuration?`<span class="todo-duration">${e(t.durationLabel)}</span>`:''}`,'todo-main')}
      ${button('toggle',`<span class="todo-box" aria-hidden="true">${t.myDone?'✓':''}</span>`,'todo-toggle',`data-id="${e(t._id)}" role="checkbox" aria-checked="${t.myDone}" aria-label="${e(label)}" ${!t.canToggle?'disabled':busy(s)}`)}
    </li>`;
  }).join('')}</ul>`;
}
