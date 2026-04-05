# Quantum POS — Product & QA Audit Report

> **Reviewer role**: Senior product reviewer, QA engineer, and UI/UX critic with POS experience (Square, Toast, Lightspeed, Shopify POS, Loyverse).
> **Date**: 2026-03-28
> **Scope**: Full codebase — every route, component, Zustand store, Tauri command, React page, and migration.
> **Last updated**: 2026-03-29 — P0-P2 all resolved; P3-4 dark/light theme (per-branch DB column, Settings → Appearance, instant apply); P3-7 denomination count; P3-10 sessionStorage token

---

## Table of Contents

1. [Dead / Broken Features](#1-dead--broken-features)
2. [Disconnected UI → Backend Integrations](#2-disconnected-ui--backend-integrations)
3. [Missing Real POS Workflows](#3-missing-real-pos-workflows)
4. [UI/UX Breakdown](#4-uiux-breakdown)
5. [Data Integrity & State Management Issues](#5-data-integrity--state-management-issues)
6. [Priority Action Plan (P0–P3)](#6-priority-action-plan-p0p3)

---

## 1. Dead / Broken Features

### 1.1 The Entire POS Screen Is Non-Functional

`PosPage.jsx` renders a full two-column layout with left panel (product search + cart) and right panel (customer + payment), but **none of the business logic is wired up**. The screen renders a static shell.

- `ItemSearchPanel` — not implemented; placeholder or empty
- `CartPanel` / `CartItem` — not implemented
- `PaymentModal` — not implemented; no payment method selection, no change calculation
- `ReceiptModal` — not implemented; no receipt preview or print
- `HoldDrawer` — not implemented
- `CustomerSearchBar` — not implemented

**The core revenue screen of a POS system generates zero revenue.** Every sale must be rung manually elsewhere or is impossible.

### 1.2 Analytics Pages Crash on Chart Heights

`ProductsAnalyticsPage.jsx`, `ProfitabilityPage.jsx`, and `CashiersAnalyticsPage.jsx` compute chart heights using dynamic template literals:

```jsx
style={{ height: `${chartHeight}px` }}  // or: className={`h-[${chartHeight}px]`}
```

Tailwind JIT processes class names at build time from static strings. Any class containing a runtime interpolation (`h-[${n}px]`) is never written to the CSS bundle — the chart container renders with **zero height**. The Recharts chart is mounted but invisible.

### 1.3 EOD (End of Day) Report Is Partially Broken

`EodPage.jsx` / `useEod.js` calls `get_eod_summary` with a date range, then renders KPI cards and a shift list. However:

- The "Generate PDF" / "Export" button calls a function not connected to any backend command (`generate_eod_report` does not exist in `http_server.rs` dispatch or `lib.rs`)
- The shift close confirmation within EOD triggers `close_shift` but does not check for an active shift first — crashes if no shift is open
- The "Reconcile" flow calls `reconcile_shift` which is registered in `http_server.rs` but **not in `lib.rs` `generate_handler![]`** — unreachable via Tauri invoke path

### 1.4 Stock Transfer Detail Page — No Backend Integration

`StockTransferDetailPage.jsx` fetches a transfer by ID and renders status/items, but:

- The "Approve Transfer" and "Complete Transfer" buttons call `approve_stock_transfer` and `complete_stock_transfer` — neither is dispatched in `http_server.rs`
- The page has no loading state guard; if the transfer ID is invalid it renders a blank card with no error

### 1.5 Notifications Page — Read-Only Shell

`NotificationsPage.jsx` fetches and lists notifications. The "Mark all read" button is wired. However:

- Individual notification actions (e.g. "View linked record", "Dismiss") navigate to hardcoded paths without checking whether the linked entity still exists
- `reorder_alerts` are shown but the "Resolve" button calls `resolve_reorder_alert` — the backend method is `acknowledge_reorder_alert` (name mismatch — see §2)

### 1.6 Wallet Page Has No Data Source

`WalletPage.jsx` renders a loyalty wallet UI with balance, transaction history, and a top-up form. The underlying command `get_customer_wallet` is dispatched via HTTP but:

- The page does not accept a `customerId` param from the route — it tries to read from `useAuthStore` as if the logged-in user is always the customer
- The top-up calls `credit_wallet` which is **not registered** in `http_server.rs` dispatch
- A cashier using this page would see their own "loyalty" wallet, not a customer's

### 1.7 Price Scheduling Is Silently Absent

`PriceManagementPage.jsx` has a "Schedule" tab that renders a `PriceSchedulePanel`. The backend module `price_scheduling.rs` exists with `schedule_price_change`, `get_scheduled_changes`, `cancel_scheduled_price_change` — none of these appear in `http_server.rs` dispatch or `lib.rs`.

### 1.8 Backup / Restore UI Is Missing

`backup.rs` in the backend implements `create_backup`, `list_backups`, `restore_backup`, `delete_backup`. There is no frontend page, no route, and no sidebar link for any of these. The feature is 100% dead from the user's perspective.

### 1.9 Loyalty Points Features Are Unreachable

`loyalty.rs` implements a full loyalty points system (earn, redeem, get balance, adjust, expire). `expire_old_points` is in `lib.rs` but not in `http_server.rs`. The frontend has no loyalty screen, no hook, and no command wrapper. The POS payment modal (when built) does not include a "redeem points" flow.

### 1.10 Suspended / Resumed Shifts Not Surfaced

`suspend_shift` and `resume_shift` exist in `http_server.rs` dispatch and `shifts.rs` backend, but are **not in `lib.rs` `generate_handler![]`**. `ShiftsPage.jsx` renders no Suspend/Resume button — the feature is invisible.

### 1.11 Setup Wizard Source Files Deleted But Feature Still Active

The git status shows `src/screens/setup/ClientSetup.jsx`, `ModeSelector.jsx`, `ServerSetup.jsx`, `SetupWizard.jsx` as **deleted**. These files are still imported (directly or indirectly) from `App.jsx` via the `src/features/setup/` feature directory. If the new `src/features/setup/` directory is incomplete, the app will fail to mount on first run (no `qpos_config` in localStorage).

---

## 2. Disconnected UI → Backend Integrations

### 2.1 Method Name Mismatches (Silent 404s at Runtime)

These frontend calls will silently fail — the `rpc()` wrapper sends the wrong method name, the HTTP dispatcher has no matching arm, and the frontend receives an error response it may or may not surface to the user.

| Frontend calls | Backend expects | Location |
|---|---|---|
| `get_sales_by_period` | `get_revenue_by_period` | `SalesAnalyticsPage.jsx` → `analytics.js` |
| `resolve_reorder_alert` | `acknowledge_reorder_alert` | `NotificationsPage.jsx` |
| `get_all_supplier_payables` | No dispatch arm exists | `SupplierPaymentsPage.jsx` |
| `bulk_print_labels` | `print_price_tags` | `PriceManagementPage.jsx` |
| `bulk_item_import` | Not in bulk_operations dispatch | `ItemFormDialog.jsx` (import flow) |

### 2.2 Commands in `http_server.rs` But Not in `lib.rs`

These methods can be called over HTTP (from a remote client) but **cannot be invoked** via Tauri's `invoke()` from the same-machine frontend:

- `suspend_shift`, `resume_shift`, `get_store_active_shifts`, `reconcile_shift`
- `search_transactions`, `search_purchase_orders`, `search_transfers`, `search_returns`

The search commands in particular are expected by analytics and list pages that implement a search bar — those searches will fail silently for server-mode (local) users.

### 2.3 Cache Invalidation Gaps

`src/lib/invalidations.js` is missing invalidation functions for several domains. After a successful mutation in these areas, React Query's stale cache is never cleared — the UI shows outdated data until manual refresh:

| Domain | Missing invalidation |
|---|---|
| Stock transfers | No `invalidateAfterStockTransfer()` |
| Expenses | No `invalidateAfterExpense()` |
| Price changes | No `invalidateAfterPriceChange()` |
| Reorder alerts | No invalidation after acknowledge |
| Loyalty transactions | No invalidation |
| Customer wallet | No invalidation |

### 2.4 `AnalyticsDashboardPage` Calls Non-Existent Composite Endpoint

`AnalyticsDashboardPage.jsx` calls `get_dashboard_summary` and `get_top_categories`. The former is dispatched in `http_server.rs`. However:

- `get_top_categories` is called with a `store_id` param — the backend requires `store_id` as mandatory, but the frontend passes it only when `activeStore` is set. For global users with no active store selected yet, this call fires with `undefined` → backend returns a 400 validation error
- The dashboard renders empty KPI cards instead of showing a loading or error state

### 2.5 Inventory Analytics Calls `get_inventory_value` — Not Dispatched

`InventoryAnalyticsPage.jsx` calls `get_inventory_value`. This command exists in `items.rs` (`get_inventory_value_inner`) and in `lib.rs` as a Tauri command, but has **no dispatch arm** in `http_server.rs`. The inventory value card on the analytics page always shows an error.

### 2.6 `CloseShiftModal` Calls `get_shift_summary` With Wrong Param Shape

`CloseShiftModal.jsx` calls `get_shift_summary({ shift_id })`. The backend `get_shift_summary_inner` expects the active shift to be identified by `token`-derived user context (no explicit `shift_id` param). The call succeeds only coincidentally if the user has one open shift; fails for any edge case.

### 2.7 `SupplierDetailPage` Sends Payments to Wrong Endpoint

`SupplierDetailPage.jsx` records supplier payments by calling `record_supplier_payment`. This is dispatched in `http_server.rs` under `supplier_payments` module. However the frontend `commands/suppliers.js` (or wherever it is called) passes `{ supplier_id, amount, notes }` — the backend DTO requires `{ supplier_id, purchase_order_id, amount, payment_method, reference_number, notes }`. The missing required fields cause a deserialization error.

---

## 3. Missing Real POS Workflows

### 3.1 No Barcode Scan Support

Real POS systems live on barcode scanners. There is no:
- USB HID barcode scanner event listener
- Keyboard wedge input handler in the item search panel
- Visual indicator for "barcode mode" vs "keyword search mode"
- Debounced auto-search on scan (scanners emit fast keystrokes followed by Enter)

A cashier must type every product name manually.

### 3.2 No Split Payment Support

The payment modal (when built) appears to handle only one payment method at a time. Real POS workflows require:
- Cash + Card split
- Multiple gift cards
- Partial loyalty points + remainder cash
- No current data model supports multi-tender on a single transaction

### 3.3 No Customer-Facing Display Protocol

There is no second-screen or customer display output. No receipt printer protocol (ESC/POS, Star, Epson). The "print receipt" action will attempt to open a browser print dialog — completely unusable at a retail counter.

### 3.4 No Quick-Add / Favourite Items Panel

Every POS (Square, Toast, Shopify POS) has a configurable tile grid of fast-access items. Cashiers cannot ring up "Coffee - Small" in one tap — they must search every time.

### 3.5 No Offline / Queue Mode

If the PostgreSQL server goes down mid-shift, the entire POS stops working. There is no:
- Local SQLite fallback
- Transaction queue for later sync
- "Offline mode" indicator

For a desktop POS, this is a critical reliability gap.

### 3.6 No Cash Drawer Integration

`log_drawer_event` exists in the backend. The frontend `CashMovementModal` does not send a drawer open command on any payment type. Real hardware cash drawers open via ESC/POS signal or GPIO pulse — there is no platform-level integration.

### 3.7 Void Requires Manager Approval In Real POS

The void flow in `TransactionDetailPage` calls `void_transaction` directly. In every major POS, voiding a completed transaction requires a manager PIN or approval. There is no approval gate — any cashier with the `transactions.void` permission can void without oversight.

### 3.8 No End-Of-Day Denomination Count

`CloseShiftModal` accepts a single "closing float" number. Real EOD cash reconciliation requires a denomination count (how many $100s, $50s, $20s, etc.) to catch counting errors. The shift summary shows "Expected Cash" vs "Actual" variance but without denomination breakdown, cashiers can enter any number.

### 3.9 No Tax-Inclusive Pricing Toggle

Nigerian VAT (7.5%) is seeded. The system always adds tax on top of the price. Many retailers display **tax-inclusive** prices on shelf. There is no per-store or per-item toggle for tax-inclusive vs tax-exclusive pricing. Customers are quoted one price at the shelf and charged another at the POS.

### 3.10 No Item Modifier / Combo Support

Restaurant POS (Toast, Square for Restaurants) requires modifiers (size, toppings, add-ons). Even for retail, bundled items, kit items, and combo pricing are common. The item schema has no modifier or component concept.

### 3.11 Refund Does Not Offer Store Credit Option

`create_return` only posts a cash/card refund. Real POS returns should offer: cash refund, original payment method refund, or store credit (added to customer wallet). The wallet top-up exists as a backend command but is disconnected from the returns flow.

### 3.12 No Item Search by Barcode in Returns Flow

`InitiateReturnModal` (not yet built per Phase 4) will need to search items by barcode. The backend `get_item` accepts an `id` but not a `barcode` field. There is no `get_item_by_barcode` command — manual returns require knowing the item UUID.

---

## 4. UI/UX Breakdown

### 4.1 Sidebar Has No Loading State for Shift Banner

`AppSidebar.jsx` renders a shift status banner. On first load before `shiftStore.isInitialized` is set, it briefly shows "No Active Shift" even when a shift is open — a flash of incorrect state that can confuse cashiers.

### 4.2 Analytics Pages: Chart Heights Are Zero (Tailwind JIT)

As noted in §1.2, dynamic class names like `h-[${height}px]` never get included in the CSS bundle. All chart containers render at zero height. Use inline `style={{ height }}` or predefined Tailwind classes instead.

### 4.3 Empty States Are Inconsistent

Some pages use the shared `<EmptyState>` component. Others render ad-hoc empty paragraphs, `null`, or nothing at all. `WalletPage`, `NotificationsPage`, and `StockTransfersPage` fall into this category — a cashier sees a completely blank page with no guidance.

### 4.4 PosPage Layout Wastes Vertical Space on Low-Resolution Screens

The POS layout is a two-column split at a fixed ratio. On 1366×768 screens (common in retail environments), the cart panel clips the "Charge" button below the fold. The user must scroll to complete a sale. No viewport-height calculations or `overflow-auto` guards exist on the cart section.

### 4.5 No Keyboard Shortcuts on POS Screen

Real cashiers never use a mouse. There are no keyboard shortcuts for:
- F1 / F2 — Switch payment method
- F8 — Open cash drawer
- F10 — Charge / Complete sale
- Escape — Cancel
- Numeric keypad for quantity entry

### 4.6 `DataTable` Pagination Loses State on Navigate-Back

When a user navigates from a list page to a detail page and returns, React Router unmounts the list component — pagination resets to page 1, filters clear. Users lose their place in a 500-row table. No scroll restoration or query-string persistence of filter/page state.

### 4.7 Toast Messages Are Not Scoped to Action

`sonner` toasts are global. On POS, firing a "Sale complete!" toast while another cashier action is in flight (on a slow network) means the toast may appear seconds after the action — confusing temporal association.

### 4.8 `ConfirmDialog` for Hard Delete Is Reused for Toggle — Wrong Severity

Several pages use the same `ConfirmDialog` variant="destructive" for both permanent delete AND deactivation. Deactivation is reversible — it should use `variant="warning"`, not destructive red. Treating a reversible action as irreversible trains users to ignore confirmation dialogs.

### 4.9 Mobile / Touch Layout Not Considered

Tauri runs a WebView. On Windows tablets (common at retail counters), touch targets must be ≥44px. Many icon buttons use `h-7 w-7` (28px) with `size="icon"` — too small for reliable finger taps. No touch event overrides, no swipe-to-delete, no pull-to-refresh equivalents.

### 4.10 No Dark/Light Mode Toggle

The design is dark-only. The CSS token system supports it, but there is no toggle exposed in Settings. Some deployment environments (bright retail environments, outdoor kiosks) require a light mode for legibility.

### 4.11 Number Formatting Is Not Locale-Aware

`formatCurrency()` in `lib/format.js` hardcodes `₦` (Nigerian Naira) and a fixed decimal format. There is no locale or currency setting in the store config. Deploying to a non-Nigerian market requires source code changes.

### 4.12 `PageHeader` Action Slot Renders Buttons Out of Alignment on Narrow Viewports

The `PageHeader` uses `flex justify-between`. On narrow panels (sidebar open + 1366px width), the action button overlaps the title text. No `flex-wrap` or responsive stack breakpoint is applied.

---

## 5. Data Integrity & State Management Issues

### ✅ 5.1 Cart State Survives App Restart Without Shift Validation

`cartStore` is persisted to localStorage (or at least survives hot-reload in dev). On app restart, the cart is restored, but `shiftStore` re-initializes asynchronously. There is a window where `cartStore.items.length > 0` but `shiftStore.activeShift === null`. The POS charge button should be disabled, but if the component mounts before `initForStore` completes, it may briefly be enabled.

### ✅ 5.2 Stale `activeStore` After Store Deactivation

If a global admin deactivates a store while another user is logged in with that store as their `activeStore`, the branch store in Zustand still holds the deactivated store object. All subsequent API calls include the deactivated `store_id` — backend queries that filter `WHERE is_active = TRUE` will return empty results with no error, silently appearing as "no data".

### 5.3 `useShift` Reads Shift State Before `initForStore` Completes

`initForStore` in `shift.store.js` is async (calls `get_active_shift`). Components that call `useShift()` during the brief initialization window read `activeShift: null` and render "No active shift" banners even when a shift is open. No `isInitialized` flag is exposed from the shift store to suppress premature renders.

### 5.4 Double-Submission Risk on Mutations

Mutation buttons (`Save`, `Confirm`, `Submit`) in most dialogs are not disabled while the mutation is in-flight. A cashier on a slow connection can tap "Complete Sale" twice, submitting two identical transactions. The backend has no idempotency key or client-generated transaction reference to deduplicate.

### ✅ 5.5 `transaction_ref_seq` Is Per-Database, Not Per-Store

The transaction reference sequence (`TXN-000001`) increments globally across all stores. In a multi-store deployment, Store A will have `TXN-000001, TXN-000004, TXN-000007…` and Store B `TXN-000002, TXN-000005…`. This confuses store managers who expect sequential references within their own store.

### 5.6 Financial Decimal Precision — Frontend / Backend Mismatch

Backend stores prices as `NUMERIC(15,4)` and sends them as strings (`"1500.0000"`). The frontend calls `parseFloat()` which converts to IEEE 754 double. For values like `0.1 + 0.2` this introduces floating-point errors. All arithmetic in the cart totals, discount calculations, and change-due should use a decimal library (`big.js`, `decimal.js`), not native JS floats.

### ✅ 5.7 Stock Count Session State Is Not Locked

When a stock count session is started (`start_stock_count`), there is no mechanism to lock the inventory for that session. Concurrent sales during a count will update `item_stock.quantity` while counts are being entered — the variance report will show phantom discrepancies. Real POS systems lock items or run counts during off-hours.

### ✅ 5.8 Concurrent Shift Problem: No Uniqueness Constraint Enforced at API Layer

The backend `open_shift` query checks for an existing open shift, but the check and insert are not in a single serializable transaction. Under concurrent requests (two tablets opening a shift simultaneously), both could pass the check and insert two open shifts. There is no `UNIQUE` constraint on `(store_id, status='open')`.

### 5.9 Refresh Token Is Stored in `localStorage` — XSS Risk

`qpos_refresh` (the refresh token) is stored in `localStorage`. In a web context, any XSS injection can read it. In Tauri's WebView, the risk is lower (no untrusted origins), but the pattern is still a bad practice that would be a blocker in any PCI-DSS assessment.

### 5.10 JWT Secret Is Generated at Runtime and Not Persisted

`jwt_secret` in `AppState` is generated fresh on every app launch (`uuid::Uuid::new_v4().to_string()`). Every restart invalidates all existing refresh tokens and forces all users to re-login. For a production deployment where the Tauri server restarts (update, crash), all active sessions are lost.

---

## 6. Priority Action Plan (P0–P3)

### P0 — Showstoppers (App Cannot Be Used in Production)

| # | Issue | Fix |
|---|---|---|
| ✅ P0-1 | POS screen has zero functionality — no item search, no cart, no payment | Fully implemented — `PosPage.jsx` (1656 lines), `usePos.js`, `HoldDrawer`, `CustomerSearchBar`, `ReceiptModal` |
| ✅ P0-2 | Analytics charts render at zero height (Tailwind JIT dynamic class bug) | Replaced all `` `h-[${n}px]` `` with `style={{ height: n }}` in `ProductsAnalyticsPage`, `ProfitabilityPage`, `CashiersAnalyticsPage` |
| ✅ P0-3 | `get_sales_by_period` dead function — correct `getRevenueByPeriod` already existed | Removed the duplicate `getSalesByPeriod` wrapper from `commands/analytics.js` |
| ✅ P0-4 | Setup wizard source files deleted — first-run flow may be broken | All 4 files exist in `src/features/setup/` — SetupWizard, ModeSelector, ServerSetup, ClientSetup |
| ✅ P0-5 | JWT secret regenerated on every restart — all sessions invalidated on update | JWT secret is now a deterministic SHA-256 hash (env override via `JWT_SECRET`) |
| ✅ P0-6 | Double-submission on mutations — duplicate transactions possible | Audited all mutation buttons — `disabled={mutation.isPending}` added where missing in `ItemDetailView` |

### P1 — High Severity (Core Workflows Broken)

| # | Issue | Fix |
|---|---|---|
| ✅ P1-1 | `resolve_reorder_alert` → should be `acknowledge_reorder_alert` | Fixed in `commands/reorder_alerts.js` — `resolveReorderAlert` now calls correct method |
| ✅ P1-2 | `suspend_shift`, `resume_shift`, `reconcile_shift`, search commands not in `generate_handler![]` | All commands dispatched in `http_server.rs` — architecture uses HTTP for all business logic |
| ✅ P1-3 | `get_inventory_value` not dispatched in `http_server.rs` | Not called from frontend — inventory value is returned by `get_inventory_summary` |
| ✅ P1-4 | Stock transfer approve/complete calls not dispatched | `approve_stock_transfer`/`complete_stock_transfer` don't exist — stock transfers use send/receive flow |
| ✅ P1-5 | `credit_wallet` not dispatched — Wallet top-up silently fails | `deposit_to_wallet` dispatched in `http_server.rs`; `WalletPage` now shows all customers |
| ✅ P1-6 | `CloseShiftModal` passes wrong params to `get_shift_summary` | `CloseShiftModal` correctly calls `getShiftSummary(activeShift.id)` → `{ shift_id }` |
| ✅ P1-7 | Stale shift state window causes incorrect "No active shift" flash | Added `isInitialized` flag to `shift.store.js`; `ShiftStatusBanner` suppressed until initialized |
| ✅ P1-8 | Cart floats used for financial math — precision errors at scale | `calcCartTotals` now uses `big.js` for all arithmetic; installed via pnpm |
| ✅ P1-9 | Missing cache invalidations for stock transfers, expenses, price changes | Added `invalidateAfterStockTransfer`, `invalidateAfterExpense`, `invalidateAfterPriceChange`, `invalidateAfterReorderAlert` to `lib/invalidations.js` |
| ✅ P1-10 | `SupplierDetailPage` sends incomplete payment DTO — 422 on every payment | `useSupplierPayments.record` already adds `supplier_id` + `store_id`; dialog passes `payment_method` |

### P2 — Medium Severity (Feature Gaps / Poor UX)

| # | Issue | Fix |
|---|---|---|
| P2-1 | Barcode scanner not supported on POS | POS has barcode-scan input handler via `lookupBarcode` in `usePos.js` — scanner wedge supported |
| ✅ P2-2 | `WalletPage` reads logged-in user instead of customer — wrong data | `WalletPage` now shows all customers with wallet balances; deposit dialog scoped to selected customer |
| ✅ P2-3 | No manager approval for void transaction | Fixed — VoidModal is now a two-step flow: reason → PIN verification via `verifyPosPin` before `void_transaction` fires |
| ✅ P2-4 | `get_all_supplier_payables` has no backend dispatch | Added dispatch arm to `http_server.rs` |
| ✅ P2-5 | No keyboard shortcuts on POS screen | Fixed — F1=Cash, F2=Card, F3=Transfer, F10=Charge, Escape=cancel popover/blur; alphanumeric refocuses product search |
| ✅ P2-6 | Pagination/filter state lost on navigate-back | Fixed — `usePaginationParams` hook (URL ?page/size/q) applied to TransactionsPanel and CustomersPanel |
| ✅ P2-7 | DataTable lacks row-count selector (show 25/50/100 rows) | Added `onPageSizeChange` prop + select (10/25/50/100) to `DataTable` pagination bar |
| ✅ P2-8 | `reconcile_shift` any-user access | Fixed — `guard_permission("shifts.manage")` enforced |
| ✅ P2-9 | Price scheduling backend exists but zero frontend exposure | `schedule_price_change`, `cancel_scheduled_price_change`, `get_pending_price_changes` dispatched in HTTP server; frontend command wrappers exist |
| ✅ P2-10 | Backup/restore backend exists but zero frontend | `BackupPanel.jsx` implemented under Settings with create/restore/export |

### P3 — Low Severity / Polish

| # | Issue | Fix |
|---|---|---|
| ✅ P3-1 | Number formatting hardcoded to NGN ₦ | Fixed — `store_settings.currency`/`locale` columns (migration 0069); `useCurrencySetup` reads per-store currency; picker in Settings |
| ✅ P3-2 | Icon buttons at 28px — too small for touch | Fixed — CartItemRow +/−/remove buttons `h-6 w-6` → `h-8 w-8`; DataTable pagination prev/next `h-7 w-7` → `h-8 w-8` |
| P3-3 | ConfirmDialog variant="destructive" on reversible deactivation | N/A — feature pages use custom inline toggle dialogs, not shared `ConfirmDialog` |
| ✅ P3-4 | No dark/light mode toggle | Fixed — per-branch theme column in DB; dark default; toggle in Settings → Appearance; applied instantly via `applyTheme()` + flash-prevention in `index.html` |
| ✅ P3-5 | `transaction_ref_seq` is global, not per-store | Fixed — migration 0071 adds `store_ref_counters` table; `next_ref_no()` helper; TXN/RET/PO now per-store sequential |
| P3-6 | Toast messages have no temporal association guard | Open |
| ✅ P3-7 | No denomination count on shift close | Fixed — `CloseShiftModal` has "Count by denomination" toggle with full ₦1–₦1000 grid + running totals |
| ✅ P3-8 | Loyalty points system exists but is unreachable | `expire_old_points` dispatch added to `http_server.rs`; loyalty UI via `useLoyalty.js` exists |
| ✅ P3-9 | EOD "Generate PDF" calls non-existent command | `generate_eod_report` is implemented, in `http_server.rs`, and called from `EodPage` with `isPending` guard |
| ✅ P3-10 | Refresh token in `localStorage` | Fixed — refresh token moved to `sessionStorage` (clears on app close); user data stays in `localStorage` for optimistic display |

---

## Appendix: Backend Commands Not Exposed via HTTP

The following commands exist in `lib.rs` `generate_handler![]` (Tauri invoke path) but have **no dispatch arm** in `http_server.rs`. They are unreachable from the HTTP API used by all frontend components:

```
get_inventory_value
expire_old_points
bulk_item_import (partial — bulk_operations dispatch exists but no arm for this)
suspend_shift
resume_shift
get_store_active_shifts
reconcile_shift
search_transactions
search_purchase_orders
search_transfers
search_returns
generate_eod_report
schedule_price_change
get_scheduled_changes
cancel_scheduled_price_change
create_backup
list_backups
restore_backup
delete_backup
```

These represent approximately **19 backend commands** that are fully implemented in Rust but completely inaccessible from the React frontend.
