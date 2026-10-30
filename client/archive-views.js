import { adminGuard } from './admin-views';
import { parts, taskView } from '../shared/view';
import { e, button, link, error, busy, syncRow, nav } from './ui';
const stamp = time => { const p=parts(time); return p.date+' '+p.time; };
export function archives(s) {
  const denied=adminGuard(s); if (denied) return denied;
  const b=s.sync.board, data=s.archiveData, type=s.archiveType || 'tasks', query=(s.search || '').trim().toLowerCase();
  const items=(data?.[type] || []).filter(t=>[t.title,t.name,t.description,t.category,t.parentTitle].filter(Boolean).join(' ').toLowerCase().includes(query));
  const cards=items.map(item=>{
    const template=type==='templates', t=template?null:taskView(item,b);
    const blocked=!template && (item.parentArchived || item.parentMissing);
    return `<article class="card space"><div class="row between"><span class="pill">${template?e(item.category || '未分类'):item.parentTaskId?'子任务':'主任务'}</span><span class="small muted">${template?item.steps.length+' 项子任务':e(t.progressLabel)}</span></div><h2 class="h2 space wrap">${e(template?item.name:item.title)}</h2>
    ${!template&&item.parentTaskId?`<p class="small muted space wrap">主任务：${e(item.parentTitle || '已不存在')}</p>`:''}
    <p class="hint space">归档于 ${stamp(item.updatedAt)} · 北京时间${template?'':'<br>原截止时间 '+stamp(item.dueAt)}</p>
    ${(item.description || template)?`<details class="space" data-archive-item="${e(item._id)}" ${s.archiveOpen?.has(item._id)?'open':''}><summary class="small">查看${template?'模板内容':'任务说明'}</summary>${item.description?`<p class="small space wrap">${e(item.description)}</p>`:''}${template?`<ol class="small space">${item.steps.map(step=>`<li class="wrap">${e(step.title)}</li>`).join('')}</ol>`:''}</details>`:''}
    ${!template&&item.restoreChildCount?`<p class="small space">将一并恢复随主任务归档的 ${item.restoreChildCount} 项子任务。</p>`:''}
    ${blocked?`<p class="hint space">${item.parentMissing?'主任务不存在，无法单独恢复。':'请先恢复主任务，再恢复这项子任务；随主任务归档的子任务会一起恢复。'}</p>`:''}
    ${button(template?'restoreTemplate':'restoreTask',template?'恢复模板':item.parentTaskId?'恢复子任务':'恢复任务','secondary full space',`data-id="${e(item._id)}" ${s.busy||blocked?'disabled':''}`)}</article>`;
  }).join('');
  return `<section class="page">${link('/admin','← 返回管理后台','plain small')}<div class="eyebrow section">ARCHIVE RECOVERY</div><h1 class="h1 space">归档恢复</h1><p class="muted small space">恢复后回到任务看板或模板库，保留原分工、截止时间和完成记录。仅管理员可操作。</p>${syncRow(s)}${error(s)}
  <div class="chips section">${['tasks','templates'].map(key=>button('archiveType',(key==='tasks'?'任务':'模板')+(data?' · '+data[key].length:''),'chip '+(type===key?'active':''),`data-value="${key}" ${busy(s)}`)).join('')}</div>
  <div class="search-box"><input name="search" aria-label="搜索归档内容" placeholder="搜索归档名称或内容" value="${e(s.search)}" ${busy(s)}></div>
  ${!data?'<p class="empty">正在加载归档内容…</p>':cards || `<p class="empty">${query?'没有匹配的归档内容。':type==='tasks'?'暂无已归档任务。':'暂无已归档模板。'}</p>`}
  </section>${nav('admin',b)}`;
}
