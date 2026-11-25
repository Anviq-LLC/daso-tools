ALTER TABLE payroll_salaries ADD COLUMN pay_basis TEXT NOT NULL DEFAULT 'fixed' CHECK (pay_basis IN ('fixed', 'hourly'));
