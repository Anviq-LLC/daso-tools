ALTER TABLE payroll_employees ADD COLUMN removed_from_month TEXT;

CREATE TABLE payroll_revisions (
  id TEXT PRIMARY KEY,
  month TEXT NOT NULL,
  status TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  inputs TEXT NOT NULL,
  released_by TEXT,
  released_at TEXT,
  reopened_by TEXT NOT NULL,
  reopened_at TEXT NOT NULL,
  reason TEXT NOT NULL
);
