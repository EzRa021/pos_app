# Quantum POS — Production Audit: Suppliers Module

**Audited:** 2026-04-29
**Scope:** `src-tauri/src/commands/suppliers.rs`, `src-tauri/src/commands/supplier_payments.rs`, `src-tauri/src/models/supplier.rs`, `src-tauri/src/models/supplier_payment.rs`, migrations 0006/0041, `src/features/suppliers/*`, `src/features/supplier_payments/*`

---

## BACKEND FAULTS (must fix before production)

### 1. `generate_supplier_code` has a race condition and does not scope by `store_id` — cross-store collisions guaranteed
**Where:** `commands/suppliers.rs`, `generate_supplier_code()`
**What:** The function does `SELECT supplier_code FROM suppliers ORDER BY id DESC LIMIT 1` with no `store_id` filter. Two stores could have suppliers `SUP-0001` through `SUP-0005`. When Store B adds its first supplier, it reads Store A's `SUP-0005` and generates `SUP-0006` — skipping five numbers. When two concurrent `create_supplier` calls land simultaneously (e.g., from two tabs), both read the same last code and generate the same `SUP-NNNN`. There is no unique constraint on `(store_id, supplier_code)` in the schema (migration 0006), so both inserts succeed and you have two suppliers with the same code.
**Fix:**
```sql
-- Add in a new migration:
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS supplier_code VARCHAR(50);
CREATE UNIQUE INDEX IF NOT EXISTS ux_suppliers_code_store ON suppliers(store_id, supplier_code);
```
And in Rust, scope the generation query:
```rust
let last: Option<String> = sqlx::query_scalar!(
    "SELECT supplier_code FROM suppliers WHERE store_id = $1 ORDER BY id DESC LIMIT 1",
    store_id
).fetch_optional(pool).await?;
```
Then wrap the SELECT + INSERT in a transaction with an advisory lock or catch the unique constraint violation (pgcode 23505) and return `AppError::Conflict`.

### 2. `supplier_code` column added in Rust but not defined in migration 0006 — schema is out of sync
**Where:** Migration `0006_customers_suppliers.sql` vs `commands/suppliers.rs` `fetch_supplier()` and `create_supplier()`
**What:** Migration 0006 does NOT define `supplier_code` on the `suppliers` table. The Rust code SELECTs and INSERTs `supplier_code`. This means the column must have been added in a later migration that was not included in the audit scope. If that migration is missing from any deployment (e.g., a fresh local setup skips a migration), sqlx will panic at startup with "column supplier_code does not exist". Verify the column exists in a documented migration and add it to the `.sqlx` cache.
**Fix:** Confirm the column was added in a specific migration (e.g., `0010_add_supplier_code.sql`). If it was added ad-hoc without a migration file, create one immediately:
```sql
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS supplier_code VARCHAR(50);
```

### 3. `supplier_payments.rs` does not validate the `po_id` belongs to the correct supplier and store
**Where:** `commands/supplier_payments.rs`, `record_supplier_payment()`
**What:** `po_id` is optional and, when supplied, inserted directly into `supplier_payments.po_id` without verifying: (a) that the PO exists, (b) that `po.supplier_id == payload.supplier_id`, or (c) that `po.store_id == payload.store_id`. A user can link a payment to a PO from a completely different supplier, corrupting the financial linkage.
**Fix:** Before the INSERT, add:
```rust
if let Some(po_id) = payload.po_id {
    let valid = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM purchase_orders WHERE id = $1 AND supplier_id = $2 AND store_id = $3)",
        po_id, payload.supplier_id, payload.store_id,
    ).fetch_one(&mut *tx).await?.unwrap_or(false);
    if !valid {
        return Err(AppError::Validation("PO does not belong to this supplier or store".into()));
    }
}
```

### 4. `record_supplier_payment` uses `GREATEST(...balance - $1, 0)` — overpayments silently clamp to zero and lose the excess
**Where:** `commands/supplier_payments.rs`, `record_supplier_payment()`
**What:** `SET current_balance = GREATEST(COALESCE(current_balance, 0) - $1, 0)` means paying ₦50,000 against a ₦20,000 balance silently drops the balance to ₦0 instead of recording a ₦30,000 credit (overpayment). The excess payment is permanently lost from the balance — the payment record shows ₦50,000 paid but the balance shows ₦0. There is no overpayment flag or credit memo.
**Fix:** Either (a) warn and reject overpayments:
```rust
let current: Decimal = sqlx::query_scalar!("SELECT COALESCE(current_balance, 0) FROM suppliers WHERE id = $1 FOR UPDATE", payload.supplier_id)
    .fetch_one(&mut *tx).await?.unwrap_or_default();
if amount > current {
    return Err(AppError::Validation(format!(
        "Payment of ₦{} exceeds outstanding balance of ₦{}",
        amount.round_dp(2), current.round_dp(2)
    )));
}
```
Or (b) allow overpayment and record `credit_balance = balance - amount` when negative. The business logic should dictate which, but silently clamping to ₦0 is wrong either way.

### 5. `delete_supplier` has a TOCTOU race condition between the PO count check and the DELETE
**Where:** `commands/suppliers.rs`, `delete_supplier()`
**What:** The function does `SELECT COUNT(*) FROM purchase_orders WHERE supplier_id = $1` then conditionally `DELETE FROM suppliers WHERE id = $1` — two separate queries with no transaction. Between the count and the delete, another user could create a PO for this supplier. The supplier would then be hard-deleted while a PO still references it, causing a foreign key violation (if the FK has `ON DELETE RESTRICT`) or orphaned POs (if not constrained).
**Fix:** Wrap in a transaction and use a CTE:
```rust
let mut tx = pool.begin().await?;
let po_count: i64 = sqlx::query_scalar!(
    "SELECT COUNT(*) FROM purchase_orders WHERE supplier_id = $1 FOR UPDATE", id
).fetch_one(&mut *tx).await?.unwrap_or(0);
// ... rest of logic inside transaction
tx.commit().await?;
```

### 6. `get_supplier_stats` and `get_supplier_spend_timeline` have no store-boundary check — any authenticated user can query any supplier's financials
**Where:** `commands/suppliers.rs`, `get_supplier_stats()` and `get_supplier_spend_timeline()`
**What:** Both commands accept `id: i32` and guard with `suppliers.read` permission, but do not verify that the supplier belongs to the caller's store. A non-global cashier from Store A can call `getSupplierStats(999)` where supplier 999 belongs to Store B and receive full purchase order history, lead times, and spend data.
**Fix:** After `guard_permission`, verify store ownership:
```rust
let sup_store: Option<i32> = sqlx::query_scalar!("SELECT store_id FROM suppliers WHERE id = $1", id)
    .fetch_optional(&pool).await.ok().flatten();
if !claims.is_global {
    if sup_store != claims.store_id {
        return Err(AppError::Forbidden);
    }
}
```

### 7. `search_suppliers` does not filter by `store_id` — returns suppliers from all stores
**Where:** `commands/suppliers.rs`, `search_suppliers()`
**What:** The query has no `store_id` filter — it returns active suppliers across ALL stores. If a PO autocomplete uses `search_suppliers`, a cashier at Store A can see and select suppliers that belong to Store B.
**Fix:** Accept `store_id: Option<i32>` as a parameter and add `AND ($2::int IS NULL OR store_id = $2)` to the WHERE clause. Make the RPC call from the frontend always pass the current store ID.

### 8. `update_supplier` writes the audit log with `None` as `store_id` — audit log is unscoped
**Where:** `commands/suppliers.rs`, `update_supplier()`
**What:**
```rust
write_audit_log(&pool, claims.user_id, None, "update", "supplier", ...)
```
The `store_id` is `None`, meaning this audit entry is not associated with any store. The audit log viewer filtered by store will never show supplier update events. The function even fetches the correct `store_id` from the DB immediately after — it should pass it to the audit log.
**Fix:** Reorder: fetch `store_id` first, then write the audit log with it:
```rust
let supplier = fetch_supplier(&pool, id).await?;
write_audit_log(&pool, claims.user_id, Some(supplier.store_id), "update", "supplier", ...).await;
```

### 9. `get_supplier_balance` does not scope `supplier_payments` JOIN by `store_id` — cross-store payment totals inflate `total_paid`
**Where:** `commands/supplier_payments.rs`, `get_supplier_balance()`
**What:** The query LEFT JOINs `supplier_payments sp ON sp.supplier_id = s.id` with no `sp.store_id = $1` filter. If a supplier exists in multiple stores (same supplier entity, multiple `store_id` rows — unlikely but possible via sync), or if payments were recorded by multiple stores against the same supplier, `total_paid` aggregates payments from ALL stores. The `SupplierPaymentsSection` on the detail page will show an inflated "Total Paid" figure.
**Fix:**
```sql
LEFT JOIN supplier_payments sp ON sp.supplier_id = s.id AND sp.store_id = s.store_id
```

### 10. `Decimal::try_from(payload.amount).unwrap_or_default()` silently converts NaN/Infinity to ₦0 in `record_supplier_payment`
**Where:** `commands/supplier_payments.rs`, `record_supplier_payment()`
**What:** `payload.amount <= 0.0` is checked before the `Decimal::try_from` conversion. But `f64::NAN <= 0.0` is `false` in Rust, so a `NaN` amount passes the check, then `Decimal::try_from(f64::NAN).unwrap_or_default()` returns `Decimal::ZERO`. The function inserts a ₦0 payment and decrements the supplier balance by ₦0 — a silent no-op recorded in the audit trail.
**Fix:**
```rust
if !payload.amount.is_finite() || payload.amount <= 0.0 {
    return Err(AppError::Validation("Payment amount must be a positive finite number".into()));
}
let amount = Decimal::try_from(payload.amount)
    .map_err(|_| AppError::Validation("Invalid payment amount".into()))?;
```

---

## BACKEND UPGRADES (should improve)

### 1. `generate_supplier_code` uses sequential global IDs — codes become meaningless in multi-store setups
With fault #1 fixed (scoped to `store_id`), codes would restart at `SUP-0001` per store. Consider a more informative format: `{STORE_CODE}-SUP-{NNN}` (e.g., `LAG-SUP-001`) so codes are self-identifying when shared across stores in reports.

### 2. `get_suppliers` duplicates the WHERE clause in count and data queries — maintenance hazard
Same pattern as other modules. Extract into a CTE:
```sql
WITH filtered AS (
  SELECT * FROM suppliers WHERE <conditions>
)
SELECT *, COUNT(*) OVER () AS total_count FROM filtered
ORDER BY supplier_name LIMIT $4 OFFSET $5
```

### 3. Missing index on `suppliers.supplier_name` — ILIKE search is a full table scan
The ILIKE `%search%` pattern on `supplier_name` cannot use a B-tree index. Add a `pg_trgm` index:
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_suppliers_name_trgm ON suppliers USING GIN(supplier_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_suppliers_email_trgm ON suppliers USING GIN(email gin_trgm_ops);
```

### 4. Missing index on `suppliers.is_active` — the most common filter has no index
```sql
CREATE INDEX IF NOT EXISTS idx_suppliers_is_active ON suppliers(store_id, is_active);
```

### 5. `get_supplier_payments` returns unbounded results when `limit = 500` is specified — should paginate with total count
The frontend hook `useSupplierPayments` expects `data?.data` and `data?.total` (PagedResult), but `get_supplier_payments` returns `Vec<SupplierPayment>` (not a `PagedResult`). This means `useSupplierPayments` in `useSupplierPayments.js` reads `data?.data ?? []` which returns `[]` (since the response is an array, not `{data: [], total: N}`), silently showing empty payment history.
**Fix:** Change the return type of `get_supplier_payments` to `PagedResult<SupplierPayment>` (same pattern as `get_transactions`).

### 6. `get_all_supplier_payables` returns ALL payables with no pagination — could be 500+ rows for large stores
For stores with hundreds of suppliers all carrying balances, this query returns every row. The frontend renders all of them in a single `map()` with no virtualization. Add a `LIMIT 100` default or accept pagination params.

### 7. `get_supplier_stats` runs on `purchase_orders` with no store_id filter — inflated stats for shared supplier entities
The stats query joins `purchase_orders WHERE supplier_id = $1` with no `AND store_id = $2`. In theory suppliers are store-scoped, but if cloud sync creates cross-store linking, the stats aggregate across all stores.
**Fix:** Add `AND store_id = (SELECT store_id FROM suppliers WHERE id = $1)` to the WHERE clause.

### 8. `create_supplier` sync payload omits key fields: `payment_terms`, `credit_limit`, `address`, `city`, `tax_id`
The sync queue call only includes `{id, store_id, supplier_name, supplier_code, contact_name, email, phone, is_active}`. Fields like `payment_terms`, `credit_limit`, `address`, `city`, and `tax_id` are missing. A cloud-pull on Supabase will create an incomplete supplier row missing these columns.
**Fix:** Add all non-null fields to the sync payload JSON.

### 9. `update_supplier` sync payload only includes changed fields — Supabase UPSERT may overwrite with NULLs
The `update_supplier` sync payload sends `{id, store_id, supplier_name, contact_name, is_active}` for an UPDATE operation. If Supabase applies this as an UPDATE SET, it will set `email = NULL`, `phone = NULL`, etc. for any fields not included. The sync payload should include the full supplier record post-update.
**Fix:** Serialize the full `Supplier` struct after `fetch_supplier()` and pass it as the sync payload:
```rust
let supplier = fetch_supplier(&pool, id).await?;
crate::database::sync::queue_row(&pool, "suppliers", "UPDATE", &id.to_string(),
    serde_json::to_value(&supplier)?, store_id).await;
```

### 10. `activate_supplier` and `deactivate_supplier` have no audit log writes
Both commands update `is_active` but never call `write_audit_log`. A manager deactivating a supplier leaves no audit trail.
**Fix:** Add after each UPDATE:
```rust
write_audit_log(&pool, claims.user_id, Some(supplier.store_id), "deactivate", "supplier",
    &format!("Deactivated supplier '{}'", supplier.supplier_name), "warning").await;
```

---

## BACKEND FEATURES (add for completeness)

### 1. No supplier credit enforcement — `credit_limit` column exists but is never checked
The `suppliers` table has `credit_limit NUMERIC(15,4)` and `current_balance NUMERIC(15,4)` but no command checks whether a new purchase order would breach the credit limit. A manager can create a PO for ₦1,000,000 against a supplier with a ₦100,000 credit limit.
**Fix:** In `create_purchase_order_inner`, add a pre-check:
```rust
let credit = sqlx::query!("SELECT credit_limit, current_balance FROM suppliers WHERE id = $1", supplier_id)
    .fetch_optional(&pool).await?;
if let Some(c) = credit {
    if c.credit_limit > Decimal::ZERO && (c.current_balance + po_total) > c.credit_limit {
        return Err(AppError::Validation(format!(
            "PO total ₦{} would exceed supplier credit limit of ₦{}", po_total, c.credit_limit
        )));
    }
}
```

### 2. No `current_balance` increment when a Purchase Order is received — balance drifts immediately
When a PO is received (`receive_purchase_order_inner`), `suppliers.current_balance` should increase by the PO's `total_amount`. Currently, balance only decreases via `record_supplier_payment`. A received ₦50,000 PO that hasn't been paid should immediately add ₦50,000 to `current_balance` — but there is no code doing this. All balances are therefore permanently ₦0 unless a PO is manually loaded into the balance via some other path.
**Fix:** In `receive_purchase_order_inner`, add:
```rust
sqlx::query!(
    "UPDATE suppliers SET current_balance = COALESCE(current_balance, 0) + $1, updated_at = NOW() WHERE id = $2",
    po.total_amount, po.supplier_id,
).execute(&mut *tx).await?;
```

### 3. No supplier performance score / rating system
Production POS systems track supplier reliability (on-time delivery rate, fill rate, quality issues). There is no `supplier_rating` or `performance_score` column, no `quality_issues` counter, and no command to log a quality complaint against a received PO. Add a `get_supplier_performance_score` command that computes: (received on-time POs / total completed POs) × 100.

### 4. No `DELETE` cascade or `RESTRICT` defined for `supplier_payments.supplier_id` FK
Migration 0041: `supplier_id INT NOT NULL REFERENCES suppliers(id)` — no `ON DELETE` clause, which defaults to `RESTRICT` in PostgreSQL. This means attempting to delete a supplier with payments will fail with a foreign key violation rather than the friendly soft-delete logic in `delete_supplier`. The soft-delete path only checks `purchase_orders`, not `supplier_payments`. If a supplier has payments but no POs, `delete_supplier` will attempt a hard DELETE and hit the FK violation from `supplier_payments`.
**Fix:** Add `ON DELETE RESTRICT` explicitly in the migration (it is already the default, but document it), and update `delete_supplier` to also check `supplier_payments`:
```rust
let payment_count: i64 = sqlx::query_scalar!(
    "SELECT COUNT(*) FROM supplier_payments WHERE supplier_id = $1", id
).fetch_one(&pool).await?.unwrap_or(0);
if po_count > 0 || payment_count > 0 {
    // soft-delete instead
}
```

### 5. No `updated_at` index on `suppliers` for cloud sync cursor queries
```sql
CREATE INDEX IF NOT EXISTS idx_suppliers_updated_at ON suppliers(updated_at DESC);
```

### 6. No `email` or `phone` uniqueness validation — duplicate suppliers can be created
There is no UNIQUE constraint on `suppliers.email` or `suppliers.phone` (even within a store). Two cashiers can independently create the same supplier with the same phone number, splitting the purchase order history between two records.
**Fix:**
```sql
CREATE UNIQUE INDEX IF NOT EXISTS ux_suppliers_phone_store ON suppliers(store_id, phone) WHERE phone IS NOT NULL AND is_active = TRUE;
```
And in Rust, catch constraint violation (23505) and return `AppError::Conflict("A supplier with this phone number already exists")`.

### 7. No webhook/event when supplier balance exceeds credit limit
There is no notification sent when `current_balance > credit_limit`. Managers have no alert that a supplier's account is overdue. Add a `push_notification` call in `receive_purchase_order_inner` after incrementing the balance (Feature #2):
```rust
if new_balance > credit_limit && credit_limit > Decimal::ZERO {
    push_notification(&pool, CreateNotificationDto {
        type: "supplier_credit_exceeded",
        message: format!("Supplier '{}' balance ₦{} exceeds credit limit ₦{}", ...),
        ...
    }).await.ok();
}
```

### 8. No supplier items / preferred items linkage
There is no `supplier_items` table linking suppliers to the items they supply and their unit costs. When creating a PO, cashiers manually enter item names and costs. Add a `supplier_items(supplier_id, item_id, unit_cost, lead_time_days, min_order_qty)` table and a backend command to manage it.

---

## FRONTEND FAULTS (must fix before production)

### 1. `useSuppliers.create.onSuccess` and `useSupplier.update.onSuccess` read `s.name` — the field is `s.supplier_name`
**Where:** `useSuppliers.js`, `create` mutation `onSuccess`, `update` mutation `onSuccess`
**What:**
```js
toastSuccess("Supplier Added", `${s.name} is now in your supplier directory.`);
toastSuccess("Supplier Updated", `Profile changes for ${s.name} have been saved.`);
```
The `Supplier` type serialized from Rust has `supplier_name`, not `name`. `s.name` is `undefined`, so the toast reads "undefined is now in your supplier directory." The same bug exists in `useSupplier` and `useSupplierPayments`.
**Fix:** Change `s.name` → `s.supplier_name` in all four mutation `onSuccess` callbacks.

### 2. `useSupplierPayments` in `useSupplierPayments.js` expects `data?.data` (PagedResult) but backend returns `Vec<SupplierPayment>` — always renders empty list
**Where:** `useSupplierPayments.js`, `useSupplierPayments` hook
**What:**
```js
payments: data?.data ?? [],
```
`get_supplier_payments` returns `Vec<SupplierPayment>` (a JSON array), not `{data: [], total: N}`. So `data?.data` is `undefined` and falls back to `[]`. The payment history in `SupplierPaymentsPanel` and the payment count on `SupplierDetailPanel` are always empty, even when payments exist.
**Fix (until backend is updated):** Change to `payments: Array.isArray(data) ? data : (data?.data ?? [])`.

### 3. `SupplierPaymentsPanel` `useStorePaymentHistory` also reads `data?.data ?? data ?? []` — inconsistent fallback could still show `undefined`
**Where:** `SupplierPaymentsPanel.jsx`, `useStorePaymentHistory`
**What:**
```js
payments: data?.data ?? data ?? []
```
If `data` is a JSON array (current backend behavior), `data?.data` is `undefined`, and `?? data` falls through to the array — this actually works. But if the backend is changed to PagedResult, `data?.data` will work. The inconsistency between `useStorePaymentHistory` (which correctly falls through) and `useSupplierPayments` (which doesn't) will cause one panel to show data and the other to show empty.
**Fix:** Standardize: change backend to always return `PagedResult` and use `data?.data ?? []` everywhere consistently.

### 4. `SuppliersPanel` status-tab counts are wrong — derived from current-page items, not total filtered counts
**Where:** `SuppliersPanel.jsx`, `counts` memo
**What:**
```js
counts = {
    all:      statusTab === "all"      ? total : items.length,
    active:   statusTab === "active"   ? total : items.filter(i => i.is_active).length,
    inactive: statusTab === "inactive" ? total : items.filter(i => !i.is_active).length,
};
```
When `statusTab === "all"` and there are 200 total suppliers, `counts.active` = `items.filter(i => i.is_active).length` which counts only the 50 on the current page. The "Active" tab badge shows "32" (active on this page) instead of the real total active count. Clicking the "Active" tab shows the correct `total` from the server, but the badge was wrong before clicking.
**Fix:** Make three separate count queries or add `active_count` and `inactive_count` to the `get_suppliers` response payload. Alternatively, always show `—` or a spinner for inactive-tab counts when the "all" tab is active.

### 5. `SupplierDetailPanel` `EditSupplierDialog` and `SupplierFormDialog` in `SuppliersPanel` are identical components — one will fall out of sync
**Where:** `SupplierDetailPanel.jsx` has `EditSupplierDialog` and `SuppliersPanel.jsx` has `SupplierFormDialog` — both render the same edit form with the same fields. Any field added to one (e.g., a new "Country" field) must be manually added to the other.
**Fix:** Extract a shared `<SupplierForm />` component (or a single `<SupplierFormDialog />` that handles both create and edit) into `src/features/suppliers/SupplierFormDialog.jsx` and use it in both panels.

### 6. `RecordPaymentDialog` in `SupplierDetailPanel` and `SupplierPaymentDialog` in `supplier_payments/` are also duplicate components
**Where:** `SupplierDetailPanel.jsx` → `RecordPaymentDialog` and `SupplierPaymentDialog.jsx`
**What:** Two separate dialog components record the same action. They have slightly different payment method lists (`RecordPaymentDialog` has "mobile_money", `SupplierPaymentDialog` does not). A bug fix or new field must be applied to both.
**Fix:** Use only `SupplierPaymentDialog` in both places and add "mobile_money" to its `PAYMENT_METHODS` list.

### 7. `SupplierPaymentsPanel` `PayablesTable` creates a `useSupplierPayments(selected?.supplier_id ?? 0)` hook at top level — React hook called with a dynamic key
**Where:** `SupplierPaymentsPanel.jsx`, `PayablesTable` component
**What:**
```js
const { record } = useSupplierPayments(selected?.supplier_id ?? 0);
```
This hook is called unconditionally with `0` when nothing is selected. `useSupplierPayments(0)` runs a query `GET /supplier_payments?supplier_id=0` every time the component mounts — an unnecessary API call. More critically, when `selected` changes (user clicks "Pay" on a different supplier), the hook is called with the new `supplier_id`, but React hooks cannot change their call order based on state — this pattern works but is architecturally fragile. If `enabled: !!supplierId` is not respected in `useSupplierPayments`, it will query with `supplier_id = 0`.
**Fix:** Check `enabled: !!supplierId` is set in `useSupplierPayments`. Replace the hook-at-top-level pattern by moving the mutation into a dedicated `RecordPayment` sub-component that only mounts when `selected !== null`.

### 8. `delete_supplier` always shows "Supplier deleted" toast regardless of whether it was hard-deleted or soft-deleted (deactivated)
**Where:** `SuppliersPanel.jsx`, `DeleteDialog.handleConfirm`
**What:** The backend silently deactivates instead of deleting when POs exist, but the frontend always toasts "Supplier deleted." A manager who sees this toast will believe the supplier is gone, when it's actually still active in the database (just deactivated). They may be confused when the supplier still appears in the inactive tab.
**Fix:** The backend should return a discriminator — either change the return type to `{ deleted: bool, deactivated: bool }` or return the updated `Supplier` object so the frontend can check `is_active` and show the appropriate message.

### 9. `SuppliersPanel` "Outstanding Balance" stat card uses `items.reduce(...)` — only sums the current page's balances
**Where:** `SuppliersPanel.jsx`, `totalBalance` memo
**What:**
```js
const totalBalance = useMemo(() =>
  items.reduce((s, i) => s + parseFloat(i.current_balance ?? 0), 0),
[items]);
```
With 200 suppliers and a page size of 50, the stat card shows only the sum of the 50 visible suppliers' balances. This is misleading — the card label says "total owed to suppliers" but it only shows a fraction.
**Fix:** Add a `total_outstanding_balance` field to the backend's `get_suppliers` response (a SUM aggregate), or use a dedicated `get_all_supplier_payables` query for this stat.

### 10. `SupplierDetailPanel` does not show loading state for the toggle (activate/deactivate) button during the mutation
**Where:** `SupplierDetailPanel.jsx`, Toggle Status Dialog
**What:** The toggle dialog's "Activate" / "Deactivate" button uses `disabled={activate.isPending || deactivate.isPending}` — correct. But the main header's "Activate" / "Deactivate" button (outside the dialog) has no `disabled` or loading state. Clicking it twice opens the dialog twice (the second dialog opens while the first mutation is in flight).
**Fix:** Add `disabled={activate.isPending || deactivate.isPending}` to the header action buttons.

---

## FRONTEND UPGRADES (should improve)

### 1. `SuppliersPanel` has no column sort controls — table is always sorted by `supplier_name` server-side
The `sortable: true` marker on the "Supplier" column does nothing (DataTable client-sorts only the current page). Add `sort_by` and `sort_dir` to `SupplierFilters` in the Rust backend, and expose clickable sort headers in the frontend.

### 2. `SuppliersPanel` has no `payment_terms` filter — can't find all "Net 30" suppliers quickly
Add a `<Select>` with payment terms options that maps to a `payment_terms` filter param.

### 3. `SupplierDetailPanel` `PurchaseOrderHistory` is not linked to create a new PO for this supplier
The PO history section shows existing orders but has no "Create PO" button pre-filled with this supplier. Add a button that navigates to `/purchase-orders/new?supplier_id={id}`.

### 4. `SupplierPaymentsPanel` payment history table has no date filter — impossible to find payments in a date range
Add "From" / "To" date pickers that pass `date_from` / `date_to` to `get_supplier_payments`. The backend filter model `SupplierPaymentFilters` currently does not accept dates — add these fields.

### 5. `SupplierPaymentsPanel` "Pay" button only available when `outstanding > 0` — cannot record advance payments
Some businesses pay suppliers in advance. The "Pay" button is hidden when `current_balance === 0`. Add an "Advance Payment" action or remove the `outstanding > 0` guard (allowing payment even when no balance is outstanding — this is a business decision but the current hard lock is too restrictive).

### 6. `SupplierDetailPanel` analytics section renders even when `stats` is null / loading
`AnalyticsSection` is always rendered. If `useSupplier` is still loading `stats`, the PO breakdown bar renders with `stats.total_orders = undefined`, causing `total / 1` to produce `NaN` for the bar widths (NaN% progress bar renders as 0%).
**Fix:** Guard: `{stats && <AnalyticsSection ... />}` or add a skeleton loader for the analytics section.

### 7. `SuppliersPanel` stat cards show real-time computed values from the current page only — make them server-driven
All four stat cards (`Total Suppliers`, `Active`, `Inactive`, `Outstanding Balance`) should be returned by the backend in a single `get_supplier_summary(store_id)` call. This avoids the client-side derivation bugs described in Frontend Faults #4 and #9.

### 8. `SupplierDetailPanel` credit utilization bar shows wrong percentage when `current_balance > credit_limit`
`Math.min(100, Math.round((balance / creditLimit) * 100))` caps at 100%, hiding that the supplier is over-limit. The bar should turn red AND show a warning label "Over limit" when balance > credit_limit.

### 9. `SupplierPaymentsPanel` has no "Export CSV" button for payment history
Finance teams need to export payment records for reconciliation. Add a "Download CSV" button that calls `get_supplier_payments` with a high limit and triggers a Blob download.

### 10. `useSuppliers.js` `create` mutation does not close the form dialog on success — relies on `SuppliersPanel` `SupplierFormDialog`'s own `handleOpenChange(false)` call inside `handleSubmit`
If the mutation succeeds but the dialog's `onSuccess` fires first, the form is still open while the toast fires. The `SupplierFormDialog.handleSubmit` calls `handleOpenChange(false)` after `await onCreate(payload)` — but if `onCreate` throws, the dialog stays open and the error toast fires. This is correct behavior. But the success path calls `toast.success(...)` inside the dialog AND `toastSuccess(...)` inside `create.onSuccess` — the user sees two success toasts.
**Fix:** Remove the `toast.success(...)` call from `SupplierFormDialog.handleSubmit` — rely entirely on `create.onSuccess` for the toast.

---

## FRONTEND FEATURES (add for completeness)

### 1. No "Items Supplied By" section on `SupplierDetailPanel`
There is no list of items that this supplier supplies. Without the `supplier_items` table (Backend Feature #8), this can only be approximated by aggregating `purchase_order_items` for this supplier. Add a "Products Supplied" tab showing item names, average cost, and last order date.

### 2. No supplier contact quick-actions (click-to-call, click-to-email)
`supplier.phone` and `supplier.email` are displayed as plain text. Add `<a href="tel:{phone}">` and `<a href="mailto:{email}">` links so users can initiate contact from the app.

### 3. No global "All Supplier Payables" page linked from the sidebar
The `SupplierPaymentsPanel` exists but may not be routed in the sidebar nav. Verify and add a "Payables" entry under the Suppliers sidebar section showing the total outstanding badge count.

### 4. No bulk payment action for clearing multiple supplier balances at once
A finance officer doing month-end payments to 5 suppliers must open each supplier's detail page individually. Add a multi-select on `PayablesTable` with a "Pay Selected" action that opens a confirmation modal showing the total.

### 5. No "Request Quote" / draft PO shortcut from the supplier list
Add a "Create PO" row action in `SuppliersPanel` (next to Edit/Deactivate/Delete) that navigates to `/purchase-orders/new?supplier_id={row.id}`.

### 6. No supplier document attachments (contracts, bank details, tax certificates)
Production suppliers require storing: bank account details, signed contracts, TIN certificates. Add a `supplier_documents` table and an upload interface on `SupplierDetailPanel`.

### 7. No last-activity date on the suppliers list
The table shows `payment_terms` and `current_balance` but not when the supplier was last used (last PO date). Add a "Last Order" column derived from `MAX(ordered_at)` in the backend list query.

---

## CROSS-CUTTING RISKS

### 1. Sync safety — `create_supplier` sync payload is incomplete, `update_supplier` payload is a sparse diff
As noted in Backend Upgrade #8 and #9, the sync payloads sent to Supabase via `queue_row` are missing fields. If Supabase processes the INSERT with missing fields, the cloud row will have NULLs for `payment_terms`, `credit_limit`, `address`, `city`, `tax_id`. When another store or device pulls from Supabase, it will receive an incomplete supplier and silently overwrite the correct local data with NULLs. This is a data loss scenario during cloud sync.
**Fix:** Always serialize the full post-create/post-update `Supplier` struct as the sync payload.

### 2. Multi-store isolation — `search_suppliers` returns results from all stores
As detailed in Backend Fault #7, `search_suppliers` has no `store_id` filter. In a multi-store setup, PO autocomplete will suggest suppliers from other stores. A manager at Store A could create a PO linking to a supplier that only exists in Store B's account, breaking the store-boundary model entirely.

### 3. Offline resilience — supplier payment recorded offline cannot be retried safely
If a cashier records a payment offline (DB connection drop between `pool.begin()` and `tx.commit()`), the transaction rolls back and the payment is lost. There is no client-side queue for supplier payments. Unlike POS sales (which have `client_uuid` deduplication), payments have no idempotency key — so a naive retry would double-record the payment.
**Fix:** Add an optional `idempotency_key: Option<String>` to `RecordSupplierPaymentDto`, add a UNIQUE constraint on the column, and catch 23505 violations as `AppError::Conflict("Payment already recorded")`.

### 4. Security — `activate_supplier` and `deactivate_supplier` have no audit log or notification — a malicious user could silently deactivate a critical supplier
Both commands update `is_active` without writing an audit log entry (Backend Upgrade #10). A user with `suppliers.update` permission can deactivate all suppliers silently. Managers would not know why POs suddenly fail supplier validation until they investigate manually.

### 5. Data consistency — `suppliers.current_balance` can drift from reality in multiple ways
Three drift scenarios:
- **No increment on PO receipt** (Backend Feature #2): Balance stays ₦0 after receiving a ₦50,000 shipment.
- **Overpayment clamping** (Backend Fault #4): A ₦50,000 payment against a ₦20,000 balance clamps to ₦0 instead of creating a ₦30,000 credit.
- **Payment voiding not supported**: There is no `void_supplier_payment` command. A wrongly recorded payment (e.g., ₦500,000 instead of ₦50,000) has no reversal path — the cashier must edit the DB directly or contact support.

The `get_supplier_balance` query computes `total_paid` and `total_po_value` independently from the denormalized `current_balance`, but there is no reconciliation check that flags when these are inconsistent. Add a `check_balance_integrity` job that alerts when `current_balance != SUM(po_amounts) - SUM(payments)`.

---

## PRIORITY ORDER

1. **[BACKEND FAULT #2] `supplier_code` column missing from migration 0006** — If this column is not in a proper migration, any fresh deployment will fail at startup with a fatal sqlx compile error. The entire app will not start. This must be verified and documented immediately.

2. **[FRONTEND FAULT #1] `s.name` instead of `s.supplier_name` in mutation toasts** — Every create/update/activate/deactivate success toast in `useSuppliers.js` shows "undefined is now in your supplier directory." This is a regression-level UX bug visible on every supplier operation.

3. **[FRONTEND FAULT #2 + BACKEND UPGRADE #5] Payment history always empty** — `useSupplierPayments` reads `data?.data` but the backend returns a flat array, so the payment history in both `SupplierDetailPanel` and `SupplierPaymentsPanel` is always `[]`. The entire payment tracking feature is non-functional.

4. **[BACKEND FAULT #7] `search_suppliers` returns all-store results** — In a multi-store franchise, PO autocomplete will suggest suppliers from other stores, allowing cross-store PO creation. This is a data isolation failure that corrupts the multi-store model.

5. **[BACKEND FAULT #4 + BACKEND FEATURE #2] `current_balance` never incremented on PO receipt + overpayment clamped to zero** — The supplier balance is permanently ₦0 for any supplier whose POs were received (never incremented), and any overpayment is silently discarded. The entire "Outstanding Payables" panel is showing ₦0 for all suppliers regardless of what they are owed. This makes the supplier financial tracking feature completely inaccurate from day one.
