// ============================================================================
// RECEIPT COMMANDS
// ============================================================================

use tauri::State;
use crate::{
    error::{AppError, AppResult},
    models::receipt::{Receipt, PrintReceiptDto, ReceiptSettings, UpdateReceiptSettingsDto},
    state::AppState,
};
use super::auth::guard;

// ── QR code helper ────────────────────────────────────────────────────────────

fn generate_qr_svg(data: &str) -> String {
    use qrcode::{QrCode, EcLevel};
    use qrcode::render::svg;

    QrCode::with_error_correction_level(data.as_bytes(), EcLevel::M)
        .map(|code| {
            code.render::<svg::Color<'_>>()
                .quiet_zone(true)
                .min_dimensions(120, 120)
                .build()
        })
        .unwrap_or_default()
}

// ── get_receipt_settings ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_receipt_settings(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
) -> AppResult<ReceiptSettings> {
    guard(&state, &token).await?;
    let pool = state.pool().await?;

    // Ensure row exists (idempotent seed)
    sqlx::query!(
        "INSERT INTO receipt_settings (store_id) VALUES ($1) ON CONFLICT (store_id) DO NOTHING",
        store_id
    )
    .execute(&pool)
    .await?;

    sqlx::query_as!(
        ReceiptSettings,
        r#"SELECT
            id, store_id,
            show_logo, logo_url, logo_base64,
            business_name, business_address, business_phone, business_email, tagline,
            header_text, footer_text,
            show_cashier_name, show_customer_name, show_item_sku, show_tax_breakdown,
            show_qr_code, auto_print,
            paper_width_mm, font_size,
            COALESCE(receipt_copies, 1)   AS "receipt_copies!: i32",
            currency_symbol,
            updated_at
           FROM receipt_settings WHERE store_id = $1"#,
        store_id
    )
    .fetch_one(&pool)
    .await
    .map_err(AppError::from)
}

// ── update_receipt_settings ───────────────────────────────────────────────────

#[tauri::command]
pub async fn update_receipt_settings(
    state:   State<'_, AppState>,
    token:   String,
    payload: UpdateReceiptSettingsDto,
) -> AppResult<ReceiptSettings> {
    guard(&state, &token).await?;
    let pool = state.pool().await?;

    sqlx::query!(
        r#"INSERT INTO receipt_settings (
                store_id,
                show_logo, logo_url, logo_base64,
                business_name, business_address, business_phone, business_email, tagline,
                header_text, footer_text,
                show_cashier_name, show_customer_name, show_item_sku, show_tax_breakdown,
                show_qr_code, auto_print,
                paper_width_mm, font_size, receipt_copies, currency_symbol,
                updated_at
           ) VALUES (
                $1,  $2,  $3,  $4,  $5,  $6,  $7,  $8,  $9,
                $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21,
                NOW()
           )
           ON CONFLICT (store_id) DO UPDATE SET
                show_logo          = EXCLUDED.show_logo,
                logo_url           = EXCLUDED.logo_url,
                logo_base64        = EXCLUDED.logo_base64,
                business_name      = EXCLUDED.business_name,
                business_address   = EXCLUDED.business_address,
                business_phone     = EXCLUDED.business_phone,
                business_email     = EXCLUDED.business_email,
                tagline            = EXCLUDED.tagline,
                header_text        = EXCLUDED.header_text,
                footer_text        = EXCLUDED.footer_text,
                show_cashier_name  = EXCLUDED.show_cashier_name,
                show_customer_name = EXCLUDED.show_customer_name,
                show_item_sku      = EXCLUDED.show_item_sku,
                show_tax_breakdown = EXCLUDED.show_tax_breakdown,
                show_qr_code       = EXCLUDED.show_qr_code,
                auto_print         = EXCLUDED.auto_print,
                paper_width_mm     = EXCLUDED.paper_width_mm,
                font_size          = EXCLUDED.font_size,
                receipt_copies     = EXCLUDED.receipt_copies,
                currency_symbol    = EXCLUDED.currency_symbol,
                updated_at         = NOW()"#,
        payload.store_id,
        payload.show_logo,
        payload.logo_url,
        payload.logo_base64,
        payload.business_name,
        payload.business_address,
        payload.business_phone,
        payload.business_email,
        payload.tagline,
        payload.header_text,
        payload.footer_text,
        payload.show_cashier_name,
        payload.show_customer_name,
        payload.show_item_sku,
        payload.show_tax_breakdown,
        payload.show_qr_code,
        payload.auto_print,
        payload.paper_width_mm,
        payload.font_size,
        payload.receipt_copies,
        payload.currency_symbol,
    )
    .execute(&pool)
    .await?;

    // Return the freshly-saved settings
    sqlx::query_as!(
        ReceiptSettings,
        r#"SELECT
            id, store_id,
            show_logo, logo_url, logo_base64,
            business_name, business_address, business_phone, business_email, tagline,
            header_text, footer_text,
            show_cashier_name, show_customer_name, show_item_sku, show_tax_breakdown,
            show_qr_code, auto_print,
            paper_width_mm, font_size,
            COALESCE(receipt_copies, 1) AS "receipt_copies!: i32",
            currency_symbol,
            updated_at
           FROM receipt_settings WHERE store_id = $1"#,
        payload.store_id
    )
    .fetch_one(&pool)
    .await
    .map_err(AppError::from)
}

// ── get_receipt ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_receipt(
    state:          State<'_, AppState>,
    token:          String,
    transaction_id: i32,
) -> AppResult<Receipt> {
    guard(&state, &token).await?;
    let pool = state.pool().await?;

    let existing = sqlx::query_as!(
        Receipt,
        r#"SELECT r.id, r.transaction_id, t.reference_no,
                  s.store_name,
                  CONCAT(u.first_name, ' ', u.last_name) AS cashier_name,
                  CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
                  t.total_amount, t.payment_method,
                  r.html_content, r.printed_at, r.created_at
           FROM   receipts r
           JOIN   transactions t ON t.id = r.transaction_id
           JOIN   stores       s ON s.id = t.store_id
           LEFT JOIN users     u ON u.id = t.cashier_id
           LEFT JOIN customers c ON c.id = t.customer_id
           WHERE  r.transaction_id = $1
           ORDER  BY r.created_at DESC
           LIMIT  1"#,
        transaction_id
    )
    .fetch_optional(&pool)
    .await?;

    if let Some(r) = existing {
        return Ok(r);
    }

    generate_and_save_receipt(&pool, transaction_id).await
}

// ── generate_receipt_html ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn generate_receipt_html(
    state:   State<'_, AppState>,
    token:   String,
    payload: PrintReceiptDto,
) -> AppResult<Receipt> {
    guard(&state, &token).await?;
    let pool = state.pool().await?;

    generate_and_save_receipt(&pool, payload.transaction_id).await
}

// ── Internal: build HTML receipt using stored settings ────────────────────────

async fn generate_and_save_receipt(
    pool:           &sqlx::PgPool,
    transaction_id: i32,
) -> AppResult<Receipt> {
    // ── 1. Fetch transaction ──────────────────────────────────────────────────
    let tx = sqlx::query!(
        r#"SELECT t.id, t.reference_no, t.store_id, t.cashier_id,
                  t.customer_id, t.subtotal, t.discount_amount,
                  t.tax_amount, t.total_amount, t.amount_tendered,
                  t.change_amount, t.payment_method, t.notes, t.created_at,
                  s.store_name, s.address AS store_address,
                  s.phone AS store_phone, s.email AS store_email,
                  CONCAT(u.first_name, ' ', u.last_name) AS cashier_name,
                  CONCAT(c.first_name, ' ', c.last_name) AS customer_name
           FROM   transactions t
           JOIN   stores       s ON s.id = t.store_id
           LEFT JOIN users     u ON u.id = t.cashier_id
           LEFT JOIN customers c ON c.id = t.customer_id
           WHERE  t.id = $1"#,
        transaction_id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Transaction {transaction_id} not found")))?;

    // ── 2. Fetch line items ───────────────────────────────────────────────────
    let items = sqlx::query!(
        r#"SELECT item_name, sku, quantity, unit_price, discount, line_total
           FROM   transaction_items WHERE tx_id = $1 ORDER BY id"#,
        transaction_id
    )
    .fetch_all(pool)
    .await?;

    // ── 3. Load receipt settings (best-effort; fall back to defaults) ─────────
    let settings: Option<ReceiptSettings> = sqlx::query_as!(
        ReceiptSettings,
        r#"SELECT
            id, store_id,
            show_logo, logo_url, logo_base64,
            business_name, business_address, business_phone, business_email, tagline,
            header_text, footer_text,
            show_cashier_name, show_customer_name, show_item_sku, show_tax_breakdown,
            show_qr_code, auto_print,
            paper_width_mm, font_size,
            COALESCE(receipt_copies, 1) AS "receipt_copies!: i32",
            currency_symbol,
            updated_at
           FROM receipt_settings WHERE store_id = $1"#,
        tx.store_id
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    let cfg = settings.as_ref();

    // ── 4. Derived display values ─────────────────────────────────────────────
    let currency       = cfg.and_then(|s| s.currency_symbol.as_deref()).unwrap_or("₦");
    let font_size      = cfg.map(|s| s.font_size).unwrap_or(12);
    let paper_width_px = match cfg.map(|s| s.paper_width_mm).unwrap_or(80) {
        58  => 219,
        110 => 415,
        _   => 302, // 80 mm
    };
    let store_display_name = cfg
        .and_then(|s| s.business_name.as_deref())
        .unwrap_or(&tx.store_name);
    let address_display = cfg
        .and_then(|s| s.business_address.as_deref())
        .or(tx.store_address.as_deref())
        .unwrap_or("");
    let phone_display = cfg
        .and_then(|s| s.business_phone.as_deref())
        .or(tx.store_phone.as_deref())
        .unwrap_or("");
    let email_display = cfg
        .and_then(|s| s.business_email.as_deref())
        .or(tx.store_email.as_deref())
        .unwrap_or("");

    // ── 5. Build section fragments ────────────────────────────────────────────

    // Logo
    let logo_html = {
        let show = cfg.map(|s| s.show_logo).unwrap_or(false);
        let src  = cfg.and_then(|s| s.logo_base64.as_deref().or(s.logo_url.as_deref()));
        if show {
            if let Some(src) = src {
                format!(r#"<div class="center" style="margin-bottom:8px"><img src="{src}" style="max-width:80px;max-height:60px;object-fit:contain" /></div>"#)
            } else { String::new() }
        } else { String::new() }
    };

    let tagline_html = cfg
        .and_then(|s| s.tagline.as_deref())
        .map(|t| format!(r#"<div class="center italic" style="font-size:10px;margin-top:2px">{t}</div>"#))
        .unwrap_or_default();

    let header_html = cfg
        .and_then(|s| s.header_text.as_deref())
        .map(|h| format!(r#"<div class="center" style="font-size:10px;margin:4px 0">{h}</div>"#))
        .unwrap_or_default();

    let cashier_html = if cfg.map(|s| s.show_cashier_name).unwrap_or(true) {
        format!(r#"<div class="row"><span>Cashier</span><span>{}</span></div>"#,
            tx.cashier_name.as_deref().unwrap_or("N/A"))
    } else { String::new() };

    let customer_html = if cfg.map(|s| s.show_customer_name).unwrap_or(true) {
        tx.customer_name.as_ref()
            .map(|n| format!(r#"<div class="row"><span>Customer</span><span>{n}</span></div>"#))
            .unwrap_or_default()
    } else { String::new() };

    // Items
    let show_sku = cfg.map(|s| s.show_item_sku).unwrap_or(false);
    let mut items_html = String::new();
    for item in &items {
        let sku_html = if show_sku && !item.sku.is_empty() {
            format!(r#"<div class="sku">{}</div>"#, item.sku)
        } else { String::new() };

        items_html.push_str(&format!(
            r#"<tr>
                 <td class="item-cell">
                   <div>{}</div>
                   {sku_html}
                   <div class="sku">{}× {currency}{:.2}</div>
                 </td>
                 <td class="amount-cell">{currency}{:.2}</td>
               </tr>"#,
            item.item_name,
            item.quantity,
            item.unit_price,
            item.line_total,
        ));
    }

    // Discount row
    let rust_decimal_zero = rust_decimal::Decimal::ZERO;
    let discount_html = if tx.discount_amount > rust_decimal_zero {
        format!(
            r#"<tr><td class="total-label">Discount</td><td class="total-value">-{currency}{:.2}</td></tr>"#,
            tx.discount_amount
        )
    } else { String::new() };

    // Tax row
    let tax_html = if cfg.map(|s| s.show_tax_breakdown).unwrap_or(true) {
        format!(
            r#"<tr><td class="total-label">Tax</td><td class="total-value">{currency}{:.2}</td></tr>"#,
            tx.tax_amount
        )
    } else { String::new() };

    let tendered_html = tx.amount_tendered
        .map(|a| format!(r#"<tr><td class="total-label">Cash Tendered</td><td class="total-value">{currency}{a:.2}</td></tr>"#))
        .unwrap_or_default();

    let change_html = tx.change_amount
        .map(|c| format!(r#"<tr><td class="total-label">Change</td><td class="total-value">{currency}{c:.2}</td></tr>"#))
        .unwrap_or_default();

    // QR code
    let qr_html = if cfg.map(|s| s.show_qr_code).unwrap_or(false) {
        let svg = generate_qr_svg(&tx.reference_no);
        format!(
            r#"<div class="center" style="margin:12px 0">
                 {svg}
                 <div style="font-size:9px;color:#666;margin-top:4px">Scan to verify receipt</div>
                 <div style="font-size:9px;font-weight:bold;letter-spacing:1px">{}</div>
               </div>"#,
            tx.reference_no
        )
    } else {
        // Always show reference number prominently even without QR
        format!(
            r#"<div class="center" style="margin:8px 0;font-size:10px;font-weight:bold;letter-spacing:2px;border:1px solid #ccc;padding:4px">{}</div>"#,
            tx.reference_no
        )
    };

    let footer_text = cfg
        .and_then(|s| s.footer_text.as_deref())
        .unwrap_or("Thank you for your purchase!");

    let notes_html = tx.notes.as_ref()
        .map(|n| format!(r#"<div style="text-align:center;font-size:10px;margin-top:6px;font-style:italic">{n}</div>"#))
        .unwrap_or_default();

    let date_str = tx.created_at.format("%d %b %Y  %H:%M").to_string();

    // ── 6. Assemble HTML ──────────────────────────────────────────────────────
    // paper_width_mm drives both the @page size and the screen-preview pixel width.
    let paper_width_mm = cfg.map(|s| s.paper_width_mm).unwrap_or(80);

    let html = format!(
        r#"<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  /* ── Reset ─────────────────────────────────────────────────── */
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}

  /* ── Screen preview: fixed-width centred card ──────────────── */
  body {{
    font-family: 'Courier New', Courier, monospace;
    font-size: {font_size}px;
    width: {paper_width_px}px;
    margin: 0 auto;
    padding: 12px 10px;
    background: #fff;
    color: #000;
    line-height: 1.45;
  }}

  /* ── Thermal print overrides ────────────────────────────────── */
  @page {{
    /* Exact paper width; height 'auto' lets the roll feed freely */
    size: {paper_width_mm}mm auto;
    margin: 4mm 3mm;
  }}
  @media print {{
    html, body {{
      width: 100% !important;
      max-width: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      background: transparent !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }}
    /* Kill any coloured backgrounds so the thermal head only fires for text */
    * {{
      background: transparent !important;
      box-shadow: none !important;
      text-shadow: none !important;
    }}
    /* Prevent orphaned rows or mid-table page cuts */
    table     {{ page-break-inside: avoid; }}
    tr        {{ page-break-inside: avoid; }}
    .footer-text {{ page-break-before: avoid; }}
  }}

  /* ── Common styles (shared screen + print) ──────────────────── */
  .center {{ text-align: center; }}
  .italic {{ font-style: italic; }}
  .bold   {{ font-weight: bold; }}
  .store-name {{
    text-align: center;
    font-size: {title_size}px;
    font-weight: bold;
    letter-spacing: 1px;
    margin-bottom: 3px;
  }}
  .store-meta {{ text-align: center; font-size: 10px; line-height: 1.6; color: #333; }}
  .divider {{
    border: none;
    border-top: 1px dashed #555;
    margin: 8px 0;
  }}
  .row {{
    display: flex;
    justify-content: space-between;
    font-size: {font_size}px;
    margin-bottom: 1px;
  }}
  table {{ width: 100%; border-collapse: collapse; }}
  .item-cell   {{ padding: 3px 0; width: 75%; }}
  .amount-cell {{ text-align: right; width: 25%; padding: 3px 0; vertical-align: top; }}
  .sku {{ font-size: 9px; color: #555; }}
  .total-label {{ padding: 2px 0; }}
  .total-value {{ text-align: right; padding: 2px 0; }}
  .grand-total td {{
    font-weight: bold;
    border-top: 1px solid #000;
    padding-top: 5px;
    font-size: {grand_size}px;
  }}
  .footer-text {{
    text-align: center;
    font-size: 10px;
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px dashed #555;
  }}
</style>
</head>
<body>
  {logo_html}
  <div class="store-name">{store_display_name}</div>
  <div class="store-meta">
    {address_html}
    {phone_html}
    {email_html}
  </div>
  {tagline_html}
  {header_html}

  <hr class="divider" />

  <div class="row"><span class="bold">Receipt #</span><span>{reference_no}</span></div>
  <div class="row"><span>Date</span><span>{date_str}</span></div>
  {cashier_html}
  {customer_html}

  <hr class="divider" />

  <div class="row bold" style="margin-bottom:4px">
    <span>Item</span>
    <span>Amount</span>
  </div>
  <table><tbody>{items_html}</tbody></table>

  <hr class="divider" />

  <table>
    <tr><td class="total-label">Subtotal</td><td class="total-value">{currency}{subtotal:.2}</td></tr>
    {discount_html}
    {tax_html}
    <tr class="grand-total">
      <td class="total-label">TOTAL</td>
      <td class="total-value">{currency}{total:.2}</td>
    </tr>
    <tr><td class="total-label">Payment ({payment_method})</td><td class="total-value">{currency}{total:.2}</td></tr>
    {tendered_html}
    {change_html}
  </table>

  <hr class="divider" />
  {qr_html}

  <div class="footer-text">{footer_text}</div>
  {notes_html}
</body>
</html>"#,
        font_size        = font_size,
        title_size       = font_size + 3,
        grand_size       = font_size + 1,
        paper_width_px   = paper_width_px,
        paper_width_mm   = paper_width_mm,
        logo_html        = logo_html,
        store_display_name = store_display_name,
        address_html     = if !address_display.is_empty() {
            format!("<div>{address_display}</div>")
        } else { String::new() },
        phone_html       = if !phone_display.is_empty() {
            format!("<div>Tel: {phone_display}</div>")
        } else { String::new() },
        email_html       = if !email_display.is_empty() {
            format!("<div>{email_display}</div>")
        } else { String::new() },
        tagline_html     = tagline_html,
        header_html      = header_html,
        reference_no     = tx.reference_no,
        date_str         = date_str,
        cashier_html     = cashier_html,
        customer_html    = customer_html,
        items_html       = items_html,
        currency         = currency,
        subtotal         = tx.subtotal,
        discount_html    = discount_html,
        tax_html         = tax_html,
        total            = tx.total_amount,
        payment_method   = tx.payment_method,
        tendered_html    = tendered_html,
        change_html      = change_html,
        qr_html          = qr_html,
        footer_text      = footer_text,
        notes_html       = notes_html,
    );

    // ── 7. Persist receipt ────────────────────────────────────────────────────
    let receipt_id: i32 = sqlx::query_scalar!(
        "INSERT INTO receipts (transaction_id, html_content) VALUES ($1, $2) RETURNING id",
        transaction_id,
        html,
    )
    .fetch_one(pool)
    .await?;

    sqlx::query_as!(
        Receipt,
        r#"SELECT r.id, r.transaction_id, t.reference_no,
                  s.store_name,
                  CONCAT(u.first_name, ' ', u.last_name) AS cashier_name,
                  CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
                  t.total_amount, t.payment_method,
                  r.html_content, r.printed_at, r.created_at
           FROM   receipts r
           JOIN   transactions t ON t.id = r.transaction_id
           JOIN   stores       s ON s.id = t.store_id
           LEFT JOIN users     u ON u.id = t.cashier_id
           LEFT JOIN customers c ON c.id = t.customer_id
           WHERE  r.id = $1"#,
        receipt_id
    )
    .fetch_one(pool)
    .await
    .map_err(AppError::from)
}
