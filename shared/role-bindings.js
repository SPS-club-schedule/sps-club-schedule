'use strict';
// Read legacy single-role templates without migrating stored records.
function selectedRoleIds(item) {
  return [...new Set(Array.isArray(item.roleIds) ? item.roleIds : item.roleId ? [item.roleId] : [])];
}
function roleBindingFields(item) {
  const roleIds = selectedRoleIds(item);
  return { roleIds, roleId: roleIds.length === 1 ? roleIds[0] : '' };
}
module.exports = { selectedRoleIds, roleBindingFields };
