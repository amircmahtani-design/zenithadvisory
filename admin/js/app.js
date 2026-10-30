// Zenith back office: single-page app (vanilla JS, hash routes).
import {
  VAT_TREATMENTS, toFils, formatMoney, formatDate, computeTotals, documentBalance, bpToPercent, percentToBp, addDays, todayUAE,
} from './calc.js';
import { buildDocView, buildReceiptView, renderHTML, docTitle } from './doc.js';
import { downloadPdf, makePdf } from './pdf.js';

const app = document.getElementById('app');
const dlg = document.getElementById('dlg');
let data = null;

// ------------------------------------------------------------------ utilities
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const cur = () => data?.settings?.currency || 'AED';
const money = (f) => `${cur()} ${formatMoney(f)}`;
const clientName = (id) => data.clients.find((c) => c.id === id)?.name || 'Unknown client';
const docById = (id) => data.documents.find((d) => d.id === id);
const TYPE_NAME = { proforma: 'Proforma', invoice: 'Invoice', credit_note: 'Credit note' };

const ICON = {
  home: '<path d="M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  file: '<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3v5h5M8.5 13h7M8.5 16.5h7"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  out: '<path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15M10 16l4-4-4-4M14 12H4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  down: '<path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  warn: '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="m3.5 6 8.5 7 8.5-7"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  sheet: '<rect x="4" y="3.5" width="16" height="17" rx="1.5"/><path d="M4 9h16M4 14.5h16M10 9v11.5"/>',
};
const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

function toast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.className = 'toast'; }, type === 'error' ? 6000 : 3200);
}

async function api(method, path, body) {
  const res = await fetch(`/api/${path}`, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = {};
  try { json = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && path !== 'login') { renderLogin(); throw new Error('Your session has ended. Please sign in again.'); }
  if (!res.ok) throw new Error(json.error || 'Something went wrong. Please try again.');
  return json;
}

async function busy(btn, fn) {
  if (btn) btn.setAttribute('aria-busy', 'true');
  try { return await fn(); } catch (e) { toast(e.message, 'error'); return undefined; } finally { if (btn) btn.removeAttribute('aria-busy'); }
}

async function reload() { data = await api('GET', 'bootstrap'); }

// Scales document previews down on narrow screens so the whole page is visible
function fitPapers() {
  $$('.paper-wrap').forEach((w) => {
    const p = $('.paper', w); if (!p) return;
    p.style.zoom = '';
    const scale = Math.min(1, w.clientWidth / p.offsetWidth);
    if (scale < 1) p.style.zoom = String(Math.floor(scale * 1000) / 1000);
  });
}
window.addEventListener('resize', () => requestAnimationFrame(fitPapers));

function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

// ------------------------------------------------------------------ derived data
const ctx = () => ({ settings: data.settings, clients: data.clients, documents: data.documents, payments: data.payments });
const bal = (d) => documentBalance(d, data.documents, data.payments);

function statusOf(d) {
  const today = todayUAE();
  if (d.type === 'credit_note') return { key: 'issued', label: 'Issued', cls: 'info' };
  const b = bal(d);
  if (d.type === 'invoice') {
    if (d.status === 'draft') return { key: 'draft', label: 'Draft', cls: '' };
    if (b.state === 'credited') return { key: 'paid', label: 'Credited', cls: 'info' };
    if (b.state === 'paid') return { key: 'paid', label: 'Paid', cls: 'ok' };
    if (d.due_date && d.due_date < today) return { key: 'overdue', label: b.state === 'partial' ? 'Overdue, part paid' : 'Overdue', cls: 'danger' };
    if (b.state === 'partial') return { key: 'partial', label: 'Partially paid', cls: 'warn' };
    return { key: 'unpaid', label: 'Unpaid', cls: 'gold' };
  }
  if (d.status === 'converted') return { key: 'converted', label: 'Converted', cls: 'info' };
  if (b.state === 'paid') return { key: 'paid', label: 'Paid', cls: 'ok' };
  if (b.state === 'partial') return { key: 'partial', label: 'Part paid', cls: 'warn' };
  const map = { draft: ['Draft', ''], sent: ['Sent', 'gold'], accepted: ['Accepted', 'info'], expired: ['Expired', 'danger'] };
  const [label, cls] = map[d.status] || [d.status, ''];
  return { key: d.status === 'draft' ? 'draft' : 'unpaid', label, cls };
}
const chip = (s) => `<span class="chip ${s.cls}">${esc(s.label)}</span>`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const docLabel = (d) => `${TYPE_NAME[d.type]} ${d.number || '(draft)'}`;

function setupGaps() {
  const s = data.settings, gaps = [];
  if (!s.address) gaps.push('business address');
  if (!s.trn) gaps.push('Tax Registration Number (TRN)');
  if (!s.bank_name || !s.iban) gaps.push('bank name and IBAN');
  if (!s.swift) gaps.push('SWIFT/BIC');
  return gaps;
}

// ------------------------------------------------------------------ dialogs
function openDialog(html, onMount) {
  dlg.innerHTML = html;
  if (!dlg.open) dlg.showModal();
  $$('[data-close]', dlg).forEach((b) => b.addEventListener('click', () => dlg.close()));
  onMount?.(dlg);
  const first = $('input:not([type=hidden]),select,textarea', dlg);
  if (first) first.focus();
}
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

function confirmBox({ title, body, confirm = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    openDialog(`<div class="dlg-head"><h2 id="dlg-title">${esc(title)}</h2></div>
      <div class="dlg-body"><p class="muted">${body}</p></div>
      <div class="dlg-foot"><button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-navy'}" id="dlg-ok">${esc(confirm)}</button></div>`, () => {
      $('#dlg-ok', dlg).addEventListener('click', () => { answered = true; dlg.close(); resolve(true); });
      dlg.addEventListener('close', () => { if (!answered) resolve(false); }, { once: true });
    });
  });
}

// ------------------------------------------------------------------ login
function renderLogin(message = '') {
  document.body.classList.remove('menu-open');
  app.innerHTML = `<main class="login">
    <form class="card form" id="login" novalidate>
      <img class="mark" src="/assets/img/zenith-logo.svg" alt="Zenith Advisory Services">
      <div><h1>Back office</h1><p class="sub">Sign in to manage clients, invoices and receipts.</p></div>
      <div class="field"><label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required><span class="err" id="pw-err" role="alert">${esc(message)}</span></div>
      <button class="btn btn-navy btn-lg" type="submit">Sign in</button>
      <p class="small muted" style="text-align:center"><a href="/">Back to the website</a></p>
    </form></main>`;
  const form = $('#login');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = $('#pw').value, err = $('#pw-err');
    if (!pw) { err.textContent = 'Please enter your password.'; $('#pw').setAttribute('aria-invalid', 'true'); return; }
    const btn = form.querySelector('button[type=submit]');
    btn.setAttribute('aria-busy', 'true');
    try {
      await api('POST', 'login', { password: pw });
      await start();
    } catch (ex) {
      err.textContent = ex.message; $('#pw').setAttribute('aria-invalid', 'true'); $('#pw').select();
    } finally { btn.removeAttribute('aria-busy'); }
  });
  $('#pw').focus();
}

// ------------------------------------------------------------------ shell
const NAV = [
  ['#/', 'Dashboard', 'home'], ['#/receivables', 'Receivables', 'clock'], ['#/clients', 'Clients', 'users'], ['#/invoices', 'Invoices', 'file'],
  ['#/receipts', 'Receipts', 'receipt'], ['#/enquiries', 'Enquiries', 'inbox'], ['#/settings', 'Business settings', 'gear'],
];

function renderShell() {
  const newEnq = data.enquiries.filter((e) => e.status === 'new').length;
  app.innerHTML = `<div class="shell">
    <header class="topbar"><button type="button" id="menu-btn" aria-label="Open menu" aria-controls="side" aria-expanded="false">${icon('menu')}</button>
      <img src="/assets/img/zenith-lockup-light.svg" alt="Zenith Advisory Services"><span style="width:44px"></span></header>
    <div class="scrim" id="scrim"></div>
    <aside class="side" id="side">
      <a class="brand" href="#/"><img src="/assets/img/zenith-logo-light.svg" alt="Zenith Advisory Services"></a>
      <nav aria-label="Back office">${NAV.map(([h, t, i]) => `<a href="${h}" data-nav="${h}">${icon(i)}<span>${t}</span>${h === '#/enquiries' && newEnq ? `<span class="badge">${newEnq}</span>` : ''}</a>`).join('')}</nav>
      <div class="who"><span class="av">ZA</span><div><strong class="small">${esc(data.settings.legal_name || 'Zenith Advisory Services')}</strong><small>Admin</small></div></div>
      <button class="logout" id="logout">${icon('out')}<span>Log out</span></button>
    </aside>
    <main class="main" id="main" tabindex="-1"></main>
  </div>`;
  const toggle = (open) => { document.body.classList.toggle('menu-open', open); $('#menu-btn').setAttribute('aria-expanded', String(open)); };
  $('#menu-btn').addEventListener('click', () => toggle(!document.body.classList.contains('menu-open')));
  $('#scrim').addEventListener('click', () => toggle(false));
  $('#side').addEventListener('click', (e) => { if (e.target.closest('a')) toggle(false); });
  $('#logout').addEventListener('click', async () => { await api('POST', 'logout').catch(() => {}); data = null; renderLogin(); });
}

function setActiveNav(hash) {
  const base = '#/' + (hash.split('/')[1] || '');
  const key = base === '#/documents' ? '#/invoices' : base;
  $$('[data-nav]').forEach((a) => (a.dataset.nav === key ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
}

// ------------------------------------------------------------------ router
async function route() {
  if (!data) return;
  if (!$('#main')) renderShell();
  const hash = location.hash || '#/';
  const [path, query] = hash.slice(1).split('?');
  const params = new URLSearchParams(query || '');
  const parts = path.split('/').filter(Boolean);
  setActiveNav(hash);
  // A fresh element per route, so listeners from the previous page never pile up
  const old = $('#main');
  const main = old.cloneNode(false);
  old.replaceWith(main);
  window.scrollTo(0, 0);
  if (dlg.open) dlg.close();
  try {
    if (!parts.length) viewDashboard(main);
    else if (parts[0] === 'receivables') viewReceivables(main);
    else if (parts[0] === 'clients' && parts[1]) viewClient(main, Number(parts[1]));
    else if (parts[0] === 'clients') viewClients(main);
    else if (parts[0] === 'invoices') viewRegister(main, params);
    else if (parts[0] === 'documents' && parts[1] === 'new') viewEditor(main, null, params);
    else if (parts[0] === 'documents' && parts[2] === 'edit') viewEditor(main, Number(parts[1]), params);
    else if (parts[0] === 'documents') viewDocument(main, Number(parts[1]));
    else if (parts[0] === 'receipts' && parts[1]) viewReceipt(main, Number(parts[1]));
    else if (parts[0] === 'receipts') viewReceipts(main);
    else if (parts[0] === 'enquiries') viewEnquiries(main);
    else if (parts[0] === 'settings') viewSettings(main);
    else main.innerHTML = '<div class="empty">Page not found. <a href="#/">Go to the dashboard</a></div>';
  } catch (e) {
    console.error(e);
    main.innerHTML = `<div class="notice">${icon('warn')}<div>Something went wrong showing this page. ${esc(e.message)}</div></div>`;
  }
  fitPapers();
  main.focus({ preventScroll: true });
}
window.addEventListener('hashchange', route);

// ------------------------------------------------------------------ dashboard
function viewDashboard(main) {
  const today = todayUAE(), month = today.slice(0, 7);
  const invoices = data.documents.filter((d) => d.type === 'invoice' && d.status === 'issued');
  let outstanding = 0, overdue = 0, overdueN = 0;
  invoices.forEach((d) => {
    const b = bal(d);
    if (b.balance > 0) { outstanding += b.balance; if (d.due_date && d.due_date < today) { overdue += b.balance; overdueN++; } }
  });
  const received = data.payments.filter((p) => p.paid_on.startsWith(month)).reduce((s, p) => s + p.amount, 0);
  const openPf = data.documents.filter((d) => d.type === 'proforma' && !['converted', 'expired'].includes(d.status) && bal(d).state !== 'paid');
  const gaps = setupGaps();
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const recent = data.documents.slice(0, 6);
  const newEnq = data.enquiries.filter((e) => e.status === 'new').slice(0, 3);
  main.innerHTML = `
    <div class="page-head"><div><h1>${greet}</h1><p class="sub">${formatDate(today)}</p></div>
      <div class="actions"><a class="btn btn-gold" href="#/documents/new?type=proforma">${icon('plus')}Create proforma</a><a class="btn" href="#/documents/new?type=invoice">Create invoice</a><button class="btn" id="dash-pay">Record payment</button><a class="btn" href="#/receivables">${icon('clock')}Who owes what</a></div></div>
    <div class="grid">
      ${gaps.length ? `<div class="notice">${icon('warn')}<div><strong>Finish your business details.</strong> Documents will show clear placeholders until you add your ${gaps.join(', ')}. <a href="#/settings">Open Business settings</a></div></div>` : ''}
      <div class="kpis">
        <div class="card kpi"><span>Awaiting payment</span><strong>${money(outstanding)}</strong><small>${plural(invoices.filter((d) => bal(d).balance > 0).length, 'unpaid invoice')}</small></div>
        <div class="card kpi ${overdueN ? 'alert' : ''}"><span>Overdue</span><strong>${money(overdue)}</strong><small>${overdueN} invoice${overdueN === 1 ? '' : 's'} past due</small></div>
        <div class="card kpi"><span>Received this month</span><strong>${money(received)}</strong><small>${plural(data.payments.filter((p) => p.paid_on.startsWith(month)).length, 'receipt')}</small></div>
        <div class="card kpi"><span>Open proformas</span><strong>${openPf.length}</strong><small>${money(openPf.reduce((s, d) => s + d.total, 0))} quoted</small></div>
      </div>
      <div class="grid-2">
        <section class="card"><div class="card-head"><h2>Recent documents</h2><a class="btn btn-quiet" href="#/invoices">View all</a></div>
          ${recent.length ? docTable(recent) : `<div class="empty">${icon('file')}<p>No documents yet. Create your first proforma to get started.</p><a class="btn btn-gold" href="#/documents/new?type=proforma">Create proforma</a></div>`}</section>
        <section class="card"><div class="card-head"><h2>New enquiries</h2><a class="btn btn-quiet" href="#/enquiries">View all</a></div>
          ${newEnq.length ? `<div class="mini-list">${newEnq.map((e) => `<a href="#/enquiries"><span><strong>${esc(e.name)}</strong><br><span class="small muted">${esc(e.company || e.email)}</span></span><span class="small muted">${formatDate(e.created_at)}</span></a>`).join('')}</div>` : '<div class="empty"><p>No new website enquiries.</p></div>'}
        </section>
      </div>
    </div>`;
  bindDocTable(main);
  $('#dash-pay').addEventListener('click', () => paymentDialog());
}

function docTable(docs) {
  return `<div class="table-wrap"><table class="list"><thead><tr><th>Number</th><th>Client</th><th data-m="hide">Date</th><th class="r">Total</th><th class="r">Status</th></tr></thead><tbody>
    ${docs.map((d) => `<tr data-href="#/documents/${d.id}"><td><a class="rowlink" href="#/documents/${d.id}">${esc(d.number || 'Draft')}</a><br><span class="small muted">${TYPE_NAME[d.type]}</span></td>
      <td>${esc(clientName(d.client_id))}</td><td data-m="hide" class="num">${formatDate(d.issue_date)}</td><td class="r money">${money(d.total)}</td><td class="r">${chip(statusOf(d))}</td></tr>`).join('')}
  </tbody></table></div>`;
}
function bindDocTable(root) {
  $$('tr[data-href]', root).forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('a')) go(tr.dataset.href); }));
}

// ------------------------------------------------------------------ register
function viewRegister(main, params) {
  const state = { tab: params.get('type') || 'all', q: '', status: 'all', from: '', to: '', client: params.get('client') || '' };
  main.innerHTML = `
    <div class="page-head"><div><h1>Invoices</h1><p class="sub">Proformas, invoices and credit notes.</p></div>
      <div class="actions"><button class="btn" id="reg-csv">${icon('sheet')}Export CSV</button><a class="btn btn-gold" href="#/documents/new?type=proforma">${icon('plus')}Create proforma</a><a class="btn" href="#/documents/new?type=invoice">Create invoice</a></div></div>
    <section class="card">
      <div class="tabs" role="tablist">${[['all', 'All'], ['proforma', 'Proformas'], ['invoice', 'Invoices'], ['credit_note', 'Credit notes']].map(([k, t]) => `<button role="tab" data-tab="${k}" aria-selected="${state.tab === k}">${t}</button>`).join('')}</div>
      <div class="filters">
        <div class="field"><label class="sr-only" for="f-q">Search</label><input id="f-q" type="text" placeholder="Search by client or number"></div>
        <div class="field"><label class="sr-only" for="f-client">Client</label><select id="f-client"><option value="">All clients</option>${data.clients.map((c) => `<option value="${c.id}" ${String(c.id) === state.client ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label class="sr-only" for="f-status">Status</label><select id="f-status"><option value="all">Any status</option><option value="draft">Draft</option><option value="unpaid">Unpaid</option><option value="partial">Partially paid</option><option value="overdue">Overdue</option><option value="paid">Paid</option><option value="converted">Converted</option></select></div>
        <div class="field"><label class="sr-only" for="f-from">From date</label><input id="f-from" type="date" title="From date"></div>
        <div class="field"><label class="sr-only" for="f-to">To date</label><input id="f-to" type="date" title="To date"></div>
      </div>
      <div id="reg-body"></div>
    </section>`;
  const draw = () => {
    const q = state.q.toLowerCase();
    const rows = data.documents.filter((d) => (state.tab === 'all' || d.type === state.tab)
      && (!state.client || String(d.client_id) === state.client)
      && (!q || (d.number || '').toLowerCase().includes(q) || clientName(d.client_id).toLowerCase().includes(q))
      && (state.status === 'all' || statusOf(d).key === state.status)
      && (!state.from || d.issue_date >= state.from) && (!state.to || d.issue_date <= state.to));
    const body = $('#reg-body');
    body.innerHTML = rows.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Number</th><th>Client</th><th data-m="hide">Date</th><th data-m="hide">Due</th><th class="r">Total</th><th class="r" data-m="hide">Balance</th><th class="r">Status</th></tr></thead><tbody>
      ${rows.map((d) => { const b = bal(d); return `<tr data-href="#/documents/${d.id}"><td><a class="rowlink" href="#/documents/${d.id}">${esc(d.number || 'Draft')}</a><br><span class="small muted">${TYPE_NAME[d.type]}</span></td>
        <td>${esc(clientName(d.client_id))}</td><td data-m="hide" class="num">${formatDate(d.issue_date)}</td><td data-m="hide" class="num">${d.type === 'credit_note' ? '' : formatDate(d.due_date)}</td>
        <td class="r money">${money(d.total)}</td><td class="r money" data-m="hide">${d.type === 'credit_note' || d.status === 'converted' ? '' : money(Math.max(0, b.balance))}</td><td class="r">${chip(statusOf(d))}</td></tr>`; }).join('')}
      </tbody></table></div>` : `<div class="empty">${icon('file')}<p>No documents match these filters.</p></div>`;
    bindDocTable(body);
  };
  $$('[data-tab]', main).forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.tab; $$('[data-tab]', main).forEach((x) => x.setAttribute('aria-selected', String(x === b))); draw(); }));
  $('#f-q').addEventListener('input', (e) => { state.q = e.target.value; draw(); });
  $('#f-client').addEventListener('change', (e) => { state.client = e.target.value; draw(); });
  $('#f-status').addEventListener('change', (e) => { state.status = e.target.value; draw(); });
  $('#f-from').addEventListener('change', (e) => { state.from = e.target.value; draw(); });
  $('#f-to').addEventListener('change', (e) => { state.to = e.target.value; draw(); });
  $('#reg-csv').addEventListener('click', () => csvDocuments());
  draw();
}

// ------------------------------------------------------------------ editor
function vatOptions(selected, rateBp) {
  return Object.entries(VAT_TREATMENTS).map(([k, v]) => `<option value="${k}" ${k === selected ? 'selected' : ''}>${k === 'standard' ? `${bpToPercent(rateBp)}% standard` : esc(v.label)}</option>`).join('');
}

function viewEditor(main, id, params) {
  const s = data.settings;
  const existing = id ? docById(id) : null;
  if (id && !existing) { main.innerHTML = '<div class="empty">Document not found.</div>'; return; }
  const type = existing?.type || (params.get('type') === 'invoice' ? 'invoice' : 'proforma');
  const issue = existing?.issue_date || todayUAE();
  const st = {
    type,
    client_id: existing?.client_id || Number(params.get('client')) || '',
    issue_date: issue,
    due_date: existing?.due_date || addDays(issue, type === 'proforma' ? s.proforma_valid_days ?? 30 : s.invoice_due_days ?? 14),
    dueTouched: !!existing,
    supply_date: existing?.supply_date || '',
    prices_include_vat: existing ? existing.prices_include_vat : !!s.prices_include_vat,
    notes: existing?.notes || '',
    payment_terms: existing?.payment_terms || s.payment_terms || '',
    lines: (existing?.lines || [{ description: '', details: '', qty: 1, unit_price: 0, vat_treatment: 'standard' }])
      .map((l) => ({ ...l, _price: l.unit_price ? (l.unit_price / 100).toFixed(2) : '' })),
  };
  const rate = s.default_vat_bp ?? 500;
  const title = existing ? `Edit ${existing.number || 'draft invoice'}` : `Create ${type === 'proforma' ? 'proforma' : 'invoice'}`;

  main.innerHTML = `
    <a class="crumb" href="${existing ? `#/documents/${existing.id}` : '#/invoices'}">${icon('back')}Back</a>
    <div class="page-head"><div><h1>${esc(title)}</h1><p class="sub">${type === 'proforma' ? 'Prepare and download a professional proforma invoice for your client.' : 'Draft an invoice, then issue it to give it a permanent number.'}</p></div>
      ${existing ? '' : `<div class="seg" role="group" aria-label="Document type"><button type="button" data-type="proforma" aria-pressed="${type === 'proforma'}">Proforma</button><button type="button" data-type="invoice" aria-pressed="${type === 'invoice'}">Invoice</button></div>`}</div>
    <form class="editor" id="ed" novalidate>
      <div class="card card-pad form">
        <div class="field"><label for="ed-client">Client</label>
          <div style="display:flex;gap:8px"><select id="ed-client" required aria-describedby="err-client"><option value="">Select a client…</option>${data.clients.filter((c) => !c.archived || c.id === st.client_id).map((c) => `<option value="${c.id}" ${c.id === st.client_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
          <button type="button" class="btn" id="ed-newclient">${icon('plus')}<span>New</span></button></div>
          <span class="err" id="err-client" role="alert"></span></div>

        <div>
          <div class="line-head" aria-hidden="true"><span>Description</span><span style="text-align:right">Price (${esc(cur())})</span><span></span></div>
          <div class="lines" id="ed-lines"></div>
          <span class="err" id="err-lines" role="alert" style="display:block;margin-top:8px;color:var(--danger);font-size:.85rem"></span>
          <button type="button" class="btn" id="ed-addline" style="margin-top:12px">${icon('plus')}Add another line</button>
        </div>

        <div class="row2">
          <div class="field"><span class="label">Prices entered</span>
            <div class="seg" role="group" aria-label="Prices entered"><button type="button" data-incl="0" aria-pressed="${!st.prices_include_vat}">Before VAT</button><button type="button" data-incl="1" aria-pressed="${st.prices_include_vat}">Including VAT</button></div></div>
          <div class="field"><span class="label">Tax registration number</span>
            <p class="${s.trn ? '' : 'muted small'}" style="padding-top:10px">${s.trn ? esc(s.trn) : 'Not set yet, so documents show [ADD TRN].<br><a href="#/settings">Add it in Business settings</a>'}</p></div>
        </div>

        <div class="row3">
          <div class="field"><label for="ed-issue">${type === 'proforma' ? 'Issue date' : 'Invoice date'}</label><input id="ed-issue" type="date" value="${st.issue_date}"></div>
          <div class="field"><label for="ed-due">${type === 'proforma' ? 'Valid until' : 'Due date'}</label><input id="ed-due" type="date" value="${st.due_date || ''}"></div>
          ${type === 'invoice' ? `<div class="field"><label for="ed-supply">Date of supply</label><input id="ed-supply" type="date" value="${st.supply_date}"><span class="hint">If different from the invoice date.</span></div>` : ''}
        </div>

        <details ${st.notes ? 'open' : ''}><summary style="cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:500">Notes and payment terms</summary>
          <div class="form" style="margin-top:12px">
            <div class="field"><label for="ed-terms">Payment terms</label><textarea id="ed-terms" rows="2">${esc(st.payment_terms)}</textarea></div>
            <div class="field"><label for="ed-notes">Notes for the client <span class="muted">(optional)</span></label><textarea id="ed-notes" rows="3">${esc(st.notes)}</textarea></div>
          </div></details>
      </div>
      <aside class="card card-pad form">
        <div class="totals" id="ed-totals"></div>
        <div class="sticky-actions" id="ed-actions"></div>
        <p class="small muted" id="ed-hint"></p>
      </aside>
    </form>`;

  const linesEl = $('#ed-lines');
  const drawLines = () => {
    linesEl.innerHTML = st.lines.map((l, i) => `
      <div class="line" data-i="${i}">
        <div class="field"><label class="mlabel" for="ld-${i}">Description</label><input id="ld-${i}" data-k="description" value="${esc(l.description)}" placeholder="e.g. Website development, phase 1"></div>
        <div class="field"><label class="mlabel" for="lp-${i}">Price (${esc(cur())})</label><input id="lp-${i}" data-k="_price" class="money-in" inputmode="decimal" value="${esc(l._price)}" placeholder="0.00"></div>
        <button type="button" class="btn btn-quiet btn-icon" data-del="${i}" aria-label="Remove line ${i + 1}" ${st.lines.length === 1 ? 'disabled' : ''}>${icon('trash')}</button>
        <div class="more"><div class="mini"><label for="lq-${i}">Quantity</label><input id="lq-${i}" data-k="qty" inputmode="decimal" value="${esc(l.qty)}"></div>
          <div class="mini"><label for="lv-${i}">VAT</label><select id="lv-${i}" data-k="vat_treatment">${vatOptions(l.vat_treatment || 'standard', rate)}</select></div></div>
        <div class="details field"><label class="sr-only" for="lx-${i}">Details</label><input id="lx-${i}" data-k="details" value="${esc(l.details || '')}" placeholder="Details shown under the description (optional)"></div>
      </div>`).join('');
  };
  const drawTotals = () => {
    const lines = st.lines.map((l) => ({ ...l, unit_price: toFils(l._price) }));
    const t = computeTotals(lines, st.prices_include_vat, rate);
    const std = t.breakdown.filter((g) => g.treatment === 'standard');
    $('#ed-totals').innerHTML = `<div><span>Subtotal (${esc(cur())})</span><span>${formatMoney(t.subtotal)}</span></div>
      ${(std.length ? std : [{ rate, vat: 0 }]).map((g) => `<div><span>VAT (${bpToPercent(g.rate)}%)</span><span>${formatMoney(g.vat)}</span></div>`).join('')}
      <div class="grand"><span>Total (${esc(cur())})</span><span>${formatMoney(t.total)}</span></div>`;
  };
  const drawActions = () => {
    const a = $('#ed-actions');
    if (st.type === 'proforma') {
      a.innerHTML = `<button type="button" class="btn btn-gold btn-lg" data-save="pdf">${icon('down')}Save &amp; download PDF</button><button type="button" class="btn" data-save="draft">Save${existing ? ' changes' : ' as draft'}</button>`;
      $('#ed-hint').textContent = existing ? '' : `This proforma will be numbered ${data.settings.prefix_proforma || ''}${String(data.counters.proforma).padStart(3, '0')}.`;
    } else {
      a.innerHTML = `<button type="button" class="btn btn-gold btn-lg" data-save="issue">Save &amp; issue invoice</button><button type="button" class="btn" data-save="draft">Save as draft</button>`;
      $('#ed-hint').textContent = 'Drafts can be edited. Issuing gives the invoice its permanent number; after that, corrections are made with a credit note.';
    }
    $$('[data-save]', a).forEach((b) => b.addEventListener('click', () => save(b.dataset.save, b)));
  };
  drawLines(); drawTotals(); drawActions();

  linesEl.addEventListener('input', (e) => {
    const row = e.target.closest('.line'); if (!row) return;
    const l = st.lines[Number(row.dataset.i)];
    l[e.target.dataset.k] = e.target.value;
    $('#err-lines').textContent = '';
    drawTotals();
  });
  linesEl.addEventListener('change', (e) => {
    if (e.target.dataset.k === 'vat_treatment') { st.lines[Number(e.target.closest('.line').dataset.i)].vat_treatment = e.target.value; drawTotals(); }
    if (e.target.dataset.k === '_price' && e.target.value) {
      const f = toFils(e.target.value); e.target.value = (f / 100).toFixed(2); st.lines[Number(e.target.closest('.line').dataset.i)]._price = e.target.value;
    }
  });
  linesEl.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]'); if (!del) return;
    st.lines.splice(Number(del.dataset.del), 1); drawLines(); drawTotals();
  });
  $('#ed-addline').addEventListener('click', () => {
    st.lines.push({ description: '', details: '', qty: 1, _price: '', vat_treatment: st.lines.at(-1)?.vat_treatment || 'standard' });
    drawLines(); drawTotals(); $(`#ld-${st.lines.length - 1}`).focus();
  });
  $$('[data-incl]', main).forEach((b) => b.addEventListener('click', () => {
    st.prices_include_vat = b.dataset.incl === '1';
    $$('[data-incl]', main).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); drawTotals();
  }));
  $$('[data-type]', main).forEach((b) => b.addEventListener('click', () => go(`#/documents/new?type=${b.dataset.type}${st.client_id ? `&client=${st.client_id}` : ''}`)));
  $('#ed-client').addEventListener('change', (e) => { st.client_id = Number(e.target.value) || ''; $('#err-client').textContent = ''; e.target.removeAttribute('aria-invalid'); });
  $('#ed-newclient').addEventListener('click', () => clientDialog(null, (c) => {
    st.client_id = c.id;
    $('#ed-client').insertAdjacentHTML('beforeend', `<option value="${c.id}">${esc(c.name)}</option>`);
    $('#ed-client').value = String(c.id); $('#err-client').textContent = '';
  }));
  $('#ed-issue').addEventListener('change', (e) => {
    st.issue_date = e.target.value;
    if (!st.dueTouched && st.issue_date) { st.due_date = addDays(st.issue_date, st.type === 'proforma' ? s.proforma_valid_days ?? 30 : s.invoice_due_days ?? 14); $('#ed-due').value = st.due_date; }
  });
  $('#ed-due').addEventListener('change', (e) => { st.due_date = e.target.value; st.dueTouched = true; });
  $('#ed-supply')?.addEventListener('change', (e) => { st.supply_date = e.target.value; });
  $('#ed-terms').addEventListener('input', (e) => { st.payment_terms = e.target.value; });
  $('#ed-notes').addEventListener('input', (e) => { st.notes = e.target.value; });

  async function save(mode, btn) {
    let ok = true;
    if (!st.client_id) { $('#err-client').textContent = 'Please choose a client, or add a new one.'; $('#ed-client').setAttribute('aria-invalid', 'true'); ok = false; }
    const lines = st.lines.map((l) => ({ description: String(l.description || '').trim(), details: l.details, qty: l.qty, unit_price: toFils(l._price), vat_treatment: l.vat_treatment || 'standard' }))
      .filter((l) => l.description || l.unit_price);
    if (!lines.length) { $('#err-lines').textContent = 'Add a description and a price.'; ok = false; }
    else if (lines.some((l) => !l.description)) { $('#err-lines').textContent = 'Every line needs a description.'; ok = false; }
    else if (!lines.some((l) => l.unit_price > 0)) { $('#err-lines').textContent = 'Please enter a price.'; ok = false; }
    if (!ok) { ($('[aria-invalid=true]', main) || $('#ld-0'))?.focus(); return; }
    if (mode === 'issue' && !(await confirmBox({ title: 'Issue this invoice?', body: 'It will receive its permanent number and can no longer be edited. Corrections are made with a credit note.', confirm: 'Issue invoice' }))) return;
    const body = { type: st.type, client_id: st.client_id, issue_date: st.issue_date, due_date: st.due_date || null, supply_date: st.supply_date || null, prices_include_vat: st.prices_include_vat, lines, notes: st.notes, payment_terms: st.payment_terms };
    await busy(btn, async () => {
      let doc = existing ? await api('PUT', `documents/${existing.id}`, body) : await api('POST', 'documents', body);
      if (mode === 'issue') doc = await api('POST', `documents/${doc.id}/issue`, {});
      await reload();
      const fresh = docById(doc.id);
      if (mode === 'pdf') await pdfFor(fresh);
      toast(mode === 'issue' ? `Invoice ${fresh.number} issued.` : mode === 'pdf' ? `${fresh.number} saved and downloaded.` : 'Saved.');
      go(`#/documents/${doc.id}`);
    });
  }
}

async function pdfFor(doc) {
  const v = buildDocView(doc, ctx());
  await downloadPdf(v, `${v.title} ${v.number} ${clientName(doc.client_id)}`);
}

// ------------------------------------------------------------------ document view
function viewDocument(main, id) {
  const d = docById(id);
  if (!d) { main.innerHTML = '<div class="empty">Document not found. <a href="#/invoices">Back to invoices</a></div>'; return; }
  const b = bal(d), s = statusOf(d);
  const view = buildDocView(d, ctx());
  const pays = data.payments.filter((p) => p.document_id === d.id || (d.type === 'invoice' && p.document_id === d.related_id));
  const related = [
    ...(d.related_id ? [docById(d.related_id)] : []),
    ...data.documents.filter((x) => x.related_id === d.id),
  ].filter(Boolean);
  const hasOwnPayments = data.payments.some((p) => p.document_id === d.id);
  const acts = [`<button class="btn btn-gold" data-act="pdf">${icon('down')}Download PDF</button>`];
  if (!(d.type === 'invoice' && d.status === 'draft')) acts.push(`<button class="btn" data-act="email">${icon('mail')}Email to client</button>`);
  if (b.balance > 0 && d.due_date && d.due_date < todayUAE() && d.status !== 'converted' && d.type !== 'credit_note' && !(d.type === 'invoice' && d.status === 'draft')) acts.push(`<button class="btn" data-act="remind">${icon('clock')}Send reminder</button>`);
  if (d.type === 'proforma' && d.status !== 'converted') {
    if (!hasOwnPayments) acts.push(`<a class="btn" href="#/documents/${d.id}/edit">${icon('edit')}Edit</a>`);
    if (b.balance > 0) acts.push('<button class="btn" data-act="pay">Record payment</button>');
    acts.push('<button class="btn btn-navy" data-act="convert">Convert to invoice</button>');
  }
  if (d.type === 'invoice' && d.status === 'draft') acts.push(`<a class="btn" href="#/documents/${d.id}/edit">${icon('edit')}Edit</a>`, '<button class="btn btn-navy" data-act="issue">Issue invoice</button>');
  if (d.type === 'invoice' && d.status === 'issued') {
    if (b.balance > 0) acts.push('<button class="btn btn-navy" data-act="pay">Record payment</button>');
    if (d.total - b.credited > 0) acts.push('<button class="btn" data-act="credit">Create credit note</button>');
  }
  const canDelete = !hasOwnPayments && ((d.type === 'proforma' && d.status !== 'converted') || (d.type === 'invoice' && d.status === 'draft'));

  main.innerHTML = `
    <a class="crumb" href="#/invoices">${icon('back')}Invoices</a>
    <div class="page-head"><div><h1>${esc(docTitle(d.type, d.snapshot?.supplier || data.settings))} ${esc(d.number || '(draft)')}</h1><p class="sub">${esc(clientName(d.client_id))} &middot; ${chip(s)}</p></div>
      <div class="doc-actions">${acts.join('')}</div></div>
    ${d.type === 'invoice' && d.status === 'draft' ? `<div class="notice info" style="margin-bottom:24px">${icon('file')}<div>This is a draft. It has no number yet and is marked DRAFT on the PDF. Issue it when it is ready to send.</div></div>` : ''}
    <div class="doc-layout">
      <div class="paper-wrap">${renderHTML(view)}</div>
      <aside class="grid">
        <section class="card card-pad"><h2 class="section-title">Summary</h2><dl class="facts">
          <div><dt>Client</dt><dd><a href="#/clients/${d.client_id}">${esc(clientName(d.client_id))}</a></dd></div>
          <div><dt>Total</dt><dd>${money(d.total)}</dd></div>
          ${d.type !== 'credit_note' ? `${b.credited ? `<div><dt>Credited</dt><dd>${money(b.credited)}</dd></div>` : ''}<div><dt>Received</dt><dd>${money(b.paid)}</dd></div><div><dt>Balance</dt><dd>${money(Math.max(0, b.balance))}</dd></div>` : ''}
          ${d.type === 'proforma' && d.status !== 'converted' ? `<div><dt><label for="pf-status">Status</label></dt><dd><select id="pf-status" style="min-width:150px">${['draft', 'sent', 'accepted', 'expired'].map((x) => `<option value="${x}" ${d.status === x ? 'selected' : ''}>${x[0].toUpperCase() + x.slice(1)}</option>`).join('')}</select></dd></div>` : ''}
        </dl></section>
        ${pays.length ? `<section class="card"><div class="card-head"><h2>Payments</h2></div><div class="mini-list">${pays.map((p) => `<a href="#/receipts/${p.id}"><span>${esc(p.receipt_number)}<br><span class="small muted">${formatDate(p.paid_on)}${p.document_id !== d.id ? ' &middot; on proforma' : ''}</span></span><strong class="money">${money(p.amount)}</strong></a>`).join('')}</div></section>` : ''}
        ${related.length ? `<section class="card"><div class="card-head"><h2>Related documents</h2></div><div class="mini-list">${related.map((x) => `<a href="#/documents/${x.id}"><span>${esc(docLabel(x))}</span>${chip(statusOf(x))}</a>`).join('')}</div></section>` : ''}
        ${emailHistory(data.emails.filter((m) => m.document_id === d.id))}
        ${canDelete ? `<button class="btn btn-danger" data-act="delete">${icon('trash')}Delete ${d.type === 'invoice' ? 'draft' : 'proforma'}</button>` : ''}
      </aside>
    </div>`;

  main.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'pdf') await busy(btn, () => pdfFor(d));
    if (act === 'email') emailDialog({ kind: d.type, doc: d });
    if (act === 'remind') emailDialog({ kind: 'reminder', doc: d });
    if (act === 'pay') paymentDialog(d.id);
    if (act === 'credit') creditDialog(d);
    if (act === 'issue' && await confirmBox({ title: 'Issue this invoice?', body: 'It will receive its permanent number and can no longer be edited. Corrections are made with a credit note.', confirm: 'Issue invoice' })) {
      await busy(btn, async () => { const x = await api('POST', `documents/${d.id}/issue`, {}); await reload(); toast(`Invoice ${x.number} issued.`); route(); });
    }
    if (act === 'convert' && await confirmBox({ title: 'Convert to invoice?', body: `A draft invoice will be created with the same lines. ${esc(d.number)} will be marked as converted, and any payments on it will count towards the invoice.`, confirm: 'Create draft invoice' })) {
      await busy(btn, async () => { const x = await api('POST', `documents/${d.id}/convert`, {}); await reload(); toast('Draft invoice created. Review it, then issue it.'); go(`#/documents/${x.id}`); });
    }
    if (act === 'delete' && await confirmBox({ title: 'Delete this document?', body: `${esc(docLabel(d))} for ${esc(clientName(d.client_id))} will be permanently deleted. This cannot be undone.`, confirm: 'Delete', danger: true })) {
      await busy(btn, async () => { await api('DELETE', `documents/${d.id}`); await reload(); toast('Deleted.'); go('#/invoices'); });
    }
  }, { once: false });
  $('#pf-status')?.addEventListener('change', async (e) => {
    await busy(null, async () => { await api('POST', `documents/${d.id}/status`, { status: e.target.value }); await reload(); toast('Status updated.'); route(); });
  });
}

// ------------------------------------------------------------------ payments and receipts
function openDocsForPayment() {
  return data.documents.filter((d) => ((d.type === 'invoice' && d.status === 'issued') || (d.type === 'proforma' && d.status !== 'converted')) && bal(d).balance > 0);
}

function paymentDialog(docId) {
  const docs = openDocsForPayment();
  if (!docs.length) { toast('There are no issued invoices or proformas with a balance to pay.'); return; }
  const methods = ['Bank transfer', 'Card', 'Cash', 'Cheque', 'Other'];
  openDialog(`<form id="pay" novalidate>
    <div class="dlg-head"><h2 id="dlg-title">Record payment</h2><button type="button" class="btn btn-quiet btn-icon" data-close aria-label="Close">${icon('x')}</button></div>
    <div class="dlg-body form">
      <div class="field"><label for="pay-doc">For document</label><select id="pay-doc">${docs.map((d) => `<option value="${d.id}" ${d.id === docId ? 'selected' : ''}>${esc(docLabel(d))} · ${esc(clientName(d.client_id))} · balance ${money(bal(d).balance)}</option>`).join('')}</select></div>
      <div class="row2">
        <div class="field"><label for="pay-amt">Amount received (${esc(cur())})</label><input id="pay-amt" class="money-in" inputmode="decimal"><span class="hint" id="pay-hint"></span><span class="err" id="pay-err" role="alert"></span></div>
        <div class="field"><label for="pay-date">Date received</label><input id="pay-date" type="date" value="${todayUAE()}"></div>
      </div>
      <div class="row2">
        <div class="field"><label for="pay-method">Method</label><select id="pay-method">${methods.map((m) => `<option>${m}</option>`).join('')}</select></div>
        <div class="field"><label for="pay-ref">Reference <span class="muted">(optional)</span></label><input id="pay-ref" placeholder="Transfer reference"></div>
      </div>
      <div class="field"><label for="pay-notes">Notes <span class="muted">(optional)</span></label><input id="pay-notes"></div>
    </div>
    <div class="dlg-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-gold" type="submit">Record &amp; create receipt</button></div></form>`, () => {
    const setAmt = () => { const d = docById(Number($('#pay-doc').value)); const b = bal(d).balance; $('#pay-amt').value = (b / 100).toFixed(2); $('#pay-hint').textContent = `Balance due ${money(b)}. Enter less for a part payment.`; };
    setAmt();
    $('#pay-doc').addEventListener('change', setAmt);
    $('#pay').addEventListener('submit', async (e) => {
      e.preventDefault();
      const amount = toFils($('#pay-amt').value);
      const d = docById(Number($('#pay-doc').value));
      if (amount <= 0) { $('#pay-err').textContent = 'Please enter the amount received.'; $('#pay-amt').setAttribute('aria-invalid', 'true'); return; }
      if (amount > bal(d).balance) { $('#pay-err').textContent = `This is more than the balance due (${money(bal(d).balance)}).`; $('#pay-amt').setAttribute('aria-invalid', 'true'); return; }
      await busy(e.submitter, async () => {
        const p = await api('POST', 'payments', { document_id: d.id, amount, paid_on: $('#pay-date').value, method: $('#pay-method').value, reference: $('#pay-ref').value, notes: $('#pay-notes').value });
        await reload(); dlg.close(); toast(`Payment recorded. Receipt ${p.receipt_number} is ready.`); go(`#/receipts/${p.id}`);
      });
    });
  });
}

function creditDialog(inv) {
  const b = bal(inv);
  const room = inv.total - b.credited;
  const firstVat = inv.lines[0]?.vat_treatment || 'standard';
  openDialog(`<form id="cn" novalidate>
    <div class="dlg-head"><h2 id="dlg-title">Credit note for ${esc(inv.number)}</h2><button type="button" class="btn btn-quiet btn-icon" data-close aria-label="Close">${icon('x')}</button></div>
    <div class="dlg-body form">
      <p class="muted small">A credit note corrects or reduces an issued invoice without changing it. Up to ${money(room)} can still be credited.</p>
      <div class="field"><label for="cn-desc">Description</label><input id="cn-desc" value="Credit against ${esc(inv.number)}"></div>
      <div class="row2">
        <div class="field"><label for="cn-amt">Amount ${inv.prices_include_vat ? 'including' : 'before'} VAT (${esc(cur())})</label><input id="cn-amt" class="money-in" inputmode="decimal"><span class="err" id="cn-err" role="alert"></span></div>
        <div class="field"><label for="cn-vat">VAT</label><select id="cn-vat">${vatOptions(firstVat, data.settings.default_vat_bp ?? 500)}</select></div>
      </div>
      <div class="field"><label for="cn-reason">Reason</label><input id="cn-reason" placeholder="e.g. Agreed discount on phase 1"></div>
      <div class="totals" id="cn-tot"></div>
    </div>
    <div class="dlg-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-navy" type="submit">Issue credit note</button></div></form>`, () => {
    const lines = () => [{ description: $('#cn-desc').value.trim() || `Credit against ${inv.number}`, qty: 1, unit_price: toFils($('#cn-amt').value), vat_treatment: $('#cn-vat').value }];
    const tot = () => { const t = computeTotals(lines(), inv.prices_include_vat, data.settings.default_vat_bp ?? 500); $('#cn-tot').innerHTML = `<div><span>Subtotal</span><span>${formatMoney(t.subtotal)}</span></div><div><span>VAT</span><span>${formatMoney(t.vat)}</span></div><div class="grand"><span>Credit total</span><span>${formatMoney(t.total)}</span></div>`; return t; };
    tot();
    $('#cn').addEventListener('input', tot);
    $('#cn').addEventListener('submit', async (e) => {
      e.preventDefault();
      const t = tot();
      if (t.total <= 0) { $('#cn-err').textContent = 'Please enter an amount.'; return; }
      if (t.total > room) { $('#cn-err').textContent = `The credit total cannot be more than ${money(room)}.`; return; }
      await busy(e.submitter, async () => {
        const cn = await api('POST', `documents/${inv.id}/credit-note`, { lines: lines(), notes: $('#cn-reason').value });
        await reload(); dlg.close(); toast(`Credit note ${cn.number} issued.`); go(`#/documents/${cn.id}`);
      });
    });
  });
}

function viewReceipts(main) {
  main.innerHTML = `<div class="page-head"><div><h1>Receipts</h1><p class="sub">A receipt is created each time you record a payment.</p></div>
    <div class="actions"><button class="btn" id="rc-csv">${icon('sheet')}Export CSV</button><button class="btn btn-gold" id="rc-new">${icon('plus')}Record payment</button></div></div>
    <section class="card">${data.payments.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Receipt</th><th>Client</th><th data-m="hide">For</th><th data-m="hide">Method</th><th class="r">Amount</th></tr></thead><tbody>
      ${data.payments.map((p) => { const d = docById(p.document_id); return `<tr data-href="#/receipts/${p.id}"><td><a class="rowlink" href="#/receipts/${p.id}">${esc(p.receipt_number)}</a><br><span class="small muted">${formatDate(p.paid_on)}</span></td><td>${esc(clientName(p.client_id))}</td><td data-m="hide">${d ? esc(docLabel(d)) : ''}</td><td data-m="hide">${esc(p.method)}</td><td class="r money">${money(p.amount)}</td></tr>`; }).join('')}
    </tbody></table></div>` : `<div class="empty">${icon('receipt')}<p>No payments recorded yet. Receipts appear here once you record a payment against an invoice or proforma.</p></div>`}</section>`;
  bindDocTable(main);
  $('#rc-new').addEventListener('click', () => paymentDialog());
  $('#rc-csv').addEventListener('click', () => csvPayments());
}

function viewReceipt(main, id) {
  const p = data.payments.find((x) => x.id === id);
  if (!p) { main.innerHTML = '<div class="empty">Receipt not found.</div>'; return; }
  const d = docById(p.document_id);
  const v = buildReceiptView(p, ctx());
  main.innerHTML = `<a class="crumb" href="#/receipts">${icon('back')}Receipts</a>
    <div class="page-head"><div><h1>Receipt ${esc(p.receipt_number)}</h1><p class="sub">${esc(clientName(p.client_id))} &middot; ${money(p.amount)} &middot; ${formatDate(p.paid_on)}</p></div>
      <div class="doc-actions"><button class="btn btn-gold" id="rc-pdf">${icon('down')}Download receipt</button><button class="btn" id="rc-mail">${icon('mail')}Email to client</button>${d ? `<a class="btn" href="#/documents/${d.id}">View ${esc(docLabel(d))}</a>` : ''}</div></div>
    <div class="doc-layout"><div class="paper-wrap">${renderHTML(v)}</div>
      <aside class="grid"><section class="card card-pad"><h2 class="section-title">Payment</h2><dl class="facts">
        <div><dt>Amount</dt><dd>${money(p.amount)}</dd></div><div><dt>Method</dt><dd>${esc(p.method || '')}</dd></div>${p.reference ? `<div><dt>Reference</dt><dd>${esc(p.reference)}</dd></div>` : ''}
        <div><dt>Balance after</dt><dd>${money(Math.max(0, p.snapshot?.balance_after ?? 0))}</dd></div></dl></section>
        ${emailHistory(data.emails.filter((m) => m.payment_id === p.id))}
        <button class="btn btn-danger" id="rc-del">${icon('trash')}Delete payment</button></aside></div>`;
  $('#rc-mail').addEventListener('click', () => emailDialog({ kind: 'receipt', payment: p }));
  $('#rc-pdf').addEventListener('click', (e) => busy(e.currentTarget, () => downloadPdf(v, `Receipt ${p.receipt_number} ${clientName(p.client_id)}`)));
  $('#rc-del').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!(await confirmBox({ title: 'Delete this payment?', body: `Receipt ${esc(p.receipt_number)} for ${money(p.amount)} will be removed and the balance restored. Only do this to correct a mistake; the receipt number will not be reused.`, confirm: 'Delete payment', danger: true }))) return;
    await busy(btn, async () => { await api('DELETE', `payments/${p.id}`); await reload(); toast('Payment deleted.'); go('#/receipts'); });
  });
}

// ------------------------------------------------------------------ clients
function clientDialog(client, onSaved, prefill = {}) {
  const c = client || prefill;
  openDialog(`<form id="cl" novalidate>
    <div class="dlg-head"><h2 id="dlg-title">${client ? 'Edit client' : 'New client'}</h2><button type="button" class="btn btn-quiet btn-icon" data-close aria-label="Close">${icon('x')}</button></div>
    <div class="dlg-body form">
      <div class="field"><label for="cl-name">Client or business name</label><input id="cl-name" value="${esc(c.name || '')}" required><span class="err" id="cl-err" role="alert"></span></div>
      <div class="row2"><div class="field"><label for="cl-contact">Contact person</label><input id="cl-contact" value="${esc(c.contact_name || '')}"></div>
        <div class="field"><label for="cl-email">Email</label><input id="cl-email" type="email" value="${esc(c.email || '')}"></div></div>
      <div class="row2"><div class="field"><label for="cl-phone">Phone</label><input id="cl-phone" type="tel" value="${esc(c.phone || '')}"></div>
        <div class="field"><label for="cl-trn">Client TRN <span class="muted">(if VAT registered)</span></label><input id="cl-trn" inputmode="numeric" value="${esc(c.trn || '')}" placeholder="15 digits"></div></div>
      <div class="field"><label for="cl-addr">Billing address</label><textarea id="cl-addr" rows="3">${esc(c.address || '')}</textarea></div>
      <div class="field"><label for="cl-notes">Notes <span class="muted">(private)</span></label><textarea id="cl-notes" rows="2">${esc(c.notes || '')}</textarea></div>
    </div>
    <div class="dlg-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-navy" type="submit">Save client</button></div></form>`, () => {
    $('#cl').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { name: $('#cl-name').value, contact_name: $('#cl-contact').value, email: $('#cl-email').value, phone: $('#cl-phone').value, trn: $('#cl-trn').value, address: $('#cl-addr').value, notes: $('#cl-notes').value, archived: client?.archived };
      if (!body.name.trim()) { $('#cl-err').textContent = 'Please enter a name.'; $('#cl-name').setAttribute('aria-invalid', 'true'); $('#cl-name').focus(); return; }
      e.submitter.setAttribute('aria-busy', 'true');
      try {
        const saved = client ? await api('PUT', `clients/${client.id}`, body) : await api('POST', 'clients', body);
        await reload(); dlg.close(); toast('Client saved.'); onSaved?.(saved);
      } catch (ex) { $('#cl-err').textContent = ex.message; } finally { e.submitter.removeAttribute('aria-busy'); }
    });
  });
}

function viewClients(main) {
  main.innerHTML = `<div class="page-head"><div><h1>Clients</h1><p class="sub">${data.clients.filter((c) => !c.archived).length} active clients</p></div>
    <div class="actions"><button class="btn" id="cl-csv">${icon('sheet')}Export CSV</button><button class="btn btn-gold" id="cl-new">${icon('plus')}Add client</button></div></div>
    <section class="card"><div class="filters" style="grid-template-columns:1fr auto"><input id="cl-q" type="text" placeholder="Search clients" aria-label="Search clients"><label class="check" style="min-height:44px;align-items:center"><input type="checkbox" id="cl-arch"> Show archived</label></div><div id="cl-body"></div></section>`;
  const draw = () => {
    const q = $('#cl-q').value.toLowerCase(), arch = $('#cl-arch').checked;
    const rows = data.clients.filter((c) => (arch || !c.archived) && (!q || [c.name, c.contact_name, c.email].join(' ').toLowerCase().includes(q)));
    $('#cl-body').innerHTML = rows.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Client</th><th data-m="hide">Email</th><th data-m="hide">Phone</th><th data-m="hide">Documents</th><th class="r">Balance due</th></tr></thead><tbody>
      ${rows.map((c) => { const docs = data.documents.filter((d) => d.client_id === c.id); const due = docs.filter((d) => d.type === 'invoice' && d.status === 'issued').reduce((s, d) => s + Math.max(0, bal(d).balance), 0);
        return `<tr data-href="#/clients/${c.id}"><td><a class="rowlink" href="#/clients/${c.id}">${esc(c.name)}</a>${c.archived ? ' <span class="chip">Archived</span>' : ''}<br><span class="small muted">${esc(c.contact_name || '')}</span></td><td data-m="hide">${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ''}</td><td data-m="hide">${c.phone ? `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : ''}</td><td data-m="hide">${docs.length}</td><td class="r money">${money(due)}</td></tr>`; }).join('')}
    </tbody></table></div>` : `<div class="empty">${icon('users')}<p>${data.clients.length ? 'No clients match your search.' : 'No clients yet.'}</p></div>`;
    bindDocTable($('#cl-body'));
  };
  $('#cl-q').addEventListener('input', draw); $('#cl-arch').addEventListener('change', draw);
  $('#cl-new').addEventListener('click', () => clientDialog(null, (c) => go(`#/clients/${c.id}`)));
  $('#cl-csv').addEventListener('click', () => csvClients());
  draw();
}

function viewClient(main, id) {
  const c = data.clients.find((x) => x.id === id);
  if (!c) { main.innerHTML = '<div class="empty">Client not found.</div>'; return; }
  const docs = data.documents.filter((d) => d.client_id === id);
  const pays = data.payments.filter((p) => p.client_id === id);
  main.innerHTML = `<a class="crumb" href="#/clients">${icon('back')}Clients</a>
    <div class="page-head"><div><h1>${esc(c.name)}</h1><p class="sub">${c.archived ? 'Archived client' : esc(c.contact_name || 'Client')}</p></div>
      <div class="actions"><a class="btn btn-gold" href="#/documents/new?type=proforma&client=${c.id}">${icon('plus')}Create proforma</a><a class="btn" href="#/documents/new?type=invoice&client=${c.id}">Create invoice</a><button class="btn" id="c-edit">${icon('edit')}Edit</button></div></div>
    <div class="grid-2">
      <section class="card">${docs.length ? docTable(docs) : '<div class="empty"><p>No documents for this client yet.</p></div>'}</section>
      <aside class="grid">
        <section class="card card-pad"><h2 class="section-title">Details</h2><dl class="facts">
          ${c.email ? `<div><dt>Email</dt><dd><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></dd></div>` : ''}${c.phone ? `<div><dt>Phone</dt><dd><a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></dd></div>` : ''}
          <div><dt>TRN</dt><dd>${esc(c.trn || 'Not provided')}</dd></div><div><dt>Address</dt><dd style="white-space:pre-line">${esc(c.address || 'Not provided')}</dd></div>
          ${c.notes ? `<div><dt>Notes</dt><dd style="white-space:pre-line;font-weight:400">${esc(c.notes)}</dd></div>` : ''}</dl></section>
        ${pays.length ? `<section class="card"><div class="card-head"><h2>Payments</h2></div><div class="mini-list">${pays.map((p) => `<a href="#/receipts/${p.id}"><span>${esc(p.receipt_number)}<br><span class="small muted">${formatDate(p.paid_on)}</span></span><strong class="money">${money(p.amount)}</strong></a>`).join('')}</div></section>` : ''}
        <div class="quick"><button class="btn" id="c-arch">${c.archived ? 'Restore client' : 'Archive client'}</button>${docs.length ? '' : `<button class="btn btn-danger" id="c-del">${icon('trash')}Delete client</button>`}</div>
      </aside></div>`;
  bindDocTable(main);
  $('#c-edit').addEventListener('click', () => clientDialog(c, () => route()));
  $('#c-arch').addEventListener('click', (e) => busy(e.currentTarget, async () => { await api('PUT', `clients/${c.id}`, { ...c, archived: !c.archived }); await reload(); toast(c.archived ? 'Client restored.' : 'Client archived.'); route(); }));
  $('#c-del')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!(await confirmBox({ title: 'Delete this client?', body: `${esc(c.name)} will be permanently deleted. This cannot be undone.`, confirm: 'Delete client', danger: true }))) return;
    await busy(btn, async () => { await api('DELETE', `clients/${c.id}`); await reload(); toast('Client deleted.'); go('#/clients'); });
  });
}

// ------------------------------------------------------------------ enquiries
function viewEnquiries(main) {
  const SERVICE = { advisory: 'Strategic advisory', website: 'Website design & development', both: 'Advisory and website', unsure: 'Not sure yet' };
  const list = data.enquiries.filter((e) => e.status !== 'archived');
  main.innerHTML = `<div class="page-head"><div><h1>Enquiries</h1><p class="sub">Messages sent through the website contact form.</p></div></div>
    <section class="card">${list.length ? list.map((e) => `<article class="enq" data-id="${e.id}">
      <div class="enq-head"><div><strong>${esc(e.name)}</strong>${e.company ? ` &middot; ${esc(e.company)}` : ''}<br><span class="small muted">${formatDate(e.created_at)} &middot; ${esc(SERVICE[e.service] || 'General enquiry')}</span></div>
        <span class="chip ${e.status === 'new' ? 'gold' : 'ok'}">${e.status === 'new' ? 'New' : 'Replied'}</span></div>
      <p class="small"><a href="mailto:${esc(e.email)}?subject=${encodeURIComponent('Your enquiry to Zenith Advisory Services')}">${esc(e.email)}</a>${e.phone ? ` &middot; <a href="tel:${esc(e.phone)}">${esc(e.phone)}</a>` : ''}</p>
      <div class="enq-msg">${esc(e.message)}</div>
      <div class="enq-actions">${e.status === 'new' ? '<button class="btn" data-e="replied">Mark as replied</button>' : '<button class="btn" data-e="new">Mark as new</button>'}
        <button class="btn" data-e="client">${icon('plus')}Create client</button><button class="btn btn-quiet" data-e="archived">Archive</button></div>
    </article>`).join('') : `<div class="empty">${icon('inbox')}<p>No enquiries yet. Messages from the website contact form will appear here.</p></div>`}</section>`;
  main.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-e]'); if (!b) return;
    const e = data.enquiries.find((x) => x.id === Number(b.closest('.enq').dataset.id));
    if (b.dataset.e === 'client') { clientDialog(null, (c) => go(`#/clients/${c.id}`), { name: e.company || e.name, contact_name: e.company ? e.name : '', email: e.email, phone: e.phone }); return; }
    await busy(b, async () => { await api('PUT', `enquiries/${e.id}`, { status: b.dataset.e }); await reload(); renderShell(); route(); });
  });
}

// ------------------------------------------------------------------ receivables
// Who owes what and when: every unpaid issued invoice and open proforma, soonest first.
function receivableRows() {
  const today = todayUAE();
  return data.documents
    .filter((d) => ((d.type === 'invoice' && d.status === 'issued') || (d.type === 'proforma' && !['converted', 'draft'].includes(d.status))) && bal(d).balance > 0)
    .map((d) => {
      const c = data.clients.find((x) => x.id === d.client_id) || {};
      const days = d.due_date ? Math.round((Date.parse(d.due_date) - Date.parse(today)) / 86400000) : null;
      const last = data.emails.find((m) => m.document_id === d.id);
      const group = days === null ? 'later' : days < 0 ? 'overdue' : days <= 7 ? 'week' : days <= 30 ? 'month' : 'later';
      return { d, c, days, last, group, balance: bal(d).balance };
    })
    .sort((a, b) => (a.d.due_date || '9999').localeCompare(b.d.due_date || '9999'));
}

function viewReceivables(main) {
  const rows = receivableRows();
  const sum = (g) => rows.filter((r) => !g || r.group === g).reduce((t, r) => t + r.balance, 0);
  const count = (g) => rows.filter((r) => r.group === g).length;
  const GROUPS = [['overdue', 'Overdue'], ['week', 'Due in the next 7 days'], ['month', 'Due within 30 days'], ['later', 'Later']];
  const when = (r) => r.days === null ? 'No due date' : r.days < 0 ? `${-r.days} day${r.days === -1 ? '' : 's'} overdue` : r.days === 0 ? 'Due today' : `In ${r.days} day${r.days === 1 ? '' : 's'}`;
  main.innerHTML = `<div class="page-head"><div><h1>Receivables</h1><p class="sub">Who owes what, and when. Issued invoices and sent proformas with a balance.</p></div>
    <div class="actions"><button class="btn" id="rv-csv">${icon('sheet')}Export CSV</button></div></div>
    <div class="grid">
      <div class="kpis">
        <div class="card kpi ${sum('overdue') ? 'alert' : ''}"><span>Overdue</span><strong>${money(sum('overdue'))}</strong><small>${plural(count('overdue'), 'document')}</small></div>
        <div class="card kpi"><span>Next 7 days</span><strong>${money(sum('week'))}</strong><small>${plural(count('week'), 'document')}</small></div>
        <div class="card kpi"><span>Within 30 days</span><strong>${money(sum('month'))}</strong><small>${plural(count('month'), 'document')}</small></div>
        <div class="card kpi"><span>Total outstanding</span><strong>${money(sum())}</strong><small>${plural(rows.length, 'document')}</small></div>
      </div>
      ${rows.length ? GROUPS.filter(([g]) => count(g)).map(([g, t]) => `<section class="card"><div class="card-head"><h2>${t}</h2><span class="money" style="font-weight:600">${money(sum(g))}</span></div>
        <div class="table-wrap"><table class="list"><thead><tr><th>Client</th><th data-m="hide">Email</th><th>Document</th><th data-m="hide">Due</th><th class="r">Balance</th><th data-m="hide">Last emailed</th><th class="r">Action</th></tr></thead><tbody>
        ${rows.filter((r) => r.group === g).map((r) => `<tr data-href="#/documents/${r.d.id}"><td><strong>${esc(r.c.name || '')}</strong><br><span class="small muted">${esc(r.c.contact_name || '')}</span></td>
          <td data-m="hide">${r.c.email ? `<a href="mailto:${esc(r.c.email)}">${esc(r.c.email)}</a>` : '<span class="muted small">No email</span>'}</td>
          <td><a class="rowlink" href="#/documents/${r.d.id}">${esc(docLabel(r.d))}</a><br><span class="small ${r.group === 'overdue' ? '' : 'muted'}" style="${r.group === 'overdue' ? 'color:var(--danger);font-weight:600' : ''}">${when(r)}</span></td>
          <td data-m="hide" class="num">${formatDate(r.d.due_date)}</td><td class="r money">${money(r.balance)}</td>
          <td data-m="hide" class="small muted">${r.last ? formatDate(r.last.sent_at) : 'Never'}</td>
          <td class="r"><div style="display:inline-flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
            <button class="btn btn-sm" data-rv="${r.group === 'overdue' ? 'remind' : 'email'}" data-id="${r.d.id}">${icon('mail')}${r.group === 'overdue' ? 'Remind' : 'Email'}</button>
            <button class="btn btn-sm" data-rv="pay" data-id="${r.d.id}">Paid</button></div></td></tr>`).join('')}
        </tbody></table></div></section>`).join('') : `<section class="card"><div class="empty">${icon('clock')}<p>Nothing outstanding. Issued invoices and sent proformas with a balance appear here.</p></div></section>`}
    </div>`;
  bindDocTable(main);
  main.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rv]'); if (!b) return;
    e.stopPropagation();
    const d = docById(Number(b.dataset.id));
    if (b.dataset.rv === 'pay') paymentDialog(d.id);
    else emailDialog({ kind: b.dataset.rv === 'remind' ? 'reminder' : d.type, doc: d });
  }, true);
  $('#rv-csv').addEventListener('click', () => downloadCsv(`receivables-${todayUAE()}.csv`,
    ['Client', 'Contact', 'Email', 'Phone', 'Document', 'Number', 'Issue date', 'Due date', 'Days to due', 'Total', 'Balance', 'Currency', 'Last emailed'],
    rows.map((r) => [r.c.name, r.c.contact_name, r.c.email, r.c.phone, TYPE_NAME[r.d.type], r.d.number, r.d.issue_date, r.d.due_date, r.days, (r.d.total / 100).toFixed(2), (r.balance / 100).toFixed(2), r.d.currency, r.last ? r.last.sent_at.slice(0, 10) : ''])));
}

// ------------------------------------------------------------------ CSV
// Opens directly in Excel and Numbers (UTF-8 with BOM, quoted fields).
function downloadCsv(filename, header, rows) {
  const cell = (v) => {
    const t = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const csv = '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function csvClients() {
  downloadCsv(`clients-${todayUAE()}.csv`,
    ['Client', 'Contact', 'Email', 'Phone', 'Address', 'TRN', 'Documents', 'Invoiced', 'Received', 'Balance due', 'Archived', 'Notes'],
    data.clients.map((c) => {
      const docs = data.documents.filter((d) => d.client_id === c.id);
      const invoiced = docs.filter((d) => d.type === 'invoice' && d.status === 'issued').reduce((t, d) => t + d.total, 0);
      const received = data.payments.filter((p) => p.client_id === c.id).reduce((t, p) => t + p.amount, 0);
      const due = docs.filter((d) => d.type === 'invoice' && d.status === 'issued').reduce((t, d) => t + Math.max(0, bal(d).balance), 0);
      return [c.name, c.contact_name, c.email, c.phone, c.address, c.trn, docs.length, (invoiced / 100).toFixed(2), (received / 100).toFixed(2), (due / 100).toFixed(2), c.archived ? 'Yes' : '', c.notes];
    }));
}

function csvDocuments() {
  downloadCsv(`documents-${todayUAE()}.csv`,
    ['Type', 'Number', 'Status', 'Client', 'Client email', 'Issue date', 'Due date', 'Subtotal', 'VAT', 'Total', 'Paid', 'Balance', 'Currency', 'Lines'],
    data.documents.map((d) => {
      const c = data.clients.find((x) => x.id === d.client_id) || {};
      const b = bal(d);
      return [TYPE_NAME[d.type], d.number || 'Draft', statusOf(d).label, c.name, c.email, d.issue_date, d.due_date, (d.subtotal / 100).toFixed(2), (d.vat_total / 100).toFixed(2), (d.total / 100).toFixed(2),
        (b.paid / 100).toFixed(2), d.type === 'credit_note' ? '' : (Math.max(0, b.balance) / 100).toFixed(2), d.currency, d.lines.map((l) => l.description).join(' | ')];
    }));
}

function csvPayments() {
  downloadCsv(`payments-${todayUAE()}.csv`,
    ['Receipt', 'Date', 'Client', 'For', 'Amount', 'Method', 'Reference', 'Notes'],
    data.payments.map((p) => { const d = docById(p.document_id); return [p.receipt_number, p.paid_on, clientName(p.client_id), d ? docLabel(d) : '', (p.amount / 100).toFixed(2), p.method, p.reference, p.notes]; }));
}

// ------------------------------------------------------------------ email
function emailHistory(list) {
  if (!list.length) return '';
  return `<section class="card"><div class="card-head"><h2>Emails sent</h2></div><div class="mini-list">${list.map((m) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:10px 24px;border-top:1px solid var(--line-2);font-size:.9rem"><span>${esc(m.subject)}<br><span class="small muted">To ${esc(m.to_email)}${m.attachment ? ` &middot; ${esc(m.attachment)}` : ''}</span></span><span class="small muted" style="white-space:nowrap">${formatDate(m.sent_at)}</span></div>`).join('')}</div></section>`;
}

function fillTemplate(t, vals) {
  return String(t || '').replace(/\{(\w+)\}/g, (m, k) => (vals[k] !== undefined && vals[k] !== null && vals[k] !== '' ? vals[k] : m));
}

const bytesToBase64 = (bytes) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

function emailDialog({ kind, doc, payment }) {
  const s = data.settings;
  const record = payment || doc;
  const clientId = payment ? payment.client_id : doc.client_id;
  const c = data.clients.find((x) => x.id === clientId) || {};
  const cur = (doc?.currency) || s.currency || 'AED';
  const target = payment ? docById(payment.document_id) : doc;
  const b = target ? bal(target) : { balance: 0 };
  const vals = {
    name: c.contact_name ? c.contact_name.trim().split(/\s+/)[0] : (c.name || ''), company: s.legal_name || 'Zenith Advisory Services', currency: cur,
    number: payment ? payment.receipt_number : doc.number || '', total: formatMoney(target ? target.total : 0),
    balance: formatMoney(Math.max(0, payment ? payment.snapshot?.balance_after ?? b.balance : b.balance)), amount: payment ? formatMoney(payment.amount) : '',
    due_date: formatDate(target?.due_date), date: formatDate(payment ? payment.paid_on : doc.issue_date),
  };
  const tkey = kind === 'credit_note' ? 'invoice' : kind;
  const subject = fillTemplate(s[`email_${tkey}_subject`], vals);
  const text = fillTemplate(s[`email_${tkey}_body`], vals) + (s.email_signature ? `\n\n${s.email_signature}` : '');
  const view = payment ? buildReceiptView(payment, ctx()) : buildDocView(doc, ctx());
  const filename = `${view.title} ${view.number} ${c.name || ''}`.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim() + '.pdf';
  const configured = data.mail.configured;
  openDialog(`<form id="em" novalidate>
    <div class="dlg-head"><h2 id="dlg-title">${kind === 'reminder' ? 'Send reminder' : 'Email to client'}</h2><button type="button" class="btn btn-quiet btn-icon" data-close aria-label="Close">${icon('x')}</button></div>
    <div class="dlg-body form">
      ${configured ? `<p class="small muted">From <strong>${esc(data.mail.from)}</strong></p>` : `<div class="notice small">${icon('warn')}<div>Email sending is not connected yet, so this opens your own mail app. Download the PDF first and attach it there.</div></div>`}
      <div class="field"><label for="em-to">To</label><input id="em-to" type="email" value="${esc(c.email || '')}" placeholder="client@example.com"><span class="err" id="em-err" role="alert"></span></div>
      <div class="field"><label for="em-cc">Cc <span class="muted">(optional)</span></label><input id="em-cc" type="text" placeholder="Separate several addresses with commas"></div>
      <div class="field"><label for="em-sub">Subject</label><input id="em-sub" value="${esc(subject)}"></div>
      <div class="field"><label for="em-text">Message</label><textarea id="em-text" rows="11">${esc(text)}</textarea></div>
      <p class="small" style="display:flex;align-items:center;gap:8px">${icon('file')}<span>Attached: <strong>${esc(filename)}</strong></span></p>
      ${configured ? '<label class="check"><input type="checkbox" id="em-copy" checked><span>Send me a copy</span></label>' : ''}
    </div>
    <div class="dlg-foot"><button type="button" class="btn" data-close>Cancel</button>
      ${configured ? `<button class="btn btn-gold" type="submit">${icon('mail')}Send email</button>` : `<button type="button" class="btn" id="em-pdf">${icon('down')}Download PDF</button><button class="btn btn-gold" type="submit">${icon('mail')}Open in my mail app</button>`}</div></form>`, () => {
    $('#em-pdf')?.addEventListener('click', (e) => busy(e.currentTarget, () => downloadPdf(view, filename.replace(/\.pdf$/, ''))));
    $('#em').addEventListener('submit', async (e) => {
      e.preventDefault();
      const to = $('#em-to').value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) { $('#em-err').textContent = 'Please enter the client’s email address.'; $('#em-to').setAttribute('aria-invalid', 'true'); $('#em-to').focus(); return; }
      if (!configured) {
        location.href = `mailto:${encodeURIComponent(to)}?${$('#em-cc').value.trim() ? `cc=${encodeURIComponent($('#em-cc').value.trim())}&` : ''}subject=${encodeURIComponent($('#em-sub').value)}&body=${encodeURIComponent($('#em-text').value)}`;
        dlg.close();
        return;
      }
      await busy(e.submitter, async () => {
        const bytes = await makePdf(view);
        await api('POST', 'email', {
          kind, document_id: payment ? null : doc.id, payment_id: payment ? payment.id : null, client_id: clientId,
          to, cc: $('#em-cc').value, subject: $('#em-sub').value, text: $('#em-text').value, copy_me: $('#em-copy')?.checked,
          attachment: { filename, data: bytesToBase64(bytes) },
        });
        if (!c.email && to) await api('PUT', `clients/${c.id}`, { ...c, email: to }).catch(() => {});
        await reload(); dlg.close(); toast(`Email sent to ${to}.`); route();
      });
    });
  });
}

// ------------------------------------------------------------------ settings
function viewSettings(main) {
  const s = data.settings, c = data.counters;
  const f = (id, label, val, extra = '') => `<div class="field"><label for="s-${id}">${label}</label><input id="s-${id}" name="${id}" value="${esc(val ?? '')}" ${extra}></div>`;
  main.innerHTML = `<div class="page-head"><div><h1>Business settings</h1><p class="sub">These details appear on your proformas, invoices and receipts.</p></div></div>
  <form id="set" class="grid" novalidate>
    <section class="card card-pad form"><h2 class="section-title">Business</h2>
      ${f('legal_name', 'Legal business name', s.legal_name)}
      <div class="field"><label for="s-address">Business address</label><textarea id="s-address" name="address" rows="3" placeholder="Building, street, area&#10;Dubai, United Arab Emirates">${esc(s.address)}</textarea></div>
      <div class="row3">${f('email', 'Email', s.email, 'type="email"')}${f('phone', 'Phone', s.phone, 'type="tel"')}${f('website', 'Website', s.website)}</div>
      <div class="field"><span class="label">Logo on documents</span><div style="display:flex;flex-wrap:wrap;align-items:center;gap:16px">
        <img id="s-logo-prev" src="${s.logo_data_url ? esc(s.logo_data_url) : '/assets/img/zenith-logo.svg'}" alt="Current logo" style="height:72px;width:auto;border:1px solid var(--line);border-radius:6px;padding:6px;background:#fff">
        <label class="btn" for="s-logo">Upload PNG or JPEG</label><input id="s-logo" type="file" accept="image/png,image/jpeg" class="sr-only">
        <button type="button" class="btn btn-quiet" id="s-logo-reset" ${s.logo_data_url ? '' : 'hidden'}>Use the Zenith logo</button></div>
        <span class="hint">The built-in Zenith logo is used unless you upload a replacement.</span></div>
    </section>
    <section class="card card-pad form"><h2 class="section-title">VAT</h2>
      <label class="check"><input type="checkbox" id="s-vat_registered" ${s.vat_registered ? 'checked' : ''}><span><strong>Registered for UAE VAT</strong><br><span class="small muted">When this is ticked and a TRN is entered, invoices are titled “Tax Invoice”.</span></span></label>
      <div class="row3">${f('trn', 'Tax Registration Number (TRN)', s.trn, 'inputmode="numeric" placeholder="15 digits"')}
        <div class="field"><label for="s-vat">Default VAT rate (%)</label><input id="s-vat" inputmode="decimal" value="${bpToPercent(s.default_vat_bp ?? 500)}"><span class="hint">5% is the UAE standard rate. Zero-rated, exempt and out-of-scope lines can be chosen per line.</span></div>
        <div class="field"><label for="s-incl">Prices are usually entered</label><select id="s-incl"><option value="0" ${s.prices_include_vat ? '' : 'selected'}>Before VAT</option><option value="1" ${s.prices_include_vat ? 'selected' : ''}>Including VAT</option></select></div></div>
      <div class="notice info">${icon('file')}<div class="small">Before relying on invoices as tax invoices, check the template against current Federal Tax Authority guidance with your accountant. Documents show placeholders such as [ADD TRN] until details are filled in.</div></div>
    </section>
    <section class="card card-pad form"><h2 class="section-title">Bank details</h2>
      <div class="row2">${f('bank_name', 'Bank name', s.bank_name)}${f('account_name', 'Account holder', s.account_name)}</div>
      <div class="row3">${f('iban', 'IBAN', s.iban, 'placeholder="AE.."')}${f('swift', 'SWIFT / BIC', s.swift)}${f('account_number', 'Account number (optional)', s.account_number)}</div>
      <div class="field"><label for="s-payment_instructions">Payment instructions</label><textarea id="s-payment_instructions" name="payment_instructions" rows="2">${esc(s.payment_instructions)}</textarea></div>
    </section>
    <section class="card card-pad form"><h2 class="section-title">Documents</h2>
      <div class="row3">${f('currency', 'Currency', s.currency || 'AED', 'maxlength="3"')}${f('invoice_due_days', 'Invoice due after (days)', s.invoice_due_days ?? 14, 'inputmode="numeric"')}${f('proforma_valid_days', 'Proforma valid for (days)', s.proforma_valid_days ?? 30, 'inputmode="numeric"')}</div>
      <div class="field"><label for="s-payment_terms">Default payment terms</label><textarea id="s-payment_terms" name="payment_terms" rows="2">${esc(s.payment_terms)}</textarea></div>
    </section>
    <section class="card card-pad form"><h2 class="section-title">Numbering</h2>
      <p class="small muted">Numbers are given in sequence. Change the next number only when moving from another system, so numbers are never repeated.</p>
      <div class="table-wrap"><table class="list" style="min-width:420px"><thead><tr><th>Document</th><th>Prefix</th><th>Next number</th></tr></thead><tbody>
        ${[['proforma', 'Proforma'], ['invoice', 'Invoice'], ['credit_note', 'Credit note'], ['receipt', 'Receipt']].map(([k, t]) => `<tr style="cursor:default"><td>${t}</td><td><input aria-label="${t} prefix" id="s-prefix_${k}" value="${esc(s[`prefix_${k}`] ?? '')}" style="max-width:120px"></td><td><input aria-label="${t} next number" id="s-n-${k}" inputmode="numeric" value="${c[k]}" style="max-width:120px"></td></tr>`).join('')}
      </tbody></table></div>
    </section>
    <section class="card card-pad form"><h2 class="section-title">Email</h2>
      ${data.mail.configured
        ? `<div class="notice info">${icon('mail')}<div class="small">Emails are sent from <strong>${esc(data.mail.from)}</strong> through your Google Workspace account. Sent emails also appear in its Sent folder when you tick “Send me a copy”.</div></div>`
        : `<div class="notice">${icon('warn')}<div class="small"><strong>Email sending is not connected yet.</strong> Until it is, “Email to client” opens your own mail app with the text filled in, and you attach the downloaded PDF. Setup steps are in the README.</div></div>`}
      <div class="row2">${f('email_from_name', 'Sender name', s.email_from_name)}<div class="field"><label for="s-email_signature">Signature</label><textarea id="s-email_signature" rows="4">${esc(s.email_signature)}</textarea></div></div>
      <p class="small muted">Standard wording. You can change any email before it is sent. These words are replaced automatically: {name} {number} {total} {balance} {amount} {currency} {due_date} {date} {company}</p>
      ${[['proforma', 'Proforma'], ['invoice', 'Invoice'], ['receipt', 'Receipt'], ['reminder', 'Payment reminder']].map(([k, t]) => `
      <details class="field"><summary style="cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:600">${t} email</summary>
        <div class="form" style="margin-top:8px">${f(`email_${k}_subject`, 'Subject', s[`email_${k}_subject`])}
        <div class="field"><label for="s-email_${k}_body">Message</label><textarea id="s-email_${k}_body" rows="8">${esc(s[`email_${k}_body`])}</textarea></div></div></details>`).join('')}
    </section>
    <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;align-items:center">
      <a class="btn" href="/api/export" download>${icon('down')}Download a full backup (JSON)</a>
      <button class="btn btn-gold btn-lg" type="submit">Save settings</button></div>
  </form>`;
  let logo = s.logo_data_url || '';
  $('#s-logo').addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (file.size > 400 * 1024) { toast('Please choose an image under 400 KB.', 'error'); return; }
    const r = new FileReader();
    r.onload = () => { logo = r.result; $('#s-logo-prev').src = logo; $('#s-logo-reset').hidden = false; };
    r.readAsDataURL(file);
  });
  $('#s-logo-reset').addEventListener('click', () => { logo = ''; $('#s-logo-prev').src = '/assets/img/zenith-logo.svg'; $('#s-logo-reset').hidden = true; });
  $('#set').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (id) => $(`#s-${id}`).value;
    const body = {
      legal_name: v('legal_name'), address: v('address'), email: v('email'), phone: v('phone'), website: v('website'),
      vat_registered: $('#s-vat_registered').checked, trn: v('trn'), default_vat_bp: percentToBp(v('vat')), prices_include_vat: v('incl') === '1',
      bank_name: v('bank_name'), account_name: v('account_name'), iban: v('iban'), swift: v('swift'), account_number: v('account_number'), payment_instructions: v('payment_instructions'),
      currency: v('currency'), invoice_due_days: v('invoice_due_days'), proforma_valid_days: v('proforma_valid_days'), payment_terms: v('payment_terms'),
      prefix_proforma: v('prefix_proforma'), prefix_invoice: v('prefix_invoice'), prefix_credit_note: v('prefix_credit_note'), prefix_receipt: v('prefix_receipt'),
      logo_data_url: logo,
      email_from_name: v('email_from_name'), email_signature: v('email_signature'),
      ...Object.fromEntries(['proforma', 'invoice', 'receipt', 'reminder'].flatMap((k) => [[`email_${k}_subject`, v(`email_${k}_subject`)], [`email_${k}_body`, v(`email_${k}_body`)]])),
      counters: Object.fromEntries(['proforma', 'invoice', 'credit_note', 'receipt'].map((k) => [k, Number(v(`n-${k}`))])),
    };
    const lowered = Object.entries(body.counters).filter(([k, n]) => n < data.counters[k]);
    if (lowered.length && !(await confirmBox({ title: 'Lower a next number?', body: 'Setting a next number lower than it is now can cause a number to be repeated. Continue only if you are sure.', confirm: 'Save anyway', danger: true }))) return;
    await busy(e.submitter, async () => { await api('PUT', 'settings', body); await reload(); renderShell(); toast('Settings saved.'); route(); });
  });
}

// ------------------------------------------------------------------ start
async function start() {
  await reload();
  renderShell();
  route();
}

(async () => {
  try {
    const s = await api('GET', 'session');
    if (!s.authenticated) { renderLogin(s.configured ? '' : 'The back office is not set up yet. Add ADMIN_PASSWORD in Netlify (see README).'); return; }
    await start();
  } catch (e) {
    app.innerHTML = `<div class="loading">Could not reach the server. ${esc(e.message)}</div>`;
  }
})();
