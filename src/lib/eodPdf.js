// ============================================================================
// lib/eodPdf.js — Professional EOD Report PDF Generator
// ============================================================================
// Clean, light-mode professional design — white background, crisp typography,
// structured layout suitable for printing and archiving.
// ============================================================================

import { jsPDF } from "jspdf";

// ── Colour palette ────────────────────────────────────────────────────────────
const C = {
  white:       [255, 255, 255],
  black:       [15,  15,  15],
  headerBg:    [30,  41,  59],   // slate-800  — page header strip
  headerFg:    [255, 255, 255],
  sectionBg:   [241, 245, 249],  // slate-100  — section heading bg
  sectionFg:   [51,  65,  85],   // slate-700
  tableThead:  [51,  65,  85],   // slate-700
  tableAlt:    [248, 250, 252],  // slate-50   — alternating row
  border:      [203, 213, 225],  // slate-300
  text:        [30,  41,  59],   // slate-800  — primary text
  textMuted:   [100, 116, 139],  // slate-500
  accent:      [37,  99,  235],  // blue-600   — KPI labels, links
  success:     [22,  163, 74],   // green-600
  warning:     [202, 138, 4],    // yellow-600
  danger:      [220, 38,  38],   // red-600
  kpiBorder:   [219, 234, 254],  // blue-100
  kpiBg:       [239, 246, 255],  // blue-50
  successBg:   [240, 253, 244],  // green-50
  successBdr:  [187, 247, 208],  // green-200
  dangerBg:    [254, 242, 242],  // red-50
  dangerBdr:   [254, 202, 202],  // red-200
  warningBg:   [255, 251, 235],  // yellow-50
  warningBdr:  [253, 230, 138],  // yellow-200
};

// ── Layout ────────────────────────────────────────────────────────────────────
const MARGIN  = 14;
const PW      = 210;
const PH      = 297;
const CONTENT = PW - MARGIN * 2;
const ROW_H   = 7;
const PAD     = 2.5;

// ── Helpers ───────────────────────────────────────────────────────────────────

function setFill(doc, c)      { doc.setFillColor(c[0], c[1], c[2]); }
function setDraw(doc, c)      { doc.setDrawColor(c[0], c[1], c[2]); }
function setTxt(doc, c)       { doc.setTextColor(c[0], c[1], c[2]); }
function fw(doc, w)           { doc.setFont("helvetica", w); }

function fmtMoney(val, cur = "NGN") {
  const n = parseFloat(val ?? 0);
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency", currency: cur,
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${cur} ${n.toFixed(2)}`;
  }
}

function fmtNum(val, dec = 0) {
  return (parseFloat(val ?? 0)).toLocaleString(undefined, {
    minimumFractionDigits: 0, maximumFractionDigits: dec,
  });
}

function fmtHour(h) {
  return new Date(2000, 0, 1, h)
    .toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
}

// ── Page management ───────────────────────────────────────────────────────────

let _pageFooter = "";

function newPage(doc) {
  _drawPageFooter(doc);
  doc.addPage();
  _drawPageHeader(doc, _headerMeta);
  return MARGIN + 28;
}

function checkPage(doc, y, needed = ROW_H + 2) {
  if (y + needed > PH - 18) return newPage(doc);
  return y;
}

// Store header meta for continuation pages
let _headerMeta = {};

function _drawPageHeader(doc, meta) {
  // Full-width dark header
  setFill(doc, C.headerBg);
  doc.rect(0, 0, PW, 22, "F");

  // Accent line at very top
  setFill(doc, C.accent);
  doc.rect(0, 0, PW, 2, "F");

  setTxt(doc, C.headerFg);
  doc.setFontSize(11);
  fw(doc, "bold");
  doc.text(meta.storeName ?? "", MARGIN, 13);

  doc.setFontSize(8);
  fw(doc, "normal");
  doc.text("END OF DAY REPORT", PW - MARGIN, 8, { align: "right" });
  doc.setFontSize(8);
  doc.text(meta.reportDate ?? "", PW - MARGIN, 14, { align: "right" });

  if (meta.isLocked) {
    setFill(doc, C.success);
    doc.roundedRect(PW - MARGIN - 20, 15.5, 20, 5.5, 1, 1, "F");
    setTxt(doc, C.white);
    doc.setFontSize(6.5);
    fw(doc, "bold");
    doc.text("LOCKED", PW - MARGIN - 10, 19.5, { align: "center" });
  }
}

function _drawPageFooter(doc) {
  const pg  = doc.getCurrentPageInfo().pageNumber;
  const tot = doc.getNumberOfPages();
  const y   = PH - 8;

  setDraw(doc, C.border);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y - 3, PW - MARGIN, y - 3);

  setTxt(doc, C.textMuted);
  doc.setFontSize(7);
  fw(doc, "normal");
  doc.text(_pageFooter, MARGIN, y);
  doc.text(`Page ${pg} of ${tot}`, PW - MARGIN, y, { align: "right" });
}

// ── Section heading ───────────────────────────────────────────────────────────

function sectionHead(doc, y, title, icon = "") {
  setFill(doc, C.sectionBg);
  doc.rect(MARGIN, y, CONTENT, 7.5, "F");

  // Left accent stripe
  setFill(doc, C.accent);
  doc.rect(MARGIN, y, 3, 7.5, "F");

  setTxt(doc, C.sectionFg);
  doc.setFontSize(7.5);
  fw(doc, "bold");
  doc.text((icon ? icon + "  " : "") + title.toUpperCase(), MARGIN + 5.5, y + 5.2);
  return y + 7.5 + 3;
}

// ── P&L row ───────────────────────────────────────────────────────────────────

function plRow(doc, y, label, value, opts = {}) {
  const { bold = false, indent = 0, valueColor = null, shade = false } = opts;

  if (shade) {
    setFill(doc, C.tableAlt);
    doc.rect(MARGIN, y, CONTENT, ROW_H, "F");
  }

  // Separator
  setDraw(doc, C.border);
  doc.setLineWidth(0.2);
  doc.line(MARGIN, y + ROW_H, PW - MARGIN, y + ROW_H);

  setTxt(doc, bold ? C.text : C.textMuted);
  doc.setFontSize(8.5);
  fw(doc, bold ? "bold" : "normal");
  doc.text(label, MARGIN + PAD + indent, y + 5);

  setTxt(doc, valueColor ?? (bold ? C.text : C.textMuted));
  doc.setFont("courier", bold ? "bold" : "normal");
  doc.text(value, PW - MARGIN - PAD, y + 5, { align: "right" });

  return y + ROW_H;
}

// ── Table renderer ────────────────────────────────────────────────────────────

function drawTable(doc, y, cols, rows, cur) {
  if (!rows.length) {
    setTxt(doc, C.textMuted);
    doc.setFontSize(8);
    fw(doc, "italic");
    doc.text("No data available.", MARGIN + PAD, y + 5);
    return y + 10;
  }

  const totalFlex = cols.reduce((s, c) => s + (c.flex ?? 1), 0);
  const widths    = cols.map((c) => ((c.flex ?? 1) / totalFlex) * CONTENT);

  // Header
  setFill(doc, C.tableThead);
  doc.rect(MARGIN, y, CONTENT, 6.5, "F");
  let cx = MARGIN;
  cols.forEach((col, i) => {
    setTxt(doc, C.white);
    doc.setFontSize(7);
    fw(doc, "bold");
    const align = col.align === "right" ? "right" : "left";
    const tx    = align === "right" ? cx + widths[i] - PAD : cx + PAD;
    doc.text(col.header, tx, y + 4.5, { align });
    cx += widths[i];
  });
  y += 6.5;

  // Rows
  rows.forEach((row, ri) => {
    y = checkPage(doc, y, ROW_H + 1);

    if (ri % 2 === 0) {
      setFill(doc, C.white);
    } else {
      setFill(doc, C.tableAlt);
    }
    doc.rect(MARGIN, y, CONTENT, ROW_H, "F");

    // bottom rule
    setDraw(doc, C.border);
    doc.setLineWidth(0.15);
    doc.line(MARGIN, y + ROW_H, PW - MARGIN, y + ROW_H);

    cx = MARGIN;
    cols.forEach((col, ci) => {
      let raw  = row[col.key];
      let text = "";

      if (col.type === "currency") text = fmtMoney(raw, cur);
      else if (col.type === "number") text = fmtNum(raw, col.dec ?? 0);
      else text = raw == null ? "—" : String(raw);

      if (text.length > (col.maxLen ?? 38)) text = text.slice(0, col.maxLen ?? 38) + "…";

      const color = col.colorFn ? col.colorFn(raw, row) : C.text;
      setTxt(doc, color);
      doc.setFontSize(8);
      doc.setFont(col.mono ? "courier" : "helvetica", col.bold ? "bold" : "normal");

      const align = col.align === "right" ? "right" : "left";
      const tx    = align === "right" ? cx + widths[ci] - PAD : cx + PAD;
      doc.text(text, tx, y + 5, { align });
      cx += widths[ci];
    });
    y += ROW_H;
  });

  // outer border
  setDraw(doc, C.border);
  doc.setLineWidth(0.3);
  doc.rect(MARGIN, y - rows.length * ROW_H - 6.5, CONTENT, rows.length * ROW_H + 6.5);

  return y + 4;
}

// ── Callout box ───────────────────────────────────────────────────────────────

function callout(doc, y, text, type = "info") {
  const bg  = type === "danger"  ? C.dangerBg
             : type === "success" ? C.successBg
             : C.warningBg;
  const bdr = type === "danger"  ? C.dangerBdr
             : type === "success" ? C.successBdr
             : C.warningBdr;
  const fg  = type === "danger"  ? C.danger
             : type === "success" ? C.success
             : C.warning;

  setFill(doc, bg);
  setDraw(doc, bdr);
  doc.setLineWidth(0.3);
  doc.roundedRect(MARGIN, y, CONTENT, 9, 1, 1, "FD");

  // Left stripe
  setFill(doc, fg);
  doc.roundedRect(MARGIN, y, 3, 9, 1, 1, "F");

  setTxt(doc, fg);
  doc.setFontSize(8);
  fw(doc, "bold");
  doc.text(text, MARGIN + 6, y + 5.8);
  return y + 12;
}

// ── KPI tiles ─────────────────────────────────────────────────────────────────

function kpiRow(doc, y, tiles) {
  const tileW = CONTENT / tiles.length;
  const tileH = 20;

  tiles.forEach((tile, i) => {
    const tx = MARGIN + i * tileW;

    // Background + border
    setFill(doc, tile.bg  ?? C.kpiBg);
    setDraw(doc, tile.bdr ?? C.kpiBorder);
    doc.setLineWidth(0.3);
    doc.roundedRect(tx + (i > 0 ? 1 : 0), y, tileW - (i > 0 ? 1 : 0), tileH, 2, 2, "FD");

    // Top accent strip
    setFill(doc, tile.accent ?? C.accent);
    doc.roundedRect(tx + (i > 0 ? 1 : 0), y, tileW - (i > 0 ? 1 : 0), 2.5, 1, 1, "F");

    // Label
    setTxt(doc, C.textMuted);
    doc.setFontSize(6.5);
    fw(doc, "bold");
    doc.text(tile.label, tx + (i > 0 ? 1 : 0) + PAD + 1, y + 7.5);

    // Value
    setTxt(doc, tile.valueColor ?? C.text);
    doc.setFontSize(tile.value.length > 14 ? 8 : 10);
    doc.setFont("courier", "bold");
    doc.text(tile.value, tx + (i > 0 ? 1 : 0) + PAD + 1, y + 15.5);
  });

  return y + tileH + 4;
}

// ── Divider ───────────────────────────────────────────────────────────────────

function divider(doc, y) {
  setDraw(doc, C.border);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y, PW - MARGIN, y);
  return y + 4;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

const PAYMENT_LABELS = {
  cash:         "Cash",
  card:         "Card / POS Terminal",
  transfer:     "Bank Transfer",
  credit:       "Credit (Issued to Customer)",
  mobile_money: "Mobile Money",
};

export function generateEodPdf(report, breakdown, store) {
  const r   = report    ?? {};
  const bd  = breakdown ?? {};
  const s   = store     ?? {};
  const cur = s.currency ?? "NGN";

  const reportDateFmt = r.report_date
    ? new Date(r.report_date + "T00:00:00").toLocaleDateString(undefined, {
        weekday: "long", year: "numeric", month: "long", day: "numeric",
      })
    : "—";

  _pageFooter = [
    s.receipt_footer,
    `Generated ${new Date().toLocaleString()}`,
  ].filter(Boolean).join("   ·   ");

  _headerMeta = {
    storeName:  s.store_name ?? "Store",
    reportDate: reportDateFmt,
    isLocked:   r.is_locked,
  };

  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });

  // ── PAGE 1 HEADER ───────────────────────────────────────────────────────────
  _drawPageHeader(doc, _headerMeta);

  let y = 26;

  // Store info block below header
  setFill(doc, C.white);
  doc.rect(0, 22, PW, 18, "F");

  // Store logo
  let logoEndX = MARGIN;
  if (s.logo_data) {
    try {
      doc.addImage(s.logo_data, "PNG", MARGIN, 23, 18, 14, undefined, "FAST");
      logoEndX = MARGIN + 21;
    } catch { /* skip */ }
  }

  // Store name + address + contact
  setTxt(doc, C.text);
  doc.setFontSize(12);
  fw(doc, "bold");
  doc.text(s.store_name ?? "Store", logoEndX, 29);

  const addrParts = [s.address, s.city, s.state, s.country].filter(Boolean);
  const contact   = [s.phone, s.email].filter(Boolean).join("   ·   ");

  setTxt(doc, C.textMuted);
  doc.setFontSize(7.5);
  fw(doc, "normal");
  if (addrParts.length) doc.text(addrParts.join(", "), logoEndX, 34);
  if (contact)          doc.text(contact, logoEndX, 38.5);

  // Report date (right side)
  setTxt(doc, C.text);
  doc.setFontSize(9);
  fw(doc, "bold");
  doc.text(reportDateFmt, PW - MARGIN, 30, { align: "right" });
  setTxt(doc, C.textMuted);
  doc.setFontSize(7.5);
  fw(doc, "normal");
  doc.text(`Report ID: #${r.id ?? "—"}`, PW - MARGIN, 36, { align: "right" });

  // Separator
  y = 41;
  setDraw(doc, C.border);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, y, PW - MARGIN, y);
  y += 5;

  // ── KPI TILES (2 rows × 3) ─────────────────────────────────────────────────
  const avgTx = (r.transactions_count ?? 0) > 0
    ? parseFloat(r.gross_sales ?? 0) / r.transactions_count
    : 0;

  y = kpiRow(doc, y, [
    {
      label: "GROSS SALES",
      value: fmtMoney(r.gross_sales ?? 0, cur),
      bg: C.kpiBg, bdr: C.kpiBorder, accent: C.accent, valueColor: C.accent,
    },
    {
      label: "NET SALES",
      value: fmtMoney(r.net_sales ?? 0, cur),
      bg: C.successBg, bdr: C.successBdr, accent: C.success, valueColor: C.success,
    },
    {
      label: "NET PROFIT",
      value: fmtMoney(r.net_profit ?? 0, cur),
      bg:    parseFloat(r.net_profit ?? 0) >= 0 ? C.successBg : C.dangerBg,
      bdr:   parseFloat(r.net_profit ?? 0) >= 0 ? C.successBdr : C.dangerBdr,
      accent: parseFloat(r.net_profit ?? 0) >= 0 ? C.success : C.danger,
      valueColor: parseFloat(r.net_profit ?? 0) >= 0 ? C.success : C.danger,
    },
  ]);

  y = kpiRow(doc, y, [
    {
      label: "TRANSACTIONS",
      value: fmtNum(r.transactions_count ?? 0),
      bg: [250, 250, 250], bdr: C.border, accent: [100, 116, 139], valueColor: C.text,
    },
    {
      label: "ITEMS SOLD",
      value: fmtNum(r.items_sold ?? 0),
      bg: [250, 250, 250], bdr: C.border, accent: [100, 116, 139], valueColor: C.text,
    },
    {
      label: "AVG TRANSACTION",
      value: fmtMoney(avgTx, cur),
      bg: [250, 250, 250], bdr: C.border, accent: [100, 116, 139], valueColor: C.text,
    },
  ]);

  y += 2;

  // ── PROFIT & LOSS STATEMENT ────────────────────────────────────────────────
  y = sectionHead(doc, y, "Profit & Loss Statement");

  const pnlRows = [
    { label: "Gross Sales",                value: fmtMoney(r.gross_sales           ?? 0, cur), bold: true, shade: true },
    { label: "Less: Discounts Given",      value: `(${fmtMoney(r.total_discounts   ?? 0, cur)})`, indent: 6, valueColor: C.danger },
    { label: "Less: Returns & Refunds",    value: `(${fmtMoney(r.refunds_amount    ?? 0, cur)})`, indent: 6, valueColor: C.danger },
    { label: "Net Sales",                  value: fmtMoney(r.net_sales             ?? 0, cur), bold: true, shade: true, valueColor: C.success },
    { label: "Less: Cost of Goods Sold",   value: `(${fmtMoney(r.cost_of_goods_sold ?? 0, cur)})`, indent: 6, valueColor: C.danger },
    { label: "Gross Profit",               value: fmtMoney(r.gross_profit          ?? 0, cur), bold: true, shade: true },
    { label: "Less: Operating Expenses",   value: `(${fmtMoney(r.total_expenses    ?? 0, cur)})`, indent: 6, valueColor: C.danger },
    { label: "Net Profit / (Loss)",        value: fmtMoney(r.net_profit            ?? 0, cur), bold: true, shade: true,
      valueColor: parseFloat(r.net_profit ?? 0) >= 0 ? C.success : C.danger },
    { label: "VAT / Tax Collected",        value: fmtMoney(r.total_tax             ?? 0, cur), indent: 6, valueColor: C.textMuted },
  ];

  pnlRows.forEach((row) => {
    y = checkPage(doc, y, ROW_H + 1);
    y = plRow(doc, y, row.label, row.value, {
      bold: row.bold, indent: row.indent ?? 0,
      valueColor: row.valueColor, shade: row.shade,
    });
  });
  y += 6;

  // ── PAYMENT METHODS ────────────────────────────────────────────────────────
  y = checkPage(doc, y, 30);
  y = sectionHead(doc, y, "Payment Method Breakdown");

  const payments = (bd.payment_methods ?? []).length > 0
    ? bd.payment_methods
    : [
        { payment_method: "cash",     total: r.cash_collected     ?? 0, count: null },
        { payment_method: "card",     total: r.card_collected     ?? 0, count: null },
        { payment_method: "transfer", total: r.transfer_collected ?? 0, count: null },
        { payment_method: "credit",   total: r.credit_issued      ?? 0, count: null },
      ].filter((p) => parseFloat(p.total) > 0);

  const pmRows = payments.map((pm) => ({
    method: PAYMENT_LABELS[pm.payment_method] ?? pm.payment_method,
    count:  pm.count,
    total:  pm.total,
  }));

  y = drawTable(doc, y, [
    { key: "method", header: "Payment Method",  flex: 3 },
    { key: "count",  header: "Transactions",    flex: 1.5, align: "right", type: "number" },
    { key: "total",  header: "Amount",          flex: 2, align: "right", type: "currency",
      mono: true, bold: true, colorFn: () => C.success },
  ], pmRows, cur);

  if (parseFloat(r.credit_collected ?? 0) > 0) {
    y = checkPage(doc, y, ROW_H + 1);
    y = plRow(doc, y, "Credit Debt Recovered (cash inflow)", `+${fmtMoney(r.credit_collected, cur)}`,
      { valueColor: C.success });
  }
  y += 6;

  // ── CASHIER PERFORMANCE ────────────────────────────────────────────────────
  const cashiers = bd.cashiers ?? [];
  if (cashiers.length > 0) {
    y = checkPage(doc, y, 20 + cashiers.length * ROW_H);
    y = sectionHead(doc, y, "Cashier Performance");

    y = drawTable(doc, y, [
      { key: "rank",              header: "#",             flex: 0.4, align: "right" },
      { key: "cashier_name",      header: "Cashier Name",  flex: 3 },
      { key: "transaction_count", header: "Transactions",  flex: 1.5, align: "right", type: "number" },
      { key: "total_sales",       header: "Total Sales",   flex: 2, align: "right",
        type: "currency", mono: true, bold: true, colorFn: () => C.accent },
    ], cashiers.map((c, i) => ({ rank: i + 1, ...c })), cur);

    y += 6;
  }

  // ── SHIFT CASH RECONCILIATION ──────────────────────────────────────────────
  if (r.opening_float != null) {
    y = checkPage(doc, y, 60);
    y = sectionHead(doc, y, "Shift Cash Reconciliation");

    const variance = parseFloat(r.cash_difference ?? 0);
    const expected =
      parseFloat(r.opening_float    ?? 0) +
      parseFloat(r.cash_collected   ?? 0) +
      parseFloat(r.cash_in          ?? 0) -
      parseFloat(r.cash_out         ?? 0);

    [
      { label: "Opening Float",                     value: fmtMoney(r.opening_float   ?? 0, cur) },
      { label: "  + Cash Sales",                    value: fmtMoney(r.cash_collected  ?? 0, cur), indent: 4 },
      { label: "  + Cash In (Drawer Top-ups)",      value: fmtMoney(r.cash_in         ?? 0, cur), indent: 4 },
      { label: "  − Cash Out (Withdrawals)",        value: `(${fmtMoney(r.cash_out    ?? 0, cur)})`, indent: 4, valueColor: C.danger },
      { label: "Expected Cash in Drawer",           value: fmtMoney(expected, cur), bold: true, shade: true },
      { label: "Actual Closing Cash (Counted)",     value: fmtMoney(r.closing_cash    ?? 0, cur), bold: true, shade: true },
      { label: "Variance",
        value: `${variance >= 0 ? "+" : ""}${fmtMoney(variance, cur)}`,
        bold: true, shade: true,
        valueColor: variance > 0 ? C.success : variance < 0 ? C.danger : C.text },
    ].forEach((row) => {
      y = checkPage(doc, y, ROW_H + 1);
      y = plRow(doc, y, row.label, row.value, {
        bold: row.bold, indent: row.indent ?? 0, valueColor: row.valueColor, shade: row.shade,
      });
    });

    y += 3;
    if (variance !== 0) {
      y = checkPage(doc, y, 14);
      y = callout(doc, y,
        variance < 0
          ? `CASH SHORTAGE: ${fmtMoney(Math.abs(variance), cur)} — Investigate and reconcile before closing.`
          : `CASH SURPLUS:  ${fmtMoney(variance, cur)} — Verify against shift notes and drawer count.`,
        variance < 0 ? "danger" : "warning",
      );
    }
    y += 6;
  }

  // ── VOIDS & RETURNS ────────────────────────────────────────────────────────
  if ((r.voids_count ?? 0) > 0 || (r.refunds_count ?? 0) > 0) {
    y = checkPage(doc, y, 40);
    y = sectionHead(doc, y, "Voids & Returns");

    y = drawTable(doc, y, [
      { key: "type",   header: "Type",   flex: 2.5 },
      { key: "count",  header: "Count",  flex: 1, align: "right", type: "number" },
      { key: "amount", header: "Amount", flex: 2, align: "right", type: "currency",
        mono: true, colorFn: () => C.warning },
    ], [
      { type: "Voided Transactions", count: r.voids_count    ?? 0, amount: r.voids_amount   ?? 0 },
      { type: "Returns & Refunds",   count: r.refunds_count  ?? 0, amount: r.refunds_amount ?? 0 },
    ], cur);

    y += 6;
  }

  // ── PAGE 2: PRODUCT BREAKDOWN ──────────────────────────────────────────────
  const topItems    = bd.top_items    ?? [];
  const categories  = bd.categories  ?? [];
  const departments = bd.departments ?? [];
  const hourly      = bd.hourly      ?? [];

  if (topItems.length > 0 || categories.length > 0 || departments.length > 0 || hourly.length > 0) {
    _drawPageFooter(doc);
    doc.addPage();
    _drawPageHeader(doc, _headerMeta);
    y = 28;

    // ── TOP-SELLING ITEMS ────────────────────────────────────────────────────
    if (topItems.length > 0) {
      y = sectionHead(doc, y, `Top-Selling Items  (${topItems.length} products)`);

      y = drawTable(doc, y, [
        { key: "rank",          header: "#",        flex: 0.35, align: "right" },
        { key: "item_name",     header: "Item",     flex: 3, maxLen: 34 },
        { key: "sku",           header: "SKU",      flex: 1.4, maxLen: 16 },
        { key: "category_name", header: "Category", flex: 1.8, maxLen: 18 },
        { key: "qty_sold",      header: "Qty",      flex: 0.7, align: "right", type: "number" },
        { key: "avg_price",     header: "Avg Price",flex: 1.6, align: "right", type: "currency", mono: true,
          colorFn: () => C.textMuted },
        { key: "gross_sales",   header: "Revenue",  flex: 1.8, align: "right", type: "currency",
          mono: true, bold: true, colorFn: () => C.accent },
      ], topItems.map((item, i) => ({ ...item, rank: i + 1 })), cur);

      y += 6;
    }

    // ── BY CATEGORY ──────────────────────────────────────────────────────────
    if (categories.length > 0) {
      y = checkPage(doc, y, 20 + categories.length * ROW_H);
      y = sectionHead(doc, y, "Sales by Category");

      y = drawTable(doc, y, [
        { key: "category_name",    header: "Category",   flex: 2.5, maxLen: 30 },
        { key: "department_name",  header: "Department", flex: 2,   maxLen: 24 },
        { key: "transaction_count",header: "Txns",       flex: 0.8, align: "right", type: "number" },
        { key: "qty_sold",         header: "Qty",        flex: 0.8, align: "right", type: "number" },
        { key: "gross_sales",      header: "Revenue",    flex: 1.8, align: "right", type: "currency",
          mono: true, bold: true, colorFn: () => C.accent },
        { key: "net_sales",        header: "Net Sales",  flex: 1.8, align: "right", type: "currency",
          mono: true, colorFn: () => C.textMuted },
      ], categories, cur);

      y += 6;
    }

    // ── BY DEPARTMENT ─────────────────────────────────────────────────────────
    if (departments.length > 0) {
      y = checkPage(doc, y, 20 + departments.length * ROW_H);
      y = sectionHead(doc, y, "Sales by Department");

      y = drawTable(doc, y, [
        { key: "department_name",   header: "Department", flex: 3 },
        { key: "transaction_count", header: "Txns",       flex: 0.8, align: "right", type: "number" },
        { key: "qty_sold",          header: "Qty Sold",   flex: 1,   align: "right", type: "number" },
        { key: "gross_sales",       header: "Revenue",    flex: 2,   align: "right", type: "currency",
          mono: true, bold: true, colorFn: () => C.accent },
        { key: "net_sales",         header: "Net Sales",  flex: 2,   align: "right", type: "currency",
          mono: true, colorFn: () => C.textMuted },
      ], departments, cur);

      y += 6;
    }

    // ── HOURLY SALES TIMELINE ─────────────────────────────────────────────────
    if (hourly.length > 0) {
      const needed = 18 + hourly.length * 7;
      y = checkPage(doc, y, needed);
      y = sectionHead(doc, y, "Hourly Sales Timeline");

      const maxSales = hourly.reduce((m, h) => Math.max(m, parseFloat(h.sales ?? 0)), 0);
      const BAR_MAX  = 65;
      const peakHour = hourly.reduce(
        (best, h) => (parseFloat(h.sales ?? 0) > parseFloat(best?.sales ?? 0) ? h : best),
        null,
      );

      const totalSales = hourly.reduce((s, h) => s + parseFloat(h.sales ?? 0), 0);
      const totalTxns  = hourly.reduce((s, h) => s + (h.transaction_count ?? 0), 0);

      hourly.forEach((h) => {
        y = checkPage(doc, y, 7);
        const sales  = parseFloat(h.sales ?? 0);
        const isPeak = peakHour?.hour === h.hour;
        const bw     = maxSales > 0 ? (sales / maxSales) * BAR_MAX : 0;

        if (isPeak) {
          setFill(doc, C.kpiBg);
          doc.rect(MARGIN, y, CONTENT, 6.5, "F");
        }

        // Hour label
        setTxt(doc, isPeak ? C.accent : C.textMuted);
        doc.setFont("courier", isPeak ? "bold" : "normal");
        doc.setFontSize(7.5);
        doc.text(fmtHour(h.hour), MARGIN + PAD, y + 4.5);

        // Bar track
        const barX = MARGIN + 18;
        setFill(doc, C.sectionBg);
        doc.roundedRect(barX, y + 1.5, BAR_MAX, 3, 1, 1, "F");

        // Bar fill
        if (bw > 0.5) {
          setFill(doc, isPeak ? C.accent : C.border);
          doc.roundedRect(barX, y + 1.5, bw, 3, 1, 1, "F");
        }

        // Txn count
        setTxt(doc, C.textMuted);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.text(`${h.transaction_count ?? 0}`, barX + BAR_MAX + 2, y + 4.5);

        // Amount
        setTxt(doc, isPeak ? C.accent : C.text);
        doc.setFont("courier", isPeak ? "bold" : "normal");
        doc.setFontSize(7.5);
        doc.text(fmtMoney(sales, cur), PW - MARGIN - PAD, y + 4.5, { align: "right" });

        // row separator
        setDraw(doc, C.border);
        doc.setLineWidth(0.15);
        doc.line(MARGIN, y + 6.5, PW - MARGIN, y + 6.5);

        y += 6.5;
      });

      // Totals row
      y += 1;
      setFill(doc, C.sectionBg);
      doc.rect(MARGIN, y, CONTENT, 7, "F");
      setTxt(doc, C.text);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text("Daily Total", MARGIN + PAD, y + 5);
      doc.setFont("courier", "bold");
      doc.text(fmtNum(totalTxns) + " txns", MARGIN + 85, y + 5);
      setTxt(doc, C.success);
      doc.text(fmtMoney(totalSales, cur), PW - MARGIN - PAD, y + 5, { align: "right" });
      y += 10;
    }
  }

  // ── FINAL FOOTER ───────────────────────────────────────────────────────────
  _drawPageFooter(doc);

  // Stamp page numbers across all pages
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    setTxt(doc, C.textMuted);
    doc.setFontSize(7);
    fw(doc, "normal");
    doc.text(`Page ${p} of ${total}`, PW - MARGIN, PH - 8, { align: "right" });
  }

  return doc.output("arraybuffer");
}
