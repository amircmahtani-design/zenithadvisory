-- Structured email signature with logo and disclaimer (replaces the free-text signature)
UPDATE settings SET data = (data - 'email_signature') || '{
  "email_signoff": "Kind regards,",
  "email_sign_name": "",
  "email_sign_title": "",
  "email_sign_department": "Finance Department",
  "email_sign_phone": "",
  "email_disclaimer": "CONFIDENTIALITY NOTICE: This email and any attachments are confidential and intended solely for the named recipient. If you have received it in error, please notify the sender immediately and delete it; any review, use, copying or disclosure is prohibited.\n\nPAYMENT SECURITY: Zenith Advisory Services will never notify you of a change to our bank details by email alone. Before making a payment to new or changed bank details, please confirm them with us by telephone using a number you already hold.\n\nEmails cannot be guaranteed to be secure or free of errors or viruses. Zenith Advisory Services accepts no liability for any loss or damage arising from the use of this email or its attachments. Nothing in this email constitutes professional advice unless confirmed in a formal engagement."
}'::jsonb WHERE id = 1;
