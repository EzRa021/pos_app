# Quantum POS — Production Audit: Credit Sales & Wallet Module

**Audited:** 2026-04-29
**Scope:** `src-tauri/src/commands/credit_sales.rs`, `src-tauri/src/commands/wallet.rs`, `src/features/credit/useCreditSales.js`, `src/features/credit/CreditSalesPanel.jsx`, `src/features/credit/CreditSaleDetailPanel.jsx`, `src/features/wallet/useWallet.js`, `src/features/wallet/WalletPanel.jsx`, `src/pages/CreditSalesPage.jsx`, `src/pages/WalletPage.jsx`, `src/commands/credit_sales.js`, `src/commands/wallet.js`.

---

## BACKEND FAULTS (must fix before production)

### 1. Race condition in `record_credit_payment` — `outstanding` balance read outside the DB transaction allows double-payment
**Where:** `src-tauri/src/commands/credit_sales.rs` — `record_credit_payment()`, the outstanding balance check before `db_tx.begin()`
**What:** The guard `if payment_amount > credit_sale.outstanding` fetches `credit_sales.outstanding` using `&pool` before the transaction begins. If two cashiers simultaneously process payments against the same credit sale — common in a store where the manager and cashier both have access — both will read the same `outstanding` value, both will pass the check, and both will commit their respective `UPDATE credit_sales SET outstanding = outstanding - $1`. The total deducted will exceed the actual outstanding, driving `outstanding` negative and `amount_paid` above `amount`. The customer effectively receives a phantom credit.
**Fix:** Move the outstanding read and the validation inside `db_tx` using `SELECT ... FOR UPDATE`:
```rust
let cs = sqlx::query!(
    "SELECT outstanding, status FROM credit_sales WHERE id = $1 FOR UPDATE",
    id
)
.fetch_one(&mut *db_tx).await?;
if payment_amount > cs.outstanding {
    return Err(AppError::Validation(format!(
        "Payment of {} exceeds outstanding balance of {}", payment_amount, cs.outstanding
    )));
}
```

### 2. Race condition in `top_up_wallet` — `wallet_balance` read outside the transaction produces wrong `balance_before` and `balance_after` in audit log
**Where:** `src-tauri/src/commands/wallet.rs` — `top_up_wallet()`, the `SELECT wallet_balance FROM customers WHERE id = $1` call before `db_tx.begin()`
**What:** `balance_before` for the `customer_wallet_transactions` INSERT is captured from a `&pool` read before any transaction starts. If another wallet operation (a POS sale deducting wallet, another top-up, or a manual adjustment) commits between this read and the `UPDATE customers SET wallet_balance = wallet_balance + $1` inside `db_tx`, the stored `balance_before` will be wrong. The audit log will show a `balance_before` → `balance_after` pair that does not reflect the actual transition, making the wallet transaction history unreliable for reconciliation.
**Fix:** Read `wallet_balance` inside `db_tx` with `FOR UPDATE` and use the locked value for both the audit row and the update:
```rust
let balance_before: Decimal = sqlx::query_scalar!(
    "SELECT wallet_balance FROM customers WHERE id = $1 FOR UPDATE",
    customer_id
)
.fetch_one(&mut *db_tx).await?;
let balance_after = balance_before + amount;
// Now UPDATE and INSERT using balance_before / balance_after
```

### 3. `record_credit_payment` does not update `customers.outstanding_balance` after payment — the customer's total balance stays permanently inflated
**Where:** `src-tauri/src/commands/credit_sales.rs` — `record_credit_payment()`, the `db_tx` block
**What:** The command correctly reduces `credit_sales.outstanding` and updates `credit_sales.status`. It does not execute `UPDATE customers SET outstanding_balance = GREATEST(0, outstanding_balance - $1) WHERE id = $2`. The `customers.outstanding_balance` field — which is the denormalized total shown on the customer profile, on the POS customer picker, and in the credit warning check at time of sale — never decreases. A customer who fully pays off a ₦50,000 credit will still be shown as owing ₦50,000 everywhere in the app, and the POS will continue to flag them as having an outstanding balance, potentially blocking further credit sales even after full payment.
**Fix:** Inside `db_tx`, after updating `credit_sales`:
```rust
sqlx::query!(
    "UPDATE customers SET
         outstanding_balance = GREATEST(0, outstanding_balance - $1),
         updated_at = NOW()
     WHERE id = $2",
    payment_amount, credit_sale.customer_id
)
.execute(&mut *db_tx).await?;
```

### 4. `top_up_wallet` accepts negative `amount` values — a negative top-up silently deducts wallet balance with no permission check or audit classification
**Where:** `src-tauri/src/commands/wallet.rs` — `top_up_wallet()`, input validation
**What:** The `amount` field in the `TopUpWalletDto` is a `Decimal` with no positivity check. A payload of `{ customer_id: X, amount: -500.00 }` will pass all validation, execute `UPDATE customers SET wallet_balance = wallet_balance + (-500.00)` — a deduction — and write a `customer_wallet_transactions` row with `transaction_type = 'top_up'` but a negative amount. The audit log is factually wrong (it says top-up but performed a deduction), and a cashier with only `wallet.topup` permission can drain customer wallets by sending negative amounts. The `guard_permission` check on `wallet.topup` is bypassed for deductions because they are routed through the top-up command.
**Fix:**
```rust
if amount <= Decimal::ZERO {
    return Err(AppError::Validation(
        "Top-up amount must be greater than zero. Use wallet adjustment for corrections.".into()
    ));
}
```

### 5. `create_credit_sale` (called from `create_transaction`) does not check the customer's available credit limit before creating the credit sale record
**Where:** `src-tauri/src/commands/credit_sales.rs` — `create_credit_sale_inner()` or the equivalent function called by `create_transaction`
**What:** The credit sale creation inserts directly into `credit_sales` without first verifying that `payment_amount <= (customer.credit_limit - customer.outstanding_balance)`. If a customer has a ₦100,000 limit, ₦95,000 already outstanding, and a cashier rings a ₦20,000 sale on credit, the transaction commits successfully and `outstanding_balance` becomes ₦115,000 — ₦15,000 over the credit limit. The credit limit exists in the schema but is never enforced at the point of sale.
**Fix:** Inside the credit sale creation logic, before inserting:
```rust
let headroom: Decimal = sqlx::query_scalar!(
    "SELECT GREATEST(0, credit_limit - outstanding_balance) FROM customers WHERE id = $1",
    customer_id
)
.fetch_one(&pool).await?;
if sale_amount > headroom {
    return Err(AppError::Validation(format!(
        "Credit limit exceeded. Customer has ₦{} available credit, sale is ₦{}.",
        headroom, sale_amount
    )));
}
```
This check must run inside `db_tx` with `FOR UPDATE` on the customer row to prevent concurrent credit sales from both passing the limit check.

### 6. `record_credit_payment` does not write to `sync_queue` — credit payments never reach Supabase
**Where:** `src-tauri/src/commands/credit_sales.rs` — `record_credit_payment()`, after `db_tx.commit()`
**What:** After committing, the function does not call `crate::database::sync::queue_row(...)` for the `credit_payments` INSERT, the `credit_sales` UPDATE, or the `customers.outstanding_balance` UPDATE. The Supabase replica will permanently show the credit sale as `'open'` with full outstanding balance even after the customer has paid in full. Any cloud-based credit aging reports, customer-facing balance views, or multi-store analytics will show incorrect — and increasingly stale — credit data. This is the same class of omission as Transactions Fault #11.
**Fix:** After `db_tx.commit()`:
```rust
sync::queue_row(&pool, "credit_payments", &payment_id.to_string(), "INSERT").await.ok();
sync::queue_row(&pool, "credit_sales", &id.to_string(), "UPDATE").await.ok();
sync::queue_row(&pool, "customers", &credit_sale.customer_id.to_string(), "UPDATE").await.ok();
```

### 7. `top_up_wallet` does not write to `sync_queue` — wallet balances in Supabase are permanently stale
**Where:** `src-tauri/src/commands/wallet.rs` — `top_up_wallet()`, after `db_tx.commit()`
**What:** Same omission as Fault #6. Every wallet top-up, deduction (via POS), and adjustment commits locally but is never queued for cloud sync. The Supabase `customers.wallet_balance` column drifts indefinitely from the local value. A customer checking their balance through any cloud-connected interface (e.g., a future customer-facing app or web portal) will see the wrong amount.
**Fix:** Queue `customers` and `customer_wallet_transactions` rows to `sync_queue` after every wallet mutation.

### 8. `get_credit_sale` (single record fetch) has no `store_id` scope enforcement for non-global users
**Where:** `src-tauri/src/commands/credit_sales.rs` — `get_credit_sale()` or `fetch_credit_sale()`
**What:** The query is `SELECT * FROM credit_sales WHERE id = $1` with no `AND store_id = $2` guard for non-global users. A cashier at Store A who knows a `credit_sale_id` from Store B can call `get_credit_sale(store_b_id)` via the RPC endpoint and read the full record — customer name, amount owed, payment history. The `guard_permission` check only verifies `credit_sales.read`, not store membership.
**Fix:**
```rust
if !claims.is_global {
    let user_store = claims.store_id.ok_or(AppError::Forbidden)?;
    if cs.store_id != user_store {
        return Err(AppError::Forbidden);
    }
}
```

### 9. `record_credit_payment` sets `status = 'paid'` when `payment_amount >= outstanding` but does not account for previously recorded partial payments — `amount_paid` can exceed `amount`
**Where:** `src-tauri/src/commands/credit_sales.rs` — `record_credit_payment()`, status update logic
**What:** The status transition uses:
```rust
let new_status = if payment_amount >= cs.outstanding { "paid" } else { "partial" };
```
And then:
```rust
UPDATE credit_sales SET amount_paid = amount_paid + $1, outstanding = outstanding - $1, status = $2
```
This logic is correct for the `outstanding` field. However, if a bug or a manual DB adjustment has caused `amount_paid + outstanding != amount` (a realistic scenario given Transactions Fault #10 — partial refunds not updating credit_sales), the `status = 'paid'` assignment will be wrong. Additionally, if `payment_amount` is accepted as greater than `outstanding` (before Fault #1 is fixed), `amount_paid` will exceed `amount`, and `outstanding` will go negative. Add an explicit assertion:
```rust
debug_assert!(cs.amount_paid + cs.outstanding == cs.amount,
    "credit_sale {} has inconsistent amount_paid + outstanding", id);
let new_outstanding = (cs.outstanding - payment_amount).max(Decimal::ZERO);
let new_amount_paid = cs.amount - new_outstanding;
```

### 10. `adjust_wallet_balance` (manager manual adjustment) has no mandatory `reason` field and writes no audit log entry
**Where:** `src-tauri/src/commands/wallet.rs` — `adjust_wallet_balance()`
**What:** The manual balance adjustment command — which allows a manager to arbitrarily increase or decrease any customer's wallet balance — accepts an optional `notes` field. No `write_audit_log(...)` call is made. A manager who adjusts a balance by -₦10,000 leaves no traceable record in the audit log. This command is the highest-risk wallet operation (direct balance manipulation without a linked transaction) and should require the strongest audit trail of all wallet operations.
**Fix:** Make `reason` mandatory in the DTO:
```rust
pub struct AdjustWalletDto {
    pub customer_id: i32,
    pub amount: Decimal,      // positive = credit, negative = debit
    pub reason: String,       // mandatory, min 10 chars
}
```
And write a `write_audit_log` entry with `severity = "warning"` and a JSON summary of `{ before, after, delta, reason, performed_by }`.

### 11. `get_credit_sales` filters `DATE(created_at) = CURRENT_DATE` using PostgreSQL server UTC — "Today's Credit" stat is wrong after ~11 PM in WAT
**Where:** `src-tauri/src/commands/credit_sales.rs` — `get_credit_sales_stats()` or the today-filter clause in `get_credit_sales()`
**What:** Identical to Transactions Backend Fault #8. PostgreSQL's `CURRENT_DATE` uses server UTC. A credit sale made at 11:30 PM Nigerian time (WAT, UTC+1) is stored as `00:30 UTC next day` and attributed to tomorrow's stats. Stores will consistently undercount today's credit sales in the last hour of business — the highest-volume period for credit reconciliation.
**Fix:**
```sql
DATE(cs.created_at AT TIME ZONE 'Africa/Lagos') = CURRENT_DATE AT TIME ZONE 'Africa/Lagos'
```

### 12. `deduct_wallet` (called from `create_transaction` for wallet payment method) does not verify `wallet_balance >= sale_amount` inside a transaction — balance can go negative
**Where:** `src-tauri/src/commands/wallet.rs` — `deduct_wallet_inner()` called by `create_transaction`
**What:** The deduction path in `create_transaction` checks `customer.wallet_balance >= payload.total_amount` using `&pool` before `db_tx.begin()` (the same pattern as the stock availability race condition in Transactions Fault #2). A customer with exactly ₦5,000 in their wallet who makes two simultaneous wallet purchases of ₦3,000 each — on two POS terminals — will have both sales committed, leaving their wallet at -₦1,000. `allow_negative_wallet` is not checked because the check was already passed on the stale read.
**Fix:** Move the wallet sufficiency check inside `db_tx` with `SELECT wallet_balance FROM customers WHERE id = $1 FOR UPDATE`.

---

## BACKEND UPGRADES (should improve)

### 1. `get_credit_sales` fetches payment history per credit sale in a separate loop — N+1 queries
For each credit sale returned in the list query, a separate `SELECT * FROM credit_payments WHERE credit_sale_id = $1` is executed to populate a `payments` field or `last_payment_date`. A store with 200 credit sales on a page will execute 200 + 1 queries per page load. Collapse into a LEFT JOIN aggregate:
```sql
LEFT JOIN (
    SELECT credit_sale_id,
           COUNT(*) AS payment_count,
           SUM(amount) AS total_paid,
           MAX(paid_at) AS last_payment_date
    FROM credit_payments GROUP BY credit_sale_id
) cp ON cp.credit_sale_id = cs.id
```

### 2. Missing database indexes on core credit and wallet filter columns
`get_credit_sales` filters on `customer_id`, `store_id`, `status`, and `due_date`. `get_wallet_transactions` filters on `customer_id` and `created_at`. None of these have composite indexes:
```sql
CREATE INDEX IF NOT EXISTS idx_credit_sales_store_status
    ON credit_sales(store_id, status);
CREATE INDEX IF NOT EXISTS idx_credit_sales_customer
    ON credit_sales(customer_id, store_id);
CREATE INDEX IF NOT EXISTS idx_credit_sales_due_date
    ON credit_sales(due_date, status) WHERE status IN ('open', 'partial');
CREATE INDEX IF NOT EXISTS idx_wallet_tx_customer
    ON customer_wallet_transactions(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_payments_sale
    ON credit_payments(credit_sale_id, paid_at DESC);
```

### 3. `get_wallet_transactions` returns an unbounded result set — no pagination
The query `SELECT * FROM customer_wallet_transactions WHERE customer_id = $1 ORDER BY created_at DESC` has no `LIMIT`/`OFFSET`. A customer who has been a member for 2 years with daily wallet usage could have 700+ transaction rows returned in a single query. The frontend renders all of them in one list. Add `limit` and `page` parameters matching the pattern in `get_credit_sales`.

### 4. `get_customer_credit_summary` runs three separate aggregate queries — should be a single query
The command currently executes:
1. `SELECT SUM(amount) FROM credit_sales WHERE customer_id = $1`
2. `SELECT SUM(amount_paid) FROM credit_sales WHERE customer_id = $1`
3. `SELECT COUNT(*) FROM credit_sales WHERE customer_id = $1 AND status = 'overdue'`

These should be a single aggregate:
```sql
SELECT
    COUNT(*) FILTER (WHERE status != 'cancelled') AS total_sales,
    COALESCE(SUM(amount), 0) AS total_credit_given,
    COALESCE(SUM(amount_paid), 0) AS total_paid,
    COALESCE(SUM(outstanding), 0) AS total_outstanding,
    COUNT(*) FILTER (WHERE status = 'overdue') AS overdue_count,
    MAX(created_at) AS last_credit_date
FROM credit_sales WHERE customer_id = $1 AND store_id = $2
```

### 5. `record_credit_payment` error on zero-balance credit sales produces a misleading message
If `outstanding = 0` (already paid), the current error is a generic SQLx constraint violation or "payment exceeds outstanding: 0." The structured error should be:
```rust
if cs.outstanding == Decimal::ZERO {
    return Err(AppError::Validation(
        format!("Credit sale {} is already fully paid.", id)
    ));
}
if cs.status == "cancelled" {
    return Err(AppError::Validation(
        format!("Cannot record payment on a cancelled credit sale.")
    ));
}
```

### 6. No background job to auto-mark `credit_sales` as `'overdue'` when `due_date` passes
The `due_date` column exists but nothing updates `status` from `'open'` or `'partial'` to `'overdue'` when the date passes. A credit sale due 30 days ago still shows as `'open'`. The `get_credit_sales_stats` overdue count uses `status = 'overdue'` which is always zero unless set manually. Add a startup / nightly command:
```rust
pub async fn mark_overdue_credit_sales(pool: &PgPool) -> Result<u64, AppError> {
    let result = sqlx::query!(
        "UPDATE credit_sales SET status = 'overdue', updated_at = NOW()
         WHERE status IN ('open', 'partial') AND due_date < CURRENT_DATE"
    ).execute(pool).await?;
    Ok(result.rows_affected())
}
```
Call this in `lib.rs` on app startup and register it as a Tauri command for manual triggering.

### 7. `top_up_wallet` and `deduct_wallet` are separate commands but share almost identical logic — significant code duplication
Both commands: validate the customer, read `wallet_balance`, compute `balance_before`/`balance_after`, update `customers.wallet_balance`, insert into `customer_wallet_transactions`, and write an audit log. Extract a shared `mutate_wallet_inner(pool, customer_id, delta, transaction_type, performed_by, reference, notes)` function that takes a signed `Decimal` delta (positive = credit, negative = debit) and handles the entire flow. Both `top_up_wallet` and `deduct_wallet_inner` call this shared function.

### 8. `get_credit_sales` duplicates the WHERE clause in COUNT and data queries — same maintenance risk as Transactions Upgrade #1
Any change to the filter logic (adding a `business_id` scope, a `date_from` filter, a soft-delete guard) must be made in two places. Extract into a CTE.

### 9. `credit_payments.payment_method` has no validation against an enum of allowed methods
A payment can be recorded with `payment_method = "banana"` and it will be stored. The field should be validated against `['cash', 'card', 'mobile_money', 'bank_transfer', 'wallet']` in Rust before insertion:
```rust
const ALLOWED_METHODS: &[&str] = &["cash", "card", "mobile_money", "bank_transfer", "wallet"];
if !ALLOWED_METHODS.contains(&payload.payment_method.as_str()) {
    return Err(AppError::Validation(format!(
        "Invalid payment method '{}'. Allowed: {:?}", payload.payment_method, ALLOWED_METHODS
    )));
}
```

### 10. `get_credit_sales_stats` is not scoped by date range — all-time totals are meaningless for dashboard cards
The stats query returns lifetime totals for `total_credit`, `total_collected`, `total_outstanding`, and `overdue_count`. A dashboard card showing "Total Credit Given: ₦4,200,000" for a store that has been operating for 18 months is contextually useless. Add optional `date_from`/`date_to` params, and add `collected_today` and `new_credit_today` as the two operationally critical daily KPIs.

---

## BACKEND FEATURES (add for completeness)

### 1. No configurable credit terms per store — `due_date` is either hardcoded or not set at all
The `due_date` on a credit sale should be auto-calculated from `store_settings.credit_term_days` (e.g., net-30). Currently either the frontend sends an explicit due_date (error-prone) or none is set (leaving `due_date = NULL`, making overdue detection impossible). Add `credit_term_days INT DEFAULT 30` to `store_settings`, and in `create_credit_sale_inner`:
```rust
let due_date = Utc::now().date_naive() + chrono::Duration::days(settings.credit_term_days as i64);
```

### 2. No credit limit per customer — credit is unlimited by default
`customers.credit_limit` exists in the schema but `create_credit_sale_inner` (as shown in Fault #5) never checks it. Beyond enforcement, there is no command to `set_customer_credit_limit` from the UI, no display of credit limit utilization on the customer profile, and no alert when a customer is near their limit. Add `set_customer_credit_limit(customer_id, limit, reason, performed_by)` gated on `customers.manage_credit` permission, with an audit log entry.

### 3. No bulk payment recording — paying multiple credit sales for one customer requires N separate API calls
A customer with 5 open credit sales who comes to pay everything off requires 5 separate `record_credit_payment` calls. Add `record_bulk_credit_payment(customer_id, amount, payment_method, notes)` that distributes the payment across open credit sales in FIFO order (oldest due_date first), updating each `credit_sales` record and the customer's `outstanding_balance` in a single `db_tx`.

### 4. No credit sale write-off capability for unrecoverable debt
When a customer's debt becomes unrecoverable (customer has left, business closed, prolonged default), there is no formal write-off command. A write-off should: set `status = 'written_off'`, zero `outstanding`, create a `credit_writeoffs` ledger record, write to `audit_logs` with manager authorisation, and optionally reduce `customers.outstanding_balance`. Without this, uncollectable debts stay as `'open'` or `'overdue'` indefinitely and distort the receivables balance.

### 5. No wallet transfer between customers
There is no command to transfer wallet balance from one customer to another. This is a common operation in group/family accounts where a parent tops up a wallet and transfers to a child account. Add `transfer_wallet_balance(from_customer_id, to_customer_id, amount, reason, performed_by)` inside a single `db_tx` that deducts from one and credits the other, writing two `customer_wallet_transactions` rows with cross-referencing `reference` fields.

### 6. No credit payment receipt / reference number generation
`record_credit_payment` inserts a `credit_payments` row but generates no human-readable `reference_no` (like `CPT-001`, `CPT-002`). The only identifier is the internal `id`. Cashiers have no printable or speakable reference to give the customer confirming their payment. Add `next_payment_ref_no(store_id)` and store the result in `credit_payments.reference_no`.

### 7. No interest or late fee calculation for overdue credit
After marking a credit sale `'overdue'`, there is no mechanism to apply a configurable late fee or interest rate. `store_settings` has no `credit_late_fee_pct` or `credit_interest_rate_monthly` field. Without this, the system provides no financial disincentive for late payment, and stores that rely on interest income from credit have no way to track or charge it.

### 8. No `credit_sales` summary query broken down by aging bucket for receivables reporting
The standard accounting view for credit receivables is an aging analysis: Current (not yet due), 1–30 days overdue, 31–60 days, 61–90 days, 90+ days. Add `get_credit_aging_report(store_id, as_of_date)`:
```sql
SELECT
    COUNT(*) FILTER (WHERE due_date >= CURRENT_DATE) AS current_count,
    SUM(outstanding) FILTER (WHERE due_date >= CURRENT_DATE) AS current_amount,
    COUNT(*) FILTER (WHERE due_date BETWEEN CURRENT_DATE - 30 AND CURRENT_DATE - 1) AS overdue_30_count,
    SUM(outstanding) FILTER (WHERE due_date BETWEEN CURRENT_DATE - 30 AND CURRENT_DATE - 1) AS overdue_30_amount,
    -- ... 31-60, 61-90, 90+
FROM credit_sales WHERE store_id = $1 AND status IN ('open','partial','overdue')
```

### 9. No event hook to the loyalty module when a credit payment is recorded
If a credit sale originally earned loyalty points, and the customer later defaults and the sale is written off, no event is fired to the loyalty module to revoke those points. Similarly, if a loyalty system awards double points on credit sales, the points are awarded at time of sale but should be contingent on payment. Add a post-payment hook: `super::loyalty::confirm_credit_sale_points(credit_sale_id)` called after a credit sale transitions to `'paid'`.

### 10. No wallet top-up reversal / refund command
If a cashier accidentally tops up the wrong customer's wallet, or tops up an incorrect amount, there is no `reverse_wallet_topup(wallet_transaction_id, reason)` command. A manager must manually call `adjust_wallet_balance` with a negative amount. This lacks the audit trail linking the reversal to the original top-up. Add a formal reversal command that: reads the original `customer_wallet_transactions` row, validates the wallet has sufficient balance, executes the deduction in `db_tx`, writes a new `customer_wallet_transactions` row with `transaction_type = 'reversal'` and `reference = original_transaction_id`, and updates `customers.wallet_balance`.

---

## FRONTEND FAULTS (must fix before production)

### 1. `CreditSaleDetailPanel` `isPartiallyPaid` guard checks `cs.status === 'partial'` but backend sets `status = 'partial'` only on some paths and `payment_status = 'partial'` on others — payment history may never load
**Where:** `src/features/credit/CreditSaleDetailPanel.jsx`
**What:** Analogous to Transactions Frontend Fault #1. If the backend's `record_credit_payment` updates `payment_status` to `'partial'` (following the transactions pattern) rather than `status`, then `const isPartiallyPaid = cs?.status === 'partial'` is always `false` for partially paid records with `status = 'open'`. Any `useQuery` gated on `isPartiallyPaid` (e.g., the payment history sub-query) never fires. The payment history panel on the credit sale detail is always empty until the sale is fully paid.
**Fix:** Audit whether `status` or `payment_status` is updated on partial payment, and align the frontend check accordingly:
```js
const isPartiallyPaid = cs?.status === "partial" || cs?.payment_status === "partial";
```

### 2. `RecordPaymentModal` payment amount input has no client-side cap at the outstanding balance — users receive a jarring backend error
**Where:** `src/features/credit/CreditSaleDetailPanel.jsx` — `RecordPaymentModal`
**What:** The `<Input type="number" />` for payment amount has no `max={outstanding}` constraint and no inline validation message. A cashier typing ₦60,000 against a ₦50,000 outstanding balance will successfully submit the form, see a loading spinner, then receive a generic error toast ("Payment failed"). The outstanding balance is available in the component from `cs.outstanding` and should bound the input:
```js
const isOverpay = parseFloat(paymentAmount) > parseFloat(cs.outstanding);
// Show: "Amount cannot exceed the outstanding balance of ₦{formatCurrency(cs.outstanding)}"
// Disable submit while isOverpay is true
```

### 3. Wallet balance shown in `WalletPanel` and customer picker is stale after a top-up — no query invalidation
**Where:** `src/features/wallet/WalletPanel.jsx` and the POS customer picker component
**What:** After `topUpWallet.mutateAsync(...)` resolves successfully, `queryClient.invalidateQueries(["wallet-transactions", customer_id])` is called but `queryClient.invalidateQueries(["customer", customer_id])` is not. The `customers.wallet_balance` displayed in the customer profile card and the POS customer picker continues to show the pre-top-up balance until the next full refetch or page navigation. A cashier who tops up ₦10,000 and immediately checks the customer balance sees the old value and may top up again.
**Fix:** In the `onSuccess` callback of `useTopUpWallet`:
```js
queryClient.invalidateQueries(["customer", customerId]);
queryClient.invalidateQueries(["wallet-transactions", customerId]);
queryClient.invalidateQueries(["customers"]); // invalidate list too
```

### 4. `CreditSalesPanel` status badges render unstyled for `'overdue'` and `'written_off'` statuses
**Where:** `src/features/credit/CreditSalesPanel.jsx` — `StatusBadge` or the inline status class map
**What:** The status color map covers `'open'`, `'partial'`, `'paid'`, and `'cancelled'`. Both `'overdue'` and `'written_off'` fall through to a default that renders plain unstyled text or a neutral grey badge. In a list of credit sales, overdue accounts — the most operationally urgent — are visually indistinguishable from new open accounts.
**Fix:**
```js
overdue:     "bg-destructive/15 text-destructive border-destructive/30",
written_off: "bg-muted text-muted-foreground border-border line-through",
partial:     "bg-warning/15 text-warning border-warning/30",
```

### 5. Search input does not reset to page 1 on new search — identical pattern to Transactions Fault #3 and PO Fault #3
**Where:** `src/features/credit/CreditSalesPanel.jsx` — `handleSearchChange`
**What:** `setPage(1)` is not called alongside `setUrlSearch(val)` in the debounce callback. Users on page 3+ will see an empty table when their search matches fewer total records than the page offset.
**Fix:**
```js
debounceTimer.current = setTimeout(() => {
  setUrlSearch(val);
  setPage(1);
}, 400);
```

### 6. `TopUpWalletModal` has no confirmation step for large top-up amounts — accidental large top-ups are not catchable
**Where:** `src/features/wallet/WalletPanel.jsx` — `TopUpWalletModal`
**What:** Entering ₦1,000,000 instead of ₦10,000 (a zero-entry error, common on touchscreen POS) submits immediately with no "Are you sure?" step. The wallet is topped up and there is no reversal command (Backend Feature #10 above). Add a configurable threshold (e.g., from `store_settings.wallet_large_topup_threshold`, defaulting to ₦50,000) above which a confirmation dialog renders:
```jsx
{amount > largeThreshold && (
  <Alert variant="warning">
    You are about to add {formatCurrency(amount)} to this wallet. Please confirm.
  </Alert>
)}
```

### 7. `CreditSaleDetailPanel` shows no loading skeleton — flashes "Credit sale not found" empty state on navigation
**Where:** `src/features/credit/CreditSaleDetailPanel.jsx`
**What:** During the initial `useQuery` load, `!cs` is `true` and the component renders the empty state ("Select a credit sale to view details" or "Not found") before data arrives. This is especially jarring when navigating from the list — the user clicks a row and briefly sees a "not found" message.
**Fix:** Add an `isLoading` branch that renders a skeleton matching the detail panel layout, identical to the fix pattern needed in `PurchaseOrderDetailPanel`.

### 8. `RecordPaymentModal` does not show the `credit_sale.reference_no` or linked transaction reference — cashier cannot confirm they are paying the right record
**Where:** `src/features/credit/CreditSaleDetailPanel.jsx` — `RecordPaymentModal`
**What:** The payment modal opens with only the outstanding amount and a payment amount input. No display of the credit sale reference (`CS-001`), the linked transaction reference (`TXN-ABC-001`), the sale date, or the items purchased. A cashier handling multiple open credit accounts for the same customer cannot confirm which debt they are collecting against.
**Fix:** Add a non-editable summary header in the modal:
```jsx
<div>Credit Sale: {cs.reference_no} | Original: {formatCurrency(cs.amount)}</div>
<div>Linked to: {cs.transaction_reference} on {formatDate(cs.created_at)}</div>
<div>Outstanding: {formatCurrency(cs.outstanding)}</div>
```

### 9. `WalletPage` wallet transaction list has no empty state guidance when a customer has no wallet history
**Where:** `src/features/wallet/WalletPanel.jsx`
**What:** When `walletTransactions.length === 0`, the component renders nothing (an empty table body with headers and no rows, or no component at all). The user sees a blank panel with no explanation. An empty state should explain: "No wallet transactions yet. Top up this customer's wallet to get started." with a prominent "Top Up" CTA.

### 10. `CreditSalesPanel` `clearFilters` does not reset the status `<Select>` visually if it is uncontrolled
**Where:** `src/features/credit/CreditSalesPanel.jsx` — `FilterBar`
**What:** Same pattern as PO Audit Frontend Fault #10. If the status select uses `defaultValue` instead of `value`, calling `setStatus(null)` resets the URL state and re-fetches but the select still visually shows the old status. All filter controls must be fully controlled components.

---

## FRONTEND UPGRADES (should improve)

### 1. No KPI stat cards at the top of `CreditSalesPage`
The page goes straight to the filter bar and table. The operationally critical numbers a store manager needs at a glance are absent: "Total Outstanding: ₦320,000 | Overdue: ₦85,000 (12 accounts) | Collected Today: ₦45,000 | New Credit Today: ₦30,000." Add a 4-card stat row sourced from `useCreditSalesStats()`, styled consistently with TransactionsPage and PurchaseOrdersPage.

### 2. No aging analysis panel — the most important credit reporting view is missing
A "Receivables Aging" panel showing outstanding broken down by 0–30 / 31–60 / 61–90 / 90+ days overdue is the standard tool for credit management in any POS or ERP system. This is a bar chart or a compact table above the main credit list, sourced from `useAgingReport()`. Store owners will immediately ask for this on day one of live use.

### 3. Tab-based status filter missing — the current dropdown is low-discoverability
Replace or supplement the status dropdown with a tab strip showing counts per status, matching the Transactions and PO module patterns:
```js
const STATUS_TABS = [
  { label: "All", value: null },
  { label: "Open", value: "open" },
  { label: "Partial", value: "partial" },
  { label: "Overdue", value: "overdue" },
  { label: "Paid", value: "paid" },
  { label: "Written Off", value: "written_off" },
  { label: "Cancelled", value: "cancelled" },
]
```

### 4. `CreditSaleDetailPanel` items table is missing — the products purchased on credit are not visible
The credit sale detail shows the outstanding balance and payment history but not what was actually sold. A cashier disputing a credit balance with a customer cannot see the original line items (item name, quantity, price) without navigating to the linked transaction. Embed a read-only items list sourced from `useTransaction(cs.transaction_id).items`.

### 5. Wallet transaction history has no date range filter or search
`WalletPanel` shows all wallet transactions for a customer with no ability to filter by date or search by reference. A customer who wants to verify a specific top-up from two weeks ago requires the cashier to scroll through the full unfiltered list. Add `date_from`, `date_to`, and a `search` (by reference_no or notes) to `useWalletTransactions`.

### 6. `CreditSalesPanel` table has no column sorting
`reference_no`, `created_at`, `due_date`, `outstanding`, and `customer_name` are all natural sort keys. Managers sort by due_date ascending to prioritise collections, or by outstanding descending to focus on large debts first. Add `orderBy`/`sortDir` state and pass to `useGetCreditSales`, with backend `ORDER BY` support.

### 7. "Pay Now" CTA on the credit sales list should open `RecordPaymentModal` directly without navigating to the detail page
Currently a manager must: (1) click a credit sale row, (2) wait for detail to load, (3) click "Record Payment," (4) fill in the modal. For high-volume collection days, a row-level "Pay" action button in the list table (opening `RecordPaymentModal` pre-populated with the credit sale) cuts the workflow to two steps.

### 8. `WalletPanel` does not show the customer's wallet balance prominently before the transaction list
The transaction history list is the main focus of the wallet panel, but the current balance is either shown in the page title or a small label. A large, prominently styled balance display ("Current Balance: ₦12,500.00") at the top of the panel, with a delta indicator ("↑ ₦5,000 last top-up Apr 28") gives cashiers immediate context before they scroll into history.

### 9. No "Due This Week" smart filter shortcut in `CreditSalesPanel`
Alongside "Today", "This Week", "This Month" date presets for `created_at`, add a dedicated "Due This Week" preset that filters on `due_date BETWEEN today AND today + 7`. This is the most actionable filter for a collections workflow and should be a first-class button, not buried in a date range calendar.

### 10. `CreditSalesPage` and `WalletPage` are separate pages but likely share a customer context — switching between them loses the selected customer
A cashier looking up a specific customer's credit, then wanting to check their wallet balance, navigates to a different page and must re-search for the same customer. Consider a unified "Customer Account" page with tabbed sections for Credit Sales, Wallet, and Loyalty — or at minimum, persist the `customer_id` filter in URL params across both pages.

---

## FRONTEND FEATURES (add for completeness)

### 1. No printable credit statement for customers
A customer visiting to dispute or settle their debt needs a printed statement listing all open credit sales: date, reference, items (summary), original amount, amount paid, and outstanding. Add a "Print Statement" button on the customer's credit summary that generates a formatted A4 PDF via the backend (`generate_credit_statement(customer_id, store_id)`).

### 2. No bulk payment modal for a customer's entire outstanding balance
The "Pay All" use case — a customer settling all open credit in one visit — requires recording individual payments for each open credit sale. A "Pay All Outstanding" button on the customer's credit summary opens a modal showing: total outstanding = ₦X, payment method selector, notes field. The single API call to `record_bulk_credit_payment` distributes the amount across all open sales.

### 3. No overdue alert widget on the home dashboard
Managers starting their day have no in-app notification of overdue credit accounts. A dashboard widget "12 accounts overdue — ₦85,000 at risk" with a "View →" link to `CreditSalesPage?status=overdue` surfaces this immediately. Data from `useCreditSalesStats().overdue_count`.

### 4. No CSV export for credit sales or wallet transactions
Accounting teams need credit data exports for reconciliation with bookkeeping software (QuickBooks, Wave). Add an "Export" button to both pages that generates a CSV of the current filtered view: reference_no, customer_name, amount, amount_paid, outstanding, due_date, status, cashier.

### 5. No customer-facing credit balance widget in the POS customer picker
When a cashier selects a customer at POS, the customer picker shows name and phone. It should also show: wallet balance (with a coloured indicator: green = positive, grey = zero), outstanding credit balance (amber = has credit, red = overdue), and credit limit utilization (e.g., "₦30,000 of ₦100,000 used"). This prevents cashiers from accidentally extending credit to customers who are already at or over their limit.

### 6. No wallet top-up from the POS screen
A cashier currently must navigate to `WalletPage` to top up a customer's wallet. If a customer wants to load their wallet at the point of purchase, the cashier must exit the sale, navigate away, top up, return, and restart the sale. Add a "Top Up Wallet" quick action directly in the POS customer picker panel, accessible mid-transaction.

### 7. No credit sale aging chart on `CreditSalesPage`
A horizontal stacked bar chart or pie chart showing the proportion of outstanding credit by aging bucket (current / 1–30 / 31–60 / 60+) gives managers an immediate visual health check of their receivables portfolio. Sourced from `useAgingReport()`.

### 8. No inline "Mark as Paid (Cash)" quick action on the credit list for small balances
For small credit balances (below a configurable threshold), a row-level "Mark Paid (Cash)" action that records a full cash payment without opening a modal saves significant time in high-volume collection scenarios. Requires a confirmation tooltip ("Record ₦2,400 cash payment for this sale?") and calls `record_credit_payment` with `{ amount: outstanding, payment_method: 'cash' }`.

### 9. No notification or visual indicator when a customer reaches their credit limit during POS sale
When a cashier is building a cart and selects a customer with a credit limit, and the cart total would exceed the customer's available credit, there is no real-time warning. The cashier only finds out when they attempt to charge and the backend rejects it. Add a computed warning in the cart store: if `payment_method === 'credit'` and `cartTotal > customer.creditAvailable`, show an amber alert banner: "This customer has ₦{available} available credit — current cart is ₦{cartTotal}."

### 10. No loyalty-credit integration display
If a customer has both outstanding credit and loyalty points, the relationship between them is invisible. Some POS systems allow redeeming loyalty points to offset credit balances. Even if this feature is not implemented, the customer profile should show both balances side-by-side so cashiers can have an informed conversation with the customer about their account status.

---

## CROSS-CUTTING RISKS

### 1. Data consistency — `customers.outstanding_balance` is a denormalized cache that can permanently diverge from the sum of `credit_sales.outstanding`
`customers.outstanding_balance` is incremented when a credit sale is created (in `create_transaction`) and decremented when payment is recorded (in `record_credit_payment` — once Fault #3 is fixed). However, any path that modifies `credit_sales.outstanding` without updating `customers.outstanding_balance` — partial refunds (Transactions Fault #10), credit sale cancellations, write-offs, or direct DB adjustments — will cause permanent drift. A periodic reconciliation job is essential:
```sql
UPDATE customers c SET
    outstanding_balance = (
        SELECT COALESCE(SUM(outstanding), 0)
        FROM credit_sales
        WHERE customer_id = c.id AND status NOT IN ('paid','cancelled','written_off')
    )
WHERE c.id IN (SELECT DISTINCT customer_id FROM credit_sales WHERE updated_at > NOW() - INTERVAL '1 hour');
```

### 2. Data consistency — `customers.wallet_balance` is a denormalized cache that can diverge from the sum of `customer_wallet_transactions`
Similarly, `customers.wallet_balance` is updated on every wallet mutation but any path that fails mid-transaction and rolls back the `customer_wallet_transactions` INSERT while the `UPDATE customers` already committed (or vice versa) will leave these permanently out of sync. The `deduct_wallet_inner` called by `create_transaction` is particularly high-risk because it participates in a large multi-step transaction. Add a reconciliation command `reconcile_wallet_balance(customer_id)` that recomputes from the transaction log and alerts on any discrepancy.

### 3. Sync safety — `credit_payments`, `credit_sales` updates, and `customer_wallet_transactions` are all absent from `sync_queue`
As established in Backend Faults #6 and #7, the entire credit and wallet mutation surface is unsynced. The Supabase replica has accurate credit sale creation records (from `create_transaction` which does sync) but no payment records. The cloud view is: every credit sale is permanently open, every customer wallet is at its initial top-up balance. This is a catastrophic reporting gap for any multi-device or multi-store operation.

### 4. Multi-store isolation — `get_credit_sales` may return credit sales across stores if `store_id` is not enforced for global users
A global user (admin/super_admin) calling `get_credit_sales()` with `store_id: None` receives credit sales from all stores. If the frontend sends `store_id: null` without intending to request all-store data — e.g., due to a `useBranchStore.getState().activeStore` returning `null` during initialization — all stores' credit sales are exposed. Add a default to the current store if `store_id` is null and the user is non-global:
```rust
let effective_store_id = match (claims.is_global, payload.store_id) {
    (true, sid) => sid, // global users can pass None for all-store view
    (false, _) => Some(claims.store_id.ok_or(AppError::Forbidden)?),
};
```

### 5. Offline resilience — concurrent wallet top-up offline + POS wallet deduction online before sync creates a negative balance on sync
Scenario: Device A is offline and tops up a wallet (local `wallet_balance = ₦5,000`). Meanwhile Device B (online) processes a ₦4,500 wallet sale (`Supabase wallet_balance = ₦500`). When Device A syncs, its update (`wallet_balance = ₦5,000`) wins last-write via the sync mechanism, erasing the ₦4,500 deduction. The customer gets ₦4,500 of goods for free. The `sync_queue` row-level `last_write_wins` strategy is fundamentally unsafe for numeric balance fields. Wallet balance changes must be synced as signed deltas applied via `UPDATE customers SET wallet_balance = wallet_balance + $1` rather than absolute value overwrites.

### 6. Security — `top_up_wallet` is available to cashiers by default but should be restricted to manager-level roles
A cashier with `wallet.topup` permission can top up any customer's wallet with any amount, including their own family members' accounts. In many retail environments, wallet top-ups should be manager-only (or require manager approval for amounts above a threshold) to prevent cashiers from fraudulently crediting friendly accounts. Add `store_settings.require_manager_for_wallet_topup BOOLEAN DEFAULT TRUE` and enforce in `top_up_wallet`:
```rust
if settings.require_manager_for_wallet_topup && !claims.is_manager_or_above() {
    return Err(AppError::Forbidden);
}
```

### 7. Security — `adjust_wallet_balance` (manager manual adjustment) has no upper bound check — a manager can set any customer's wallet to an arbitrarily large value
There is no `max_wallet_adjustment` enforcement in `store_settings`. A compromised manager account (or a bug sending a very large amount) could set a customer's wallet to ₦10,000,000. Add:
```rust
let max_adjustment: Decimal = settings.max_single_wallet_adjustment.unwrap_or(Decimal::from(50_000));
if payload.amount.abs() > max_adjustment {
    return Err(AppError::Validation(format!(
        "Adjustment of {} exceeds the maximum single adjustment of {}. Contact admin.",
        payload.amount, max_adjustment
    )));
}
```

---

## PRIORITY ORDER

These are the top 5 items that MUST be addressed before this module is production-ready, ordered by severity:

1. **[BACKEND FAULT #3] `record_credit_payment` does not update `customers.outstanding_balance`** — Every payment a customer makes reduces the credit sale's outstanding but leaves the customer's total balance permanently inflated. The customer profile, the POS credit warning, and any receivables dashboard all continue to show the pre-payment balance forever. In a store that processes 50 credit payments per week, this corruption compounds daily. The outstanding_balance field — shown to cashiers at the point of every subsequent credit decision — is the single most important number in the credit module, and it is wrong after every payment.

2. **[BACKEND FAULT #5 + FAULT #12] Credit limit not enforced at time of sale, and wallet deduction not protected against race condition** — Two structurally identical failures: the creditworthiness check and the wallet sufficiency check both run outside `db_tx` on stale data. A customer can exceed their credit limit via concurrent sales, and a wallet can go negative via concurrent purchases. Both of these are financial integrity failures that directly cost the store money on every occurrence, cannot be detected after the fact without a manual audit, and worsen proportionally with transaction volume.

3. **[BACKEND FAULTS #6 + #7 + CROSS-CUTTING RISK #3] All credit and wallet mutations are absent from `sync_queue`** — The Supabase cloud replica shows every credit sale as permanently unpaid and every customer wallet at its initial balance. In a multi-store or multi-device deployment — the primary target architecture for Quantum POS — this means cloud reporting, customer balance lookups from any non-local device, and backup data are all permanently wrong. This is a silent, compounding data corruption issue that begins on the first day of production use.

4. **[CROSS-CUTTING RISK #5] Offline wallet delta sync conflict — last-write-wins on `wallet_balance` erases concurrent deductions** — An offline top-up followed by an online sync overwrites any wallet deductions that happened while the device was offline, effectively giving customers free goods. This is not a hypothetical: in a two-terminal store where one terminal occasionally goes offline, this scenario is certain to occur. The fix — syncing wallet balance as signed deltas rather than absolute values — requires changes to the sync architecture but is non-negotiable for any store using wallet payments on more than one device.

5. **[BACKEND FAULT #1 + FAULT #2] Race conditions in `record_credit_payment` and `top_up_wallet`** — Concurrent payment recording and concurrent wallet top-ups both read balances outside `db_tx` and can both commit, producing an over-paid credit sale (outstanding goes negative, `amount_paid` exceeds `amount`) and a wrong audit trail in `customer_wallet_transactions` (balance_before and balance_after are computed from a stale read). In a multi-cashier environment these are not edge cases — they are expected concurrent operations. Both fixes are identical: move the balance read inside `db_tx` with `FOR UPDATE`.
