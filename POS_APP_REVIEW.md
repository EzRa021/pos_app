# Quantum POS — App Review & Integration Audit
> Generated: 2026-03-17

---

## 1. Module Connection Map

| Module | Backend | Frontend | Connected? | Notes |
|--------|---------|----------|-----------|-------|
| POS | ✅ | ✅ | ✅ | Core flow complete |
| Shifts | ✅ | ✅ | ✅ | Open/close, cash movements, summary |
| Transactions | ✅ | ✅ | ✅ | List, detail, void, refund, reprint |
| Returns | ✅ | ✅ | ✅ | Full + partial, linked to transactions |
| Products / Items | ✅ | ✅ | ✅ | CRUD, stock adjust, images, history |
| Departments | ✅ | ✅ | ✅ | Standard management panel |
| Categories | ✅ | ✅ | ✅ | Standard management panel |
| Inventory / Stock counts | ✅ | ✅ | ✅ | Stock count sessions, variance report |
| Stock transfers | ✅ | ✅ | ✅ | Create, send, receive, cancel |
| Customers | ✅ | ✅ | ✅ | CRUD, stats, transaction history |
| Credit sales | ✅ | ✅ | ✅ | List, record payment, cancel |
| Suppliers | ✅ | ✅ | ✅ | CRUD, stats, detail page |
| Purchase Orders | ✅ | ✅ | ✅ | Create, submit, approve, receive |
| Expenses | ✅ | ✅ | ✅ | Create, approve, reject, summary |
| Analytics | ✅ | ⚠️ Partial | ⚠️ | Only 6 of 20+ endpoints used |
| EOD Reports | ✅ | ✅ | ✅ | Generate, lock, history |
| Notifications | ✅ | ⚠️ Partial | ⚠️ | UI exists, not event-driven |
| Audit log | ✅ | ✅ | ✅ | Full log viewer |
| Users / Roles / Permissions | ✅ | ✅ | ✅ | CRUD, drawer, permission editor |
| Settings | ✅ | ✅ | ✅ | Store config, receipt settings |
| **Price Management** | ✅ | ❌ Placeholder | ❌ | Backend fully built, no frontend |
| **Supplier Payments** | ✅ | ❌ | ❌ | record_supplier_payment orphaned |
| **Wallet** | ✅ | ⚠️ Hook only | ❌ | POS accepts wallet, no top-up UI |
| **Loyalty** | ✅ | ⚠️ Hook only | ❌ | Redemption works, earning never called |
| **Bulk Operations** | ✅ | ❌ | ❌ | 5 bulk endpoints, no UI |
| **Barcode / Label printing** | ✅ | ❌ | ❌ | generate_item_labels, print_price_tags |
| **Backup / Restore** | ✅ | ❌ | ❌ | create_backup, restore_from_backup |
| **POS PIN Security** | ✅ | ⚠️ Partial | ❌ | Screen exists, not wired |
| **FX Rates** | ✅ | ❌ | ❌ | get/set/convert, no frontend |
| **Reorder Alerts** | ✅ | ⚠️ | ❌ | check_reorder_alerts never triggered |
| **Scheduled Price Changes** | ✅ | ❌ | ❌ | Full backend, no frontend |
| **Profit / Loss Analytics** | ✅ | ❌ | ❌ | get_profit_loss_summary unused |

---

## 2. Critical Integration Gaps

These are broken cross-module links — things that look connected but silently don't work.

### 2.1 Loyalty earning is disconnected
`create_transaction` does **not** automatically call `earn_points`. Points are only
*redeemed* at POS (correctly), but never *earned*. The `earn_points` command is an
orphan. A customer completing a ₦50,000 purchase earns zero points.

**Fix**: After `charge()` succeeds in `usePos.js`, call `earnPoints({ customer_id, store_id, transaction_id })` when `customer?.id` is set and the loyalty program is active.

---

### 2.2 Reorder alerts never fire
`check_reorder_alerts` exists but nothing triggers it. When stock drops below
`reorder_point` after a sale, no alert is created. The notification system is also
entirely manual — `create_notification` has no automatic hooks tied to sale events,
PO approvals, or stock events.

**Fix**: Call `checkReorderAlerts(storeId)` inside `invalidateAfterSale()` in
`src/lib/invalidations.js`. This runs after every sale and surfaces alerts in the
notification bell.

---

### 2.3 Supplier payments completely disconnected
The backend has `record_supplier_payment`, `get_supplier_payments`, `get_supplier_balance`.
You can receive goods from a PO but can never record what was paid to the supplier.
There is no "Amount Owed" or "Payment History" anywhere in the Suppliers or PO pages.

**Fix**: Add a "Payments" tab/section to `SupplierDetailPage` and a "Record Payment"
button on `PurchaseOrderDetailPage`.

---

### 2.4 Wallet is half-built
`useWallet.js` has hooks for balance and history, and the POS correctly passes
`wallet_amount` to `create_transaction`. But cashiers have no way to:
- Top up a customer's wallet (`deposit_to_wallet`)
- View wallet history from the customer profile
- Adjust wallet balance (`adjust_wallet`)

The wallet balance appears in the POS customer picker but the management UI is missing.

**Fix**: Add a "Wallet" section to `CustomerDetailPage` with balance display, top-up
dialog, and history table.

---

### 2.5 Analytics is surface-level
The analytics page uses ~6 of 20+ available backend endpoints. The following are
fully built on the backend but not shown anywhere in the frontend:

| Endpoint | What it shows |
|----------|---------------|
| `get_profit_loss_summary` | Revenue vs. COGS vs. gross profit |
| `get_profit_analysis` | Profit per item/category |
| `get_customer_analytics` | Top customers, retention, average spend |
| `get_tax_report` | VAT collected by period |
| `get_slow_moving_items` | Items with low sales velocity |
| `get_dead_stock` | Items with zero sales over N days |
| `get_stock_velocity` | Stock turnover rate |
| `get_comparison_report` | Period-over-period comparison |
| `get_discount_analytics` | Discount usage and revenue impact |
| `get_payment_trends` | Payment method trends over time |
| `get_supplier_analytics` | Spend per supplier |
| `get_low_margin_items` | Items below margin threshold |
| `get_cashier_performance` | Sales by cashier |
| `get_return_analysis` | Return rates by item/category |

---

### 2.6 POS PIN lock is wired on neither end
`PinLockScreen.jsx` exists. `set_pos_pin`, `verify_pos_pin`, `lock_pos_screen` are
in the backend. But:
- There is no PIN setup screen in User Settings or the POS header
- There is no auto-lock timer
- `lock_pos_screen` is never called
- `verify_pos_pin` is never called on unlock

**Fix**: Add PIN setup in user profile drawer. Add an auto-lock timer in `PosPage`
that triggers after N minutes of inactivity (configurable in store settings).

---

### 2.7 Price Management is a placeholder
`router.jsx` routes `/price-management` to `PlaceholderPage`. The backend has:
- `get_price_lists`, `create_price_list`, `add_price_list_item`, `get_price_list_items`
- `request_price_change`, `approve_price_change`, `get_price_changes`
- `schedule_price_change`, `cancel_scheduled_price_change`, `apply_scheduled_prices`
- `get_pending_price_changes`, `get_item_price_history`

This is a complete approval-workflow system for price changes. No frontend at all.

---

## 3. Priority Build List

### High Priority — Visible daily gaps

**1. Loyalty earning after sale**
- File: `src/features/pos/usePos.js` — `charge()` function
- After `createTransaction` succeeds, call `earnPoints` if `customer?.id` exists
- Invalidate `["loyalty-balance", customerId]` and `["loyalty-history", customerId]`

**2. Wallet top-up in Customer detail**
- File: `src/pages/CustomerDetailPage.jsx`
- Add wallet balance display (already in `useWallet.js`)
- Add "Top Up" dialog → `deposit_to_wallet`
- Add wallet transaction history table → `get_wallet_history`

**3. Supplier payments**
- New: `src/features/supplier_payments/SupplierPaymentsPanel.jsx`
- Add to `SupplierDetailPage`: balance owed, payment history, "Record Payment" button
- Add to `PurchaseOrderDetailPage`: payment status badge

**4. Reorder alerts auto-trigger**
- File: `src/lib/invalidations.js` — `invalidateAfterSale()`
- Add call to `checkReorderAlerts(storeId)` after every sale
- Surface count in notification bell badge

**5. Price Management page**
- Replace `PlaceholderPage` at `/price-management`
- Build: price list CRUD, price change request form, approval queue
- Standard management panel pattern (Section + StatCards + DataTable)

---

### Medium Priority — Operational completeness

**6. Analytics depth**
- Add tabs to `AnalyticsPage`: Profit & Loss, Customer Analytics, Tax Report, Inventory Velocity
- All data ready — just needs charts and tables wired to existing endpoints

**7. Bulk operations**
- Add "Bulk Actions" dropdown to `ItemsTable` header (multi-select rows)
- Options: Bulk price update, Bulk stock adjustment, Bulk activate/deactivate, Apply discount
- Backend endpoints: `bulk_price_update`, `bulk_stock_adjustment`, `bulk_activate_items`, `bulk_deactivate_items`, `bulk_apply_discount`

**8. Barcode label printing**
- Add "Print Labels" button on `ItemDetailPage` and `ItemsTable` row actions
- Dialog: quantity, format selector → `generate_item_labels` → iframe print (same pattern as receipts)
- `auto_generate_barcode` for items without barcodes

**9. POS PIN lock**
- PIN setup in user profile / settings
- Auto-lock timer in `PosPage` (inactivity N minutes, configurable)
- Lock button in POS header bar
- `PinLockScreen.jsx` already exists — wire `verify_pos_pin`

**10. Backup / Restore**
- Add "Backup & Restore" section to `SettingsPage`
- `create_backup` → download file to user's machine
- `restore_from_backup` → file upload dialog with confirmation
- `list_backups` → show backup history with dates/sizes
- `schedule_auto_backup` → toggle with interval selector

---

### Lower Priority — Enhancement

**11. Scheduled price changes**
- Extend Price Management page with a "Scheduled Changes" tab
- `schedule_price_change`: set a price + activation date/time
- `apply_scheduled_prices`: cron-style trigger (or manual "Apply Now" button)

**12. FX rates**
- Settings page section (only needed for stores accepting foreign currency)
- `get_exchange_rate`, `set_exchange_rate`, `convert_amount`
- Show NGN ↔ USD/GBP conversion at POS payment step

**13. Session management (Admin)**
- Add to Users page or Settings: "Active Sessions" tab
- `get_active_sessions`: list who's logged in, from which IP
- `revoke_session`: force logout a specific session

**14. Supplier analytics**
- Add to `SupplierDetailPage`: spend over time, PO count, average lead time
- `get_supplier_analytics` endpoint ready

---

## 4. UX / Polish Issues

### 4.1 No global search
There is no way to jump to a customer, transaction, item, or supplier without navigating
to the correct page. A `Cmd+K` command palette searching across all entities would be
standard for a professional POS desktop app.

### 4.2 POS keyboard shortcuts
The barcode scanner input works correctly but there are no keyboard shortcuts for:
- Payment method selection (F1 = Cash, F2 = Card, etc.)
- `Escape` to clear cart / close modals
- `Enter` to confirm charge
- `F9` to open hold drawer

### 4.3 Offline sale support
`offline_sale: false` is hardcoded in `usePos.js`. If the Tauri app is in client mode
and the server becomes unreachable, the cashier cannot process any sale. At minimum,
a warning banner when connectivity drops would help. Full offline queuing is a larger
project.

### 4.4 Thermal receipt printer format
The current receipt prints via browser print dialog (full A4 page). Production POS
environments use 80mm thermal printers. The backend generates the receipt HTML — it
needs a thermal-optimized CSS stylesheet: narrow width (~300px), no margins, monospace
font, no backgrounds/borders. This is a CSS change in the Rust receipt template, not
the frontend.

### 4.5 Return quantity validation in UI
The "Return Items" button on `TransactionDetailPanel` appears for `partially_refunded`
transactions, which can allow attempting to return quantities already returned. The
backend validates this correctly and will error, but the UI would be more professional
if it tracked already-returned quantities per item and capped the refund quantity
inputs accordingly.

### 4.6 Cashier dashboard / home screen
Currently the app lands on `/pos` (the POS screen). Global users (admins/managers)
who aren't cashiers have no dashboard. Analytics is a separate page. A home screen
showing today's key KPIs (sales, transactions, low stock alerts, pending POs, open
credit balances) would be the appropriate landing page for non-cashier roles.

---

## 5. What's Working Well

- **Backend is production-grade**: 230+ HTTP endpoints, clean RBAC, proper financial
  math with `rust_decimal`, audit trail on all mutations, JWT with refresh tokens.
- **Cache invalidation is now centralized**: `src/lib/invalidations.js` ensures all
  related pages update after every mutation without a page refresh.
- **Standard page pattern is consistent**: PageHeader + StatCards + Section + DataTable
  is applied uniformly across Departments, Categories, Items, Users, etc.
- **POS core flow is solid**: Cart, payment methods, split payment, wallet redemption,
  loyalty redemption, held transactions, receipt print, barcode scan all work.
- **Shift enforcement**: `create_transaction` and `add_cash_movement` correctly require
  an open shift. The UI gates these actions via `isShiftOpen`.
- **Returns and voids are properly integrated**: Both restore stock, update transaction
  status, and invalidate the correct caches.
- **Role-based UI gating**: `usePermission()` correctly hides admin controls from
  cashiers and stock keepers throughout the app.

---

## 6. File Reference — Key Integration Points

| Concern | File |
|---------|------|
| Cache invalidation logic | `src/lib/invalidations.js` |
| Sale → loyalty earning (missing) | `src/features/pos/usePos.js` — `charge()` |
| Sale → reorder check (missing) | `src/lib/invalidations.js` — `invalidateAfterSale()` |
| Wallet hooks (exists, no UI) | `src/features/wallet/useWallet.js` |
| Loyalty hooks (exists, no UI) | `src/features/loyalty/useLoyalty.js` |
| Price management route | `src/router.jsx` — `/price-management` (PlaceholderPage) |
| POS PIN screen (exists, unwired) | `src/components/shared/PinLockScreen.jsx` |
| Receipt print hook | `src/hooks/usePrintReceipt.js` |
| HTTP dispatch (all 230+ endpoints) | `src-tauri/src/http_server.rs` |
| Notification commands | `src-tauri/src/commands/notifications.rs` |
| Reorder alert commands | `src-tauri/src/commands/reorder_alerts.rs` |
| Loyalty commands | `src-tauri/src/commands/loyalty.rs` |
| Wallet commands | `src-tauri/src/commands/customer_wallet.rs` |
| Supplier payment commands | `src-tauri/src/commands/supplier_payments.rs` |
| Bulk operation commands | `src-tauri/src/commands/bulk_operations.rs` |
| Label/barcode commands | `src-tauri/src/commands/labels.rs` |
| Backup commands | `src-tauri/src/commands/backup.rs` |
| FX rate commands | `src-tauri/src/commands/fx_rates.rs` |
| POS PIN / security commands | `src-tauri/src/commands/security.rs` |
| Price scheduling commands | `src-tauri/src/commands/price_scheduling.rs` |
