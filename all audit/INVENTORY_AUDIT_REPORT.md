# Quantum POS — Production Audit: Inventory Module

**Audited:** 2026-04-25
**Scope:** `src-tauri/src/commands/inventory.rs`, `src-tauri/src/models/inventory.rs`, migrations 0014/0051/0059, `src/features/inventory/*`, `src/commands/inventory.js`

---

## BACKEND FAULTS (must fix before production)

### 1. `get_inventory_inner` total-count query uses INNER JOINs but data query LEFT JOINs — results can differ
**Where:** `commands/inventory.rs`, `get_inventory_inner()`
**What:** The `COUNT(*)` query uses `JOIN item_settings ist` and `JOIN item_stock istock` (both INNER), but the data query also uses INNER JOINs. If any item lacks a `item_stock` row or `item_settings` row (race during item creation, partial migration), those rows silently drop from both queries — so `total` matches `records.len()` only for page 1. On page 2+, a mismatch causes the pagination controls to show the wrong total and the "X items" counter is wrong.
**Fix:** Use `LEFT JOIN` consistently in the count query (as already done in `get_inventory_summary_inner`), and add `AND istock.item_id IS NOT NULL` in the WHERE clause if a stock row is truly required.

### 2. `start_count_session_inner` session-number generation has the same race condition as shift numbers
**Where:** `commands/inventory.rs`, `start_count_session_inner()`
**What:** Generates the next session number as `COUNT(*) + 1 FROM stock_count_sessions WHERE YEAR = current_year`. Two concurrent `startCountSession` calls will read the same `next_num`, both generate `COUNT-2026-0001`, and the second INSERT will hit the unique index `ux_scs_session_number` — surfacing as a raw PostgreSQL constraint violation (pgcode 23505), not a friendly error.
**Fix:** Wrap the count + insert in `SELECT pg_advisory_xact_lock(hashtext('scs_number_gen'))` inside the existing transaction, or catch `sqlx::Error::Database(e)` where `e.code() == Some("23505")` and return `AppError::Conflict("Session number collision — please retry")`.

### 3. `apply_variances_tx` does not verify the session is `completed` before applying
**Where:** `commands/inventory.rs`, `apply_variances_tx()`
**What:** The function is called either from `complete_count_session_inner` (safe — session is just marked completed inside the same transaction) or from `apply_variances_standalone_inner` (unsafe — the standalone path fetches the session inside a new transaction but does NOT verify `status == "completed"` before calling `apply_variances_tx`). A manager can call `applyVariancesStandalone` on an `in_progress` session and update live stock mid-count.
**Fix:** In `apply_variances_standalone_inner`, add:
```rust
let session = sqlx::query!("SELECT status FROM stock_count_sessions WHERE id = $1", session_id)
    .fetch_optional(&mut *tx).await?
    .ok_or_else(|| AppError::NotFound("Session not found".into()))?;
if session.status != "completed" {
    return Err(AppError::Validation("Can only apply variances to a completed session".into()));
}
```

### 4. `record_count_inner` records counts against completed/cancelled sessions via `apply_variances_standalone`
**Where:** `commands/inventory.rs`, `record_count_inner()`
**What:** `record_count_inner` validates `session.status == "in_progress"` correctly, but `apply_variances_standalone_inner` (see fault #3) calls `apply_variances_tx` which does `UPDATE item_stock … WHERE item_id = $1` for all unadjusted items. If a count item is re-submitted (via a client bug retrying a failed request) after the session is completed, the Upsert ON CONFLICT path in `record_count_inner` would UPDATE a completed session's item — bypassing the status guard because the guard is on the session, not the item row.
**Fix:** In `record_count_inner`, additionally verify the `is_adjusted` flag is not set before allowing an update:
```sql
-- In the ON CONFLICT DO UPDATE, add a guard:
WHERE stock_count_items.is_adjusted = FALSE
```
If `is_adjusted = TRUE`, return `AppError::Validation("This item's variance has already been applied to stock")`.

### 5. `get_inventory_summary_inner` includes items where `is_active = FALSE` in all counts
**Where:** `commands/inventory.rs`, `get_inventory_summary_inner()`
**What:** The summary query has no `ist.is_active = TRUE` filter. Archived/deactivated items inflate `total_items`, `low_stock_count`, and `total_inventory_value`. A store with 500 deactivated legacy items will show wrong KPIs on the dashboard.
**Fix:** Add `AND ist.is_active = TRUE` to the WHERE clause, consistent with `get_low_stock_inner` and `get_inventory_for_count_inner`.

### 6. `get_inventory_item_inner` uses INNER JOIN on `categories` — items without a category crash with 404
**Where:** `commands/inventory.rs`, `get_inventory_item_inner()`
**What:** The query uses `JOIN categories c ON c.id = i.category_id` (INNER). If `category_id` is NULL or the category was deleted after the item was created, this query returns nothing and the function returns `AppError::NotFound` even though the item exists. `InventoryItemRecord` already has `category_id: Option<i32>` and `category_name: Option<String>`, confirming the intention was LEFT JOIN.
**Fix:** Change to `LEFT JOIN categories c ON c.id = i.category_id`.

### 7. `complete_count_session_inner` marks the session as completed before applying variances — partial failure leaves an inconsistent state
**Where:** `commands/inventory.rs`, `complete_count_session_inner()`
**What:** The function sequence inside the transaction is:
1. UPDATE session → status = 'completed'
2. `apply_variances_tx(...)` — may fail

If step 2 fails (e.g., an item_stock row is missing), the transaction is rolled back. But the caller's error surface says "couldn't complete" — the cashier may retry, and the second attempt will hit "Cannot complete: session is in_progress" because the first rollback reverted the status. This is actually safe from a DB perspective (rollback is correct), but the error message is confusing. Additionally, if `apply_variances` is `false`, there is no problem — but the code path runs `apply_variances_tx` unconditionally based on the parameter, which is correct. The real risk is that the final `get_variance_report_inner` call at the end uses a *new* connection from `state.pool()` rather than the committed transaction, meaning it will always reflect the committed state — but it also re-does the permission check consuming an extra token verification round-trip. This is wasteful but not incorrect.
**Fix:** Reorder: run `apply_variances_tx` first (before marking completed), then mark completed. This way, if variance application fails, the session remains `in_progress` with a clear error message. Add a friendly status message to the AppError context.

### 8. `deduct_stock_from_sale` does not check `allow_negative_stock` before going below zero
**Where:** `commands/inventory.rs`, `deduct_stock_from_sale()`
**What:** The `adjust_inventory_inner` function checks `allow_negative_stock` before allowing negative quantities. The `deduct_stock_from_sale` function (called by the transaction command) does NOT check this flag. A sale can drive stock below zero even when the item is configured to disallow it, silently bypassing the guard.
**Fix:** Fetch `allow_negative_stock` from `item_settings` inside `deduct_stock_from_sale` (alongside the existing `item_name` fetch), and return `AppError::Validation("Stock cannot go below zero — insufficient quantity")` if `qty_before - quantity < 0 && !allow_negative_stock`.

### 9. `get_count_sessions_inner` total-count query JOIN differs from data query — count can be inflated
**Where:** `commands/inventory.rs`, `get_count_sessions_inner()`
**What:** The count query does `LEFT JOIN users u1 ON u1.id = s.started_by` and filters on `u1.username ILIKE $4`. When there is no active search (`$4 IS NULL`), `u1` rows with NULL username (deleted users) are included, which is correct. BUT when there IS a search term, the `u1.username ILIKE $4` subclause is inside `OR`, so it returns sessions where the user was deleted (u1 IS NULL → username IS NULL → `ILIKE` returns false). The data query also LEFT JOINs u1 but the logic is identical — so results match. This is fine, but it means searching by username of a deleted user will never return their sessions. **More critically:** the data query also JOINs `stores st ON st.id = s.store_id` (INNER JOIN), but the count query does NOT join stores. If any session has a NULL or deleted store_id, the count includes it but the data query excludes it — causing `total > records.len()` on the last page.
**Fix:** Either add the stores JOIN to the count query, or use a LEFT JOIN in the data query for stores.

### 10. `RestockDto.quantity` and `AdjustInventoryDto.adjustment_quantity` accept `f64` with no range check
**Where:** `models/inventory.rs`, DTOs
**What:** There is no validation that the f64 value is finite (i.e., not NaN, Infinity, or -Infinity) before `Decimal::try_from(v)`. `Decimal::try_from(f64::NAN)` returns an error that is then silently handled by `unwrap_or_default()` in `to_dec()`, yielding `Decimal::ZERO`. A `quantity: NaN` restock call would succeed with quantity=0, creating a confusing audit log entry "Restocked 0 units."
**Fix:** In `to_dec()` and `validate_qty_opt`, add:
```rust
fn to_dec(v: f64) -> AppResult<Decimal> {
    if !v.is_finite() {
        return Err(AppError::Validation("quantity must be a finite number".into()));
    }
    Decimal::try_from(v).map_err(|_| AppError::Validation("Invalid quantity value".into()))
}
```

---

## BACKEND UPGRADES (should improve)

### 1. `get_inventory_inner` has duplicate WHERE clause in count + data queries — maintenance hazard
Any filter change must be applied in two places. Extract the WHERE conditions into a named CTE or use a single query with `COUNT(*) OVER ()` as a window function:
```sql
WITH filtered AS (
  SELECT i.*, istock.*, ist.*, c.category_name, d.department_name
  FROM items i JOIN item_stock istock ... WHERE <conditions>
)
SELECT *, COUNT(*) OVER () AS total_count FROM filtered
ORDER BY item_name ASC LIMIT $6 OFFSET $7
```

### 2. `get_inventory_for_count_inner` returns unlimited rows — could be large for big catalogs
There is no LIMIT, which is intentional (it replaces the old 200-item cap). However, a store with 10,000 SKUs serializes all of them into a single JSON response. Add a streaming/chunked approach or a size warning: if `COUNT(*) > 5000` return a warning header so the frontend can show a loading notice.

### 3. `get_inventory_item_inner` hard-codes `LIMIT 20` for movement history inline — silently truncates
The inline movement history inside `get_inventory_item_inner` fetches the last 20 events and embeds them in `InventoryItemDetail`. If an item has been restocked 50 times this week, 30 events are silently missing. `InventoryItemDetail.jsx` already uses a separate `MovementHistoryTable` with proper pagination via `useMovementHistory` — the inline history in the detail response is not even rendered by the frontend (it uses `detail.item`, not `detail.movement_history`).
**Fix:** Remove the inline `movement_history` fetch from `get_inventory_item_inner` entirely. Return only `InventoryItemRecord`. This saves one query per item detail load.

### 4. Missing index on `item_history.event_type` — movement history filter by type is a sequential scan
`get_movement_history_inner` filters by `h.event_type = $3` but the only indexes on `item_history` are on `item_id` and `performed_at`. A store with 100,000 history rows filtering by `event_type = 'SALE'` will do a full index scan on the existing `item_id` index then a sequential scan for the type filter.
**Fix:**
```sql
CREATE INDEX IF NOT EXISTS idx_item_history_event_type ON item_history(event_type);
CREATE INDEX IF NOT EXISTS idx_item_history_store_type ON item_history(store_id, event_type);
```

### 5. Missing index on `item_history.performed_by` — movement history filter by user is slow
`get_movement_history_inner` accepts `performed_by` filter. No index exists on this column.
```sql
CREATE INDEX IF NOT EXISTS idx_item_history_performed_by ON item_history(performed_by);
```

### 6. Missing index on `items.category_id` and `items.department_id` — inventory filter is slow
The inventory list query filters on `i.category_id = $2` and `i.department_id = $3`. These are foreign keys but may not have explicit indexes.
```sql
CREATE INDEX IF NOT EXISTS idx_items_category_id   ON items(category_id);
CREATE INDEX IF NOT EXISTS idx_items_department_id ON items(department_id);
```

### 7. `get_inventory_inner` stock_status CASE expression is computed in every SELECT row — consider a DB generated column or view
The `CASE WHEN … THEN 'low' WHEN … THEN 'high' ELSE 'normal'` expression is evaluated for every row on every query. For stores with thousands of items, this adds CPU overhead. Consider materializing into a generated column or a `v_inventory` view with the status pre-computed, and adding a partial index on `(store_id) WHERE stock_status = 'low'`.

### 8. `cancel_count_session_inner` does NOT use a transaction — partial failure can leave state inconsistent
The UPDATE sets `status = 'cancelled'` in a direct pool query, not in a transaction. If the system crashes between this UPDATE and any subsequent operations (e.g., sync queue), there is no rollback. While `cancel` is a single UPDATE (atomic), consistency demands it uses a transaction for future extensibility.
**Fix:** Wrap in `pool.begin()` / `tx.commit()`.

### 9. `record_count_inner` session stats UPDATE is not covered by `GET → UPDATE` race guard
The session stats re-aggregation (`COUNT(*)` from `stock_count_items WHERE session_id = $1`) runs inside the same transaction but is computed AFTER the upsert commits to the transaction buffer. Two concurrent `record_count` calls for different items in the same session will both read a partial count (missing each other's row), resulting in `items_counted` being off by 1. The next call will self-correct, but for a moment the progress display can be off.
**Fix:** Use `SELECT COUNT(*) ... FOR UPDATE` on the session row at the start of `record_count_inner` to serialize concurrent updates to the same session:
```sql
SELECT id FROM stock_count_sessions WHERE id = $1 FOR UPDATE
```

### 10. `AdjustInventoryDto.reason` is validated with a hard-coded `valid_reasons` array in Rust — should be a `CHECK` constraint in the DB
If a new reason is added to the Rust array but the DB `CHECK` constraint (if it existed) is not updated, or vice versa, the two will drift.
**Fix:** Add a DB constraint:
```sql
ALTER TABLE item_history ADD CONSTRAINT chk_adjustment_reason
  CHECK (event_type != 'ADJUSTMENT' OR notes LIKE 'Reason: %');
```
Or better: add a separate `adjustment_reason` column on `item_history` and validate it there.

---

## BACKEND FEATURES (add for completeness)

### 1. No `reserved_quantity` management API
`item_stock.reserved_quantity` is updated by… nothing in this codebase. It is read in `available_quantity = quantity - reserved_quantity` but never incremented (e.g., when a hold transaction is created). A hold that reserves 5 units of an item should increment `reserved_quantity` by 5 and decrement `available_quantity` by 5 — preventing double-sale of reserved stock. Add `reserve_stock(item_id, store_id, quantity, reference)` and `release_reservation(item_id, store_id, quantity, reference)` commands.

### 2. No bulk restock / purchase-order-to-inventory linkage
When a purchase order is received (`receive_purchase_order`), there is no automatic call to `restock_item_inner`. The inventory is only updated if the user manually does a restock after receiving the PO. Add an auto-restock hook in `receive_purchase_order_inner` that calls `restock_item_inner` for each received line item with `reference_type = 'purchase_order'` and `reference_id = po_id`.

### 3. No inventory snapshot / history at a point in time
There is no query to answer "what was our inventory level on March 1st?" The `item_history` table has all the data, but there is no `get_inventory_snapshot(store_id, as_of_date)` command that reconstructs quantities by replaying movements up to a date.

### 4. No `item_history` write audit trail for `get_inventory_summary` — no record that a user viewed the summary
Compliance in retail often requires logging "who accessed financial reports." Add an `audit_log` entry (type: `INVENTORY_SUMMARY_VIEWED`) on `get_inventory_summary_inner` calls.

### 5. Missing `updated_at` index on `item_stock` for cloud sync cursor
The bidirectional sync uses `updated_at > cursor` queries. `item_stock.updated_at` exists but has no index.
```sql
CREATE INDEX IF NOT EXISTS idx_item_stock_updated_at ON item_stock(updated_at DESC);
```

### 6. No item-history write on `restock_item_inner` for `reference_type` / `reference_id`
The `restock_item_inner` inserts into `item_history` with `performed_by` and `notes` but leaves `reference_type` and `reference_id` NULL. This means there is no way to trace a restock back to a supplier, PO, or delivery note from the history view. Add `reference_type: Option<String>` and `reference_id: Option<String>` to `RestockDto` and pass them to the history INSERT.

### 7. No `CHECK` constraint on `stock_count_sessions.status` in the DB
Only Rust enforces valid status values ('in_progress', 'completed', 'cancelled'). A direct DB edit or migration error can set an invalid status.
```sql
ALTER TABLE stock_count_sessions ADD CONSTRAINT chk_scs_status
  CHECK (status IN ('in_progress', 'completed', 'cancelled'));
```

### 8. No background job to detect and alert on negative stock
Items with `allow_negative_stock = TRUE` can go negative silently. There is no scheduled job or event hook that fires an alert/notification when `item_stock.quantity < 0`. Add a scheduled check (e.g., hourly) that queries `SELECT * FROM item_stock WHERE quantity < 0` and creates `notifications` rows for managers.

### 9. No `partial` or `cycle` count type enforcement — all count types behave identically
`StartCountSessionDto.count_type` accepts 'full', 'partial', 'cycle' but the backend treats all types identically (counts all items). A `partial` count should accept a list of `item_ids` to count, and a `cycle` count should rotate through a category or ABC classification. Add `item_ids: Option<Vec<Uuid>>` to `StartCountSessionDto` and filter `get_inventory_for_count_inner` accordingly.

### 10. No variance threshold alert — small variances clutter reconciliation
Retailers typically ignore variances under 1% or under a dollar value. Add a `variance_threshold_pct: Option<f64>` and `variance_threshold_value: Option<f64>` to `complete_count_session_inner` and `get_variance_report_inner` that filter out below-threshold items from the report and skip them during `apply_variances_tx`.

---

## FRONTEND FAULTS (must fix before production)

### 1. `RestockDialog` reads `item?.id ?? item?.item_id` — inconsistent field name causes silent no-op
**Where:** `RestockDialog.jsx`, `handleSubmit()` → `mutation.mutate({ itemId: item?.id ?? item?.item_id, ... })`
**What:** When opened from `InventoryDashboard`, the row is an `InventoryRecord` which has `item_id` (UUID). When opened from `InventoryItemDetail`, the row is an `InventoryItemRecord` which has `id` (UUID). The `item?.id ?? item?.item_id` pattern works BUT `item?.id` will read `undefined` on an `InventoryRecord` (which has no `id` field), falling back to `item_id`. If the shape ever changes, this silently passes `undefined` as the item ID, causing the backend to return a validation error with no visible indication to the user of which field is wrong.
**Fix:** Normalize the prop — always pass a pre-extracted `{ id: row.item_id ?? row.id, ...row }` to both dialogs from their call sites, or add an explicit assertion: `if (!itemId) { toast.error("Cannot determine item ID"); return; }`.

### 2. `AdjustInventoryDialog` allows submitting with `adj = "0"` — backend returns validation error but no inline feedback
**Where:** `AdjustInventoryDialog.jsx`, `handleSubmit()`
**What:** The submit button is disabled only when `!adj || !reason`. If the user types `0`, `!adj` is `false` (because `"0"` is truthy), so the button enables. The backend then returns `AppError::Validation("Cannot adjust quantity below 0...")` for a 0-adj (which is a no-op). The error is shown via the `mutation.error` block, but there is no inline field-level validation to prevent submission.
**Fix:** Add to the button's `disabled` condition: `|| parseFloat(adj) === 0 || isNaN(parseFloat(adj))`. Also show an inline `<p className="text-destructive">` below the input when `adj === "0"`.

### 3. `InventoryDashboard` resets `page` to 1 only for `debouncedSearch`, `lowStock`, and `measurementType` — adding a category filter doesn't reset page
**Where:** `InventoryDashboard.jsx`
**What:** `useEffect(() => setPage(1), [debouncedSearch, lowStock, measurementType])` — but there is no `categoryId` filter in the UI (no category dropdown is rendered). If a category filter is added in the future, the page will not reset. More importantly, the `summary` query inside `useInventory` refetches the full store summary on every `invalidateAll()` call, but the summary results are not invalidated when restock/adjust mutations succeed — the stat cards can show stale totals after a restock.
**Fix:** Call `qc.invalidateQueries({ queryKey: inventorySummaryKey(storeId) })` explicitly inside `restock.onSuccess` and `adjust.onSuccess` in `useInventory.js`.

### 4. `StockCountRunner` `totalItems` falls back to `allItems.length` when session data is stale — causes wrong progress ring
**Where:** `StockCountRunner.jsx`, line `const totalItems = session?.total_items ?? allItems.length`
**What:** `session.total_items` is set at session creation time (count of tracked active items). `allItems.length` from `useInventoryForCount` is the current item count. If new items were added to the store after the session started, `allItems.length > session.total_items`, making the progress ring show >100% counted (e.g., 95/90 items = 106%). The fallback `?? allItems.length` is wrong — always use `session.total_items`.
**Fix:** `const totalItems = session?.total_items ?? 0;` — 0 is safer than a stale count.

### 5. `VarianceReportView` applies `parseFloat` to `summary.items_counted` and `summary.items_with_variance` which are i32 integers from the backend — but renders them as numbers without checking for null/undefined first
**Where:** `VarianceReportView.jsx`, `SummaryCard` usages
**What:** If the backend returns a `VarianceSummary` where `items_counted` or `items_with_variance` are null (possible if the session was just started and no items counted), `parseFloat(null)` returns `NaN` and the stat cards display `NaN`. The Rust model defines these as `i32` (NOT NULL), but `sqlx::query!()` on an aggregate could return null if the subquery produces no rows.
**Fix:** Add null-coalescing: `summary.items_counted ?? 0` everywhere these fields are used in JSX.

### 6. `StockCountRunner` does not prevent opening `CountItemDialog` when `recordCount.isPending` — double-submitting is possible
**Where:** `StockCountRunner.jsx`, `handleSelectItem()` and `ItemRow.onClick`
**What:** While `recordCount.isPending` is `true` (a count is being saved), the user can click another item row and open `CountItemDialog` again. Two simultaneous `recordCount.mutate` calls for different items can succeed, but if they fail and retry, the second may see stale session stats.
**Fix:** Disable `ItemRow` click and the `onSelect` callback while `recordCount.isPending`:
```jsx
onClick={() => isInProgress && !recordCount.isPending && onSelect(item)}
```

### 7. `InventoryItemDetail` sends `itemId` as a prop (string from URL params) but `getInventoryItem` expects a UUID — no format validation
**Where:** `InventoryItemDetail.jsx`, parent page component
**What:** If the URL is `/inventory/not-a-uuid`, the `getInventoryItem(itemId, storeId)` RPC call will fail with a backend parse error (not a 404), and the `error` state will show a raw serde/uuid parse error message to the user.
**Fix:** Validate UUID format before making the query:
```js
const isValidUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(itemId);
// In useInventoryItem:
enabled: !!(itemId && storeId && isValidUuid),
```

### 8. `MovementHistoryTable` date inputs send timestamps in wrong format when timezone offset crosses midnight
**Where:** `InventoryItemDetail.jsx` → `useMovementHistory` → `useInventory.js`
**What:** `start_date: dateFrom ? \`${dateFrom}T00:00:00.000Z\`` — This appends `Z` (UTC) but `dateFrom` is a local date string like `"2026-04-25"`. A user in WAT (UTC+1) selecting April 25 will get `2026-04-25T00:00:00.000Z` = `2026-04-25T01:00:00 WAT` — missing the first hour of April 25 local time. Similarly, `end_date: dateTo ? \`${dateTo}T23:59:59.999Z\`` cuts off the last hour.
**Fix:** Use start/end of day in the store's timezone. At minimum, change to `T00:00:00` without the `Z` suffix (letting the browser parse it as local time) or use a proper date-fns/luxon UTC offset calculation.

### 9. `useCountSessions` `invalidate` function only invalidates `["count_sessions"]` and `["count_stats"]` — does not invalidate `inventorySummaryKey` after variance application
**Where:** `useInventory.js`, `useCountSessions.invalidate`
**What:** After `completeSession.onSuccess`, `invalidateStock(storeId)` is called (good), but `invalidateStock` may not invalidate `inventorySummaryKey(storeId)`. If inventory value changes after variances are applied, the stat cards on `InventoryDashboard` show stale totals until the next full page reload.
**Fix:** In `useCountSession`, add to `completeSession.onSuccess`:
```js
qc.invalidateQueries({ queryKey: inventorySummaryKey(storeId) });
```

### 10. `VarianceReportView` `hasUnadjusted` check uses `items.some(i => !i.is_adjusted && ...)` — `is_adjusted` is `Option<bool>` from the backend (nullable), treated as falsy when null
**Where:** `VarianceReportView.jsx`, `hasUnadjusted` derivation
**What:** `!i.is_adjusted` is `true` when `is_adjusted` is `null` (because `!null === true`). `StockCountItem.is_adjusted` is `Option<bool>` in Rust (the column was added via ALTER TABLE without NOT NULL). For old rows with `is_adjusted = NULL`, `hasUnadjusted` becomes `true` even if the variance has already been applied by another path that left `is_adjusted` as NULL. This would cause the "Apply Variances" button to appear on a fully-applied report.
**Fix:** `!i.is_adjusted` → `i.is_adjusted === false || i.is_adjusted === null ? true : false` — or better, normalize at the backend to always return `false` when null:
```rust
pub is_adjusted: bool, // with #[sqlx(default)] to coerce NULL → false
```

---

## FRONTEND UPGRADES (should improve)

### 1. `InventoryDashboard` has no category filter dropdown despite the backend supporting `category_id`
The `get_inventory` backend accepts `category_id` but the dashboard only has a measurement-type filter, a search box, and a low-stock toggle. Managers cannot filter by category to review a single department's stock. Add a `<Select>` populated by `useCategories(storeId)` that maps to the `categoryId` filter prop.

### 2. `InventoryDashboard` column sorting is declared `sortable: true` but `DataTable` client-side sort only sorts the current page — not the full dataset
Columns `item_name`, `quantity`, and `selling_price` are marked `sortable: true`. If `DataTable` sorts client-side (only the 25 rows on screen), sorting by "quantity" shows the lowest quantity on the current page, not globally. The backend `ORDER BY` is always `i.item_name ASC`. Either remove the `sortable` markers, or add `sort_by` and `sort_dir` params to `InventoryFilters` and the backend query.

### 3. `StockCountRunner` item list has no virtual scrolling — large stores with 2,000+ items render all rows at once
The item list renders every `filteredItems` row in a `max-h-[60vh] overflow-y-auto` container. With 2,000 items this results in thousands of DOM nodes, making scroll janky. Use `react-window` or `@tanstack/react-virtual` for the item list.

### 4. `InventoryItemDetail` movement history table has no "Download CSV" or "Export" action
Managers frequently need to export movement history for accounting or audits. Add an "Export CSV" button to `MovementHistoryTable` that calls `getMovementHistory` with `limit: 1000` (or a dedicated export endpoint) and triggers a browser CSV download.

### 5. `StockCountRunner` search input is only shown when `isInProgress` — completed/cancelled sessions have no search
When viewing a completed session (before navigating to the variance report), the items list is hidden (`{!isCompleted && ...}`). But even for in-progress sessions that are searched, the "uncounted" tab shows the count without accounting for the current search. Add the item count badge to account for the search filter: `{filteredItems.filter(i => !countedItemsMap[i.item_id]).length}`.

### 6. `VarianceReportView` has a "Download" icon (`<Download />`) imported but never rendered
**Where:** `VarianceReportView.jsx` imports `Download` from lucide-react but it is not used in any JSX. Add an export CSV button or remove the unused import.

### 7. `InventoryDashboard` `StatCard` for "Total Value" doesn't clarify whether it's cost value or retail value
`formatCurrency(parseFloat(summary.total_inventory_value ?? 0))` is the cost value (`SUM(quantity * cost_price)`). Managers often want both. Add a sub-label: `sub="at cost price"` to the StatCard, and consider adding a second card or tooltip showing retail value.

### 8. `AdjustInventoryDialog` doesn't show the allowed valid reasons with their business context — "other" is too vague for audit
The reason dropdown shows "Other" with no additional notes requirement. Require a `notes` field when `reason === "other"`:
```js
const isSubmittable = adj && reason && (reason !== "other" || notes.trim().length >= 5);
```
This ensures every "Other" adjustment has at least a brief explanation in the audit log.

### 9. `InventoryItemDetail` "Inventory Value" card calculates `qty * cost_price` client-side using potentially stale `parseFloat` values
The Potential Profit calculation uses `qty * (selling_price - cost_price)`. If `qty` is 0 (out of stock), profit shows ₦0 which is misleading. Add a note: `{qty === 0 ? "(item is out of stock)" : null}`.

### 10. `useInventoryForCount` has no error boundary — if `getInventoryForCount` fails, `StockCountRunner` silently shows an empty list
If the API call for the full item list fails (network error, DB timeout), `items = []` and the runner shows "No items found" with no indication of error. The `error` from `useInventoryForCount` is available but not consumed in `StockCountRunner`.
**Fix:** In `StockCountRunner`, add:
```jsx
const { items: allItems, isLoading: itemsLoading, isFetching: itemsFetching, error: itemsError } = useInventoryForCount(storeId);
// ...
{itemsError && (
  <div className="px-4 py-3 text-xs text-destructive border border-destructive/30 bg-destructive/10 rounded-lg m-4">
    Failed to load items: {String(itemsError)}
  </div>
)}
```

---

## FRONTEND FEATURES (add for completeness)

### 1. No barcode scanner integration in `StockCountRunner`
Physical stock counts in a retail environment are done with a barcode scanner. There is no barcode/HID input handler in the runner — a scanner would fire keystrokes that should match an item and auto-focus the quantity input. Add a global `keydown` listener in `StockCountRunner` that accumulates characters and auto-selects an item when a barcode is detected (typically ends with Enter key from a scanner).

### 2. No "Quick Restock from PO" flow on `InventoryItemDetail`
The detail page has a "Restock" button that opens a generic quantity dialog, but there is no way to link the restock to an open purchase order. Add a "Receive from PO" secondary action that lets the user select an open PO for this item and pre-fills the quantity from the PO line.

### 3. No stock transfer action from `InventoryItemDetail`
The item detail page has Restock and Adjust buttons but no "Transfer Stock" button that initiates a stock transfer to another store. This is a common operation for multi-store setups. Add a "Transfer" button linking to the stock transfer creation flow pre-filled with the item.

### 4. No inventory value trend chart on `InventoryItemDetail`
The "Inventory Value" panel shows a static snapshot. A mini sparkline chart showing the last 30 days of quantity history (derived from `movement_history`) would help managers see stock velocity at a glance.

### 5. No bulk restock dialog on `InventoryDashboard`
Managers restocking after a delivery must open the restock dialog for each item individually. Add a multi-select capability to the inventory table with a "Bulk Restock" action that opens a batched restock form.

### 6. No "Print Low-Stock Report" button
The low-stock strip and low-stock filter exist but there is no way to print or export the low-stock list. Add a "Print" / "Export CSV" button to the low-stock alert strip and filter mode.

### 7. No inventory aging report — items with no movement in X days
Slow-moving and dead stock are key inventory management concerns. The backend has `get_slow_moving_items` and `get_dead_stock` analytics commands but there is no frontend page linking to them from the Inventory module. Add a "Reports" dropdown or sub-navigation entry on `InventoryDashboard` linking to these analytics.

### 8. No inline "Min/Max Level" editor on `InventoryDashboard`
Managers frequently need to update reorder points. Currently they must navigate to the item settings page to change min/max levels. Add an inline edit mode on the `min_stock_level` / `max_stock_level` cells in the inventory table.

---

## CROSS-CUTTING RISKS

### 1. Multi-store isolation: `get_inventory_inner` correctly scopes by `store_id` but `get_movement_history_inner` is scoped only by `h.store_id = $1` — an item can belong to a different store
`get_movement_history_inner` takes `store_id: i32` as a parameter but does not verify that the calling user has access to that store. A non-global user (locked to Store A) who manually constructs an RPC call with `store_id: 2` (Store B) will receive Store B's movement history. The `guard_permission` check only verifies the user has `inventory.read` — not that they are authorized for this specific store.
**Fix:** After `guard_permission`, add:
```rust
if !claims.is_global && claims.store_id != Some(store_id) {
    return Err(AppError::Forbidden);
}
```
Apply the same check to `get_inventory_summary_inner` and `get_inventory_for_count_inner`.

### 2. Security: `apply_variances_standalone_inner` only requires `inventory.stock_count` permission — no `inventory.adjust` required even though it modifies stock levels
Applying variances directly changes `item_stock.quantity` — the same operation as `adjust_inventory_inner` which requires `inventory.adjust`. A user with `inventory.stock_count` but not `inventory.adjust` can modify stock levels via the variance application path. Add a check for `inventory.adjust` in `apply_variances_standalone_inner` or require a combined `inventory.stock_count.apply` permission.

### 3. Data consistency: `item_stock.available_quantity` is a denormalized field — can drift from `quantity - reserved_quantity`
`available_quantity` is updated by `GREATEST(0, $1 - COALESCE(reserved_quantity, 0))` in restock, adjust, and variance application — but `reserved_quantity` is never set from the application layer (no `reserve_stock` API, see Backend Feature #1). If `reserved_quantity` is ever set by a future feature and then decremented, `available_quantity` will only be refreshed on the next stock write. Add a DB trigger or a periodic reconciliation job:
```sql
CREATE OR REPLACE FUNCTION refresh_available_quantity()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.available_quantity = GREATEST(0, NEW.quantity - COALESCE(NEW.reserved_quantity, 0));
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_refresh_avail BEFORE INSERT OR UPDATE ON item_stock
  FOR EACH ROW EXECUTE FUNCTION refresh_available_quantity();
```

### 4. Data consistency: `stock_count_sessions.total_items` is set at session start and never updated — if items are added/deactivated mid-count, progress shows wrong denominator
`total_items` is set once via `COUNT(*) FROM items … WHERE track_stock = TRUE AND is_active = TRUE`. If 10 new items are added during a count session, the runner shows "95/90 counted" (>100%). Add an `UPDATE stock_count_sessions SET total_items = (SELECT COUNT(*) …)` at the start of `complete_count_session_inner` to use the current item count as the final denominator.

### 5. Offline resilience: `apply_variances_tx` runs multiple sequential UPDATEs in a loop — if the app crashes mid-loop, some items are adjusted and others are not
Each item in `apply_variances_tx` is processed in a `for` loop, each issuing its own `UPDATE item_stock` and `INSERT INTO item_history` (inside the outer transaction). Since all of these are within the same `sqlx::Transaction`, a crash before `tx.commit()` will roll back all changes — this is correct. However, the `is_adjusted` flag is set to `TRUE` for each item within the same transaction, so if the commit fails, all items revert to `is_adjusted = FALSE`. This is safe. The risk is at the application layer: if the Tauri process crashes after `tx.commit()` but before returning the success response to the frontend, the frontend will retry `applyVariancesStandalone` — and the query filters `WHERE is_adjusted = FALSE`, so already-adjusted items are safely skipped. **This is correct behavior** — but it should be documented as intentional idempotency.

### 6. Offline resilience: `useInventoryForCount` caches the item list for 5 minutes (`staleTime: 5 * 60_000`) — stale during active count
An item added to the store 3 minutes into a count session will not appear in the runner's item list until the 5-minute cache expires. The count runner shows "X total in store" based on stale data. Reduce `staleTime` to `0` for the `inventoryForCountKey` query when the session is `in_progress`, or add a manual "Refresh Items" button to the runner.

---

## PRIORITY ORDER

1. **[BACKEND FAULT #8] `deduct_stock_from_sale` ignores `allow_negative_stock`** — This is the highest severity fault because it allows the POS to create physically impossible stock levels (negative quantities) on items explicitly configured to prevent it. Every sale of such an item corrupts the inventory record. Fix is straightforward: add one `allow_negative_stock` check before the UPDATE.

2. **[BACKEND FAULT #3] `apply_variances_standalone` allows applying variances to an in-progress session** — This is a data integrity failure in a financial operation. A manager accidentally applying variances mid-count will update live stock to partially-counted values, potentially causing 50+ items to have wrong quantities that cannot easily be rolled back (the `is_adjusted` flags are set). Fix: add a `status == "completed"` guard.

3. **[BACKEND FAULT #5] `get_inventory_summary_inner` includes inactive items in all KPI counts** — The "Total Items", "Low Stock", "Out of Stock", and "Total Value" stat cards on `InventoryDashboard` are inflated by deactivated items. A store migrating from an old system with 2,000 archived items will see completely wrong numbers on their first day. Fix: add `AND ist.is_active = TRUE` to the summary query.

4. **[FRONTEND FAULT #4] `StockCountRunner` uses `allItems.length` as fallback for `total_items`** — The progress ring can show >100% completion if items were added after the session started, confusing cashiers and potentially causing them to think they've over-counted and re-count items. Fix: use `session.total_items ?? 0` always.

5. **[CROSS-CUTTING RISK #1] Multi-store isolation broken in `get_movement_history_inner`** — A non-global user can request movement history for any store by passing an arbitrary `store_id`. In a multi-store franchise, this is a security and compliance violation — Store A's cashier can read Store B's complete stock movement history. Fix: add store-boundary check after `guard_permission`.
