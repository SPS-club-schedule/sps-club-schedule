'use strict';
// Resolve rules against a roster at use/publication time. Published tasks keep
// only the resulting IDs, so later roster changes cannot rewrite completion work.
const memberId = member => member.id || member._id;
function resolveParticipants(item, members, main) {
  if (item.followMain) return main ? resolveParticipants(main, members) : [];
  if (item.participantDepartment) return members.filter(m => m.department === item.participantDepartment).map(memberId);
  return [...(item.participantIds || [])];
}
function chooseDepartment(item, department, members) {
  item.followMain = false;
  item.participantDepartment = department;
  item.participantIds = resolveParticipants(item, members);
}
function toggleParticipant(item, id, members, main) {
  const ids = resolveParticipants(item, members, main);
  item.followMain = false; item.participantDepartment = '';
  item.participantIds = ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id];
}
function setFollowMain(step, follow, main, members) {
  const ids = resolveParticipants(step, members, main);
  step.followMain = follow; step.participantDepartment = '';
  step.participantIds = follow ? [] : ids;
}
module.exports = { resolveParticipants, chooseDepartment, toggleParticipant, setFollowMain };
