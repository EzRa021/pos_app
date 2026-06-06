# Quantum POS — Production Audit: Purchase Orders Module

**Audited:** 2026-04-29
**Scope:** `src-tauri/src/commands/purchase_orders.rs`, `src/features/purchase-orders/usePurchaseOrders.js`, `src/features/purchase-orders/PurchaseOrdersPanel.jsx`, `src/features/purchase-orders/PurchaseOrderDetailPanel.jsx`, `src/pages/PurchaseOrdersPage.jsx`, `src/pages/PurchaseOrderDetailPage.jsx`, `src/commands/purchase_orders.js`.

---

## BACKEND FAULTS (must fix before production)

### 1. `receive_purchase_order` updates `item_stock` quantity but never writes an `item_history` record
**Where:** `src-tauri/src/commands/purchase_orders.rs` — `receive_purchase_order()`, the per-item stock update loop
**What:** When goods are received against a PO, `item_stock` is incremented correctly inside `db_tx`. However, no corresponding `INSERT INTO item_history (item_id, store_id, event_type, event_description, quantity_before, quantity_after, quantity_change, performed_by, reference_type, reference_id, notes)` is executed. Every stock increase from a received PO is invisible in the item's history. Inventory audits, shrinkage reports, and stock movement queries that rely on `item_history` will show phantom stock increases — the quantity went up but no record explains why. This is especially critical for regulatory and accounting audit trails.
**Fix:** Inside the per-item loop of `receive_purchase_order`, after each `UPDATE item_stock SET quantity = quantity + $1`, insert a canonical `item_history` row:
```rust
sqlx::query!(
    r#"INSERT INTO item_history
           (item_id, store_id, event_type, event_description,
            quantity_before, quantity_after, quantity_change,
            performed_by, reference_type, reference_id, notes)
       VALUES ($1, $2, 'PO_RECEIVE', $3,
               (SELECT quantity - $6 FROM item_stock WHERE item_id=$1 AND store_id=$2),
               (SELECT quantity FROM item_stock WHERE item_id=$1 AND store_id=$2),
               $6, $4, 'purchase_order', $5, $3)"#,
    item.item_id, po.store_id,
    format!("Received {} unit(s) via PO {}", item.quantity_received, po.reference_no),
    claims.user_id, po.id, item.quantity_received,
)
.execute(&mut *db_tx).await?;
```

### 2. `cancel_purchase_order` does not roll back stock for items already partially received
**Where:** `src-tauri/src/commands/purchase_orders.rs` — `cancel_purchase_order()`
**What:** When a PO with status `'partially_received'` is cancelled, the command updates `purchase_orders.status = 'cancelled'` but does not subtract the already-received quantities from `item_stock`. A PO for 100 units where 40 were received and confirmed, then cancelled, leaves those 40 units in stock with no record that they were received against a now-cancelled order. The remaining 60 undelivered units are also left without a resolution. This silently overstates inventory and creates an unresolvable audit gap.
**Fix:** Before committing the cancellation, check `po.status`. If it is `'partially_received'`, fetch all `purchase_order_items` where `quantity_received > 0` and prompt the caller to choose between: (a) keep received stock (write a stock adjustment `item_history` record noting the cancelled PO), or (b) reverse the received stock. At minimum, enforce that `'fully_received'` POs cannot be cancelled at all:
```rust
if po.status == "fully_received" {
    return Err(AppError::Validation(
        "Cannot cancel a fully received purchase order. Create a supplier return instead.".into()
    ));
}
if po.status == "partially_received" {
    return Err(AppError::Validation(
        "PO has partially received items. Reverse received stock before cancelling, or use force_cancel.".into()
    ));
}
```

### 3. Race condition on `quantity_received` update — concurrent receive calls can over-receive
**Where:** `src-tauri/src/commands/purchase_orders.rs` — `receive_purchase_order()`, per-item qty validation
**What:** The check `if qty_to_receive > (item.quantity_ordered - item.quantity_received)` reads `item.quantity_received` from the initial `fetch_po_items(&pool, po_id)` call which runs against `&pool` outside the `db_tx`. If two receive operations arrive concurrently (e.g., two managers on the same LAN hitting the HTTP server simultaneously), both will read the same `quantity_received`, both will pass the check, and both will execute `UPDATE purchase_order_items SET quantity_received = quantity_received + $1`. The total received can exceed `quantity_ordered`, overstating inventory.
**Fix:** Move the per-item validation inside `db_tx` using `SELECT ... FOR UPDATE`:
```rust
let item = sqlx::query!(
    "SELECT quantity_ordered, quantity_received FROM purchase_order_items
     WHERE id = $1 AND po_id = $2 FOR UPDATE",
    item.id, po_id
)
.fetch_one(&mut *db_tx).await?;
let remaining = item.quantity_ordered - item.quantity_received;
if qty_to_receive > remaining {
    return Err(AppError::Validation(format!(
        "Cannot receive {} — only {} remaining on this PO line", qty_to_receive, remaining
    )));
}
```

### 4. `create_purchase_order` does not validate that all `item_id`s belong to the same `store_id` scope
**Where:** `src-tauri/src/commands/purchase_orders.rs` — `create_purchase_order()`, item insertion loop
**What:** The payload `items: Vec<PurchaseOrderItemDto>` is iterated and each `item_id` is inserted into `purchase_order_items` without verifying that the item exists in the PO's `store_id` scope (via `item_stock` or `item_settings`). A malformed request — or a bug in the frontend sending item IDs from a different store — will insert PO lines referencing items with no stock record in the target store. When `receive_purchase_order` later attempts `UPDATE item_stock SET quantity = quantity + $1 WHERE item_id = $1 AND store_id = $2`, the UPDATE will affect 0 rows (silently), and stock will not increase even though `quantity_received` was updated. The PO appears fully received but inventory was never restocked.
**Fix:** Before inserting items, validate all `item_id`s against `item_stock`:
```rust
let valid_count: i64 = sqlx::query_scalar!(
    "SELECT COUNT(*) FROM item_stock WHERE item_id = ANY($1) AND store_id = $2",
    &item_ids as &[Uuid], payload.store_id,
)
.fetch_one(&pool).await?;
if valid_count != item_ids.len() as i64 {
    return Err(AppError::Validation(
        "One or more items do not exist in this store's inventory.".into()
    ));
}
```

### 5. `update_purchase_order` allows editing items on a PO that is already `'submitted'` or `'approved'`
**Where:** `src-tauri/src/commands/purchase_orders.rs` — `update_purchase_order()`
**What:** The update command modifies `purchase_order_items` (quantity, unit_cost) for any PO regardless of its current status. A PO that has already been submitted to a supplier or approved by a manager can have its quantities changed after approval, without re-triggering an approval workflow or notifying anyone. This creates a discrepancy between what the supplier received in the official order and what the system now shows, and it violates the audit integrity of the approval process.
**Fix:** Gate item-level edits on status:
```rust
if !["draft", "pending"].contains(&po.status.as_str()) {
    return Err(AppError::Validation(format!(
        "Cannot edit items on a purchase order with status '{}'. Only draft or pending POs can be modified.",
        po.status
    )));
}
```
If changes to approved POs are required, add a separate `amend_purchase_order` command that resets status to `'pending'` and logs the change.

### 6. `get_purchase_orders` total cost calculation uses `SUM(poi.unit_cost * poi.quantity_ordered)` instead of the stored `total_amount`
**Where:** `src-tauri/src/commands/purchase_orders.rs` — `get_purchase_orders()`, the aggregate SELECT
**What:** The list query recalculates the PO total on-the-fly using `SUM(poi.unit_cost * poi.quantity_ordered)`. If a PO's items were edited after creation (quantities or costs changed), the stored `purchase_orders.total_amount` may differ from the recalculated figure. The list shows the recalculated total while the detail page shows `total_amount`. A manager sees ₦250,000 in the list and ₦275,000 in the detail for the same PO. More critically, `purchase_orders.tax_amount` is completely excluded from the list calculation, understating the displayed totals for any PO with tax.
**Fix:** Use the stored columns directly:
```sql
SELECT po.*, po.subtotal, po.tax_amount, po.total_amount,
       s.name AS supplier_name, u.full_name AS created_by_name
FROM purchase_orders po
LEFT JOIN suppliers s ON s.id = po.supplier_id
LEFT JOIN users u ON u.id = po.created_by
WHERE <filters>
ORDER BY po.created_at DESC
LIMIT $n OFFSET $m
```
And ensure `total_amount` is kept consistent on every `update_purchase_order` call.

### 7. `receive_purchase_order` does not update `purchase_orders.status` atomically when all lines are fully received
**Where:** `src-tauri/src/commands/purchase_orders.rs` — `receive_purchase_order()`, post-loop status update
**What:** After the per-item receive loop, the status update logic runs a `SELECT SUM(quantity_received), SUM(quantity_ordered) FROM purchase_order_items WHERE po_id = $1` to decide between `'partially_received'` and `'fully_received'`. This aggregate runs against `&pool` (outside `db_tx`). If another receive call commits between the item updates and this read, the status calculation uses a mix of this transaction's writes and the other transaction's writes, producing an incorrect status. A PO could be marked `'fully_received'` when it isn't, or remain `'partially_received'` when all lines are done.
**Fix:** Run the status aggregate inside `db_tx` using `&mut *db_tx` immediately after the item loop, before committing.

### 8. `delete_purchase_order` does not check for associated `goods_receipt` or `supplier_payment` records before hard-deleting
**Where:** `src-tauri/src/commands/purchase_orders.rs` — `delete_purchase_order()`
**What:** The delete command issues `DELETE FROM purchase_orders WHERE id = $1` without verifying that no `goods_receipts`, `supplier_payments`, or `purchase_order_items` with `quantity_received > 0` reference this PO. If the DB schema does not have `ON DELETE CASCADE` on these child tables (which is likely given that transactions use soft delete), the DELETE will fail with a PostgreSQL FK constraint violation — a raw 500 error surfaced to the user. If `ON DELETE CASCADE` IS configured, deleting a PO with received goods will silently delete those receipt records, making the stock increases invisible in audit queries.
**Fix:** Apply the same soft-delete pattern used elsewhere:
```rust
// Guard: never hard-delete POs with any received items
let received_count: i64 = sqlx::query_scalar!(
    "SELECT COUNT(*) FROM purchase_order_items WHERE po_id = $1 AND quantity_received > 0",
    id
).fetch_one(&pool).await?;
if received_count > 0 {
    return Err(AppError::Validation(
        "Cannot delete a purchase order with received items. Cancel it instead.".into()
    ));
}
// Soft delete for draft/pending POs
sqlx::query!("UPDATE purchase_orders SET is_active = FALSE WHERE id = $1", id)
    .execute(&pool).await?;
```

### 9. `create_purchase_order` reference number generated outside DB transaction — same gap risk as `create_transaction`
**Where:** `src-tauri/src/commands/purchase_orders.rs` — `create_purchase_order()`, reference number generation
**What:** `next_po_ref_no(&pool, payload.store_id)` runs against `&pool` before `db_tx.begin()`. If the subsequent INSERT fails (validation error, FK violation, DB timeout), the sequence counter is incremented but the PO is never created. This produces a gap in the PO reference number sequence (e.g., PO-001, PO-002, PO-004 — PO-003 missing). Accounting teams and auditors treat reference number gaps as red flags indicating deleted or tampered records.
**Fix:** Generate the reference number inside `db_tx` or use a PostgreSQL sequence that rolls back automatically on transaction abort:
```sql
SELECT 'PO-' || LPAD(nextval('po_ref_seq_' || $1::text)::text, 4, '0')
```

### 10. `approve_purchase_order` does not record who approved it or when — approval is anonymous
**Where:** `src-tauri/src/commands/purchase_orders.rs` — `approve_purchase_order()`
**What:** The approval command updates `status = 'approved'` and `updated_at = NOW()` but writes no `approved_by` (FK to `users`) or `approved_at` (TIMESTAMPTZ) to the `purchase_orders` row. The audit log entry may capture the event, but querying "who approved PO-0042?" requires joining `audit_logs` by entity — a fragile, non-indexed lookup. This is a compliance gap: procurement workflows require a named, timestamped approver on every order.
**Fix:** Add `approved_by` (INT REFERENCES users) and `approved_at` (TIMESTAMPTZ) columns to `purchase_orders` and populate them in the approve command:
```rust
sqlx::query!(
    "UPDATE purchase_orders SET status='approved', approved_by=$1, approved_at=NOW() WHERE id=$2",
    claims.user_id, id
).execute(&mut *db_tx).await?;
```

### 11. `receive_purchase_order` does not validate that the receiving user has access to the PO's `store_id`
**Where:** `src-tauri/src/commands/purchase_orders.rs` — `receive_purchase_order()`
**What:** The command fetches the PO by `id` only (`SELECT * FROM purchase_orders WHERE id = $1`), then proceeds to update stock for `po.store_id`. A non-global user (e.g., a stock keeper assigned to Store A) who knows a PO ID from Store B can call `receive_purchase_order` and add stock to Store B's inventory. The `guard_permission` check only verifies the user has `purchase_orders.receive` permission, not that they belong to the PO's store.
**Fix:**
```rust
if !claims.is_global {
    let user_store = claims.store_id.ok_or(AppError::Forbidden)?;
    if po.store_id != user_store {
        return Err(AppError::Forbidden);
    }
}
```

---

## BACKEND UPGRADES (should improve)

### 1. `get_purchase_orders` item count uses a subquery per row (N+1 on the DB side)
The list query uses `(SELECT COUNT(*) FROM purchase_order_items WHERE po_id = po.id) AS item_count` as a correlated subquery. For a store with 500 POs, this executes 500 COUNT subqueries. Replace with a LEFT JOIN aggregate:
```sql
LEFT JOIN (
    SELECT po_id, COUNT(*) AS item_count, SUM(quantity_ordered) AS total_units
    FROM purchase_order_items GROUP BY po_id
) poi_agg ON poi_agg.po_id = po.id
```

### 2. Missing database indexes on core PO filter columns
`get_purchase_orders` filters on `store_id`, `supplier_id`, `status`, `created_by`, and `created_at`. A store with 2,000+ POs will run a full table scan on every page load:
```sql
CREATE INDEX IF NOT EXISTS idx_po_store_created ON purchase_orders(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_po_store_status ON purchase_orders(store_id, status);
CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id, store_id);
CREATE INDEX IF NOT EXISTS idx_po_created_by ON purchase_orders(created_by, store_id);
CREATE INDEX IF NOT EXISTS idx_po_items_po_id ON purchase_order_items(po_id);
```

### 3. `get_purchase_order_stats` counts are all-time with no time window, identical problem to the transactions stats
`get_purchase_order_stats` returns lifetime counts for `draft`, `pending`, `approved`, `partially_received`, `fully_received`, and `cancelled`. For a store that has been running for a year, the dashboard shows "Fully Received: 1,847" which is meaningless as a current-state indicator. Add optional `date_from`/`date_to` params, and add a `pending_value` aggregate (SUM of `total_amount` for pending POs) which is the operationally relevant KPI — "how much money is outstanding in open POs?"

### 4. `update_purchase_order` recalculates `total_amount` in application code instead of a DB expression
The Rust code iterates items to sum `unit_cost * quantity_ordered`, then writes the total back. This is fragile: if an item is added/removed in a separate call that isn't routed through this function, the stored total will diverge. Use a DB trigger or recalculate via a single UPDATE-from-SELECT inside the same transaction:
```sql
UPDATE purchase_orders SET
    subtotal = (SELECT COALESCE(SUM(unit_cost * quantity_ordered), 0)
                FROM purchase_order_items WHERE po_id = $1),
    total_amount = subtotal + tax_amount - discount_amount,
    updated_at = NOW()
WHERE id = $1
```

### 5. `receive_purchase_order` uses a per-item `SELECT track_stock` loop outside the transaction (same N+1 as partial_refund)
For each item being received, a separate `SELECT track_stock FROM item_settings WHERE item_id = $1` is run against `&pool`. Batch this before the loop:
```rust
let tracked: std::collections::HashSet<Uuid> = sqlx::query_scalar!(
    "SELECT item_id FROM item_settings WHERE item_id = ANY($1) AND track_stock = TRUE",
    &item_ids as &[Uuid],
)
.fetch_all(&mut *db_tx).await?.into_iter().collect();
```

### 6. `get_purchase_orders` duplicates the WHERE clause in the COUNT and data queries
The filter conditions (`store_id`, `status`, `supplier_id`, `search`, `date_from`, `date_to`) are written identically in both the `SELECT COUNT(*)` and the `SELECT po.*` query. Any filter change must be applied twice. Refactor into a CTE or a Rust helper that builds the shared predicate once.

### 7. `get_purchase_order` (single record) fetches items in a separate query after fetching the PO header — two round-trips
`get_purchase_order` first fetches the PO header, then calls `fetch_po_items(&pool, id)`. Use a single query with JSON aggregation to return the PO and its items in one round-trip:
```sql
SELECT po.*, json_agg(poi.* ORDER BY poi.id) AS items
FROM purchase_orders po
LEFT JOIN purchase_order_items poi ON poi.po_id = po.id
WHERE po.id = $1
GROUP BY po.id
```

### 8. `create_purchase_order` does not enforce a minimum order value or line quantity
There is no guard against creating a PO with `quantity_ordered = 0` on any line, or a PO with a `total_amount = 0`. A zero-quantity PO line will pass all DB constraints and create a dangling record that confuses receive workflows. Validate in Rust before insertion:
```rust
for item in &payload.items {
    if item.quantity_ordered <= Decimal::ZERO {
        return Err(AppError::Validation(format!(
            "Item '{}': quantity must be greater than zero.", item.item_id
        )));
    }
    if item.unit_cost < Decimal::ZERO {
        return Err(AppError::Validation(format!(
            "Item '{}': unit cost cannot be negative.", item.item_id
        )));
    }
}
```

### 9. `approve_purchase_order` has no guard against approving your own PO (self-approval)
A user who created a PO can also approve it if they have the `purchase_orders.approve` permission. Most procurement policies require a different person to approve orders they didn't create (four-eyes principle):
```rust
if po.created_by == claims.user_id {
    return Err(AppError::Validation(
        "You cannot approve a purchase order you created. Another authorised user must approve it.".into()
    ));
}
```
This should be configurable via `store_settings.require_po_approval_by_different_user`.

### 10. `get_purchase_orders` search filter does a `ILIKE '%term%'` on `suppliers.name` without a trigram index
The search query does `s.name ILIKE $1` where `$1 = format!("%{}%", search_term)`. For tables with thousands of suppliers, this is a full table scan on every keystroke. Add a GIN trigram index:
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_suppliers_name_trgm ON suppliers USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_po_ref_no_trgm ON purchase_orders USING GIN (reference_no gin_trgm_ops);
```

---

## BACKEND FEATURES (add for completeness)

### 1. No supplier return / debit note capability
There is no `return_to_supplier` command. When goods received against a PO are found to be defective or over-delivered, there is no structured way to return them. A supplier return should: create a `supplier_returns` record linked to the original PO, deduct `item_stock`, write an `item_history` entry with `event_type = 'SUPPLIER_RETURN'`, reduce `purchase_order_items.quantity_received`, and optionally generate a debit note for accounting. Without this, stock keepers manually adjust inventory with no paper trail linking the adjustment to the supplier event.

### 2. No PO approval workflow — no configurable approval thresholds
There is no `store_settings` gating around PO approval. Orders of ₦500 and orders of ₦5,000,000 both go through the same single-level `approve` command. Production procurement systems require tiered approval: e.g., manager can approve up to ₦100,000, GM up to ₦500,000, admin for anything above. Add `po_approval_threshold_manager`, `po_approval_threshold_gm` to `store_settings` and enforce them in `approve_purchase_order`.

### 3. No `expected_delivery_date` enforcement or overdue PO detection
The `purchase_orders` table has an `expected_delivery_date` column but no background process flags POs that are past their delivery date as `'overdue'`. There is no `get_overdue_purchase_orders` command for the dashboard. Add a scheduled command (called on app startup or nightly) that sets `status = 'overdue'` for submitted/approved POs past their `expected_delivery_date`, and an alert surface for managers.

### 4. No goods receipt note (GRN) document generation
When a PO is received, no formal GRN record is created separate from the PO itself. A `goods_receipts` table should record: `po_id`, `received_by`, `received_at`, `notes`, and a child `goods_receipt_items` table with per-item quantities and condition. This is the document handed to the store's accounting team. Currently, `receive_purchase_order` updates the PO inline with no separate receipt record, making it impossible to reconstruct "what was received on which date by whom" for a PO that was received in multiple batches.

### 5. No `unit_cost` variance alert when received cost differs from ordered cost
The receive payload includes `actual_unit_cost` per item but there is no comparison to `purchase_order_items.unit_cost` (the cost at time of order). A supplier invoice arriving at a different price than the PO should trigger a cost variance alert — either blocking the receive pending manager approval, or writing a `cost_variances` record for accounting review. Without this, price discrepancies between PO and invoice are silently absorbed.

### 6. Voids and receives are never queued for cloud sync
`receive_purchase_order`, `approve_purchase_order`, `cancel_purchase_order`, and `create_purchase_order` do not call `crate::database::sync::queue_row(...)`. The Supabase replica never learns about PO state changes. Cloud-based procurement dashboards and multi-store analytics see every PO as perpetually `'draft'`. This is identical to the transactions sync gap (Transactions Fault #11) and has the same consequences.

### 7. No `last_purchase_cost` update on `items` table when a PO is received
When `receive_purchase_order` commits, it should update `items.last_purchase_cost = poi.unit_cost` and `items.last_supplier_id = po.supplier_id` for each received item. Without this, the items table never learns the most recent procurement cost, making margin calculations and reorder cost estimates stale.

### 8. No automatic reorder point triggering
There is no mechanism to automatically create a draft PO (or alert) when `item_stock.quantity` drops below `item_settings.reorder_point`. The `receive_purchase_order` flow could check post-receive levels and flag items approaching reorder, but currently does nothing. Add a post-receive scan that writes to an `reorder_alerts` table for any item whose `quantity < reorder_point` in the relevant store.

### 9. No per-PO payment tracking or integration with `supplier_payments`
A PO has a `total_amount` but no `amount_paid`, `payment_status`, or link to `supplier_payments`. It is impossible to query "which POs have unpaid invoices?" or "how much do we owe Supplier X across all open POs?" Add a `supplier_payments` child table (`po_id`, `amount`, `payment_method`, `paid_at`, `paid_by`, `reference`) and a `payment_status` enum on `purchase_orders` (`'unpaid'`, `'partial'`, `'paid'`).

### 10. No audit log entry in `cancel_purchase_order` for the cancellation reason
`cancel_purchase_order` updates the status but may not require or record a `cancellation_reason`. Procurement cancellations require documentation ("supplier unable to fulfil", "budget cut", "wrong items ordered"). Add a mandatory `reason` field to the cancel DTO and write it to `audit_logs` and a `cancelled_reason` column on `purchase_orders`.

---

## FRONTEND FAULTS (must fix before production)

### 1. `ReceiveItemsModal` maximum quantity uses `item.quantity_ordered` instead of `item.quantity_ordered - item.quantity_received`
**Where:** `src/features/purchase-orders/PurchaseOrderDetailPanel.jsx` — `ReceiveItemsModal`, the `maxReceivable` derivation
**What:** `const maxReceivable = parseFloat(item.quantity_ordered)`. For a PO where 30 units were already received in a prior partial receive, the modal still allows entry up to the full `quantity_ordered` (e.g., 100). A stock keeper entering 100 for a second receive will be blocked by the backend (Fault #3), but the modal gives no visual feedback that only 70 remain. The input should cap at `quantity_ordered - quantity_received` and display a "X units already received" note.
**Fix:**
```js
const alreadyReceived = parseFloat(item.quantity_received ?? 0);
const maxReceivable = parseFloat(item.quantity_ordered) - alreadyReceived;
// Display: "{alreadyReceived} already received — {maxReceivable} remaining"
```

### 2. `PurchaseOrdersPanel` status badge for `'partially_received'` renders as unstyled plain text
**Where:** `src/features/purchase-orders/PurchaseOrdersPanel.jsx` — `StatusBadge` component or inline badge
**What:** The `STATUS_COLORS` map covers `'draft'`, `'pending'`, `'approved'`, `'fully_received'`, and `'cancelled'`. The `'partially_received'` status falls through to a default case and renders as unstyled text or the wrong color class. In a list of POs, partially received orders are indistinguishable from completed or draft ones.
**Fix:** Add to the status color map:
```js
partially_received: "bg-warning/15 text-warning border-warning/30",
overdue: "bg-destructive/15 text-destructive border-destructive/30",
```

### 3. Search input does not reset page to 1 on new search — identical to Transactions Fault #3
**Where:** `src/features/purchase-orders/PurchaseOrdersPanel.jsx` — `handleSearchChange`
**What:** `setUrlSearch(val)` is called after the debounce without `setPage(1)`. A user on page 3 who types a new supplier name will query page 3 of results and see zero rows if the match set is smaller than the page offset. Identical fix:
```js
debounceTimer.current = setTimeout(() => {
  setUrlSearch(val);
  setPage(1);
}, 400);
```

### 4. `PurchaseOrderDetailPanel` shows no loading skeleton — flashes empty state on navigation
**Where:** `src/features/purchase-orders/PurchaseOrderDetailPanel.jsx`
**What:** While `useQuery` for the PO detail is loading, the component renders the `!po` branch which shows an `EmptyState` ("No purchase order selected"). On fast navigation between list and detail, there is a visible flash of the empty state before the data arrives. A skeleton loader matching the two-column detail layout should be shown during `isLoading`.

### 5. `CreatePurchaseOrderModal` allows form submission with zero items in the items list
**Where:** `src/features/purchase-orders/PurchaseOrdersPanel.jsx` — `CreatePurchaseOrderModal`
**What:** The submit button is gated on `supplier_id` being set and a `notes` field (optional), but the `items` array length is not validated. A user who selects a supplier and immediately clicks "Create PO" without adding any items sends a `{ supplier_id, items: [] }` payload. The backend may create an empty PO (no `purchase_order_items` rows) or throw a generic error. Either way, the user sees no clear validation message.
**Fix:**
```js
const isValid = supplierId && items.length > 0 && items.every(i => i.quantity_ordered > 0);
// Show inline: "Add at least one item to create a purchase order."
```

### 6. Editing a PO item's quantity in `EditPOModal` does not recalculate and display the updated line total in real time
**Where:** `src/features/purchase-orders/PurchaseOrderDetailPanel.jsx` — `EditPOModal` (or `EditPurchaseOrderPage`)
**What:** When a user changes `quantity_ordered` or `unit_cost` in the edit form, the `line_total` column in the items table still shows the old value from the fetched data. The `subtotal` and `total_amount` summary at the bottom also do not update. The user has no confirmation of what the PO will cost after their edits until they save and the detail panel refetches.
**Fix:** Derive totals from local form state in a `useMemo`:
```js
const lineTotal = (item.unit_cost * item.quantity_ordered).toFixed(2);
const subtotal = items.reduce((sum, i) => sum + i.unit_cost * i.quantity_ordered, 0);
```

### 7. `ApprovePOButton` is visible to cashiers who lack `purchase_orders.approve` permission
**Where:** `src/features/purchase-orders/PurchaseOrderDetailPanel.jsx`
**What:** The "Approve" action button is rendered conditionally on `po.status === 'pending'` but not on `usePermission('purchase_orders.approve')`. A cashier viewing a PO detail sees the Approve button, clicks it, and receives a 403 error from the backend. The button should be hidden (not just disabled) for users without the permission.
**Fix:**
```js
const canApprove = usePermission("purchase_orders.approve");
{canApprove && po.status === "pending" && <ApproveButton />}
```

### 8. `PurchaseOrderDetailPanel` does not handle the `'overdue'` status — no visual indicator or alert banner
**Where:** `src/features/purchase-orders/PurchaseOrderDetailPanel.jsx`
**What:** If the backend adds `'overdue'` as a status (or it already exists), the detail panel has no branch for it. The page renders the same layout as an approved PO with no alert banner communicating that the expected delivery date has passed. An overdue PO should render a destructive banner: "⚠ This order is overdue — expected {expected_delivery_date}."

### 9. Supplier search in `CreatePurchaseOrderModal` is a plain `<select>` — unusable with hundreds of suppliers
**Where:** `src/features/purchase-orders/PurchaseOrdersPanel.jsx` — `CreatePurchaseOrderModal`, supplier field
**What:** Supplier selection is implemented as a `<select>` populated from `useSuppliers()`. For a business with 200+ suppliers, scrolling through a native select to find "Dangote Flour Mills Ltd" is unusable. Replace with a combobox / autocomplete (shadcn `<Command>` + popover) that filters suppliers by name as the user types.

### 10. `clearFilters` in `PurchaseOrdersPanel` does not reset the supplier select or status select to their default values visually
**Where:** `src/features/purchase-orders/PurchaseOrdersPanel.jsx` — `FilterBar`
**What:** `clearFilters` calls `setSupplierId(null)`, `setStatus(null)`, and `setPage(1)`. However, the `<Select>` components for supplier and status use `value={supplierId}` and `value={status}`. If these selects were constructed with `defaultValue` instead of `value` (i.e., uncontrolled), clearing the Zustand/URL state does not update the visible selected option. The user sees the old filter value displayed in the dropdown while the data has already reset. Ensure all filter controls are fully controlled (`value=` not `defaultValue=`).

---

## FRONTEND UPGRADES (should improve)

### 1. No stat cards / KPI widgets at the top of `PurchaseOrdersPage`
The page goes straight to the filter bar and table with no summary section. A stock manager needs to see at a glance: "Open POs: 12 | Pending Approval: 3 | Overdue: 1 | Total Outstanding Value: ₦1,240,000." Add a 4-card stat row above the table, sourced from `usePurchaseOrderStats()`, matching the card design used on TransactionsPage.

### 2. Tab-based status filter is missing — the dropdown status filter is low-discoverability
Transactions, Returns, and other modules use a tab strip for status filtering (All / Draft / Pending / Approved / Received / Cancelled). Purchase Orders uses a dropdown which requires two clicks and gives no visual count per status. Replace or supplement with a tab strip using counts from `po_stats`:
```js
const STATUS_TABS = [
  { label: "All", value: null },
  { label: "Draft", value: "draft" },
  { label: "Pending", value: "pending" },
  { label: "Approved", value: "approved" },
  { label: "Partially Received", value: "partially_received" },
  { label: "Fully Received", value: "fully_received" },
  { label: "Overdue", value: "overdue" },
  { label: "Cancelled", value: "cancelled" },
]
```

### 3. `PurchaseOrderDetailPanel` items table shows no "Remaining to Receive" column
The items table in the detail view shows `quantity_ordered` and `quantity_received` but not the derived `quantity_ordered - quantity_received`. A stock keeper physically counting goods cannot quickly see what is still outstanding without mental arithmetic for every line. Add a "Remaining" column with a progress bar:
```js
const remaining = item.quantity_ordered - item.quantity_received;
const pct = (item.quantity_received / item.quantity_ordered) * 100;
// Progress bar: bg-primary filled to pct%
```

### 4. `PurchaseOrdersPanel` table has no sortable columns despite the data being sortable
The table renders `reference_no`, `created_at`, `total_amount`, and `supplier_name` with no sort interaction. All of these have obvious sort orderings that managers use: sort by value descending to find large orders, sort by date to see recent activity. Add `orderBy` / `sortDir` state and pass to the backend query which should support `ORDER BY po.{column} {direction}`.

### 5. No empty state guidance when `supplier_id` filter returns no POs
When a supplier filter is active and returns no results, the generic `EmptyState` "No purchase orders found" is shown. It should contextually suggest: "No purchase orders for this supplier. [Create one →]" with a CTA pre-filled with the selected supplier.

### 6. `ReceiveItemsModal` has no "Receive All" shortcut
When a full delivery arrives, a stock keeper must manually enter the remaining quantity for each item. A single "Receive All Remaining" button that sets every item's `quantity_to_receive` to its `maxReceivable` value saves significant data entry time in high-volume receiving scenarios.

### 7. `PurchaseOrderDetailPanel` has no print/export action for the PO document
A supplier often requires the PO in printed or PDF form. There is no "Print PO" or "Export PDF" button. The receipt printer is for customer-facing documents; POs need A4-format documents with supplier address, line items, total, terms, and authorization signature line. This should open a `window.print()` optimised layout or generate a PDF via the backend.

### 8. No inline edit of items directly in the detail view — edit is only available through a separate modal/page
Changing a single item's quantity requires opening the full edit modal, finding the item, updating it, and saving the entire PO. For quick adjustments to a single line, allow inline editing directly in the items table row (click quantity → editable input → blur to save) for POs in `'draft'` or `'pending'` status.

### 9. Supplier contact details are not surfaced on `PurchaseOrderDetailPanel`
The detail panel shows supplier name but not phone, email, or address. When a manager needs to follow up on a delayed order, they must navigate to the Suppliers page to get contact info. Add a collapsible "Supplier Contact" card on the PO detail showing phone, email, and the supplier's primary contact person.

### 10. No activity/history timeline on `PurchaseOrderDetailPanel`
Similar to the missing transaction activity log, there is no timeline showing: "Created by Emeka on Apr 20 → Submitted for approval → Approved by Chioma on Apr 21 → 40/100 units received on Apr 25." Without this, understanding the PO lifecycle requires querying `audit_logs` directly.

---

## FRONTEND FEATURES (add for completeness)

### 1. No duplicate PO detection or "order already exists for this supplier" warning
If a user creates two POs for the same supplier in the same week with the same items, there is no deduplication alert. A stock keeper returning from lunch may not realise a PO was already created by a colleague. Add a `potential_duplicate_check` on `CreatePurchaseOrderModal` open: query for recent open POs for the selected supplier and show a warning banner if found.

### 2. No bulk receive mode for multiple POs from the same delivery
When a truck delivers goods for three separate POs simultaneously, a stock keeper must open and receive each PO individually. Add a "Bulk Receive" mode reachable from the list (multi-select checkboxes + "Receive Selected") that aggregates all items from the selected POs into a single receiving workflow.

### 3. No CSV / PDF export for the PO list
Procurement managers regularly need to export PO history for accounting, auditing, or board reports. Add an "Export" button to the filter bar that calls `getPurchaseOrders({ ...currentFilters, limit: 5000 })` and generates a CSV download, or a backend `export_purchase_orders_pdf` command for a formatted A4 report.

### 4. No "Reorder" action to quickly create a new PO from a previous one
Repeat orders from the same supplier with the same items are very common. A "Reorder" button on the detail page of a fully received PO should pre-populate `CreatePurchaseOrderModal` with the same supplier and items (quantities and costs from the last order), saving significant data entry.

### 5. No cost variance display when received cost differs from ordered cost
If the backend adds `actual_unit_cost` to the receive flow, the detail panel should show a variance indicator per line: "Ordered: ₦450 | Received at: ₦480 (+₦30, +6.7%)" highlighted in warning or destructive color to flag invoice discrepancies.

### 6. No supplier performance dashboard or quick stats
On the PO list, there is no way to see at a glance which suppliers have the most overdue deliveries, the highest order volumes, or the best on-time delivery rate. Add a "Supplier Insights" panel or a dedicated supplier drilldown from the PO list.

### 7. No notification or in-app alert when a PO reaches its expected delivery date without being received
There is no mechanism to surface overdue POs to the stock keeper on login or on the home dashboard. Add an overdue PO count to the app sidebar badge (similar to a notification count) and a dedicated alert card on the dashboard.

### 8. No item-level note field in `ReceiveItemsModal` for documenting condition of received goods
When receiving damaged, expired, or short-shipped items, there is nowhere to note the issue per line. Add a collapsible `notes` text field per item in the receive modal: "2 units arrived damaged — see photos in GRN folder." This note should be stored on `goods_receipt_items.condition_notes`.

### 9. No "Expected vs Received" summary chart on `PurchaseOrderDetailPanel`
A simple horizontal bar chart per item showing ordered quantity (full bar) vs received quantity (filled portion) gives instant visual feedback on fulfilment progress, especially useful for partially received POs with 20+ line items.

### 10. No PO template / saved order capability
Recurring orders (weekly produce, monthly stationery) require the same data entry every cycle. A "Save as Template" action on a completed PO, and a "Create from Template" option on the create modal, would eliminate repetitive data entry for predictable procurement cycles.

---

## CROSS-CUTTING RISKS

### 1. Multi-store isolation — `get_purchase_order` (single record) has no `store_id` scope check
`get_purchase_order(id)` fetches by `id` only. A cashier from Store A with a known PO ID from Store B can fetch that PO's full details — supplier, items, costs, notes. The backend's permission check only verifies `purchase_orders.read` permission, not store membership. This is the same class of vulnerability as Transactions Cross-Cutting Risk #1. Add:
```rust
if !claims.is_global {
    let user_store = claims.store_id.ok_or(AppError::Forbidden)?;
    if po.store_id != user_store { return Err(AppError::Forbidden); }
}
```

### 2. Sync safety — all PO mutations are absent from `sync_queue`
`create_purchase_order`, `receive_purchase_order`, `approve_purchase_order`, and `cancel_purchase_order` do not write to `sync_queue`. The Supabase cloud replica sees every PO as perpetually draft with zero received quantities. Multi-store procurement analytics, cloud backup, and any external dashboard are permanently stale for this module. Every mutation must call `queue_row(...)` with `operation = "UPSERT"` on the affected `purchase_orders` and `purchase_order_items` rows after `db_tx.commit()`.

### 3. Offline resilience — creating a PO offline and then receiving it online can orphan the receive
If a PO is created while offline (written locally only, sync pending), then a receive is attempted before the PO has synced to Supabase, the `sync_queue` will have both a PO create and a PO update event. If the PO create fails on Supabase (e.g., FK violation because the supplier doesn't exist in the cloud yet), the PO update (receive) will also fail. The local database shows the PO as received; the cloud shows it as non-existent. Add a dependency-ordered sync flush (sync `purchase_orders` before `purchase_order_items` before `goods_receipts`) matching the tier ordering already used in `create_transaction`.

### 4. Data consistency — `item_stock.quantity` and `purchase_order_items.quantity_received` can diverge after a receive failure
If `receive_purchase_order` updates `item_stock` but then fails on the `purchase_order_items` UPDATE (or vice versa), and if these operations are not fully inside `db_tx`, the stock and the PO will be out of sync. Verify that every `item_stock` UPDATE and every `purchase_order_items` UPDATE in `receive_purchase_order` are inside the same `db_tx` with no intermediate `pool` calls.

### 5. Security — `create_purchase_order` and `receive_purchase_order` use `guard_permission` but `get_held_purchase_orders` (if it exists) may use `guard()` only, same risk as Transactions Cross-Cutting Risk #3
Verify that every PO command uses `guard_permission(...)` rather than `guard(...)`. Any command accessible with only a valid JWT (no permission check) can be called by any authenticated session, including read-only or compromised tokens.

### 6. Data consistency — `purchase_orders.total_amount` is not recomputed when a PO line item is deleted during editing
If `update_purchase_order` allows removing an item from the items list, the `total_amount` on the parent PO must be recalculated. If the recalculation runs in application code against data fetched before the deletion, it may include the deleted item's cost in the total. Use a DB-side recalculation (see Backend Upgrade #4) that runs after all item mutations in the same transaction.

### 7. Offline resilience — the `reference_no` sequence for POs may produce collisions in multi-device offline scenarios
If two devices both create POs while offline (both calling `next_po_ref_no` against their local PostgreSQL), they may generate the same reference number (e.g., both produce `PO-0043`). When both sync to Supabase, one will fail with a unique constraint violation. The sync resolution should detect this and reassign the reference number using a cloud-side sequence, then propagate the corrected reference back.

---

## PRIORITY ORDER

These are the top 5 items that MUST be addressed before this module is production-ready, ordered by severity:

1. **[BACKEND FAULT #1] `receive_purchase_order` writes no `item_history` record** — Every stock increase from a received PO is invisible in inventory history. Audits, shrinkage reports, and regulatory compliance reviews will show stock increasing with no documented cause. For a POS system where inventory accuracy is the foundation of the stock-keeping workflow, untracked stock movements are a P0 data integrity failure. The fix is mechanical: add the canonical `item_history` INSERT inside the receive loop.

2. **[BACKEND FAULT #2] Cancelling a `partially_received` PO does not roll back received stock** — A PO that received 40 of 100 units before cancellation leaves 40 phantom units in inventory permanently. There is no stock adjustment, no item history entry, and no indication in the UI that these units require a decision. In a multi-store operation, this silently inflates inventory across every cancelled partial PO, corrupting stock counts and expected margin calculations indefinitely.

3. **[CROSS-CUTTING RISK #2] All PO mutations are absent from `sync_queue`** — The Supabase cloud replica has no knowledge of any PO creation, approval, or receive event. For a platform that explicitly markets bidirectional cloud sync as a core feature, a whole module operating completely outside the sync architecture is a silent, worsening data corruption issue. Every PO processed in production widens the gap. This must be fixed before any real store uses the system.

4. **[BACKEND FAULT #3] Race condition in `receive_purchase_order` allows over-receiving** — Concurrent receive operations on the same PO (two stock keepers, or a double-click on the Receive button) can both pass the `quantity_remaining` check and together commit a total received count exceeding `quantity_ordered`. The stock table will hold quantities that no PO authorised, and the discrepancy is unrecoverable without manual intervention. Moving the check inside `db_tx` with `FOR UPDATE` is a one-line fix with critical correctness implications.

5. **[BACKEND FAULT #11 + CROSS-CUTTING RISK #1] Store isolation not enforced on `receive_purchase_order` and `get_purchase_order`** — A non-global user can receive goods against a PO from a different store, adding inventory to a store they don't manage. Combined with the missing store scope check on the read endpoint, a malicious or misconfigured client can read any store's procurement data and write stock to any store. Both the read and the write path must enforce `claims.store_id == po.store_id` for non-global users.
