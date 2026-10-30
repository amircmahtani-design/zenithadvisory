-- VAT returns: business expenses (input VAT) and a record of each return filed.

CREATE TABLE expenses (
  id SERIAL PRIMARY KEY,
  spent_on DATE NOT NULL,
  supplier TEXT NOT NULL DEFAULT '',
  supplier_trn TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'other',
  -- uae_vat: UAE supplier charged VAT; no_vat: no VAT charged; abroad: bought from outside the UAE (reverse charge)
  kind TEXT NOT NULL DEFAULT 'uae_vat' CHECK (kind IN ('uae_vat', 'no_vat', 'abroad')),
  net BIGINT NOT NULL DEFAULT 0 CHECK (net >= 0),
  vat BIGINT NOT NULL DEFAULT 0 CHECK (vat >= 0),
  recoverable BOOLEAN NOT NULL DEFAULT true,
  has_tax_invoice BOOLEAN NOT NULL DEFAULT true,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX expenses_date_idx ON expenses (spent_on);

CREATE TABLE vat_returns (
  period_start DATE PRIMARY KEY,
  period_end DATE NOT NULL,
  boxes JSONB,
  filed_on DATE,
  reference TEXT NOT NULL DEFAULT '',
  paid_on DATE,
  notes TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

UPDATE settings SET data = '{
  "vat_first_start": "",
  "vat_first_end": "",
  "vat_period_months": 3,
  "emirate": "Dubai",
  "vat_reminders": true
}'::jsonb || data WHERE id = 1;
