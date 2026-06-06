# Quantum POS — Production Audit: Customers Module

**Audited:** 2026-04-29
**Scope:** `src-tauri/src/commands/customers.rs`, `src-tauri/src/commands/customer_wallet.rs`, `src-tauri/src/models/customer.rs`, `src-tauri/src/models/customer_wallet.rs`, migrations 0006/0045, `src/features/customers/*`

---

## BACKEND FAULTS (must fix before production)

### 1. `Customer` model defines `credit_limit` and `outstanding_balance` as `Option<Decimal>` but migration 0006 declares both NOT NULL — type mismatch causes silent zeros
**Where:** `models/customer.rs` vs migration `0006_customers_suppliers.sql`
**What:**
```rust
pub credit_limit:        Option<Decimal>,   // model says nullable
pub outstanding_balance: Option<Decimal>,   // model says nullable
```
The schema: `credit_limit NUMERIC(15,4) NOT NULL DEFAULT 0` and `outstanding_balance NUMERIC(15,4) NOT NULL DEFAULT 0`. The columns are NOT NULL, but the Rust struct wraps them in `Option<>`. SQLx will accept this (it maps NOT NULL to `Option` without error), but all downstream code uses `.unwrap_or(Decimal::ZERO)` or `parseFloat(x ?? 0)` defensively — masking the fact that these values are always present. If any future migration makes a column nullable (e.g., to allow NULL credit_limit meaning "unlimited"), all the `unwrap_or_default()` calls will silently start returning ₦0 for unlimited accounts.

More critically: `Customer.loyalty_points` is also defined as `Option<i32>` in the model but `INT NOT NULL DEFAULT 0` in the schema. Same pattern — the mismatch is latent. 
**Fix:** Change the model to match the schema:
```rust
pub credit_limit:        Decimal,
pub outstanding_balance: Decimal,
pub loyalty_points:      i32,
```
Update all query `!: Decimal` annotations and remove `unwrap_or_default()` calls where these fields are used.

### 2. `get_customer_stats` — `available_credit` can return a negative Decimal when `outstanding_balance > credit_limit`, surfaced in frontend as a negative number
**Where:** `commands/customers.rs`, `get_customer_stats()`, SQL expression:
```sql
(c.credit_limit - COALESCE(c.outstanding_balance, 0)) as available_credit
```
**What:** There is no `GREATEST(..., 0)` guard. A customer whose `outstanding_balance` exceeds their `credit_limit` (possible if the limit was lowered after credit was extended) returns a negative `available_credit`. The `CustomerDetailPanel` stat card shows "Available Credit: −₦20,000" — a confusing UI state. The `create_transaction` function already correctly uses `available = credit_limit - outstanding_balance` with a check (`if total_amount > available`), so the comparison logic is fine — but the stored and returned value is unguarded.
**Fix:** Wrap with `GREATEST`:
```sql
GREATEST(c.credit_limit - COALESCE(c.outstanding_balance, 0), 0) as available_credit
```

### 3. `get_customer_transactions` date filter uses raw string cast to `timestamptz` — invalid dates produce a DB error, not a validation error
**Where:** `commands/customers.rs`, `get_customer_transactions()`
**What:**
```sql
AND ($2::text IS NULL OR created_at >= $2::timestamptz)
AND ($3::text IS NULL OR created_at <= $3::timestamptz)
```
An invalid date string from the frontend (e.g., `"not-a-date"` or `"2026-13-40"`) will cause PostgreSQL to throw `ERROR: invalid input syntax for type timestamp` which surfaces as a generic `AppError::Database` with a cryptic pg error string. There is no validation in Rust before the query.
**Fix:** Validate the strings before the query:
```rust
if let Some(ref df) = date_from {
    df.parse::<chrono::DateTime<chrono::Utc>>()
      .or_else(|_| chrono::NaiveDate::parse_from_str(df, "%Y-%m-%d")
          .map(|d| d.and_hms_opt(0,0,0).unwrap().and_utc()))
      .map_err(|_| AppError::Validation("Invalid date_from format".into()))?;
}
```

### 4. `delete_customer` performs a `SELECT outstanding_balance` then an `UPDATE` in two separate queries — TOCTOU race condition
**Where:** `commands/customers.rs`, `delete_customer()`
**What:** The balance check and the soft-delete are two unrelated queries with no transaction. Between them, a sale could increase the balance to > 0. The balance is read as 0, the soft-delete proceeds, then the customer has `is_active = FALSE` but `outstanding_balance > 0`. Worse: if the sale runs concurrently with the delete, the transaction command's `validate customer is active` check could pass (customer is still active at that instant), and the sale completes with the customer now deactivated — leaving an orphaned credit sale with no active customer to collect from.
**Fix:** Wrap in a transaction and use `FOR UPDATE`:
```rust
let mut tx = pool.begin().await?;
let balance: Decimal = sqlx::query_scalar!(
    "SELECT outstanding_balance FROM customers WHERE id = $1 FOR UPDATE", id
).fetch_optional(&mut *tx).await?.unwrap_or_default();
if balance > Decimal::ZERO { return Err(AppError::Validation(...)); }
sqlx::query!("UPDATE customers SET is_active = FALSE ... WHERE id = $1", id)
    .execute(&mut *tx).await?;
tx.commit().await?;
```

### 5. `wallet_tx` passes `amount` (signed) into `abs_amount` for the INSERT but the `adjust_wallet` signed amount is negative for deductions — signs are inconsistently handled
**Where:** `commands/customer_wallet.rs`, `wallet_tx()` and `adjust_wallet()`
**What:** In `wallet_tx`, the `amount` parameter is added directly to `current` to get `balance_after` (correct — signed arithmetic). Then `abs_amount = amount.abs()` is stored in the `customer_wallet_transactions.amount` column. This means the `amount` column in the DB is always positive regardless of whether it was a deposit or a debit. The `type` column (`deposit`, `debit`, `adjustment`) is the only signal of direction. However in `get_wallet_balance`:
```sql
COALESCE(SUM(cwt.amount) FILTER (WHERE cwt.type='deposit'), 0) AS total_deposited,
COALESCE(SUM(cwt.amount) FILTER (WHERE cwt.type='debit'), 0) AS total_spent
```
This works correctly because `amount` is always positive and the type differentiates direction. But for `adjustment` types (which can be positive OR negative), `amount` is always stored as positive (`abs()`), losing the sign. If a manager does a negative adjustment of −₦500 (to correct an overdeposit), the `adjustment` row has `amount = 500` (positive) and the only indication it was negative is the `balance_after` value — which requires reading two rows to infer.
**Fix:** Store the signed amount for adjustments: remove the `abs()` call when `kind == "adjustment"`:
```rust
let stored_amount = if kind == "adjustment" { amount } else { amount.abs() };
```
Then update `get_wallet_balance` to handle signed adjustments in the SUM, or add a separate `adjustment` filter.

### 6. `deposit_to_wallet` does not validate that the `customer_id` belongs to the correct `store_id` — cross-store wallet deposits are possible
**Where:** `commands/customer_wallet.rs`, `deposit_to_wallet()` and `wallet_tx()`
**What:** `wallet_tx` takes `customer_id` and `store_id` as separate parameters and blindly operates on the customer row. There is no check that `customers.store_id = payload.store_id`. A non-global cashier from Store A can call `depositToWallet({ customer_id: 999, store_id: 1 })` where customer 999 belongs to Store B. The `FOR UPDATE` lock and balance update will modify Store B's customer from Store A's session.
**Fix:** In `wallet_tx`, add before the `FOR UPDATE`:
```rust
let customer_store: Option<i32> = sqlx::query_scalar!(
    "SELECT store_id FROM customers WHERE id = $1", customer_id
).fetch_optional(&mut *tx).await?.flatten();
if customer_store != Some(store_id) {
    return Err(AppError::Forbidden);
}
```

### 7. `update_customer` writes the audit log with `None` as `store_id` — audit trail is unscoped
**Where:** `commands/customers.rs`, `update_customer()`
**What:**
```rust
write_audit_log(&pool, claims.user_id, None, "update", "customer", ...)
```
The customer's `store_id` is available from `result.store_id` (fetched immediately before). Using `None` means the audit log entry is not associated with any store, so per-store audit log filters will never show customer update events.
**Fix:**
```rust
write_audit_log(&pool, claims.user_id, Some(result.store_id), "update", "customer", ...).await;
```

### 8. `delete_customer` audit log also uses `None` as `store_id` — same issue
**Where:** `commands/customers.rs`, `delete_customer()`
**What:** The `store_id` is never fetched before the audit log write in `delete_customer`. The soft-delete query returns nothing (it's just `UPDATE`, not `RETURNING`), so there's no `store_id` available at audit time.
**Fix:** Fetch the customer's `store_id` before the balance check, then use it in the audit log:
```rust
let cust = sqlx::query!("SELECT store_id, outstanding_balance FROM customers WHERE id = $1 FOR UPDATE", id)
    .fetch_optional(&mut *tx).await?;
// ... then
write_audit_log(&pool, claims.user_id, Some(cust.store_id), "delete", "customer", ...).await;
```

### 9. `activate_customer` and `deactivate_customer` have no audit log writes at all
**Where:** `commands/customers.rs`, both functions
**What:** Both commands execute a single UPDATE with no `write_audit_log` call. A manager can silently deactivate a VIP customer's account with no audit trail. This is especially problematic because deactivation blocks the customer from all future sales.
**Fix:** After the UPDATE, fetch the customer (or use `RETURNING store_id`) and write an audit log entry with severity `"warning"` for deactivation and `"info"` for activation.

### 10. `search_customers` does not validate `store_id` against the caller's scope — returns data across store boundaries for non-global users
**Where:** `commands/customers.rs`, `search_customers()`
**What:** The command takes `store_id: Option<i32>` and passes it directly. A non-global cashier can omit `store_id` (None) and receive all active customers from ALL stores. The `guard_permission` check only verifies `customers.read` — not store ownership. This is a privacy violation in a multi-franchise deployment.
**Fix:** After `guard_permission`:
```rust
let claims = guard_permission(&state, &token, "customers.read").await?;
let scoped_store_id = if claims.is_global { store_id } else { claims.store_id };
// Then use scoped_store_id in the query (always non-null for non-global users)
```

---

## BACKEND UPGRADES (should improve)

### 1. `get_customers` duplicates the WHERE clause across count and data queries — maintenance hazard
Same CTE pattern issue as other modules. Any new filter field must be added in two places. Use a single query with `COUNT(*) OVER ()`:
```sql
WITH filtered AS (SELECT * FROM customers WHERE <conditions>)
SELECT *, COUNT(*) OVER () AS total_count FROM filtered ORDER BY first_name, last_name LIMIT $5 OFFSET $6
```

### 2. Missing `pg_trgm` index on `customers.first_name` and `last_name` — ILIKE search is a sequential scan
The `search_customers` and `get_customers` functions use `first_name ILIKE $4 OR last_name ILIKE $4` — pattern matching that cannot use B-tree indexes.
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm ON customers USING GIN((first_name || ' ' || last_name) gin_trgm_ops);
```

### 3. `get_customer_stats` runs a full `SUM(t.total_amount)` across ALL transactions for the customer — no date boundary, unbounded for long-term customers
A customer with 5 years of transaction history will cause a full table scan join. Add an option to scope by date range, or cache `total_spent` as a denormalized column updated on each transaction.

### 4. `get_wallet_balance` aggregates ALL wallet transactions in a single query with no date boundary — unbounded for high-volume customers
`SUM(cwt.amount) FILTER (...)` has no LIMIT or date filter. For a customer with 10,000 wallet entries over 5 years, this query is slow.
**Fix:** For the summary `WalletBalance`, use the stored `customers.wallet_balance` directly for the current balance (it is already maintained via `wallet_tx`), and only aggregate on demand for the detailed breakdown:
```sql
SELECT c.wallet_balance AS balance, ... FROM customers c WHERE c.id = $1
```
Then run the SUM only for the breakdown cards, scoped to the last 12 months.

### 5. `get_wallet_history` returns unbounded results up to 500 — should be paginated with a total count
`get_wallet_history` returns `Vec<WalletTransaction>` (no total). `WalletHistoryTable` renders all rows in a single list. Change to `PagedResult<WalletTransaction>` with pagination parameters.

### 6. `update_customer` sync payload only sends partial fields — same sparse-diff problem as suppliers
The sync payload for UPDATE only includes `{id, store_id, first_name, last_name, phone, email, is_active}`. Fields like `customer_type`, `credit_limit`, `credit_enabled`, `address`, `city` are missing. Supabase cloud-pull will overwrite these with NULLs.
**Fix:** Serialize the full `Customer` struct post-update as the sync payload.

### 7. `create_customer` sync payload also omits key fields
Missing from the INSERT sync payload: `customer_type`, `credit_enabled`, `address`, `city`, `loyalty_points`, `wallet_balance`.

### 8. `customer_type` is validated only at the application layer — no DB CHECK constraint
Valid values `'regular', 'vip', 'wholesale'` are enforced by the UI select only. Direct DB access or migration errors can insert invalid types.
```sql
ALTER TABLE customers ADD CONSTRAINT chk_customer_type
  CHECK (customer_type IN ('regular', 'vip', 'wholesale'));
```

### 9. Missing index on `customers.is_active` and `customers.customer_type` for filtered list queries
```sql
CREATE INDEX IF NOT EXISTS idx_customers_active ON customers(store_id, is_active);
CREATE INDEX IF NOT EXISTS idx_customers_type   ON customers(store_id, customer_type);
```

### 10. `get_customer_transactions` count and data queries do not filter by `status` — voided transactions inflate "Total Spent"
`get_customer_stats` correctly uses `t.status = 'completed'` in the JOIN for `total_spent`, but `get_customer_transactions` returns ALL transactions regardless of status. The transaction history table shows voided and refunded transactions mixed with completed ones, and the pagination count includes them. This is fine for the history view (intentional), but the "Total Spent" KPI counts should consistently exclude non-completed transactions.

---

## BACKEND FEATURES (add for completeness)

### 1. No `outstanding_balance` reconciliation check — denormalized balance can drift from `credit_sales` table
`customers.outstanding_balance` is incremented by `create_transaction` (credit sales path) and decremented by `record_credit_payment`. If either operation fails partially, the balance drifts. There is no background job that periodically reconciles:
```sql
UPDATE customers c SET outstanding_balance = 
    COALESCE((SELECT SUM(cs.outstanding) FROM credit_sales cs WHERE cs.customer_id = c.id AND cs.status != 'paid'), 0)
WHERE c.id = $1;
```
Add a `reconcile_customer_balance(customer_id)` command callable from the admin panel.

### 2. No customer merge / deduplication command
A customer added twice (once by phone, once by email) has their transaction history split between two records. There is no `merge_customers(source_id, target_id)` command that re-assigns transactions, credit sales, and wallet entries from the source to the target.

### 3. No customer spending tier / auto-upgrade logic
There is no backend logic to auto-promote a customer from `regular` to `vip` when they exceed a spending threshold (e.g., ₦500,000 total). This requires a `check_customer_tier_upgrade` function called post-transaction.

### 4. No customer birthday / anniversary field
Many retail POS systems track customer birthdays to send loyalty offers. The schema has no `date_of_birth` column and no related notification hook.

### 5. No `wallet_balance` index for identifying customers with large balances
For a "top wallet holders" analytics query:
```sql
CREATE INDEX IF NOT EXISTS idx_customers_wallet_balance ON customers(store_id, wallet_balance DESC) WHERE wallet_balance > 0;
```

### 6. No `updated_at` index on `customers` for cloud sync cursor queries
```sql
CREATE INDEX IF NOT EXISTS idx_customers_updated_at ON customers(updated_at DESC);
```

### 7. No bulk credit limit update command
A store owner changing credit policy (e.g., all VIP customers get ₦200,000 limit) must update each customer individually. Add a `bulk_update_credit_limit(store_id, customer_type, new_limit)` command.

### 8. No customer referral tracking
There is no `referred_by: Option<i32>` column on `customers` or a `customer_referrals` table. Referral programs ("introduce a friend, both get 500 points") cannot be implemented without it.

---

## FRONTEND FAULTS (must fix before production)

### 1. `CustomersPanel` stat cards for `activeCount`, `inactiveCount`, `vipCount` are derived from the current page only — not the full dataset
**Where:** `CustomersPanel.jsx`, `useMemo` computing `activeCount`, `inactiveCount`, etc.
**What:**
```js
const active   = items.filter(i =>  i.is_active).length;   // ← only current page!
const vip      = items.filter(i => i.customer_type === "vip").length;
```
With 500 customers and a page size of 25, the "Active" stat card shows the count of active customers on page 1 (e.g., 23), not the store total. The same affects the tab badge counts in `statusCounts` and `typeCounts`. Clicking the "Active" tab then shows the correct server total, but the badges were wrong.
**Fix:** Request aggregate counts from the backend via a dedicated `get_customer_summary(store_id)` query returning `{total, active_count, inactive_count, vip_count, wholesale_count, regular_count}`, or derive them from three parallel `useQuery` calls with `is_active` filters.

### 2. `CustomerFormDialog` and `EditCustomerDialog` are duplicate components — any field change must be applied to both
**Where:** `CustomersPanel.jsx` (`CustomerFormDialog`) and `CustomerDetailPanel.jsx` (`EditCustomerDialog`)
**What:** Both components render an identical form with the same fields, same validation, and same submit logic. A new field (e.g., `date_of_birth`) added to one will be missing from the other until manually synced.
**Fix:** Extract a single shared `<CustomerFormDialog>` (with `customer` prop for edit mode) into `src/features/customers/CustomerFormDialog.jsx` and use it in both panels.

### 3. `CustomerDetailPanel` shows `CustomerCreditSales` only when `creditEnabled === true`, but `creditEnabled` may be stale until `stats` loads
**Where:** `CustomerDetailPanel.jsx`
**What:**
```js
const creditEnabled = stats ? stats.credit_enabled : customer.credit_enabled ?? false;
```
During the ~200ms window while `stats` is loading (`loadingStats = true`), `creditEnabled` falls back to `customer.credit_enabled`. If `customer.credit_enabled` is `null` (from the `Option<bool>` model with no default), it becomes `false` — the Credit Sales section is hidden. When `stats` arrives with `credit_enabled = true`, the section appears with a layout shift.
**Fix:** Always show the Credit Sales section if `customer.credit_enabled === true` (from the base customer row, which is immediately available), and only refine based on `stats` when available. Or add `credit_enabled: bool` (NOT NULL DEFAULT false) to the `Customer` model to ensure it is never null.

### 4. `delete_customer` in `useCustomers` invalidates all `["customers"]` queries but does NOT invalidate the `["customer", id]` detail query
**Where:** `useCustomers.js`, `remove.onSuccess`
**What:** After a successful delete (soft-deactivation), `invalidateAll()` invalidates `queryKey: ["customers"]` (the list). But `["customer", id]` (the detail query used by `CustomerDetailPanel`) is not invalidated. If the user navigates from the list to the detail page of the just-deleted customer, the detail panel shows the old `is_active: true` state from cache until the 2-minute stale time expires.
**Fix:** In `remove.onSuccess`, also invalidate the specific detail key:
```js
onSuccess: (_, id) => {
  qc.invalidateQueries({ queryKey: ["customer", id] });
  invalidateAll();
}
```

### 5. `WalletPanel` and `WalletHistoryTable` components are referenced in `CustomerDetailPanel` but not visible in the audit scope — if they don't exist or have broken imports, the detail panel crashes
**Where:** `CustomerDetailPanel.jsx`, imports:
```js
import { WalletPanel }        from "@/features/wallet/WalletPanel";
import { WalletHistoryTable } from "@/features/wallet/WalletHistoryTable";
import { LoyaltyBalanceCard } from "@/features/loyalty/LoyaltyBalanceCard";
import { LoyaltyHistoryTable }from "@/features/loyalty/LoyaltyHistoryTable";
```
If any of these files do not exist or have a broken export, the entire `CustomerDetailPanel` will fail to render (white screen) with no error boundary. There is no `<Suspense>` or error boundary wrapping these sub-panels.
**Fix:** Wrap each optional sub-panel in a local `<ErrorBoundary>` or add `React.Suspense` boundaries. At minimum, add a top-level error boundary around `CustomerDetailPanel`.

### 6. `CustomersPanel` status-tab badge shows wrong counts when switching between status tabs
**Where:** `CustomersPanel.jsx`, `statusCounts` memo
**What:**
```js
const statusCounts = {
  all:      total,       // from server — correct
  active:   activeCount, // from current page items — WRONG
  inactive: inactiveCount, // from current page items — WRONG
};
```
When `statusTab === "all"`, the "Active" badge shows the count of active customers on the current page (not the real total). When `statusTab === "active"`, it shows the server total (correct) — but switching back to "all" immediately shows the page-level count again. This flickers visibly on every tab switch.

### 7. `CustomerDetailPanel` `handleToggle` does not reset `toggleOpen` on error — the dialog stays open but looks inactive
**Where:** `CustomerDetailPanel.jsx`, `handleToggle()`
**What:**
```js
const handleToggle = async () => {
  try {
    if (customer.is_active) await deactivate.mutateAsync();
    else                    await activate.mutateAsync();
    toast.success(...);
    setToggleOpen(false);
  } catch (err) {
    toast.error(...);  // dialog stays open — ok
  }
};
```
After a failed toggle, the dialog stays open (intentionally, to allow retry) but the confirm button is no longer disabled (`isPending` returns to false). However, `activate.isPending || deactivate.isPending` is used on the button — after the error, it's false, and the button re-enables. This is correct. The issue is: the error message from `err?.message` is typically a raw Rust error string like `"db error: ERROR: ..."` — not user-friendly. The `toast.error` should format it.
**Fix:** Use `typeof err === "string" ? err : (err?.message ?? "Action failed")` consistently.

### 8. `useCustomerTransactions` passes `date_from` and `date_to` as parameters but `TransactionHistory` sub-component never passes these — the date filter is dead code
**Where:** `useCustomers.js`, `useCustomerTransactions`, and `CustomerDetailPanel.jsx`, `TransactionHistory`
**What:** `useCustomerTransactions(customerId, { page, limit, dateFrom, dateTo })` accepts date filters, and `get_customer_transactions` backend supports them — but `TransactionHistory` calls `useCustomerTransactions(customerId, { page, limit: 10 })` with no date filter. There are no date pickers on the transaction history section.
**Fix:** Either add date pickers to `TransactionHistory` (the correct fix), or remove the `dateFrom`/`dateTo` parameters from `useCustomerTransactions` to eliminate dead code that misleads developers.

### 9. `CustomerCreditSales` view link navigates to `/credit-sales` (the general list) — not to the filtered view for this customer
**Where:** `CustomerDetailPanel.jsx`, `CustomerCreditSales` columns:
```jsx
<Link to="/credit-sales" ...><ArrowUpRight /></Link>
```
The view-all link and the row action link both navigate to the general credit sales page with no customer filter. The user loses context and must re-filter manually.
**Fix:** Navigate to `/credit-sales?customer_id={customerId}` and ensure `CreditSalesPanel` reads `customer_id` from URL search params to pre-filter.

### 10. `CustomersPanel` handles `create` and `update` with double-toast — one from `handleSubmit` inside `CustomerFormDialog` and one from `create.onSuccess`
**Where:** `CustomersPanel.jsx`, `CustomerFormDialog.handleSubmit`:
```js
toast.success(editing ? "Customer updated." : "Customer created.");
```
And `useCustomers.js`, `create.onSuccess`:
```js
toastSuccess("Customer Added", `${c.first_name} ${c.last_name} is now in your customer directory.`);
```
Both fire on success, producing two overlapping toasts.
**Fix:** Remove the `toast.success(...)` calls from inside `CustomerFormDialog.handleSubmit`. Let the mutation hooks in `useCustomers.js` be the single source of toast feedback.

---

## FRONTEND UPGRADES (should improve)

### 1. `CustomersPanel` has no "Sort by" control — always sorted server-side by `first_name, last_name`
The `sortable: true` markers on table columns (if any) only sort the current page. Add `sort_by` and `sort_dir` params to `CustomerFilters` in the backend and expose sort controls in the frontend.

### 2. `CustomersPanel` stat cards use current-page data only (Bug #1 above) — replace with server-driven summary
Add a `get_customer_summary(store_id)` backend command returning aggregate counts per type and status. Use a separate `useCustomerSummary(storeId)` query to drive the stat cards independently of the paginated list.

### 3. `CustomerDetailPanel` has no "Export Customer Data" button
There is no way to print or export a customer's profile, transaction history, or credit statement. Add a "Print / Export" button that generates a PDF or CSV summary.

### 4. `CustomerDetailPanel` "Transaction History" has no date filter UI
The `useCustomerTransactions` hook supports `dateFrom`/`dateTo` but the component never passes them. Add "From" / "To" date pickers to the transaction history section so managers can narrow down purchase history by date range.

### 5. `CustomersPanel` missing "Has Outstanding Balance" quick-filter
There is no filter to show only customers with `outstanding_balance > 0`. This is the most common manager query ("who owes us money?"). Add a `balance` filter tab or toggle.

### 6. `CustomerDetailPanel` credit utilization bar is missing — only raw numbers are shown
Unlike `SupplierDetailPanel` (which has a credit usage progress bar), `CustomerDetailPanel` shows the credit limit, outstanding, and available credit as plain text rows. Add a visual utilization bar identical to the supplier one, turning red when `outstanding > 0.8 * credit_limit`.

### 7. `CustomersPanel` search input uses `defaultValue` + `onChange` (uncontrolled pattern) — clear button doesn't reset the input visually
**Where:** `CustomersPanel.jsx`:
```jsx
<Input key={search} defaultValue={search} onChange={handleSearchChange} />
```
The `key={search}` trick re-mounts the input when `search` changes (from URL params) — this works. But clicking the "×" clear button calls `setUrlSearch("")`, which changes `search`, which re-mounts the input with `defaultValue=""`. This causes a visual flash. Use a controlled input with an internal `useState` for the input value, and flush to URL params on debounce.

### 8. `WalletHistoryTable` and `LoyaltyHistoryTable` have no pagination — they show the last 50 / N records with no "load more"
Both sub-panels in `CustomerDetailPanel` show a fixed-limit list with no pagination control. For active customers with hundreds of wallet or loyalty events, history is silently truncated.

### 9. `CustomersPanel` bulk actions are missing — no multi-select for bulk deactivate or type change
There are no checkboxes for multi-select. A manager wanting to deactivate 50 inactive customers from a batch import must click each one individually. Add a checkbox column and "Bulk Deactivate", "Bulk Change Type" actions.

### 10. `CustomerDetailPanel` does not show a "New Sale" quick-action button for the customer
The detail page shows all history but has no "Start a new sale for this customer" button that would navigate to `/pos?customer_id={id}` and pre-load the customer in the POS cart. This is a very common workflow: view customer → start sale.

---

## FRONTEND FEATURES (add for completeness)

### 1. No customer statement / account summary export
A printable customer statement showing all transactions, credit balance, payments, and wallet balance for a given date range is a standard retail document. Add a "Print Statement" button that generates a paginated PDF via the backend.

### 2. No "Send SMS / WhatsApp" quick-action
The customer's phone number is displayed but not actionable. In the Nigerian market, WhatsApp is the dominant communication channel. Add a `<a href="https://wa.me/{phone}">` link next to the phone number.

### 3. No customer notes / CRM field
There is no free-text `notes` field on the `Customer` model. Sales staff cannot record important context (e.g., "prefers cash on delivery", "knows the owner"). Add `notes: Option<String>` to the model and a text area in the edit form.

### 4. No "Top Customers by Spend" widget on the Customers list page
The stat cards only show counts. Add a "Top 5 Customers" mini-leaderboard on the page (or in a sidebar panel) showing the highest spenders based on `get_customer_stats` aggregates.

### 5. No customer segmentation / tag system
Beyond `customer_type` (regular / VIP / wholesale), there is no tag system for custom segmentation (e.g., "contractor", "bulk-buyer", "preferred-vendor"). A `customer_tags` junction table would support this.

### 6. No customer birthday greeting / scheduled loyalty bonus
With `date_of_birth` (missing — Backend Feature #4), there could be an automated "Birthday Bonus" that grants X loyalty points on the customer's birthday. The entire birthday workflow is blocked by the missing field.

### 7. No customer import from CSV
There is no bulk import feature. A store migrating from another system (or importing a contact list) must create customers one by one. Add a CSV import flow with column mapping.

---

## CROSS-CUTTING RISKS

### 1. Sync safety — `wallet_balance` in customers sync payload uses `to_string()` for Decimal — may cause type mismatch on Supabase
**Where:** `commands/customer_wallet.rs`, `wallet_tx()` sync payload:
```rust
serde_json::json!({ ..., "wallet_balance": balance_after.to_string() })
```
`Decimal.to_string()` produces `"1234.5000"` (a string). If the Supabase `customers.wallet_balance` column is `NUMERIC`, the Supabase upsert will fail or silently cast incorrectly. Use `balance_after` directly (it serializes as a JSON number from `Decimal`):
```rust
"wallet_balance": balance_after
```

### 2. Multi-store isolation — `get_customer` has no store-boundary check for non-global users
`get_customer(id)` accepts any customer ID and returns the customer regardless of whether the caller's store matches `customer.store_id`. A cashier from Store A can view the full profile, credit limit, wallet balance, and loyalty points of Store B's customer by knowing their integer ID.
**Fix:** After `guard_permission`, add:
```rust
if !claims.is_global {
    let customer_store = fetch_customer(&pool, id).await?.store_id;
    if claims.store_id != Some(customer_store) {
        return Err(AppError::Forbidden);
    }
}
```

### 3. Offline resilience — wallet deposits and deductions have no idempotency key
If the app loses connection after `wallet_tx` commits but before the response is returned to the frontend, the cashier will see an error and retry the deposit. There is no `idempotency_key` field on `DepositDto` or `customer_wallet_transactions`. A retry will double-deposit. 
**Fix:** Add `idempotency_key: Option<String>` to `DepositDto`, add a UNIQUE constraint on a `idempotency_key` column in `customer_wallet_transactions`, and catch 23505 as `AppError::Conflict("Deposit already processed")`.

### 4. Data consistency — `customers.outstanding_balance` is a denormalized field that can drift from `credit_sales` aggregates
`outstanding_balance` is incremented in `create_transaction` and decremented in `record_credit_payment`. If either of these partial-commit paths fails after the balance update but before the transaction/credit_sale row is committed, the balance will be wrong. There is no scheduled reconciliation job or integrity check.
Also: `customers.loyalty_points` is updated by `earn_points_internal` and `redeem_points_internal` — also denormalized, also potentially drifted.
**Fix:** Add a nightly `reconcile_customer_balances()` job that recomputes `outstanding_balance` from `credit_sales` and `loyalty_points` from `loyalty_point_transactions` and alerts on discrepancies.

### 5. Security — `adjust_wallet` requires `stores.manage` permission (high privilege) but `deposit_to_wallet` only requires `customers.update` (low privilege)
A cashier with `customers.update` can deposit unlimited amounts into any customer's wallet. There is no upper-bound validation on deposit amounts — a cashier could deposit ₦10,000,000 into a customer's wallet with no approval workflow. Add a `max_wallet_deposit` setting in `store_settings` and enforce it in `deposit_to_wallet`:
```rust
if let Some(max) = settings.max_wallet_deposit {
    if amount > max {
        return Err(AppError::Validation(format!(
            "Deposit of ₦{} exceeds the maximum single deposit of ₦{}", amount, max
        )));
    }
}
```

---

## PRIORITY ORDER

1. **[FRONTEND FAULT #1 + #6] Stat card counts are derived from current page only** — Every KPI card on `CustomersPanel` (Active, Inactive, VIP/Wholesale, Total) shows wrong numbers derived from the 25-item current page rather than the full dataset. Status tab badges also show wrong counts. These are the first things a store owner sees — incorrect numbers on the main Customers page will immediately undermine trust in the system.

2. **[BACKEND FAULT #4] `delete_customer` balance check has TOCTOU race** — Between the balance check and the soft-delete, a concurrent credit sale can execute against a customer whose delete is in flight. The result is a customer who is deactivated but has a non-zero credit sale with no active account. Wrap in a `FOR UPDATE` transaction.

3. **[BACKEND FAULT #6] Cross-store wallet deposits — `wallet_tx` does not verify customer belongs to caller's store** — Any cashier with `customers.update` can deposit money into customers from other stores, or deduct from them. This is both a data integrity issue and a potential fraud vector in a multi-store franchise.

4. **[BACKEND FAULT #10] `search_customers` returns data from all stores when `store_id` is omitted** — POS autocomplete can show customers from other stores to cashiers. This is a privacy violation and can result in a cashier at Store A accidentally adding a Store B customer to a sale, attributing credit or loyalty points to the wrong store's customer.

5. **[FRONTEND FAULT #10] Double-toast on create/update** — Both `CustomerFormDialog.handleSubmit` and `useCustomers.create.onSuccess` fire success toasts. Every customer create/update shows two overlapping success messages. While not a data integrity issue, it is a regression-level UX bug visible on every single customer create/update operation.
