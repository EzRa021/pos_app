---

## Implementation Progress Log

### Pass 1 — HTTP RPC Wiring + lib.rs Sync (completed)

**Changes made:**

**`src-tauri/src/lib.rs`**
- Added 17 missing Tauri command registrations that existed in Rust but were absent from `invoke_handler`:
  - Departments: `search_departments`, `get_departments_by_store`, `get_global_departments`, `get_department_by_code`, `get_department_categories`, `activate_department`, `deactivate_department`, `count_departments`
  - Categories: `search_categories`, `get_category_by_code`, `get_pos_categories`, `get_subcategories`, `get_category_items`, `activate_category`, `deactivate_category`, `assign_category_department`, `count_categories`
  - Items: `get_item_by_barcode`, `get_item_by_sku`

**`src-tauri/src/http_server.rs`**
- Rewrote dispatcher to expose **all ~90 backend commands** as HTTP RPC methods.
- Added `as_state()` helper (safe transmute) to reuse Tauri command implementations for commands without dedicated `*_inner` functions.
- Full coverage per domain:

| Domain | RPC Methods Added |
|---|---|
| Auth | login, refresh_token, logout, change_password, verify_session, request_password_reset, reset_password |
| Users | get_users, get_user, create_user, update_user, delete_user, get_roles |
| Stores | get_stores, get_store, create_store, update_store |
| Departments | get_departments, get_department, create_department, update_department, delete_department, hard_delete_department, **search_departments**, **get_departments_by_store**, **get_global_departments**, **get_department_by_code**, **get_department_categories**, **activate_department**, **deactivate_department**, **count_departments** |
| Categories | get_categories, get_category, create_category, update_category, delete_category, hard_delete_category, **search_categories**, **get_category_by_code**, **get_pos_categories**, **get_subcategories**, **get_category_items**, **activate_category**, **deactivate_category**, **assign_category_department**, **count_categories** |
| Items | get_items, get_item, **get_item_by_barcode**, **get_item_by_sku**, create_item, update_item, delete_item, adjust_stock, get_item_history |
| Inventory | get_inventory, get_low_stock, start_stock_count, get_stock_counts |
| Transactions | create_transaction, get_transactions, get_transaction, void_transaction, hold_transaction, get_held_transactions, delete_held_transaction |
| Returns | create_return, get_returns, get_return |
| Customers | get_customers, get_customer, create_customer, update_customer, delete_customer |
| Suppliers | get_suppliers, get_supplier, create_supplier, update_supplier, delete_supplier |
| Purchase Orders | get_purchase_orders, get_purchase_order, create_purchase_order, receive_purchase_order, cancel_purchase_order |
| Payments | get_payments |
| Shifts | open_shift, close_shift, get_active_shift, get_shifts, get_shift |
| Cash Movements | add_cash_movement, get_cash_movements, get_shift_summary, log_drawer_event |
| Credit Sales | get_credit_sales, get_credit_sale, record_credit_payment, get_credit_payments |
| Expenses | get_expenses, get_expense, create_expense, approve_expense |
| Analytics | get_sales_summary, get_revenue_by_period, get_top_items, get_top_categories, get_payment_method_summary |
| Receipts | get_receipt, generate_receipt_html |
| Tax | get_tax_categories, create_tax_category, update_tax_category |
| Price Management | get_price_lists, create_price_list, add_price_list_item, get_price_list_items, request_price_change, approve_price_change, get_price_changes |
| Audit | get_audit_logs, log_action |

**Note:** Excel import/export (`import_items`, `import_customers`, `export_items`, `export_transactions`) are intentionally **not exposed via HTTP RPC** — they require filesystem access (file dialogs, local paths) and only make sense as Tauri `invoke()` calls from the desktop window.

---

