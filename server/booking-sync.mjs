import { timingSafeEqual } from 'node:crypto';
import view from '../shared/view.js';
const {hasDuration}=view;
export function authorized(request,key) {
  const token=request.headers.get('Authorization') || '', expected='Bearer '+key;
  return !!key && Buffer.byteLength(token)===Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(token),Buffer.from(expected));
}
export function createBookingSync(ctx,env,store) {
  const sql=ctx.storage.sql;
  sql.exec(`CREATE TABLE IF NOT EXISTS booking_sync (id INTEGER PRIMARY KEY CHECK(id=1), desired INTEGER NOT NULL,
    delivered INTEGER NOT NULL DEFAULT -1, attempts INTEGER NOT NULL DEFAULT 0, synced_at INTEGER NOT NULL DEFAULT 0)`);
  const configured=()=>!!(env.BOOKING_CLUB_ID && env.BOOKING_SYNC_URL && env.BOOKING_SYNC_KEY);
  const status=()=>sql.exec('SELECT desired,delivered,attempts,synced_at FROM booking_sync WHERE id=1').toArray()[0] || null;
  async function enqueue(result) {
    if (!configured() || result.baseVersion===undefined || result.club?.id!==env.BOOKING_CLUB_ID || !(result.task || result.tasks)) return;
    if ((status()?.delivered ?? -1)>=result.version) return;
    sql.exec('INSERT INTO booking_sync(id,desired) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET desired=MAX(desired,excluded.desired)',result.version);
    if (!await ctx.storage.getAlarm()) await ctx.storage.setAlarm(Date.now()+1000);
  }
  async function reconcile() {
    if (!configured()) throw new Error('Booking integration is not configured');
    const club=await store.get('clubs',env.BOOKING_CLUB_ID);
    if (!club) throw new Error('Configured club does not exist');
    await store.transaction(()=>enqueue({club:{id:club._id},tasks:[],baseVersion:club.syncVersion || 0,version:club.syncVersion || 0}));
  }
  async function deliver() {
    const row=status();
    if (!configured() || !row || row.delivered>=row.desired) return;
    const tasks=await store.find('tasks',{clubId:env.BOOKING_CLUB_ID});
    const events=tasks.filter(t=>!t.archived&&hasDuration(t)).map(t=>({id:t._id,title:t.title,location:t.location || '未定',startsAt:t.startsAt,endsAt:t.endsAt}));
    try {
      const response=await fetch(env.BOOKING_SYNC_URL,{method:'PUT',headers:{Authorization:'Bearer '+env.BOOKING_SYNC_KEY,'Content-Type':'application/json'},
        body:JSON.stringify({sourceId:env.BOOKING_CLUB_ID,version:row.desired,events}),signal:AbortSignal.timeout(15000)});
      const result=await response.json();
      if (!response.ok || !Number.isSafeInteger(result.sourceVersion) || result.sourceVersion<row.desired) throw new Error('Booking sync not acknowledged');
      sql.exec('UPDATE booking_sync SET delivered=MAX(delivered,?),attempts=0,synced_at=? WHERE id=1',row.desired,Date.now());
    } catch {
      // Retry only outstanding changes; never send member/account information.
      sql.exec('UPDATE booking_sync SET attempts=attempts+1 WHERE id=1');
      await ctx.storage.setAlarm(Date.now()+Math.min(3600000,15000*2**Math.min(row.attempts,8)));
      return;
    }
    if (status().desired>row.desired) await ctx.storage.setAlarm(Date.now()+1000);
  }
  return {enqueue,reconcile,deliver,status,configured};
}
