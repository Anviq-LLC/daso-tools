// Same rule Lohn uses to decide who is office staff. Keep both in step.
export const isOfficeRole = (role) => /büro|buero|office|verwaltung|geschäftsführ|geschaeftsfuehr|buchhalt|assistenz/i.test(role || '');

export const TYPES = ['vacation', 'unpaid', 'sick', 'homeoffice', 'other'];
export const SELF_TYPES = ['sick', 'homeoffice', 'other'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function validDay(s) {
  return DAY.test(s) && !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
}

export function workdays(start, end) {
  const days = [];
  for (let t = Date.parse(start); t <= Date.parse(end) && days.length < 400; t += 86400000) {
    const wd = new Date(t).getUTCDay();
    if (wd !== 0 && wd !== 6) days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

export function cleanAbsence(v, allowed) {
  const type = String(v?.type ?? '');
  const label = String(v?.label ?? '').trim().slice(0, 60);
  if (!validDay(v?.day)) throw new Error('Bitte ein gültiges Datum angeben.');
  if (!allowed.includes(type)) throw new Error('Diese Art von Eintrag darfst du nicht anlegen.');
  if (type === 'other' && !label) throw new Error('Bitte eine Bezeichnung eingeben, z. B. Seminar.');
  return { day: v.day, type, label: type === 'other' ? label : '' };
}

// Pause in minutes; it can never be longer than the shift itself.
export function cleanPause(pause, started, ended) {
  if (pause === null || pause === undefined || pause === '') return null;
  const n = Number(pause);
  if (!Number.isInteger(n) || n < 0 || n > 10080) throw new Error('Bitte eine gültige Pause in Minuten angeben.');
  if (n * 60000 > Date.parse(ended) - Date.parse(started)) throw new Error('Die Pause darf nicht länger als die Anwesenheit sein.');
  return n;
}

export function cleanVacation(v, today, existingOverlap) {
  if (!validDay(v?.start) || !validDay(v?.end)) throw new Error('Bitte gültige Daten angeben.');
  if (v.end < v.start) throw new Error('Das Ende liegt vor dem Beginn.');
  if (v.start < today) throw new Error('Der Beginn liegt in der Vergangenheit.');
  if (Date.parse(v.end) - Date.parse(v.start) > 59 * 86400000) throw new Error('Bitte höchstens 60 Tage pro Antrag wählen.');
  if (!workdays(v.start, v.end).length) throw new Error('Im Zeitraum liegt kein Arbeitstag.');
  if (existingOverlap) throw new Error('Für diesen Zeitraum gibt es schon einen Antrag.');
  return { start: v.start, end: v.end, note: String(v.note ?? '').trim().slice(0, 200) };
}
