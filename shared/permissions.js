'use strict';
const ROLES = ['member','department_admin','web_admin','admin','owner'];
const rank = role => ({member:0,department_admin:1,web_admin:1,admin:2,owner:3}[role] ?? -1);
const isAdmin = role => rank(role)>0;
// Public pages deliberately do not show the internal management hierarchy.
const roleLabel = role => isAdmin(role) ? '管理员' : '成员';
const adminRoleLabel = role => ({owner:'创始人',admin:'总管理员',department_admin:'部门管理',web_admin:'网页维护管理',member:'成员'}[role] || '成员');
const canEditMember = (actor, target) => actor.id!==target.id && isAdmin(actor.role) && rank(actor.role)>rank(target.role) && (actor.role!=='department_admin' || !!actor.department && actor.department===target.department);
const canDeleteMember = (actor, target) => actor.id !== target.id && target.role !== 'owner' && canEditMember(actor, target);
const canEditProfile = (actor,target) => canEditMember(actor,target) && actor.role!=='web_admin';
const canEditDepartment = (actor,target) => canEditMember(actor,target) && ['owner','admin'].includes(actor.role);
const canAssignRole = (actor,target,role) => actor.id!==target.id && target.role!=='owner' && ['owner','admin'].includes(actor.role) && canEditMember(actor,target) && ROLES.includes(role) && rank(role)<rank(actor.role);
const assignableRoles = (actor,target) => ROLES.filter(role=>canAssignRole(actor,target,role));
const canEditLogin = (actor,target) => canEditMember(actor,target) && actor.role!=='department_admin';
const canViewAudit = role => ['owner','admin','web_admin'].includes(role);
const canViewClubDeadlines = role => ['owner','admin','department_admin'].includes(role);
module.exports = { ROLES, isAdmin, roleLabel, adminRoleLabel, canEditMember, canDeleteMember, canEditProfile, canEditDepartment, canAssignRole, assignableRoles, canEditLogin, canViewAudit, canViewClubDeadlines };
