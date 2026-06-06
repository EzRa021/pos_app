# Quantum POS — Production Audit: Returns Module

**Audited:** 2026-04-26  
**Scope:** `src-tauri/src/commands/returns.rs`, `src/features/returns/useReturns.js`, `src/features/returns/ReturnsPanel.jsx`, `src/features/returns/ReturnDetailPanel.jsx`, `src/features/returns/InitiateReturnModal.jsx`, `src/pages/ReturnsPage.jsx`, `src/pages/ReturnDetailPage.jsx`, `src/commands/returns.js`.

---

## BACKEND FAULTS (must fix before production)

### 1. `void_return` silently swallows DB error on `orig_total` fetch — corrupts transaction status
**Where:** `src-tauri/src/commands/returns.rs` — `void_return()`, the `orig_total` query  
**What:**
```rust
let orig_total: Decimal = sqlx::query_scalar!(
    "SELECT total_amount FROM transactions WHERE id = $1",
    ret.original_tx_id
)
.fetch_one(&mut *db_tx)
.await
.unwrap_or(Decimal::ZERO);  // ← silent swallow
```
`.unwrap_or(Decimal::ZERO)` suppresses any DB error. If the query fails (connection issue, mid-migration schema change), `orig_total = 0`. The condition immediately after — `remaining_returned >= orig_total` — then evaluates to `something >= 0`, which is always true. The restored transaction status becomes `"refunded"` regardless of how many actual returns still exist. A voided return on a ₦50,000 transaction with ₦10,000 already refunded can silently mark the original transaction as fully refunded, making it look like the customer has been fully compensated when they haven't.  
**Fix:**
```rust
let orig_total: Decimal = sqlx::query_scalar!(
    "SELECT total_amount FROM transactions WHERE id = $1",
    ret.original_tx_id
)
.fetch_one(&mut *db_tx)
.await
.map_err(AppError::from)?;
```
Use `?` and let the error propagate. The DB transaction will roll back cleanly.

### 2. `fetch_return` uses INNER JOIN on `users` — deactivated cashiers make valid returns invisible
**Where:** `src-tauri/src/commands/returns.rs` — `fetch_return()` helper  
**What:**
```sql
JOIN users u ON u.id = r.cashier_id
```
This is an inner join. If the cashier who processed the return has since been deactivated (soft-deleted from the `users` table), this JOIN returns no rows. `fetch_return` then returns `AppError::NotFound("Return {id} not found")`. Any attempt to view, void, or audit a historical return processed by a former employee results in a spurious 404. The return exists in the DB but is invisible to the system.  
**Fix:** Change to a `LEFT JOIN`:
```sql
LEFT JOIN users u ON u.id = r.cashier_id
```
And handle `NULL` cashier_name gracefully (already done via `CONCAT(u.first_name, ' ', u.last_name)` which returns `' '` on NULL, which can be coalesced to `"Unknown"` if needed).

### 3. `create_return` stores incorrect `restocked` value — records intent rather than actual action
**Where:** `src-tauri/src/commands/returns.rs` — `create_return()`, Pass 2 item insert  
**What:** The `return_items` INSERT uses `vi.restock` as the value of the `restocked` column:
```rust
sqlx::query!(
    r#"INSERT INTO return_items (..., restocked, ...) VALUES (..., $9, ...)"#,
    ...
    vi.restock,   // ← cashier's intent, NOT whether stock was actually updated
    ...
)
```
However, the actual stock UPDATE only runs when `vi.restock && vi.condition == "good"`. A cashier can submit `restock: true` for a "damaged" item. The DB stores `restocked = true` even though stock was never incremented. On void, the check `item.restocked && item.condition == "good"` correctly skips the reversal (no double-removal), but the `restocked = true` flag in `return_items` is factually wrong. The `ReturnDetailPanel` `RestockIndicator` component reads `item.restocked` and shows "Restocked" for a damaged item, misleading store owners checking inventory.  
**Fix:** Store the actual result, not the intent:
```rust
let actually_restocked = vi.restock && vi.condition == "good";
sqlx::query!(
    r#"INSERT INTO return_items (..., restocked, ...) VALUES (..., $9, ...)"#,
    ...
    actually_restocked,
    ...
)
```

### 4. `void_return` stock reversal can push inventory negative without any guard
**Where:** `src-tauri/src/commands/returns.rs` — `void_return()`, the stock reversal loop  
**What:**
```rust
sqlx::query!(
    "UPDATE item_stock
     SET quantity = quantity - $1, available_quantity = available_quantity - $1 ...
     WHERE item_id = $2 AND store_id = $3",
    item.quantity_returned, item.item_id, ret.store_id,
)
```
No check is made that `available_quantity >= item.quantity_returned` before the deduction. Between the time the return was created (stock was added) and the void (stock is removed), another sale could have legitimately depleted that stock. Voiding the return would push `available_quantity` below zero for items where `allow_negative_stock = false`, corrupting inventory counts.  
**Fix:**
```rust
// Fetch the allow_negative_stock flag inside db_tx
let allow_neg: bool = sqlx::query_scalar!(
    "SELECT allow_negative_stock FROM item_settings WHERE item_id = $1",
    item.item_id
)
.fetch_optional(&mut *db_tx).await?.unwrap_or(false);

let current_qty: Decimal = sqlx::query_scalar!(
    "SELECT available_quantity FROM item_stock WHERE item_id = $1 AND store_id = $2 FOR UPDATE",
    item.item_id, ret.store_id
)
.fetch_optional(&mut *db_tx).await?.unwrap_or(Decimal::ZERO);

if !allow_neg && current_qty < item.quantity_returned {
    return Err(AppError::Validation(format!(
        "Cannot void return: stock for '{}' has already been depleted (available: {}, required: {}). \
         Adjust inventory manually before voiding.",
        item.item_name, current_qty, item.quantity_returned
    )));
}
```

### 5. `get_returns` date_to filter is off-by-one — returns on the last selected day are excluded
**Where:** `src-tauri/src/commands/returns.rs` — `get_returns()`, the date filter  
**What:**
```sql
AND ($7::text IS NULL OR r.created_at <= $7::timestamptz)
```
When `$7 = "2026-04-25"`, PostgreSQL casts this to `"2026-04-25T00:00:00Z"`. Any return processed on April 25 after midnight UTC is excluded. The transactions module correctly uses `< (date + INTERVAL '1 day')`. Also, the `::timestamptz` cast on a plain date string uses the server's timezone, not the store's local timezone.  
**Fix:**
```sql
AND ($7::text IS NULL OR r.created_at < ($7::text::date + INTERVAL '1 day')::timestamptz)
```
Consistent with how the transactions module handles the same filter.

### 6. `create_return` generates the reference number outside the DB transaction
**Where:** `src-tauri/src/commands/returns.rs` — `create_return()`, before `pool.begin()`  
**What:**
```rust
let ref_no = next_ret_ref_no(&pool, orig.store_id, &ret_slug).await;
```
`next_ret_ref_no` runs against `&pool` before `let mut db_tx = pool.begin().await?`. If the subsequent transaction fails for any reason (validation error, DB constraint, connection drop), the sequence counter has been consumed and a gap appears in return reference numbers. Also `ret_store_row` is fetched from `&pool` outside the transaction, which could race if `stores` is updated concurrently.  
**Fix:** Generate the reference number inside `db_tx`:
```rust
let mut db_tx = pool.begin().await?;
// ... validation ...
let ref_no = next_ret_ref_no(&mut *db_tx, orig.store_id, &ret_slug).await;
```
Alternatively, use a PostgreSQL sequence per store that auto-rolls back on transaction abort.

### 7. `create_return` does not update the shift's return counters
**Where:** `src-tauri/src/commands/returns.rs` — `create_return()`, after `db_tx.commit()`  
**What:** The `create_return` command commits a return without updating the active shift's `return_count` or `total_returns`. In contrast, `partial_refund` in `transactions.rs` explicitly does:
```rust
sqlx::query!(
    "UPDATE shifts SET return_count = COALESCE(return_count, 0) + 1,
     total_returns = COALESCE(total_returns, 0) + $1 ...
     WHERE opened_by = $2 AND store_id = $3 AND status IN ('open','active','suspended')",
    total_refund, claims.user_id, tx.store_id,
)
```
Returns processed via the Returns module (through `InitiateReturnModal`) never update the shift. The cashier's shift-end report will undercount returns if any were processed through this path, causing incorrect expected-cash calculations.  
**Fix:** Add the same shift update to `create_return`, inside `db_tx`, after all items are processed:
```rust
sqlx::query!(
    "UPDATE shifts SET
         return_count  = COALESCE(return_count,  0) + 1,
         total_returns = COALESCE(total_returns, 0) + $1,
         updated_at    = NOW()
     WHERE opened_by = $2 AND store_id = $3
       AND status IN ('open', 'active', 'suspended')",
    total_amount, claims.user_id, orig.store_id,
)
.execute(&mut *db_tx).await.ok(); // non-fatal
```

### 8. `create_return` `store_credit` refund method has no implementation — wallet is never credited
**Where:** `src-tauri/src/commands/returns.rs` — `create_return()`, after `db_tx.commit()`  
**What:** `store_credit` is a valid, accepted refund method:
```rust
let valid_methods = ["cash", "card", "transfer", "original_method", "store_credit"];
```
But there is no code path in `create_return` that credits the customer's `wallet_balance` when `refund_method == "store_credit"`. The return completes successfully, shows "Refund Method: Store Credit" on the detail page, but the customer's wallet is never updated. A cashier telling the customer "your ₦5,000 has been added to your wallet" would be wrong — the money is nowhere.  
**Fix:** Inside `db_tx`, after the return header INSERT, add:
```rust
if payload.refund_method == "store_credit" {
    if let Some(customer_id) = orig.customer_id {
        sqlx::query!(
            "UPDATE customers SET wallet_balance = COALESCE(wallet_balance, 0) + $1,
             updated_at = NOW() WHERE id = $2",
            total_amount, customer_id,
        ).execute(&mut *db_tx).await?;
        sqlx::query!(
            r#"INSERT INTO customer_wallet_transactions
               (customer_id, store_id, type, amount, balance_after,
                return_id, recorded_by, notes)
               VALUES ($1,$2,'credit',$3,
                   (SELECT wallet_balance FROM customers WHERE id = $1),
                   $4,$5,'Store credit from return')"#,
            customer_id, orig.store_id, total_amount, return_id, claims.user_id,
        ).execute(&mut *db_tx).await?;
    } else {
        return Err(AppError::Validation(
            "Store credit refunds require an associated customer".into()
        ));
    }
}
```

### 9. `create_return` item validation queries run in a loop inside the DB transaction — N+1 under write lock
**Where:** `src-tauri/src/commands/returns.rs` — `create_return()`, Pass 1 validation loop  
**What:** For each item in the return payload, two separate queries run inside `db_tx`:
1. `SELECT ... FROM transaction_items JOIN items LEFT JOIN item_settings WHERE tx_id = $1 AND item_id = $2`
2. `SELECT COALESCE(SUM(ri.quantity_returned), 0) FROM return_items JOIN returns WHERE original_tx_id = $1 AND item_id = $2 AND status != 'voided'`

A return with 8 items runs 16 queries inside an open write transaction. Each query holds the transaction open longer, increasing lock contention on `transaction_items`, `return_items`, and `returns`. Under concurrent load, this can cause timeout or deadlock.  
**Fix:** Batch both lookups before the validation loop:
```rust
// Batch fetch all transaction_items for this tx
let tx_items_map: HashMap<Uuid, _> = sqlx::query!(
    "SELECT ti.item_id, ti.quantity, ti.unit_price, ... FROM transaction_items ti
     JOIN items i ON i.id = ti.item_id LEFT JOIN item_settings ist ON ist.item_id = ti.item_id
     WHERE ti.tx_id = $1",
    payload.original_tx_id,
).fetch_all(&mut *db_tx).await?
.into_iter().map(|r| (r.item_id, r)).collect();

// Batch fetch already-returned quantities for all item IDs
let item_ids: Vec<Uuid> = payload.items.iter().map(|i| i.item_id).collect();
let returned_map: HashMap<Uuid, Decimal> = sqlx::query!(
    "SELECT ri.item_id, COALESCE(SUM(ri.quantity_returned), 0) as qty
     FROM return_items ri JOIN returns r ON r.id = ri.return_id
     WHERE r.original_tx_id = $1 AND ri.item_id = ANY($2) AND r.status != 'voided'
     GROUP BY ri.item_id",
    payload.original_tx_id, &item_ids as &[Uuid],
).fetch_all(&mut *db_tx).await?
.into_iter().map(|r| (r.item_id, r.qty)).collect();
```

### 10. `void_return` fetches return items using `&pool` outside the DB transaction
**Where:** `src-tauri/src/commands/returns.rs` — `void_return()`, before `pool.begin()`  
**What:**
```rust
let items = fetch_return_items(&pool, id).await?;
let mut db_tx = pool.begin().await?;
```
Items are fetched outside the transaction. If a concurrent operation modifies `return_items` between this read and the stock reversal inside `db_tx`, wrong quantities could be reversed. While rare, stock-related operations should always read the data they act on within the same transaction to ensure a consistent snapshot.  
**Fix:** Move the `fetch_return_items` call inside `db_tx`:
```rust
let mut db_tx = pool.begin().await?;
let items = sqlx::query_as!(ReturnItem, "SELECT ... FROM return_items WHERE return_id = $1 ORDER BY id", id)
    .fetch_all(&mut *db_tx).await?;
```

### 11. `create_return` does not reduce `credit_sales.outstanding` or `customers.outstanding_balance` for credit transactions
**Where:** `src-tauri/src/commands/returns.rs` — `create_return()`, inside `db_tx`  
**What:** When the original transaction was a credit sale and items are returned, the customer's outstanding debt should decrease by the return amount. `create_return` updates the transaction status but never touches `credit_sales` or `customers.outstanding_balance`. After a ₦5,000 credit return, the credit module still shows the full ₦50,000 outstanding.  
**Fix:** Inside `db_tx`, add:
```rust
let orig_payment_method: Option<String> = sqlx::query_scalar!(
    "SELECT payment_method FROM transactions WHERE id = $1", payload.original_tx_id
).fetch_optional(&mut *db_tx).await?;

if orig_payment_method.as_deref() == Some("credit") {
    if let Some(customer_id) = orig.customer_id {
        sqlx::query!(
            "UPDATE credit_sales
             SET outstanding = GREATEST(0, outstanding - $1),
                 amount_paid = amount_paid + $1,
                 status = CASE WHEN GREATEST(0, outstanding - $1) = 0 THEN 'paid' ELSE status END
             WHERE transaction_id = $2",
            total_amount, payload.original_tx_id,
        ).execute(&mut *db_tx).await?;
        sqlx::query!(
            "UPDATE customers SET outstanding_balance = GREATEST(0, outstanding_balance - $1)
             WHERE id = $2",
            total_amount, customer_id,
        ).execute(&mut *db_tx).await?;
    }
}
```

---

## BACKEND UPGRADES (should improve)

### 1. `get_returns` WHERE clause is duplicated verbatim between count and data queries
Both the COUNT query and the data query repeat the same 8-condition WHERE clause. Any future filter change must be applied in two places. Extract into a CTE:
```sql
WITH filtered AS (
    SELECT r.* FROM returns r
    JOIN transactions t ON t.id = r.original_tx_id
    JOIN users u ON u.id = r.cashier_id
    LEFT JOIN customers c ON c.id = r.customer_id
    WHERE <shared conditions>
)
SELECT COUNT(*) FROM filtered;
-- then:
SELECT ... FROM filtered ORDER BY ... LIMIT $9 OFFSET $10;
```

### 2. Missing database indexes on heavily filtered columns
`get_returns` filters on `store_id`, `cashier_id`, `customer_id`, `status`, `return_type`, and `created_at`. `get_transaction_returns` filters on `original_tx_id`. None of these appear to have composite indexes on the `returns` table:
```sql
CREATE INDEX IF NOT EXISTS idx_returns_store_created
    ON returns(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_returns_original_tx_id
    ON returns(original_tx_id);
CREATE INDEX IF NOT EXISTS idx_returns_cashier
    ON returns(cashier_id, store_id);
CREATE INDEX IF NOT EXISTS idx_returns_customer
    ON returns(customer_id, store_id);
CREATE INDEX IF NOT EXISTS idx_returns_status
    ON returns(store_id, status);
```

### 3. `v_return_stats` view is queried but never validated to exist — silent startup failure risk
`get_return_stats` queries `FROM v_return_stats WHERE store_id = $1`. If the migration that creates this view didn't run, the command fails at runtime with `"relation v_return_stats does not exist"`. The `fetch_optional` with `unwrap_or(ReturnStats::default())` handles the no-row case, but not the missing-view case. Add a fallback inline query:
```rust
// If v_return_stats is missing, fall back to aggregate query:
let row = sqlx::query_as!(ReturnStats, "SELECT ... FROM v_return_stats WHERE store_id = $1", store_id)
    .fetch_optional(&pool).await
    .unwrap_or(None)
    .or_else(|| /* inline aggregate fallback */ );
```
Or verify the view exists as part of the app startup health check.

### 4. `get_return_stats` requires `store_id: i32` (non-optional) unlike `get_transaction_stats` which accepts `Option<i32>`
**Inconsistency:** Store owners with `is_global = true` can query transaction stats across all stores (`store_id: None`) but cannot query return stats across all stores. Add `Option<i32>` support to `get_return_stats` to match the transactions module's interface. The view query can use the same `$1::int IS NULL OR store_id = $1` pattern.

### 5. `get_returns` date filter does not validate input format before SQL cast
The inline `$6::timestamptz` and `$7::text::date` casts will produce a PostgreSQL error (surfaced as a generic 500) for malformed date strings. Validate before querying:
```rust
if let Some(ref df) = filters.date_from {
    df.parse::<chrono::NaiveDate>()
        .map_err(|_| AppError::Validation("Invalid date_from format. Expected YYYY-MM-DD".into()))?;
}
```

### 6. `create_return` `return_type` determination uses monetary comparison that can drift with rounding
`cumulative_returned >= orig.total_amount` compares `Decimal` totals. If proportional tax splitting (division of `tax_amount * qty / quantity`) produces tiny rounding residuals, `cumulative_returned` might be ₦0.01 less than `orig.total_amount` even when all items are returned, incorrectly classifying a full return as `"partial"`. Add a small epsilon tolerance or compare item-count instead:
```rust
let all_items_fully_returned = validated_items.iter().all(|vi| {
    let remaining = (orig_qty_for_item - already_returned_for_item - vi.qty_ret);
    remaining <= Decimal::ZERO
});
let return_type = if all_items_fully_returned { "full" } else { "partial" };
```

### 7. `void_return` `item_history` `quantity_before` subquery runs AFTER the stock UPDATE — reads stale data
**Where:** `void_return()`, the `item_history` INSERT in the restock reversal loop  
**What:**
```sql
(SELECT quantity + $4 FROM item_stock WHERE item_id = $1 AND store_id = $2)
```
This subquery runs AFTER `UPDATE item_stock SET quantity = quantity - $1`. Within the same transaction, this reads the post-update value and adds back `$4` to reconstruct "before." This is technically correct within a serializable transaction but fragile — the arithmetic reconstruction can produce wrong results if multiple updates to the same row happened within the same transaction batch. Capture `quantity_before` explicitly before the stock update:
```rust
let qty_before: Decimal = sqlx::query_scalar!(
    "SELECT quantity FROM item_stock WHERE item_id = $1 AND store_id = $2 FOR UPDATE",
    item.item_id, ret.store_id
).fetch_one(&mut *db_tx).await?;
// then UPDATE
// then INSERT item_history with explicit qty_before and qty_before - quantity_returned as qty_after
```

### 8. `search_returns` and `get_transaction_returned_quantities` are registered as `#[tauri::command]` but should also be documented as HTTP-RPC only
Both commands are registered as Tauri commands, but the frontend accesses them exclusively via `rpc()` (HTTP). The `unsafe std::mem::transmute` pattern from the transactions module has been removed here (good), but developers may not know these are accessible via `invoke()` too. Add a module-level comment noting which commands are available via both channels.

### 9. `create_return` `prior_returned` uses `.unwrap_or(Decimal::ZERO)` after `.await?` — redundant but inconsistent
```rust
.fetch_one(&mut *db_tx).await?
.unwrap_or(Decimal::ZERO);  // COALESCE already handles NULL
```
The `COALESCE(SUM(total_amount), 0)` in the SQL already ensures a non-NULL result. The `.unwrap_or` on the outer `Option<Decimal>` from `fetch_one` would only trigger if `fetch_one` returns `Ok(None)` (impossible with a `COALESCE`) or if `SUM` returns something unexpected. This is harmless but reflects misunderstanding of what `fetch_one` vs `fetch_optional` returns for aggregate queries. Use `fetch_one` with `?` and no `.unwrap_or`:
```rust
let prior_returned: Decimal = sqlx::query_scalar!("SELECT COALESCE(SUM(total_amount), 0) ...")
    .fetch_one(&mut *db_tx).await?;
```

### 10. `get_transaction_returns` returns all returns for a transaction with no pagination
`get_transaction_returns` returns every return for a given transaction via `fetch_all`. In normal usage this is small, but a frequently returned transaction (e.g., incorrect data entry repaired many times) could return dozens of rows. The `TransactionDetailPanel` uses this to show all linked returns. Add a `LIMIT 50` safeguard and log a warning if the limit is hit.

---

## BACKEND FEATURES (add for completeness)

### 1. No configurable return time-window policy
There is no check for a return window (e.g., "returns only within 30 days of sale"). A cashier can process a return on a 3-year-old transaction. Add a `return_window_days` field to `store_settings` (defaulting to `null` = no limit) and enforce it in `create_return`:
```rust
if let Some(window_days) = store_settings.return_window_days {
    let cutoff = Utc::now() - chrono::Duration::days(window_days as i64);
    if orig_created_at < cutoff {
        return Err(AppError::Validation(format!(
            "Returns are only allowed within {} days of the sale date.", window_days
        )));
    }
}
```

### 2. No return value cap enforcement
There is no `max_return_amount` setting (as there is `max_void_amount` for voids). A cashier can process a refund of any amount. Add a `max_return_amount` to `store_settings` and enforce it in `create_return`.

### 3. No audit trail entry on `void_return` for the stock reversal per item
`write_audit_log` is called after `void_return`, but only one entry is written for the whole void event. Individual stock reversals (which items were de-stocked, by how much) are recorded in `item_history` but not in the human-readable audit log. For financial compliance, each de-stocked item in a void should produce an audit entry or the single void entry should include a JSON summary of all affected items and quantities.

### 4. No event hook to reverse loyalty points earned from a returned transaction
When a return is completed, the customer may have earned loyalty points on the original transaction. Those points are not reversed. `earn_points_internal` is called post-sale; there is no `revoke_points_for_return` call in `create_return`. Add a proportional point reversal (non-fatal, post-commit) based on the return amount vs original amount.

### 5. No aggregate "returns by reason" analytics query
There is no backend command returning a breakdown of return counts by `reason`. This is essential for identifying systemic problems (e.g., a batch of defective goods causing a spike in "Defective product" returns). Add `get_return_reason_breakdown(store_id, date_from, date_to)` returning `{ reason, count, total_amount }[]`.

### 6. No return exchange capability (return + new sale in one atomic operation)
The system supports pure refunds only. A common POS workflow is "exchange" — the customer returns an item and immediately takes a replacement, with only the price difference changing hands. There is no `create_exchange` command that atomically voids a return item and applies it as a credit toward a new transaction.

### 7. No background cleanup of `returns` with `status = 'voided'` older than N days from active queries
Voided returns accumulate indefinitely and are included in all JOIN queries on `returns`. A `status != 'voided'` filter is correctly applied in aggregation queries, but the rows themselves are never archived. For a busy store, this grows the table and slows down JOINs. Consider an archival strategy or a `deleted_at` soft-delete column to move voided returns out of the hot path after 90 days.

### 8. `v_return_stats` view — unknown whether voided returns are correctly excluded from `total_refunded`
The view is referenced but its definition is not visible in this audit. If `total_refunded` includes voided returns, the stat is inflated. Verify and document the view definition with a migration comment. The `completed_count` and `voided_count` fields suggest the view distinguishes status, but `total_refunded` semantics must be confirmed.

### 9. No cloud sync queuing for `void_return` updates
`create_return` calls `crate::database::sync::queue_row(...)` to replicate to Supabase. `void_return` does not. After voiding, the cloud replica still shows the return as "completed." Add `queue_row` after `void_return`'s `db_tx.commit()` to replicate the status change, the `item_history` entries, and the transaction status restoration.

### 10. No notification raised when a return is voided
`create_return` does not push a notification. Neither does `void_return`. For stores with manager oversight, a void on a recently processed return should notify managers (similar to how `void_transaction` calls `push_notification`). Add a `push_notification` call after `void_return` completes, broadcast to managers for the affected store.

---

## FRONTEND FAULTS (must fix before production)

### 1. Barcode scanning in `InitiateReturnModal` is non-functional — `barcode` field does not exist on `TransactionItem`
**Where:** `src/features/returns/InitiateReturnModal.jsx` — `handleBarcodeSearch()`  
**What:**
```js
const match = txItems.find(
  (it) =>
    (it.barcode && it.barcode.toLowerCase() === query) ||
    (it.sku   && it.sku.toLowerCase()     === query)
);
```
`it.barcode` always evaluates to `undefined` because the `TransactionItem` model returned by the backend has no `barcode` field (the model only has `id`, `tx_id`, `item_id`, `item_name`, `sku`, `quantity`, `unit_price`, `discount`, `tax_amount`, `line_total`, `measurement_type`, `unit_type`). Barcode-based scanning silently falls through and only SKU matching works. A cashier with a barcode scanner pointing it at a product barcode will always see "Item not found in this transaction."  
**Fix (Option A — backend):** Add `barcode` to the `TransactionItem` model by JOINing `items` in `fetch_transaction_items`:
```sql
SELECT ti.*, i.barcode FROM transaction_items ti
JOIN items i ON i.id = ti.item_id
WHERE ti.tx_id = $1
```
**Fix (Option B — frontend):** Update the placeholder text to "Scan SKU or type SKU…" to match actual capability until the backend is updated.

### 2. `ReturnDetailPanel` `useVoidReturn` invalidates the wrong store's cache for global users
**Where:** `src/features/returns/useReturns.js` — `useVoidReturn()`  
**What:**
```js
const storeId = useBranchStore((s) => s.activeStore?.id);
// ...
onSuccess: (result) => {
    invalidateAfterReturn(storeId);  // ← uses active store, not return's store
}
```
`invalidateAfterReturn(storeId)` invalidates cache for the currently active store in the UI. A global admin with "active store = Store B" viewing a return from Store A (accessible via direct URL `/returns/42`) will void the return correctly on the backend, but `invalidateAfterReturn` clears Store B's cache instead of Store A's. Store A's return list will not refresh automatically, showing the stale "completed" status until the cache expires.  
**Fix:** Pass the return's actual `store_id` from the mutation result:
```js
onSuccess: (result) => {
    const affectedStoreId = result?.ret?.store_id ?? storeId;
    invalidateAfterReturn(affectedStoreId);
}
```

### 3. `ReturnDetailPanel` calls `invalidate()` redundantly after `voidMutation.mutateAsync` — `useVoidReturn.onSuccess` already invalidates
**Where:** `src/features/returns/ReturnDetailPanel.jsx` — `handleVoid()` function  
**What:**
```js
async function handleVoid(reason) {
    await voidMutation.mutateAsync({ id: parseInt(id, 10), reason });
    setVoidOpen(false);
    invalidate();  // ← fires AFTER onSuccess already invalidated
}
```
`useVoidReturn.onSuccess` already calls `qc.invalidateQueries({ queryKey: returnKey(result?.ret?.id) })` and `invalidateAfterReturn(storeId)`. Then `invalidate()` repeats `invalidateQueries(returnKey(id))`, `invalidateQueries(["returns"])`, and `invalidateQueries(["transactions"])`. This triggers duplicate network requests for all three query groups. While functionally harmless, it degrades performance and can cause double-flash of loading states.  
**Fix:** Remove the `invalidate()` call from `handleVoid`. The `onSuccess` handler in `useVoidReturn` is sufficient:
```js
async function handleVoid(reason) {
    await voidMutation.mutateAsync({ id: parseInt(id, 10), reason });
    setVoidOpen(false);
    // invalidation handled by useVoidReturn.onSuccess
}
```

### 4. `ReturnsPanel` passes `isLoading || isFetching` to `DataTable` — causes table skeleton on every background refetch
**Where:** `src/features/returns/ReturnsPanel.jsx` — `DataTable` props  
**What:**
```jsx
<DataTable
    isLoading={isLoading || isFetching}
    ...
/>
```
`isFetching` is true on every background refresh (e.g., navigating back to the page, window refocus). Using it as `isLoading` makes the table render a full skeleton on every refetch, even when cached data is available for immediate display. The standard pattern (used in `TransactionsPanel`) is `isLoading={isLoading}` for the skeleton, and a separate "Refreshing…" indicator for `isFetching`.  
**Fix:**
```jsx
<DataTable isLoading={isLoading} ... />
```
The "Refreshing…" text indicator already in the panel handles `isFetching` feedback.

### 5. `InitiateReturnModal` — item state initialization floors quantity for non-weighted items but `ItemRow.maxQty` does not
**Where:** `src/features/returns/InitiateReturnModal.jsx` — `useEffect` initialization and `ItemRow` component  
**What:** The modal initialization uses:
```js
const soldQty = isWeighted ? rawQty : Math.floor(rawQty);
```
But `ItemRow`'s `maxQty` uses `const maxQty = remaining` where `remaining = Math.max(0, soldQty - alreadyReturned)` and `soldQty = parseFloat(item.quantity ?? 1)` — no floor. For an integer-type item with a fractional value in the DB (e.g., `quantity = 3.000000001` from Decimal serialization), `initQty` would be 3 (floored) but `maxQty` would be 3.000000001. A user incrementing the return quantity past 3 would see a confusing fractional state in the display.  
**Fix:** Apply the floor consistently in `ItemRow`:
```js
const soldQty = item.measurement_type && item.measurement_type !== "quantity"
    ? parseFloat(item.quantity ?? 1)
    : Math.floor(parseFloat(item.quantity ?? 1));
```

### 6. `ReturnDetailPanel` Customer section shows no link to customer profile
**Where:** `src/features/returns/ReturnDetailPanel.jsx` — Customer section  
**What:** The customer card shows the customer's name and ID but no clickable link to `/customers/${ret.customer_id}`. This is inconsistent with `TransactionDetailPanel` which provides a profile link. A manager who wants to view a customer's return history must manually navigate.  
**Fix:**
```jsx
{ret.customer_id && (
  <Link to={`/customers/${ret.customer_id}`}
    className="flex items-center gap-1 text-[11px] text-primary hover:underline">
    View Profile <ArrowUpRight className="h-3 w-3" />
  </Link>
)}
```

### 7. `VoidReturnDialog` — void reason field is optional but dialog description says "This action cannot be undone" without requiring a reason — high-risk action
**Where:** `src/features/returns/ReturnDetailPanel.jsx` — `VoidReturnDialog`  
**What:** Voiding a return is a high-stakes action (stock is de-stocked, transaction status changes). The void reason field is optional. A cashier can void with no reason and no PIN confirmation (unlike the transaction void flow which requires a PIN). There is no secondary confirmation — one click on "Void Return" in the header, then one click "Void Return" in the dialog suffices.  
**Fix:** Require a reason (make the "Void Return" button disabled until `reason.trim().length > 0`) and consider adding a PIN confirmation matching the `VoidModal` in `TransactionDetailPanel`. At minimum:
```js
// In VoidReturnDialog
<Button onClick={handleConfirm} disabled={isLoading || !reason.trim()}>
```

### 8. `ReturnsPanel` search input does not reset page to 1 on search changes
**Where:** `src/features/returns/ReturnsPanel.jsx` — `Input onChange`  
**What:**
```jsx
<Input value={search} onChange={(e) => setSearch(e.target.value)} />
```
`setSearch` updates the URL param via `usePaginationParams` but does not call `setPage(1)`. If the user is on page 3 and types a search, the query runs with `page=3`. If the search narrows results to fewer than 3 pages, the user sees an empty table. The `TransactionsPanel` handles this by resetting page in the debounce callback.  
**Fix:**
```js
onChange={(e) => { setSearch(e.target.value); setPage(1); }}
```
Since `setSearch` already goes through `usePaginationParams`, verify if that hook resets page automatically on search change. If not, add explicit `setPage(1)`.

### 9. `InitiateReturnModal` — submitting with `store_credit` for a walk-in customer will succeed on frontend but fail on backend
**Where:** `src/features/returns/InitiateReturnModal.jsx` — `handleSubmit()` and `REFUND_METHODS`  
**What:** "Store Credit" is shown as a selectable refund method for all transactions, including walk-in (no customer) transactions. The backend will need to handle `store_credit` with no `customer_id` (once Fault #8 backend fix is applied). Until then, selecting "Store Credit" for a walk-in transaction will cause a backend error. The modal provides no client-side guard against this combination.  
**Fix:** Disable the "Store Credit" option when `transaction.customer_id` is null:
```jsx
{REFUND_METHODS.map((m) => (
  <SelectItem
    key={m.value}
    value={m.value}
    disabled={m.value === "store_credit" && !transaction?.customer_id}
  >
    {m.label}{m.value === "store_credit" && !transaction?.customer_id ? " (requires customer)" : ""}
  </SelectItem>
))}
```

### 10. `ReturnDetailPanel` has no error boundary — an unhandled `useReturn` exception crashes the whole page
**Where:** `src/features/returns/ReturnDetailPanel.jsx`  
**What:** The `error || !ret` guard handles query errors returned as values, but not exceptions thrown during query or render. If `useReturn` throws (corrupted response, JSON parse error), the whole `ReturnDetailPage` unmounts with a blank white screen and no recovery path.  
**Fix:** Wrap `ReturnDetailPage` (or `ReturnDetailPanel`) with an `ErrorBoundary` component that renders a "Something went wrong — go back to Returns" fallback with a retry button.

---

## FRONTEND UPGRADES (should improve)

### 1. No direct "Create Return" action from the Returns page
The `ReturnsPanel` has no "New Return" button. All returns must be initiated from a transaction's detail page. If a manager knows the transaction reference and wants to process a return quickly, they must navigate to Transactions → find transaction → click through to detail → click Return. Add a "New Return" button on `ReturnsPanel` that opens a transaction search modal to find and link the originating transaction.

### 2. `ReturnsPanel` table columns marked `sortable: true` but sort state is never managed
`total_amount` and `created_at` columns have `sortable: true` in the column definition, but no `orderBy`/`sortDir` state exists in `ReturnsPanel` and no sort parameters are passed to `useReturns`. Clicking these column headers does nothing. Either remove `sortable: true` from all columns (honest), or implement server-side sort by adding `order_by` / `sort_dir` to `ReturnFilters` and passing state from the panel.

### 3. `ReturnsPanel` stat cards show all-time totals regardless of date filter
`useReturnStats()` is called without date parameters. A manager who applies "This week" as a date filter expects the stat cards to reflect that week's data. The table shows filtered results but the cards (Total Returns: 1,240, Total Refunded: ₦892,000) show all-time numbers. Either add date parameters to `getReturnStats`/`useReturnStats`, or label the cards explicitly as "All Time" to set correct expectations.

### 4. No cashier filter exposed in `ReturnsPanel` filter bar despite backend support
`ReturnFilters` supports `cashier_id` filtering. The panel has no cashier dropdown. Store managers reviewing shift-end activity need to isolate one cashier's returns. Add a cashier select (same pattern as other modules).

### 5. `ReturnDetailPanel` void button appears twice — in header action bar and in sidebar — creating two independent triggers for the same dialog
Both the `PageHeader action` and the sidebar `Button` call `setVoidOpen(true)`. A user can open the void dialog from either location. This is redundant but not harmful. Remove the sidebar duplicate to reduce visual noise and consolidate the destructive action to the header where the `StatusBadge` and context are clearly visible.

### 6. `InitiateReturnModal` quantity display for decimal items shows raw float without measurement unit
The quantity stepper shows:
```jsx
<span className="w-8 text-center text-sm font-mono font-bold tabular-nums">{state.quantity}</span>
```
For a 2.5 kg item, the display shows `2.5` with no unit. The surrounding text `of {maxQty}` also has no unit. Use `formatQuantity` for consistency:
```jsx
{formatQuantity(state.quantity, item.measurement_type, item.unit_type)}
```

### 7. `ReturnsPanel` footer page-total is computed client-side from the current page only — misleading for paginated results
```js
const pageTotal = useMemo(
    () => returns.filter((r) => r.status !== "voided")
                 .reduce((s, r) => s + parseFloat(r.total_amount ?? 0), 0),
    [returns],
);
```
This is labeled as `formatCurrency(pageTotal)` in the footer. On a filtered result of 3 pages, the footer shows the sum of the current page only, not the total refunded for the filter. This misleads managers who expect the footer total to represent the full filtered period's refunds. Either:
- Remove the client-side total and show only the all-time `totalRefunded` stat from `useReturnStats`, or
- Add a `total_amount` aggregate to the backend's paginated response, or
- Label the footer clearly as "This page only."

### 8. No "Refund receipt" print capability from `ReturnDetailPanel`
There is no "Print Return Receipt" button. A customer receiving a refund should get a paper receipt confirming the refund amount, method, and reference. Managers also need a printable return summary for accounting sign-off.

### 9. `ReturnDetailPanel` "Reason & Notes" section is conditionally rendered and disappears when both `reason` and `notes` are null
```jsx
{(ret.reason || ret.notes) && (
    <Section title="Notes & Reason" icon={FileText}>
```
If a return was created without a reason (which the backend prevents, but could occur via old data or a migration), or if both are null, this section is entirely absent from the detail page. It gives no affordance for a manager to add a reason after the fact. At minimum, always render the section with an "No reason provided" placeholder.

### 10. `ReturnsPanel` no indicator for returns that voided inventory that's now below reorder level
After voiding a return that restocked items, those items may drop back below their `min_stock_level`. There's no visual indicator on the returns list or detail page that a void triggered low-stock. Consider adding a "Low stock affected" chip on the return row or detail page when any restocked items fell below reorder level after being de-stocked on void.

---

## FRONTEND FEATURES (add for completeness)

### 1. No KPI cards for "Today's Returns" and "Today's Refunded Amount"
The four stat cards (Total Returns, Full Returns, Partial Returns, Total Refunded) are all-time. Store managers need daily context — how many returns were processed today, and how much cash was refunded. Add two "Today" stat cards with date-scoped data (requires backend date filter on `get_return_stats`).

### 2. No CSV or PDF export from the Returns page
Accountants need to export returns data for monthly reconciliation. The `ReturnsPanel` has no export button. Add a "Export CSV" button that calls `getReturns({ ...currentFilters, limit: 5000, page: 1 })` and generates a browser-side CSV download.

### 3. No bulk void capability for managers handling batch errors
If a cashier accidentally creates 10 duplicate returns (e.g., double-click bug), each must be voided individually. Add multi-select checkboxes to the table and a "Bulk Void Selected" button gated on `transactions.refund` permission, backed by a future `bulk_void_returns` backend command.

### 4. No returns analytics breakdown by reason or by item
There is no visualization of why returns happen or which items are returned most. A "Return Reasons" pie chart and a "Most Returned Items" list would help store owners identify systemic issues (defective batches, mislabeled products, cashier errors).

### 5. No "Return Timeline" on `ReturnDetailPanel`
Similar to the transactions module's missing audit trail panel, there is no event history on the return detail page. Managers cannot see when the return was created, who viewed it, when it was voided, or any intermediate events. Add an activity feed at the bottom of the detail page reading from the `audit_logs` table.

### 6. No customer return history summary on the Return Detail panel
When a return is linked to a customer, there is no "This customer has made 4 returns totaling ₦12,000" summary visible on the return detail page. This is useful context for managers approving high-value refunds. Add a small "Customer Return History" callout in the Customer section when `ret.customer_id` is present.

### 7. No "Find Transaction" quick path from Returns list
The `ReturnsPanel` empty state says "Returns are created from a transaction's detail page." but provides no direct link or search to get to a transaction. Add a "Go to Transactions" button in the empty state that navigates to `/transactions`, and a "New Return" button in the page header that opens a transaction-search modal.

### 8. No filter by `refund_method` in `ReturnsPanel`
The backend `ReturnFilters` does not expose `refund_method` as a filter (not currently in the struct), but it would be useful to filter "show all cash refunds this week" for end-of-day reconciliation. Add a `refund_method` filter to both `ReturnFilters` in the backend and a dropdown in `ReturnsPanel`.

### 9. No return quantity summary in `ReturnsPanel` table row
The returns list shows the return amount but not the item count or a brief summary of what was returned (e.g., "3 items"). A manager scanning the list has to click into each return to understand its scope. Add a sub-row or tooltip with item count and top item name.

### 10. No "Exchange" shortcut in `InitiateReturnModal`
After a return is submitted, there is no prompt offering to open the POS with the return items pre-removed as a credit toward a new purchase. A common cashier flow is return-and-replace. The modal's `onSuccess` could offer a "Start Exchange Sale" button that navigates to the POS with the credit pre-applied.

---

## CROSS-CUTTING RISKS

### 1. Multi-store isolation — `get_return` and `get_transaction_returns` have no store_id enforcement
`get_return(id)` fetches any return by ID with no store scope check beyond what the Tauri permission system enforces. A cashier from Store A who knows a return ID from Store B can call `get_return(store_b_return_id)` and receive full return details — customer name, amounts, cashier, items. `get_transaction_returns(tx_id)` also has no store scope check. `fetch_return` uses INNER JOIN on `transactions` which implies the correct store, but there's no explicit `WHERE r.store_id = ?` guard for non-global users.  
**Fix:** Add store scope enforcement in both commands:
```rust
let ret = fetch_return(&pool, id).await?;
if !claims.is_global {
    let user_store = claims.store_id.ok_or(AppError::Forbidden)?;
    if ret.store_id != user_store {
        return Err(AppError::Forbidden);
    }
}
```

### 2. Security — `void_return` requires `transactions.refund` permission, but the `ReturnDetailPanel` shows the Void button to any authenticated user who can view the return
**Where:** `ReturnDetailPanel.jsx` — the `{!isVoided && <Button>Void Return</Button>}` condition  
**What:** The Void Return button is rendered for any user who can navigate to the return detail page, with no frontend permission check (`usePermission("transactions.refund")` is not called). A read-only store keeper who has `transactions.read` but not `transactions.refund` would see the Void button, click it, submit, and receive a backend 403. This creates a confusing UX (visible action that fails) and a minor security UI issue.  
**Fix:**
```js
const canRefund = usePermission("transactions.refund");
// then:
{!isVoided && canRefund && <Button onClick={() => setVoidOpen(true)}>Void Return</Button>}
```

### 3. Security — `create_return` uses `transactions.refund` permission, but `search_returns` and `get_transaction_returned_quantities` use only `transactions.read`
A user with `transactions.read` but not `transactions.refund` can query all return data, including returned quantities per item. For most roles this is acceptable (managers and above have both), but a cashier with view-only access should not be able to see the full return ledger from other cashiers. Consider introducing a dedicated `returns.read` permission gating `get_returns`, `get_return`, `search_returns`, and `get_transaction_returned_quantities`.

### 4. Data consistency — `return_items.restocked` can be `true` when stock was never actually incremented (Bug #3 above)
Until Fault #3 is fixed, the `restocked` column is semantically incorrect for items with `condition != "good"`. Any query joining `return_items WHERE restocked = true` will over-count actually-restocked items. This affects the `ReturnDetailPanel` "Restocked: N items" counter and any future analytics on restocking rates.

### 5. Data consistency — `returns.total_amount` after a void is not corrected or annotated
When a return is voided, `returns.total_amount` still shows the original refund amount. A sum query `SUM(total_amount) WHERE store_id = $1` without filtering `status != 'voided'` will over-count refunds. The `v_return_stats` view presumably filters correctly, but any ad-hoc query or future analytics endpoint could make this mistake. Add a database-level constraint or view comment making the voided exclusion explicit.

### 6. Offline resilience — `ReturnDetailPanel` detail query has `staleTime: 30_000` and no `refetchOnWindowFocus`
If a cashier opens a return detail page, another cashier voids that return from a different terminal (shared database), and then the first cashier tries to void it again, the detail page will show "completed" status for up to 30 seconds. The cashier clicks "Void Return", sees the dialog, submits, and gets a backend error "This return has already been voided." This is correct behavior but the UX is jarring. Add `refetchOnWindowFocus: true` to the `useReturn` query so the detail page refreshes state when the user switches tabs/windows.

### 7. Offline resilience — `create_return` has no client-side deduplication guard (no `client_uuid`)
Unlike `create_transaction` which uses a `client_uuid` to prevent duplicate submissions, `create_return` has no idempotency key. If a cashier double-clicks "Process Return" before the first response arrives (network latency), two identical returns will be created. The second will fail with a validation error (over-return quantity), but only after both have started DB transactions. Add a `client_uuid` field to `CreateReturnDto` and check for it in `create_return` as done in `create_transaction`.

---

## PRIORITY ORDER

These are the top 5 items that MUST be addressed before this module is production-ready, ordered by severity:

1. **[BACKEND FAULT #1] `void_return` silently swallows `orig_total` DB error — corrupts transaction status to "refunded"** — If the `SELECT total_amount FROM transactions WHERE id = $1` query fails for any reason during a void, `orig_total` becomes `0`. The condition `remaining_returned >= 0` is always true, so the original transaction is unconditionally marked `"refunded"` regardless of how much was actually returned. This is a silent, irreversible data corruption that permanently misrepresents financial records. The fix is a one-character change (`?` instead of `.unwrap_or(...)`), but the impact without it is catastrophic. No refund audit will be reliable until this is fixed.

2. **[BACKEND FAULT #8] `store_credit` refund method is accepted but never credits the customer's wallet** — Every return processed with "Store Credit" silently discards the customer's money. The backend validates and accepts the method, the frontend shows it as an option, the return record shows "Refund Method: Store Credit" — but `customers.wallet_balance` is never updated. In a store where cashiers use store credit for returns (a common practice for busy retail), every such return is a financial error that requires manual DB correction to repair. This will affect real customers from the first day of production.

3. **[BACKEND FAULT #7] `create_return` does not update shift return counters** — Every return processed through the Returns module (via `InitiateReturnModal`) is invisible to the active shift. The cashier's `shift.return_count` and `shift.total_returns` are never incremented. The `CloseShiftModal` expected-cash formula uses `total_returns` to compute expected drawer balance. Any shift where returns were processed will show an expected cash figure that is higher than actual (because return payouts weren't deducted from the expected total), causing the cashier to appear to have a cash shortage they don't actually have. In a busy store this affects every single shift that includes a return.

4. **[BACKEND FAULT #2] `fetch_return` INNER JOIN on `users` — returns from former employees are permanently inaccessible** — Once a cashier who processed returns is deactivated, every return they ever processed becomes inaccessible to the API (`NotFound` error). These returns exist in the DB, may be linked to credit balances, and are part of the audit trail, but the system treats them as nonexistent. In a store with any staff turnover, this will surface immediately after the first cashier is deactivated. Changing the INNER JOIN to LEFT JOIN is a trivial fix with zero downside.

5. **[BACKEND FAULT #3 + FRONTEND FAULT #4] `restocked` field stores incorrect value AND `ReturnsPanel` `DataTable` skeleton on every background refetch** — The `restocked = true` stored for items that were NOT actually restocked (wrong condition) corrupts the void logic audit trail and misleads the detail page's "N items restocked" indicator. Simultaneously, the `isLoading || isFetching` passed to `DataTable` makes the Returns list flash a loading skeleton every time the user navigates back to the page or any background refetch occurs, which happens every 60 seconds by default. Together these represent a data integrity issue and a jarring UX regression that will be noticed on the first day of use.
