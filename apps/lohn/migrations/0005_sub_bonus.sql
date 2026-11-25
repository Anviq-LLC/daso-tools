CREATE TABLE sub_bonus_amounts (
  month TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  item TEXT NOT NULL,
  cents INTEGER NOT NULL CHECK (cents >= 0),
  PRIMARY KEY (month, resource_id, item)
);
