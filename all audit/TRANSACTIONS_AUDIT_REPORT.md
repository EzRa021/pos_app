# Quantum POS — Production Audit: Sales / Transactions Module

**Audited:** 2026-04-25  
**Scope:** `src-tauri/src/commands/transactions.rs`, `src/features/transactions/useTransactions.js`, `src/features/transactions/TransactionsPanel.jsx`, `src/features/transactions/TransactionDetailPanel.jsx`, `src/pages/TransactionsPage.jsx`, `src/pages/TransactionDetailPage.jsx`, `src/commands/transactions.js`.

---

## BACKEND FAULTS (must fix before production)

### 1. `item_history` INSERT schema in `void_transaction`, `partial_refund`, and `full_refund` mismatches the schema used in `create_transaction`
**Where:** `src-tauri/src/commands/transactions.rs` — `void_transaction()`, `partial_refund()`, `full_refund()`  
**What:** In `create_transaction`, item history is recorded using the full audit schema:
```sql
INSERT INTO item_history (item_id, store_id, event_type, event_description,
    quantity_before, quantity_after, quantity_change, performed_by,
    reference_type, reference_id, notes)
```
In `void_transaction`, `partial_refund`, and `full_refund`, item history is inserted using a completely different set of columns:
```sql
INSERT INTO item_history (item_id, store_id, change_type, adjustment, reason, created_by)
```
`change_type`, `adjustment`, `reason`, and `created_by` do not exist in the schema described by the `create_transaction` INSERT. At least one set of INSERTs will panic at runtime with a column-not-found error from SQLx. This makes every void and every refund produce a 500 error after the stock has already been updated inside the same DB transaction (which then rolls back on the error — but the bug still prevents these operations from completing).  
**Fix:** Unify all `item_history` INSERTs to use the canonical schema from `create_transaction`. For void/refund operations:
```rust
sqlx::query!(
    r#"INSERT INTO item_history
           (item_id, store_id, event_type, event_description,
            quantity_before, quantity_after, quantity_change,
            performed_by, reference_type, reference_id, notes)
       VALUES ($1,$2,$3,$4,
               (SELECT quantity - $7 FROM item_stock WHERE item_id = $1 AND store_id = $2),
               (SELECT quantity FROM item_stock WHERE item_id = $1 AND store_id = $2),
               $7, $5,$6,$6,$4)"#,
    item.item_id, tx.store_id, "VOID_RESTORE", desc,
    claims.user_id, tx.reference_no, item.quantity,
)
```

### 2. Race condition on stock availability check — `available_quantity` read outside the DB transaction
**Where:** `src-tauri/src/commands/transactions.rs` — `create_transaction()`, Step 4 (item bulk fetch) vs Step 11 (stock deduction inside `db_tx`)  
**What:** Step 4 fetches `istock.available_quantity` using `&pool` (outside any transaction). Step 11 runs `UPDATE item_stock SET quantity = quantity - $1 ... WHERE item_id = $2 AND store_id = $3` inside `db_tx`. Between these two points, another concurrent POS sale on the same store can deduct the same stock. Two cashiers selling the last unit simultaneously will both pass the check and both commit — the quantity becomes negative even when `allow_negative_stock = FALSE`.  
**Fix:** Move the stock check inside the `db_tx` using `SELECT available_quantity FROM item_stock WHERE item_id = $1 AND store_id = $2 FOR UPDATE` for each tracked item before the deduction. This serializes concurrent sales on the same item.

### 3. `partial_refund` quantity check ignores previously returned quantities
**Where:** `src-tauri/src/commands/transactions.rs` — `partial_refund()`, per-item qty validation  
**What:** The check `if qty > tx_item.quantity` compares against the original sold quantity. If 5 units were sold, 3 already returned (via a prior partial refund), and the cashier now tries to return 4 more, the check passes (`4 > 5` is false) and the backend allows a combined return of 7 units from an original sale of 5. Stock is over-restored by 2 units.  
**Fix:** Look up already-returned quantity before validating:
```rust
let already_returned: Decimal = sqlx::query_scalar!(
    "SELECT COALESCE(SUM(ri.quantity_returned), 0)
     FROM return_items ri
     JOIN returns r ON r.id = ri.return_id
     WHERE r.original_tx_id = $1 AND ri.item_id = $2
       AND r.status != 'cancelled'",
    id, tx_item.item_id,
)
.fetch_one(&pool).await?;
let returnable = tx_item.quantity - already_returned;
if qty > returnable {
    return Err(AppError::Validation(format!(
        "Cannot return {} of '{}' — only {} returnable (sold: {}, already returned: {})",
        qty, tx_item.item_name, returnable, tx_item.quantity, already_returned
    )));
}
```

### 4. `void_transaction` and `full_refund` do not restore credit/wallet balances
**Where:** `src-tauri/src/commands/transactions.rs` — `void_transaction()` and `full_refund()`  
**What:** Both functions restore stock and update transaction status, but neither checks `tx.payment_method`. For a credit sale that is voided: the `credit_sales` record remains `'open'`, and the customer's `outstanding_balance` is not reduced. For a wallet sale that is voided or fully refunded: `customers.wallet_balance` is not restored. The customer owes money or has a lower wallet balance for a sale that no longer exists.  
**Fix:** In `void_transaction`, add inside `db_tx`:
```rust
if tx.payment_method == "credit" {
    if let Some(cust_id) = tx.customer_id {
        sqlx::query!("UPDATE credit_sales SET status = 'cancelled' WHERE transaction_id = $1", id)
            .execute(&mut *db_tx).await?;
        sqlx::query!("UPDATE customers SET outstanding_balance = GREATEST(0, outstanding_balance - $1) WHERE id = $2",
            tx.total_amount, cust_id).execute(&mut *db_tx).await?;
    }
} else if tx.payment_method == "wallet" {
    if let Some(cust_id) = tx.customer_id {
        sqlx::query!("UPDATE customers SET wallet_balance = wallet_balance + $1 WHERE id = $2",
            tx.total_amount, cust_id).execute(&mut *db_tx).await?;
        // INSERT into customer_wallet_transactions for audit trail
    }
}
```
Apply the same logic in `full_refund`.

### 5. `void_transaction` notes overwrite the transaction's original notes
**Where:** `src-tauri/src/commands/transactions.rs` — `void_transaction()`, the UPDATE statement  
**What:**
```sql
UPDATE transactions SET status = 'voided', ..., notes = $2 WHERE id = $3
```
`$2` is `payload.reason`. This overwrites the transaction's original `notes` field (e.g., "Birthday cake for table 5") with the void reason. After voiding, the original business notes are permanently lost.  
**Fix:** Append to notes instead:
```rust
notes = CASE
    WHEN notes IS NULL OR notes = '' THEN 'VOID: ' || $2
    ELSE notes || ' | VOID: ' || $2
END
```
And add a dedicated `void_reason` / `cancelled_reason` column (nullable TEXT) to the `transactions` table for clean separation.

### 6. `full_refund` creates no `returns` record — refunds are invisible in the returns module
**Where:** `src-tauri/src/commands/transactions.rs` — `full_refund()`  
**What:** `partial_refund` creates a `returns` record and `return_items` rows. `full_refund` creates neither — it only updates the transaction status and inserts a negative payment entry. Full refunds are therefore invisible in the returns module, cannot be viewed on the `ReturnsPage`, and are not counted in shift return totals via the returns data path. The returns module will only ever show partial refunds.  
**Fix:** Replicate the `partial_refund` pattern inside `full_refund`: insert into `returns` with `return_type = 'full'` and insert all `tx_items` into `return_items` with their full quantities and `restocked = TRUE`.

### 7. `track_stock` per-item lookup runs in a loop (N+1) in `partial_refund` and `full_refund`, outside the transaction
**Where:** `src-tauri/src/commands/transactions.rs` — `partial_refund()` and `full_refund()`, per-item `SELECT track_stock` loop  
**What:** For each item in the refund, a separate `SELECT track_stock FROM item_settings WHERE item_id = $1 LIMIT 1` is executed using `&pool` (outside `db_tx`). A 10-item transaction refund runs 10 additional round-trips outside the transaction boundary. The decision of whether to restock is made on a potentially stale read that isn't protected by the transaction's isolation.  
**Fix:** Batch the lookup before the transaction begins or inside the transaction with a single query:
```rust
let tracked_items: std::collections::HashSet<Uuid> = sqlx::query_scalar!(
    "SELECT item_id FROM item_settings WHERE item_id = ANY($1) AND track_stock = TRUE",
    &item_ids as &[Uuid],
)
.fetch_all(&mut *db_tx).await?
.into_iter().collect();
```

### 8. `today_revenue` and `today_count` in `get_transaction_stats` use PostgreSQL server's UTC date, not store's local timezone
**Where:** `src-tauri/src/commands/transactions.rs` — `get_transaction_stats()`  
**What:** `DATE(t.created_at) = CURRENT_DATE` uses the PostgreSQL server's current date. In Nigeria (WAT = UTC+1), a sale made at 11:05 PM local time on April 25 is stored as `2026-04-26 00:05:00 UTC`. `CURRENT_DATE` on the server is April 26, so the sale is correctly attributed to today. However a sale at 11:50 PM local time — still April 25 in Nigeria — is stored as April 26 UTC and will appear in tomorrow's stats. Stores will consistently see incorrect "Today's Revenue" after ~11 PM local time.  
**Fix:** Use `AT TIME ZONE 'Africa/Lagos'`:
```sql
DATE(t.created_at AT TIME ZONE 'Africa/Lagos') = CURRENT_DATE AT TIME ZONE 'Africa/Lagos'
```
Or store the store's timezone and apply it dynamically.

### 9. `void_transaction` fetches `transaction_items` using `&pool` outside the database transaction
**Where:** `src-tauri/src/commands/transactions.rs` — `void_transaction()`, the `fetch_transaction_items(&pool, id)` call before the item loop  
**What:** The items to be restocked are fetched using `&pool` before the `db_tx` loop that actually performs the UPDATE. This is a non-repeatable read: another concurrent operation could theoretically insert or modify transaction_items between the fetch and the stock update. More critically, if the `item_history` INSERT fails (see Fault #1), the stock UPDATE has already been executed inside `db_tx` and the whole transaction rolls back — but the items were fetched with stale data. Using a consistent snapshot within the transaction is the safe pattern.  
**Fix:** Move the `fetch_transaction_items` call to run against `&mut *db_tx`:
```rust
let items = sqlx::query_as!(TransactionItem, "SELECT ... FROM transaction_items WHERE tx_id = $1 ...", id)
    .fetch_all(&mut *db_tx).await?;
```

### 10. `partial_refund` does not reduce `credit_sales.outstanding` or `customers.outstanding_balance` for credit transactions
**Where:** `src-tauri/src/commands/transactions.rs` — `partial_refund()`  
**What:** If a credit sale for ₦10,000 is partially refunded ₦3,000, the customer's `outstanding_balance` remains at ₦10,000 and the `credit_sales` record is not updated. The customer is still expected to pay the full amount. The credit module (`CreditSalesPage`) shows the wrong balance.  
**Fix:** Inside `db_tx` after the refund lines are processed, if `tx.payment_method == "credit"`:
```rust
sqlx::query!(
    "UPDATE credit_sales SET outstanding = GREATEST(0, outstanding - $1),
         amount_paid = amount_paid + $1,
         status = CASE WHEN GREATEST(0, outstanding - $1) = 0 THEN 'paid' ELSE status END
     WHERE transaction_id = $2",
    total_refund, id,
).execute(&mut *db_tx).await?;
sqlx::query!(
    "UPDATE customers SET outstanding_balance = GREATEST(0, outstanding_balance - $1) WHERE id = $2",
    total_refund, tx.customer_id.unwrap(),
).execute(&mut *db_tx).await?;
```

### 11. Voids and refunds are never queued for cloud sync
**Where:** `src-tauri/src/commands/transactions.rs` — `void_transaction()`, `partial_refund()`, `full_refund()`  
**What:** `create_transaction` carefully queues every inserted row to `sync_queue` for replication to Supabase. None of the three mutation commands (void, partial refund, full refund) queue any sync entries. After a void, the cloud copy of the transaction still shows `status = 'completed'`. The Supabase replica is permanently out of sync for these operations, breaking cross-store reporting and any cloud dashboard.  
**Fix:** After each `db_tx.commit()`, queue the updated transaction row to `sync_queue` using `crate::database::sync::queue_row(...)` with `operation = "UPDATE"`, as done for other modules.

### 12. `create_transaction` reference number is generated outside the DB transaction
**Where:** `src-tauri/src/commands/transactions.rs` — `create_transaction()`, Step 9  
**What:** `next_txn_ref_no(&pool, payload.store_id, &txn_slug).await` runs against `&pool` before the `db_tx.begin()`. The store slug is also fetched from `&pool`. If `db_tx.begin()` fails after this point, or if the INSERT fails and `db_tx.rollback()` runs, the sequence counter has been incremented (or a gap has been created in reference numbers). Reference number gaps are common but this pattern also means a transaction that fails to commit can consume a ref number, causing an audit gap.  
**Fix:** Generate the reference number inside `db_tx` using `&mut *db_tx` or use a PostgreSQL sequence (`SELECT nextval('tx_ref_seq_store_N')`) that automatically rolls back on transaction abort.

---

## BACKEND UPGRADES (should improve)

### 1. `get_transactions` duplicates the WHERE clause verbatim in two queries
The COUNT query and the data query share an identical 9-condition WHERE clause. Any future filter change must be applied in two places. Extract into a CTE or helper macro:
```sql
WITH filtered AS (
    SELECT t.*, ... FROM transactions t
    LEFT JOIN users u ... LEFT JOIN customers c ...
    WHERE <shared conditions>
)
SELECT COUNT(*) FROM filtered;
-- then
SELECT * FROM filtered ORDER BY ... LIMIT $10 OFFSET $11;
```

### 2. Missing database indexes on core transaction filter columns
`get_transactions` filters on `store_id`, `status`, `payment_method`, `cashier_id`, `customer_id`, and `created_at`. None of these columns appear to have composite indexes. For a store with 50,000+ transactions, every list page load runs a full table scan:
```sql
CREATE INDEX IF NOT EXISTS idx_transactions_store_created
    ON transactions(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_store_status
    ON transactions(store_id, status);
CREATE INDEX IF NOT EXISTS idx_transactions_cashier
    ON transactions(cashier_id, store_id);
CREATE INDEX IF NOT EXISTS idx_transactions_customer
    ON transactions(customer_id, store_id);
```

### 3. `get_transaction_stats` is not filtered by time window — counts are all-time
`get_transaction_stats` returns all-time totals for `completed`, `voided`, `refunded`, and `total`. For a store with 2 years of history, `stats.total` = 48,000 is meaningless as a dashboard card. Add optional `date_from` / `date_to` parameters so the stats can reflect the current filter context (e.g., show counts for the selected date range, not all time). The `staleTime: 60 * 1000` in the frontend will cache the all-time count for a minute regardless of active date filters.

### 4. `partial_refund` uses a fragile `refund_ref` format that doesn't follow the store's numbering scheme
```rust
let refund_ref = format!("REF-{}-{}", tx.reference_no, Utc::now().timestamp());
```
This generates `REF-TXN-ABC-001-1714054800` — not the store's sequential return numbering scheme. `return_ref_no` (generated by `next_ret_ref_no`) is already created and used for the `returns` table, but `refund_ref` (the timestamp-based string) is used as the `reference_no` in the `payments` INSERT. These two reference numbers for the same return event will confuse audit queries. Use `return_ref_no` consistently for the payment entry's `reference_no`.

### 5. `hold_transaction` has no per-cashier or per-store limit
Any authenticated user can call `hold_transaction` unlimited times. A buggy client or intentional abuse could insert thousands of rows into `held_transactions`, bloating the table indefinitely since there is also no TTL cleanup. Add a check:
```rust
let held_count: i64 = sqlx::query_scalar!(
    "SELECT COUNT(*) FROM held_transactions WHERE store_id = $1 AND cashier_id = $2",
    payload.store_id, claims.user_id,
).fetch_one(&pool).await?;
if held_count >= 20 {
    return Err(AppError::Validation("Maximum of 20 held transactions per cashier. Please resume or delete some before holding more.".into()));
}
```

### 6. `partial_refund` status update appends to `notes` instead of using a dedicated field
```sql
UPDATE transactions SET payment_status = 'partially_refunded',
    notes = COALESCE(notes, '') || ' | Partial refund: ' || $1
```
Appending to `notes` is fragile — a long original note plus multiple refund notes will overflow `notes` readably, and programmatic parsing is impossible. Add a `refund_notes` column (or use the `returns` table exclusively for this context) and stop mutating the original notes.

### 7. `get_transactions` date filter casts strings inline without validation
```sql
AND ($7::text IS NULL OR t.created_at >= $7::text::date::timestamptz)
```
An invalid date string like `"not-a-date"` sent from the frontend will produce a PostgreSQL cast error that surfaces as a generic 500 response. Validate date strings in Rust before building the query:
```rust
if let Some(ref df) = filters.date_from {
    df.parse::<chrono::NaiveDate>()
        .map_err(|_| AppError::Validation("Invalid date_from format. Expected YYYY-MM-DD".into()))?;
}
```

### 8. `get_transaction_stats` runs a full table scan on every page load
The stats query aggregates over all rows in `transactions` matching the optional `store_id`. With no time window and no index on `status`, this becomes increasingly expensive. Consider a materialized stats table refreshed on each sale/void/refund, or cache in `app_config` and recalculate asynchronously.

### 9. `create_transaction` `store_row` fetch for slug generation uses `&pool` inside the function but could race with store updates
Minor but worth noting: the store name/code used to generate the transaction slug is fetched right before `db_tx.begin()`. If the store's `store_code` is updated concurrently (rare but possible), the slug used for a reference number might differ from what the store's code will be after the update. Fetch within `db_tx` for consistency.

### 10. `search_transactions_inner` is not registered as a Tauri `#[tauri::command]`
`search_transactions_inner` is `pub(crate)` and used only through the HTTP RPC dispatcher. The frontend's `searchTransactions()` uses `rpc("search_transactions", ...)` which goes through the Axum HTTP server — this is correct. However, if a developer tries to call `invoke("search_transactions", ...)` directly (e.g., in a future Tauri-mode feature), it will fail silently with no helpful error. Add a comment at the top of the function noting this is HTTP-only and register a stub Tauri command that returns a clear error if called via invoke.

---

## BACKEND FEATURES (add for completeness)

### 1. No refund time-window enforcement
There is no configurable refund policy (e.g., "no refunds after 30 days"). Voids have `void_same_day_only` and `max_void_amount` enforced via `store_settings`. Refunds have no equivalent. A cashier can issue a full refund on a 2-year-old transaction. Add `refund_window_days` and `max_refund_amount` to `store_settings` and enforce them in `partial_refund` and `full_refund`.

### 2. No refund payment method selection — refund always returns to original method
The refund method is hardcoded to `format!("refund_{}", tx.payment_method)`. There is no way to refund a card transaction to store wallet credit, or a cash transaction to a bank transfer. Production POS systems frequently need flexible refund destinations. Add a `refund_method` field to `PartialRefundDto` and `FullRefundDto` with validation, and update wallet/credit balances accordingly when the refund method differs from the original.

### 3. No background cleanup for stale held transactions
`held_transactions` rows accumulate indefinitely. A transaction held at the start of a morning and never resumed (cashier changed, shift closed, POS restarted) will remain in the table forever. Add a scheduled cleanup or a TTL column:
```sql
ALTER TABLE held_transactions ADD COLUMN expires_at TIMESTAMPTZ
    DEFAULT NOW() + INTERVAL '24 hours';
CREATE INDEX ON held_transactions(expires_at);
```
And a Tauri command `cleanup_expired_holds()` called on startup or nightly.

### 4. No per-item discount audit trail
`transaction_items.discount` stores the flat per-item discount amount, but there is no record of who authorized it, what percentage it represented, or whether it was within the cashier's discount authority. Add `discount_authorized_by` (nullable FK to `users`) and `discount_reason` (nullable TEXT) to `transaction_items`.

### 5. No `amount_paid` tracking on partially refunded transactions
After a partial refund, the `transactions` table has `total_amount` (original), `payment_status = 'partially_refunded'`, but no field for the net amount actually retained. Aggregate queries and shift summaries have to join `returns` to derive the true retained amount. Add a `net_amount` computed/stored column updated on each refund.

### 6. No offline transaction queue for failed submissions
When the Rust backend is temporarily unavailable (DB connection drop, Tauri restart), a `create_transaction` RPC call fails and the sale is lost. The `sync_queue` table handles cloud replication but not local failure. Consider a local offline queue in `app_config` or `localStorage` (frontend) that replays failed sales on reconnect.

### 7. Missing audit log entry in `partial_refund` notes (notes field is written but generic)
The partial refund audit log entry is:
```rust
write_audit_log(..., "partial_refund", "transaction",
    &format!("Partial refund ₦{} on transaction {}", ...), "warning").await;
```
This does not include which items were refunded, at what quantities, or which cashier processed the refund in the description field. The audit log should include a JSON summary of refund lines for forensic traceability.

### 8. No transaction amendment capability for notes/customer after creation
Once committed, there is no API to update `transactions.notes`, `transactions.customer_id`, or `transactions.cashier_id` (in case of cashier selection error). A manager must directly UPDATE the DB. Add a `patch_transaction` command gated on `transactions.edit` permission for fields that don't affect financials.

### 9. No aggregate "sales by payment method" query in the transactions module
The analytics module may cover this, but there is no command on the transactions module itself to return totals broken down by payment method for a date range. This is essential for end-of-day cash drawer reconciliation and shift-end reports. Add `get_transaction_payment_breakdown(store_id, date_from, date_to)` returning per-method totals.

### 10. No event hook to notify the loyalty or wallet module of voided points-earning transactions
When a transaction that earned loyalty points is voided, `void_transaction` restores stock and changes status but does not call `super::loyalty::revoke_points_internal(...)` or equivalent. The customer keeps the points earned on a sale that no longer exists. Add a post-void loyalty points reversal (non-fatal, after commit) mirroring the post-create `earn_points_internal` call.

---

## FRONTEND FAULTS (must fix before production)

### 1. `isPartiallyRefunded` check in `TransactionDetailPanel` is always `false`
**Where:** `src/features/transactions/TransactionDetailPanel.jsx`  
**What:** `const isPartiallyRefunded = tx?.status === "partially_refunded"`. The backend's `partial_refund` command only updates `payment_status` to `'partially_refunded'`; `status` remains `'completed'`. This expression is always `false`, so `useQuery({ queryKey: ["tx-returned-qty", tx?.id], enabled: !!tx?.id && isPartiallyRefunded })` never fires. The `returnedQtyMap` is always empty. When the `PartialRefundModal` opens for a transaction that has already had some items partially returned, it shows the full original quantity as available for return, with no indication that some units were already refunded.  
**Fix:** Change the guard to check `payment_status`:
```js
const isPartiallyRefunded = tx?.payment_status === "partially_refunded";
```

### 2. `PartialRefundModal` `maxQty` uses `Math.floor` — breaks decimal/bulk item refunds
**Where:** `src/features/transactions/TransactionDetailPanel.jsx` — `PartialRefundModal`, the `maxQty` derivation  
**What:** `const maxQty = Math.floor(parseFloat(item.quantity))`. For items sold by weight or bulk (e.g., 2.5 kg, 0.75 L), `Math.floor(2.5) = 2`. A cashier who sold 2.5 kg can only refund 2 kg through the modal; the remaining 0.5 kg is unrefundable via the UI (though the backend would accept it). The decrement step also uses `stepForType` but the ceiling is artificially floored.  
**Fix:**
```js
const maxQty = parseFloat(item.quantity);
```
The backend already validates that `qty > tx_item.quantity`.

### 3. Search input does not reset page to 1 on new search
**Where:** `src/features/transactions/TransactionsPanel.jsx` — `handleSearchChange`  
**What:** When the user types in the search box, `setUrlSearch(val)` is called after the debounce, but `setPage(1)` is not called. If the user is on page 4 of results and types a new search term, the query runs with `page=4` and returns zero results, while matching results on page 1 are never shown. The user sees an empty table.  
**Fix:**
```js
debounceTimer.current = setTimeout(() => {
  setUrlSearch(val);
  setPage(1);
}, 400);
```

### 4. `VoidModal` submits both `reason` and `notes` but the backend `VoidTransactionDto` only stores `reason`
**Where:** `src/features/transactions/TransactionDetailPanel.jsx` — `VoidModal` and `handleVoid()`  
**What:** The modal collects `reason` (required) and `notes` (optional) separately and `handleVoid` calls `voidTx.mutateAsync(payload)` where `payload = { reason, notes }`. The backend UPDATE sets `notes = $2` where `$2` is `payload.reason` — the `payload.notes` field is ignored entirely. The "Notes" field in the void modal is a UI placeholder that does nothing.  
**Fix:** Either remove the "Notes" field from the modal until the backend stores it, or update the backend's UPDATE to append notes separately:
```sql
cancelled_reason = $2, notes = CASE
    WHEN $3 IS NOT NULL THEN COALESCE(notes, '') || ' | ' || $3
    ELSE notes END
```
(Requires adding a `cancelled_reason` column to `transactions`.)

### 5. VAT rate is hardcoded as "7.5%" in the Summary section of `TransactionDetailPanel`
**Where:** `src/features/transactions/TransactionDetailPanel.jsx` — `SummaryLine` for tax  
**What:** `<SummaryLine label="VAT (7.5%)" value={formatCurrency(tax)} />`. The Nigeria-standard 7.5% is baked into the label. If a store has a different tax category, zero-rated items, or the VAT rate is changed by regulation, the label will be factually wrong while the actual `tax_amount` value shown may be correct. A store owner seeing "VAT (7.5%): ₦500" on a ₦4,000 subtotal will do the math and lose trust in the system.  
**Fix:** Compute the displayed rate from the transaction data:
```js
const vatRate = subtotal > 0 ? ((tax / subtotal) * 100).toFixed(1) : "—";
// label="VAT ({vatRate}%)"
```
Or store the effective VAT rate on the `transactions` record.

### 6. `PartialRefundModal` calculates `refundTotal` using `line_total / quantity` — breaks for discounted items
**Where:** `src/features/transactions/TransactionDetailPanel.jsx` — `PartialRefundModal`, `useMemo` for `refundTotal`  
**What:**
```js
const unitPrice = parseFloat(item.line_total) / parseFloat(item.quantity);
total += unitPrice * s.quantity;
```
`item.line_total` already has the per-line discount applied (`unit_price * quantity - discount`). Dividing by quantity gives an average discounted unit price. For a line of 4 units at ₦100 with ₦50 discount (`line_total = ₦350`), unit refund price = ₦87.50. Refunding 2 units shows ₦175. This is correct numerically but inconsistent with how the backend calculates the refund (`line_total / quantity * qty`). However it means the displayed refund total in the modal may not match what the backend actually refunds if rounding differs at the decimal level.  
**Suggestion:** Use `item.unit_price` directly from the payload and compute the proportional discount separately, or rely on the backend calculation result displayed after success rather than a pre-computed frontend estimate.

### 7. Tab counts in `TransactionsPanel` diverge from tab filter results for partially refunded transactions
**Where:** `src/features/transactions/TransactionsPanel.jsx` — `tabCounts` memo and `STATUS_TABS`  
**What:** `stats.refunded` counts `t.status IN ('refunded', 'partially_refunded')`. But the "Refunded" tab passes `status = 'refunded'` to the query, which filters `t.status = 'refunded'` only. Partially refunded transactions (with `status = 'completed'`, `payment_status = 'partially_refunded'`) appear in "Completed" tab results but not in "Refunded" tab results — yet they are counted in the "Refunded" tab badge. A user sees "Refunded: 5" in the badge, clicks the tab, and sees 2 results. The 3 missing are partial refunds shown under "Completed".  
**Fix:** Either add a "Partially Refunded" tab (filtering `payment_status = 'partially_refunded'`), or update the stats query to count them separately and adjust tab counts to match what each tab actually filters.

### 8. `TransactionDetailPanel` has no error boundary — unhandled `useQuery` throws crash the whole page
**Where:** `src/features/transactions/TransactionDetailPanel.jsx`  
**What:** The `error || !tx` check handles query errors returned as values, but if `useTransaction` or `useQuery` throw an exception (e.g., network error during render, corrupt response parsing), there is no `ErrorBoundary` wrapper. The entire `TransactionDetailPage` unmounts and the user sees a blank white screen with a React error.  
**Fix:** Wrap `TransactionDetailPage` (or `TransactionDetailPanel`) in an `ErrorBoundary` that shows a "Something went wrong — go back to Transactions" fallback with a retry button.

### 9. `clearFilters` in `TransactionsPanel` does not clear the `Input` field visually
**Where:** `src/features/transactions/TransactionsPanel.jsx` — `FilterBar`, the `Input` component  
**What:** The `Input` has `key={search}` and `defaultValue={search}` — it is uncontrolled. When `clearFilters` calls `setUrlSearch("")`, `search` becomes `""`, and the `key` changes from the old search term to `""`, which remounts the input and resets its value. This works correctly. However, the `debounceTimer.current` is cleared in `clearFilters`, which is correct. But `setPage(1)` is called in `clearFilters` even though `setDateFrom`/`setDateTo` are state — if these trigger a re-render before `setPage(1)` lands, there may be a brief flash of page N with no filters. Minor but observable on slow machines.  
**Note:** This is a minor UX issue. The input does visually reset correctly due to the key-remount pattern. Main concern is the state batching order.

### 10. `TransactionsPanel` exposes no cashier or customer filter controls despite backend support
**Where:** `src/features/transactions/TransactionsPanel.jsx`  
**What:** `useTransactions` accepts `cashierId` and `customerId` filter params, and the backend supports `cashier_id` and `customer_id` in `TransactionFilters`. But the `TransactionsPanel` UI has no way for a manager to filter by cashier or for a customer service rep to filter by customer. These are high-value filters in a production POS.  
**Fix:** Add a cashier dropdown (populated via `getUsers({ store_id, role: 'cashier' })`) and a customer search autocomplete to the filter bar, visible to users with `transactions.read` permission.

---

## FRONTEND UPGRADES (should improve)

### 1. Stat cards show all-time totals regardless of active date/status filters
`useTransactionStats()` is called unconditionally with no date range parameters. The "Total Transactions: 48,293" stat card reflects all-time data while the table below is filtered to "This Week". A manager filtering to see today's refunds sees the card says "Refunded: 847" (all time) while the table shows 2 refunds today. The cards should either always reflect the current filter context or be clearly labeled "All Time".

### 2. No cashier filter for global users in `TransactionsPanel`
Global users (managers, admins) can view all cashiers' transactions but cannot isolate one cashier's sales. The backend fully supports `cashier_id` filtering. Add a cashier select dropdown visible only to users where `useAuthStore(s => s.user?.is_global)` is true.

### 3. No bulk export (CSV/PDF) for transaction history
Accountants and store owners regularly need to export transaction data for reconciliation. The table has no "Export" button. Add a CSV export that calls `getTransactions({ ...currentFilters, limit: 10000, page: 1 })` and streams to a CSV download, or a dedicated export command that generates a CSV server-side.

### 4. Receipt reprint on `TransactionDetailPanel` has no success feedback
`handleReprint` calls `print(tx?.id)` and only shows an error toast on failure. On success, the button returns to normal state with no toast or visual confirmation. If printing is asynchronous (print dialog opens in the OS), the cashier has no confirmation that the print job was sent.  
**Fix:** Add `toast.success("Receipt sent to printer")` after `await print(tx?.id)`.

### 5. `TransactionDetailPanel` Items table has no sub-total column for partially refunded lines
When a transaction has had some items partially refunded, the items table still shows full quantities and full line totals with no indication of what was returned. The `returnedQtyMap` is loaded (once Bug #1 is fixed) but never rendered in the table. Show a "Returned" sub-row or a "Net" column for partially refunded transactions.

### 6. No "Transaction not found" route guard — `TransactionDetailPage` renders `isLoading` → error with no breadcrumb
If a user navigates directly to `/transactions/99999` (nonexistent ID), `isLoading` is true momentarily then `error` is set. The error state renders an `EmptyState` with a "Back to Transactions" button — but the `PageHeader` is not rendered (it's after the error guard). There is no breadcrumb or page title during the loading phase or the error state, making the page feel context-less.  
**Fix:** Render a skeleton `PageHeader` with a placeholder title during `isLoading`, and keep `PageHeader title="Transaction Not Found"` in the error branch.

### 7. `TransactionsPanel` table column sorting is declared as `sortable: true` but no sort state is managed
The `DataTable` `columns` array marks `reference_no`, `created_at`, and `total_amount` as `sortable: true`. The `DataTable` shared component presumably renders sort-click UI. But `TransactionsPanel` has no `orderBy` / `sortDir` state, and `useTransactions` doesn't accept sort parameters (the backend always uses `ORDER BY t.created_at DESC`). Clicking a sortable column header does nothing to the data.  
**Fix:** Either set `sortable: false` on all columns until sort is implemented, or add `orderBy` / `sortDir` state to `TransactionsPanel` and pass them to `useTransactions`, and add the sort clause to the backend query.

### 8. `TransactionDetailPanel` Summary section shows payment breakdown from `salePayments` but falls back to `tx.payment_method` when `salePayments` is empty — no payment details for credit/wallet transactions
**Where:** `src/features/transactions/TransactionDetailPanel.jsx` — the "Summary" section  
**What:** For credit and wallet transactions, the `payments` array contains no sale-side entries (only negative refund entries or none at all). The fallback `tendered != null` branch shows `formatCurrency(tendered)` but `tx.amount_tendered` is `null` for credit sales (since `change_amount = null` too). So the "paid via" line is blank for credit transactions. The cashier sees "Total: ₦10,000" with no payment method row — it looks like the summary is missing data.  
**Fix:** Add an explicit branch for credit and wallet:
```js
{tx.payment_method === "credit" && (
  <SummaryLine label="Credit (unpaid)" value={formatCurrency(total)} accent="warning" />
)}
{tx.payment_method === "wallet" && (
  <SummaryLine label="Wallet deducted" value={formatCurrency(total)} accent="primary" />
)}
```

### 9. `FilterBar` date range calendar has no "Last 3 months" or "Last year" preset
The quick presets are: Today, Yesterday, This week, This month, Last 30 days. For a manager reviewing quarterly refunds or doing annual audit searches, there are no longer-horizon presets. Add "Last 3 months" and "This year":
```js
{ label: "Last 3 months", fn: () => { const now = new Date(); const start = new Date(); start.setMonth(now.getMonth() - 3); onDateRangeChange(toIso(start), toIso(now)); setCalOpen(false); }},
{ label: "This year",     fn: () => { const now = new Date(); const start = new Date(now.getFullYear(), 0, 1); onDateRangeChange(toIso(start), toIso(now)); setCalOpen(false); }},
```

### 10. `TransactionDetailPanel` "Actions" section shows "Transaction finalised — no further actions" for voided transactions but void already allows no actions
**Where:** `src/features/transactions/TransactionDetailPanel.jsx`  
**What:** The condition `!isVoidable && !isRefundable && !isFullyRefundable` is true for voided and refunded transactions. The check correctly shows the "finalised" message. However, for voided transactions, "Print Receipt" still renders above the actions panel via the header. Printing a receipt for a voided transaction is confusing — the printed receipt would look identical to a completed sale receipt.  
**Fix:** Disable (or hide) the "Print Receipt" button and `ActionButton` when `tx.status === "voided"`. Or add a clear "VOID" watermark in the receipt output for voided transactions.

---

## FRONTEND FEATURES (add for completeness)

### 1. No KPI stat card for "Average Sale Value" or "Largest Sale Today"
The four current stat cards (Total, Today's Revenue, Voided, Refunded) are useful but miss key performance indicators. A store owner wants to see average basket size and the day's top sale at a glance. Add a fifth card "Avg. Sale Value" (`todayRevenue / todayCount` or a dedicated backend field) and a "Top Sale Today" card (requires a backend aggregate).

### 2. No "Cashier Performance" breakdown on the list page
Store managers need to see which cashier processed the most sales or the highest revenue. There is no cashier-group-by view on the transactions page. Add a toggleable "By Cashier" sub-panel or a sortable cashier column with a group-by mode.

### 3. No transaction timeline / activity log on `TransactionDetailPanel`
The detail page shows what the transaction is but not its lifecycle history: when it was created, who printed the receipt, when a refund was processed, when it was voided. An audit trail of events for the transaction is missing. Add a collapsible "Activity" section that renders timestamped events from the `audit_logs` table filtered by `entity_type = 'transaction' AND entity_id = id`.

### 4. No inline quick-void action from the transactions list
A manager reviewing the list can only void from the detail page (two navigations: click row → navigate to detail → click Void). For obvious duplicate or erroneous transactions, a row-level "..." action menu with "Void" (inline, with a confirmation dialog) would save significant time in high-volume environments.

### 5. No PDF or print view for transaction detail
There is no "Print Detail" button that produces a formatted A4 or thermal-width summary of the transaction (reference, items, totals, cashier, customer, notes). The "Print Receipt" button reprints a customer receipt, not a management summary. Managers need a printable audit-quality transaction record for dispute resolution or accounting.

### 6. No transaction comparison or side-by-side view
When investigating a suspected duplicate transaction (same customer, same amount, same day), there is no way to compare two transactions side-by-side in the UI. Add a "Compare with another transaction" action on the detail page that opens a split-view modal.

### 7. Missing "customer transaction history" quick link from the list
When a customer row is clicked in the table, it links to `/customers/:id`. But there is no reverse quick-link from the transactions list to filter by that customer. If a manager clicks a customer name in row 14, they go to the customer profile. Coming back resets all filters. Add a "Filter by this customer" tooltip action on the customer name in the list table.

### 8. No bulk void or bulk refund capability
Managers dealing with a batch error (e.g., wrong price applied to 30 transactions from 9–10 AM) must void each transaction individually. Add a multi-select checkbox column to the transaction table with a "Bulk Void Selected" action, gated on `transactions.void` permission and limited to completed same-day transactions. The backend would need a `bulk_void_transactions` command.

### 9. No payment-method breakdown widget on the transactions page
There are no stat cards or charts showing how much revenue came from Cash vs Card vs Mobile Money vs Credit for the current filter period. This is essential for end-of-day cash drawer balancing. Add a payment method breakdown bar or pie widget above the table (data from a future `get_transaction_payment_breakdown` backend command).

### 10. No "Suspicious Transaction" flag or annotation capability
There is no way for a manager to flag a transaction as suspicious, disputed, or under investigation. Moderation workflows in other POS systems include a flag/annotation system that attaches notes to a transaction without modifying financial data. Add a `transaction_flags` table and a "Flag Transaction" action in the detail panel, visible to `manager` and above.

---

## CROSS-CUTTING RISKS

### 1. Multi-store isolation — `get_transaction` and `get_transaction_stats` do not enforce store_id for non-global users
`get_transaction(id)` fetches any transaction by `id` with no store scope check. A cashier from Store A who knows a transaction ID from Store B can call `get_transaction(store_b_tx_id)` and read the full details — customer name, items, amounts, cashier name. The backend's `fetch_transaction` helper has no `store_id` filter. Similarly, `get_transaction_stats(store_id: None)` returns stats across all stores for any authenticated user.  
**Fix:** Add store scope enforcement:
```rust
// In fetch_transaction, after fetching:
if !claims.is_global {
    let user_store = claims.store_id.ok_or(AppError::Forbidden)?;
    if tx.store_id != user_store {
        return Err(AppError::Forbidden);
    }
}
// In get_transaction_stats:
let effective_store_id = if claims.is_global { store_id } else { claims.store_id };
```

### 2. Security — `void_transaction` permission check does not validate role hierarchy for high-value transactions
`guard_permission(&state, &token, "transactions.void")` grants void rights to anyone with the `transactions.void` permission. A `cashier` role may have this permission assigned. Cashiers should generally not be able to void their own high-value transactions without manager oversight. The `max_void_amount` in `store_settings` provides some protection but defaults to `None` (no limit). Until stores explicitly configure a max, cashiers can void any-sized transaction. Recommend defaulting `max_void_amount` to `50000.0` (₦50,000) in the seeding migration and requiring `transactions.void_unlimited` for higher amounts.

### 3. Security — `hold_transaction` uses `guard()` (auth only), not `guard_permission()` (permission check)
`hold_transaction` and `get_held_transactions` use `guard(&state, &token)` which only verifies the JWT is valid and not expired. Any authenticated user — including read-only roles — can hold and retrieve held transactions. If a read-only reporting user's JWT is compromised, they can inject held transactions. Use `guard_permission(&state, &token, "pos.sale")` to restrict hold operations to POS-capable roles.

### 4. Data consistency — `transactions.total_amount` and `subtotal + tax_amount - discount_amount` can diverge after partial refunds
After a partial refund, `transactions.total_amount` still reflects the original sale amount, while the returned amount is tracked in `returns.total_amount`. There is no `net_amount_after_refunds` field on `transactions`. Any query that sums `transactions.total_amount` (e.g., analytics, shift totals) includes the full pre-refund amount. Revenue figures will be overstated by the sum of all partial refund amounts. Consider adding a stored `refunded_amount` column updated on each refund, so net revenue = `total_amount - refunded_amount`.

### 5. Data consistency — `shifts.total_sales` is incremented by `create_transaction` but never decremented by `void_transaction` or `full_refund`
`void_transaction` updates `shifts.return_count` and `shifts.total_returns` but does NOT subtract from `shifts.total_sales`. After voiding a ₦5,000 sale, the shift still shows total_sales as ₦5,000 higher than actual. The shift summary's `expected_cash` calculation will be inflated for every void. Same applies to `full_refund`. The `CloseShiftModal` cashier reconciliation will show an incorrect expected cash figure.  
**Fix:** In `void_transaction`, inside `db_tx`:
```rust
sqlx::query!(
    "UPDATE shifts SET total_sales = GREATEST(0, total_sales - $1), updated_at = NOW()
     WHERE opened_by = $2 AND store_id = $3 AND status IN ('open','active','suspended')",
    tx.total_amount, claims.user_id, tx.store_id,
).execute(&mut *db_tx).await.ok();
```
Apply the same for the relevant payment method columns (`total_cash_sales`, etc.).

### 6. Offline resilience — optimistic `staleTime: 60_000` on transactions list means cashiers see stale data during high-volume periods
`useTransactions` sets `staleTime: 60 * 1000`. In a busy store with a shared terminal or two cashiers on the same shift, new transactions made in the last 60 seconds won't appear in another cashier's transaction list until the cache expires. A manager reviewing transactions in real-time may miss recent sales. Reduce `staleTime` to `15_000` for the list query, or add a manual "Refresh" button that calls `invalidateAll()`.

### 7. Offline resilience — `useTransactionStats` staleTime means the dashboard KPI cards are 60 seconds stale
Similarly, `useTransactionStats` has `staleTime: 60 * 1000`. "Today's Revenue" on the stat card can be up to 1 minute behind actual revenue. In a high-traffic period (lunch rush), a store owner checking revenue sees a number ₦50,000 below actual. Add `refetchInterval: 30_000` for the stats query alongside the existing `staleTime`.

---

## PRIORITY ORDER

These are the top 5 items that MUST be addressed before this module is production-ready, ordered by severity:

1. **[BACKEND FAULT #1] `item_history` INSERT column mismatch in void, partial refund, and full refund** — Every void and every refund will fail at runtime with a PostgreSQL column-not-found error. The stock IS updated before the fatal INSERT (since the item_history INSERT happens after), then the whole DB transaction rolls back — leaving the transaction un-voided, stock un-restored, and the cashier with a 500 error for every refund attempt. This is a P0 data-integrity and availability failure. Fix is mechanical — unify the `item_history` INSERT schema across all three functions.

2. **[CROSS-CUTTING RISK #5] `shifts.total_sales` is never decremented on void or full refund** — Every voided or fully refunded sale inflates the shift's `total_sales` permanently. A cashier closing their shift at end of day will be shown an expected cash figure that is higher than reality by the sum of all their voided transactions. They will appear to have a cash shortage they don't have. This directly corrupts the shift reconciliation workflow, which is the most financially sensitive operation in the POS system.

3. **[BACKEND FAULT #4] Void and full refund do not restore credit balances or wallet balances** — A credit sale that is voided leaves the customer's `outstanding_balance` permanently inflated and the `credit_sales` record as 'open'. The customer is still expected to pay for a sale that no longer exists. This will surface immediately in production for any store that uses credit sales and will require manual DB intervention to repair each occurrence.

4. **[BACKEND FAULT #11] Voids and refunds are never queued for cloud sync** — The Supabase cloud replica never learns about voids or refunds. The cloud always shows the transaction as 'completed'. Any cloud-based reporting, multi-store analytics dashboard, or Supabase-driven backup will show inflated revenue and incorrect transaction statuses. Given that cloud sync is a core feature of the platform (bidirectional sync via `sync_queue`), this is a silent data corruption issue that worsens with every void processed.

5. **[BACKEND FAULT #3 + FRONTEND FAULT #1] Partial refund over-return allowed by missing quantity check, combined with `isPartiallyRefunded` always being `false`** — The backend allows returning more units than were sold (if previous partial returns exist) because already-returned quantities are never deducted from the returnable quantity. Simultaneously, the frontend never loads `returnedQtyMap` (because `isPartiallyRefunded` always evaluates to `false`), so the partial refund modal shows full original quantities as available. A cashier can unknowingly over-refund and over-restock items, corrupting inventory counts and creating negative financial entries. Both the backend guard and the frontend display must be fixed together.
