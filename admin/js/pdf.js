// Branded PDF documents drawn with pdf-lib (vector text and logo, embedded brand fonts).
// Uses the same view model as the on-screen preview (doc.js).
import { LOGO } from './brand.js';

const A4 = [595.28, 841.89];
const M = 48;
let fontCache = null;

const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
// Colours are created on first use, once pdf-lib has loaded
let C = null;
const palette = () => (C ||= {
  navy: hex('#14234A'), gold: hex('#C29B4E'), goldDeep: hex('#A9853F'), ink: hex('#1E2638'),
  muted: hex('#687083'), line: hex('#E2DACB'), tint: hex('#F7F2E8'), ph: hex('#B3402F'), white: hex('#FFFFFF'),
});
const isPh = (s) => /\[(ADD [A-Z /]+|CLIENT NAME)\]/.test(String(s));

async function loadFonts(pdf) {
  pdf.registerFontkit(window.fontkit);
  if (!fontCache) {
    const get = (f) => fetch(`/admin/fonts/${f}`).then((r) => {
      if (!r.ok) throw new Error('Font failed to load');
      return r.arrayBuffer();
    });
    const [regular, medium] = await Promise.all([get('Jost-Regular.ttf'), get('Jost-Medium.ttf')]);
    fontCache = { regular, medium };
  }
  return {
    regular: await pdf.embedFont(fontCache.regular, { subset: true }),
    medium: await pdf.embedFont(fontCache.medium, { subset: true }),
  };
}

// Small drawing kit bound to one document
function kit(pdf, F) {
  const k = {
    page: null, y: 0, pages: [],
    newPage() {
      k.page = pdf.addPage(A4);
      k.pages.push(k.page);
      k.y = A4[1] - M;
      return k.page;
    },
    width: (t, size, font = F.regular, spacing = 0) => font.widthOfTextAtSize(String(t), size) + spacing * Math.max(0, String(t).length - 1),
    text(t, x, y, { size = 9, font = F.regular, color = C.ink, align = 'left', spacing = 0, opacity } = {}) {
      t = String(t ?? '');
      if (!t) return;
      const w = k.width(t, size, font, spacing);
      let x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
      const col = isPh(t) ? C.ph : color;
      if (!spacing) { k.page.drawText(t, { x: x0, y, size, font, color: col, opacity }); return; }
      for (const ch of t) {
        k.page.drawText(ch, { x: x0, y, size, font, color: col, opacity });
        x0 += font.widthOfTextAtSize(ch, size) + spacing;
      }
    },
    wrap(t, size, maxW, font = F.regular) {
      const out = [];
      String(t ?? '').split(/\n/).forEach((para) => {
        let line = '';
        para.split(/\s+/).filter(Boolean).forEach((word) => {
          const trial = line ? `${line} ${word}` : word;
          if (font.widthOfTextAtSize(trial, size) <= maxW) line = trial;
          else {
            if (line) out.push(line);
            // Break very long words
            while (font.widthOfTextAtSize(word, size) > maxW && word.length > 1) {
              let i = word.length;
              while (i > 1 && font.widthOfTextAtSize(word.slice(0, i), size) > maxW) i--;
              out.push(word.slice(0, i));
              word = word.slice(i);
            }
            line = word;
          }
        });
        out.push(line);
      });
      return out.filter((l, i, a) => l || i < a.length - 1);
    },
    rule(x1, x2, y, color = C.line, thickness = 0.6) {
      k.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });
    },
    rect(x, y, w, h, color) { k.page.drawRectangle({ x, y, width: w, height: h, color }); },
    label(t, x, y, opts = {}) { k.text(String(t).toUpperCase(), x, y, { size: 7, font: F.medium, color: C.goldDeep, spacing: 1.1, ...opts }); },
  };
  return k;
}

async function drawLogo(pdf, k, view, x, top, height) {
  if (view.logo) {
    try {
      const bytes = await fetch(view.logo).then((r) => r.arrayBuffer());
      const img = view.logo.startsWith('data:image/png') ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      const s = height / img.height;
      k.page.drawImage(img, { x, y: top - height, width: img.width * s, height });
      return img.width * s;
    } catch { /* fall back to the built-in logo */ }
  }
  // Built-in vector logo; artwork box is x 80..895, y 55..745 (815 x 690)
  const s = height / 690;
  const ox = x - 80 * s, oy = top + 55 * s;
  const draw = (d, color) => k.page.drawSvgPath(d, { x: ox, y: oy, scale: s, color });
  draw(LOGO.navy, C.navy); draw(LOGO.gold, C.gold); draw(LOGO.zenith, C.navy); draw(LOGO.tag, C.navy); draw(LOGO.tagGold, C.gold); draw(LOGO.bar, C.gold);
  return 815 * s;
}

function drawParty(k, F, p, x, y, w) {
  k.label(p.heading, x, y);
  y -= 15;
  k.wrap(p.name, 10.5, w, F.medium).forEach((l) => { k.text(l, x, y, { size: 10.5, font: F.medium, color: C.navy }); y -= 13; });
  y -= 1;
  p.lines.forEach((ln) => k.wrap(ln, 8.8, w).forEach((l) => { k.text(l, x, y, { size: 8.8 }); y -= 11.5; }));
  (p.contact || []).forEach((ln) => k.wrap(ln, 8.5, w).forEach((l) => { k.text(l, x, y, { size: 8.5, color: C.muted }); y -= 11.5; }));
  return y;
}

function drawPageFooters(k, F, view) {
  const n = k.pages.length;
  k.pages.forEach((page, i) => {
    k.page = page;
    k.rule(M, A4[0] - M, 40, C.line, 0.5);
    k.text(`${view.from.name}${view.from.contact?.length ? '  ·  ' + view.from.contact.join('  ·  ') : ''}`, M, 27, { size: 7.5, color: C.muted });
    k.text(`${view.title} ${view.number}  ·  Page ${i + 1} of ${n}`, A4[0] - M, 27, { size: 7.5, color: C.muted, align: 'right' });
  });
}

async function header(pdf, k, F, view) {
  const top = k.y;
  await drawLogo(pdf, k, view, M, top, 74);
  const R = A4[0] - M;
  let y = top - 14;
  k.text(view.title.toUpperCase(), R, y, { size: 15, font: F.medium, color: C.navy, align: 'right', spacing: 1.6 });
  y -= 19;
  k.text(`No. ${view.number}`, R, y, { size: 10, font: F.medium, color: C.ink, align: 'right' });
  y -= 15;
  (view.meta || []).forEach(([a, b]) => { k.text(`${a}: ${b}`, R, y, { size: 8.5, color: C.muted, align: 'right' }); y -= 12; });
  k.y = Math.min(top - 74, y) - 26;
}

function tableHeader(k, F, cols, currency) {
  const R = A4[0] - M;
  k.rule(M, R, k.y, C.navy, 0.9);
  const y = k.y - 13;
  k.label('#', cols.n, y, { color: C.muted });
  k.label('Description', cols.desc, y, { color: C.muted });
  k.label('Qty', cols.qty, y, { color: C.muted, align: 'right' });
  k.label('Unit price', cols.unit, y, { color: C.muted, align: 'right' });
  k.label('VAT', cols.vat, y, { color: C.muted, align: 'right' });
  k.label(`Amount (${currency})`, cols.amount, y, { color: C.muted, align: 'right' });
  k.y = y - 8;
  k.rule(M, R, k.y);
}

async function documentPdf(view) {
  const pdf = await PDFLib.PDFDocument.create();
  pdf.setTitle(`${view.title} ${view.number}`);
  pdf.setAuthor(view.from.name);
  pdf.setCreator('Zenith Advisory Services back office');
  const F = await loadFonts(pdf);
  const k = kit(pdf, F);
  const R = A4[0] - M;
  const BOTTOM = 64;
  k.newPage();
  const watermark = () => {
    if (!view.draft) return;
    k.page.drawText('DRAFT', { x: 150, y: 300, size: 120, font: F.medium, color: C.line, rotate: PDFLib.degrees(35), opacity: 0.55 });
  };
  watermark();
  await header(pdf, k, F, view);

  // Parties
  const colW = (R - M) / 2 - 16;
  const yA = drawParty(k, F, view.to, M, k.y, colW);
  const yB = drawParty(k, F, view.from, M + (R - M) / 2 + 16, k.y, colW);
  k.y = Math.min(yA, yB) - 18;

  // Line items
  const cols = { n: M, desc: M + 20, qty: R - 212, unit: R - 132, vat: R - 86, amount: R };
  const descW = cols.qty - 34 - cols.desc;
  tableHeader(k, F, cols, view.currency);
  for (const r of view.rows) {
    const dl = k.wrap(r.desc, 9.3, descW, F.medium);
    const xl = r.details ? k.wrap(r.details, 8, descW) : [];
    const h = 9 + dl.length * 12 + xl.length * 10.5 + 6;
    if (k.y - h < BOTTOM) {
      k.newPage(); watermark();
      k.text(`${view.title} ${view.number} (continued)`, M, k.y - 4, { size: 9, font: F.medium, color: C.navy });
      k.y -= 22;
      tableHeader(k, F, cols, view.currency);
    }
    let y = k.y - 15;
    k.text(r.n, cols.n, y, { size: 9, color: C.muted });
    k.text(r.qty, cols.qty, y, { size: 9, align: 'right' });
    k.text(r.unit, cols.unit, y, { size: 9, align: 'right' });
    k.text(r.vat, cols.vat, y, { size: 9, align: 'right' });
    k.text(r.amount, cols.amount, y, { size: 9, font: F.medium, align: 'right' });
    dl.forEach((l) => { k.text(l, cols.desc, y, { size: 9.3, font: F.medium }); y -= 12; });
    xl.forEach((l) => { k.text(l, cols.desc, y + 1, { size: 8, color: C.muted }); y -= 10.5; });
    k.y -= h;
    k.rule(M, R, k.y);
  }

  // Totals
  const tw = 230, tx = R - tw;
  const need = view.totals.length * 19 + 20;
  if (k.y - need < BOTTOM) { k.newPage(); watermark(); }
  k.y -= 10;
  view.totals.forEach(([a, b, s]) => {
    const strong = s === 'strong';
    if (strong) k.rect(tx, k.y - 21, tw, 21, C.tint);
    const y = k.y - 14;
    k.text(a, tx + 10, y, { size: strong ? 9.8 : 9, font: strong ? F.medium : F.regular, color: s === 'note' ? C.muted : C.ink });
    k.text(b, R - 10, y, { size: strong ? 10.5 : 9, font: strong ? F.medium : F.regular, color: strong ? C.navy : C.ink, align: 'right' });
    k.y -= strong ? 23 : 18;
  });
  k.y -= 18;

  // Bank details and payment terms, side by side
  if (view.bank.length || view.terms.length) {
    const half = (R - M) / 2 - 16;
    const termLines = view.terms.map((t, i) => k.wrap(`${i + 1}. ${t}`, 8.5, half));
    const need2 = Math.max(view.bank.length * 13, termLines.flat().length * 11.5 + view.terms.length * 3) + 34;
    if (k.y - need2 < BOTTOM) { k.newPage(); watermark(); }
    const top = k.y;
    k.rule(M, R, top, C.line, 0.6);
    let y1 = top - 18, y2 = top - 18;
    if (view.bank.length) {
      k.label('Bank details', M, y1); y1 -= 15;
      view.bank.forEach(([a, b]) => {
        k.text(a, M, y1, { size: 8.5, color: C.muted });
        k.text(b, M + 78, y1, { size: 8.5, font: F.medium });
        y1 -= 13;
      });
    }
    if (view.terms.length) {
      const x2 = M + (R - M) / 2 + 16;
      k.label('Payment terms', x2, y2); y2 -= 15;
      termLines.forEach((lines) => { lines.forEach((l) => { k.text(l, x2, y2, { size: 8.5 }); y2 -= 11.5; }); y2 -= 3; });
    }
    k.y = Math.min(y1, y2) - 10;
  }

  if (view.notes) {
    const nl = k.wrap(view.notes, 8.8, R - M);
    if (k.y - (nl.length * 12 + 26) < BOTTOM) { k.newPage(); watermark(); }
    k.label('Notes', M, k.y - 4); k.y -= 18;
    nl.forEach((l) => { k.text(l, M, k.y, { size: 8.8 }); k.y -= 12; });
    k.y -= 8;
  }

  if (view.footer.length) {
    const fl = k.wrap(view.footer.join(' '), 8.8, R - M, F.medium);
    if (k.y - (fl.length * 12 + 12) < BOTTOM) k.newPage();
    k.y -= 4;
    fl.forEach((l) => { k.text(l, M, k.y, { size: 8.8, font: F.medium, color: C.navy }); k.y -= 12; });
  }

  drawPageFooters(k, F, view);
  return pdf.save();
}

async function receiptPdf(view) {
  const pdf = await PDFLib.PDFDocument.create();
  pdf.setTitle(`${view.title} ${view.number}`);
  pdf.setAuthor(view.from.name);
  const F = await loadFonts(pdf);
  const k = kit(pdf, F);
  const R = A4[0] - M;
  k.newPage();
  await header(pdf, k, F, { ...view, meta: [] });

  // Amount band with the received mark
  const bandH = 92;
  k.rect(M, k.y - bandH, R - M, bandH, C.tint);
  k.label('Amount received', M + 20, k.y - 26);
  k.text(view.amount, M + 20, k.y - 62, { size: 26, font: F.medium, color: C.navy });
  const sw = 150, sh = 34, sx = R - 20 - sw, sy = k.y - bandH / 2 - sh / 2;
  k.page.drawRectangle({ x: sx, y: sy, width: sw, height: sh, borderColor: C.gold, borderWidth: 1.4 });
  k.page.drawRectangle({ x: sx + 3, y: sy + 3, width: sw - 6, height: sh - 6, borderColor: C.gold, borderWidth: 0.5 });
  k.text('PAYMENT RECEIVED', sx + sw / 2, sy + 13, { size: 9, font: F.medium, color: C.goldDeep, align: 'center', spacing: 1.4 });
  k.y -= bandH + 26;

  view.rows.forEach(([a, b]) => {
    k.text(a, M, k.y, { size: 9, color: C.muted });
    k.wrap(b, 9.5, R - M - 160, F.medium).forEach((l, i) => { k.text(l, R, k.y - i * 12, { size: 9.5, font: F.medium, align: 'right' }); if (i) k.y -= 12; });
    k.y -= 9;
    k.rule(M, R, k.y);
    k.y -= 15;
  });

  if (view.summary.length) {
    const tw = 260, tx = R - tw;
    k.y -= 4;
    view.summary.forEach(([a, b, s]) => {
      const strong = s === 'strong';
      if (strong) k.rect(tx, k.y - 21, tw, 21, C.tint);
      k.text(a, tx + 10, k.y - 14, { size: strong ? 9.8 : 9, font: strong ? F.medium : F.regular });
      k.text(b, R - 10, k.y - 14, { size: strong ? 10.5 : 9, font: strong ? F.medium : F.regular, color: strong ? C.navy : C.ink, align: 'right' });
      k.y -= strong ? 23 : 18;
    });
    k.y -= 14;
  }

  if (view.notes) {
    k.label('Notes', M, k.y); k.y -= 15;
    k.wrap(view.notes, 8.8, R - M).forEach((l) => { k.text(l, M, k.y, { size: 8.8 }); k.y -= 12; });
    k.y -= 10;
  }

  k.rule(M, R, k.y, C.line, 0.6);
  k.y -= 20;
  drawParty(k, F, view.from, M, k.y, (R - M) / 2);
  k.text(view.footer[0], R, k.y - 15, { size: 10.5, font: F.medium, color: C.navy, align: 'right' });

  drawPageFooters(k, F, view);
  return pdf.save();
}

export async function makePdf(view) {
  if (!window.PDFLib || !window.fontkit) throw new Error('The PDF tools did not load. Please refresh the page.');
  palette();
  return view.kind === 'receipt' ? receiptPdf(view) : documentPdf(view);
}

export async function downloadPdf(view, filename) {
  const bytes = await makePdf(view);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim() + '.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
