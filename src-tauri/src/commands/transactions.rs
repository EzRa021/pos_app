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
        TransactionStats, TransactionSearchResult,
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
use super::audit::write_audit_log;
use crate::utils::ref_no::{next_txn_ref_no_exec, next_ret_ref_no, store_txn_slug};

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
                  i.barcode                            AS "barcode?",
                  ti.quantity, ti.unit_price, ti.discount,
                  ti.tax_amount, ti.line_total,
                  ti.measurement_type, ti.unit_type
           FROM   transaction_items ti
           JOIN   items i ON i.id = ti.item_id
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
               i.id                          AS "id: Uuid",
               i.item_name,
               i.sku,
               i.cost_price                  AS "cost_price: Decimal",
               i.selling_price               AS "selling_price: Decimal",
               i.discount_price              AS "discount_price: Decimal",
               i.discount_price_enabled      AS "discount_price_enabled!: bool",
               ist.is_active                 AS "is_active!: bool",
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
                cost_price:           r.cost_price,
                selling_price:        r.selling_price,
                discount_price:         r.discount_price,
                discount_price_enabled: r.discount_price_enabled,
                is_active:              r.is_active,
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
    #[allow(dead_code)]
    struct LineItem {
        item_id:             Uuid,
        item_name:           String,
        sku:                 String,
        quantity:            Decimal,
        unit_price:          Decimal,
        item_discount:       Decimal,
        cost_price:          Decimal,
        net_amount:          Decimal,
        vat_amount:          Decimal,
        line_total:          Decimal,
        track_stock:         bool,
        allow_negative_stock: bool,
        measurement_type:    String,
        unit_type:           Option<String>,
    }

    let mut line_items: Vec<LineItem> = Vec::new();

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

        let unit_price = if item.discount_price_enabled {
            item.discount_price.unwrap_or(item.selling_price)
        } else {
            item.selling_price
        };
        let cost_price_for_item = item.cost_price;

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

        let tax_rate      = if item.taxable { item.tax_rate } else { Decimal::ZERO };
        let item_discount = to_dec(dto_item.discount.unwrap_or(0.0)).max(Decimal::ZERO);
        let gross         = ((unit_price * qty) - item_discount).max(Decimal::ZERO);
        let vat_amount    = vat_from_inclusive(gross, tax_rate);
        let net_amount    = net_from_inclusive(gross, vat_amount);

        line_items.push(LineItem {
            item_id:              item.id,
            item_name:            item.item_name.clone(),
            sku:                  item.sku.clone(),
            quantity:             qty,
            unit_price,
            item_discount,
            cost_price:           cost_price_for_item,
            net_amount,
            vat_amount,
            line_total:           gross,
            track_stock:          item.track_stock,
            allow_negative_stock: item.allow_negative_stock,
            measurement_type:     item.measurement_type.clone(),
            unit_type:            item.unit_type.clone(),
        });
    }

    // ── STEP 6: Calculate totals ───────────────────────────────────────────────
    let subtotal        = line_items.iter().map(|l| l.net_amount).sum::<Decimal>();
    let total_tax       = line_items.iter().map(|l| l.vat_amount).sum::<Decimal>();
    let discount_amount = to_dec(payload.discount_amount.unwrap_or(0.0));
    let total_amount    = subtotal + total_tax - discount_amount;
    let amount_tend     = payload.amount_tendered.map(to_dec);
    let change_amount   = amount_tend.map(|t| if t >= total_amount { t - total_amount } else { Decimal::ZERO });

    if let Some(ref s) = store_settings {
        if discount_amount > Decimal::ZERO && (subtotal + total_tax) > Decimal::ZERO {
            let pct = (discount_amount / (subtotal + total_tax) * Decimal::from(100)).round_dp(2);
            if pct > s.max_discount_percent {
                return Err(AppError::Validation(format!(
                    "Discount of {pct:.2}% exceeds the maximum allowed {:.2}%",
                    s.max_discount_percent
                )));
            }
        }
        if let Some(threshold) = s.require_customer_above_amount {
            if total_amount > threshold && payload.customer_id.is_none() {
                return Err(AppError::Validation(format!(
                    "A customer must be selected for sales above ₦{:.2}",
                    threshold.round_dp(2)
                )));
            }
        }
    }

    // ── STEP 8: Begin DB transaction ──────────────────────────────────────────
    let mut db_tx = pool.begin().await?;

    // ── Credit limit + wallet sufficiency checks (inside db_tx, race-safe) ────
    if payload.payment_method == "credit" {
        let cust_id = payload.customer_id.ok_or_else(||
            AppError::Validation("Customer is required for credit sales".into())
        )?;
        // BACKEND FAULT #5 fix: lock customer row and enforce credit headroom
        let row = sqlx::query!(
            r#"SELECT credit_limit       AS "credit_limit: Decimal",
                      outstanding_balance AS "outstanding_balance: Decimal",
                      credit_enabled      AS "credit_enabled!: bool"
               FROM customers WHERE id = $1 AND store_id = $2
               FOR UPDATE"#,
            cust_id, payload.store_id,
        )
        .fetch_optional(&mut *db_tx)
        .await?
        .ok_or_else(|| AppError::Validation("Customer not found".into()))?;

        if !row.credit_enabled {
            return Err(AppError::Validation("Credit sales are not enabled for this customer".into()));
        }
        if row.credit_limit > Decimal::ZERO {
            let available = (row.credit_limit - row.outstanding_balance).max(Decimal::ZERO);
            if total_amount > available {
                return Err(AppError::Validation(format!(
                    "Credit limit exceeded. Customer has ₦{} available credit, sale is ₦{}.",
                    available.round_dp(2),
                    total_amount.round_dp(2),
                )));
            }
        }
    }

    if payload.payment_method == "wallet" {
        let cust_id = payload.customer_id.ok_or_else(||
            AppError::Validation("Customer is required for wallet payments".into())
        )?;
        // BACKEND FAULT #12 fix: lock wallet balance inside tx
        let balance: Decimal = sqlx::query_scalar!(
            "SELECT COALESCE(wallet_balance, 0) AS \"wallet_balance!: Decimal\" FROM customers WHERE id = $1 AND store_id = $2 FOR UPDATE",
            cust_id, payload.store_id,
        )
        .fetch_optional(&mut *db_tx)
        .await?
        .unwrap_or(Decimal::ZERO);
        if balance < total_amount {
            return Err(AppError::Validation(format!(
                "Insufficient wallet balance. Available: ₦{:.2}, Required: ₦{:.2}",
                balance.round_dp(2), total_amount.round_dp(2)
            )));
        }
    }

    // ── STEP 9: Generate reference number (per-store sequential) ──────────────
    let store_row = sqlx::query!(
        "SELECT store_name, store_code FROM stores WHERE id = $1",
        payload.store_id
    )
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();
    let txn_slug = store_txn_slug(
        store_row.as_ref().and_then(|r| r.store_code.as_deref()),
        store_row.as_ref().map(|r| r.store_name.as_str()).unwrap_or("STR"),
    );
    // FAULT #12 fix: generate `reference_no` inside the DB transaction so
    // rollbacks revert the underlying counter increment.
    let ref_no = next_txn_ref_no_exec(&mut db_tx, payload.store_id, &txn_slug).await;

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
    // Stock deductions sync as signed deltas via stock_movements — queued
    // after commit alongside the transaction rows below.
    let mut stock_movements_q: Vec<(String, serde_json::Value)> = Vec::new();
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
            line.item_discount,
            line.vat_amount,
            line.net_amount,
            line.line_total,
            line.measurement_type,
            line.unit_type,
        )
        .execute(&mut *db_tx)
        .await?;

        if line.track_stock {
            // FAULT #2 fix: re-check stock availability inside the transaction with FOR UPDATE
            // to serialise concurrent sales on the same item.
            let locked = sqlx::query!(
                r#"SELECT available_quantity AS "available_quantity: Decimal"
                   FROM item_stock WHERE item_id = $1 AND store_id = $2 FOR UPDATE"#,
                line.item_id, payload.store_id,
            )
            .fetch_optional(&mut *db_tx)
            .await?;
            if let Some(locked_row) = locked {
                if !line.allow_negative_stock && locked_row.available_quantity < line.quantity {
                    return Err(AppError::Validation(format!(
                        "Insufficient stock for '{}': available {}, requested {}",
                        line.item_name, locked_row.available_quantity, line.quantity
                    )));
                }
            }

            sqlx::query!(
                r#"UPDATE item_stock
                   SET quantity = quantity - $1, available_quantity = available_quantity - $1, updated_at = NOW()
                   WHERE item_id = $2 AND store_id = $3"#,
                line.quantity, line.item_id, payload.store_id,
            )
            .execute(&mut *db_tx)
            .await?;

            stock_movements_q.push(crate::database::sync::log_stock_movement(
                &mut *db_tx, line.item_id, payload.store_id, Some(-line.quantity), None, "sale",
            ).await?);

            let unit_label = line.unit_type.as_deref().unwrap_or("unit(s)");
            let desc = format!("POS Sale — {} {} of {}", line.quantity, unit_label, line.item_name);
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
        if let Some(wallet_amt_f64) = payload.wallet_amount {
            let wallet_dec = to_dec(wallet_amt_f64);
            if wallet_dec > Decimal::ZERO {
                if let Some(customer_id) = payload.customer_id {
                    let current_balance: Option<Decimal> = sqlx::query_scalar!(
                        "SELECT wallet_balance FROM customers WHERE id = $1 FOR UPDATE", customer_id,
                    )
                    .fetch_optional(&mut *db_tx)
                    .await?;
                    let current_balance = current_balance.unwrap_or_default();
                    if current_balance < wallet_dec {
                        return Err(AppError::Validation(format!(
                            "Insufficient wallet balance. Available: ₦{:.2}, Required: ₦{:.2}",
                            current_balance.round_dp(2), wallet_dec.round_dp(2)
                        )));
                    }
                    let new_balance = current_balance - wallet_dec;
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
        if let Some(customer_id) = payload.customer_id {
            let current_balance: Option<Decimal> = sqlx::query_scalar!(
                "SELECT wallet_balance FROM customers WHERE id = $1 FOR UPDATE", customer_id,
            )
            .fetch_optional(&mut *db_tx)
            .await?;

            let current_balance = current_balance.unwrap_or_default();
            if current_balance < total_amount {
                return Err(AppError::Validation(format!(
                    "Insufficient wallet balance. Available: ₦{:.2}, Required: ₦{:.2}",
                    current_balance.round_dp(2), total_amount.round_dp(2)
                )));
            }
            let new_balance = current_balance - total_amount;
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

    // ── Cloud sync ────────────────────────────────────────────────────────────
    {
        for (mv_id, mv_row) in stock_movements_q {
            crate::database::sync::queue_row(
                &pool, "stock_movements", "INSERT", &mv_id, mv_row, Some(payload.store_id),
            ).await;
        }

        let sync_data = serde_json::json!({
            "id":             tx_id,
            "reference_no":   ref_no,
            "store_id":       payload.store_id,
            "cashier_id":     claims.user_id,
            "customer_id":    payload.customer_id,
            "subtotal":       subtotal.to_string(),
            "discount_amount": discount_amount.to_string(),
            "tax_amount":     total_tax.to_string(),
            "total_amount":   total_amount.to_string(),
            "payment_method": payload.payment_method,
            "payment_status": payment_status,
            "status":         "completed",
            "notes":          payload.notes,
            "offline_sale":   offline_sale,
        });
        crate::database::sync::queue_row(
            &pool,
            "transactions",
            "INSERT",
            &tx_id.to_string(),
            sync_data,
            Some(payload.store_id),
        )
        .await;

        for line in &line_items {
            crate::database::sync::queue_row(
                &pool,
                "transaction_items",
                "INSERT",
                &format!("{}:{}", tx_id, line.item_id),
                serde_json::json!({
                    "tx_id":       tx_id,
                    "item_id":     line.item_id,
                    "item_name":   line.item_name,
                    "sku":         line.sku,
                    "quantity":    line.quantity,
                    "unit_price":  line.unit_price,
                    "line_total":  line.line_total,
                }),
                Some(payload.store_id),
            )
            .await;
        }

        crate::database::sync::queue_row(
            &pool,
            "payments",
            "INSERT",
            &format!("tx:{}", tx_id),
            serde_json::json!({
                "transaction_id":   tx_id,
                "payment_method":   payload.payment_method,
                "amount":           amount_paid.to_string(),
                "status":           "completed",
            }),
            Some(payload.store_id),
        )
        .await;

        if is_credit {
            if let Some(customer_id) = payload.customer_id {
                crate::database::sync::queue_row(
                    &pool,
                    "credit_sales",
                    "INSERT",
                    &format!("tx:{}", tx_id),
                    serde_json::json!({
                        "transaction_id": tx_id,
                        "store_id":       payload.store_id,
                        "customer_id":    customer_id,
                        "total_amount":   total_amount.to_string(),
                        "amount_paid":    "0",
                        "outstanding":    total_amount.to_string(),
                        "status":         "open",
                    }),
                    Some(payload.store_id),
                )
                .await;
                crate::database::sync::queue_row(
                    &pool,
                    "customers",
                    "UPDATE",
                    &customer_id.to_string(),
                    serde_json::json!({ "id": customer_id, "store_id": payload.store_id }),
                    Some(payload.store_id),
                )
                .await;
            }
        }
        if is_wallet {
            if let Some(customer_id) = payload.customer_id {
                crate::database::sync::queue_row(
                    &pool,
                    "customers",
                    "UPDATE",
                    &customer_id.to_string(),
                    serde_json::json!({ "id": customer_id, "store_id": payload.store_id }),
                    Some(payload.store_id),
                )
                .await;
                crate::database::sync::queue_row(
                    &pool,
                    "customer_wallet_transactions",
                    "INSERT",
                    &format!("tx:{}", tx_id),
                    serde_json::json!({ "transaction_id": tx_id, "customer_id": customer_id, "store_id": payload.store_id, "type": "debit", "amount": total_amount.to_string() }),
                    Some(payload.store_id),
                )
                .await;
            }
        }
        if is_split {
            if let (Some(customer_id), Some(wallet_amt)) = (payload.customer_id, payload.wallet_amount) {
                let wallet_dec = to_dec(wallet_amt);
                if wallet_dec > Decimal::ZERO {
                    crate::database::sync::queue_row(
                        &pool,
                        "customers",
                        "UPDATE",
                        &customer_id.to_string(),
                        serde_json::json!({ "id": customer_id, "store_id": payload.store_id }),
                        Some(payload.store_id),
                    )
                    .await;
                    crate::database::sync::queue_row(
                        &pool,
                        "customer_wallet_transactions",
                        "INSERT",
                        &format!("tx:{}:wallet", tx_id),
                        serde_json::json!({ "transaction_id": tx_id, "customer_id": customer_id, "store_id": payload.store_id, "type": "debit", "amount": wallet_dec.to_string() }),
                        Some(payload.store_id),
                    )
                    .await;
                }
            }
        }
    }

    // ── Post-commit hooks ─────────────────────────────────────────────────────
    if let Some(customer_id) = payload.customer_id {
        if !is_credit {
            super::loyalty::earn_points_internal(
                &pool, payload.store_id, customer_id, tx_id, total_amount, claims.user_id,
            )
            .await
            .ok();
        }
    }

    if let (Some(customer_id), Some(pts)) = (payload.customer_id, payload.loyalty_points_redeemed) {
        if pts > 0 && !is_credit {
            super::loyalty::redeem_points_internal(
                &pool, payload.store_id, customer_id, tx_id, pts, claims.user_id,
            )
            .await
            .ok();
        }
    }

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

        if new_alert_count > 0 {
            super::notifications::push_notification(
                &pool,
                CreateNotificationDto {
                    store_id:       payload.store_id,
                    user_id:        None,
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
    write_audit_log(&pool, claims.user_id, Some(payload.store_id), "create", "transaction",
        &format!("Transaction {} — ₦{:.2}", transaction.reference_no, transaction.total_amount), "info").await;
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

    let search = filters.search
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| format!("%{s}%"));

    // UPGRADE #7: validate date strings before handing to PostgreSQL cast
    if let Some(ref df_str) = filters.date_from {
        if !df_str.is_empty() {
            df_str.parse::<chrono::NaiveDate>()
                .map_err(|_| AppError::Validation("Invalid date_from format. Expected YYYY-MM-DD".into()))?;
        }
    }
    if let Some(ref dt_str) = filters.date_to {
        if !dt_str.is_empty() {
            dt_str.parse::<chrono::NaiveDate>()
                .map_err(|_| AppError::Validation("Invalid date_to format. Expected YYYY-MM-DD".into()))?;
        }
    }

    let df = filters.date_from.as_deref().filter(|s| !s.is_empty());
    let dt = filters.date_to.as_deref().filter(|s| !s.is_empty());
    let ps = filters.payment_status.as_deref();

    let total: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*)
           FROM   transactions t
           LEFT JOIN users     u ON u.id = t.cashier_id
           LEFT JOIN customers c ON c.id = t.customer_id
           WHERE  ($1::int  IS NULL OR t.store_id       = $1)
             AND  ($2::int  IS NULL OR t.cashier_id     = $2)
             AND  ($3::int  IS NULL OR t.customer_id    = $3)
             AND  ($4::text IS NULL OR t.status         = $4)
             AND  ($5::text IS NULL OR t.payment_method = $5)
             AND  ($6::text IS NULL OR t.payment_status = $6)
             AND  ($7::text IS NULL OR t.created_at >= $7::text::date::timestamptz)
             AND  ($8::text IS NULL OR t.created_at <  ($8::text::date + INTERVAL '1 day')::timestamptz)
             AND  ($9::text IS NULL OR (
                    t.reference_no                         ILIKE $9
                 OR CONCAT(c.first_name,' ',c.last_name)   ILIKE $9
                 OR CONCAT(u.first_name,' ',u.last_name)   ILIKE $9
                 OR t.notes                                ILIKE $9
                 OR t.payment_method                       ILIKE $9
             ))"#,
        filters.store_id,
        filters.cashier_id,
        filters.customer_id,
        filters.status,
        filters.payment_method.as_deref(),
        ps,
        df,
        dt,
        search.as_deref(),
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);

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
           WHERE  ($1::int  IS NULL OR t.store_id       = $1)
             AND  ($2::int  IS NULL OR t.cashier_id     = $2)
             AND  ($3::int  IS NULL OR t.customer_id    = $3)
             AND  ($4::text IS NULL OR t.status         = $4)
             AND  ($5::text IS NULL OR t.payment_method = $5)
             AND  ($6::text IS NULL OR t.payment_status = $6)
             AND  ($7::text IS NULL OR t.created_at >= $7::text::date::timestamptz)
             AND  ($8::text IS NULL OR t.created_at <  ($8::text::date + INTERVAL '1 day')::timestamptz)
             AND  ($9::text IS NULL OR (
                    t.reference_no                         ILIKE $9
                 OR CONCAT(c.first_name,' ',c.last_name)   ILIKE $9
                 OR CONCAT(u.first_name,' ',u.last_name)   ILIKE $9
                 OR t.notes                                ILIKE $9
                 OR t.payment_method                       ILIKE $9
             ))
           ORDER  BY t.created_at DESC, t.id DESC
           LIMIT  $10 OFFSET $11"#,
        filters.store_id,
        filters.cashier_id,
        filters.customer_id,
        filters.status,
        filters.payment_method.as_deref(),
        ps,
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
pub async fn get_transaction_stats(
    state:    State<'_, AppState>,
    token:    String,
    store_id: Option<i32>,
) -> AppResult<TransactionStats> {
    // RISK #1 fix: enforce store scope for non-global users
    let claims = guard_permission(&state, &token, "transactions.read").await?;
    let pool   = state.pool().await?;

    let effective_store_id = if claims.is_global { store_id } else { claims.store_id };

    let row = sqlx::query!(
        r#"SELECT
               COUNT(*)                                                                                AS "total!: i64",
               COUNT(*) FILTER (WHERE t.status = 'completed')                                         AS "completed!: i64",
               COUNT(*) FILTER (WHERE t.status = 'voided')                                            AS "voided!: i64",
               COUNT(*) FILTER (WHERE t.status IN ('refunded', 'partially_refunded'))                  AS "refunded!: i64",
               COUNT(*) FILTER (
                   WHERE DATE(t.created_at AT TIME ZONE 'Africa/Lagos') = CURRENT_DATE AT TIME ZONE 'Africa/Lagos'
                     AND t.status = 'completed'
               )                                                                                       AS "today_count!: i64",
               COALESCE(
                   SUM(t.total_amount) FILTER (
                       WHERE DATE(t.created_at AT TIME ZONE 'Africa/Lagos') = CURRENT_DATE AT TIME ZONE 'Africa/Lagos'
                         AND t.status = 'completed'
                   ),
                   0
               )                                                                                       AS "today_revenue!: Decimal"
           FROM transactions t
           WHERE ($1::int IS NULL OR t.store_id = $1)"#,
        effective_store_id,
    )
    .fetch_one(&pool)
    .await?;

    Ok(TransactionStats {
        total:         row.total,
        completed:     row.completed,
        voided:        row.voided,
        refunded:      row.refunded,
        today_count:   row.today_count,
        today_revenue: row.today_revenue,
    })
}

// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_transaction(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<TransactionDetail> {
    // RISK #1 fix: enforce store scope for non-global users
    let claims = guard_permission(&state, &token, "transactions.read").await?;
    let pool   = state.pool().await?;
    let transaction = fetch_transaction(&pool, id).await?;
    if !claims.is_global {
        let user_store = claims.store_id.ok_or(AppError::Forbidden)?;
        if transaction.store_id != user_store {
            return Err(AppError::Forbidden);
        }
    }
    let items    = fetch_transaction_items(&pool, id).await?;
    let payments = fetch_transaction_payments(&pool, id).await?;
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

    if !claims.is_global {
        let user_store = claims.store_id.ok_or(AppError::Forbidden)?;
        if tx.store_id != user_store {
            return Err(AppError::Forbidden);
        }
    }

    if tx.status == "voided" || tx.status == "cancelled" {
        return Err(AppError::Validation("Transaction is already voided".into()));
    }
    if tx.status == "refunded" {
        return Err(AppError::Validation("Transaction has already been refunded".into()));
    }
    if tx.status != "completed" {
        return Err(AppError::Validation("Only completed transactions can be voided".into()));
    }

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
        let now     = Utc::now().date_naive();
        let tx_date = tx.created_at.date_naive();
        if tx_date != now {
            return Err(AppError::Validation("Void is only allowed on the same day as the transaction".into()));
        }
    }

    let mut db_tx = pool.begin().await?;

    // FAULT #5 fix: preserve original notes; store reason in cancelled_reason (migration 0091)
    sqlx::query!(
        r#"UPDATE transactions
           SET status           = 'voided',
               payment_status   = 'refunded',
               cancelled_at     = NOW(),
               cancelled_by     = $1,
               cancelled_reason = $2,
               notes            = CASE
                   WHEN notes IS NULL OR notes = '' THEN 'VOID: ' || $2
                   ELSE notes || ' | VOID: ' || $2
               END
                   || CASE
                          WHEN $3::text IS NOT NULL AND $3::text <> '' THEN ' | ' || $3::text
                          ELSE ''
                      END
           WHERE id = $4"#,
        claims.user_id,
        payload.reason,
        payload.notes.as_deref(),
        id,
    )
    .execute(&mut *db_tx)
    .await?;

    // FAULT #9 fix: fetch items inside the transaction for a consistent snapshot
    let items = sqlx::query_as!(
        TransactionItem,
        r#"SELECT ti.id, ti.tx_id, ti.item_id, ti.item_name, ti.sku,
                  i.barcode                            AS "barcode?",
                  ti.quantity, ti.unit_price, ti.discount,
                  ti.tax_amount, ti.line_total,
                  ti.measurement_type, ti.unit_type
           FROM   transaction_items ti
           JOIN   items i ON i.id = ti.item_id
           WHERE  ti.tx_id = $1
           ORDER  BY ti.id"#,
        id
    )
    .fetch_all(&mut *db_tx)
    .await?;

    let mut stock_movements_q: Vec<(String, serde_json::Value)> = Vec::new();
    for item in &items {
        let restored = sqlx::query!(
            r#"UPDATE item_stock
               SET quantity = quantity + $1, available_quantity = available_quantity + $1, updated_at = NOW()
               WHERE item_id = $2 AND store_id = $3
                 AND EXISTS (SELECT 1 FROM item_settings WHERE item_id = $2 AND track_stock = TRUE)"#,
            item.quantity, item.item_id, tx.store_id,
        )
        .execute(&mut *db_tx)
        .await?
        .rows_affected();

        // Only log a movement when the guarded restock actually applied
        // (track_stock items with an existing item_stock row).
        if restored > 0 {
            stock_movements_q.push(crate::database::sync::log_stock_movement(
                &mut *db_tx, item.item_id, tx.store_id, Some(item.quantity), None, "void",
            ).await?);
        }

        // FAULT #1 fix: use canonical item_history schema (event_type, quantity columns)
        let desc = format!(
            "Void Restore — {} of {} (void: {})",
            item.quantity, item.item_name, payload.reason
        );
        sqlx::query!(
            r#"INSERT INTO item_history
                   (item_id, store_id, event_type, event_description,
                    quantity_before, quantity_after, quantity_change,
                    performed_by, reference_type, reference_id, notes)
               VALUES ($1,$2,'VOID_RESTORE',$3,
                       (SELECT quantity - $4 FROM item_stock WHERE item_id = $1 AND store_id = $2),
                       (SELECT quantity       FROM item_stock WHERE item_id = $1 AND store_id = $2),
                       $4,
                       $5,'transaction',$6,$7)"#,
            item.item_id, tx.store_id, desc,
            item.quantity,
            claims.user_id,
            tx.reference_no,
            payload.reason,
        )
        .execute(&mut *db_tx)
        .await?;
    }

    // FAULT #4 fix: restore credit or wallet balance
    if tx.payment_method == "credit" {
        if let Some(cust_id) = tx.customer_id {
            sqlx::query!(
                "UPDATE credit_sales SET status = 'cancelled' WHERE transaction_id = $1",
                id,
            )
            .execute(&mut *db_tx)
            .await?;
            sqlx::query!(
                "UPDATE customers SET outstanding_balance = GREATEST(0, outstanding_balance - $1) WHERE id = $2",
                tx.total_amount, cust_id,
            )
            .execute(&mut *db_tx)
            .await?;
        }
    } else if tx.payment_method == "wallet" {
        if let Some(cust_id) = tx.customer_id {
            sqlx::query!(
                "UPDATE customers SET wallet_balance = wallet_balance + $1, updated_at = NOW() WHERE id = $2",
                tx.total_amount, cust_id,
            )
            .execute(&mut *db_tx)
            .await?;
            sqlx::query!(
                r#"INSERT INTO customer_wallet_transactions
                       (customer_id, store_id, type, amount, balance_after,
                        transaction_id, recorded_by, notes)
                   VALUES ($1,$2,'credit',$3,
                           (SELECT wallet_balance FROM customers WHERE id = $1),
                           $4,$5,'Refund: transaction voided')"#,
                cust_id, tx.store_id, tx.total_amount,
                id, claims.user_id,
            )
            .execute(&mut *db_tx)
            .await?;
        }
    }

    // RISK #5 fix: decrement sales counters alongside the return counters
    // so shift reconciliation doesn't get inflated (cash drawer should not
    // count voided/refunded sales).
    let zero = Decimal::ZERO;
    let (cash_dec, card_dec, xfer_dec, mobile_dec) = if tx.payment_method == "split" {
        // For split payments we mirror `create_transaction`'s shift accounting:
        // only cash/card/transfer/mobile_money legs affect the per-method totals.
        let cash_dec: Decimal = sqlx::query_scalar!(
            r#"SELECT COALESCE(SUM(amount), 0) AS "amt!: Decimal"
               FROM payments
               WHERE transaction_id = $1
                 AND payment_method = 'cash'
                 AND status = 'completed'"#,
            id
        )
        .fetch_one(&mut *db_tx)
        .await?;
        let card_dec: Decimal = sqlx::query_scalar!(
            r#"SELECT COALESCE(SUM(amount), 0) AS "amt!: Decimal"
               FROM payments
               WHERE transaction_id = $1
                 AND payment_method = 'card'
                 AND status = 'completed'"#,
            id
        )
        .fetch_one(&mut *db_tx)
        .await?;
        let xfer_dec: Decimal = sqlx::query_scalar!(
            r#"SELECT COALESCE(SUM(amount), 0) AS "amt!: Decimal"
               FROM payments
               WHERE transaction_id = $1
                 AND payment_method = 'transfer'
                 AND status = 'completed'"#,
            id
        )
        .fetch_one(&mut *db_tx)
        .await?;
        let mobile_dec: Decimal = sqlx::query_scalar!(
            r#"SELECT COALESCE(SUM(amount), 0) AS "amt!: Decimal"
               FROM payments
               WHERE transaction_id = $1
                 AND payment_method = 'mobile_money'
                 AND status = 'completed'"#,
            id
        )
        .fetch_one(&mut *db_tx)
        .await?;
        (cash_dec, card_dec, xfer_dec, mobile_dec)
    } else {
        match tx.payment_method.as_str() {
            "cash"         => (tx.total_amount, zero,             zero,          zero),
            "card"         => (zero,           tx.total_amount,  zero,          zero),
            "transfer"     => (zero,           zero,             tx.total_amount, zero),
            "mobile_money" => (zero,           zero,             zero,          tx.total_amount),
            _              => (zero,           zero,             zero,          zero),
        }
    };

    sqlx::query!(
        "UPDATE shifts SET
            return_count  = COALESCE(return_count,  0) + 1,
            total_returns = COALESCE(total_returns, 0) + $1,
            total_sales        = GREATEST(0, COALESCE(total_sales, 0) - $1),
            total_cash_sales   = GREATEST(0, COALESCE(total_cash_sales, 0) - $2),
            total_card_sales   = GREATEST(0, COALESCE(total_card_sales, 0) - $3),
            total_transfers    = GREATEST(0, COALESCE(total_transfers, 0) - $4),
            total_mobile_sales = GREATEST(0, COALESCE(total_mobile_sales, 0) - $5),
            updated_at    = NOW()
         WHERE opened_by = $6 AND store_id = $7
           AND status IN ('open', 'active', 'suspended')",
        tx.total_amount,
        cash_dec,
        card_dec,
        xfer_dec,
        mobile_dec,
        claims.user_id,
        tx.store_id,
    )
    .execute(&mut *db_tx)
    .await
    .ok();

    db_tx.commit().await?;

    // FAULT #11 fix: queue void update for cloud sync
    crate::database::sync::queue_row(
        &pool,
        "transactions",
        "UPDATE",
        &id.to_string(),
        serde_json::json!({
            "id":             id,
            "status":         "voided",
            "payment_status": "refunded",
            "store_id":       tx.store_id,
        }),
        Some(tx.store_id),
    )
    .await;

    for (mv_id, mv_row) in stock_movements_q {
        crate::database::sync::queue_row(
            &pool, "stock_movements", "INSERT", &mv_id, mv_row, Some(tx.store_id),
        ).await;
    }

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

    let voided = fetch_transaction(&pool, id).await?;
    write_audit_log(&pool, claims.user_id, Some(voided.store_id), "void", "transaction",
        &format!("Voided transaction {} — reason: {}", voided.reference_no, payload.reason), "warning").await;
    Ok(voided)
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

    if !claims.is_global {
        let user_store = claims.store_id.ok_or(AppError::Forbidden)?;
        if tx.store_id != user_store {
            return Err(AppError::Forbidden);
        }
    }

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
    let mut refund_item_ids: Vec<Uuid> = Vec::new();

    for r_item in &payload.items {
        let qty = to_dec(r_item.quantity);
        if qty <= Decimal::ZERO {
            return Err(AppError::Validation("Refund quantity must be greater than zero".into()));
        }
        let tx_item = tx_items_map.get(&r_item.item_id).ok_or_else(|| {
            AppError::Validation(format!("Item {} not found in this transaction", r_item.item_id))
        })?;

        // FAULT #3 fix: account for previously returned quantities
        let already_returned: Decimal = sqlx::query_scalar!(
            r#"SELECT COALESCE(SUM(ri.quantity_returned), 0) AS "qty: Decimal"
               FROM return_items ri
               JOIN returns r ON r.id = ri.return_id
               WHERE r.original_tx_id = $1 AND ri.item_id = $2
                 AND r.status != 'cancelled'"#,
            id, tx_item.item_id,
        )
        .fetch_one(&pool)
        .await?
        .unwrap_or(Decimal::ZERO);

        let returnable = tx_item.quantity - already_returned;
        if qty > returnable {
            return Err(AppError::Validation(format!(
                "Cannot return {} of '{}' — only {} returnable (sold: {}, already returned: {})",
                qty, tx_item.item_name, returnable, tx_item.quantity, already_returned
            )));
        }

        let unit_refund = tx_item.line_total / tx_item.quantity;
        let item_refund = (unit_refund * qty).round_dp(2);
        total_refund   += item_refund;
        refund_item_ids.push(tx_item.item_id);

        refund_lines.push(RefundLine {
            item_id:       tx_item.item_id,
            item_name:     tx_item.item_name.clone(),
            sku:           tx_item.sku.clone(),
            quantity:      qty,
            unit_price:    tx_item.unit_price,
            refund_amount: item_refund,
            reason:        r_item.reason.clone().unwrap_or_else(|| "Customer request".into()),
            track_stock:   false, // filled in by batch query below
            store_id:      tx.store_id,
        });
    }

    // FAULT #7 fix: batch track_stock lookup — one query for all refund items
    let tracked_ids: std::collections::HashSet<Uuid> = sqlx::query_scalar!(
        r#"SELECT item_id AS "item_id: Uuid"
           FROM item_settings
           WHERE item_id = ANY($1) AND track_stock = TRUE"#,
        &refund_item_ids as &[Uuid],
    )
    .fetch_all(&pool)
    .await?
    .into_iter()
    .collect();

    for line in &mut refund_lines {
        line.track_stock = tracked_ids.contains(&line.item_id);
    }

    // Generate return reference number before starting db_tx
    let refund_store_row = sqlx::query!(
        "SELECT store_name, store_code FROM stores WHERE id = $1",
        tx.store_id
    )
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();
    let refund_slug = store_txn_slug(
        refund_store_row.as_ref().and_then(|r| r.store_code.as_deref()),
        refund_store_row.as_ref().map(|r| r.store_name.as_str()).unwrap_or("STR"),
    );
    let return_ref_no = next_ret_ref_no(&pool, tx.store_id, &refund_slug).await;

    let return_reason = payload.notes.as_deref().unwrap_or("Partial refund");

    let mut db_tx = pool.begin().await?;

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

    let mut stock_movements_q: Vec<(String, serde_json::Value)> = Vec::new();
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

            stock_movements_q.push(crate::database::sync::log_stock_movement(
                &mut *db_tx, line.item_id, line.store_id, Some(line.quantity), None, "refund",
            ).await?);

            // FAULT #1 fix: use canonical item_history schema
            let desc = format!(
                "Partial Refund Restore — {} of {} ({})",
                line.quantity, line.item_name, line.reason
            );
            sqlx::query!(
                r#"INSERT INTO item_history
                       (item_id, store_id, event_type, event_description,
                        quantity_before, quantity_after, quantity_change,
                        performed_by, reference_type, reference_id, notes)
                   VALUES ($1,$2,'REFUND_RESTORE',$3,
                           (SELECT quantity - $4 FROM item_stock WHERE item_id = $1 AND store_id = $2),
                           (SELECT quantity       FROM item_stock WHERE item_id = $1 AND store_id = $2),
                           $4,
                           $5,'return',$6,$7)"#,
                line.item_id, line.store_id, desc,
                line.quantity,
                claims.user_id,
                return_ref_no,
                line.reason,
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
    // UPGRADE #4 fix: use sequential return_ref_no instead of timestamp-based string
    sqlx::query!(
        r#"INSERT INTO payments
               (transaction_id, payment_method, amount, status, processed_by, reference_no)
           VALUES ($1,$2,$3,'refunded',$4,$5)"#,
        id, refund_method, -total_refund, claims.user_id, return_ref_no,
    )
    .execute(&mut *db_tx)
    .await?;

    // FAULT #10 fix: update credit_sales and customer balance for credit transactions
    if tx.payment_method == "credit" {
        if let Some(cust_id) = tx.customer_id {
            sqlx::query!(
                r#"UPDATE credit_sales
                   SET outstanding  = GREATEST(0, outstanding - $1),
                       amount_paid  = amount_paid + $1,
                       status       = CASE
                           WHEN GREATEST(0, outstanding - $1) = 0 THEN 'paid'
                           ELSE status
                       END
                   WHERE transaction_id = $2"#,
                total_refund, id,
            )
            .execute(&mut *db_tx)
            .await?;
            sqlx::query!(
                "UPDATE customers SET outstanding_balance = GREATEST(0, outstanding_balance - $1) WHERE id = $2",
                total_refund, cust_id,
            )
            .execute(&mut *db_tx)
            .await?;
        }
    }

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

    for (mv_id, mv_row) in stock_movements_q {
        crate::database::sync::queue_row(
            &pool, "stock_movements", "INSERT", &mv_id, mv_row, Some(tx.store_id),
        ).await;
    }

    // FAULT #11 fix: queue partial refund for cloud sync
    crate::database::sync::queue_row(
        &pool,
        "transactions",
        "UPDATE",
        &id.to_string(),
        serde_json::json!({
            "id":             id,
            "payment_status": "partially_refunded",
            "store_id":       tx.store_id,
        }),
        Some(tx.store_id),
    )
    .await;

    write_audit_log(&pool, claims.user_id, Some(tx.store_id), "partial_refund", "transaction",
        &format!("Partial refund ₦{} on transaction {}", total_refund.round_dp(2), tx.reference_no), "warning").await;

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

    if !claims.is_global {
        let user_store = claims.store_id.ok_or(AppError::Forbidden)?;
        if tx.store_id != user_store {
            return Err(AppError::Forbidden);
        }
    }

    if tx.status == "voided" || tx.status == "cancelled" {
        return Err(AppError::Validation("Cannot refund a voided transaction".into()));
    }
    if tx.status == "refunded" {
        return Err(AppError::Validation("Transaction has already been fully refunded".into()));
    }

    let tx_items = fetch_transaction_items(&pool, id).await?;
    let item_ids: Vec<Uuid> = tx_items.iter().map(|i| i.item_id).collect();

    // FAULT #7 fix: batch track_stock lookup
    let tracked_ids: std::collections::HashSet<Uuid> = sqlx::query_scalar!(
        r#"SELECT item_id AS "item_id: Uuid"
           FROM item_settings
           WHERE item_id = ANY($1) AND track_stock = TRUE"#,
        &item_ids as &[Uuid],
    )
    .fetch_all(&pool)
    .await?
    .into_iter()
    .collect();

    // FAULT #6 fix: generate a return reference number for the returns record
    let refund_store_row = sqlx::query!(
        "SELECT store_name, store_code FROM stores WHERE id = $1",
        tx.store_id
    )
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();
    let refund_slug = store_txn_slug(
        refund_store_row.as_ref().and_then(|r| r.store_code.as_deref()),
        refund_store_row.as_ref().map(|r| r.store_name.as_str()).unwrap_or("STR"),
    );
    let return_ref_no = next_ret_ref_no(&pool, tx.store_id, &refund_slug).await;

    let mut db_tx = pool.begin().await?;

    let mut stock_movements_q: Vec<(String, serde_json::Value)> = Vec::new();
    for item in &tx_items {
        let track_stock = tracked_ids.contains(&item.item_id);
        if track_stock {
            sqlx::query!(
                r#"UPDATE item_stock
                   SET quantity = quantity + $1, available_quantity = available_quantity + $1, updated_at = NOW()
                   WHERE item_id = $2 AND store_id = $3"#,
                item.quantity, item.item_id, tx.store_id,
            )
            .execute(&mut *db_tx)
            .await?;

            stock_movements_q.push(crate::database::sync::log_stock_movement(
                &mut *db_tx, item.item_id, tx.store_id, Some(item.quantity), None, "refund",
            ).await?);

            // FAULT #1 fix: use canonical item_history schema
            let desc = format!(
                "Full Refund Restore — {} of {} ({})",
                item.quantity, item.item_name, payload.reason
            );
            sqlx::query!(
                r#"INSERT INTO item_history
                       (item_id, store_id, event_type, event_description,
                        quantity_before, quantity_after, quantity_change,
                        performed_by, reference_type, reference_id, notes)
                   VALUES ($1,$2,'FULL_REFUND_RESTORE',$3,
                           (SELECT quantity - $4 FROM item_stock WHERE item_id = $1 AND store_id = $2),
                           (SELECT quantity       FROM item_stock WHERE item_id = $1 AND store_id = $2),
                           $4,
                           $5,'transaction',$6,$7)"#,
                item.item_id, tx.store_id, desc,
                item.quantity,
                claims.user_id,
                tx.reference_no,
                payload.reason,
            )
            .execute(&mut *db_tx)
            .await?;
        }
    }

    // FAULT #6 fix: create a returns record so full refunds are visible in the returns module
    let return_id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO returns
               (reference_no, original_tx_id, store_id, cashier_id, customer_id,
                return_type, subtotal, tax_amount, total_amount,
                refund_method, reason, notes, status)
           VALUES ($1,$2,$3,$4,$5,'full',0,0,$6,$7,$8,$8,'completed')
           RETURNING id"#,
        return_ref_no,
        id, tx.store_id, claims.user_id, tx.customer_id,
        tx.total_amount,
        tx.payment_method,
        payload.reason,
    )
    .fetch_one(&mut *db_tx)
    .await?;

    for item in &tx_items {
        sqlx::query!(
            r#"INSERT INTO return_items
                   (return_id, item_id, item_name, sku,
                    quantity_returned, unit_price, line_total,
                    condition, restocked, notes)
               VALUES ($1,$2,$3,$4,$5,$6,$7,'good',TRUE,$8)"#,
            return_id, item.item_id, item.item_name, item.sku,
            item.quantity, item.unit_price, item.line_total,
            payload.reason,
        )
        .execute(&mut *db_tx)
        .await?;
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
        id, refund_method, -tx.total_amount, claims.user_id, return_ref_no,
    )
    .execute(&mut *db_tx)
    .await?;

    // FAULT #4 fix: restore credit or wallet balance
    if tx.payment_method == "credit" {
        if let Some(cust_id) = tx.customer_id {
            sqlx::query!(
                "UPDATE credit_sales SET status = 'cancelled' WHERE transaction_id = $1",
                id,
            )
            .execute(&mut *db_tx)
            .await?;
            sqlx::query!(
                "UPDATE customers SET outstanding_balance = GREATEST(0, outstanding_balance - $1) WHERE id = $2",
                tx.total_amount, cust_id,
            )
            .execute(&mut *db_tx)
            .await?;
        }
    } else if tx.payment_method == "wallet" {
        if let Some(cust_id) = tx.customer_id {
            sqlx::query!(
                "UPDATE customers SET wallet_balance = wallet_balance + $1, updated_at = NOW() WHERE id = $2",
                tx.total_amount, cust_id,
            )
            .execute(&mut *db_tx)
            .await?;
            sqlx::query!(
                r#"INSERT INTO customer_wallet_transactions
                       (customer_id, store_id, type, amount, balance_after,
                        transaction_id, recorded_by, notes)
                   VALUES ($1,$2,'credit',$3,
                           (SELECT wallet_balance FROM customers WHERE id = $1),
                           $4,$5,'Refund: full refund processed')"#,
                cust_id, tx.store_id, tx.total_amount,
                id, claims.user_id,
            )
            .execute(&mut *db_tx)
            .await?;
        }
    }

    // RISK #5 fix: decrement sales counters alongside the return counters
    // so shift reconciliation doesn't get inflated (cash drawer should not
    // count voided/refunded sales).
    let zero = Decimal::ZERO;
    let (cash_dec, card_dec, xfer_dec, mobile_dec) = if tx.payment_method == "split" {
        let cash_dec: Decimal = sqlx::query_scalar!(
            r#"SELECT COALESCE(SUM(amount), 0) AS "amt!: Decimal"
               FROM payments
               WHERE transaction_id = $1
                 AND payment_method = 'cash'
                 AND status = 'completed'"#,
            id
        )
        .fetch_one(&mut *db_tx)
        .await?;
        let card_dec: Decimal = sqlx::query_scalar!(
            r#"SELECT COALESCE(SUM(amount), 0) AS "amt!: Decimal"
               FROM payments
               WHERE transaction_id = $1
                 AND payment_method = 'card'
                 AND status = 'completed'"#,
            id
        )
        .fetch_one(&mut *db_tx)
        .await?;
        let xfer_dec: Decimal = sqlx::query_scalar!(
            r#"SELECT COALESCE(SUM(amount), 0) AS "amt!: Decimal"
               FROM payments
               WHERE transaction_id = $1
                 AND payment_method = 'transfer'
                 AND status = 'completed'"#,
            id
        )
        .fetch_one(&mut *db_tx)
        .await?;
        let mobile_dec: Decimal = sqlx::query_scalar!(
            r#"SELECT COALESCE(SUM(amount), 0) AS "amt!: Decimal"
               FROM payments
               WHERE transaction_id = $1
                 AND payment_method = 'mobile_money'
                 AND status = 'completed'"#,
            id
        )
        .fetch_one(&mut *db_tx)
        .await?;
        (cash_dec, card_dec, xfer_dec, mobile_dec)
    } else {
        match tx.payment_method.as_str() {
            "cash"         => (tx.total_amount, zero,             zero,          zero),
            "card"         => (zero,           tx.total_amount,  zero,          zero),
            "transfer"     => (zero,           zero,             tx.total_amount, zero),
            "mobile_money" => (zero,           zero,             zero,          tx.total_amount),
            _              => (zero,           zero,             zero,          zero),
        }
    };

    sqlx::query!(
        "UPDATE shifts SET
            return_count  = COALESCE(return_count,  0) + 1,
            total_returns = COALESCE(total_returns, 0) + $1,
            total_sales        = GREATEST(0, COALESCE(total_sales, 0) - $1),
            total_cash_sales   = GREATEST(0, COALESCE(total_cash_sales, 0) - $2),
            total_card_sales   = GREATEST(0, COALESCE(total_card_sales, 0) - $3),
            total_transfers    = GREATEST(0, COALESCE(total_transfers, 0) - $4),
            total_mobile_sales = GREATEST(0, COALESCE(total_mobile_sales, 0) - $5),
            updated_at    = NOW()
         WHERE opened_by = $6 AND store_id = $7
           AND status IN ('open', 'active', 'suspended')",
        tx.total_amount,
        cash_dec,
        card_dec,
        xfer_dec,
        mobile_dec,
        claims.user_id,
        tx.store_id,
    )
    .execute(&mut *db_tx)
    .await
    .ok();

    db_tx.commit().await?;

    for (mv_id, mv_row) in stock_movements_q {
        crate::database::sync::queue_row(
            &pool, "stock_movements", "INSERT", &mv_id, mv_row, Some(tx.store_id),
        ).await;
    }

    // FAULT #11 fix: queue full refund for cloud sync
    crate::database::sync::queue_row(
        &pool,
        "transactions",
        "UPDATE",
        &id.to_string(),
        serde_json::json!({
            "id":             id,
            "status":         "refunded",
            "payment_status": "refunded",
            "store_id":       tx.store_id,
        }),
        Some(tx.store_id),
    )
    .await;

    write_audit_log(&pool, claims.user_id, Some(tx.store_id), "full_refund", "transaction",
        &format!("Full refund ₦{} on transaction {}", tx.total_amount.round_dp(2), tx.reference_no), "warning").await;

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

// ── Transaction Search (command palette / global search) ────────────────────

/// Fast text search returning slim result rows.
/// HTTP-only — not registered as a Tauri command. Call via rpc("search_transactions", ...).
pub(crate) async fn search_transactions_inner(
    state:    &AppState,
    token:    String,
    query:    String,
    store_id: Option<i32>,
    limit:    Option<i64>,
) -> AppResult<Vec<TransactionSearchResult>> {
    guard_permission(state, &token, "transactions.read").await?;
    let pool   = state.pool().await?;
    let limit  = limit.unwrap_or(8).clamp(1, 20);
    let search = format!("%{}%", query.trim());

    sqlx::query_as!(
        TransactionSearchResult,
        r#"SELECT t.id, t.reference_no,
                  CONCAT(c.first_name, ' ', c.last_name) AS "customer_name",
                  CONCAT(u.first_name, ' ', u.last_name) AS "cashier_name",
                  t.total_amount, t.status, t.payment_method, t.created_at
           FROM   transactions t
           LEFT JOIN customers c ON c.id = t.customer_id
           LEFT JOIN users     u ON u.id = t.cashier_id
           WHERE  ($1::int IS NULL OR t.store_id = $1)
             AND  (
                    t.reference_no                          ILIKE $2
                 OR CONCAT(c.first_name, ' ', c.last_name)  ILIKE $2
                 OR CONCAT(u.first_name, ' ', u.last_name)  ILIKE $2
                 OR t.notes                                 ILIKE $2
                 OR t.payment_method                        ILIKE $2
             )
           ORDER  BY t.created_at DESC
           LIMIT  $3"#,
        store_id,
        search,
        limit,
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

// ── Held Transactions ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn hold_transaction(
    state:   State<'_, AppState>,
    token:   String,
    payload: HoldTransactionDto,
) -> AppResult<HeldTransaction> {
    // RISK #3 fix: require pos.sale permission, not just authentication
    let claims = guard_permission(&state, &token, "pos.sale").await?;
    let pool   = state.pool().await?;

    // UPGRADE #5 fix: cap held transactions per cashier to prevent abuse
    let held_count: i64 = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM held_transactions WHERE store_id = $1 AND cashier_id = $2",
        payload.store_id, claims.user_id,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);
    if held_count >= 20 {
        return Err(AppError::Validation(
            "Maximum of 20 held transactions per cashier. Please resume or delete some before holding more.".into()
        ));
    }

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
    // RISK #3 fix: require pos.sale permission
    let claims = guard_permission(&state, &token, "pos.sale").await?;
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

// ── HTTP-server inner wrappers ────────────────────────────────────────────────

#[inline]
fn as_tauri_state(s: &AppState) -> tauri::State<'_, AppState> {
    unsafe { std::mem::transmute(s) }
}

pub(crate) async fn create_transaction_inner(
    state:   &AppState,
    token:   String,
    payload: CreateTransactionDto,
) -> AppResult<TransactionDetail> {
    create_transaction(as_tauri_state(state), token, payload).await
}

pub(crate) async fn get_transactions_inner(
    state:   &AppState,
    token:   String,
    filters: TransactionFilters,
) -> AppResult<PagedResult<Transaction>> {
    get_transactions(as_tauri_state(state), token, filters).await
}

pub(crate) async fn get_transaction_inner(
    state: &AppState,
    token: String,
    id:    i32,
) -> AppResult<TransactionDetail> {
    get_transaction(as_tauri_state(state), token, id).await
}

pub(crate) async fn get_transaction_stats_inner(
    state:    &AppState,
    token:    String,
    store_id: Option<i32>,
) -> AppResult<TransactionStats> {
    get_transaction_stats(as_tauri_state(state), token, store_id).await
}

pub(crate) async fn void_transaction_inner(
    state:   &AppState,
    token:   String,
    id:      i32,
    payload: VoidTransactionDto,
) -> AppResult<Transaction> {
    void_transaction(as_tauri_state(state), token, id, payload).await
}

pub(crate) async fn partial_refund_inner(
    state:   &AppState,
    token:   String,
    id:      i32,
    payload: PartialRefundDto,
) -> AppResult<RefundResult> {
    partial_refund(as_tauri_state(state), token, id, payload).await
}

pub(crate) async fn full_refund_inner(
    state:   &AppState,
    token:   String,
    id:      i32,
    payload: FullRefundDto,
) -> AppResult<RefundResult> {
    full_refund(as_tauri_state(state), token, id, payload).await
}

pub(crate) async fn hold_transaction_inner(
    state:   &AppState,
    token:   String,
    payload: HoldTransactionDto,
) -> AppResult<HeldTransaction> {
    hold_transaction(as_tauri_state(state), token, payload).await
}

pub(crate) async fn get_held_transactions_inner(
    state:    &AppState,
    token:    String,
    store_id: i32,
) -> AppResult<Vec<HeldTransaction>> {
    get_held_transactions(as_tauri_state(state), token, store_id).await
}

pub(crate) async fn delete_held_transaction_inner(
    state: &AppState,
    token: String,
    id:    i32,
) -> AppResult<()> {
    delete_held_transaction(as_tauri_state(state), token, id).await
}
