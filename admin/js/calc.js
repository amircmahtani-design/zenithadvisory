// Shared money and VAT maths for the back office.
// Imported by the browser (admin) and by the API function, so on-screen totals
// and stored totals always come from the same code.
// Amounts are integers in fils (1 AED = 100 fils). VAT rates are basis points (5% = 500).

export const VAT_TREATMENTS = {
  standard: { label: 'Standard rated', short: 'Standard' },
  zero: { label: 'Zero rated (0%)', short: 'Zero rated' },
  exempt: { label: 'Exempt', short: 'Exempt' },
  out_of_scope: { label: 'Outside the scope of VAT', short: 'Out of scope' },
};

export function toFils(value) {
  if (typeof value === 'number') return Math.round(value * 100);
  const clean = String(value ?? '').replace(/[^0-9.\-]/g, '');
  if (!clean || clean === '-' || clean === '.') return 0;
  return Math.round(parseFloat(clean) * 100);
}

export function percentToBp(value) {
  const n = parseFloat(String(value ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function bpToPercent(bp) {
  const n = (bp || 0) / 100;
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '');
}

export function formatMoney(fils, opts = {}) {
  const n = (fils || 0) / 100;
  const s = n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return opts.currency ? `${opts.currency} ${s}` : s;
}

export function parseQty(value) {
  const n = parseFloat(String(value ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : 0;
}

// Effective rate for a line: only standard-rated lines carry VAT.
export function lineRateBp(line, defaultBp) {
  if (!line || line.vat_treatment !== 'standard') return 0;
  return Number.isInteger(line.vat_rate_bp) ? line.vat_rate_bp : defaultBp;
}

// Computes one line. unit_price and discount are in fils and are VAT-inclusive when pricesIncludeVat.
export function computeLine(line, pricesIncludeVat, defaultBp = 500) {
  const qty = parseQty(line.qty);
  const unit = Math.round(Number(line.unit_price) || 0);
  const rate = lineRateBp(line, defaultBp);
  const before = Math.round(qty * unit);
  const discount = Math.min(before, Math.max(0, Math.round(Number(line.discount) || 0)));
  const gross = before - discount;
  let net, vat;
  if (pricesIncludeVat) {
    net = Math.round((gross * 10000) / (10000 + rate));
    vat = gross - net;
  } else {
    net = gross;
    vat = Math.round((net * rate) / 10000);
  }
  // Discount expressed on the same basis as the taxable amount (before VAT)
  const netDiscount = pricesIncludeVat ? Math.round((discount * 10000) / (10000 + rate)) : discount;
  return { qty, unit, rate, discount, netDiscount, net, vat, total: net + vat };
}

// Totals for a document plus a VAT breakdown by rate and treatment.
export function computeTotals(lines, pricesIncludeVat, defaultBp = 500) {
  let subtotal = 0, vatTotal = 0, discountTotal = 0;
  const groups = new Map();
  const computed = (lines || []).map((l) => {
    const c = computeLine(l, pricesIncludeVat, defaultBp);
    subtotal += c.net;
    vatTotal += c.vat;
    discountTotal += c.netDiscount;
    const key = `${l.vat_treatment || 'standard'}:${c.rate}`;
    const g = groups.get(key) || { treatment: l.vat_treatment || 'standard', rate: c.rate, net: 0, vat: 0 };
    g.net += c.net; g.vat += c.vat;
    groups.set(key, g);
    return c;
  });
  return { lines: computed, subtotal, vat: vatTotal, total: subtotal + vatTotal, discount: discountTotal, breakdown: [...groups.values()] };
}

// Cleans user-supplied lines into the stored shape.
export function normaliseLines(lines, defaultBp = 500) {
  return (Array.isArray(lines) ? lines : [])
    .map((l) => ({
      description: String(l.description ?? '').trim().slice(0, 300),
      details: String(l.details ?? '').trim().slice(0, 1000),
      qty: parseQty(l.qty) || 1,
      unit_price: Math.max(0, Math.round(Number(l.unit_price) || 0)),
      discount: Math.max(0, Math.round(Number(l.discount) || 0)),
      vat_treatment: VAT_TREATMENTS[l.vat_treatment] ? l.vat_treatment : 'standard',
      vat_rate_bp: l.vat_treatment === 'standard'
        ? (Number.isInteger(l.vat_rate_bp) && l.vat_rate_bp >= 0 && l.vat_rate_bp <= 10000 ? l.vat_rate_bp : defaultBp)
        : 0,
    }))
    .filter((l) => l.description || l.unit_price);
}

export function formatNumber(prefix, n, pad = 3) {
  return `${prefix}${String(n).padStart(pad, '0')}`;
}

// Day-first date for people: 4 August 2026
export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function addDays(iso, days) {
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + (Number(days) || 0));
  return d.toISOString().slice(0, 10);
}

// Today in the UAE (UTC+4), as YYYY-MM-DD
export function todayUAE() {
  return new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);
}

// What has been paid, credited and is still owed on a document.
// Payments taken against a proforma count towards the invoice it was converted into.
export function documentBalance(doc, documents, payments) {
  if (!doc || doc.type === 'credit_note') return { paid: 0, credited: 0, balance: 0, state: 'n/a' };
  const ids = new Set([doc.id]);
  if (doc.type === 'invoice' && doc.related_id) ids.add(doc.related_id);
  const paid = payments.filter((p) => ids.has(p.document_id)).reduce((s, p) => s + Number(p.amount), 0);
  const credited = doc.type === 'invoice'
    ? documents.filter((d) => d.type === 'credit_note' && d.related_id === doc.id).reduce((s, d) => s + Number(d.total), 0)
    : 0;
  const balance = Number(doc.total) - credited - paid;
  let state = 'unpaid';
  if (Number(doc.total) - credited <= 0) state = 'credited';
  else if (balance <= 0) state = 'paid';
  else if (paid > 0) state = 'partial';
  return { paid, credited, balance, state };
}
