const {isSpeaker}=require('./permissions');
const {selectedRoleIds}=require('./role-bindings');
function guestNames(value='') {
  if(typeof value!=='string'||value.length>10000)throw new Error('免注册姓名格式无效');
  const names=[...new Set(value.split(/\r?\n/).map(name=>name.trim()).filter(Boolean))];
  if(names.length>50||names.some(name=>name.length>40||/[\u0000-\u001f\u007f]/.test(name)))throw new Error('免注册姓名每行一人，最多50人，每个姓名最多40字');
  return names;
}
function resolveGuestNames(item,main) {
  const roleIds=selectedRoleIds(item);
  if(roleIds.length)return [...new Set(roleIds.flatMap(id=>{const role=main?.roles?.find(role=>role.id===id);return role?.coreMember===false?guestNames(role.guestNames):[];}))];
  if(item.followMain)return main?resolveGuestNames(main):[];
  return guestNames(item.guestNames??item.guestParticipants?.map(person=>person.name).join('\n'));
}
const participantKeys=task=>[...task.participantIds,...(task.guestParticipants||[]).map(person=>person.id)];
const canProxyFor=(task,id,members)=>!!task.guestParticipants?.some(person=>person.id===id)||task.participantIds.includes(id)&&isSpeaker(members.find(m=>(m.id||m._id)===id)?.role);
module.exports={guestNames,resolveGuestNames,participantKeys,canProxyFor};
