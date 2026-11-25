// ponytail: one JSON row, D1 row limit is about 2 MB; split per top-level key if it grows.
const MAX = 1_500_000;

export async function loadState(db) {
  const row = await db.prepare("SELECT data, token FROM state WHERE id = 'main'").first();
  return row ? { state: JSON.parse(row.data), token: row.token } : { state: null, token: 'initial' };
}

// Writes only if the caller saw the latest version. 'initial' matches only an empty table.
export async function saveState(db, data, expected, email) {
  if (data.length > MAX) return { status: 413 };
  const token = crypto.randomUUID();
  const r = await db.prepare(
    `INSERT INTO state (id, data, token, updated_at, updated_by)
     SELECT 'main', ?, ?, ?, ? WHERE COALESCE((SELECT token FROM state WHERE id = 'main'), 'initial') = ?
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, token = excluded.token, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).bind(data, token, new Date().toISOString(), email, expected).run();
  return r.meta.changes ? { status: 200, token } : { status: 409 };
}
