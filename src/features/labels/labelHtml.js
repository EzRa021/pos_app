// ============================================================================
// features/labels/labelHtml.js
// ============================================================================
// Pure function — no React, no side effects.
// Generates a self-contained HTML document suitable for iframe printing.
//
// Barcode rendering uses JsBarcode loaded from Cloudflare CDN.
// window.print() is called automatically after barcodes are initialized.
//
// Label formats:
//   58mm — narrow thermal (54mm usable), single column
//   80mm — standard thermal (76mm usable), single column
//   a4   — desktop printer, 3-column grid, 24 labels per page
// ============================================================================

const FORMAT_CONFIG = {
  "58mm": {
    pageWidth:      "58mm",
    pageMargin:     "2mm 1mm",
    labelWidth:     "54mm",
    labelMinHeight: "28mm",
    cols:           1,
    gap:            "2mm",
    nameFontPt:     8,
    priceFontPt:    13,
    barcodeHeight:  28,
    barcodeFontPx:  7,
  },
  "80mm": {
    pageWidth:      "80mm",
    pageMargin:     "3mm 2mm",
    labelWidth:     "74mm",
    labelMinHeight: "38mm",
    cols:           1,
    gap:            "3mm",
    nameFontPt:     9,
    priceFontPt:    15,
    barcodeHeight:  36,
    barcodeFontPx:  8,
  },
  "a4": {
    pageWidth:      "210mm",
    pageMargin:     "8mm 8mm",
    labelWidth:     "58mm",
    labelMinHeight: "35mm",
    cols:           3,
    gap:            "4mm",
    nameFontPt:     8,
    priceFontPt:    12,
    barcodeHeight:  30,
    barcodeFontPx:  7,
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escAttr(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");
}

function formatNaira(value) {
  const n = parseFloat(value) || 0;
  return (
    "₦" +
    n.toLocaleString("en-NG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * generateLabelHtml(labels, template) → string (complete HTML document)
 *
 * @param {Array}  labels   - ItemLabel[] returned by generate_item_labels
 * @param {Object} template - LabelTemplate object (or DEFAULT_TEMPLATE)
 */
export function generateLabelHtml(labels, template) {
  const fmt = template?.format || "80mm";
  const cfg = FORMAT_CONFIG[fmt] || FORMAT_CONFIG["80mm"];
  const {
    pageWidth, pageMargin, labelWidth, labelMinHeight,
    cols, gap, nameFontPt, priceFontPt, barcodeHeight, barcodeFontPx,
  } = cfg;

  const showName   = template?.show_name   !== false;
  const showPrice  = template?.show_price  !== false;
  const showSku    = template?.show_sku    !== false;
  const showStore  = template?.show_store  ?? false;
  const showExpiry = template?.show_expiry ?? false;

  // ── Build label HTML blocks ─────────────────────────────────────────────
  const labelBlocks = labels
    .map((label, i) => {
      // Prefer barcode, then SKU as fallback — CODE128 supports alphanumeric
      const rawBarcode = (label.barcode || label.sku || "").trim();
      // Strip characters outside CODE128 printable set to avoid JsBarcode errors
      const barcodeVal = rawBarcode.replace(/[^\x20-\x7E]/g, "").substring(0, 80);
      const safePriceVal = formatNaira(label.selling_price);

      return `<div class="label" id="lbl${i}">
  ${showStore ? `<div class="lbl-store">${escHtml(label.store_name)}</div>` : ""}
  ${showName  ? `<div class="lbl-name">${escHtml(label.item_name)}</div>` : ""}
  <div class="lbl-barcode-zone">
    ${barcodeVal
      ? `<svg class="barcode-svg" data-value="${escAttr(barcodeVal)}" id="bcsvg${i}"></svg>`
      : `<div class="lbl-no-barcode">No barcode · ${escHtml(label.sku || label.item_id.slice(0, 10))}</div>`
    }
  </div>
  ${showSku   ? `<div class="lbl-sku">SKU: ${escHtml(label.sku || "—")}</div>` : ""}
  <div class="lbl-bottom">
    ${showPrice  ? `<div class="lbl-price">${escHtml(safePriceVal)}</div>` : ""}
    ${showExpiry ? `<div class="lbl-expiry">Exp: ____________</div>` : ""}
  </div>
</div>`;
    })
    .join("\n");

  // ── CSS ────────────────────────────────────────────────────────────────────
  const gridCols =
    fmt === "a4" ? `repeat(${cols}, ${labelWidth})` : `${labelWidth}`;

  const css = `
*{box-sizing:border-box;margin:0;padding:0;}
html,body{
  font-family:'Courier New',Courier,monospace;
  font-size:10pt;
  background:#fff;color:#000;
}
@media print{
  @page{
    size:${fmt === "a4" ? "A4 portrait" : `${pageWidth} auto`};
    margin:${pageMargin};
  }
  html,body{margin:0;padding:0;}
  .no-print{display:none!important;}
}
body{padding:${pageMargin};background:#fff;}
.label-grid{
  display:grid;
  grid-template-columns:${gridCols};
  gap:${gap};
  justify-content:start;
}
.label{
  width:${labelWidth};
  min-height:${labelMinHeight};
  border:0.6pt solid #bbb;
  border-radius:2pt;
  padding:2mm 2.5mm;
  display:flex;
  flex-direction:column;
  gap:0.8mm;
  overflow:hidden;
  page-break-inside:avoid;
  break-inside:avoid;
  background:#fff;
}
.lbl-store{
  font-size:6pt;
  text-transform:uppercase;
  letter-spacing:0.6pt;
  color:#666;
  line-height:1.2;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.lbl-name{
  font-size:${nameFontPt}pt;
  font-weight:700;
  font-family:Arial,Helvetica,sans-serif;
  color:#000;
  line-height:1.25;
  overflow:hidden;
  display:-webkit-box;
  -webkit-line-clamp:2;
  -webkit-box-orient:vertical;
}
.lbl-barcode-zone{
  flex:1;
  display:flex;
  align-items:center;
  justify-content:center;
  min-height:${barcodeHeight + 10}px;
  overflow:hidden;
}
.barcode-svg{
  max-width:100%;
  height:auto;
  display:block;
}
.lbl-no-barcode{
  font-size:7pt;
  color:#999;
  font-style:italic;
  text-align:center;
}
.lbl-sku{
  font-size:6.5pt;
  color:#555;
  font-family:'Courier New',monospace;
  letter-spacing:0.3pt;
  line-height:1.2;
}
.lbl-bottom{
  margin-top:auto;
  display:flex;
  align-items:center;
  justify-content:flex-end;
  gap:3mm;
  border-top:0.5pt solid #e0e0e0;
  padding-top:0.8mm;
}
.lbl-price{
  font-size:${priceFontPt}pt;
  font-weight:800;
  font-family:Arial,Helvetica,sans-serif;
  color:#000;
  line-height:1.1;
  text-align:right;
}
.lbl-expiry{
  font-size:6.5pt;
  color:#444;
  font-family:Arial,Helvetica,sans-serif;
  line-height:1.3;
}`;

  // ── JS barcode init ─────────────────────────────────────────────────────────
  // window.print() is called here (inside the iframe HTML) after barcodes init.
  // The parent removes the iframe via a cleanup timeout.
  const initScript = `
window.addEventListener('load', function() {
  var svgs = document.querySelectorAll('.barcode-svg');
  svgs.forEach(function(svg) {
    var val = svg.getAttribute('data-value');
    if (!val) return;
    try {
      JsBarcode(svg, val, {
        format:       'CODE128',
        displayValue: true,
        fontSize:     ${barcodeFontPx},
        height:       ${barcodeHeight},
        margin:       2,
        lineColor:    '#000',
        background:   '#ffffff',
        textMargin:   1,
        valid: function() { return true; }
      });
    } catch(e) {
      // Fallback: show raw value as text when JsBarcode fails
      var w = svg.getAttribute('width') || 120;
      svg.setAttribute('viewBox','0 0 '+w+' 20');
      svg.setAttribute('width',w);
      svg.setAttribute('height','20');
      var t = document.createElementNS('http://www.w3.org/2000/svg','text');
      t.setAttribute('x','50%');t.setAttribute('y','15');
      t.setAttribute('text-anchor','middle');
      t.setAttribute('font-size','8');
      t.textContent = val;
      svg.appendChild(t);
    }
  });
  window.print();
});`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width">
<title>Item Labels</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js"></script>
<style>${css}</style>
</head>
<body>
<div class="label-grid">
${labelBlocks}
</div>
<script>${initScript}</script>
</body>
</html>`;
}
