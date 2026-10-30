// VAT return engine, shared by the back office and the reminder function.
// Builds tax periods from the dates on the FTA registration certificate and
// works out every VAT201 box from issued invoices, credit notes, advance
// payments and recorded expenses. Amounts are integer fils.
import { computeTotals, addDays, formatDate } from './calc.js';

export const EMIRATES = ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah'];

export const EXPENSE_KINDS = {
  uae_vat: 'UAE supplier, VAT charged',
  no_vat: 'No VAT charged',
  abroad: 'Supplier outside the UAE (reverse charge)',
};

export const EXPENSE_CATEGORIES = {
  software: 'Software and subscriptions',
  hosting: 'Hosting, domains and IT',
  office: 'Office and co-working',
  phone: 'Phone and internet',
  professional: 'Accounting, legal and professional fees',
  marketing: 'Marketing and advertising',
  travel: 'Travel and transport',
  equipment: 'Equipment and computers',
  bank: 'Bank charges',
  government: 'Government and licence fees',
  entertainment: 'Client entertainment',
  other: 'Other',
};

// Categories where input VAT is normally blocked (Article 53 of the Executive Regulation)
export const NOT_RECOVERABLE = ['entertainment'];

const RC_BP = 500; // reverse charge on imported services is at the standard 5%

export function addMonths(iso, n) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}

export const dueDate = (end) => addDays(end, 28);

export function vatConfigured(s) {
  return !!(s.vat_registered && s.trn && /^\d{4}-\d{2}-\d{2}$/.test(s.vat_first_start || ''));
}

// Tax periods from the first one up to the one after today, newest first.
export function periods(s, today) {
  if (!vatConfigured(s)) return [];
  const months = Number(s.vat_period_months) === 1 ? 1 : 3;
  const out = [];
  let start = s.vat_first_start;
  let end = /^\d{4}-\d{2}-\d{2}$/.test(s.vat_first_end || '') && s.vat_first_end >= start ? s.vat_first_end : addDays(addMonths(start, months), -1);
  while (start <= today && out.length < 200) {
    out.push({ start, end, due: dueDate(end) });
    start = addDays(end, 1);
    end = addDays(addMonths(start, months), -1);
  }
  return out.reverse();
}

const scale = (groups, f) => groups.map((g) => ({ treatment: g.treatment, net: Math.round(g.net * f), vat: Math.round(g.vat * f) }));
const minus = (a, b) => a.map((g) => {
  const o = b.filter((x) => x.treatment === g.treatment);
  return { treatment: g.treatment, net: g.net - o.reduce((s, x) => s + x.net, 0), vat: g.vat - o.reduce((s, x) => s + x.vat, 0) };
});
const negate = (groups) => groups.map((g) => ({ ...g, net: -g.net, vat: -g.vat }));

function groupsOf(doc, defaultBp) {
  const t = computeTotals(doc.lines, doc.prices_include_vat, defaultBp);
  const by = {};
  t.breakdown.forEach((g) => { const k = g.treatment; by[k] = by[k] || { treatment: k, net: 0, vat: 0 }; by[k].net += g.net; by[k].vat += g.vat; });
  return Object.values(by);
}

// Every sale-side VAT event (date of supply under Article 25 of the VAT law: the
// earliest of invoice, supply and payment), plus every expense event.
export function vatEvents(data) {
  const { settings: s, documents, payments, clients = [], expenses = [] } = data;
  const bp = s.default_vat_bp ?? 500;
  const docById = new Map(documents.map((d) => [d.id, d]));
  const clientName = (id) => clients.find((c) => c.id === id)?.name || '';
  const events = [];
  const invoiceFor = (d) => (d.type === 'invoice' ? d : documents.find((x) => x.type === 'invoice' && x.related_id === d.id));
  const taxPoint = (inv) => (inv.supply_date && inv.supply_date < inv.issue_date ? inv.supply_date : inv.issue_date);
  const advances = new Map(); // invoice id -> groups already accounted through advance payments

  for (const p of payments) {
    const d = docById.get(p.document_id);
    if (!d || !d.total) continue;
    const inv = invoiceFor(d);
    const issued = inv && inv.status === 'issued';
    if (issued && p.paid_on >= taxPoint(inv)) continue;
    const g = scale(groupsOf(d, bp), p.amount / d.total);
    events.push({ date: p.paid_on, source: 'sale', kind: 'Advance payment', ref: `${p.receipt_number} (${d.number || 'draft'})`, party: clientName(p.client_id), groups: g, href: `#/receipts/${p.id}` });
    if (issued) {
      const prev = advances.get(inv.id) || [];
      advances.set(inv.id, prev.concat(g));
    }
  }
  for (const d of documents) {
    if (d.type === 'invoice' && d.status === 'issued') {
      const g = minus(groupsOf(d, bp), advances.get(d.id) || []);
      events.push({ date: taxPoint(d), source: 'sale', kind: advances.has(d.id) ? 'Invoice (less advances)' : 'Invoice', ref: d.number, party: clientName(d.client_id), groups: g, href: `#/documents/${d.id}` });
    }
    if (d.type === 'credit_note') {
      events.push({ date: d.issue_date, source: 'sale', kind: 'Credit note', ref: d.number, party: clientName(d.client_id), groups: negate(groupsOf(d, bp)), href: `#/documents/${d.id}` });
    }
  }
  for (const e of expenses) {
    const claim = e.recoverable && (e.kind === 'abroad' || e.has_tax_invoice);
    events.push({ date: e.spent_on, source: 'expense', kind: EXPENSE_KINDS[e.kind], ref: e.reference || '', party: e.supplier, expense: e, claim, href: `#/expenses?edit=${e.id}`,
      net: e.net, vat: e.kind === 'abroad' ? Math.round((e.net * RC_BP) / 10000) : e.kind === 'uae_vat' ? e.vat : 0 });
  }
  return events;
}

const box = () => ({ net: 0, vat: 0 });

// The VAT201 return for one period.
export function vatReturn(data, period) {
  const s = data.settings;
  const emirate = EMIRATES.includes(s.emirate) ? s.emirate : 'Dubai';
  const b = { b1: Object.fromEntries(EMIRATES.map((e) => [e, box()])), b3: box(), b4: box(), b5: box(), b9: box(), b10: box(), outside: box(), notClaimed: box() };
  const rows = [];
  for (const ev of vatEvents(data)) {
    if (ev.date < period.start || ev.date > period.end) continue;
    if (ev.source === 'sale') {
      for (const g of ev.groups) {
        const target = g.treatment === 'standard' ? b.b1[emirate] : g.treatment === 'zero' ? b.b4 : g.treatment === 'exempt' ? b.b5 : b.outside;
        target.net += g.net; target.vat += g.treatment === 'standard' ? g.vat : 0;
      }
      rows.push({ ...ev, net: ev.groups.reduce((a, g) => a + g.net, 0), vat: ev.groups.reduce((a, g) => a + g.vat, 0) });
    } else {
      const e = ev.expense;
      if (e.kind === 'abroad') {
        b.b3.net += ev.net; b.b3.vat += ev.vat;
        if (ev.claim) { b.b10.net += ev.net; b.b10.vat += ev.vat; } else { b.notClaimed.net += ev.net; b.notClaimed.vat += ev.vat; }
      } else if (e.kind === 'uae_vat') {
        if (ev.claim) { b.b9.net += ev.net; b.b9.vat += ev.vat; } else { b.notClaimed.net += ev.net; b.notClaimed.vat += ev.vat; }
      }
      rows.push(ev);
    }
  }
  const b1 = Object.values(b.b1);
  const b8 = { net: b1.reduce((a, x) => a + x.net, 0) + b.b3.net + b.b4.net + b.b5.net, vat: b1.reduce((a, x) => a + x.vat, 0) + b.b3.vat };
  const b11 = { net: b.b9.net + b.b10.net, vat: b.b9.vat + b.b10.vat };
  const boxes = { ...b, b8, b11, b12: b8.vat, b13: b11.vat, b14: b8.vat - b11.vat };
  rows.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  return { ...period, emirate, boxes, rows };
}

// Where a period stands and what to do next.
export function periodStatus(period, record, payable, today) {
  const daysToDue = Math.round((Date.parse(period.due) - Date.parse(today)) / 86400000);
  const filed = !!record?.filed_on, paid = !!record?.paid_on || payable <= 0;
  if (today <= period.end) return { key: 'open', label: 'In progress', daysToDue, todo: `This period runs until ${formatDate(period.end)}. Keep invoices and expenses up to date.` };
  if (!filed) return daysToDue < 0
    ? { key: 'late', label: `Overdue by ${-daysToDue} day${daysToDue === -1 ? '' : 's'}`, daysToDue, todo: 'File this return on EmaraTax now.' }
    : { key: 'due', label: daysToDue === 0 ? 'Due today' : `Due in ${daysToDue} day${daysToDue === 1 ? '' : 's'}`, daysToDue, todo: 'File this return on EmaraTax.' };
  if (!paid) return daysToDue < 0
    ? { key: 'late', label: 'Filed, payment overdue', daysToDue, todo: 'Pay the VAT due now.' }
    : { key: 'due', label: 'Filed, payment due', daysToDue, todo: 'Pay the VAT due by the deadline.' };
  return { key: 'done', label: payable < 0 ? 'Filed (refund due)' : 'Filed and paid', daysToDue, todo: '' };
}
