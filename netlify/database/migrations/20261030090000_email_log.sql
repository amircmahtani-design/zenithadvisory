-- Emails sent from the back office (proformas, invoices, receipts, reminders)
CREATE TABLE email_log (
  id SERIAL PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id),
  document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  to_email TEXT NOT NULL,
  cc TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL,
  attachment TEXT NOT NULL DEFAULT '',
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX email_log_document_idx ON email_log (document_id);
CREATE INDEX email_log_client_idx ON email_log (client_id);

-- Default email wording, editable in Business settings
UPDATE settings SET data = data || '{
  "email_from_name": "Zenith Advisory Services",
  "email_signature": "Kind regards,\nFinance\nZenith Advisory Services\nfinance@zenithadvisory.ae",
  "email_proforma_subject": "Proforma invoice {number} from Zenith Advisory Services",
  "email_proforma_body": "Dear {name},\n\nPlease find attached proforma invoice {number} for {currency} {total}.\n\nKindly arrange payment by {due_date}. Bank details are shown on the proforma; please quote {number} as your payment reference.\n\nIf you have any questions, simply reply to this email.",
  "email_invoice_subject": "Invoice {number} from Zenith Advisory Services",
  "email_invoice_body": "Dear {name},\n\nPlease find attached invoice {number} for {currency} {total}, due on {due_date}.\n\nBank details are shown on the invoice; please quote {number} as your payment reference.\n\nThank you for your business.",
  "email_receipt_subject": "Payment received: receipt {number}",
  "email_receipt_body": "Dear {name},\n\nThank you for your payment of {currency} {amount}, received on {date}. Your receipt {number} is attached.\n\nRemaining balance: {currency} {balance}.",
  "email_reminder_subject": "Reminder: {number} for {currency} {balance}",
  "email_reminder_body": "Dear {name},\n\nThis is a friendly reminder that {number} for {currency} {balance} was due on {due_date}. The document is attached again for convenience.\n\nIf payment has already been made, thank you, and please disregard this message."
}'::jsonb WHERE id = 1;
