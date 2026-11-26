// ponytail: one JSON row per id, D1 row limit is about 2 MB; split per top-level key if it grows.
const MAX = 1_500_000;

export async function loadRow(db, id) {
  const row = await db.prepare('SELECT data, token FROM state WHERE id = ?').bind(id).first();
  return row ? { state: JSON.parse(row.data), token: row.token } : { state: null, token: 'initial' };
}

// Writes only if the caller saw the latest version. 'initial' matches only an empty row.
export async function saveRow(db, id, data, expected, email) {
  if (data.length > MAX) return { status: 413 };
  const token = crypto.randomUUID();
  const r = await db.prepare(
    `INSERT INTO state (id, data, token, updated_at, updated_by)
     SELECT ?, ?, ?, ?, ? WHERE COALESCE((SELECT token FROM state WHERE id = ?), 'initial') = ?
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, token = excluded.token, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).bind(id, data, token, new Date().toISOString(), email, id, expected).run();
  return r.meta.changes ? { status: 200, token } : { status: 409 };
}

export const loadState = (db) => loadRow(db, 'main');
export const saveState = (db, data, expected, email) => saveRow(db, 'main', data, expected, email);
