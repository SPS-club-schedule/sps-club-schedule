const COLLECTIONS = new Set(['clubs', 'members', 'tasks', 'invites', 'templates']);
const COLUMNS = { clubId: 'club_id', identity: 'identity', archived: 'archived' };
export function createStore(storage) {
  const sql = storage.sql;
  sql.exec(`CREATE TABLE IF NOT EXISTS records (
    collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
    club_id TEXT, identity TEXT, sync_version INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(collection,id)
  );
  CREATE INDEX IF NOT EXISTS records_club ON records(collection,club_id,archived);
  CREATE INDEX IF NOT EXISTS records_changes ON records(collection,club_id,sync_version);
  CREATE INDEX IF NOT EXISTS records_identity ON records(collection,identity);`);
  let depth = 0;
  function collection(name) { if (!COLLECTIONS.has(name)) throw new Error('Unknown collection'); }
  function query(name, fields, since) {
    collection(name); const where = ['collection = ?'], params = [name];
    for (const [key, value] of Object.entries(fields)) {
      if (!COLUMNS[key]) throw new Error('Unknown query field');
      where.push(COLUMNS[key] + ' = ?'); params.push(typeof value === 'boolean' ? Number(value) : value);
    }
    if (since !== undefined) { where.push('sync_version > ?'); params.push(since); }
    return sql.exec(`SELECT data FROM records WHERE ${where.join(' AND ')} ORDER BY id`, ...params).toArray().map(row => JSON.parse(row.data));
  }
  const store = {
    async get(name, id) {
      collection(name); if (typeof id !== 'string') return null;
      const row = sql.exec('SELECT data FROM records WHERE collection = ? AND id = ?', name, id).toArray()[0];
      return row ? JSON.parse(row.data) : null;
    },
    async put(name, id, value) {
      collection(name); const data = { ...value, _id: id };
      sql.exec(`INSERT INTO records(collection,id,data,club_id,identity,sync_version,archived)
        VALUES(?,?,?,?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET
        data=excluded.data,club_id=excluded.club_id,identity=excluded.identity,
        sync_version=excluded.sync_version,archived=excluded.archived`,
      name, id, JSON.stringify(data), data.clubId || null, data.identity || null, data.syncVersion || 0, Number(!!data.archived));
    },
    async remove(name, id) { collection(name); sql.exec('DELETE FROM records WHERE collection = ? AND id = ?', name, id); },
    async find(name, fields) { return query(name, fields); },
    async findSince(name, fields, since) { return query(name, fields, since); },
    async transaction(work) {
      if (depth) return work(store);
      return storage.transaction(async () => {
        depth++;
        try { return await work(store); } finally { depth--; }
      });
    }
  };
  return store;
}
