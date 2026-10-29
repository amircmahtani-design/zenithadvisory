-- Zenith back office: initial schema.
-- Money is stored as integer fils (AED x 100). VAT rates as basis points (5% = 500).

CREATE TABLE settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO settings (id, data) VALUES (1, '{
  "legal_name": "Zenith Advisory Services",
  "address": "",
  "email": "enquiries@zenithadvisory.ae",
  "phone": "",
  "website": "zenithadvisory.ae",
  "trn": "",
  "vat_registered": false,
  "bank_name": "",
  "account_name": "",
  "account_number": "",
  "iban": "",
  "swift": "",
  "payment_instructions": "Please include the document number as your payment reference.",
  "currency": "AED",
  "default_vat_bp": 500,
  "prices_include_vat": false,
  "payment_terms": "Payment is due within 14 days of the document date.",
  "invoice_due_days": 14,
  "proforma_valid_days": 30,
  "prefix_proforma": "PI-",
  "prefix_invoice": "INV-",
  "prefix_credit_note": "CN-",
  "prefix_receipt": "R-",
  "logo_data_url": ""
}'::jsonb);

-- Sequential numbering. Rows are locked with SELECT ... FOR UPDATE when a number is issued.
CREATE TABLE counters (
  kind TEXT PRIMARY KEY,
  next_number INTEGER NOT NULL CHECK (next_number > 0)
);
INSERT INTO counters (kind, next_number) VALUES ('proforma', 1), ('invoice', 1), ('credit_note', 1), ('receipt', 1);

CREATE TABLE clients (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  contact_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  trn TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE documents (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('proforma', 'invoice', 'credit_note')),
  status TEXT NOT NULL,
  number TEXT UNIQUE,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  issue_date DATE NOT NULL,
  due_date DATE,
  supply_date DATE,
  currency TEXT NOT NULL DEFAULT 'AED',
  prices_include_vat BOOLEAN NOT NULL DEFAULT false,
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT NOT NULL DEFAULT '',
  payment_terms TEXT NOT NULL DEFAULT '',
  subtotal BIGINT NOT NULL DEFAULT 0,
  vat_total BIGINT NOT NULL DEFAULT 0,
  total BIGINT NOT NULL DEFAULT 0,
  related_id INTEGER REFERENCES documents(id),
  snapshot JSONB,
  issued_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX documents_client_idx ON documents (client_id);
CREATE INDEX documents_related_idx ON documents (related_id);

CREATE TABLE payments (
  id SERIAL PRIMARY KEY,
  receipt_number TEXT NOT NULL UNIQUE,
  document_id INTEGER NOT NULL REFERENCES documents(id),
  client_id INTEGER NOT NULL REFERENCES clients(id),
  paid_on DATE NOT NULL,
  amount BIGINT NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payments_document_idx ON payments (document_id);

CREATE TABLE enquiries (
  id SERIAL PRIMARY KEY,
  service TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  page TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',
  ip_hash TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rate_events (
  bucket TEXT NOT NULL,
  key TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX rate_events_idx ON rate_events (bucket, key, at);
