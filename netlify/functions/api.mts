// Zenith back office API.
// Public: POST /api/enquiry, POST /api/login, POST /api/logout, GET /api/session.
// Everything else requires the signed session cookie set by /api/login.
import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import nodemailer from "nodemailer";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  computeTotals, normaliseLines, documentBalance, formatNumber, todayUAE, addDays,
} from "../../admin/js/calc.js";

const db = getDatabase();
const COOKIE = "__Host-za_session";
const SESSION_HOURS = 12;

type Q = (text: string, params?: unknown[]) => Promise<any[]>;

// ---------------------------------------------------------------- helpers

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", ...headers },
  });

const q: Q = async (text, params = []) => (await db.pool.query(text, params)).rows;

async function tx<T>(fn: (q: Q) => Promise<T>): Promise<T> {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(async (text, params = []) => (await client.query(text, params)).rows);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

const str = (v: unknown, max = 500) => String(v ?? "").trim().slice(0, max);
const isDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const sha = (s: string) => createHash("sha256").update(s).digest();

// Columns are cast so dates arrive as YYYY-MM-DD strings and money as numbers.
const DOC_COLS = `id, type, status, number, client_id, issue_date::text, due_date::text, supply_date::text, currency,
  prices_include_vat, lines, notes, payment_terms, subtotal::float8 AS subtotal, vat_total::float8 AS vat_total,
  total::float8 AS total, related_id, snapshot, issued_at, created_at, updated_at`;
const PAY_COLS = `id, receipt_number, document_id, client_id, paid_on::text, amount::float8 AS amount, method, reference, notes, snapshot, created_at`;

// ---------------------------------------------------------------- auth

function adminPassword() {
  return Netlify.env.get("ADMIN_PASSWORD") || "";
}

function sessionKey() {
  // Derived from the password, so changing ADMIN_PASSWORD signs everyone out.
  return sha("zenith-session-v1:" + adminPassword());
}

function sign(payload: string) {
  return createHmac("sha256", sessionKey()).update(payload).digest("base64url");
}

function makeToken() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_HOURS * 3600 * 1000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function validToken(token?: string) {
  if (!token || !adminPassword()) return false;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return false;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString()).exp > Date.now();
  } catch {
    return false;
  }
}

function sessionCookie(value: string, maxAge: number) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function ipKey(context: Context) {
  return createHash("sha256").update("zenith-ip:" + (context.ip || "unknown")).digest("hex").slice(0, 32);
}

async function rateLimited(bucket: string, key: string, limit: number, minutes: number) {
  const rows = await q(
    `SELECT count(*)::int AS n FROM rate_events WHERE bucket = $1 AND key = $2 AND at > now() - make_interval(mins => $3)`,
    [bucket, key, minutes],
  );
  return rows[0].n >= limit;
}

async function recordEvent(bucket: string, key: string) {
  await q(`INSERT INTO rate_events (bucket, key) VALUES ($1, $2)`, [bucket, key]);
  if (Math.random() < 0.05) await q(`DELETE FROM rate_events WHERE at < now() - interval '2 days'`);
}

// ---------------------------------------------------------------- data access

async function getSettings(qq: Q = q) {
  return (await qq(`SELECT data FROM settings WHERE id = 1`))[0]?.data || {};
}

async function nextNumber(qq: Q, kind: "proforma" | "invoice" | "credit_note" | "receipt", settings: any) {
  const row = (await qq(`SELECT next_number FROM counters WHERE kind = $1 FOR UPDATE`, [kind]))[0];
  const n = row.next_number;
  await qq(`UPDATE counters SET next_number = $2 WHERE kind = $1`, [kind, n + 1]);
  const prefix = settings[`prefix_${kind}`] ?? "";
  return formatNumber(prefix, n);
}

async function getDoc(qq: Q, id: number, lock = false) {
  const doc = (await qq(`SELECT ${DOC_COLS} FROM documents WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id]))[0];
  if (!doc) throw new HttpError(404, "Document not found.");
  return doc;
}

async function getClient(qq: Q, id: number) {
  const c = (await qq(`SELECT * FROM clients WHERE id = $1`, [id]))[0];
  if (!c) throw new HttpError(400, "Please choose a client.");
  return c;
}

function supplierSnapshot(s: any) {
  const keys = ["legal_name", "address", "email", "phone", "website", "trn", "vat_registered", "bank_name", "account_name",
    "account_number", "iban", "swift", "payment_instructions", "logo_data_url"];
  return Object.fromEntries(keys.map((k) => [k, s[k] ?? ""]));
}

function clientSnapshot(c: any) {
  return { name: c.name, contact_name: c.contact_name, email: c.email, phone: c.phone, address: c.address, trn: c.trn };
}

async function balanceFor(qq: Q, doc: any) {
  const ids = [doc.id, doc.related_id].filter(Boolean);
  const payments = await qq(`SELECT ${PAY_COLS} FROM payments WHERE document_id = ANY($1::int[])`, [ids]);
  const credits = await qq(`SELECT ${DOC_COLS} FROM documents WHERE type = 'credit_note' AND related_id = $1`, [doc.id]);
  return documentBalance(doc, credits, payments);
}

// Validates and prices an incoming document body.
function readDocBody(body: any, settings: any) {
  const defaultBp = Number.isInteger(settings.default_vat_bp) ? settings.default_vat_bp : 500;
  const lines = normaliseLines(body.lines, defaultBp);
  if (!lines.length) throw new HttpError(400, "Add at least one line with a description and price.");
  if (lines.some((l) => !l.description)) throw new HttpError(400, "Every line needs a description.");
  const issue_date = isDate(body.issue_date) ? body.issue_date : todayUAE();
  const due_date = isDate(body.due_date) ? body.due_date : null;
  const supply_date = isDate(body.supply_date) ? body.supply_date : null;
  const prices_include_vat = !!body.prices_include_vat;
  const totals = computeTotals(lines, prices_include_vat, defaultBp);
  return {
    client_id: Number(body.client_id),
    issue_date, due_date, supply_date, prices_include_vat, lines,
    notes: str(body.notes, 2000),
    payment_terms: str(body.payment_terms, 1000),
    subtotal: totals.subtotal, vat_total: totals.vat, total: totals.total,
  };
}

// ---------------------------------------------------------------- handlers

async function handleEnquiry(req: Request, context: Context) {
  const body = await req.json().catch(() => ({}));
  if (str(body.website)) return json({ ok: true }); // honeypot: quietly accept bots
  const name = str(body.name, 200), email = str(body.email, 200), message = str(body.message, 5000);
  if (!name || !message || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return json({ error: "Please complete your name, a valid email address and your message." }, 400);
  }
  const key = ipKey(context);
  if (await rateLimited("enquiry", key, 5, 60)) {
    return json({ error: "We have received several messages from you already. Please email enquiries@zenithadvisory.ae directly." }, 429);
  }
  await recordEvent("enquiry", key);
  const service = ["advisory", "website", "both", "unsure"].includes(body.service) ? body.service : "";
  await q(
    `INSERT INTO enquiries (service, name, email, company, phone, message, page, ip_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [service, name, email, str(body.company, 200), str(body.phone, 60), message, str(body.page, 200), key],
  );
  const resendKey = Netlify.env.get("RESEND_API_KEY"), to = Netlify.env.get("NOTIFY_EMAIL");
  if (resendKey && to) {
    context.waitUntil(fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: Netlify.env.get("NOTIFY_FROM") || "Zenith website <onboarding@resend.dev>",
        to: [to], reply_to: email,
        subject: `New website enquiry from ${name}`,
        text: `${name} <${email}>\nCompany: ${str(body.company)}\nPhone: ${str(body.phone)}\nInterest: ${service || "not given"}\n\n${message}`,
      }),
    }).catch(() => {}));
  }
  return json({ ok: true }, 201);
}

async function handleLogin(req: Request, context: Context) {
  if (!adminPassword() || adminPassword().length < 12) {
    return json({ error: "The back office is not set up yet. Add an ADMIN_PASSWORD (12+ characters) in Netlify environment variables." }, 503);
  }
  const key = ipKey(context);
  if (await rateLimited("login", key, 8, 15)) {
    return json({ error: "Too many attempts. Please wait 15 minutes and try again." }, 429);
  }
  const body = await req.json().catch(() => ({}));
  const ok = timingSafeEqual(sha(String(body.password ?? "")), sha(adminPassword()));
  if (!ok) {
    await recordEvent("login", key);
    return json({ error: "That password is not correct." }, 401);
  }
  return json({ ok: true }, 200, { "set-cookie": sessionCookie(makeToken(), SESSION_HOURS * 3600) });
}

async function bootstrap() {
  const [settings, counters, clients, documents, payments, enquiries] = await Promise.all([
    getSettings(),
    q(`SELECT kind, next_number FROM counters`),
    q(`SELECT * FROM clients ORDER BY lower(name)`),
    q(`SELECT ${DOC_COLS} FROM documents ORDER BY issue_date DESC, id DESC`),
    q(`SELECT ${PAY_COLS} FROM payments ORDER BY paid_on DESC, id DESC`),
    q(`SELECT id, service, name, email, company, phone, message, page, status, created_at FROM enquiries ORDER BY created_at DESC`),
  ]);
  const emails = await q(`SELECT id, client_id, document_id, payment_id, kind, to_email, cc, subject, attachment, sent_at FROM email_log ORDER BY sent_at DESC`);
  return { settings, counters: Object.fromEntries(counters.map((c: any) => [c.kind, c.next_number])), clients, documents, payments, enquiries, emails,
    mail: { configured: mailConfigured(), from: mailFrom(settings) } };
}

const SETTING_KEYS: Record<string, "text" | "bool" | "int"> = {
  legal_name: "text", address: "text", email: "text", phone: "text", website: "text", trn: "text", vat_registered: "bool",
  bank_name: "text", account_name: "text", account_number: "text", iban: "text", swift: "text", payment_instructions: "text",
  currency: "text", default_vat_bp: "int", prices_include_vat: "bool", payment_terms: "text", invoice_due_days: "int",
  proforma_valid_days: "int", prefix_proforma: "text", prefix_invoice: "text", prefix_credit_note: "text", prefix_receipt: "text",
  email_from_name: "text", email_signoff: "text", email_sign_name: "text", email_sign_title: "text", email_sign_department: "text",
  email_sign_phone: "text", email_disclaimer: "text",
  email_proforma_subject: "text", email_proforma_body: "text", email_invoice_subject: "text", email_invoice_body: "text",
  email_receipt_subject: "text", email_receipt_body: "text", email_reminder_subject: "text", email_reminder_body: "text",
};

async function saveSettings(body: any) {
  const current = await getSettings();
  const next: any = { ...current };
  for (const [k, t] of Object.entries(SETTING_KEYS)) {
    if (!(k in body)) continue;
    if (t === "bool") next[k] = !!body[k];
    else if (t === "int") {
      const n = Math.round(Number(body[k]));
      if (!Number.isFinite(n) || n < 0 || n > 100000) throw new HttpError(400, `Please check the value for ${k.replace(/_/g, " ")}.`);
      next[k] = n;
    } else next[k] = str(body[k], 4000);
  }
  if (next.default_vat_bp > 10000) throw new HttpError(400, "VAT rate must be between 0% and 100%.");
  next.currency = (next.currency || "AED").toUpperCase().slice(0, 3);
  next.trn = String(next.trn || "").replace(/\s+/g, "");
  if (next.trn && !/^\d{15}$/.test(next.trn)) throw new HttpError(400, "A UAE TRN has 15 digits. Please check it, or leave it blank.");
  if ("logo_data_url" in body) {
    const logo = String(body.logo_data_url || "");
    if (logo && (!/^data:image\/(png|jpeg);base64,/.test(logo) || logo.length > 600000)) {
      throw new HttpError(400, "The logo must be a PNG or JPEG under about 400 KB.");
    }
    next.logo_data_url = logo;
  }
  await tx(async (qq) => {
    await qq(`UPDATE settings SET data = $1::jsonb, updated_at = now() WHERE id = 1`, [JSON.stringify(next)]);
    if (body.counters && typeof body.counters === "object") {
      for (const kind of ["proforma", "invoice", "credit_note", "receipt"]) {
        if (body.counters[kind] === undefined) continue;
        const n = Math.round(Number(body.counters[kind]));
        if (!Number.isFinite(n) || n < 1) throw new HttpError(400, "Next numbers must be 1 or more.");
        await qq(`UPDATE counters SET next_number = $2 WHERE kind = $1`, [kind, n]);
      }
    }
  });
  return { ok: true };
}

function readClient(body: any) {
  const c = {
    name: str(body.name, 200), contact_name: str(body.contact_name, 200), email: str(body.email, 200),
    phone: str(body.phone, 60), address: str(body.address, 1000), trn: str(body.trn, 40).replace(/\s+/g, ""), notes: str(body.notes, 4000),
  };
  if (!c.name) throw new HttpError(400, "Please enter the client or business name.");
  if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.email)) throw new HttpError(400, "Please check the client email address.");
  if (c.trn && !/^\d{15}$/.test(c.trn)) throw new HttpError(400, "A UAE TRN has 15 digits. Please check it, or leave it blank.");
  return c;
}

async function createDocument(body: any) {
  const type = body.type === "invoice" ? "invoice" : "proforma";
  return tx(async (qq) => {
    const settings = await getSettings(qq);
    const d = readDocBody(body, settings);
    await getClient(qq, d.client_id);
    const number = type === "proforma" ? await nextNumber(qq, "proforma", settings) : null;
    const due = d.due_date || addDays(d.issue_date, type === "proforma" ? settings.proforma_valid_days ?? 30 : settings.invoice_due_days ?? 14);
    const row = (await qq(
      `INSERT INTO documents (type, status, number, client_id, issue_date, due_date, supply_date, currency, prices_include_vat, lines, notes,
         payment_terms, subtotal, vat_total, total)
       VALUES ($1,'draft',$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14) RETURNING id`,
      [type, number, d.client_id, d.issue_date, due, d.supply_date, settings.currency || "AED", d.prices_include_vat,
        JSON.stringify(d.lines), d.notes, d.payment_terms, d.subtotal, d.vat_total, d.total],
    ))[0];
    return getDoc(qq, row.id);
  });
}

async function updateDocument(id: number, body: any) {
  return tx(async (qq) => {
    const doc = await getDoc(qq, id, true);
    if (doc.type === "invoice" && doc.status !== "draft") throw new HttpError(409, "Issued invoices cannot be edited. Create a credit note to correct it.");
    if (doc.type === "credit_note") throw new HttpError(409, "Credit notes cannot be edited.");
    if (doc.type === "proforma") {
      if (doc.status === "converted") throw new HttpError(409, "This proforma has been converted to an invoice and can no longer be edited.");
      const paid = await qq(`SELECT 1 FROM payments WHERE document_id = $1 LIMIT 1`, [id]);
      if (paid.length) throw new HttpError(409, "A payment has been recorded against this proforma, so it can no longer be edited.");
    }
    const settings = await getSettings(qq);
    const d = readDocBody(body, settings);
    await getClient(qq, d.client_id);
    await qq(
      `UPDATE documents SET client_id=$2, issue_date=$3, due_date=$4, supply_date=$5, prices_include_vat=$6, lines=$7::jsonb, notes=$8,
         payment_terms=$9, subtotal=$10, vat_total=$11, total=$12, snapshot=NULL, updated_at=now() WHERE id=$1`,
      [id, d.client_id, d.issue_date, d.due_date, d.supply_date, d.prices_include_vat, JSON.stringify(d.lines), d.notes, d.payment_terms,
        d.subtotal, d.vat_total, d.total],
    );
    return getDoc(qq, id);
  });
}

async function snapshotFor(qq: Q, doc: any) {
  const settings = await getSettings(qq);
  const client = await getClient(qq, doc.client_id);
  return { settings, snap: { supplier: supplierSnapshot(settings), client: clientSnapshot(client), taken_at: new Date().toISOString() } };
}

async function issueInvoice(id: number) {
  return tx(async (qq) => {
    const doc = await getDoc(qq, id, true);
    if (doc.type !== "invoice" || doc.status !== "draft") throw new HttpError(409, "Only draft invoices can be issued.");
    if (doc.total <= 0) throw new HttpError(400, "An invoice total must be more than zero.");
    const { settings, snap } = await snapshotFor(qq, doc);
    const number = await nextNumber(qq, "invoice", settings);
    await qq(`UPDATE documents SET status='issued', number=$2, snapshot=$3::jsonb, issued_at=now(), updated_at=now() WHERE id=$1`,
      [id, number, JSON.stringify(snap)]);
    return getDoc(qq, id);
  });
}

async function setProformaStatus(id: number, status: string) {
  if (!["draft", "sent", "accepted", "expired"].includes(status)) throw new HttpError(400, "Unknown status.");
  return tx(async (qq) => {
    const doc = await getDoc(qq, id, true);
    if (doc.type !== "proforma") throw new HttpError(409, "Only proformas have this status.");
    if (doc.status === "converted") throw new HttpError(409, "This proforma has already been converted.");
    let snap = doc.snapshot;
    if (status !== "draft" && !snap) snap = (await snapshotFor(qq, doc)).snap;
    if (status === "draft") snap = null;
    await qq(`UPDATE documents SET status=$2, snapshot=$3::jsonb, updated_at=now() WHERE id=$1`, [id, status, snap ? JSON.stringify(snap) : null]);
    return getDoc(qq, id);
  });
}

async function convertProforma(id: number) {
  return tx(async (qq) => {
    const doc = await getDoc(qq, id, true);
    if (doc.type !== "proforma") throw new HttpError(409, "Only proformas can be converted.");
    if (doc.status === "converted") throw new HttpError(409, "This proforma has already been converted.");
    const settings = await getSettings(qq);
    const issue = todayUAE();
    const row = (await qq(
      `INSERT INTO documents (type, status, client_id, issue_date, due_date, currency, prices_include_vat, lines, notes, payment_terms,
         subtotal, vat_total, total, related_id)
       VALUES ('invoice','draft',$1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [doc.client_id, issue, addDays(issue, settings.invoice_due_days ?? 14), doc.currency, doc.prices_include_vat, JSON.stringify(doc.lines),
        doc.notes, doc.payment_terms || settings.payment_terms || "", doc.subtotal, doc.vat_total, doc.total, doc.id],
    ))[0];
    const snap = doc.snapshot || (await snapshotFor(qq, doc)).snap;
    await qq(`UPDATE documents SET status='converted', snapshot=$2::jsonb, updated_at=now() WHERE id=$1`, [id, JSON.stringify(snap)]);
    return getDoc(qq, row.id);
  });
}

async function createCreditNote(id: number, body: any) {
  return tx(async (qq) => {
    const inv = await getDoc(qq, id, true);
    if (inv.type !== "invoice" || inv.status !== "issued") throw new HttpError(409, "Credit notes can only be raised against an issued invoice.");
    const settings = await getSettings(qq);
    const d = readDocBody({ ...body, client_id: inv.client_id, prices_include_vat: inv.prices_include_vat, lines: body.lines?.length ? body.lines : inv.lines }, settings);
    const credited = (await qq(`SELECT coalesce(sum(total),0)::float8 AS s FROM documents WHERE type='credit_note' AND related_id=$1`, [id]))[0].s;
    if (d.total > inv.total - credited) throw new HttpError(400, "The credit note is larger than the amount still credited on this invoice.");
    if (d.total <= 0) throw new HttpError(400, "A credit note must be more than zero.");
    const { snap } = await snapshotFor(qq, inv);
    const number = await nextNumber(qq, "credit_note", settings);
    const row = (await qq(
      `INSERT INTO documents (type, status, number, client_id, issue_date, currency, prices_include_vat, lines, notes, payment_terms,
         subtotal, vat_total, total, related_id, snapshot, issued_at)
       VALUES ('credit_note','issued',$1,$2,$3,$4,$5,$6::jsonb,$7,'',$8,$9,$10,$11,$12::jsonb,now()) RETURNING id`,
      [number, inv.client_id, d.issue_date, inv.currency, inv.prices_include_vat, JSON.stringify(d.lines), d.notes || `Credit against ${inv.number}`,
        d.subtotal, d.vat_total, d.total, inv.id, JSON.stringify({ ...snap, original: { number: inv.number, issue_date: inv.issue_date } })],
    ))[0];
    return getDoc(qq, row.id);
  });
}

async function deleteDocument(id: number) {
  return tx(async (qq) => {
    const doc = await getDoc(qq, id, true);
    const paid = await qq(`SELECT 1 FROM payments WHERE document_id = $1 LIMIT 1`, [id]);
    if (paid.length) throw new HttpError(409, "This document has payments recorded against it and cannot be deleted.");
    if (doc.type === "invoice" && doc.status !== "draft") throw new HttpError(409, "Issued invoices cannot be deleted. Raise a credit note instead.");
    if (doc.type === "credit_note") throw new HttpError(409, "Credit notes cannot be deleted.");
    if (doc.type === "proforma" && doc.status === "converted") throw new HttpError(409, "Delete the draft invoice first, or keep this proforma for the record.");
    if (doc.type === "invoice" && doc.related_id) {
      await qq(`UPDATE documents SET status='accepted', updated_at=now() WHERE id=$1 AND status='converted'`, [doc.related_id]);
    }
    await qq(`DELETE FROM documents WHERE id = $1`, [id]);
    return { ok: true };
  });
}

async function createPayment(body: any) {
  return tx(async (qq) => {
    const doc = await getDoc(qq, Number(body.document_id), true);
    if (doc.type === "credit_note") throw new HttpError(400, "Payments are recorded against invoices or proformas.");
    if (doc.type === "invoice" && doc.status !== "issued") throw new HttpError(409, "Issue the invoice before recording a payment against it.");
    if (doc.type === "proforma" && doc.status === "converted") throw new HttpError(409, "This proforma has been converted. Record the payment against its invoice.");
    const amount = Math.round(Number(body.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, "Please enter the amount received.");
    const bal = await balanceFor(qq, doc);
    if (amount > bal.balance) throw new HttpError(400, `The amount is more than the balance due (${(bal.balance / 100).toFixed(2)}).`);
    const paid_on = isDate(body.paid_on) ? body.paid_on : todayUAE();
    const { settings, snap } = await snapshotFor(qq, doc);
    const receipt = await nextNumber(qq, "receipt", settings);
    const snapshot = {
      ...snap,
      document: { type: doc.type, number: doc.number, issue_date: doc.issue_date, total: doc.total, currency: doc.currency },
      paid_before: bal.paid, credited: bal.credited, balance_after: bal.balance - amount,
    };
    const row = (await qq(
      `INSERT INTO payments (receipt_number, document_id, client_id, paid_on, amount, method, reference, notes, snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) RETURNING id`,
      [receipt, doc.id, doc.client_id, paid_on, amount, str(body.method, 80), str(body.reference, 120), str(body.notes, 1000), JSON.stringify(snapshot)],
    ))[0];
    return (await qq(`SELECT ${PAY_COLS} FROM payments WHERE id = $1`, [row.id]))[0];
  });
}

// ---------------------------------------------------------------- email
// Sends through Google Workspace SMTP: SMTP_USER is the Workspace mailbox, SMTP_PASS an app password,
// MAIL_FROM the address shown to clients (an alias of SMTP_USER, e.g. finance@zenithadvisory.ae).

function mailConfigured() {
  return Netlify.env.get("MAIL_TRANSPORT") === "test" || !!(Netlify.env.get("SMTP_USER") && Netlify.env.get("SMTP_PASS"));
}

function mailFrom(settings: any) {
  return Netlify.env.get("MAIL_FROM") || Netlify.env.get("SMTP_USER") || "";
}

function transport() {
  if (Netlify.env.get("MAIL_TRANSPORT") === "test") return nodemailer.createTransport({ jsonTransport: true });
  return nodemailer.createTransport({
    host: Netlify.env.get("SMTP_HOST") || "smtp.gmail.com",
    port: Number(Netlify.env.get("SMTP_PORT") || 465),
    secure: Number(Netlify.env.get("SMTP_PORT") || 465) === 465,
    auth: { user: Netlify.env.get("SMTP_USER"), pass: Netlify.env.get("SMTP_PASS") },
  });
}

const emailList = (v: unknown) => String(v ?? "").split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

const escHtml = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

// Signature block shared by every email: sign-off, name/title (optional), department, company, logo, contacts, disclaimer
function signature(st: any, fromAddr: string) {
  const company = st.legal_name || "Zenith Advisory Services";
  const website = st.website || "zenithadvisory.ae";
  const lines = [st.email_sign_name, st.email_sign_title, st.email_sign_department, company].map((x) => String(x || "").trim()).filter(Boolean);
  const contact = [fromAddr, st.email_sign_phone, website].filter(Boolean);
  const address = String(st.address || "").split(/\n+/).map((x) => x.trim()).filter(Boolean).join(", ") || "Dubai, United Arab Emirates";
  const disclaimer = String(st.email_disclaimer || "").trim();
  const text = [st.email_signoff || "Kind regards,", "", ...lines, contact.join(" | "), address, ...(disclaimer ? ["", "--", disclaimer] : [])].join("\n");
  const html = (withLogo: boolean) => `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:28px;font-family:Helvetica,Arial,sans-serif;color:#1E2638">
  <tr><td style="font-size:14px;padding-bottom:14px">${escHtml(st.email_signoff || "Kind regards,")}</td></tr>
  ${lines.map((l, i) => `<tr><td style="font-size:${i === 0 ? 15 : 13}px;${i === 0 ? "font-weight:bold;color:#14234A;" : "color:#4A5367;"}line-height:1.5">${escHtml(l)}</td></tr>`).join("")}
  <tr><td style="padding:14px 0 12px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
    ${withLogo ? `<td style="padding-right:16px;border-right:2px solid #C29B4E"><img src="cid:zenith-logo" width="170" alt="${escHtml(company)}" style="display:block;width:170px;height:auto;border:0"></td>` : ""}
    <td style="${withLogo ? "padding-left:16px;" : ""}font-size:12px;line-height:1.7;color:#4A5367">
      ${contact.map((c) => (c.includes("@") ? `<a href="mailto:${escHtml(c)}" style="color:#14234A;text-decoration:none">${escHtml(c)}</a>` : /^[+\d][\d\s()-]+$/.test(c) ? `<a href="tel:${escHtml(c.replace(/\s+/g, ""))}" style="color:#14234A;text-decoration:none">${escHtml(c)}</a>` : `<a href="https://${escHtml(c.replace(/^https?:\/\//, ""))}" style="color:#A9853F;text-decoration:none">${escHtml(c)}</a>`)).join("<br>")}<br>${escHtml(address)}
    </td></tr></table></td></tr>
  ${disclaimer ? `<tr><td style="padding-top:14px;border-top:1px solid #E2DACB;font-size:10.5px;line-height:1.55;color:#8A909C;max-width:600px">${disclaimer.split(/\n{2,}/).map((p) => `<p style="margin:0 0 8px">${escHtml(p).replace(/\n/g, "<br>")}</p>`).join("")}</td></tr>` : ""}
</table>`;
  return { text, html };
}

function emailHtml(text: string, sigHtml: string) {
  const body = text.trim().split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${escHtml(p).replace(/\n/g, "<br>")}</p>`).join("");
  return `<!doctype html><html><body style="margin:0;padding:0;background:#ffffff">
<div style="max-width:640px;padding:8px 4px;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1E2638">${body}${sigHtml}</div>
</body></html>`;
}

async function sendEmail(req: Request, body: any) {
  if (!mailConfigured()) throw new HttpError(503, "Email is not set up yet. Add SMTP_USER, SMTP_PASS and MAIL_FROM in Netlify (see README).");
  const to = emailList(body.to), cc = emailList(body.cc);
  if (!to.length || [...to, ...cc].some((e) => !validEmail(e))) throw new HttpError(400, "Please check the email address.");
  const subject = str(body.subject, 300), text = String(body.text ?? "").slice(0, 20000);
  if (!subject || !text.trim()) throw new HttpError(400, "Please add a subject and a message.");
  const kind = ["proforma", "invoice", "credit_note", "receipt", "reminder", "general"].includes(body.kind) ? body.kind : "general";
  const documentId = Number(body.document_id) || null, paymentId = Number(body.payment_id) || null;
  let clientId = Number(body.client_id) || null;
  if (documentId) clientId = (await getDoc(q, documentId)).client_id;
  let attachments: any[] = [];
  let attachmentName = "";
  if (body.attachment?.data) {
    attachmentName = str(body.attachment.filename, 200).replace(/[\\/:*?"<>|]+/g, "") || "document.pdf";
    const buf = Buffer.from(String(body.attachment.data), "base64");
    if (buf.length > 4 * 1024 * 1024) throw new HttpError(400, "The attachment is too large.");
    attachments = [{ filename: attachmentName, content: buf, contentType: "application/pdf" }];
  }
  const settings = await getSettings();
  const fromAddr = mailFrom(settings);
  const fromName = settings.email_from_name || settings.legal_name || "Zenith Advisory Services";
  const sig = signature(settings, fromAddr);
  // Logo embedded in the message so it shows without the recipient loading remote images
  const logo = await fetch(new URL("/assets/img/email-logo.png", req.url)).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
  if (logo) attachments.push({ filename: "zenith-logo.png", content: Buffer.from(logo), cid: "zenith-logo", contentDisposition: "inline" });
  try {
    const info: any = await transport().sendMail({
      from: { name: fromName, address: fromAddr }, replyTo: fromAddr, to, cc: cc.length ? cc : undefined,
      bcc: body.copy_me ? fromAddr : undefined, subject, attachments,
      text: `${text.trim()}\n\n${sig.text}`,
      html: emailHtml(text, sig.html(!!logo)),
    });
    if (Netlify.env.get("MAIL_TRANSPORT") === "test") console.log("TEST_MAIL " + info.message);
  } catch (e: any) {
    console.error("mail", e?.message);
    throw new HttpError(502, "The email could not be sent. Please check the email settings in Netlify and try again.");
  }
  const row = (await q(
    `INSERT INTO email_log (client_id, document_id, payment_id, kind, to_email, cc, subject, attachment) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, client_id, document_id, payment_id, kind, to_email, cc, subject, attachment, sent_at`,
    [clientId, documentId, paymentId, kind, to.join(", "), cc.join(", "), subject, attachmentName],
  ))[0];
  if (kind === "proforma" && documentId) {
    const d = await getDoc(q, documentId);
    if (d.type === "proforma" && d.status === "draft") await setProformaStatus(documentId, "sent");
  }
  return row;
}

// ---------------------------------------------------------------- router

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const [resource, idPart, action] = parts;
  const id = idPart ? Number(idPart) : NaN;
  const method = req.method;

  try {
    // Reject cross-site writes outright (cookies are SameSite=Strict as well).
    if (method !== "GET") {
      const origin = req.headers.get("origin");
      if (origin && new URL(origin).host !== url.host) return json({ error: "Forbidden" }, 403);
    }

    if (resource === "enquiry" && method === "POST") return await handleEnquiry(req, context);
    if (resource === "login" && method === "POST") return await handleLogin(req, context);
    if (resource === "logout" && method === "POST") return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });

    const authed = validToken(context.cookies.get(COOKIE));
    if (resource === "session") return json({ authenticated: authed, configured: adminPassword().length >= 12 });
    if (!authed) return json({ error: "Please sign in." }, 401);

    const body = method === "GET" || method === "DELETE" ? {} : await req.json().catch(() => ({}));

    switch (resource) {
      case "bootstrap":
        if (method === "GET") return json(await bootstrap());
        break;
      case "settings":
        if (method === "PUT") return json(await saveSettings(body));
        break;
      case "clients": {
        if (method === "POST" && !idPart) {
          const c = readClient(body);
          return json((await q(`INSERT INTO clients (name, contact_name, email, phone, address, trn, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [c.name, c.contact_name, c.email, c.phone, c.address, c.trn, c.notes]))[0], 201);
        }
        if (method === "PUT" && id) {
          const c = readClient(body);
          const row = (await q(`UPDATE clients SET name=$2, contact_name=$3, email=$4, phone=$5, address=$6, trn=$7, notes=$8,
              archived=$9, updated_at=now() WHERE id=$1 RETURNING *`,
            [id, c.name, c.contact_name, c.email, c.phone, c.address, c.trn, c.notes, !!body.archived]))[0];
          if (!row) throw new HttpError(404, "Client not found.");
          return json(row);
        }
        if (method === "DELETE" && id) {
          const used = await q(`SELECT 1 FROM documents WHERE client_id = $1 LIMIT 1`, [id]);
          if (used.length) throw new HttpError(409, "This client has documents, so it can be archived but not deleted.");
          await q(`DELETE FROM clients WHERE id = $1`, [id]);
          return json({ ok: true });
        }
        break;
      }
      case "documents": {
        if (method === "POST" && !idPart) return json(await createDocument(body), 201);
        if (method === "PUT" && id && !action) return json(await updateDocument(id, body));
        if (method === "DELETE" && id) return json(await deleteDocument(id));
        if (method === "POST" && id && action === "issue") return json(await issueInvoice(id));
        if (method === "POST" && id && action === "status") return json(await setProformaStatus(id, String(body.status)));
        if (method === "POST" && id && action === "convert") return json(await convertProforma(id), 201);
        if (method === "POST" && id && action === "credit-note") return json(await createCreditNote(id, body), 201);
        break;
      }
      case "payments": {
        if (method === "POST" && !idPart) return json(await createPayment(body), 201);
        if (method === "DELETE" && id) {
          await q(`DELETE FROM payments WHERE id = $1`, [id]);
          return json({ ok: true });
        }
        break;
      }
      case "email":
        if (method === "POST") return json(await sendEmail(req, body), 201);
        break;
      case "enquiries": {
        if (method === "PUT" && id) {
          const status = ["new", "replied", "archived"].includes(body.status) ? body.status : "new";
          await q(`UPDATE enquiries SET status = $2 WHERE id = $1`, [id, status]);
          return json({ ok: true });
        }
        if (method === "DELETE" && id) {
          await q(`DELETE FROM enquiries WHERE id = $1`, [id]);
          return json({ ok: true });
        }
        break;
      }
      case "export":
        if (method === "GET") {
          const data = await bootstrap();
          return json({ exported_at: new Date().toISOString(), ...data }, 200, {
            "content-disposition": `attachment; filename="zenith-backup-${todayUAE()}.json"`,
          });
        }
        break;
    }
    return json({ error: "Not found" }, 404);
  } catch (e: any) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    if (e?.code === "23505") return json({ error: "That document number is already in use. Check the next numbers in Business settings." }, 409);
    console.error(e);
    return json({ error: "Something went wrong on the server. Please try again." }, 500);
  }
};

export const config: Config = { path: "/api/*" };
