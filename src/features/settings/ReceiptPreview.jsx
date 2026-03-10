// ============================================================================
// features/settings/ReceiptPreview.jsx
// ============================================================================
// A pixel-perfect live thermal receipt preview. Renders entirely in-browser
// using inline styles so it matches the actual printed output regardless of
// the app's dark/light theme. Updates in real-time as settings change.
// ============================================================================

import { useMemo } from "react";

// ── QR code SVG renderer ─────────────────────────────────────────────────────
// Generates a visually authentic QR code (with correct finder patterns)
// using only React + SVG — no external library needed for the preview.
function QrCodeSvg({ value = "PREVIEW", size = 88 }) {
  const cells = 21;
  const margin = 1;
  const totalCells = cells + margin * 2;
  const cellSize = size / totalCells;

  const hash = useMemo(() => {
    let h = 5381;
    for (let i = 0; i < value.length; i++) {
      h = Math.imul(h, 33) ^ value.charCodeAt(i);
    }
    return Math.abs(h);
  }, [value]);

  const finder = (r, c) => {
    if (r < 0 || r > 6 || c < 0 || c > 6) return false;
    if (r === 0 || r === 6) return true;
    if (c === 0 || c === 6) return true;
    if (r === 1 || r === 5) return false;
    if (c === 1 || c === 5) return false;
    return true;
  };

  const isBlack = (row, col) => {
    if (row === 7 || col === 7) return false;
    if (row === 13 || col === 13) return false;
    if (row <= 6 && col <= 6) return finder(row, col);
    if (row <= 6 && col >= 14) return finder(row, col - 14);
    if (row >= 14 && col <= 6) return finder(row - 14, col);
    if (row === 6 && col >= 8 && col <= 12) return col % 2 === 0;
    if (col === 6 && row >= 8 && row <= 12) return row % 2 === 0;
    const seed = Math.abs((hash ^ (row * 1009 + col * 100003 + row * col * 7)));
    return seed % 100 < 46;
  };

  const rects = [];
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      if (isBlack(r, c)) {
        rects.push(
          <rect key={`${r}-${c}`}
            x={(c + margin) * cellSize} y={(r + margin) * cellSize}
            width={cellSize} height={cellSize} fill="#000" />
        );
      }
    }
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      xmlns="http://www.w3.org/2000/svg" style={{ display: "block", margin: "0 auto" }}>
      <rect width={size} height={size} fill="#fff" />
      {rects}
    </svg>
  );
}

// ── Sample receipt data ───────────────────────────────────────────────────────
const SAMPLE = {
  reference: "TXN-20260115-00042",
  date:      "15 Jan 2026  10:34 AM",
  cashier:   "John Adeyemi",
  customer:  "Amaka Okonkwo",
  items: [
    { name: "Indomie Noodles (×10)", qty: 2, price: 1850,  total: 3700  },
    { name: "Milo 400g Tin",         qty: 1, price: 4500,  total: 4500  },
    { name: "Peak Milk (370ml) ×6",  qty: 1, price: 3200,  total: 3200  },
    { name: "Coca-Cola 1.5L",        qty: 3, price:  900,  total: 2700  },
  ],
  subtotal: 14100,
  tax:       1057.50,
  total:    15157.50,
  tendered: 20000,
  change:    4842.50,
};

const fmt = (n) =>
  new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

// ── ReceiptPreview ────────────────────────────────────────────────────────────
export function ReceiptPreview({ settings }) {
  const s = settings || {};
  const currency   = s.currency_symbol || "₦";
  const fontSize   = s.font_size        || 12;
  const paperWidth = s.paper_width_mm   || 80;
  const footerText = s.footer_text      || "Thank you for your purchase!";

  const widthPx   = { 58: 220, 80: 302, 110: 415 }[paperWidth] ?? 302;
  const titleSize = Math.round(fontSize * 1.25);
  const smallSize = Math.round(fontSize * 0.85);
  const tinySize  = Math.max(9, Math.round(fontSize * 0.78));

  const paper = {
    width: widthPx, flexShrink: 0,
    background: "#fff", color: "#000",
    fontFamily: "'Courier New', Courier, monospace",
    fontSize: `${fontSize}px`, lineHeight: "1.45",
    padding: "14px 12px 22px",
    boxShadow: "0 8px 40px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)",
    borderRadius: "2px", position: "relative",
  };

  const divider = { borderTop: "1px dashed #888", margin: "8px 0" };
  const row = (bold) => ({
    display: "flex", justifyContent: "space-between",
    fontWeight: bold ? "bold" : "normal", marginBottom: "2px", gap: "6px",
  });

  return (
    <div style={paper}>
      {/* Logo */}
      {s.show_logo && s.logo_base64 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", marginBottom: "8px" }}>
          <img src={s.logo_base64} alt="logo"
            style={{ display: "block", maxWidth: "72px", maxHeight: "56px", objectFit: "contain" }} />
        </div>
      )}
      {s.show_logo && !s.logo_base64 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", marginBottom: "8px" }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: "56px", height: "42px", border: "1px dashed #ccc",
            borderRadius: "4px", fontSize: "9px", color: "#aaa",
          }}>LOGO</div>
        </div>
      )}

      {/* Store name */}
      <div style={{ textAlign: "center", fontWeight: "bold", fontSize: titleSize, letterSpacing: "0.5px", marginBottom: "3px" }}>
        {s.business_name || "YOUR STORE NAME"}
      </div>

      {/* Store meta */}
      {(s.business_address || s.business_phone || s.business_email) && (
        <div style={{ textAlign: "center", fontSize: smallSize, color: "#333", lineHeight: "1.65" }}>
          {s.business_address && <div>{s.business_address}</div>}
          {s.business_phone   && <div>Tel: {s.business_phone}</div>}
          {s.business_email   && <div>{s.business_email}</div>}
        </div>
      )}

      {/* Tagline */}
      {s.tagline && (
        <div style={{ textAlign: "center", fontStyle: "italic", fontSize: tinySize, color: "#555", marginTop: "3px" }}>
          {s.tagline}
        </div>
      )}

      {/* Header text */}
      {s.header_text && (
        <div style={{ textAlign: "center", fontSize: tinySize, marginTop: "3px", fontWeight: "600" }}>
          {s.header_text}
        </div>
      )}

      <div style={divider} />

      {/* Transaction info */}
      <div style={row(true)}>
        <span>Receipt #</span>
        <span style={{ letterSpacing: "0.5px", fontSize: tinySize }}>{SAMPLE.reference}</span>
      </div>
      <div style={row(false)}><span>Date</span><span>{SAMPLE.date}</span></div>
      {s.show_cashier_name  !== false && <div style={row(false)}><span>Cashier</span><span>{SAMPLE.cashier}</span></div>}
      {s.show_customer_name !== false && <div style={row(false)}><span>Customer</span><span>{SAMPLE.customer}</span></div>}

      <div style={divider} />

      {/* Items header */}
      <div style={{ ...row(true), marginBottom: "5px" }}>
        <span>Item</span><span>Amount</span>
      </div>

      {/* Items */}
      {SAMPLE.items.map((item, i) => (
        <div key={i} style={{ marginBottom: "5px" }}>
          <div style={row(false)}>
            <span style={{ flex: 1, marginRight: "4px" }}>{item.name}</span>
            <span style={{ flexShrink: 0 }}>{currency}{fmt(item.total)}</span>
          </div>
          <div style={{ fontSize: tinySize, color: "#666" }}>
            {item.qty}× {currency}{fmt(item.price)}
            {s.show_item_sku && ` [SKU-A00${i + 1}]`}
          </div>
        </div>
      ))}

      <div style={divider} />

      {/* Totals */}
      <div style={row(false)}><span>Subtotal</span><span>{currency}{fmt(SAMPLE.subtotal)}</span></div>
      {s.show_tax_breakdown !== false && (
        <div style={row(false)}><span>Tax (7.5%)</span><span>{currency}{fmt(SAMPLE.tax)}</span></div>
      )}
      <div style={{ ...row(true), borderTop: "1.5px solid #000", paddingTop: "4px", marginTop: "3px", fontSize: `${fontSize + 1}px` }}>
        <span>TOTAL</span><span>{currency}{fmt(SAMPLE.total)}</span>
      </div>
      <div style={row(false)}><span>Cash Tendered</span><span>{currency}{fmt(SAMPLE.tendered)}</span></div>
      <div style={row(false)}><span>Change</span><span>{currency}{fmt(SAMPLE.change)}</span></div>

      <div style={divider} />

      {/* QR code */}
      {s.show_qr_code ? (
        <div style={{ textAlign: "center", margin: "10px 0 6px" }}>
          <QrCodeSvg value={SAMPLE.reference} size={Math.min(90, widthPx - 40)} />
          <div style={{ fontSize: tinySize, color: "#777", marginTop: "3px" }}>Scan to verify</div>
          <div style={{ fontSize: tinySize, fontWeight: "bold", letterSpacing: "1.5px", marginTop: "2px" }}>
            {SAMPLE.reference}
          </div>
        </div>
      ) : (
        <div style={{
          textAlign: "center", fontSize: tinySize, fontWeight: "bold",
          letterSpacing: "2px", border: "1px solid #ccc",
          padding: "4px 6px", margin: "6px 0",
        }}>
          {SAMPLE.reference}
        </div>
      )}

      {/* Footer */}
      <div style={{
        textAlign: "center", fontSize: smallSize, marginTop: "8px",
        paddingTop: "8px", borderTop: "1px dashed #888", fontWeight: "500",
      }}>
        {footerText}
      </div>

      {/* Tear edge */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, height: "6px",
        background: "repeating-linear-gradient(90deg, #fff 0,#fff 4px,transparent 4px,transparent 8px)",
      }} />
    </div>
  );
}
