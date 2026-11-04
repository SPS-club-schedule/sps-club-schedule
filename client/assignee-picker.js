import { DEPARTMENTS, departmentLabel } from '../shared/departments';
import { resolveParticipants } from '../shared/assignments';
import { e, button } from './ui';

export function guestNameEditor(item,{roleIndex,stepIndex,disabled=false}={}) {
  const name=roleIndex!==undefined?'role-'+roleIndex+'-guestNames':stepIndex!==undefined?'step-'+stepIndex+'-guestNames':'guestNames';
  const attrs=roleIndex!==undefined?`data-role="${roleIndex}" data-role-field="guestNames"`:stepIndex!==undefined?`data-step="${stepIndex}" data-field="guestNames"`:'';
  return `<div class="field space"><label class="label" for="${name}">免注册负责人姓名 · 每行一人</label><textarea id="${name}" name="${name}" ${attrs} maxlength="10000" ${disabled?'disabled':''} placeholder="例如：张老师">${e(item.guestNames||'')}</textarea><p class="hint">最多50人，每个姓名最多40字。同社团成员可代为完成，记录会注明实际操作者。需要自行登录完成时，可从下方选择已注册主讲人。</p></div>`;
}

export function assigneePicker(item, board, { stepIndex, roleIndex, disabled = false, templateMode = false } = {}) {
  const ids = resolveParticipants(item, board.members), step = stepIndex !== undefined;
  const role = roleIndex !== undefined;
  const namedRole=role&&item.coreMember===false;
  const departments=role?DEPARTMENTS.filter(d=>d.id!=='speaker'):DEPARTMENTS;
  const index = step || role ? `data-index="${step ? stepIndex : roleIndex}"` : '';
  const action = suffix => (role ? 'role' : step ? 'step' : '') + (role || step ? suffix : suffix[0].toLowerCase()+suffix.slice(1));
  return `${namedRole?'<div class="label space">已注册主讲人 · 可选</div>':disabled ? '' : `<div class="small muted space">按部门选择</div><div class="chips space">${departments.map(d => {
    const count = board.members.filter(m => m.department === d.id).length;
    return button(action('Department'), `${e(d.name)} · ${count} 人`, 'chip ' + (item.participantDepartment === d.id ? 'active' : ''), `${index} data-value="${d.id}" aria-pressed="${item.participantDepartment === d.id}" ${!count && !templateMode ? 'disabled' : ''}`);
  }).join('')}</div><p class="hint">${item.participantDepartment ? `已选择${e(departmentLabel(item.participantDepartment))}全体成员。${templateMode ? '每次使用时按最新部门名单填入。' : '发布时按最新部门名单分配。'}` : '点击部门选中该部门全体成员，替换当前名单。'} 可再点击姓名单独调整。</p>`}
  <div class="chips">${board.members.map(m => button(action('Participant'), (ids.includes(m.id) ? '✓ ' : '') + e(m.name), 'chip ' + (ids.includes(m.id) ? 'active' : ''), `${index} data-id="${e(m.id)}" aria-pressed="${ids.includes(m.id)}" ${disabled ? 'disabled' : ''}`)).join('')}${namedRole&&!board.members.length?'<span class="small muted">暂无已注册主讲人，可直接在上方填写姓名。</span>':''}</div>`;
}
