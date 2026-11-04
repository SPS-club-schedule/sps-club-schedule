'use strict';
// Resolve rules against a roster at use/publication time. Published tasks keep
// only the resulting IDs, so later roster changes cannot rewrite completion work.
const memberId = member => member.id || member._id;
// Preserve unfinished names while changing draft bindings. Publication validates
// names separately; an incomplete draft must remain editable.
function draftGuestText(item, main) {
  if(item.roleId){const role=main?.roles?.find(role=>role.id===item.roleId);return role?.coreMember===false?role.guestNames||'':'';}
  if(item.followMain)return main?draftGuestText(main):'';
  return item.guestNames??item.guestParticipants?.map(person=>person.name).join('\n')??'';
}
function resolveParticipants(item, members, main) {
  if (item.roleId) {
    const role = main?.roles?.find(role => role.id === item.roleId);
    return role ? resolveParticipants(role, members) : [];
  }
  if (item.followMain) return main ? resolveParticipants(main, members) : [];
  if (item.participantDepartment) return members.filter(m => m.department === item.participantDepartment).map(memberId);
  return [...(item.participantIds || [])];
}
function chooseDepartment(item, department, members) {
  item.guestNames='';
  item.roleId = '';
  item.followMain = false;
  item.participantDepartment = department;
  item.participantIds = resolveParticipants(item, members);
}
function toggleParticipant(item, id, members, main) {
  const ids = resolveParticipants(item, members, main);
  item.roleId = ''; item.followMain = false; item.participantDepartment = '';
  item.participantIds = ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id];
}
function setFollowMain(step, follow, main, members) {
  const ids = resolveParticipants(step, members, main);
  const guests=draftGuestText(step,main);
  step.roleId = '';
  step.followMain = follow; step.participantDepartment = '';
  step.participantIds = follow ? [] : ids;
  step.guestNames=follow?'':guests;
  if(guests)step.allowGuestNames=true;
}
function setRole(step, roleId, main, members) {
  const ids = resolveParticipants(step, members, main);
  const guests=draftGuestText(step,main);
  step.roleId = roleId; step.followMain = false; step.participantDepartment = '';
  step.participantIds = roleId ? [] : ids;
  step.guestNames=roleId?'':guests;
  if(guests)step.allowGuestNames=true;
}
function removeRole(form, steps, roleId, members) {
  for (const step of steps) if (step.roleId === roleId) setRole(step, '', form, members);
  form.roles = (form.roles || []).filter(role => role.id !== roleId);
}
module.exports = { resolveParticipants, chooseDepartment, toggleParticipant, setFollowMain, setRole, removeRole };
