# Quantum POS App → POS-App Gap Report (services vs commands)

This report compares **`quantum-pos-app/src/main/services/*`** (Node/Postgres service layer) to your current **`pos-app`** stack:

- **Frontend**: `pos-app/src/commands/*` (thin `rpc(method, params)` wrappers)
- **Backend**: `pos-app/src-tauri/src/commands/*` + `pos-app/src-tauri/src/models/*` (Rust + SQLx)

Goal: make `pos-app` functionally match the older service-layer API surface **as closely as possible**.

---

## High-level findings

- **`pos-app` already has most domains** as command modules (auth, users, stores, departments, categories, items, inventory, transactions, returns, shifts, payments, suppliers, purchase_orders, expenses, analytics, audit, excel, receipts, price_management).
- **`quantum-pos-app` services expose many more “utility” endpoints** per domain:
  - **search** (by text / code / barcode)
  - **count / stats / summaries**
  - **activate/deactivate** helpers (explicit endpoints, not just update payload)
  - **POS-specific views** (e.g., categories visible in POS)
  - **hierarchy relationships** (parent department/category, subcategories)
  - **extra “rich joins”** (store_name, codes, counts)
- Some `quantum-pos-app` services have **no 1:1 equivalent** as dedicated modules in `pos-app` yet (or are folded into different modules).

---

## 1) Auth & Authorization

### `auth.service.js` (quantum-pos-app)
**Has** (major surface):
- `login(identifier, password, ipAddress, userAgent)`
- `logout(token, userId, ipAddress, userAgent)`
- `verifySession(token)`
- `refreshToken(refreshToken)`
- `changePassword(userId, currentPassword, newPassword, ipAddress, userAgent, currentToken?)`
- Session management:
  - `getActiveSessions(userId, currentToken?)`
  - `revokeSession(userId, sessionId, ipAddress, userAgent)`
  - `revokeAllSessionsExceptCurrent(userId, currentToken, ipAddress, userAgent)`
  - `cleanupExpiredSessions(includeIdle?, hardDelete?)`
  - `getSessionStatistics()`

**pos-app status**
- **Present**: login/logout/refresh/change_password (RPC) + session verification logic exists (Rust).
- **Missing / not exposed**:
  - Active session listing + revocation endpoints
  - Session statistics / cleanup endpoints
  - IP/User-Agent audit metadata integration

**To match**
- Add Rust commands + HTTP RPC methods for:
  - `get_active_sessions`, `revoke_session`, `revoke_other_sessions`
  - optional `session_stats` (admin-only)
- Add DB columns if needed (ip_address, user_agent, last_activity) for `user_sessions`.

### `authorization.service.js` (quantum-pos-app)
**Has**
- `hasPermission(userId, permissionSlug)`
- `hasAnyPermission(userId, permissionSlugs)`
- `hasAllPermissions(userId, permissionSlugs)`
- `getUserPermissions(userId)` (returns permissions list or wildcard)
- `canAccessStore(userId, storeId)`
- `hasHigherHierarchy(userId, targetUserId)`
- A large route→permissions mapping (`getRoutePermissions`, `isPublicRoute`)

**pos-app status**
- **Backend equivalent exists**: `guard_permission` in Rust implements permission checks.
- **Frontend does not get permissions list** reliably: `usePermission()` expects `user.permissions` but login response currently doesn’t embed it.

**To match**
- Add a backend command that returns **user permissions list** (and optionally role metadata).
- Consider embedding `permissions: string[]` in login response for UI gating parity.

---

## 2) Stores / Database service

### `database.service.js` (quantum-pos-app) → `storeService`
**Has**
- `create`, `getById`, `getByCode`, `getByName(exact?)`, `getAll(filters)`, `search(query)`, `update`, `delete`
- `count(filters)`, `codeExists(code)`, `getMainBranch()`

**pos-app status**
- **Present (partial)**: `get_stores`, `get_store`, `create_store`, `update_store` exist (depending on backend implementation).
- **Missing**:
  - store search utilities (by code/name), `count`, `codeExists`, `main branch`

**To match**
- Add store utility RPC methods:
  - `get_store_by_code`, `get_stores_by_name`, `search_stores`, `count_stores`, `store_code_exists`, `get_main_branch`

---

## 3) Departments

### `department.service.js` (quantum-pos-app)
**Has**
- Listing and search:
  - `getAll(filters: page, limit, store_id, parent_id, is_active, search)`
  - `search(searchQuery, limit)`
- Getters:
  - `getById(departmentId)`
  - `getByCode(departmentCode)`
  - `getByStore(storeId, isActive?, includeGlobal?)`
  - `getGlobal(isActive?)`
  - `getCategories(departmentId, isActive?)`
- Mutations:
  - `create(departmentData, createdBy)`
  - `update(departmentId, updateData, updatedBy)`
  - `activate(departmentId, updatedBy)`
  - `deactivate(departmentId, updatedBy)`
  - `delete(departmentId, force?)`
- `count(filters)`

**pos-app status**
- Backend model `Department` is **simpler**: `department_name`, `description`, `is_active`, timestamps, `store_id`.
- Backend commands only provide:
  - `get_departments(store_id?)` (no pagination/search)
  - `get_department(id)`
  - `create_department(store_id, department_name, description?)`
  - `update_department(id, department_name?, description?, is_active?)`
  - `delete_department(id)` (soft deactivate)

**Missing compared to quantum-pos-app**
- `department_code`, `parent_department_id`, `display_order`, `color`, `icon`
- Join fields: `store_name`, `store_code`, `parent_department_name`, `category_count`
- Search / pagination / count
- Activate/deactivate endpoints (separate from update)
- Global (store_id null) departments concept
- `getCategories(departmentId)` endpoint
- Hard delete / force delete semantics

**To match**
- Add columns + migrations for:
  - `department_code`, `parent_department_id`, `display_order`, `color`, `icon`, (optional) audit fields `created_by/updated_by`
- Add new commands:
  - `search_departments`, `get_departments_paged`, `count_departments`
  - `get_department_by_code`, `get_departments_by_store`, `get_global_departments`
  - `get_department_categories`
  - `activate_department`, `deactivate_department`, optional `hard_delete_department(force?)`

---

## 4) Categories

### `category.service.js` (quantum-pos-app)
**Has**
- Listing/search:
  - `getAll(filters: page, limit, store_id, department_id, parent_id, is_active, is_visible_in_pos, requires_weighing, search)`
  - `search(searchQuery, storeId?, limit)`
- Getters:
  - `getById(categoryId)` (with item_count)
  - `getByCode(categoryCode, storeId?)`
  - `getByStore(storeId, filters)`
  - `getByDepartment(departmentId, filters)`
  - `getPosCategories(storeId)` (active + visible-in-pos, includes department metadata)
  - `getSubcategories(categoryId, isActive?)`
  - `getItems(categoryId, isActive?)`
- Mutations:
  - `create(categoryData, createdBy)`
  - `update(categoryId, updateData, updatedBy)`
  - `activate(categoryId, updatedBy)`
  - `deactivate(categoryId, updatedBy)`
  - `assignDepartment(categoryId, departmentId, updatedBy)`
  - `delete(categoryId, force?)`
- `count(filters)`

**pos-app status**
- Frontend wrapper exists: `src/commands/categories.js` supports:
  - `get_categories(store_id, department_id?)`, `get_category(id)`,
  - `create_category`, `update_category`, `delete_category` (soft),
  - `hard_delete_category`
- Backend model is **simpler** (no codes/hierarchy/pos flags).

**Missing compared to quantum-pos-app**
- Fields:
  - `category_code`, `parent_category_id`, `display_order`, `color`, `icon`, `image_url`
  - `is_visible_in_pos`, `requires_weighing`, `default_tax_rate`
- Views/joins:
  - store_name/store_code, department_name/department_code, parent_category_name, item_count
- Endpoints:
  - search, pagination, count
  - `get_pos_categories`, `get_subcategories`, `get_category_items`
  - explicit activate/deactivate
  - assign department endpoint (if you keep separate)

**To match**
- Add missing columns/migrations in `categories` table.
- Add RPC methods + Rust commands:
  - `get_categories_paged`, `search_categories`, `count_categories`
  - `get_pos_categories`, `get_subcategories`, `get_category_items`
  - `activate_category`, `deactivate_category`, `assign_category_department`

---

## 5) Items

### `item.service.js` (quantum-pos-app)
**Has**
- `getAll(filters)` + `count(filters)`
- Search: `search`, `searchByBarcode`, `getByBarcode`, `getBySku`
- `create`, `update`, `delete`, `activate`, `deactivate`
- Stock: `adjustStock`, `getHistory`

**pos-app status**
- Commands exist: `get_items`, `get_item`, `create_item`, `update_item`, `delete_item`,
  `adjust_stock`, `get_item_history` (per `commands/items.js` list).
- Likely missing “search-first” and barcode-specific methods unless implemented in backend.

**To match**
- Ensure backend supports:
  - barcode lookup, sku lookup
  - paged search (keyword/filters)
  - activate/deactivate endpoints (if separate)

---

## 6) Inventory

### `inventory.service.js` (quantum-pos-app)
**Has**
- `getInventory(filters)` / `getInventoryItem(itemId, storeId)`
- `getLowStockItems(storeId)`
- `restockItem`, `adjustInventory`
- `getMovementHistory`, `getInventorySummary`
- Stock count workflow:
  - `startCountSession`, `recordCount`, `completeCountSession`
  - `getVarianceReport`, `applyVariances`, `getCountSession`, `getCountSessions`

**pos-app status**
- Commands exist: `get_inventory`, `get_low_stock`, `start_stock_count`, `get_stock_counts`
- Movement history / summary / variance reporting may be missing depending on backend.

**To match**
- Add missing inventory endpoints:
  - movements history, summary, variance report, apply variances, count session details.

---

## 7) Transactions + Held Transactions + Returns

### `transaction.service.js` (quantum-pos-app)
**Has**
- create sale, fetch by id, list all
- void + refunds: `voidTransaction`, `partialRefund`, `fullRefund`

### `held-transaction.service.js` (quantum-pos-app)
**Has**
- `holdTransaction`, `getHeldTransactions`, `getById`, `update`, `convertToSale`, `delete`, `cleanupExpired`

### `return.service.js` (quantum-pos-app)
**Has**
- `processReturn`, `getById`, `getAll(filters)`, `getBySaleId`

**pos-app status**
- `pos-app` has a single RPC endpoint pattern; held transactions likely live under `transactions` module (`hold_transaction`, `get_held_transactions`, etc.) per `CLAUDE.md`.
- Refund/return flow likely differs: `pos-app` uses `returns` module (`create_return`, etc.) rather than “refund” on transaction service.

**To match**
- Confirm the desired *domain mapping*: “refunds” vs “returns”.
- Ensure held-transaction surface matches:
  - update held transaction, convert to sale, cleanup.

---

## 8) Shifts + Cash movements

### `shift.service.js` (quantum-pos-app)
**Has**
- Shift lifecycle:
  - `openShift`, `closeShift`, plus `suspendShift`, `resumeShift`
- Cash drawer movements:
  - `recordDeposit`, `recordWithdrawal`, `recordPayout`
  - `getCashDrawerStatus`, `reconcileShift`, `logCashDrawerEvent`
- Linking sales/returns to shift:
  - `linkSaleToShift`, `linkReturnToShift`
- Query:
  - `getActiveShift(userId, storeId)`, `getShiftById`, `getAllShifts(filters)`

**pos-app status**
- Shift module exists, plus `cash_movements` module with `add_cash_movement`, `get_cash_movements`, `log_drawer_event`, `get_shift_summary`.
- Missing suspend/resume and some specialized status endpoints unless implemented elsewhere.

**To match**
- Add or map:
  - suspend/resume shifts (if required)
  - cash drawer status endpoint (if separate from shift summary)
  - linking helpers (or ensure existing transaction creation writes `shift_id`)

---

## 9) Payments

### `payment.service.js` (quantum-pos-app)
**Has**
- CRUD + cancel + reconcile
- “pending” view + summary + daily report
- supplier/customer/PO/expense payments
- payment number generation and balance updates

**pos-app status**
- Has `payments` module but likely fewer reporting endpoints.

**To match**
- Add reporting endpoints:
  - pending, summary, daily report, entity-specific payment queries.

---

## 10) Suppliers / Purchase Orders / Expenses / Credit Sales

### `supplier.service.js` (quantum-pos-app)
Includes: search, stats, balance, payments, code generation + codeExists, activate/deactivate.

### `purchase-order.service.js` (quantum-pos-app)
Includes: submit/approve/reject/cancel/receiveGoods + `generatePONumber`.

### `expense.service.js` (quantum-pos-app)
Includes: summary/breakdown/daily/monthly/yearly + approve/reject + count.

### `credit-sales.service.js` (quantum-pos-app)
Includes: aging/overdue reports, invoice/payment numbers, credit limit + availability checks.

**pos-app status**
- Has these modules, but the report-style endpoints may be missing depending on current Rust coverage.

**To match**
- Add the report endpoints + helper number generators where missing.

---

## 11) Analytics / Audit / Excel

### `analytics.service.js` (quantum-pos-app)
Likely includes dashboard and top-N reports (sales by period, top items/categories).

### `audit.service.js` (quantum-pos-app)
Rich audit helpers: login/logout, sale created/voided, stock adjustment, shift opened, etc.

### `excel-import.service.js` / `excel-export.service.js`
Separated responsibilities vs single `excel.js` in `pos-app`.

**pos-app status**
- Has `analytics.js`, `audit.js`, and `excel.js` wrappers; backend coverage varies.

**To match**
- Ensure the same “report set” exists (dashboard summary + time series + top lists).
- Extend audit helpers (or keep generic `log_action` style) to match specific events if desired.
- Split excel into import/export if you want exact structure, or keep combined but ensure parity of functions.

---

## Concrete “missing command wrappers” checklist (pos-app frontend)

Your `pos-app/src/commands/*` currently exposes mostly CRUD. If you want parity with `quantum-pos-app`, you will likely need to add new wrappers like:

- **departments**: `searchDepartments`, `getDepartmentsPaged`, `countDepartments`, `activateDepartment`, `deactivateDepartment`, `getDepartmentByCode`, `getDepartmentCategories`, `getGlobalDepartments`
- **categories**: `searchCategories`, `getCategoriesPaged`, `countCategories`, `getPosCategories`, `getSubcategories`, `getCategoryItems`, `activateCategory`, `deactivateCategory`, `assignCategoryDepartment`, `getCategoryByCode`
- **stores**: `getStoreByCode`, `getStoresByName`, `searchStores`, `countStores`, `storeCodeExists`, `getMainBranch`
- **auth**: `getActiveSessions`, `revokeSession`, `revokeOtherSessions`, `getSessionStats`
- plus reporting endpoints in payments/expenses/credit_sales if you need exact match

---

## Concrete “missing backend commands/models” checklist (pos-app Rust)

To truly match, you’ll need (in many cases) **schema changes + model changes**:

- **departments table**: add `department_code`, `parent_department_id`, `display_order`, `color`, `icon` (+ optional `created_by`, `updated_by`)
- **categories table**: add `category_code`, `parent_category_id`, `display_order`, `color`, `icon`, `image_url`, `is_visible_in_pos`, `requires_weighing`, `default_tax_rate`
- **add richer query DTOs**:
  - paged filters for departments/categories (page, limit, search, flags)
- **add additional RPC methods** in `src-tauri/src/http_server.rs` for all newly-exposed commands

---

## Notes about “exact same”

Because `pos-app` uses a **single RPC endpoint** and `quantum-pos-app` uses REST-ish routes, “exact same” can mean:

1) Same *capabilities* (recommended): implement the same operations, even if the RPC method names differ.
2) Same *method names + params* (strict): mirror service method names as RPC methods 1:1.

If you want strict parity, I can produce a second file that proposes the exact **RPC method naming** and **Rust DTO structs** to add so your frontend wrappers line up cleanly.

