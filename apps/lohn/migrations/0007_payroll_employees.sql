CREATE TABLE payroll_employees (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  from_month TEXT NOT NULL
);
CREATE TABLE payroll_salaries (
  resource_id TEXT NOT NULL,
  from_month TEXT NOT NULL,
  cents INTEGER NOT NULL,
  PRIMARY KEY (resource_id, from_month)
);
