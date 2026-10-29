// Turns stored records into one layout description used by both the on-screen
// preview (renderHTML) and the PDF generator (pdf.js), so the two always match.
import { computeTotals, documentBalance, formatMoney, formatDate, bpToPercent, VAT_TREATMENTS } from './calc.js';

const ph = (v, label) => (String(v ?? '').trim() ? String(v).trim() : `[${label}]`);
const isPh = (s) => /^\[[A-Z /]+\]$/.test(String(s));

function supplierOf(record, settings) {
  return record?.snapshot?.supplier || settings;
}
function clientOf(record, client) {
  return record?.snapshot?.client || client || {};
}

function partyLines(p, { trnLabel = 'TRN', requireTrn = false, placeholders = true } = {}) {
  const lines = [];
  const addr = String(p.address || '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (addr.length) lines.push(...addr);
  else if (placeholders) lines.push('[ADD ADDRESS]');
  if (p.trn) lines.push(`${trnLabel}: ${p.trn}`);
  else if (requireTrn) lines.push(`${trnLabel}: [ADD TRN]`);
  return lines;
}

export function docTitle(type, supplier) {
  const taxReady = supplier.vat_registered && supplier.trn;
  if (type === 'proforma') return 'Proforma Invoice';
  if (type === 'invoice') return taxReady ? 'Tax Invoice' : 'Invoice';
  if (type === 'credit_note') return taxReady ? 'Tax Credit Note' : 'Credit Note';
  return 'Payment Receipt';
}

export function vatLabel(line, rate) {
  if (line.vat_treatment === 'standard') return `${bpToPercent(rate)}%`;
  return VAT_TREATMENTS[line.vat_treatment]?.short || '';
}

export function buildDocView(doc, ctx) {
  const { settings, clients, documents, payments } = ctx;
  const supplier = supplierOf(doc, settings);
  const client = clientOf(doc, clients.find((c) => c.id === doc.client_id));
  const cur = doc.currency || settings.currency || 'AED';
  const defaultBp = settings.default_vat_bp ?? 500;
  const t = computeTotals(doc.lines, doc.prices_include_vat, defaultBp);
  const related = doc.related_id ? documents.find((d) => d.id === doc.related_id) : null;

  const meta = [];
  if (doc.type === 'proforma') {
    meta.push(['Issue date', formatDate(doc.issue_date)]);
    if (doc.due_date) meta.push(['Valid until', formatDate(doc.due_date)]);
  } else if (doc.type === 'invoice') {
    meta.push(['Invoice date', formatDate(doc.issue_date)]);
    if (doc.supply_date && doc.supply_date !== doc.issue_date) meta.push(['Date of supply', formatDate(doc.supply_date)]);
    if (doc.due_date) meta.push(['Due date', formatDate(doc.due_date)]);
    if (related?.number) meta.push(['Proforma ref.', related.number]);
  } else if (doc.type === 'credit_note') {
    meta.push(['Date', formatDate(doc.issue_date)]);
    const orig = doc.snapshot?.original || related;
    if (orig?.number) meta.push(['Original invoice', orig.number]);
    if (orig?.issue_date) meta.push(['Invoice date', formatDate(orig.issue_date)]);
  }

  const rows = doc.lines.map((l, i) => {
    const c = t.lines[i];
    const unitNet = c.qty ? Math.round(c.net / c.qty) : 0;
    return {
      n: String(i + 1), desc: l.description, details: l.details || '',
      qty: String(c.qty).replace(/\.0+$/, ''),
      unit: formatMoney(unitNet), vat: vatLabel(l, c.rate), vatAmount: formatMoney(c.vat), amount: formatMoney(c.net),
    };
  });

  const totals = [['Subtotal', formatMoney(t.subtotal)]];
  const std = t.breakdown.filter((g) => g.treatment === 'standard');
  if (std.length) std.forEach((g) => totals.push([`VAT (${bpToPercent(g.rate)}%)`, formatMoney(g.vat)]));
  else totals.push(['VAT', formatMoney(0)]);
  t.breakdown.filter((g) => g.treatment !== 'standard').forEach((g) => totals.push([`${VAT_TREATMENTS[g.treatment].short} supplies`, formatMoney(g.net), 'note']));
  totals.push([`Total (${cur})`, formatMoney(t.total), 'strong']);

  const bal = documentBalance(doc, documents, payments);
  if (doc.type !== 'credit_note' && (bal.paid || bal.credited)) {
    if (bal.credited) totals.push(['Credited', `-${formatMoney(bal.credited)}`]);
    if (bal.paid) totals.push(['Received', `-${formatMoney(bal.paid)}`]);
    totals.push([`Balance due (${cur})`, formatMoney(Math.max(0, bal.balance)), 'strong']);
  }

  const bank = doc.type === 'credit_note' ? [] : [
    ['Account name', ph(supplier.account_name, 'ADD ACCOUNT HOLDER')],
    ['Bank', ph(supplier.bank_name, 'ADD BANK NAME')],
    ...(supplier.account_number ? [['Account no.', supplier.account_number]] : []),
    ['IBAN', ph(supplier.iban, 'ADD IBAN')],
    ['SWIFT / BIC', ph(supplier.swift, 'ADD SWIFT/BIC')],
  ];

  const terms = [];
  if (doc.type !== 'credit_note') {
    if (doc.payment_terms || settings.payment_terms) terms.push(doc.payment_terms || settings.payment_terms);
    if (supplier.payment_instructions) terms.push(supplier.payment_instructions);
    terms.push(`All amounts are in ${cur === 'AED' ? 'AED (United Arab Emirates dirhams)' : cur}.`);
  }

  const footer = [];
  if (doc.type === 'proforma') footer.push('This is a proforma invoice; payment has not yet been received.', 'This is not a tax invoice.');
  if (doc.type === 'credit_note' && doc.notes) footer.push(`Reason: ${doc.notes}`);

  return {
    kind: doc.type, title: docTitle(doc.type, supplier),
    number: doc.number || 'Draft', draft: doc.type === 'invoice' && doc.status === 'draft',
    meta, currency: cur,
    from: { heading: 'From', name: supplier.legal_name || '[ADD BUSINESS NAME]', lines: partyLines(supplier, { requireTrn: true }), contact: [supplier.email, supplier.phone].filter(Boolean) },
    to: { heading: doc.type === 'credit_note' ? 'Credit to' : 'Bill to', name: client.name || '[CLIENT NAME]', lines: partyLines(client, { placeholders: false }), contact: [client.contact_name, client.email].filter(Boolean) },
    rows, totals, bank, terms, notes: doc.type === 'credit_note' ? '' : doc.notes || '', footer,
    logo: supplier.logo_data_url || '',
  };
}

export function buildReceiptView(p, ctx) {
  const { settings, clients, documents } = ctx;
  const supplier = supplierOf(p, settings);
  const client = clientOf(p, clients.find((c) => c.id === p.client_id));
  const d = p.snapshot?.document || documents.find((x) => x.id === p.document_id) || {};
  const cur = d.currency || settings.currency || 'AED';
  const typeName = d.type === 'proforma' ? 'Proforma invoice' : 'Invoice';
  const rows = [
    ['Receipt date', formatDate(p.paid_on)],
    ['Received from', client.name || '[CLIENT NAME]'],
    ['Payment method', p.method || 'Not specified'],
    ...(p.reference ? [['Reference', p.reference]] : []),
    ['For', `${typeName} ${d.number || ''}`.trim()],
  ];
  const summary = [];
  if (p.snapshot) {
    summary.push([`${typeName} total`, formatMoney(d.total)]);
    if (p.snapshot.credited) summary.push(['Credited', `-${formatMoney(p.snapshot.credited)}`]);
    if (p.snapshot.paid_before) summary.push(['Received previously', `-${formatMoney(p.snapshot.paid_before)}`]);
    summary.push(['This payment', `-${formatMoney(p.amount)}`]);
    summary.push([`Remaining balance (${cur})`, formatMoney(Math.max(0, p.snapshot.balance_after)), 'strong']);
  }
  return {
    kind: 'receipt', title: 'Payment Receipt', number: p.receipt_number, currency: cur,
    amount: `${cur} ${formatMoney(p.amount)}`, rows, summary,
    from: { heading: 'From', name: supplier.legal_name || '[ADD BUSINESS NAME]', lines: partyLines(supplier, { requireTrn: true }), contact: [supplier.email, supplier.phone].filter(Boolean) },
    notes: p.notes || '', footer: ['Thank you for your business.'], logo: supplier.logo_data_url || '',
  };
}

// ------------------------------------------------------------------ HTML preview

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const val = (s) => (isPh(s) || / \[ADD [A-Z /]+\]$/.test(s) ? `<span class="ph">${esc(s)}</span>` : esc(s));
const logoImg = (v) => `<img class="p-logo" src="${v.logo ? esc(v.logo) : '/assets/img/zenith-logo.svg'}" alt="Zenith Advisory Services">`;
const party = (p) => `<div class="p-party"><h4>${esc(p.heading)}</h4><strong>${val(p.name)}</strong>${p.lines.map((l) => `<span>${val(l)}</span>`).join('')}${(p.contact || []).map((l) => `<span class="muted">${esc(l)}</span>`).join('')}</div>`;

export function renderHTML(v) {
  if (v.kind === 'receipt') {
    return `<article class="paper receipt">
      <header class="p-head">${logoImg(v)}<div class="p-title"><h2>${esc(v.title)}</h2><p>No. <strong>${esc(v.number)}</strong></p></div></header>
      <div class="p-amount"><span>Amount received</span><strong>${esc(v.amount)}</strong><em class="stamp">Payment received</em></div>
      <dl class="p-rows">${v.rows.map(([k, x]) => `<div><dt>${esc(k)}</dt><dd>${esc(x)}</dd></div>`).join('')}</dl>
      ${v.summary.length ? `<dl class="p-totals">${v.summary.map(([k, x, s]) => `<div class="${s || ''}"><dt>${esc(k)}</dt><dd>${esc(x)}</dd></div>`).join('')}</dl>` : ''}
      ${v.notes ? `<p class="p-notes">${esc(v.notes)}</p>` : ''}
      <footer class="p-foot">${party(v.from)}<p>${v.footer.map(esc).join('<br>')}</p></footer>
    </article>`;
  }
  return `<article class="paper${v.draft ? ' is-draft' : ''}">
    ${v.draft ? '<div class="p-watermark" aria-hidden="true">Draft</div>' : ''}
    <header class="p-head">${logoImg(v)}<div class="p-title"><h2>${esc(v.title)}</h2><p>No. <strong>${esc(v.number)}</strong></p>${v.meta.map(([k, x]) => `<p><span>${esc(k)}:</span> ${esc(x)}</p>`).join('')}</div></header>
    <div class="p-parties">${party(v.to)}${party(v.from)}</div>
    <table class="p-table"><thead><tr><th>#</th><th>Description</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">VAT</th><th class="r">Amount (${esc(v.currency)})</th></tr></thead>
      <tbody>${v.rows.map((r) => `<tr><td>${r.n}</td><td><strong>${esc(r.desc)}</strong>${r.details ? `<small>${esc(r.details)}</small>` : ''}</td><td class="r">${esc(r.qty)}</td><td class="r">${esc(r.unit)}</td><td class="r">${esc(r.vat)}</td><td class="r">${esc(r.amount)}</td></tr>`).join('')}</tbody></table>
    <dl class="p-totals">${v.totals.map(([k, x, s]) => `<div class="${s || ''}"><dt>${esc(k)}</dt><dd>${esc(x)}</dd></div>`).join('')}</dl>
    <div class="p-info">
      ${v.bank.length ? `<section><h4>Bank details</h4><dl>${v.bank.map(([k, x]) => `<div><dt>${esc(k)}</dt><dd>${val(x)}</dd></div>`).join('')}</dl></section>` : ''}
      ${v.terms.length ? `<section><h4>Payment terms</h4><ol>${v.terms.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></section>` : ''}
    </div>
    ${v.notes ? `<section class="p-notes"><h4>Notes</h4><p>${esc(v.notes)}</p></section>` : ''}
    ${v.footer.length ? `<footer class="p-foot single"><p>${v.footer.map(esc).join(' ')}</p></footer>` : ''}
  </article>`;
}
