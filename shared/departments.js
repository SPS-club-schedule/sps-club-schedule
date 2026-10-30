'use strict';
const DEPARTMENTS = Object.freeze([
  { id: 'publicity', name: '宣传部' },
  { id: 'liaison', name: '联络部' },
  { id: 'academic', name: '学术部' }
]);
const validDepartment = value => value === '' || DEPARTMENTS.some(d => d.id === value);
const departmentLabel = value => DEPARTMENTS.find(d => d.id === value)?.name || '未分配';
const invitationToken = (invites, department = '') => department ? invites?.departments?.find(d => d.id === department)?.token || '' : invites?.token || '';
module.exports = { DEPARTMENTS, validDepartment, departmentLabel, invitationToken };
