import domain from '../shared/domain.js';
const { ClubError, safeClub } = domain;
const fail = (code, message) => { throw new ClubError(code, message); };
// A parent and the children archived with it share one atomic club version.
// Children archived independently have an earlier version and stay archived.
const archivedTogether = (child, parent) => child.archived && child.parentTaskId === parent._id && Number.isSafeInteger(parent.syncVersion) && parent.syncVersion > 0 && child.syncVersion === parent.syncVersion;

export async function listArchives(db, clubId) {
  const [allTasks, templates] = await Promise.all([db.find('tasks',{clubId}), db.find('templates',{clubId,archived:true})]);
  const byId = new Map(allTasks.map(t=>[t._id,t]));
  const tasks = allTasks.filter(t=>t.archived).map(t=>{
    const parent = t.parentTaskId ? byId.get(t.parentTaskId) : null;
    return { ...t, parentTitle:parent?.title || '', parentArchived:!!parent?.archived,
      parentMissing:!!t.parentTaskId && (!parent || !!parent.parentTaskId),
      restoreChildCount:t.parentTaskId?0:allTasks.filter(child=>archivedTogether(child,t)).length };
  });
  const recent = (a,b) => b.updatedAt-a.updatedAt || a._id.localeCompare(b._id);
  return { tasks:tasks.sort(recent), templates:templates.sort(recent) };
}

// Called only after the admin service checks live same-club privileges, inside
// its SQLite transaction. Versions and all restored records commit together.
export async function restoreArchive(db, action, input, actor, now) {
  const template = action === 'adminRestoreTemplate', collection = template?'templates':'tasks';
  const item = await db.get(collection,template?input.templateId:input.taskId);
  if (!item || item.clubId !== input.clubId) fail('NOT_FOUND', '本社团中没有这项归档内容');
  if (item.revision !== input.revision) fail('CONFLICT', '归档内容已更新，请刷新后重试');
  if (!item.archived) fail('CONFLICT', '这项内容已恢复，请刷新归档列表');
  if (!template && item.parentTaskId) {
    const parent = await db.get('tasks',item.parentTaskId);
    if (!parent || parent.clubId !== item.clubId || parent.parentTaskId) fail('CONFLICT', '主任务不存在，无法单独恢复子任务');
    if (parent.archived) fail('CONFLICT', '请先恢复主任务，再恢复这项子任务');
  }
  const children = !template && !item.parentTaskId ? (await db.find('tasks',{clubId:item.clubId,archived:true})).filter(child=>archivedTogether(child,item)) : [];
  const club = await db.get('clubs',item.clubId);
  if (!club) fail('NOT_FOUND', '社团不存在');
  const baseVersion = club.syncVersion || 0, version = baseVersion+1;
  const updatedClub = {...club,syncVersion:version,[collection+'Version']:version};
  const restored = [];
  for (const record of [item,...children]) {
    const updated = {...record,archived:false,revision:record.revision+1,syncVersion:version,updatedAt:now,...(template?{updatedBy:actor._id}:{})};
    await db.put(collection,record._id,updated); restored.push(updated);
  }
  await db.put('clubs',club._id,updatedClub);
  return {baseVersion,version,club:safeClub(updatedClub),...(template?{template:restored[0]}:{task:restored[0],tasks:restored})};
}
