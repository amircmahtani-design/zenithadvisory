// Daily VAT deadline reminder. Emails the business mailbox 14, 7 and 2 days
// before a return is due, on the due date, and every 3 days while it is late,
// until the return is marked filed and paid in the back office.
import type { Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import nodemailer from "nodemailer";
import { todayUAE, formatDate, formatMoney } from "../../admin/js/calc.js";
import { periods, vatReturn, periodStatus, vatConfigured } from "../../admin/js/vat.js";

const db = getDatabase();
const q = async (text: string, params: unknown[] = []) => (await db.pool.query(text, params)).rows;

export default async (req: Request) => {
  const settings = (await q(`SELECT data FROM settings WHERE id = 1`))[0]?.data || {};
  const test = Netlify.env.get("MAIL_TRANSPORT") === "test";
  const user = String(Netlify.env.get("SMTP_USER") || "").trim(), pass = String(Netlify.env.get("SMTP_PASS") || "").replace(/\s+/g, "");
  if (!vatConfigured(settings) || settings.vat_reminders === false) return new Response("VAT reminders off");
  if (!test && !(user && pass)) return new Response("Email not configured");

  const [documents, payments, clients, expenses, records] = await Promise.all([
    q(`SELECT id, type, status, number, client_id, issue_date::text, supply_date::text, prices_include_vat, lines, total::float8 AS total, related_id FROM documents`),
    q(`SELECT id, receipt_number, document_id, client_id, paid_on::text, amount::float8 AS amount FROM payments`),
    q(`SELECT id, name FROM clients`),
    q(`SELECT id, spent_on::text, supplier, reference, kind, net::float8 AS net, vat::float8 AS vat, recoverable, has_tax_invoice FROM expenses`),
    q(`SELECT period_start::text, filed_on::text, paid_on::text, boxes FROM vat_returns`),
  ]);
  const data = { settings, documents, payments, clients, expenses };
  const today = new URL(req.url).searchParams.get("today") || todayUAE();

  const due = [];
  for (const p of periods(settings, today)) {
    const rec = records.find((r: any) => r.period_start === p.start);
    const r = vatReturn(data, p);
    const payable = rec?.boxes ? rec.boxes.b14 : r.boxes.b14;
    const st = periodStatus(p, rec, payable, today);
    if (st.key !== "due" && st.key !== "late") continue;
    const d = st.daysToDue;
    if ([14, 7, 2, 0].includes(d) || (d < 0 && -d % 3 === 0)) due.push({ p, st, payable });
  }
  if (!due.length) return new Response("Nothing due");

  const site = Netlify.env.get("URL") || "https://zenithadvisory.ae";
  const lines = due.map(({ p, st, payable }) =>
    `${formatDate(p.start)} to ${formatDate(p.end)}: ${st.label}. ${st.todo} ` +
    `${payable >= 0 ? `VAT to pay: AED ${formatMoney(payable)}` : `Refund due: AED ${formatMoney(-payable)}`}. Deadline ${formatDate(p.due)}.\n${site}/admin/#/vat/${p.start}`);
  const late = due.some((x) => x.st.key === "late");
  const subject = late ? "VAT return overdue" : `VAT return due ${formatDate(due[0].p.due)}`;
  const text = `${lines.join("\n\n")}\n\nThe figures for each box are ready in the back office. File and pay on EmaraTax (https://eservices.tax.gov.ae), then mark the return as filed and paid so these reminders stop.`;

  const tr = test ? nodemailer.createTransport({ jsonTransport: true }) : nodemailer.createTransport({
    host: Netlify.env.get("SMTP_HOST") || "smtp.gmail.com", port: Number(Netlify.env.get("SMTP_PORT") || 465),
    secure: Number(Netlify.env.get("SMTP_PORT") || 465) === 465, auth: { user, pass },
  });
  const to = Netlify.env.get("VAT_REMINDER_TO") || user || settings.email;
  const from = Netlify.env.get("MAIL_FROM") || user;
  const info = await tr.sendMail({ from: `Zenith back office <${from}>`, to, subject, text });
  if (test) console.log("TEST_MAIL", info.message);
  return new Response(`Sent to ${to}: ${subject}`);
};

// 04:10 UTC is 08:10 in the UAE
export const config: Config = { schedule: "10 4 * * *" };
