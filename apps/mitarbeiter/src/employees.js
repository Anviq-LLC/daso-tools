export function cleanEmployee(v) {
  const name = String(v?.name ?? '').trim().replace(/\s+/g, ' ');
  const role = String(v?.role ?? '').trim() || 'Monteur';
  if (!name || name.length > 100) throw new Error('Bitte einen Namen mit höchstens 100 Zeichen angeben.');
  if (role.length > 60) throw new Error('Die Funktion darf höchstens 60 Zeichen haben.');
  const email = String(v?.email ?? '').trim().toLowerCase();
  if (email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new Error('Bitte eine gültige E-Mail-Adresse angeben.');
  return { id: v?.id ? String(v.id) : '', name, role, email: email || null };
}

// Employees planning already knows, with their ids, so every other tool keeps pointing at the same person.
export function importRows(planRows, existingIds) {
  const have = new Set(existingIds);
  return planRows.filter((r) => !have.has(r.id)).map((r) => ({ id: r.id, name: r.name, role: r.role || 'Monteur', archived_at: r.archived_at ?? null }));
}
