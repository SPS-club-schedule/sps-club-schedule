import { DEPARTMENTS, departmentLabel } from '../shared/departments';
import { resolveParticipants } from '../shared/assignments';
import { e, button } from './ui';

export function assigneePicker(item, board, { stepIndex, roleIndex, disabled = false, templateMode = false } = {}) {
  const ids = resolveParticipants(item, board.members), step = stepIndex !== undefined;
  const role = roleIndex !== undefined;
  const index = step || role ? `data-index="${step ? stepIndex : roleIndex}"` : '';
  const action = suffix => (role ? 'role' : step ? 'step' : '') + (role || step ? suffix : suffix[0].toLowerCase()+suffix.slice(1));
  return `${disabled ? '' : `<div class="small muted space">按部门选择</div><div class="chips space">${DEPARTMENTS.map(d => {
    const count = board.members.filter(m => m.department === d.id).length;
    return button(action('Department'), `${e(d.name)} · ${count} 人`, 'chip ' + (item.participantDepartment === d.id ? 'active' : ''), `${index} data-value="${d.id}" aria-pressed="${item.participantDepartment === d.id}" ${!count && !templateMode ? 'disabled' : ''}`);
  }).join('')}</div><p class="hint">${item.participantDepartment ? `已选择${e(departmentLabel(item.participantDepartment))}全体成员。${templateMode ? '每次使用时按最新部门名单填入。' : '发布时按最新部门名单分配。'}` : '点击部门选中该部门全体成员，替换当前名单。'} 可再点击姓名单独调整。</p>`}
  <div class="chips">${board.members.map(m => button(action('Participant'), (ids.includes(m.id) ? '✓ ' : '') + e(m.name), 'chip ' + (ids.includes(m.id) ? 'active' : ''), `${index} data-id="${e(m.id)}" aria-pressed="${ids.includes(m.id)}" ${disabled ? 'disabled' : ''}`)).join('')}</div>`;
}
