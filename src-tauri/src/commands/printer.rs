// ============================================================================
// commands/printer.rs — Native ESC/POS printing via Windows print spooler
// ============================================================================
//
// Architecture
// ────────────
// Three Tauri commands expose direct printer access to the frontend:
//   list_printers        → Vec<PrinterInfo>   (all installed Windows printers)
//   get_default_printer  → Option<String>     (current system default)
//   print_receipt_escpos → ()                 (silent receipt print)
//   print_labels_escpos  → ()                 (silent label batch print)
//   print_test_page      → ()                 (quick hardware verification)
//
// These commands use Tauri invoke (NOT the HTTP RPC server) because each
// client terminal must print on its own locally-attached printer.
//
// ESC/POS byte stream is built in the `escpos` submodule.
// Windows print spooler calls live in the `os` submodule.
// Non-Windows builds compile but return safe empty/error stubs.
// ============================================================================

use tauri::State;
use serde::{Deserialize, Serialize};
use crate::{
    error::{AppError, AppResult},
    state::AppState,
};
use super::auth::guard;

// ── Public models ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
pub struct PrinterInfo {
    pub name:       String,
    pub is_default: bool,
}

#[derive(Debug, Deserialize)]
pub struct PrintReceiptEscposDto {
    pub transaction_id: i32,
    pub printer_name:   String,
}

#[derive(Debug, Deserialize)]
pub struct PrintLabelsEscposDto {
    pub store_id:      i32,
    pub printer_name:  String,
    pub item_ids:      Option<Vec<String>>,
    pub category_id:   Option<i32>,
    pub department_id: Option<i32>,
    pub copies:        Option<i32>,
    pub show_name:     Option<bool>,
    pub show_price:    Option<bool>,
    pub show_sku:      Option<bool>,
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Return all printers visible to the Windows print spooler.
#[tauri::command]
pub async fn list_printers(
    state: State<'_, AppState>,
    token: String,
) -> AppResult<Vec<PrinterInfo>> {
    guard(&state, &token).await?;
    os::list_printers().map_err(AppError::Internal)
}

/// Return the system-default printer name (or None if none is set).
#[tauri::command]
pub async fn get_default_printer(
    state: State<'_, AppState>,
    token: String,
) -> AppResult<Option<String>> {
    guard(&state, &token).await?;
    os::get_default_printer().map_err(AppError::Internal)
}

/// Build an ESC/POS byte stream from transaction data and send it directly
/// to the named Windows printer — no dialog, no WebView involvement.
#[tauri::command]
pub async fn print_receipt_escpos(
    state:   State<'_, AppState>,
    token:   String,
    payload: PrintReceiptEscposDto,
) -> AppResult<()> {
    guard(&state, &token).await?;
    let pool = state.pool().await?;

    // ── 1. Fetch transaction ──────────────────────────────────────────────────
    let tx = sqlx::query!(
        r#"SELECT t.id, t.reference_no, t.store_id,
                  t.subtotal, t.discount_amount, t.tax_amount, t.total_amount,
                  t.amount_tendered, t.change_amount, t.payment_method,
                  t.notes, t.created_at,
                  s.store_name,
                  s.address  AS store_address,
                  s.phone    AS store_phone,
                  CONCAT(u.first_name, ' ', u.last_name) AS cashier_name,
                  CONCAT(c.first_name, ' ', c.last_name) AS customer_name
           FROM   transactions t
           JOIN   stores       s ON s.id = t.store_id
           LEFT JOIN users     u ON u.id = t.cashier_id
           LEFT JOIN customers c ON c.id = t.customer_id
           WHERE  t.id = $1"#,
        payload.transaction_id
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Transaction {} not found", payload.transaction_id)))?;

    // ── 2. Fetch line items ───────────────────────────────────────────────────
    let items = sqlx::query!(
        "SELECT item_name, sku, quantity, unit_price, discount, line_total \
         FROM transaction_items WHERE tx_id = $1 ORDER BY id",
        payload.transaction_id
    )
    .fetch_all(&pool)
    .await?;

    // ── 3. Load receipt settings (best-effort) ────────────────────────────────
    let cfg: Option<crate::models::receipt::ReceiptSettings> = sqlx::query_as!(
        crate::models::receipt::ReceiptSettings,
        r#"SELECT id, store_id,
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
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();

    let paper_width = cfg.as_ref().map(|s| s.paper_width_mm).unwrap_or(80);
    let char_width  = if paper_width <= 58 { 32usize } else { 42usize };
    let copies      = cfg.as_ref().map(|s| s.receipt_copies).unwrap_or(1).max(1);

    // Use business name override from receipt settings, fall back to store name
    let store_name = cfg.as_ref()
        .and_then(|s| s.business_name.clone())
        .unwrap_or_else(|| tx.store_name.clone());

    // ── 4. Build ESC/POS bytes ────────────────────────────────────────────────
    let data = escpos::ReceiptData {
        store_name,
        address: cfg.as_ref()
            .and_then(|s| s.business_address.clone())
            .or_else(|| tx.store_address.clone())
            .unwrap_or_default(),
        phone: cfg.as_ref()
            .and_then(|s| s.business_phone.clone())
            .or_else(|| tx.store_phone.clone())
            .unwrap_or_default(),
        tagline:     cfg.as_ref().and_then(|s| s.tagline.clone()).unwrap_or_default(),
        header_text: cfg.as_ref().and_then(|s| s.header_text.clone()).unwrap_or_default(),
        footer_text: cfg.as_ref()
            .and_then(|s| s.footer_text.clone())
            .unwrap_or_else(|| "Thank you for your purchase!".to_string()),
        reference_no: tx.reference_no.clone(),
        date_str:     tx.created_at.format("%d %b %Y  %H:%M").to_string(),
        cashier_name: if cfg.as_ref().map(|s| s.show_cashier_name).unwrap_or(true) {
            tx.cashier_name.clone()
        } else {
            None
        },
        customer_name: if cfg.as_ref().map(|s| s.show_customer_name).unwrap_or(true) {
            tx.customer_name.clone()
        } else {
            None
        },
        items: items.iter().map(|i| escpos::ReceiptItem {
            name:       i.item_name.clone(),
            quantity:   i.quantity,
            unit_price: i.unit_price,
            line_total: i.line_total,
        }).collect(),
        subtotal:        tx.subtotal,
        discount:        tx.discount_amount,
        tax:             tx.tax_amount,
        total:           tx.total_amount,
        payment_method:  tx.payment_method.clone(),
        amount_tendered: tx.amount_tendered,
        change_amount:   tx.change_amount,
        char_width,
        show_tax: cfg.as_ref().map(|s| s.show_tax_breakdown).unwrap_or(true),
        notes:    tx.notes.clone(),
    };

    let bytes = escpos::build_receipt(&data);
    let job   = format!("Receipt #{}", tx.reference_no);

    for _ in 0..copies {
        os::send_raw(&payload.printer_name, &job, &bytes)
            .map_err(AppError::Internal)?;
    }

    Ok(())
}

/// Build ESC/POS label bytes for a set of items and send them silently
/// to the named printer. Copies are printed back-to-back with a cut between.
#[tauri::command]
pub async fn print_labels_escpos(
    state:   State<'_, AppState>,
    token:   String,
    payload: PrintLabelsEscposDto,
) -> AppResult<()> {
    guard(&state, &token).await?;
    let pool = state.pool().await?;

    // ── Resolve item UUIDs from ids or scope ──────────────────────────────────
    let uuids: Vec<uuid::Uuid> = if let Some(ids) = &payload.item_ids {
        ids.iter()
            .filter_map(|s| uuid::Uuid::parse_str(s).ok())
            .collect()
    } else {
        sqlx::query_scalar!(
            r#"SELECT i.id::text FROM items i
               LEFT JOIN item_settings ist ON ist.item_id = i.id
               WHERE i.store_id      = $1
                 AND ($2::int IS NULL OR i.category_id   = $2)
                 AND ($3::int IS NULL OR i.department_id = $3)
                 AND (ist.is_active IS NULL OR ist.is_active = TRUE)
                 AND ist.archived_at IS NULL"#,
            payload.store_id,
            payload.category_id,
            payload.department_id,
        )
        .fetch_all(&pool)
        .await?
        .into_iter()
        .filter_map(|s: Option<String>| {
            s.and_then(|v| uuid::Uuid::parse_str(&v).ok())
        })
        .collect()
    };

    if uuids.is_empty() {
        return Err(AppError::Validation("No items found to print.".into()));
    }

    // ── Fetch label data ──────────────────────────────────────────────────────
    let rows = sqlx::query!(
        r#"SELECT i.id::text AS "item_id?",
                  i.item_name, i.sku, i.barcode,
                  i.selling_price,
                  s.store_name
           FROM   items  i
           JOIN   stores s ON s.id = i.store_id
           WHERE  i.id = ANY($1) AND i.store_id = $2
           ORDER  BY i.item_name"#,
        &uuids as _,
        payload.store_id,
    )
    .fetch_all(&pool)
    .await?;

    if rows.is_empty() {
        return Err(AppError::NotFound("No label data found for the given items.".into()));
    }

    let copies     = payload.copies.unwrap_or(1).max(1) as usize;
    let show_name  = payload.show_name.unwrap_or(true);
    let show_price = payload.show_price.unwrap_or(true);
    let show_sku   = payload.show_sku.unwrap_or(true);

    // ── Build one job containing all labels (cut between each) ────────────────
    let mut all_bytes: Vec<u8> = Vec::with_capacity(rows.len() * copies * 512);

    for _ in 0..copies {
        for row in &rows {
            let label_bytes = escpos::build_label(&escpos::LabelData {
                item_name:     row.item_name.clone(),
                barcode:       row.barcode.clone(),
                sku:           row.sku.clone(),
                selling_price: row.selling_price,
                store_name:    row.store_name.clone(),
                show_name,
                show_price,
                show_sku,
            });
            all_bytes.extend(label_bytes);
        }
    }

    os::send_raw(&payload.printer_name, "Quantum POS Labels", &all_bytes)
        .map_err(AppError::Internal)?;

    Ok(())
}

/// Send a short test page to verify a printer is configured correctly.
#[tauri::command]
pub async fn print_test_page(
    state:        State<'_, AppState>,
    token:        String,
    printer_name: String,
) -> AppResult<()> {
    guard(&state, &token).await?;
    let bytes = escpos::build_test_page();
    os::send_raw(&printer_name, "Quantum POS Test Print", &bytes)
        .map_err(AppError::Internal)
}

// ── ESC/POS byte-stream builder ───────────────────────────────────────────────
//
// Builds a complete, self-contained ESC/POS byte sequence for receipts or
// labels. No external crates — just raw bytes per the ESC/POS specification.
//
// Character-set note:
//   Most thermal printers default to code page 437 (DOS Latin US). The naira
//   sign ₦ (U+20A6) is not in that code page, so we fall back to "N" which is
//   universally understood in Nigeria. All other text is ASCII-safe.
// ─────────────────────────────────────────────────────────────────────────────
mod escpos {
    use rust_decimal::Decimal;
    use rust_decimal::prelude::ToPrimitive;

    // ── Control byte sequences ────────────────────────────────────────────────
    const INIT:         &[u8] = &[0x1B, 0x40];        // ESC @   — initialise
    const ALIGN_LEFT:   &[u8] = &[0x1B, 0x61, 0x00];  // ESC a 0 — left align
    const ALIGN_CENTER: &[u8] = &[0x1B, 0x61, 0x01];  // ESC a 1 — center
    const BOLD_ON:      &[u8] = &[0x1B, 0x45, 0x01];  // ESC E 1 — bold on
    const BOLD_OFF:     &[u8] = &[0x1B, 0x45, 0x00];  // ESC E 0 — bold off
    const DBL_WH:       &[u8] = &[0x1D, 0x21, 0x11];  // GS !    — 2× width + height
    const DBL_H:        &[u8] = &[0x1D, 0x21, 0x01];  // GS !    — 2× height only
    const NORMAL:       &[u8] = &[0x1D, 0x21, 0x00];  // GS !    — normal size
    const FULL_CUT:     &[u8] = &[0x1D, 0x56, 0x00];  // GS V 0  — full paper cut
    const PARTIAL_CUT:  &[u8] = &[0x1D, 0x56, 0x01];  // GS V 1  — partial cut
    const BC_HRI_BELOW: &[u8] = &[0x1D, 0x48, 0x02];  // GS H 2  — HRI chars below bc
    const BC_HRI_FONT:  &[u8] = &[0x1D, 0x66, 0x00];  // GS f 0  — HRI font A (small)
    const BC_HEIGHT_60: &[u8] = &[0x1D, 0x68, 60];    // GS h 60 — barcode 60 dots high

    // ── Input data structures ─────────────────────────────────────────────────

    pub struct ReceiptItem {
        pub name:       String,
        pub quantity:   Decimal,
        pub unit_price: Decimal,
        pub line_total: Decimal,
    }

    pub struct ReceiptData {
        pub store_name:      String,
        pub address:         String,
        pub phone:           String,
        pub tagline:         String,
        pub header_text:     String,
        pub footer_text:     String,
        pub reference_no:    String,
        pub date_str:        String,
        pub cashier_name:    Option<String>,
        pub customer_name:   Option<String>,
        pub items:           Vec<ReceiptItem>,
        pub subtotal:        Decimal,
        pub discount:        Decimal,
        pub tax:             Decimal,
        pub total:           Decimal,
        pub payment_method:  String,
        pub amount_tendered: Option<Decimal>,
        pub change_amount:   Option<Decimal>,
        pub char_width:      usize,
        pub show_tax:        bool,
        pub notes:           Option<String>,
    }

    pub struct LabelData {
        pub item_name:     String,
        pub barcode:       Option<String>,
        pub sku:           String,
        pub selling_price: Decimal,
        pub store_name:    String,
        pub show_name:     bool,
        pub show_price:    bool,
        pub show_sku:      bool,
    }

    // ── Formatting helpers ────────────────────────────────────────────────────

    /// Format a decimal amount as currency. Uses "N" for the naira sign
    /// because code-page 437 doesn't include ₦.
    fn money(amount: Decimal) -> String {
        format!("N{:.2}", amount.to_f64().unwrap_or(0.0))
    }

    /// Build a line padded to `width` chars: "Left text         Right".
    fn padded(left: &str, right: &str, width: usize) -> String {
        let r     = right.to_string();
        let l_max = width.saturating_sub(r.len() + 1);
        let l     = if left.len() > l_max { &left[..l_max] } else { left };
        let pads  = width.saturating_sub(l.len() + r.len());
        format!("{}{}{}", l, " ".repeat(pads), r)
    }

    /// Dashed separator line.
    fn dashes(n: usize) -> String { "-".repeat(n) }

    /// Append bytes to buffer.
    fn push(buf: &mut Vec<u8>, b: &[u8]) {
        buf.extend_from_slice(b);
    }

    /// Append a string followed by a line-feed.
    fn line(buf: &mut Vec<u8>, s: &str) {
        buf.extend_from_slice(s.as_bytes());
        buf.push(b'\n');
    }

    // ── Receipt builder ───────────────────────────────────────────────────────

    pub fn build_receipt(d: &ReceiptData) -> Vec<u8> {
        let mut buf: Vec<u8> = Vec::with_capacity(2048);
        let w = d.char_width;

        push(&mut buf, INIT);

        // ── Store header ──────────────────────────────────────────────────────
        push(&mut buf, ALIGN_CENTER);
        push(&mut buf, BOLD_ON);
        push(&mut buf, DBL_WH);
        line(&mut buf, &d.store_name.to_uppercase());
        push(&mut buf, NORMAL);
        push(&mut buf, BOLD_OFF);

        if !d.address.is_empty()     { line(&mut buf, &d.address); }
        if !d.phone.is_empty()       { line(&mut buf, &format!("Tel: {}", d.phone)); }
        if !d.tagline.is_empty()     { line(&mut buf, &d.tagline); }
        if !d.header_text.is_empty() { buf.push(b'\n'); line(&mut buf, &d.header_text); }

        // ── Transaction info ──────────────────────────────────────────────────
        push(&mut buf, ALIGN_LEFT);
        line(&mut buf, &dashes(w));
        line(&mut buf, &padded("Receipt #:", &d.reference_no, w));
        line(&mut buf, &padded("Date:", &d.date_str, w));
        if let Some(ref n) = d.cashier_name  { line(&mut buf, &padded("Cashier:",  n, w)); }
        if let Some(ref n) = d.customer_name { line(&mut buf, &padded("Customer:", n, w)); }
        line(&mut buf, &dashes(w));

        // ── Items ─────────────────────────────────────────────────────────────
        push(&mut buf, BOLD_ON);
        line(&mut buf, &padded("Item", "Amount", w));
        push(&mut buf, BOLD_OFF);

        for item in &d.items {
            line(&mut buf, &padded(&item.name, &money(item.line_total), w));
            line(&mut buf, &format!("  {}x {}", item.quantity, money(item.unit_price)));
        }

        // ── Totals ────────────────────────────────────────────────────────────
        line(&mut buf, &dashes(w));
        line(&mut buf, &padded("Subtotal:", &money(d.subtotal), w));
        if d.discount > Decimal::ZERO {
            let disc_str = format!("-{}", money(d.discount));
            line(&mut buf, &padded("Discount:", &disc_str, w));
        }
        if d.show_tax {
            line(&mut buf, &padded("Tax:", &money(d.tax), w));
        }

        push(&mut buf, BOLD_ON);
        line(&mut buf, &dashes(w));
        line(&mut buf, &padded("TOTAL:", &money(d.total), w));
        line(&mut buf, &padded("Payment:", &d.payment_method.to_uppercase(), w));
        push(&mut buf, BOLD_OFF);

        if let Some(t) = d.amount_tendered { line(&mut buf, &padded("Tendered:", &money(t), w)); }
        if let Some(c) = d.change_amount   { line(&mut buf, &padded("Change:",   &money(c), w)); }

        // ── Footer ────────────────────────────────────────────────────────────
        line(&mut buf, &dashes(w));
        push(&mut buf, ALIGN_CENTER);
        line(&mut buf, &d.footer_text);
        if let Some(ref notes) = d.notes {
            if !notes.is_empty() { line(&mut buf, notes); }
        }

        // Feed paper + full cut
        buf.extend_from_slice(&[b'\n', b'\n', b'\n']);
        push(&mut buf, FULL_CUT);

        buf
    }

    // ── Label builder ─────────────────────────────────────────────────────────

    pub fn build_label(d: &LabelData) -> Vec<u8> {
        let mut buf: Vec<u8> = Vec::with_capacity(512);

        push(&mut buf, INIT);
        push(&mut buf, ALIGN_CENTER);

        // Small store name at top
        line(&mut buf, &d.store_name);

        // Item name — bold, double-height
        if d.show_name {
            push(&mut buf, BOLD_ON);
            push(&mut buf, DBL_H);
            // Truncate long names so they fit on the label width
            let name = if d.item_name.len() > 24 {
                format!("{}...", &d.item_name[..21])
            } else {
                d.item_name.clone()
            };
            line(&mut buf, &name);
            push(&mut buf, NORMAL);
            push(&mut buf, BOLD_OFF);
        }

        // Barcode — prefer barcode field, fall back to SKU
        let bc_src = d.barcode.as_deref().unwrap_or(&d.sku);
        let bc_clean: String = bc_src
            .chars()
            .filter(|c| c.is_ascii_graphic() || *c == ' ')
            .take(80)
            .collect();

        if !bc_clean.is_empty() {
            push(&mut buf, BC_HEIGHT_60);
            push(&mut buf, BC_HRI_BELOW);
            push(&mut buf, BC_HRI_FONT);
            // GS k m n d1..dn  — m=73 selects CODE128, n is the byte count
            buf.extend_from_slice(&[0x1D, 0x6B, 73]);
            buf.push(bc_clean.len() as u8);
            buf.extend_from_slice(bc_clean.as_bytes());
            buf.push(b'\n');
        }

        // SKU text line
        if d.show_sku && !d.sku.is_empty() {
            line(&mut buf, &format!("SKU: {}", d.sku));
        }

        // Price — bold, double size
        if d.show_price {
            push(&mut buf, BOLD_ON);
            push(&mut buf, DBL_WH);
            line(&mut buf, &money(d.selling_price));
            push(&mut buf, NORMAL);
            push(&mut buf, BOLD_OFF);
        }

        buf.extend_from_slice(&[b'\n', b'\n']);
        push(&mut buf, PARTIAL_CUT);

        buf
    }

    // ── Test page builder ─────────────────────────────────────────────────────

    pub fn build_test_page() -> Vec<u8> {
        let mut buf: Vec<u8> = Vec::new();

        push(&mut buf, INIT);
        push(&mut buf, ALIGN_CENTER);
        push(&mut buf, BOLD_ON);
        push(&mut buf, DBL_WH);
        line(&mut buf, "QUANTUM POS");
        push(&mut buf, NORMAL);
        push(&mut buf, BOLD_OFF);
        line(&mut buf, "Printer Test Successful");
        line(&mut buf, "----------------------------------------");
        push(&mut buf, ALIGN_LEFT);
        line(&mut buf, "If you can read this clearly,");
        line(&mut buf, "your ESC/POS printer is working.");
        line(&mut buf, "");
        push(&mut buf, ALIGN_CENTER);
        push(&mut buf, BOLD_ON);
        line(&mut buf, "Powered by Quantum POS");
        push(&mut buf, BOLD_OFF);
        buf.extend_from_slice(&[b'\n', b'\n', b'\n']);
        push(&mut buf, FULL_CUT);

        buf
    }
}

// ── OS-level print spooler dispatch ──────────────────────────────────────────
//
// `os::send_raw(printer_name, job_name, data)` opens the named printer via
// the Windows print spooler, submits the bytes as a RAW job (data type "RAW"
// means the bytes bypass any Windows rendering pipeline and go straight to
// the printer), then closes the job — completely silent, no dialog.
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(windows)]
mod os {
    use super::PrinterInfo;
    use std::ffi::OsStr;
    use std::iter::once;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::null_mut;

    use winapi::{
        shared::minwindef::DWORD,
        um::{
            winspool::{
                ClosePrinter, EndDocPrinter, EndPagePrinter, EnumPrintersW,
                GetDefaultPrinterW, OpenPrinterW, StartDocPrinterW, StartPagePrinter,
                WritePrinter, DOC_INFO_1W, PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL,
                PRINTER_INFO_2W,
            },
            winnt::HANDLE,
        },
    };

    fn to_wide(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(once(0)).collect()
    }

    unsafe fn wide_to_string(ptr: *mut u16) -> String {
        if ptr.is_null() {
            return String::new();
        }
        let len = (0..).take_while(|&i| *ptr.add(i) != 0).count();
        String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len))
    }

    /// Enumerate all local and network-connected printers.
    pub fn list_printers() -> Result<Vec<PrinterInfo>, String> {
        let default = get_default_printer().ok().flatten();

        unsafe {
            let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
            let mut needed:   DWORD = 0;
            let mut returned: DWORD = 0;

            // First call — get required buffer size (returns 0 / sets `needed`)
            EnumPrintersW(flags, null_mut(), 2, null_mut(), 0, &mut needed, &mut returned);

            if needed == 0 {
                return Ok(vec![]);
            }

            let mut buf: Vec<u8> = vec![0u8; needed as usize];

            let ok = EnumPrintersW(
                flags,
                null_mut(),
                2,
                buf.as_mut_ptr(),
                needed,
                &mut needed,
                &mut returned,
            );
            if ok == 0 {
                return Err("EnumPrintersW failed — could not list printers.".into());
            }

            let infos = std::slice::from_raw_parts(
                buf.as_ptr() as *const PRINTER_INFO_2W,
                returned as usize,
            );

            Ok(infos
                .iter()
                .map(|info| {
                    let name       = wide_to_string(info.pPrinterName);
                    let is_default = default.as_deref() == Some(name.as_str());
                    PrinterInfo { name, is_default }
                })
                .collect())
        }
    }

    /// Get the Windows system-default printer name.
    pub fn get_default_printer() -> Result<Option<String>, String> {
        unsafe {
            let mut size: DWORD = 0;
            // First call — determine required buffer size
            GetDefaultPrinterW(null_mut(), &mut size);
            if size == 0 {
                return Ok(None);
            }

            let mut buf: Vec<u16> = vec![0u16; size as usize];
            let ok = GetDefaultPrinterW(buf.as_mut_ptr(), &mut size);
            if ok != 0 {
                // size includes the null terminator; strip it
                let name = String::from_utf16_lossy(&buf[..size.saturating_sub(1) as usize]);
                Ok(Some(name))
            } else {
                Ok(None)
            }
        }
    }

    /// Open `printer_name`, submit `data` as a RAW print job, then close.
    /// This bypasses all Windows rendering — the bytes reach the printer as-is.
    pub fn send_raw(printer_name: &str, job_name: &str, data: &[u8]) -> Result<(), String> {
        unsafe {
            // -- Open printer handle ------------------------------------------
            let mut printer_wide = to_wide(printer_name);
            let mut handle: HANDLE = null_mut();

            let ok = OpenPrinterW(printer_wide.as_mut_ptr(), &mut handle, null_mut());
            if ok == 0 {
                return Err(format!(
                    "Cannot open printer '{}'. Make sure it is installed and online.",
                    printer_name
                ));
            }

            // -- Start document -----------------------------------------------
            let mut job_wide  = to_wide(job_name);
            let mut raw_wide  = to_wide("RAW");

            let doc_info = DOC_INFO_1W {
                pDocName:    job_wide.as_mut_ptr(),
                pOutputFile: null_mut(),
                pDatatype:   raw_wide.as_mut_ptr(),
            };

            let job_id = StartDocPrinterW(handle, 1, &doc_info as *const _ as *mut u8);
            if job_id == 0 {
                ClosePrinter(handle);
                return Err(format!(
                    "Failed to start print job on '{}'. The printer may be busy or offline.",
                    printer_name
                ));
            }

            // -- Start page ---------------------------------------------------
            if StartPagePrinter(handle) == 0 {
                EndDocPrinter(handle);
                ClosePrinter(handle);
                return Err("StartPagePrinter failed.".into());
            }

            // -- Write bytes --------------------------------------------------
            let mut written: DWORD = 0;
            let ok = WritePrinter(
                handle,
                data.as_ptr() as *mut _,
                data.len() as DWORD,
                &mut written,
            );

            // -- Always clean up, even on write failure -----------------------
            EndPagePrinter(handle);
            EndDocPrinter(handle);
            ClosePrinter(handle);

            if ok == 0 {
                return Err(format!(
                    "WritePrinter failed on '{}'. Check the printer connection.",
                    printer_name
                ));
            }

            if written != data.len() as DWORD {
                return Err(format!(
                    "Incomplete print data: sent {}/{} bytes to '{}'.",
                    written,
                    data.len(),
                    printer_name
                ));
            }

            Ok(())
        }
    }
}

// ── Non-Windows stub (for cross-platform compilation) ─────────────────────────
#[cfg(not(windows))]
mod os {
    use super::PrinterInfo;

    pub fn list_printers() -> Result<Vec<PrinterInfo>, String> {
        Ok(vec![])
    }

    pub fn get_default_printer() -> Result<Option<String>, String> {
        Ok(None)
    }

    pub fn send_raw(_printer: &str, _job: &str, _data: &[u8]) -> Result<(), String> {
        Err("Native ESC/POS printing is only available on Windows.".into())
    }
}
