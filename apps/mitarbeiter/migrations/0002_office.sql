ALTER TABLE employees ADD COLUMN email TEXT;
CREATE UNIQUE INDEX employees_email ON employees (lower(email)) WHERE email IS NOT NULL;
CREATE TABLE punches (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  started TEXT NOT NULL,
  ended TEXT,
  pause INTEGER,
  report TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX one_open_punch ON punches (employee_id) WHERE ended IS NULL;
CREATE INDEX punches_started ON punches (started);
CREATE TABLE absences (
  employee_id TEXT NOT NULL,
  day TEXT NOT NULL,
  type TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (employee_id, day)
);
CREATE TABLE vacation_requests (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  start_day TEXT NOT NULL,
  end_day TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT NOT NULL DEFAULT ''
);
