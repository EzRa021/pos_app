# Quantum POS — Production Audit: Shift & Cash Management Module

**Audited:** 2026-04-25  
**Scope:** `src-tauri/src/commands/shifts.rs`, `src-tauri/src/commands/cash_movements.rs`, `src-tauri/src/models/shift.rs`, `src-tauri/src/models/cash_movement.rs`, `src/features/shifts/*`, `src/stores/shift.store.js`, `src/commands/shifts.js`, `src/commands/cash_movements.js`, migrations 0010–0086 (shift-related).

---

## BACKEND FAULTS (must fix before production)

### 1. Wrong shift number shown everywhere — client-side reconstruction uses row ID instead of sequential counter
**Where:** `src/features/shifts/ShiftHistoryTable.jsx` (`shiftNumber()` helper) and `src/features/shifts/CloseShiftModal.jsx` (`computeShiftNumber()` helper).  
**What:** Both functions reconstruct the shift number as `SH-YYYYMMDD-{id.padStart(3,'0')}` using the raw DB serial ID. The backend generates `SH-YYYYMMDD-NNN` using a per-day sequential counter via `generate_shift_number()` — the third segment is the count of shifts that day, not the row ID. On the first day of production, shift #3 of the day (ID=47 after 44 non-shift rows) would display as `SH-20260425-047` in the UI but be stored and synced as `SH-20260425-003`.  
**Fix:** Delete both helper functions. The backend already returns `shift_number` on every `Shift` struct. Use `row.shift_number` directly in both components.

### 2. Stale conflicting model in `cash_movement.rs` causes silent runtime mismatch
**Where:** `src-tauri/src/models/cash_movement.rs`  
**What:** Defines `CashMovement` with fields `reason: String` (NOT NULL), `reference: Option<String>`, and `created_by: i32`. After migrations 0030–0031, the `cash_movements` table has `reason` as nullable, `reference_number` (not `reference`), and `performed_by` (not `created_by`). The `cash_movement.rs` model also re-declares `ShiftSummary` (with `opening_balance`, `total_refunds`, `closing_balance`, `discrepancy`) and `CreateCashMovementDto` that conflict with the canonical versions in `shift.rs`. If any query ever uses the `cash_movement.rs` types against the real schema, sqlx will panic at startup or runtime on column mismatch.  
**Fix:** Delete `src-tauri/src/models/cash_movement.rs` entirely. Move `CashDrawerEvent` into `models/shift.rs`. Update `mod` declarations in `lib.rs` accordingly.

### 3. `CashMovementsList.jsx` reads `movement.reference` — field was renamed to `reference_number`
**Where:** `src/features/shifts/CashMovementsList.jsx` (line `{movement.reference && ...}`) and `src/features/shifts/ShiftDetailPage.jsx` (the `MovementRow` component, same field reference).  
**What:** After migration 0030, the column `reference` on `cash_movements` was renamed to `reference_number`. The Rust model in `shift.rs` serializes it as `reference_number`. The two components still read `movement.reference`, which is always `undefined`, so reference numbers never display in the UI.  
**Fix:** Change `movement.reference` → `movement.reference_number` in both `CashMovementsList.jsx` and `ShiftDetailPage.jsx`'s `MovementRow`.

### 4. `keepPreviousData` is TanStack Query v4 API — silently broken in v5
**Where:** `src/features/shifts/ShiftHistoryTable.jsx` and `src/features/shifts/useShifts.js`.  
**What:** Both use `keepPreviousData: true` in `useQuery`. In TanStack Query v5 (which this project uses per CLAUDE.md), this option was removed. The replacement is `placeholderData: (prev) => prev` (or import `keepPreviousData` from `@tanstack/react-query` and use `placeholderData: keepPreviousData`). Without this, the table flashes empty on every page change because previous data is immediately discarded.  
**Fix:**
```js
import { keepPreviousData } from "@tanstack/react-query";
// ...
placeholderData: keepPreviousData,  // replaces keepPreviousData: true
```
Apply in both files.

### 5. `close_shift_inner` is not wrapped in a database transaction
**Where:** `src-tauri/src/commands/shifts.rs`, `close_shift_inner()`  
**What:** The function runs `UPDATE shifts SET status='closed'...` followed by an `INSERT INTO cash_drawer_events`. These are two separate DB round-trips with no `BEGIN/COMMIT`. If the connection drops after the `UPDATE` but before the `INSERT`, the shift is permanently closed with no drawer event recorded. More critically, the `fetch_shift` call at the end to return the updated row is also outside any transaction — a partial failure here leaves the caller with an error response while the DB has already committed the `UPDATE`.  
**Fix:** Wrap the entire function body (from `UPDATE shifts` through `fetch_shift`) in `let mut tx = pool.begin().await?; ... tx.commit().await?;` and run all queries against `&mut *tx`.

### 6. `reconcile_shift_inner` allows reconciling an open/active shift
**Where:** `src-tauri/src/commands/shifts.rs`, `reconcile_shift_inner()`  
**What:** The function runs the `UPDATE shifts SET reconciled=true` with no precondition check on `status`. A shift with `status = 'open'` or `'active'` can be marked as reconciled with an arbitrary `discrepancy_notes` before the shift even closes, corrupting the audit trail.  
**Fix:** Add before the UPDATE:
```rust
let shift = fetch_shift(&pool, id).await?;
if shift.status != "closed" {
    return Err(AppError::Validation("Only closed shifts can be reconciled".into()));
}
```

### 7. `cancel_shift_inner` blocks admins from cancelling another cashier's abandoned shift
**Where:** `src-tauri/src/commands/shifts.rs`, `cancel_shift_inner()`  
**What:** The check `if shift.opened_by != claims.user_id` prevents even a `super_admin` from cancelling a shift opened by a different user. If a cashier opens a shift, leaves without closing it, and another admin needs to clean it up, there is no API path to do so.  
**Fix:** Remove the `opened_by` restriction for global users. Keep it only for non-global users:
```rust
if !claims.is_global && shift.opened_by != claims.user_id {
    return Err(AppError::Forbidden);
}
```

### 8. Race condition in shift-number and movement-number generation
**Where:** `generate_shift_number()` and `generate_movement_number()` in `shifts.rs`  
**What:** Both functions do a `SELECT ... LIKE ... ORDER BY id DESC LIMIT 1` then compute `next_num + 1`, then INSERT. Two concurrent open-shift calls arriving within the same millisecond will both read the same `last` row, generate the same number, and both attempt to INSERT. Migration 0030 adds a unique index on `shift_number`, so the second INSERT will fail — but it surfaces as a raw constraint violation (pgcode 23505), not a friendly `AppError::Conflict`. The same applies to `movement_number`.  
**Fix:** Use `SELECT pg_advisory_xact_lock(hashtext('shift_number_gen'))` inside a transaction to serialize number generation, or use a PostgreSQL sequence per day:
```sql
-- In a migration: use a sequence reset by the app daily, or
-- advisory lock pattern wrapping the SELECT→INSERT in a transaction
```
Minimally: catch the unique-violation error in the Rust layer and return `AppError::Conflict("Shift number collision — please retry")`.

### 9. `log_drawer_event` uses legacy `created_by` column; shift operations use `user_id`
**Where:** `src-tauri/src/commands/cash_movements.rs`, `log_drawer_event()`  
**What:** This command INSERTs into `cash_drawer_events` using the `created_by` column. All shift lifecycle events in `shifts.rs` (open, close, suspend, resume, reconcile) INSERT using the `user_id` column (added in migration 0030). The table has both columns, but they are not the same value for rows inserted before/after migration 0030. Any analytics or audit query joining `cash_drawer_events.user_id` will miss all events inserted via `log_drawer_event`, and vice versa for `created_by` queries.  
**Fix:** Update `log_drawer_event` to insert into `user_id` instead of `created_by`. Also update the `CashDrawerEvent` model's SELECT to use `user_id` (or keep `created_by` as-is and add a `COALESCE(user_id, created_by)` bridge in the SELECT).

### 10. `get_shift_detail_stats_inner` does not scope item analytics by cashier
**Where:** `src-tauri/src/commands/shifts.rs`, `get_shift_detail_stats_inner()` — and mirrored in `ShiftDetailPage.jsx` via `getItemAnalytics(shift.store_id, itemAnalyticsFilters)`  
**What:** The `getItemAnalytics` call in `ShiftDetailPage` passes `store_id` and a date range but no `cashier_id`. The analytics backend therefore returns top items for ALL cashiers in the store during that window, not just the shift's cashier. A busy store with 5 cashiers will show one cashier's "Top Items Sold" as if it were the whole store's top items.  
**Fix:** Pass `cashier_id: shift.opened_by` (or `opened_by`) in the `itemAnalyticsFilters` object, and ensure the analytics backend JOIN respects it.

### 11. Missing database index on `shifts.opened_at` for date-range queries
**Where:** Migrations, `get_shifts_inner()` in `shifts.rs`  
**What:** The `get_shifts` query filters on `s.opened_at >= $5::timestamptz AND s.opened_at <= $6::timestamptz` but no index exists on `shifts.opened_at`. Only indexes on `status`, `store_id`, `cashier_id`, and `opened_by` exist (from migrations 0010 and 0030). For stores with hundreds of closed shifts, the date filter will result in a sequential scan after the status/store index is used.  
**Fix:** Add in a new migration:
```sql
CREATE INDEX IF NOT EXISTS idx_shifts_opened_at ON shifts(opened_at DESC);
```

### 12. Shift number generation uses UTC date, not local store timezone (WAT = UTC+1)
**Where:** `generate_shift_number()` and `generate_movement_number()` in `shifts.rs`  
**What:** `Utc::now().format("%Y%m%d")` uses UTC. In Nigeria (WAT, UTC+1), a shift opened at 11:30 PM local time on April 25 generates a shift number dated April 25, but one opened at 11:05 PM on April 25 (= 00:05 April 26 UTC) generates a shift number dated April 26. Shift numbers will be visually wrong for late-night openings and the counter sequence will break across UTC midnight.  
**Fix:** Either use the store's timezone offset from the `stores` table (`timezone` column if it exists, otherwise default to `Africa/Lagos` = UTC+1), or accept the UTC behavior and document it explicitly.

---

## BACKEND UPGRADES (should improve)

### 1. `open_shift_inner` check→insert is not atomic (TOCTOU, partially mitigated)
Migration 0070 adds a partial unique index, which is a good mitigation. However the `SELECT id FROM shifts WHERE opened_by=$1 ... LIMIT 1` + `INSERT` still happens in two queries. Wrap the whole open_shift operation in a transaction so the unique-constraint failure is the single source of truth and the SELECT check can be removed.

### 2. `get_cash_movements_inner` returns unbounded results
There is no `LIMIT` on the `SELECT FROM cash_movements WHERE shift_id = $1` query. A heavily-used shift (many petty-cash payouts) returns every row. Add `LIMIT 500` or expose pagination parameters.

### 3. `get_shift_detail_stats` runs two separate queries (aggregate + top item)
Collapse into one CTE for performance:
```sql
WITH agg AS (SELECT ... FROM transactions t LEFT JOIN transaction_items ti ...),
     top AS (SELECT ti.item_name, SUM(ti.quantity) FROM ... GROUP BY ... ORDER BY ... LIMIT 1)
SELECT agg.*, top.item_name, top.total_qty FROM agg CROSS JOIN LATERAL (SELECT ...) top
```

### 4. Expected-cash formula is duplicated and can diverge
`close_shift_inner` computes `expected` from the `shifts` row totals (`total_cash_sales + total_cash_in - total_cash_out - total_returns`). `get_shift_summary_inner` computes `expected_balance` by re-aggregating `cash_movements`. These two will diverge if `shifts.total_cash_in/total_cash_out` get out of sync with the `cash_movements` table (e.g., failed movement UPDATE, manual DB edit). Use one authoritative calculation everywhere — preferably the `cash_movements` aggregate (more granular and trustworthy).

### 5. Generic error messages on shift status conflicts
`AppError::Validation("Shift is already closed")` gives the cashier no recovery path. Include the shift number, current status, and what action to take:
```rust
AppError::Validation(format!("Shift {} is already {}. No further changes are allowed.", shift.shift_number, shift.status))
```

### 6. `cancel_shift` and `reconcile_shift` are marked `#[allow(dead_code)]` / registered conditionally
Both commands are decorated with `#[allow(dead_code)]` which suggests they may not be registered in the Tauri `invoke_handler`. Verify these commands appear in `lib.rs`'s `invoke_handler!(...)` macro list. If they are only exposed via HTTP RPC, document this clearly so frontend developers don't call `invoke()` directly.

### 7. `ShiftFilters.date_from` and `date_to` are `Option<String>` cast at query time
The filter strings are cast inline with `$5::timestamptz`. An invalid date string from the frontend will produce a PostgreSQL cast error surfaced as a generic DB error. Add validation in Rust before the query:
```rust
if let Some(ref df) = filters.date_from {
    df.parse::<chrono::DateTime<Utc>>().map_err(|_| AppError::Validation("Invalid date_from".into()))?;
}
```

### 8. `get_shifts_inner` duplicates the WHERE clause verbatim in two queries (count + data)
Any future change to the filter logic must be applied in two places. Extract the filter conditions into a helper or use a CTE:
```sql
WITH filtered AS (SELECT s.* FROM shifts s JOIN users u ... WHERE <conditions>)
SELECT COUNT(*) FROM filtered;
SELECT * FROM filtered ORDER BY opened_at DESC LIMIT $8 OFFSET $9;
```

### 9. `SuspendShiftDto.reason` is not validated for length
`payload.reason.as_deref()` is inserted directly into the `cash_drawer_events.notes` column (TEXT). A frontend bug or attack passing a multi-megabyte string would bloat the DB. Add a 500-character max validation.

### 10. Missing index on `cash_movements.performed_by`
The column is used in JOIN/WHERE operations but has no index (only `shift_id` and `created_at` are indexed from migration 0017). Add:
```sql
CREATE INDEX IF NOT EXISTS idx_cash_mv_performed_by ON cash_movements(performed_by);
```

---

## BACKEND FEATURES (add for completeness)

### 1. No force-close API for stuck open shifts (manager override)
If a cashier's session crashes mid-shift or they walk away, there is no `force_close_shift` command for managers to close another user's shift with an estimated actual_cash. The `cancel_shift` command requires the opener to be the caller (Bug #7 above), and `close_shift` is scoped to the opener only. Add a `force_close_shift` command gated on `shifts.manage` permission that allows a manager to close any shift in their store.

### 2. No shift transfer / handover capability
There is no API to transfer an active shift from one cashier to another (e.g., mid-day break coverage). The shift model has no `transferred_from` or handover record.

### 3. EOD-to-shift linkage is missing
The `eod_reports` table (referenced by `useEod.js`) has no foreign-key relationship to the `shifts` that contributed to it. An EOD report cannot drill down to individual shifts, and a shift cannot be marked as "included in EOD report". Add `eod_report_id` on the `shifts` table (nullable FK).

### 4. No `shifts.updated_at` is indexed, preventing efficient sync cursor queries
The bidirectional sync system uses cursor-based pull, but `shifts.updated_at` has no index. Cloud-pull queries filtering `updated_at > cursor` will table-scan:
```sql
CREATE INDEX IF NOT EXISTS idx_shifts_updated_at ON shifts(updated_at);
```

### 5. No cash movement void/correction capability
Once a cash movement is recorded (deposit, withdrawal, payout), there is no API to void or correct it. A cashier who records a deposit of ₦50,000 instead of ₦5,000 has no way to reverse it. Add a `void_cash_movement` command that inserts a counter-movement and marks the original as voided.

### 6. No shift analytics aggregation query
There is no backend command that returns aggregate statistics across multiple shifts (e.g., average shift sales, total shift duration by cashier, variance trend over 30 days). These would power a dashboard-style "Shift Performance" view. Add a `get_shift_analytics` command returning period totals, averages, and variance stats.

### 7. Missing audit log entries for `suspend_shift` and `resume_shift`
Both `suspend_shift_inner` and `resume_shift_inner` log to `cash_drawer_events` but do not call `write_audit_log`. Every lifecycle mutation (open, close, cancel, reconcile) writes to the audit log except suspend/resume. Add `write_audit_log` calls to both.

### 8. No background job to auto-close shifts left open overnight
A shift opened at 9 AM and left open overnight corrupts the next day's totals (transactions from day 2 are attributed to day 1's shift). Add a scheduled Tauri command (`auto_close_stale_shifts`) that runs at configurable hour (e.g., 4 AM) and force-closes any shifts open longer than `X` hours with `actual_cash = expected_cash` and `closing_notes = "Auto-closed by system"`.

### 9. No partial payment breakdown in `ShiftSummary`
`ShiftSummary` returns aggregate totals but no per-payment-method breakdown for the close-shift modal. The cashier sees "Total Sales: ₦50,000" but not "Cash: ₦20,000 / Card: ₦30,000". Add payment-method columns to `ShiftSummary`.

---

## FRONTEND FAULTS (must fix before production)

### 1. Shift number computed from row ID instead of `shift_number` field
**Where:** `ShiftHistoryTable.jsx` (`shiftNumber(row)` function) and `CloseShiftModal.jsx` (`computeShiftNumber(shift)` function).  
**Fix:** Replace both functions with `row.shift_number` and `activeShift.shift_number` respectively. The field is always present on the backend response.

### 2. Cash movement reference number never renders
**Where:** `CashMovementsList.jsx` line `{movement.reference && ...}` and `ShiftDetailPage.jsx`'s `MovementRow` component.  
**Fix:** Change to `movement.reference_number`.

### 3. `keepPreviousData: true` is a TanStack Query v4 option — silently no-ops in v5
**Where:** `ShiftHistoryTable.jsx` and `useShifts.js`.  
**Fix:** Replace with `placeholderData: keepPreviousData` (imported from `@tanstack/react-query`).

### 4. `ShiftDetailPage` doesn't invalidate `["shift", shiftId]` after cash movements
**Where:** `CashMovementModal.jsx` `onSuccess` handler.  
**What:** After a cash movement is recorded, the modal invalidates `["cash-movements", shiftId]` and `["shift-summary", shiftId]` but NOT `["shift", shiftId]`. The `ShiftDetailPage`'s `CashReconciliation` component reads `shift.total_cash_in` and `shift.total_cash_out` directly from the cached shift row, which becomes stale. The ledger continues to show the pre-movement values until the user navigates away and back.  
**Fix:** Add `queryClient.invalidateQueries({ queryKey: ["shift", shiftId] })` to the `CashMovementModal`'s `onSuccess`.

### 5. `CloseShiftModal` can be submitted with denomination mode enabled and ₦0 counted
**Where:** `CloseShiftModal.jsx`  
**What:** `hasClosing = showDenom ? true : ...` is always `true` when denomination mode is toggled on, even if every denomination input is 0 (denomTotal = 0). The "Close Shift" button becomes enabled and the cashier can submit with ₦0 actual cash.  
**Fix:** Change:
```js
const hasClosing = showDenom
  ? denomTotal > 0
  : (manualOverride !== null && manualOverride !== "");
```
Or add a warning/confirmation when `closingNum === 0`.

### 6. `ShiftDetailPage` fetches up to 200 transactions client-side — incomplete for busy shifts
**Where:** `ShiftDetailPage.jsx`, `txFilters` object has `limit: 200`.  
**What:** A shift with more than 200 transactions (a busy weekend day) will show incomplete data in the Transactions table and produce wrong totals in the footer's "X completed" count and the `customerBreakdown` derivation.  
**Fix:** Either implement server-side pagination for the transaction list, or change the limit to something that covers realistic maximum shifts (e.g., 1000), or show a "Showing first 200 of N transactions" notice.

### 7. `OpenShiftModal` mutation has no `onError` toast notification
**Where:** `OpenShiftModal.jsx`  
**What:** The mutation renders the error inline (`{mutation.error && <p>...}`) but shows no toast. In contrast, `CashMovementModal` calls `onMutationError()` for toast feedback. If the modal is closed while the error is still shown, the cashier might not notice the failure.  
**Fix:** Add `onError: (e) => toast.error(typeof e === "string" ? e : "Failed to open shift.")` to the mutation options.

### 8. `getItemAnalytics` in `ShiftDetailPage` is not scoped to the shift's cashier
**Where:** `ShiftDetailPage.jsx`, `itemAnalyticsFilters` memo.  
**What:** The analytics query uses `store_id` + date range but no `cashier_id`. All cashiers' sales are included in the "Top Items Sold" table, making the data misleading on a shift-detail page.  
**Fix:** Add `cashier_id: shift.opened_by` to `itemAnalyticsFilters` and ensure the analytics backend respects it.

### 9. `CashMovementModal` missing `reference_number` field
**Where:** `CashMovementModal.jsx`  
**What:** The backend accepts `reference_number` in `CreateCashMovementDto` (for bank drop references, supplier invoice numbers, etc.) but the modal has no input for it. The field is always sent as `undefined`.  
**Fix:** Add an optional "Reference #" input below the "Reason" field.

### 10. Shift store error state is never cleared on successful subsequent operations
**Where:** `src/stores/shift.store.js`  
**What:** `error` is set on `openShift` or `closeShift` failures and cleared via `clearError()`. However, no component calls `clearError()` automatically before showing the next modal. If a shift fails to open (e.g., conflict error), the error lingers in the store. The next time `OpenShiftModal` opens, `mutation.error` from React Query is shown, but the store's error is also still set, potentially causing double-error display if any component reads `useShiftStore(s => s.error)`.  
**Fix:** Call `useShiftStore.getState().clearError()` at the top of `openShift` and `closeShift` store actions (already done for `error: null` in `set({ isLoading: true, error: null })`). Ensure any component that reads `useShiftStore(s => s.error)` (check `AppShell` or sidebar) clears it on dismiss.

---

## FRONTEND UPGRADES (should improve)

### 1. `ShiftHistoryTable` is missing date-range filter controls
The table has a text search and status tabs but no date picker for filtering by shift date. A store owner reviewing last week's shifts must scroll through the paginated list. Add "From" / "To" date inputs that map to the `date_from` / `date_to` filter params.

### 2. No cashier filter for global users on `ShiftHistoryTable`
Global users (managers/admins) see shifts from all cashiers but cannot filter by cashier. Add a cashier dropdown that passes `cashier_id` to the filter. The backend already supports this field in `ShiftFilters`.

### 3. No inline reconcile action on `ShiftHistoryTable`
Closed, unreconciled shifts need a one-click "Reconcile" row action. Currently a user must navigate into the shift detail page to trigger reconciliation. Add a row-level action menu (three-dot) with "View", "Reconcile" (for closed+unreconciled), and "Cancel" (for global users on active shifts).

### 4. `ShiftSummaryCards` shows no transaction count KPI
The active-shift summary cards show Total Sales, Refunds, Expected Cash, and Duration — but not the transaction count. The `activeShift` object includes `transaction_count` from the Shift model. Add it as a fifth card or replace "Duration" with "Transactions" with duration moved to a sub-value.

### 5. `ShiftDetailPage` has no "Print / Export" button
There is no way to print a shift summary or export it as PDF/CSV. A shift-end report is a standard POS document that managers require for reconciliation sign-off. Add a "Print Report" button that triggers a `window.print()` CSS print layout.

### 6. `CloseShiftModal` denomination grid: no "Clear All" button
Once denomination counts are entered, there is no way to clear them all without deleting each input individually. Add a "Clear" link next to the "Count by denomination" toggle.

### 7. No real-time polling on the active shift row itself
`CashMovementsList` polls every 30 seconds. `ShiftSummaryCards` does not poll — it reads static query data. If another tab or terminal records a sale or cash movement against the same shift, `ShiftSummaryCards` will show stale totals indefinitely. Add `refetchInterval: 30_000` to the `["shift-summary", activeShift?.id]` query in the shift panel component.

### 8. `ShiftDetailPage` "Transactions" section has no link to the full transactions page filtered by shift
The inline transaction table is capped at 200. There is no "View all in Transactions page" link that would navigate to `/transactions?shift_id=...&cashier_id=...`. Add such a link in the section header.

### 9. Missing empty state on `ShiftSummaryCards` when `summary` is null and not loading
If `getShiftSummary` fails silently (network error, `staleTime` expired), `summary` is `null` and all KPI cards show `₦0.00`. There is no error indicator or retry button on the cards. Add a subtle "Could not load summary" badge with a retry action.

### 10. `CashMovementsList` in active shift panel refetches every 30s regardless of shift status
`refetchInterval: 30_000` in `CashMovementsList.jsx` runs even if the shift is closed. Add `refetchInterval: shift?.status !== "closed" ? 30_000 : false` (thread the `shift` object in or read from the store).

---

## FRONTEND FEATURES (add for completeness)

### 1. Missing "Shift Performance" dashboard for global users
Global users have no overview screen showing all active shifts in a store simultaneously (total sales, cashier names, duration, cash counts). The `useStoreActiveShifts` hook already provides the data. Build a "Live Shifts" panel showing all active cashiers' shifts as cards with real-time sales totals.

### 2. No CSV export for shift history
Managers need to export shift history for accounting. Add a "Export CSV" button on `ShiftHistoryTable` that calls `getShifts` with `limit: 1000` (or a dedicated export endpoint) and triggers a CSV download via `FileSaver` or a Blob URL.

### 3. No print receipt / shift-end report
At shift close, the cashier should be able to print a shift-end slip (shift number, cashier name, opening float, total sales, expected cash, actual cash, variance, top 3 items). No print functionality exists.

### 4. No bulk reconcile action
Managers reconciling multiple closed shifts must visit each shift detail page individually. Add a multi-select checkbox column to `ShiftHistoryTable` with a "Reconcile Selected" bulk action.

### 5. Missing shift-comparison view
There is no way to compare two shifts side-by-side (e.g., this week's Monday vs last week's Monday). This is a common reporting need for store managers. Add a "Compare" feature accessible from the shift history table.

### 6. No denomination count helper on `OpenShiftModal`
The `CloseShiftModal` has a denomination counter for counting the closing cash but `OpenShiftModal` asks for a plain number. Add the same denomination grid to opening float entry (optional, collapsible) for accuracy.

### 7. No filter by reconciliation status on `ShiftHistoryTable`
Managers need to find unreconciled closed shifts quickly. The current STATUS_TABS only have "All", "In Progress", "Closed". Add a fourth tab "Unreconciled" that maps to `{ status: "closed", reconciled: false }`.

---

## CROSS-CUTTING RISKS

### 1. Multi-store isolation — `get_active_shift_inner` scopes correctly, but `get_shift_inner` does not check store_id
`get_shift_inner` checks `shift.opened_by != claims.user_id && !claims.is_global`. A non-global cashier from Store A could request `GET /shift/999` where shift 999 belongs to Store B, and would be rejected (opened_by mismatch). But a global admin could request any shift from any store with no store-boundary check. While global admins are trusted, this is still a risk for misconfigured roles. Add an optional `store_id` assertion for non-super-admin global roles.

### 2. Security — `suspend_shift` and `resume_shift` have no permission guard beyond ownership
Both commands only check `shift.opened_by != claims.user_id && !claims.is_global`. There is no `shifts.manage` permission check. A cashier (`is_global = false`) can suspend and resume their own shift, which is correct. But there is no way for a manager to suspend a misbehaving cashier's shift (because they're not `is_global`). Consider adding a `shifts.manage` fallback: `if shift.opened_by != claims.user_id && !claims.is_global && !has_permission("shifts.manage")`.

### 3. Security — `add_cash_movement_inner` validates `movement_type` at the application layer only
The allowed values are `["deposit", "withdrawal", "payout"]`. There is no `CHECK` constraint on the `cash_movements.movement_type` column in the schema. If a value bypasses the Rust validation (via direct DB access, migration error, or future code path), invalid types will silently persist.  
**Fix:**
```sql
ALTER TABLE cash_movements ADD CONSTRAINT chk_movement_type
  CHECK (movement_type IN ('deposit', 'withdrawal', 'payout', 'adjustment'));
```

### 4. Data consistency — `shifts.total_cash_in` / `total_cash_out` can drift from `cash_movements` aggregates
The `add_cash_movement_inner` function updates `shifts.total_cash_in` / `total_cash_out` within a transaction alongside the cash_movements INSERT — this is correct. However, if a cash movement row is ever deleted directly from the DB (data repair, migration error), the shift totals will be higher than the sum of the movement rows. The `close_shift` calculation uses the shift-row totals, not re-aggregating from `cash_movements`. An alternative design is to always compute expected cash from `cash_movements` at close time (as `get_shift_summary` does), discarding the denormalized totals. Consider adding a DB trigger that recomputes `total_cash_in/out` on `cash_movements` DELETE/UPDATE.

### 5. Offline resilience — Shift state is cleared immediately on `initForStore` before the new fetch completes
In `shift.store.js`:
```js
set({ activeShift: null, isLoading: true, isInitialized: false, error: null });
```
This clears `activeShift` synchronously before the `get_active_shift` RPC returns. If the app is used on a slow connection (or the Rust backend is starting), any component that reads `useShiftStore(s => s.activeShift)` briefly receives `null`. Components gating POS access on `isShiftOpen()` will flash "no active shift" during this window, potentially interrupting a cashier mid-sale. The `isLoading: true` flag should gate these UI transitions, but not all consumers check `isLoading`.

### 6. Offline resilience — No queue for cash movements recorded while DB is temporarily unavailable
If the Rust backend's PostgreSQL connection drops (network blip, pg restart) and a cashier records a cash movement, the RPC will fail and the movement is lost. There is no client-side queue (unlike the sync_queue table used for cloud sync). Implement a local optimistic queue that replays on reconnect for critical financial operations.

### 7. Data consistency — `transaction_count` and `total_sales` on shifts are updated by the sales flow, not the shift module
The shift module does not own these columns — they are incremented by the transaction commands (`complete_sale`, etc.). If the transaction command fails after updating `shifts.transaction_count` but before committing the transaction row, the shift count will be wrong. Verify that every `UPDATE shifts SET transaction_count = transaction_count + 1` in the sales path is inside the same DB transaction as the INSERT into `transactions`.

---

## PRIORITY ORDER

These are the top 5 items that MUST be addressed before this module is production-ready, ordered by severity:

1. **[BACKEND FAULT #1 / FRONTEND FAULT #1] Wrong shift number displayed everywhere** — The client-side reconstruction using `row.id` produces shift numbers that don't match what the backend stored, printed, or synced to the cloud. This is a customer-facing data integrity failure visible on every shift row and every close-shift modal. Fix is trivial (use `row.shift_number`), impact is high.

2. **[BACKEND FAULT #2] Stale `cash_movement.rs` model** — The conflicting struct definitions will cause sqlx to fail compilation or panic at runtime if the wrong type is imported. This is a silent bomb that could surface after a Rust refactor. Delete the file and consolidate into `shift.rs`.

3. **[BACKEND FAULT #5 + FRONTEND FAULT #3] Close shift is not transactional + `keepPreviousData` v5 breakage** — A non-transactional close leaves the DB in a partial state on failure (shift marked closed, drawer event not logged, caller gets an error and retries, attempting to double-close). The `keepPreviousData` breakage makes the shift history table flash empty on every page change, degrading cashier experience. Both must be fixed.

4. **[FRONTEND FAULT #4] Cash reconciliation shows stale data after movements** — `ShiftDetailPage` does not invalidate `["shift", shiftId]` after a cash movement, so the "Cash Reconciliation" ledger shows wrong totals until the user navigates away. This is a correctness issue in a financial UI — a cashier could believe their drawer balance is wrong when it is actually correct, or vice versa.

5. **[BACKEND FAULT #7] Admin cannot cancel another cashier's abandoned shift** — If a cashier's terminal crashes mid-shift, there is no recovery path. No API allows a super_admin to cancel or force-close a shift they didn't open. This will happen in production and requires a store owner to directly UPDATE the DB to resolve.
