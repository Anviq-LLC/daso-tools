INSERT INTO employee_terms VALUES ('r1','2027-01-01','{"lohngruppe":7,"surchargeCents":100,"foreman":true,"foremanCostCents":3500,"fixedSalaryCents":null,"bonus":true,"saturday":true}');
INSERT INTO employee_terms VALUES ('r2','2027-01-01','{"lohngruppe":4,"surchargeCents":0,"foreman":false,"foremanCostCents":null,"fixedSalaryCents":null,"bonus":true,"saturday":true}');
INSERT INTO employee_terms VALUES ('r3','2027-01-01','{"lohngruppe":3,"surchargeCents":0,"foreman":false,"foremanCostCents":null,"fixedSalaryCents":null,"bonus":true,"saturday":false}');
INSERT INTO tool_accounts (resource_id, price_cents, monthly_rate_cents, paid_before_cents, prepaid_cents) VALUES ('r2',60000,5000,0,0);
INSERT INTO roles VALUES ('buero@example.test','buchhaltung','Test Buero');
