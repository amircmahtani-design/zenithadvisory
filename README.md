# Zenith Advisory Services

Public website for **zenithadvisory.ae** and a private back office for proformas, invoices, credit notes and receipts.

Deployed by Netlify from the `main` branch of this repository. There is no build step for the pages: they are plain HTML, CSS and JavaScript. The back office uses one Netlify Function (`netlify/functions/api.mts`) and Netlify Database (Postgres).

## What is where

| Path | What it is |
| --- | --- |
| `index.html`, `advisory.html`, `website-design.html`, `work.html`, `about.html`, `contact.html`, `privacy.html`, `terms.html`, `404.html` | Public pages |
| `assets/css/site.css`, `assets/js/site.js` | Shared styles and script for the public pages |
| `assets/img/` | Logo (vector, traced from the original artwork), photography, portfolio screenshots, favicons |
| `admin/` | The back office at `/admin` (single page app) |
| `admin/js/calc.js` | VAT and money maths, shared by the browser and the API so totals always agree |
| `admin/js/doc.js`, `admin/js/pdf.js` | Document layout, on-screen preview and PDF generation (pdf-lib, vendored in `admin/vendor/`) |
| `netlify/functions/api.mts` | API: sign-in, clients, documents, payments, enquiries, settings, backup |
| `netlify/database/migrations/` | Database schema, applied automatically by Netlify on deploy |
| `netlify.toml` | Redirects from the old page addresses, security headers, back office routing |
| `scripts/dev-server.mjs` | Local preview with an embedded database |

## One-time setup in Netlify

1. **Admin password.** In Netlify: *Project configuration → Environment variables → Add a variable*.
   - Key: `ADMIN_PASSWORD`
   - Value: a long password of your choice (at least 12 characters). Mark it as secret.
   - Scope: Functions. Then trigger a redeploy (*Deploys → Trigger deploy*).

   Changing this password later signs out every open session.
2. **Database.** Netlify Database is provisioned automatically on the first deploy because `@netlify/database` is a dependency. It needs a credit-based Netlify plan; if a deploy reports that the database feature is not available, the plan must be upgraded or the storage switched.
3. **Optional email alerts for website enquiries.** Enquiries always appear in the back office under *Enquiries*. To also receive an email, add `RESEND_API_KEY` (from resend.com), `NOTIFY_EMAIL` (where to send) and optionally `NOTIFY_FROM` (a verified sender such as `Zenith website <website@zenithadvisory.ae>`).

4. **Email from finance@zenithadvisory.ae (Google Workspace).** The back office sends proformas, invoices, receipts and reminders through your own Workspace mailbox, so they appear in its Sent folder and replies come back to you.
   1. In the Google Admin console, add `finance@zenithadvisory.ae` as an **alias** of your mailbox (Users → your user → Add alternate emails). Google already handles your domain's mail, so no new DNS records are needed.
   2. In Gmail on that mailbox: Settings → Accounts → **Send mail as** → add `finance@zenithadvisory.ae` (tick "Treat as an alias").
   3. Turn on 2-Step Verification for that Google account, then create an **App password** at myaccount.google.com/apppasswords (name it "Zenith website").
   4. In Netlify → Environment variables, add (scope: Functions), then redeploy:
      - `SMTP_USER` = your full Workspace address (the real mailbox, e.g. amir@zenithadvisory.ae)
      - `SMTP_PASS` = the 16-character app password (mark as secret)
      - `MAIL_FROM` = `finance@zenithadvisory.ae`

   Until these are set, "Email to client" opens your own mail app with the wording filled in, and you attach the downloaded PDF yourself.

Then open `https://zenithadvisory.ae/admin` (or `https://zenithadvisory.ae/office`, which goes to the same place), sign in, and fill in **Business settings**: address, TRN, bank name, account holder, IBAN and SWIFT. Until then, documents show clear placeholders such as `[ADD TRN]` and `[ADD IBAN]`.

## How documents work

- **Proforma**: numbered when created (`PI-001`…). Editable until a payment is recorded or it is converted. Status: draft, sent, accepted, expired, converted; paid or part paid once payments are recorded. Always states that it is a proforma and not a tax invoice.
- **Invoice**: saved as a draft without a number, then **issued**, which gives it the next number (`INV-001`…) and freezes a snapshot of your business and client details. Issued invoices cannot be edited or deleted; corrections are made with a **credit note** (`CN-001`…). Titled “Tax Invoice” only when *Registered for VAT* is ticked and a TRN is entered.
- **Receipt**: created only by recording a payment (`R-001`…), full or partial, against a proforma or an issued invoice. Payments taken on a proforma count towards the invoice it is converted into.
- **VAT**: 5% by default and configurable. Each line can be standard rated, zero rated, exempt or outside the scope of VAT. Prices can be entered before VAT or including VAT. Amounts are stored in fils, so there are no rounding drifts.
- **Receivables**: who owes what and when, grouped into overdue, next 7 days, within 30 days and later, with Email / Remind / Paid on every row.
- **Email**: every proforma, invoice and receipt has *Email to client*; overdue documents also have *Send reminder*. The standard wording for each is editable in Business settings, and every email sent is logged on the document.
- **CSV export**: Clients, Invoices, Receipts and Receivables each have *Export CSV*, which opens in Excel or Numbers.
- **Backup**: *Business settings → Download a full backup (JSON)*.

- **FTA rules** (VAT Executive Regulation, Articles 59 and 60): tax invoices show every required particular, including per-line discount, taxable amount, VAT rate and VAT amount, with totals in AED. Issuing is blocked while your address, or a VAT-registered client's address, is missing; the currency must be AED while VAT registered; a warning appears when an invoice is issued more than 14 days after the date of supply. Tax credit notes show the original invoice, its value, the corrected value, the difference, the VAT on it and a required reason.
- **E-invoicing**: from 1 July 2027, B2B and B2G invoices must go through an FTA-accredited e-invoicing service provider (businesses under AED 50 million appoint one by 31 March 2027). From then on, the PDFs are copies, not the legal invoice.

## Running locally

```bash
npm install
ADMIN_PASSWORD="any-local-password" npm run dev
# open http://localhost:8888 and http://localhost:8888/admin
```

Local data lives in `.netlify/db` (ignored by Git) and never touches the live site. Delete that folder to start again.

## Security notes

- The back office pages contain no data; everything is fetched from the API after sign-in.
- Sessions are signed, HttpOnly, Secure, SameSite=Strict cookies valid for 12 hours. Cross-site writes are rejected.
- Sign-in is limited to 8 failed attempts per 15 minutes; the enquiry form to 5 messages per hour per visitor, with a spam honeypot.
- `/admin` and `/api` are excluded from search engines.
