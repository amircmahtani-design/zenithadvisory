-- Per-client document numbering: PI-MPC-001 is the first proforma for that client.
ALTER TABLE clients ADD COLUMN code TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX clients_code_idx ON clients (code) WHERE code <> '';

CREATE TABLE client_counters (
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('proforma', 'invoice', 'credit_note', 'receipt')),
  next_number INTEGER NOT NULL DEFAULT 1 CHECK (next_number > 0),
  PRIMARY KEY (client_id, kind)
);

UPDATE settings SET data = data || '{"numbering": "client"}'::jsonb WHERE id = 1;
