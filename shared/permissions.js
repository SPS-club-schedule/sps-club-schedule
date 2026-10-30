'use strict';
const isAdmin = role => role === 'owner' || role === 'admin';
const roleLabel = role => ({ owner: '创建者', admin: '管理员', member: '成员' }[role] || '成员');
// Delegated admins manage ordinary members, never the creator or peer admins.
const canEditMember = (actor, target) => isAdmin(actor.role) && (actor.role === 'owner' || actor.id === target.id || target.role === 'member');
module.exports = { isAdmin, roleLabel, canEditMember };
