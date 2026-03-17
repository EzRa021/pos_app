// ============================================================================
// TRANSACTION COMMANDS
// ============================================================================
// Nigeria VAT (7.5%, inclusive by default).
// Backend is the single source of truth for prices — frontend unit_price is
// treated as a hint only and a warning is logged on mismatch.
// ============================================================================

use tauri::State;
use rust_decimal::Decimal;
use chrono::Utc;
use uuid::Uuid;
use crate::{
    error::{AppError, AppResult},
    models::transaction::{
        Transaction, TransactionItem, TransactionDetail, TransactionFilters,
        CreateTransactionDto, HeldTransaction, HoldTransactionDto,
        VoidTransactionDto, PartialRefundDto, FullRefundDto,
        RefundResult, FetchedItem,
    },
    models::payment::Payment,
    models::notification::CreateNotificationDto,
    models::pagination::PagedResult,
    state::AppState,
};
use super::auth::{guard, guard_permission};

// ── VAT helpers (inclusive pricing — Nigeria standard) ────────────────────────

fn vat_from_inclusive(price: Decimal, rate: Decimal) -> Decimal {
    if rate == Decimal::ZERO { return Decimal::ZERO; }
    let hundred = Decimal::from(100u32);
    (price * rate / (hundred + rate)).round_dp(2)
}

fn net_from_inclusive(price: Decimal, vat: Decimal) -> Decimal {
    (price - vat).round_dp(2)
}

fn to_dec(v: f64) -> Decimal {
    Decimal::try_from(v).unwrap_or_default()
}

// ── Shared fetch helpers ──────────────────────────────────────────────────────

async fn fetch_transaction(pool: &sqlx::PgPool, id: i32) -> AppResult<Transaction> {
    sqlx::query_as!(
        Transaction,
        r#"SELECT t.id, t.reference_no, t.store_id, t.cashier_id,
                  CONCAT(u.first_name, ' ', u.last_name) AS cashier_name,
                  t.customer_id,
                  CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
                  t.subtotal, t.discount_amount, t.tax_amount,
                  t.total_amount, t.amount_tendered, t.change_amount,
                  t.payment_method, t.payment_status, t.status,
                  t.notes, t.created_at
           FROM   transactions t
           LEFT JOIN users     u ON u.id = t.cashier_id
           LEFT JOIN customers c ON c.id = t.customer_id
           WHERE  t.id = $1"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Transaction {id} not found")))
}

async fn fetch_transaction_items(pool: &sqlx::PgPool, tx_id: i32) -> AppResult<Vec<TransactionItem>> {
    sqlx::query_as!(
        TransactionItem,
        r#"SELECT ti.id, ti.tx_id, ti.item_id, ti.item_name, ti.sku,
                  ti.quantity, ti.unit_price, ti.discount,
                  ti.tax_amount, ti.line_total,
                  ti.measurement_type, ti.unit_type
           FROM   transaction_items ti
           WHERE  ti.tx_id = $1
           ORDER  BY ti.id"#,
        tx_id
    )
    .fetch_all(pool)
    .await
    .map_err(AppError::from)
}

async fn fetch_transaction_payments(pool: &sqlx::PgPool, tx_id: i32) -> AppResult<Vec<Payment>> {
    sqlx::query_as!(
        Payment,
        r#"SELECT id, transaction_id, reference_no, payment_method, amount,
                  currency, status, processed_by, notes, created_at
           FROM   payments
           WHERE  transaction_id = $1
           ORDER  BY id"#,
        tx_id
    )
    .fetch_all(pool)
    .await
    .map_err(AppError::from)
}

// ── HTTP-compatible inner functions ───────────────────────────────────────────

pub(crate) async fn create_transaction_inner(state: &AppState, token: String, payload: CreateTransactionDto) -> AppResult<TransactionDetail> {
    let s: tauri::State<'_, AppState> = unsafe { std::mem::transmute(state) };
    create_transaction(s, token, payload).await
}
pub(crate) async fn get_transactions_inner(state: &AppState, token: String, filters: TransactionFilters) -> AppResult<PagedResult<Transaction>> {
    let s: tauri::State<'_, AppState> = unsafe { std::mem::transmute(state) };
    get_transactions(s, token, filters).await
}
pub(crate) async fn get_transaction_inner(state: &AppState, token: String, id: i32) -> AppResult<TransactionDetail> {
    let s: tauri::State<'_, AppState> = unsafe { std::mem::transmute(state) };
    get_transaction(s, token, id).await
}
pub(crate) async fn void_transaction_inner(state: &AppState, token: String, id: i32, payload: VoidTransactionDto) -> AppResult<Transaction> {
    let s: tauri::State<'_, AppState> = unsafe { std::mem::transmute(state) };
    void_transaction(s, token, id, payload).await
}
pub(crate) async fn partial_refund_inner(state: &AppState, token: String, id: i32, payload: PartialRefundDto) -> AppResult<RefundResult> {
    let s: tauri::State<'_, AppState> = unsafe { std::mem::transmute(state) };
    partial_refund(s, token, id, payload).await
}
pub(crate) async fn full_refund_inner(state: &AppState, token: String, id: i32, payload: FullRefundDto) -> AppResult<RefundResult> {
    let s: tauri::State<'_, AppState> = unsafe { std::mem::transmute(state) };
    full_refund(s, token, id, payload).await
}
pub(crate) async fn hold_transaction_inner(state: &AppState, token: String, payload: HoldTransactionDto) -> AppResult<HeldTransaction> {
    let s: tauri::State<'_, AppState> = unsafe { std::mem::transmute(state) };
    hold_transaction(s, token, payload).await
}
pub(crate) async fn get_held_transactions_inner(state: &AppState, token: String, store_id: i32) -> AppResult<Vec<HeldTransaction>> {
    let s: tauri::State<'_, AppState> = unsafe { std::mem::transmute(state) };
    get_held_transactions(s, token, store_id).await
}
pub(crate) async fn delete_held_transaction_inner(state: &AppState, token: String, id: i32) -> AppResult<()> {
    let s: tauri::State<'_, AppState> = unsafe { std::mem::transmute(state) };
    delete_held_transaction(s, token, id).await
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn create_transaction(
    state:   State<'_, AppState>,
    token:   String,
    payload: CreateTransactionDto,
) -> AppResult<TransactionDetail> {
    let claims = guard_permission(&state, &token, "pos.sale").await?;
    let pool   = state.pool().await?;

    // ── STEP 1: Basic validation ───────────────────────────────────────────────
    if payload.items.is_empty() {
        return Err(AppError::Validation("Transaction must have at least one item".into()));
    }
    let offline_sale = payload.offline_sale.unwrap_or(false);

    // ── STEP 2: client_uuid deduplication ─────────────────────────────────────
    if let Some(ref uuid) = payload.client_uuid {
        let exists: Option<i32> = sqlx::query_scalar!(
            "SELECT id FROM transactions WHERE client_uuid = $1 LIMIT 1", uuid
        )
        .fetch_optional(&pool)
        .await?;
        if exists.is_some() {
            return Err(AppError::Validation("Duplicate submission detected (client_uuid already exists)".into()));
        }
    }

    // ── STEP 3: Validate customer ─────────────────────────────────────────────
    if let Some(cust_id) = payload.customer_id {
        let active = sqlx::query_scalar!(
            "SELECT TRUE FROM customers WHERE id = $1 AND store_id = $2 AND is_active = TRUE",
            cust_id, payload.store_id,
        )
        .fetch_optional(&pool)
        .await?
        .flatten();
        if active.is_none() {
            return Err(AppError::Validation("Customer not found or inactive".into()));
        }
    }
    if payload.payment_method == "credit" && payload.customer_id.is_none() {
        return Err(AppError::Validation("Customer is required for credit sales".into()));
    }

    // ── STEP 4: Fetch all items ────────────────────────────────────────────────
    let item_ids: Vec<Uuid> = payload.items.iter().map(|i| i.item_id).collect();
    let rows = sqlx::query!(
        r#"SELECT
               i.id                     AS "id: Uuid",
               i.item_name,
               i.sku,
               i.cost_price             AS "cost_price: Decimal",
               i.selling_price          AS "selling_price: Decimal",
               i.discount_price         AS "discount_price: Decimal",
               ist.is_active            AS "is_active!: bool",
               ist.sellable             AS "sellable!: bool",
               ist.available_for_pos    AS "available_for_pos!: bool",
               ist.track_stock          AS "track_stock!: bool",
               ist.allow_negative_stock AS "allow_negative_stock!: bool",
               ist.taxable              AS "taxable!: bool",
               ist.measurement_type     AS "measurement_type!: String",
               ist.unit_type            AS "unit_type: String",
               ist.requires_weight      AS "requires_weight: Option<bool>",
               istock.available_quantity AS "available_quantity: Decimal",
               COALESCE(tc.rate, 0)     AS "tax_rate!: Decimal"
           FROM items i
           JOIN item_settings  ist    ON ist.item_id   = i.id
           JOIN item_stock     istock ON istock.item_id = i.id AND istock.store_id = $2
           LEFT JOIN tax_categories tc ON tc.id = i.tax_category_id
           WHERE i.id = ANY($1) AND i.store_id = $2"#,
        &item_ids as &[Uuid],
        payload.store_id,
    )
    .fetch_all(&pool)
    .await?;

    if rows.len() != item_ids.len() {
        return Err(AppError::Validation("One or more items not found or do not belong to this store".into()));
    }

    let items_map: std::collections::HashMap<Uuid, FetchedItem> = rows
        .into_iter()
        .map(|r| {
            let fi = FetchedItem {
                id:                   r.id,
                item_name:            r.item_name,
                sku:                  r.sku,
                selling_price:        r.selling_price,
                discount_price:       r.discount_price,
                is_active:            r.is_active,
                sellable:             r.sellable,
                available_for_pos:    r.available_for_pos,
                track_stock:          r.track_stock,
                allow_negative_stock: r.allow_negative_stock,
                taxable:              r.taxable,
                tax_rate:             r.tax_rate,
                available_quantity:   r.available_quantity,
                measurement_type:     r.measurement_type,
                unit_type:            r.unit_type,
                requires_weight:      r.requires_weight,
            };
            (fi.id, fi)
        })
        .collect();

    // ── STEP 5: Validate items and build line items ────────────────────────────
    struct LineItem {
        item_id:          Uuid,
        item_name:        String,
        sku:              String,
        quantity:         Decimal,
        unit_price:       Decimal,
        cost_price:       Decimal,
        net_amount:       Decimal,
        vat_amount:       Decimal,
        line_total:       Decimal,
        track_stock:      bool,
        measurement_type: String,
        unit_type:        Option<String>,
    }

    let mut line_items: Vec<LineItem> = Vec::new();

    // Load store settings (non-fatal — if missing, use permissive defaults)
    let store_settings = super::store_settings::fetch_settings(&pool, payload.store_id).await.ok();

    for dto_item in &payload.items {
        let item = items_map.get(&dto_item.item_id)
            .ok_or_else(|| AppError::NotFound(format!("Item {} not found", dto_item.item_id)))?;

        if !item.is_active    { return Err(AppError::Validation(format!("Item '{}' is not active", item.item_name))); }
        if !item.sellable     { return Err(AppError::Validation(format!("Item '{}' is not sellable", item.item_name))); }
        if !item.available_for_pos { return Err(AppError::Validation(format!("Item '{}' is not available for POS", item.item_name))); }

        let qty = crate::utils::qty::validate_qty(
            to_dec(dto_item.quantity),
            &item.measurement_type,
            &item.item_name,
        )?;
        if item.track_stock && !item.allow_negative_stock && item.available_quantity < qty {
            return Err(AppError::Validation(format!(
                "Insufficient stock for '{}'. Available: {}, Requested: {}",
                item.item_name, item.available_quantity, qty
            )));
        }

        let unit_price = item.discount_price.unwrap_or(item.selling_price);
        // Retrieve cost_price from item — stored in rows above as r.cost_price
        let cost_price_for_item: Decimal = sqlx::query_scalar!(
            "SELECT cost_price FROM items WHERE id = $1", item.id
        )
        .fetch_optional(&pool)
        .await?
        .unwrap_or_default();

        // Fix 6a: warn_sell_below_cost check
        if let Some(ref s) = store_settings {
            if s.warn_sell_below_cost && unit_price < cost_price_for_item {
                eprintln!("[WARN] Selling '{}' below cost (sell: {}, cost: {})", item.item_name, unit_price, cost_price_for_item);
                if !s.allow_sell_below_cost {
                    return Err(AppError::Validation(format!(
                        "Cannot sell '{}' below cost price (₦{}). Selling price: ₦{}",
                        item.item_name, cost_price_for_item.round_dp(2), unit_price.round_dp(2)
                    )));
                }
            }
        }

        if let Some(frontend_price) = dto_item.unit_price {
            let fp = to_dec(frontend_price);
            if (fp - unit_price).abs() > Decimal::new(1, 2) {
                eprintln!("[WARN] Price mismatch for '{}'. DB: {}, Frontend: {}", item.item_name, unit_price, fp);
            }
        }

        let tax_rate   = if item.taxable { item.tax_rate } else { Decimal::ZERO };
        let gross      = unit_price * qty;
        let vat_amount = vat_from_inclusive(gross, tax_rate);
        let net_amount = net_from_inclusive(gross, vat_amount);

        line_items.push(LineItem {
            item_id:          item.id,
            item_name:        item.item_name.clone(),
            sku:              item.sku.clone(),
            quantity:         qty,
            unit_price,
            cost_price:       cost_price_for_item,
            net_amount,
            vat_amount,
            line_total:       gross,
            track_stock:      item.track_stock,
            measurement_type: item.measurement_type.clone(),
            unit_type:        item.unit_type.clone(),
        });
    }

    // ── STEP 6: Calculate totals ───────────────────────────────────────────────
    let subtotal        = line_items.iter().map(|l| l.net_amount).sum::<Decimal>();
    let total_tax       = line_items.iter().map(|l| l.vat_amount).sum::<Decimal>();
    let discount_amount = to_dec(payload.discount_amount.unwrap_or(0.0));
    let total_amount    = subtotal + total_tax - discount_amount;
    let amount_tend     = payload.amount_tendered.map(to_dec);
    let change_amount   = amount_tend.map(|t| if t >= total_amount { t - total_amount } else { Decimal::ZERO });

    // ── Fix 6b: store_settings enforcement — discount cap & customer requirement ──
    if let Some(ref s) = store_settings {
        // Discount percent limit
        if discount_amount > Decimal::ZERO && (subtotal + total_tax) > Decimal::ZERO {
            let pct = (discount_amount / (subtotal + total_tax) * Decimal::from(100)).round_dp(2);
            if pct > s.max_discount_percent {
                return Err(AppError::Validation(format!(
                    "Discount of {pct:.2}% exceeds the maximum allowed {:.2}%",
                    s.max_discount_percent
                )));
            }
        }
        // Customer required above threshold
        if let Some(threshold) = s.require_customer_above_amount {
            if total_amount > threshold && payload.customer_id.is_none() {
                return Err(AppError::Validation(format!(
                    "A customer must be selected for sales above ₦{:.2}",
                    threshold.round_dp(2)
                )));
            }
        }
    }

    // ── STEP 7: Credit limit check ────────────────────────────────────────────
    if payload.payment_method == "credit" {
        if let Some(cust_id) = payload.customer_id {
            let row = sqlx::query!(
                r#"SELECT credit_limit       AS "credit_limit: Decimal",
                          outstanding_balance AS "outstanding_balance: Decimal",
                          credit_enabled      AS "credit_enabled!: bool"
                   FROM customers WHERE id = $1 AND store_id = $2"#,
                cust_id, payload.store_id,
            )
            .fetch_optional(&pool)
            .await?
            .ok_or_else(|| AppError::Validation("Customer not found".into()))?;

            if !row.credit_enabled {
                return Err(AppError::Validation("Credit sales are not enabled for this customer".into()));
            }
            // Only enforce the credit cap when a limit > 0 is explicitly set.
            // credit_limit = 0 means "no limit configured" (unlimited credit).
            if row.credit_limit > Decimal::ZERO {
                let available = row.credit_limit - row.outstanding_balance;
                if total_amount > available {
                    return Err(AppError::Validation(format!(
                        "Insufficient credit. Available: ₦{}, Required: ₦{}",
                        available.round_dp(2), total_amount.round_dp(2)
                    )));
                }
            }
        }
    }

    // ── Fix Bug 2: wallet balance pre-check ───────────────────────────────────
    if payload.payment_method == "wallet" {
        let cust_id = payload.customer_id.ok_or_else(||
            AppError::Validation("Customer is required for wallet payments".into())
        )?;
        let balance: Option<Decimal> = sqlx::query_scalar!(
            "SELECT wallet_balance FROM customers WHERE id = $1 AND store_id = $2",
            cust_id, payload.store_id,
        )
        .fetch_optional(&pool)
        .await?;
        if balance.unwrap_or_default() < total_amount {
            return Err(AppError::Validation(format!(
                "Insufficient wallet balance. Available: ₦{:.2}, Required: ₦{:.2}",
                balance.unwrap_or_default().round_dp(2), total_amount.round_dp(2)
            )));
        }
    }

    // ── STEP 8: Begin DB transaction ──────────────────────────────────────────
    let mut db_tx = pool.begin().await?;

    // ── STEP 9: Generate reference number ─────────────────────────────────────
    let ref_no: String = sqlx::query_scalar!(
        "SELECT 'TXN-' || LPAD(NEXTVAL('transaction_ref_seq')::text, 6, '0')"
    )
    .fetch_one(&mut *db_tx)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| format!("TXN-{}", Utc::now().timestamp()));

    // ── STEP 10: Insert transaction record ────────────────────────────────────
    let is_credit      = payload.payment_method == "credit";
    let is_wallet      = payload.payment_method == "wallet";
    let payment_status = if is_credit { "pending" } else { "paid" };
    let amount_paid    = if is_credit { Decimal::ZERO } else { total_amount };

    let tx_id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO transactions
               (reference_no, store_id, cashier_id, customer_id,
                subtotal, discount_amount, tax_amount, total_amount,
                amount_tendered, change_amount, payment_method,
                payment_status, status, notes, offline_sale, client_uuid)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'completed',$13,$14,$15)
           RETURNING id"#,
        ref_no, payload.store_id, claims.user_id, payload.customer_id,
        subtotal, discount_amount, total_tax, total_amount,
        amount_tend, change_amount, payload.payment_method,
        payment_status, payload.notes, offline_sale, payload.client_uuid,
    )
    .fetch_one(&mut *db_tx)
    .await?;

    // ── STEP 11: Insert line items, deduct stock, log history ─────────────────
    for line in &line_items {
        sqlx::query!(
            r#"INSERT INTO transaction_items
                   (tx_id, item_id, item_name, sku, quantity,
                    unit_price, discount, tax_amount, net_amount, line_total,
                    measurement_type, unit_type)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)"#,
            tx_id,
            line.item_id,
            line.item_name,
            line.sku,
            line.quantity,
            line.unit_price,
            Decimal::ZERO,
            line.vat_amount,
            line.net_amount,
            line.line_total,
            line.measurement_type,
            line.unit_type,
        )
        .execute(&mut *db_tx)
        .await?;

        if line.track_stock {
            sqlx::query!(
                r#"UPDATE item_stock
                   SET quantity = quantity - $1, available_quantity = available_quantity - $1, updated_at = NOW()
                   WHERE item_id = $2 AND store_id = $3"#,
                line.quantity, line.item_id, payload.store_id,
            )
            .execute(&mut *db_tx)
            .await?;

            let unit_label = line
                .unit_type
                .as_deref()
                .unwrap_or("unit(s)");
            let desc = format!(
                "POS Sale — {} {} of {}",
                line.quantity, unit_label, line.item_name
            );
            sqlx::query!(
                r#"INSERT INTO item_history
                       (item_id, store_id, event_type, event_description,
                        quantity_before, quantity_after, quantity_change,
                        performed_by, reference_type, reference_id, notes)
                   VALUES ($1,$2,'SALE',$3,
                           (SELECT quantity + $4 FROM item_stock WHERE item_id = $1 AND store_id = $2),
                           (SELECT quantity FROM item_stock WHERE item_id = $1 AND store_id = $2),
                           -$4,
                           $5,'sale',$6,$7)"#,
                line.item_id,
                payload.store_id,
                desc,
                line.quantity,
                claims.user_id,
                ref_no,
                "Automatic stock deduction from POS sale",
            )
            .execute(&mut *db_tx)
            .await?;
        }
    }

    // ── STEP 12: Record payment / credit sale / wallet debit ──────────────────
    let is_split = payload.payment_method == "split";
    if is_split {
        // Insert one Payment row per split leg so the breakdown is fully visible
        let legs = payload.split_payments.as_deref().unwrap_or(&[]);
        if legs.is_empty() {
            return Err(AppError::Validation(
                "split_payments must contain at least one leg when payment_method is \"split\"".into()
            ));
        }
        for leg in legs {
            let leg_amt = to_dec(leg.amount);
            sqlx::query!(
                r#"INSERT INTO payments (transaction_id, payment_method, amount, status, processed_by)
                   VALUES ($1, $2, $3, 'completed', $4)"#,
                tx_id, leg.method, leg_amt, claims.user_id,
            )
            .execute(&mut *db_tx)
            .await?;
        }
        // If there is also a wallet leg, debit the customer wallet
        if let Some(wallet_amt_f64) = payload.wallet_amount {
            let wallet_dec = to_dec(wallet_amt_f64);
            if wallet_dec > Decimal::ZERO {
                if let Some(customer_id) = payload.customer_id {
                    let current_balance: Option<Decimal> = sqlx::query_scalar!(
                        "SELECT wallet_balance FROM customers WHERE id = $1 FOR UPDATE", customer_id,
                    )
                    .fetch_optional(&mut *db_tx)
                    .await?;
                    let new_balance = (current_balance.unwrap_or_default() - wallet_dec).max(Decimal::ZERO);
                    sqlx::query!(
                        "UPDATE customers SET wallet_balance = $1, updated_at = NOW() WHERE id = $2",
                        new_balance, customer_id,
                    )
                    .execute(&mut *db_tx)
                    .await?;
                    sqlx::query!(
                        r#"INSERT INTO customer_wallet_transactions
                               (customer_id, store_id, type, amount, balance_after,
                                transaction_id, recorded_by, notes)
                           VALUES ($1,$2,'debit',$3,$4,$5,$6,'POS split wallet payment')"#,
                        customer_id, payload.store_id, wallet_dec, new_balance,
                        tx_id, claims.user_id,
                    )
                    .execute(&mut *db_tx)
                    .await?;
                }
            }
        }
    } else if !is_credit && !is_wallet {
        sqlx::query!(
            r#"INSERT INTO payments (transaction_id, payment_method, amount, status, processed_by)
               VALUES ($1,$2,$3,'completed',$4)"#,
            tx_id, payload.payment_method, amount_paid, claims.user_id,
        )
        .execute(&mut *db_tx)
        .await?;
    } else if is_credit {
        if let Some(customer_id) = payload.customer_id {
            sqlx::query!(
                r#"INSERT INTO credit_sales (transaction_id, store_id, customer_id, total_amount, amount_paid, outstanding, status)
                   VALUES ($1,$2,$3,$4,0,$4,'open')"#,
                tx_id, payload.store_id, customer_id, total_amount,
            )
            .execute(&mut *db_tx)
            .await?;

            sqlx::query!(
                "UPDATE customers SET outstanding_balance = COALESCE(outstanding_balance, 0) + $1 WHERE id = $2",
                total_amount, customer_id,
            )
            .execute(&mut *db_tx)
            .await?;
        }
    } else if is_wallet {
        // Fix Bug 2: Debit wallet within the same DB transaction
        if let Some(customer_id) = payload.customer_id {
            let current_balance: Option<Decimal> = sqlx::query_scalar!(
                "SELECT wallet_balance FROM customers WHERE id = $1 FOR UPDATE", customer_id,
            )
            .fetch_optional(&mut *db_tx)
            .await?;

            let new_balance = (current_balance.unwrap_or_default() - total_amount).max(Decimal::ZERO);
            sqlx::query!(
                "UPDATE customers SET wallet_balance = $1, updated_at = NOW() WHERE id = $2",
                new_balance, customer_id,
            )
            .execute(&mut *db_tx)
            .await?;

            sqlx::query!(
                r#"INSERT INTO customer_wallet_transactions
                       (customer_id, store_id, type, amount, balance_after,
                        transaction_id, recorded_by, notes)
                   VALUES ($1,$2,'debit',$3,$4,$5,$6,'POS wallet payment')"#,
                customer_id, payload.store_id, total_amount, new_balance,
                tx_id, claims.user_id,
            )
            .execute(&mut *db_tx)
            .await?;

            // Record as a payment entry too
            sqlx::query!(
                r#"INSERT INTO payments (transaction_id, payment_method, amount, status, processed_by)
                   VALUES ($1,'wallet',$2,'completed',$3)"#,
                tx_id, total_amount, claims.user_id,
            )
            .execute(&mut *db_tx)
            .await?;
        }
    }

    // ── STEP 13: Delete held transaction if applicable ────────────────────────
    if let Some(held_id) = payload.held_tx_id {
        sqlx::query!("DELETE FROM held_transactions WHERE id = $1", held_id)
            .execute(&mut *db_tx)
            .await?;
    }

    // ── STEP 14: Link sale to active shift ────────────────────────────────────
    let zero = Decimal::ZERO;
    // For split payments, accumulate each method's contribution from the individual legs
    let (cash_inc, card_inc, xfer_inc, mobile_inc) = if is_split {
        let legs = payload.split_payments.as_deref().unwrap_or(&[]);
        let mut cash   = zero;
        let mut card   = zero;
        let mut xfer   = zero;
        let mut mobile = zero;
        for leg in legs {
            let a = to_dec(leg.amount);
            match leg.method.as_str() {
                "cash"         => cash   += a,
                "card"         => card   += a,
                "transfer"     => xfer   += a,
                "mobile_money" => mobile += a,
                _ => {}
            }
        }
        (cash, card, xfer, mobile)
    } else {
        (
            if payload.payment_method == "cash"         { total_amount } else { zero },
            if payload.payment_method == "card"         { total_amount } else { zero },
            if payload.payment_method == "transfer"     { total_amount } else { zero },
            if payload.payment_method == "mobile_money" { total_amount } else { zero },
        )
    };

    sqlx::query!(
        r#"UPDATE shifts SET
            status             = CASE WHEN status = 'open' THEN 'active' ELSE status END,
            transaction_count  = COALESCE(transaction_count,  0) + 1,
            total_sales        = COALESCE(total_sales,        0) + $1,
            total_cash_sales   = COALESCE(total_cash_sales,   0) + $2,
            total_card_sales   = COALESCE(total_card_sales,   0) + $3,
            total_transfers    = COALESCE(total_transfers,    0) + $4,
            total_mobile_sales = COALESCE(total_mobile_sales, 0) + $5,
            updated_at         = NOW()
           WHERE opened_by = $6 AND store_id = $7
             AND status IN ('open', 'active')"#,
        total_amount, cash_inc, card_inc, xfer_inc, mobile_inc,
        claims.user_id, payload.store_id,
    )
    .execute(&mut *db_tx)
    .await
    .ok();

    db_tx.commit().await?;

    // ════════════════════════════════════════════════════════════════════════════
    // POST-COMMIT HOOKS (non-fatal — errors are logged, sale already committed)
    // ════════════════════════════════════════════════════════════════════════════

    // Fix 3: Auto-earn loyalty points when customer is attached and loyalty active
    if let Some(customer_id) = payload.customer_id {
        if !is_credit {
            super::loyalty::earn_points_internal(
                &pool,
                payload.store_id,
                customer_id,
                tx_id,
                total_amount,
                claims.user_id,
            )
            .await
            .ok(); // non-fatal
        }
    }

    // Fix 4 + 5: Check reorder alerts after stock deductions; push notifications for new alerts
    {
        let new_alert_count: u64 = sqlx::query!(
            r#"INSERT INTO reorder_alerts (item_id, store_id, current_qty, min_stock_level)
               SELECT i.id, i.store_id,
                      istock.available_quantity,
                      ist.min_stock_level::numeric
               FROM items i
               JOIN item_settings  ist    ON ist.item_id = i.id
               JOIN item_stock     istock ON istock.item_id = i.id AND istock.store_id = i.store_id
               WHERE i.store_id = $1
                 AND ist.track_stock     = TRUE
                 AND ist.is_active       = TRUE
                 AND ist.min_stock_level IS NOT NULL
                 AND istock.available_quantity <= ist.min_stock_level::numeric
                 AND NOT EXISTS (
                     SELECT 1 FROM reorder_alerts ra
                     WHERE ra.item_id  = i.id
                       AND ra.store_id = i.store_id
                       AND ra.status IN ('pending', 'acknowledged')
                 )
               ON CONFLICT DO NOTHING"#,
            payload.store_id,
        )
        .execute(&pool)
        .await
        .map(|r| r.rows_affected())
        .unwrap_or(0);

        // Fix 5: Push notification if any new low-stock alerts were raised
        if new_alert_count > 0 {
            super::notifications::push_notification(
                &pool,
                CreateNotificationDto {
                    store_id:       payload.store_id,
                    user_id:        None, // broadcast to all managers
                    r#type:         "low_stock".into(),
                    title:          "Low Stock Alert".into(),
                    message:        format!("{new_alert_count} item(s) have fallen below reorder level"),
                    reference_type: Some("store".into()),
                    reference_id:   Some(payload.store_id.to_string()),
                },
            )
            .await
            .ok();
        }
    }

    let transaction = fetch_transaction(&pool, tx_id).await?;
    let items       = fetch_transaction_items(&pool, tx_id).await?;
    let payments    = fetch_transaction_payments(&pool, tx_id).await?;
    Ok(TransactionDetail { transaction, items, payments })
}

// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_transactions(
    state:   State<'_, AppState>,
    token:   String,
    filters: TransactionFilters,
) -> AppResult<PagedResult<Transaction>> {
    guard_permission(&state, &token, "transactions.read").await?;
    let pool   = state.pool().await?;
    let page   = filters.page.unwrap_or(1).max(1);
    let limit  = filters.limit.unwrap_or(25).clamp(1, 200);
    let offset = (page - 1) * limit;

    // Build the search pattern once — wraps the term in % for ILIKE
    let search = filters.search
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| format!("%{s}%"));

    // date_from: inclusive start   (cast to timestamptz, defaults to start of day)
    // date_to:   inclusive end day (add 1 day so the entire last day is included)
    let df = filters.date_from.as_deref();
    let dt = filters.date_to.as_deref();

    // ── COUNT (same WHERE conditions, no ORDER/LIMIT) ──────────────────────────
    // LEFT JOINs are required here too because the search touches joined columns.
    let total: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*)
           FROM   transactions t
           LEFT JOIN users     u ON u.id = t.cashier_id
           LEFT JOIN customers c ON c.id = t.customer_id
           WHERE  ($1::int  IS NULL OR t.store_id    = $1)
             AND  ($2::int  IS NULL OR t.cashier_id  = $2)
             AND  ($3::int  IS NULL OR t.customer_id = $3)
             AND  ($4::text IS NULL OR t.status      = $4)
             AND  ($5::text IS NULL OR t.payment_method = $5)
             AND  ($6::text IS NULL OR t.created_at >= $6::text::date::timestamptz)
             AND  ($7::text IS NULL OR t.created_at <  ($7::text::date + INTERVAL '1 day')::timestamptz)
             AND  ($8::text IS NULL OR (
                    t.reference_no                         ILIKE $8
                 OR CONCAT(c.first_name,' ',c.last_name)   ILIKE $8
                 OR CONCAT(u.first_name,' ',u.last_name)   ILIKE $8
                 OR t.notes                                ILIKE $8
                 OR t.payment_method                       ILIKE $8
             ))"#,
        filters.store_id,
        filters.cashier_id,
        filters.customer_id,
        filters.status,
        filters.payment_method.as_deref(),
        df,
        dt,
        search.as_deref(),
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);

    // ── DATA (same WHERE, with ORDER BY + LIMIT/OFFSET) ────────────────────────
    let txns = sqlx::query_as!(
        Transaction,
        r#"SELECT t.id, t.reference_no, t.store_id, t.cashier_id,
                  CONCAT(u.first_name, ' ', u.last_name) AS cashier_name,
                  t.customer_id,
                  CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
                  t.subtotal, t.discount_amount, t.tax_amount,
                  t.total_amount, t.amount_tendered, t.change_amount,
                  t.payment_method, t.payment_status, t.status,
                  t.notes, t.created_at
           FROM   transactions t
           LEFT JOIN users     u ON u.id = t.cashier_id
           LEFT JOIN customers c ON c.id = t.customer_id
           WHERE  ($1::int  IS NULL OR t.store_id    = $1)
             AND  ($2::int  IS NULL OR t.cashier_id  = $2)
             AND  ($3::int  IS NULL OR t.customer_id = $3)
             AND  ($4::text IS NULL OR t.status      = $4)
             AND  ($5::text IS NULL OR t.payment_method = $5)
             AND  ($6::text IS NULL OR t.created_at >= $6::text::date::timestamptz)
             AND  ($7::text IS NULL OR t.created_at <  ($7::text::date + INTERVAL '1 day')::timestamptz)
             AND  ($8::text IS NULL OR (
                    t.reference_no                         ILIKE $8
                 OR CONCAT(c.first_name,' ',c.last_name)   ILIKE $8
                 OR CONCAT(u.first_name,' ',u.last_name)   ILIKE $8
                 OR t.notes                                ILIKE $8
                 OR t.payment_method                       ILIKE $8
             ))
           ORDER  BY t.created_at DESC, t.id DESC
           LIMIT  $9 OFFSET $10"#,
        filters.store_id,
        filters.cashier_id,
        filters.customer_id,
        filters.status,
        filters.payment_method.as_deref(),
        df,
        dt,
        search.as_deref(),
        limit,
        offset,
    )
    .fetch_all(&pool)
    .await?;

    Ok(PagedResult::new(txns, total, page, limit))
}

// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_transaction(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<TransactionDetail> {
    guard_permission(&state, &token, "transactions.read").await?;
    let pool = state.pool().await?;
    let transaction = fetch_transaction(&pool, id).await?;
    let items       = fetch_transaction_items(&pool, id).await?;
    let payments    = fetch_transaction_payments(&pool, id).await?;
    Ok(TransactionDetail { transaction, items, payments })
}

// ─────────────────────────────────────────────────────────────────────────────

/// Void a transaction — same-day only (unless overridden by store_settings). Restores inventory.
#[tauri::command]
pub async fn void_transaction(
    state:   State<'_, AppState>,
    token:   String,
    id:      i32,
    payload: VoidTransactionDto,
) -> AppResult<Transaction> {
    let claims = guard_permission(&state, &token, "transactions.void").await?;
    let pool   = state.pool().await?;

    let tx = fetch_transaction(&pool, id).await?;

    if tx.status == "voided" || tx.status == "cancelled" {
        return Err(AppError::Validation("Transaction is already voided".into()));
    }
    if tx.status == "refunded" {
        return Err(AppError::Validation("Transaction has already been refunded".into()));
    }
    if tx.status != "completed" {
        return Err(AppError::Validation("Only completed transactions can be voided".into()));
    }

    // Fix 6c: enforce store_settings void rules
    let settings = super::store_settings::fetch_settings(&pool, tx.store_id).await.ok();
    if let Some(ref s) = settings {
        let now     = Utc::now().date_naive();
        let tx_date = tx.created_at.date_naive();
        if s.void_same_day_only && tx_date != now {
            return Err(AppError::Validation("Void is only allowed on the same day as the transaction".into()));
        }
        if let Some(max_void) = s.max_void_amount {
            if tx.total_amount > max_void {
                return Err(AppError::Validation(format!(
                    "Transaction amount ₦{:.2} exceeds max void limit ₦{:.2}",
                    tx.total_amount.round_dp(2), max_void.round_dp(2)
                )));
            }
        }
    } else {
        // Default: same-day only
        let now     = Utc::now().date_naive();
        let tx_date = tx.created_at.date_naive();
        if tx_date != now {
            return Err(AppError::Validation("Void is only allowed on the same day as the transaction".into()));
        }
    }

    let mut db_tx = pool.begin().await?;

    sqlx::query!(
        r#"UPDATE transactions
           SET status = 'voided', payment_status = 'refunded',
               cancelled_at = NOW(), cancelled_by = $1, notes = $2
           WHERE id = $3"#,
        claims.user_id, payload.reason, id,
    )
    .execute(&mut *db_tx)
    .await?;

    let items = fetch_transaction_items(&pool, id).await?;
    for item in &items {
        sqlx::query!(
            r#"UPDATE item_stock
               SET quantity = quantity + $1, available_quantity = available_quantity + $1, updated_at = NOW()
               WHERE item_id = $2 AND store_id = $3
                 AND EXISTS (SELECT 1 FROM item_settings WHERE item_id = $2 AND track_stock = TRUE)"#,
            item.quantity, item.item_id, tx.store_id,
        )
        .execute(&mut *db_tx)
        .await?;

        sqlx::query!(
            r#"INSERT INTO item_history (item_id, store_id, change_type, adjustment, reason, created_by)
               VALUES ($1,$2,'void_restore',$3,$4,$5)"#,
            item.item_id, tx.store_id, item.quantity,
            format!("Void: {}", payload.reason), claims.user_id,
        )
        .execute(&mut *db_tx)
        .await?;
    }

    sqlx::query!(
        "UPDATE shifts SET
            return_count  = COALESCE(return_count,  0) + 1,
            total_returns = COALESCE(total_returns, 0) + $1,
            updated_at    = NOW()
         WHERE opened_by = $2 AND store_id = $3
           AND status IN ('open', 'active', 'suspended')",
        tx.total_amount, claims.user_id, tx.store_id,
    )
    .execute(&mut *db_tx)
    .await
    .ok();

    db_tx.commit().await?;

    // Post-void notification
    super::notifications::push_notification(
        &pool,
        CreateNotificationDto {
            store_id:       tx.store_id,
            user_id:        None,
            r#type:         "void_alert".into(),
            title:          "Transaction Voided".into(),
            message:        format!("Transaction {} (₦{:.2}) was voided: {}", tx.reference_no, tx.total_amount, payload.reason),
            reference_type: Some("transaction".into()),
            reference_id:   Some(id.to_string()),
        },
    )
    .await
    .ok();

    fetch_transaction(&pool, id).await
}

// ─────────────────────────────────────────────────────────────────────────────

/// Partial refund — refund specific items (with quantities) from a transaction.
#[tauri::command]
pub async fn partial_refund(
    state:   State<'_, AppState>,
    token:   String,
    id:      i32,
    payload: PartialRefundDto,
) -> AppResult<RefundResult> {
    let claims = guard_permission(&state, &token, "transactions.refund").await?;
    let pool   = state.pool().await?;

    let tx = fetch_transaction(&pool, id).await?;

    if tx.status == "voided" || tx.status == "cancelled" {
        return Err(AppError::Validation("Cannot refund a voided transaction".into()));
    }
    if tx.status == "refunded" {
        return Err(AppError::Validation("Transaction has already been fully refunded".into()));
    }

    let tx_items     = fetch_transaction_items(&pool, id).await?;
    let tx_items_map: std::collections::HashMap<Uuid, &TransactionItem> =
        tx_items.iter().map(|i| (i.item_id, i)).collect();

    struct RefundLine {
        item_id:       Uuid,
        item_name:     String,
        sku:           String,
        quantity:      Decimal,
        unit_price:    Decimal,
        refund_amount: Decimal,
        reason:        String,
        track_stock:   bool,
        store_id:      i32,
    }

    let mut refund_lines: Vec<RefundLine> = Vec::new();
    let mut total_refund = Decimal::ZERO;

    for r_item in &payload.items {
        let qty = to_dec(r_item.quantity);
        if qty <= Decimal::ZERO {
            return Err(AppError::Validation("Refund quantity must be greater than zero".into()));
        }
        let tx_item = tx_items_map.get(&r_item.item_id).ok_or_else(|| {
            AppError::Validation(format!("Item {} not found in this transaction", r_item.item_id))
        })?;
        if qty > tx_item.quantity {
            return Err(AppError::Validation(format!(
                "Cannot refund more than sold for item '{}'. Sold: {}, Requested: {}",
                tx_item.item_name, tx_item.quantity, qty
            )));
        }

        let unit_refund = tx_item.line_total / tx_item.quantity;
        let item_refund = (unit_refund * qty).round_dp(2);
        total_refund   += item_refund;

        let track_stock: bool = sqlx::query_scalar!(
            "SELECT track_stock FROM item_settings WHERE item_id = $1 LIMIT 1",
            tx_item.item_id,
        )
        .fetch_optional(&pool)
        .await?
        .unwrap_or(false);

        refund_lines.push(RefundLine {
            item_id:       tx_item.item_id,
            item_name:     tx_item.item_name.clone(),
            sku:           tx_item.sku.clone(),
            quantity:      qty,
            unit_price:    tx_item.unit_price,
            refund_amount: item_refund,
            reason:        r_item.reason.clone().unwrap_or_else(|| "Customer request".into()),
            track_stock,
            store_id:      tx.store_id,
        });
    }

    let refund_ref = format!("REF-{}-{}", tx.reference_no, Utc::now().timestamp());
    let mut db_tx  = pool.begin().await?;

    // Generate a reference number for this return record
    let return_ref_no: String = sqlx::query_scalar!(
        "SELECT 'RET-' || LPAD(NEXTVAL('return_ref_seq')::text, 6, '0')"
    )
    .fetch_one(&mut *db_tx)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| format!("RET-{}", chrono::Utc::now().timestamp()));

    let return_reason = payload.notes.as_deref().unwrap_or("Partial refund");

    let return_id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO returns
               (reference_no, original_tx_id, store_id, cashier_id, customer_id,
                return_type, subtotal, tax_amount, total_amount,
                refund_method, reason, notes, status)
           VALUES ($1,$2,$3,$4,$5,'partial',$6,0,$7,$8,$9,$9,'completed')
           RETURNING id"#,
        return_ref_no,
        id, tx.store_id, claims.user_id, tx.customer_id,
        total_refund,
        total_refund,
        tx.payment_method,
        return_reason,
    )
    .fetch_one(&mut *db_tx)
    .await?;

    for line in &refund_lines {
        sqlx::query!(
            r#"INSERT INTO return_items
                   (return_id, item_id, item_name, sku,
                    quantity_returned, unit_price, line_total,
                    condition, restocked, notes)
               VALUES ($1,$2,$3,$4,$5,$6,$7,'good',TRUE,$8)"#,
            return_id, line.item_id, line.item_name, line.sku,
            line.quantity, line.unit_price, line.refund_amount,
            line.reason,
        )
        .execute(&mut *db_tx)
        .await?;

        if line.track_stock {
            sqlx::query!(
                r#"UPDATE item_stock
                   SET quantity = quantity + $1, available_quantity = available_quantity + $1, updated_at = NOW()
                   WHERE item_id = $2 AND store_id = $3"#,
                line.quantity, line.item_id, line.store_id,
            )
            .execute(&mut *db_tx)
            .await?;

            sqlx::query!(
                r#"INSERT INTO item_history (item_id, store_id, change_type, adjustment, reason, created_by)
                   VALUES ($1,$2,'refund_restore',$3,$4,$5)"#,
                line.item_id, line.store_id, line.quantity, line.reason, claims.user_id,
            )
            .execute(&mut *db_tx)
            .await?;
        }
    }

    sqlx::query!(
        r#"UPDATE transactions
           SET payment_status = 'partially_refunded',
               notes = COALESCE(notes, '') || ' | Partial refund: ' || $1
           WHERE id = $2"#,
        payload.notes.as_deref().unwrap_or("Partial refund"), id,
    )
    .execute(&mut *db_tx)
    .await?;

    let refund_method = format!("refund_{}", tx.payment_method);
    sqlx::query!(
        r#"INSERT INTO payments
               (transaction_id, payment_method, amount, status, processed_by, reference_no)
           VALUES ($1,$2,$3,'refunded',$4,$5)"#,
        id, refund_method, -total_refund, claims.user_id, refund_ref,
    )
    .execute(&mut *db_tx)
    .await?;

    sqlx::query!(
        "UPDATE shifts SET
            return_count  = COALESCE(return_count,  0) + 1,
            total_returns = COALESCE(total_returns, 0) + $1,
            updated_at    = NOW()
         WHERE opened_by = $2 AND store_id = $3
           AND status IN ('open', 'active', 'suspended')",
        total_refund, claims.user_id, tx.store_id,
    )
    .execute(&mut *db_tx)
    .await
    .ok();

    db_tx.commit().await?;

    Ok(RefundResult {
        success:        true,
        tx_id:          id,
        reference_no:   tx.reference_no.clone(),
        status:         "partially_refunded".into(),
        payment_status: "partially_refunded".into(),
        refund_amount:  total_refund,
        is_full_refund: false,
        refunded_at:    Utc::now(),
        message:        format!(
            "Partial refund of ₦{} processed successfully.",
            total_refund.round_dp(2)
        ),
    })
}

// ─────────────────────────────────────────────────────────────────────────────

/// Full refund — refund the entire transaction.
#[tauri::command]
pub async fn full_refund(
    state:   State<'_, AppState>,
    token:   String,
    id:      i32,
    payload: FullRefundDto,
) -> AppResult<RefundResult> {
    let claims = guard_permission(&state, &token, "transactions.refund").await?;
    let pool   = state.pool().await?;

    let tx = fetch_transaction(&pool, id).await?;

    if tx.status == "voided" || tx.status == "cancelled" {
        return Err(AppError::Validation("Cannot refund a voided transaction".into()));
    }
    if tx.status == "refunded" {
        return Err(AppError::Validation("Transaction has already been fully refunded".into()));
    }

    let tx_items = fetch_transaction_items(&pool, id).await?;
    let mut db_tx = pool.begin().await?;

    for item in &tx_items {
        let track_stock: bool = sqlx::query_scalar!(
            "SELECT track_stock FROM item_settings WHERE item_id = $1 LIMIT 1",
            item.item_id,
        )
        .fetch_optional(&pool)
        .await?
        .unwrap_or(false);

        if track_stock {
            sqlx::query!(
                r#"UPDATE item_stock
                   SET quantity = quantity + $1, available_quantity = available_quantity + $1, updated_at = NOW()
                   WHERE item_id = $2 AND store_id = $3"#,
                item.quantity, item.item_id, tx.store_id,
            )
            .execute(&mut *db_tx)
            .await?;

            sqlx::query!(
                r#"INSERT INTO item_history (item_id, store_id, change_type, adjustment, reason, created_by)
                   VALUES ($1,$2,'full_refund_restore',$3,$4,$5)"#,
                item.item_id, tx.store_id, item.quantity,
                payload.reason.as_str(), claims.user_id,
            )
            .execute(&mut *db_tx)
            .await?;
        }
    }

    sqlx::query!(
        "UPDATE transactions SET status = 'refunded', payment_status = 'refunded' WHERE id = $1",
        id,
    )
    .execute(&mut *db_tx)
    .await?;

    let refund_method = format!("refund_{}", tx.payment_method);
    sqlx::query!(
        r#"INSERT INTO payments (transaction_id, payment_method, amount, status, processed_by, reference_no)
           VALUES ($1,$2,$3,'refunded',$4,$5)"#,
        id, refund_method, -tx.total_amount, claims.user_id,
        format!("REFUND-{}-{}", tx.reference_no, Utc::now().timestamp()),
    )
    .execute(&mut *db_tx)
    .await?;

    sqlx::query!(
        "UPDATE shifts SET
            return_count  = COALESCE(return_count,  0) + 1,
            total_returns = COALESCE(total_returns, 0) + $1,
            updated_at    = NOW()
         WHERE opened_by = $2 AND store_id = $3
           AND status IN ('open', 'active', 'suspended')",
        tx.total_amount, claims.user_id, tx.store_id,
    )
    .execute(&mut *db_tx)
    .await
    .ok();

    db_tx.commit().await?;

    Ok(RefundResult {
        success:        true,
        tx_id:          id,
        reference_no:   tx.reference_no.clone(),
        status:         "refunded".into(),
        payment_status: "refunded".into(),
        refund_amount:  tx.total_amount,
        is_full_refund: true,
        refunded_at:    Utc::now(),
        message:        format!(
            "Full refund of ₦{} processed successfully. Inventory has been restored.",
            tx.total_amount.round_dp(2)
        ),
    })
}

// ── Held Transactions ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn hold_transaction(
    state:   State<'_, AppState>,
    token:   String,
    payload: HoldTransactionDto,
) -> AppResult<HeldTransaction> {
    let claims = guard(&state, &token).await?;
    let pool   = state.pool().await?;

    let id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO held_transactions (store_id, cashier_id, label, cart_data)
           VALUES ($1,$2,$3,$4) RETURNING id"#,
        payload.store_id, claims.user_id, payload.label, payload.cart_data,
    )
    .fetch_one(&pool)
    .await?;

    sqlx::query_as!(
        HeldTransaction,
        "SELECT id, store_id, cashier_id, label, cart_data, created_at FROM held_transactions WHERE id = $1",
        id
    )
    .fetch_one(&pool)
    .await
    .map_err(AppError::from)
}

#[tauri::command]
pub async fn get_held_transactions(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
) -> AppResult<Vec<HeldTransaction>> {
    let claims = guard(&state, &token).await?;
    let pool   = state.pool().await?;

    sqlx::query_as!(
        HeldTransaction,
        r#"SELECT id, store_id, cashier_id, label, cart_data, created_at
           FROM   held_transactions
           WHERE  store_id = $1 AND cashier_id = $2
           ORDER  BY created_at DESC"#,
        store_id, claims.user_id,
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

#[tauri::command]
pub async fn delete_held_transaction(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<()> {
    guard(&state, &token).await?;
    let pool = state.pool().await?;
    sqlx::query!("DELETE FROM held_transactions WHERE id = $1", id)
        .execute(&pool)
        .await?;
    Ok(())
}
