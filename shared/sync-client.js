'use strict';

// One in-memory board, request and timer shared by all visible pages. Do not
// persist private club snapshots across WeChat account changes or app restarts.
function createSyncClient({ transport, context, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let selected = null, board = null, generation = 0, epoch = 0;
  let inFlight = null, timer = null, timerAt = 0, writes = 0, dirty = false;
  const taskRevisions = new Map();
  let visible = true, online = true, blocked = false;
  let phase = 'idle', message = '', checkedAt = 0, idleCount = 0, failures = 0;
  const listeners = new Set();
  const delay = () => failures ? Math.min(15000 * Math.pow(2, failures), 120000) : idleCount >= 4 ? 60000 : idleCount >= 2 ? 30000 : 15000;
  const active = () => visible && online && !blocked && listeners.size > 0;
  const cancel = () => { if (timer !== null) clearTimer(timer); timer = null; };
  const state = () => ({ board, phase, message, checkedAt, nextDelay: delay() });
  function emit() { for (const listener of listeners) listener(state()); }
  function ensureContext() {
    const next = context();
    if (selected && selected.namespace === next.namespace && selected.clubId === next.clubId) return;
    // bootstrap discovers the first club before the page persists its selection.
    if (selected && selected.namespace === next.namespace && board && board.club && board.club.id === next.clubId) { selected = next; return; }
    selected = next; generation += 1; epoch += 1; cancel();
    board = null; inFlight = null; checkedAt = 0; idleCount = 0; failures = 0; taskRevisions.clear();
    dirty = false; blocked = false; phase = online ? 'idle' : 'offline'; message = '';
  }
  function schedule(keepEarlier = false) {
    const wait = dirty ? 0 : delay();
    if (keepEarlier && timer !== null && timerAt <= now() + wait) return;
    cancel();
    if (!active() || inFlight || writes) return;
    timerAt = now() + wait;
    timer = setTimer(() => { timer = null; refresh({ force: true }).catch(() => {}); }, wait);
  }
  function mergeTasks(current, patches) {
    const tasks = new Map(current.map(task => [task._id, task]));
    for (const task of patches) {
      // Keep tombstone revisions after removal so a late write acknowledgement
      // cannot resurrect a task that another response already archived.
      if ((taskRevisions.get(task._id) || 0) > task.revision) continue;
      taskRevisions.set(task._id, task.revision);
      if (task.archived) tasks.delete(task._id); else tasks.set(task._id, task);
    }
    return Array.from(tasks.values()).sort((a, b) => a.dueAt - b.dueAt);
  }
  function mergeMembers(current, patches) {
    const members = new Map(current.map(member => [member.id, member]));
    for (const member of patches) {
      const previous = members.get(member.id);
      if (!previous || (previous.syncVersion || 0) <= (member.syncVersion || 0)) members.set(member.id, member);
    }
    return Array.from(members.values()).sort((a, b) => a.joinedAt - b.joinedAt);
  }
  function acceptRead(result) {
    if (result.unchanged) return false;
    if (result.full || !board || !result.club) {
      board = Object.assign({}, result, { clubs: result.clubs || (board && board.clubs) || [] });
      taskRevisions.clear();
      for (const task of board.tasks || []) taskRevisions.set(task._id, task.revision);
    } else {
      board = Object.assign({}, board, result, {
        tasks: mergeTasks(board.tasks, result.tasks), members: mergeMembers(board.members, result.members)
      });
    }
    if (board.me && board.members) board.me = board.members.find(m => m.id === board.me.id) || board.me;
    return true;
  }
  function refresh(options = {}) {
    ensureContext();
    if (!online) {
      const error = Object.assign(new Error('网络已断开，请联网后重试'), { code: 'OFFLINE' });
      phase = 'offline'; message = error.message; emit(); return Promise.reject(error);
    }
    if (inFlight) {
      if (options.includeClubs && !inFlight.full) return inFlight.promise.then(() => refresh(options));
      return inFlight.promise;
    }
    if (!options.force && !options.includeClubs && !dirty && board && phase === 'ready' && now() - checkedAt < 10000) return Promise.resolve(board);
    const full = !board || !board.club || options.includeClubs;
    const readGeneration = generation, readEpoch = epoch;
    const input = full ? { clubId: selected.clubId || undefined } : { clubId: board.club.id, since: board.version };
    const ticket = { full, promise: null };
    cancel(); blocked = false; phase = 'syncing'; message = ''; emit();
    ticket.promise = Promise.resolve().then(() => transport(full ? 'bootstrap' : 'sync', input)).then(result => {
      ensureContext();
      if (readGeneration !== generation) throw Object.assign(new Error('社团或身份已切换'), { code: 'STALE_CONTEXT' });
      if (readEpoch !== epoch) { dirty = true; return board; }
      const changed = acceptRead(result);
      idleCount = changed ? 0 : idleCount + 1; failures = 0; dirty = false;
      checkedAt = now(); phase = online ? 'ready' : 'offline'; message = ''; emit();
      return board;
    }).catch(error => {
      if (readGeneration !== generation || error.code === 'STALE_CONTEXT') throw error;
      failures += 1; dirty = false;
      if (['FORBIDDEN', 'UNAUTHENTICATED', 'NOT_FOUND'].includes(error.code)) { board = null; blocked = true; }
      phase = online ? 'error' : 'offline'; message = error.message; emit(); throw error;
    }).finally(() => {
      if (inFlight === ticket) { inFlight = null; schedule(); }
    });
    inFlight = ticket;
    return ticket.promise;
  }
  function acceptMutation(result) {
    if (!board || !board.club || !result.club || result.club.id !== board.club.id) return;
    const patch = {};
    if (result.task) patch.tasks = mergeTasks(board.tasks, [result.task]);
    if (result.member) {
      patch.members = mergeMembers(board.members, [result.member]);
      if (board.me.id === result.member.id) patch.me = patch.members.find(m => m.id === board.me.id);
    }
    // Never advance past unseen intervening writes by another member.
    if (board.version === result.baseVersion) { patch.version = result.version; checkedAt = now(); }
    else if (result.version > board.version) dirty = true;
    if (result.version >= board.version) patch.club = result.club;
    board = Object.assign({}, board, patch);
    phase = online ? 'ready' : 'offline'; message = ''; idleCount = 0; failures = 0;
    emit();
  }
  async function mutate(action, input) {
    ensureContext();
    if (!online) throw Object.assign(new Error('网络已断开，请联网后再操作'), { code: 'OFFLINE' });
    const writeGeneration = generation;
    epoch += 1; writes += 1; cancel();
    try {
      const result = await transport(action, input);
      ensureContext();
      if (writeGeneration !== generation) throw Object.assign(new Error('社团或身份已切换，请在原社团核对操作结果'), { code: 'STALE_CONTEXT' });
      epoch += 1; acceptMutation(result);
      return result;
    } catch (error) {
      // A timed-out write may have committed. Read back, but never retry writes
      // automatically or show a successful completion without an acknowledgement.
      if (writeGeneration === generation) { epoch += 1; dirty = true; }
      throw error;
    } finally { writes -= 1; schedule(); }
  }
  function watch(listener) {
    ensureContext(); listeners.add(listener); listener(state());
    if (visible) refresh().catch(() => {});
    schedule();
    return () => { listeners.delete(listener); if (!listeners.size) cancel(); };
  }
  function setVisible(value) {
    if (visible === value) return;
    visible = value; cancel();
    if (value) { epoch += 1; dirty = true; idleCount = 0; if (active()) refresh({ force: true }).catch(() => {}); }
  }
  function setOnline(value) {
    if (online === value) return;
    online = value; cancel();
    if (!value) { phase = 'offline'; message = '网络已断开'; emit(); }
    else { epoch += 1; dirty = true; idleCount = 0; failures = 0; blocked = false; if (active()) refresh({ force: true }).catch(() => {}); }
  }
  function touch() { idleCount = 0; schedule(true); }
  function select() { ensureContext(); emit(); }
  return { refresh, mutate, watch, setVisible, setOnline, touch, select, getState: () => { ensureContext(); return state(); } };
}
module.exports = { createSyncClient };
