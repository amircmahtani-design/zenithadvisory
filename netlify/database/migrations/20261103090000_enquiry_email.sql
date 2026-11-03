-- Website contact form submissions are emailed to this address
UPDATE settings SET data = data || '{"enquiry_email": "ben@zenithadvisory.ae"}'::jsonb WHERE id = 1;
