# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Quantum POS** — a desktop Point of Sale system built with Tauri 2 (Rust backend) + React 19 (frontend) + PostgreSQL. The backend is fully implemented (~90 commands across 25 modules). The frontend is early-stage: setup wizard and login are done; the main POS UI is being built.

## Development Commands

All commands run from the repo root (`c:\Users\user\Desktop\pos-app`).

```bash
# Start dev server (Vite + Tauri hot-reload)
npm run tauri dev

# Build for production
npm run tauri build

# Frontend only (no Tauri window)
npm run dev

# Compile-time SQL check (requires pos_app DB to be running)
cd src-tauri && cargo check
```

**Database**: PostgreSQL must be running. Credentials in `src-tauri/.env`:
```
DATABASE_URL=postgres://quantum_user:quantum_password@localhost:5432/pos_app
```
Migrations run automatically on `db_connect`. To run them manually: `cd src-tauri && cargo sqlx migrate run`.

**Default admin login**: `admin` / `Admin@123`

## Architecture

### Two-Process Model + HTTP API
Tauri runs two processes:
- **Rust process** (`src-tauri/`) — owns the DB pool, JWT secrets, in-memory sessions, all business logic. Also runs an embedded **Axum HTTP server** on port 4000 (started via `tauri::async_runtime::spawn` in `setup()`).
- **WebView process** (`src/`) — React UI. All data calls go through **Axios** hitting `http://localhost:{port}/api/rpc` (server mode) or `http://{remoteIp}:{port}/api/rpc` (client mode).

**`invoke()` is only used for startup IPC**: `db_connect`, `get_api_port`, `get_local_ip`. All business logic (auth, stores, products, etc.) goes through the HTTP API.

### Server vs Client Mode

| | Server Mode | Client Mode |
|---|---|---|
| DB | Connects local PostgreSQL via `db_connect` invoke | None — server handles DB |
| API | `http://localhost:{apiPort}` | `http://{serverIp}:{apiPort}` |
| Setup | Enter DB credentials once, saved to localStorage | Enter server IP + port, health-checked |
| On relaunch | Auto-reconnects silently | Auto-connects if server reachable |

**Config persisted** in `localStorage` key `qpos_config`:
- Server: `{ mode:"server", host, port, username, password, database, apiPort, setupComplete:true }`
- Client: `{ mode:"client", host, apiPort, setupComplete:true }`

### HTTP API (`src-tauri/src/http_server.rs`)

Single endpoint: `POST /api/rpc` with body `{ "method": "command_name", "params": { ...args } }`. Token passed in `Authorization: Bearer` header.

Health check: `GET /health` → `{ "status": "ok", "version": "..." }`

**Inner function pattern** for commands exposed over HTTP:
```rust
// Thin Tauri wrapper (for invoke() compatibility)
#[tauri::command]
pub async fn login(state: State<'_, AppState>, payload: LoginRequest) -> AppResult<TokenPair> {
    login_inner(&state, payload).await
}

// Reusable inner fn called by both Tauri command and HTTP dispatcher
pub(crate) async fn login_inner(state: &AppState, payload: LoginRequest) -> AppResult<TokenPair> { ... }
```

Commands currently exposed via HTTP: `login`, `logout`, `refresh_token`, `change_password`, `get_stores`, `get_store`. Add more per screen by extracting `*_inner` functions.

**AppState** (`state.rs`) now derives `Clone` (cheap — all fields are `Arc<>`), and holds `api_port: Arc<AtomicU16>` for the actual bound port.

### Rust Backend (`src-tauri/src/`)

**Entry point**: `lib.rs` — registers all 90+ commands via `generate_handler![]` and initializes `AppState`.

**AppState** (`state.rs`) holds three things shared across all commands:
- `db: Arc<Mutex<Option<PgPool>>>` — the pool starts as `None` until `db_connect` is called
- `jwt_secret: Arc<String>` — generated at startup
- `sessions: Arc<RwLock<HashMap<String, SessionData>>>` — in-memory session store

**Pattern for every command**:
```rust
#[tauri::command]
pub async fn my_command(
    state: State<'_, AppState>,
    token: String,
    payload: MyDto,
) -> AppResult<MyModel> {
    let claims = guard_permission(&state, &token, "resource.action").await?;
    let pool = state.pool().await?;
    // ... sqlx queries ...
    Ok(result)
}
```

**`guard_permission`** (in `commands/auth.rs`) decodes the JWT, validates the session, then checks if the user's role has the required permission slug. Global roles (`is_global = true`) bypass permission checks.

**Error handling** (`error.rs`): All commands return `AppResult<T>`. Errors serialize to strings sent to the frontend. Never use `.unwrap()` — use `?` to propagate `AppError`.

**Financial math**: Always use `rust_decimal::Decimal`, never `f32`/`f64`, for prices, quantities, and totals. DTOs receive `f64` from JSON and convert immediately via `Decimal::try_from()`.

### SQLx Patterns

Compile-time query checking is on. Important gotchas:
- **Aliases with `!`**: `AS "col!"` marks a nullable column as NOT NULL. Columns accessed via LEFT JOIN are nullable. Don't call `.flatten()` on a `fetch_optional` result for NOT NULL columns.
- **NEXTVAL expressions**: `sqlx::query_scalar!("SELECT 'PRE-' || NEXTVAL(...)::text")` returns `Option<String>`. Chain `.ok().flatten().unwrap_or_else(|| fallback)`.
- **ORDER BY with aliases**: SQLx macros don't allow `ORDER BY alias_name` when the alias uses `"name!"` notation. Use ordinal position (`ORDER BY 3 DESC`) or repeat the expression.
- **`SELECT TRUE` with `fetch_optional`**: Returns `Option<Option<bool>>`, not `Option<bool>`. Don't annotate the type — let it infer.
- **Timestamp parameters**: Pass `Option<&str>` with a `$N::text::timestamptz` cast in the SQL so SQLx infers `text` not `timestamptz` for the Rust type.

### Database Schema

22 migrations in `src-tauri/migrations/`. Key tables:
- `roles`, `permissions`, `role_permissions` — RBAC (5 built-in roles: super_admin, admin, manager, cashier, stock_keeper)
- `stores` — multi-tenant root; most tables have `store_id`
- `users` — linked to one role and optionally one store; `is_global` bypasses store scoping
- `items`, `item_settings`, `item_stock` — product catalog split into three tables
- `transactions`, `transaction_items` — POS sales
- `shifts` — cashier sessions; cash movements require an open shift
- `price_lists`, `price_list_items`, `price_changes` — price management with approval workflow
- Sequences: `transaction_ref_seq`, `po_ref_seq`, `return_ref_seq` — used for reference numbers

### React Frontend (`src/`)

**App.jsx startup flow** (8 stages):
1. `isChecking` → Splash
2. `!config` → SetupWizard (first run or reset)
3. `connectFailed` → ConnectionError (retry / change server)
4. `!apiReady || !isInitialized` → Splash (connecting / restoring session)
5. `!user` → LoginScreen
6. `!isBranchInitialized` → Splash
7. `needsPicker` → StorePicker
8. All clear → RouterProvider (main POS)

On startup, `App.jsx` reads `localStorage["qpos_config"]`. **Server mode**: calls `invoke("db_connect")` then `invoke("get_api_port")` to get the Axum port, sets Axios base URL to `http://localhost:{port}`. **Client mode**: sets Axios base URL to `http://{host}:{apiPort}`, health-checks `/health`. If connection fails → `ConnectionError` screen (Try Again / Change Server).

**`setWindowBg(hex)`** in `App.jsx` syncs the native window background color with the current screen's CSS background. Update the `colors` map there when adding screens with different backgrounds.

**Styling**: Tailwind CSS v4 (`@tailwindcss/vite`) + shadcn/ui + custom CSS. Design tokens live in `src/styles/globals.css` (imported first in `main.jsx`). The setup wizard screens use `src/App.css` with BEM class names (dark purple/green theme — separate from Tailwind).

**State management**: Zustand — stores go in `src/stores/`.

**HTTP client**: Axios (`src/lib/apiClient.js`) — single instance, base URL set at startup. Use `rpc(method, params)` for all API calls. Token sent via `Authorization: Bearer` header (set automatically after login via `setAuthToken(token)`).

**Data fetching**: React Query (`@tanstack/react-query`) for server state. `QueryClientProvider` wraps the app in `main.jsx`.

All files use `.js` / `.jsx` — no TypeScript.

#### RPC Call Convention

```js
import { rpc } from "@/lib/apiClient";

// Params are the direct struct fields (not wrapped):
rpc("login",           { username, password })
rpc("refresh_token",   { refresh_token })
rpc("change_password", { current_password, new_password })
rpc("get_stores",      { is_active: true })
rpc("get_store",       { id })
rpc("logout")          // no params needed; token in header
```

#### Installed Frontend Packages

| Package | Purpose |
|---|---|
| `axios` | HTTP client — all API calls via `rpc()` in `src/lib/apiClient.js` |
| `@tanstack/react-query` | Server state management and caching |
| `tailwindcss` + `@tailwindcss/vite` | Tailwind v4 via Vite plugin |
| `class-variance-authority` | Component variant definitions (`cva()`) |
| `clsx` + `tailwind-merge` | Conditional class merging via `cn()` in `src/lib/utils.js` |
| `lucide-react` | Icons — always import individually |
| `zustand` | Global state (session, cart, shift, UI) |
| `sonner` | Toast notifications |
| `@radix-ui/react-*` | Headless primitives underlying all shadcn components |

#### Color Token System

All tokens are CSS variables in `src/styles/globals.css` as raw HSL values (no `hsl()` wrapper). `tailwind.config.js` maps them to Tailwind utility classes. **Never hardcode hex or rgb in components.**

| Token class | Hex | Use it for |
|---|---|---|
| `bg-background` | `#09090b` | Page background |
| `bg-card` | `#111113` | Panels, sidebars, modals |
| `bg-muted` | `#27272a` | Inactive tabs, disabled states |
| `bg-primary` | `#3b82f6` | Active tabs, primary buttons, focus rings |
| `bg-success` | `#16a34a` | **Charge/Pay button ONLY**, success states |
| `bg-destructive` | `#ef4444` | Delete, refund, void, cancel |
| `bg-warning` | `#f59e0b` | Low stock, unpaid, pending badges |
| `text-foreground` | `#fafafa` | Primary text |
| `text-muted-foreground` | `#a1a1aa` | Secondary/helper text only |
| `border-border` | `#27272a` | All borders and dividers |

**Rules:**
- The Charge button is **always** `variant="success"` — never blue (`variant="default"`)
- Use opacity variants (`bg-primary/15`) for decorative icon backgrounds
- `text-muted-foreground` is for secondary text only — never for prices or key data

#### shadcn Components (all in `src/components/ui/`, all `.jsx`)

- **`button.jsx`** — extra variants: `success` (charge button), `outline-destructive`; extra sizes: `xl` (charge button), `xs`
- **`badge.jsx`** — extra variants: `success`, `warning`, `low-stock`, `hot`, `new`
- **`input.jsx`** — `ring-1` focus ring override
- `card.jsx`, `dialog.jsx`, `scroll-area.jsx`, `separator.jsx`, `select.jsx`, `dropdown-menu.jsx`, `tooltip.jsx`

#### Standard POS Tap Interaction Pattern

Every tappable card needs these classes for visual feedback:
```
transition-all duration-150 hover:bg-muted active:scale-[0.98] cursor-pointer
```

#### Planned Directory Structure

```
src/
├── commands/               # Thin invoke() wrappers — one file per backend module
│   ├── app.js              # db_connect, db_status, app_version, app_name, get_local_ip
│   ├── auth.js             # login, logout, verify_session, refresh_token, change_password,
│   │                       #   request_password_reset, reset_password
│   ├── users.js            # get_users, get_user, create_user, update_user, delete_user, get_roles
│   ├── stores.js           # get_stores, get_store, create_store, update_store
│   ├── departments.js      # get_departments, get_department, create/update/delete_department
│   ├── categories.js       # get_categories, get_category, create/update/delete_category
│   ├── items.js            # get_items, get_item, create/update/delete_item,
│   │                       #   adjust_stock, get_item_history
│   ├── inventory.js        # get_inventory, get_low_stock, start_stock_count, get_stock_counts
│   ├── transactions.js     # create_transaction, get_transactions, get_transaction,
│   │                       #   void_transaction, hold_transaction,
│   │                       #   get_held_transactions, delete_held_transaction
│   ├── customers.js        # get_customers, get_customer, create/update/delete_customer
│   ├── suppliers.js        # get_suppliers, get_supplier, create/update/delete_supplier
│   ├── purchase_orders.js  # get_purchase_orders, get_purchase_order,
│   │                       #   create/receive/cancel_purchase_order
│   ├── payments.js         # get_payments
│   ├── shifts.js           # open_shift, close_shift, get_active_shift, get_shifts, get_shift
│   ├── credit_sales.js     # get_credit_sales, get_credit_sale,
│   │                       #   record_credit_payment, get_credit_payments
│   ├── expenses.js         # get_expenses, get_expense, create_expense, approve_expense
│   ├── returns.js          # create_return, get_returns, get_return
│   ├── receipts.js         # get_receipt, generate_receipt_html
│   ├── cash_movements.js   # add_cash_movement, get_cash_movements,
│   │                       #   log_drawer_event, get_shift_summary
│   ├── price_management.js # get_price_lists, create_price_list, add_price_list_item,
│   │                       #   get_price_list_items, request_price_change,
│   │                       #   approve_price_change, get_price_changes
│   ├── tax.js              # get_tax_categories, create_tax_category, update_tax_category
│   ├── excel.js            # import_items, import_customers, export_items, export_transactions
│   └── audit.js            # get_audit_logs, log_action
│
├── features/               # Domain UI modules — each owns its components and local logic
│   ├── setup/              # DB connection wizard (ModeSelector, ServerSetup, ClientSetup)
│   ├── pos/                # Cashier screen: item search, cart, payment, receipt print
│   ├── products/           # Item catalog: list, create/edit form, categories, departments
│   ├── inventory/          # Stock view, low-stock alerts, stock count workflow
│   ├── customers/          # Customer list, detail, credit balance display
│   ├── suppliers/          # Supplier list and detail
│   ├── purchase_orders/    # PO list, create PO, receive goods
│   ├── transactions/       # Transaction history, void, initiate return
│   ├── returns/            # Return list and detail (links back from transactions)
│   ├── shifts/             # Open/close shift, cash movements log, shift summary
│   ├── credit_sales/       # Credit sale list, record payment modal
│   ├── expenses/           # Expense list, create form, approve action
│   ├── analytics/          # Dashboard: sales summary, revenue chart, top items/categories
│   ├── price_management/   # Price lists, price change requests and approvals
│   ├── users/              # User management (admin/super_admin only)
│   └── settings/           # Store config, tax categories, receipt settings
│
├── pages/                  # Thin route composers — one per top-level nav destination
│   ├── PosPage.jsx
│   ├── ProductsPage.jsx
│   ├── InventoryPage.jsx
│   ├── CustomersPage.jsx
│   ├── SuppliersPage.jsx
│   ├── PurchaseOrdersPage.jsx
│   ├── TransactionsPage.jsx
│   ├── ReturnsPage.jsx
│   ├── ShiftsPage.jsx
│   ├── CreditSalesPage.jsx
│   ├── ExpensesPage.jsx
│   ├── AnalyticsPage.jsx
│   ├── PriceManagementPage.jsx
│   ├── UsersPage.jsx
│   └── SettingsPage.jsx
│
├── stores/                 # Zustand global state
│   ├── sessionStore.js     # token, user (id, role, first_name), store_id, is_global
│   ├── shiftStore.js       # active shift id, status, opened_at — synced on login
│   ├── cartStore.js        # POS cart: line items, applied discount, held transactions list
│   └── uiStore.js          # sidebar collapsed state, active modal, toast/notification queue
│
├── hooks/                  # App-wide custom React hooks
│   ├── useSession.js       # reads sessionStore; exposes user, token, logout()
│   ├── useShift.js         # reads shiftStore; exposes activeShift, openShift(), closeShift()
│   └── usePermission.js    # returns true if current user's role has a given permission slug
│
├── components/             # Shared UI components used across multiple features
│   ├── layout/             # AppShell, Sidebar, TopBar, NavItem
│   └── ui/                 # Shared atoms: Modal, Table, Badge, Spinner, EmptyState, Confirm
│
├── lib/                    # Pure utilities — no React, no Tauri imports
│   ├── format.js           # formatCurrency (NGN ₦), formatDate, formatRef
│   └── constants.js        # PAYMENT_METHODS, ROLES, STATUS values, DEFAULT_TAX_RATE
│
├── App.jsx                 # Root: null→setup→login→main shell with sidebar
├── App.css                 # Global stylesheet (single file, CSS custom properties)
└── main.jsx                # ReactDOM.createRoot entry point
```

#### Layer Responsibilities

- **`commands/`** — Every `rpc()` call lives here. Functions accept payload, call `rpc()`, and return the raw result. No UI logic. Centralizing RPC calls makes renames easy and gives one place to see every backend call.
- **`features/`** — Self-contained domain modules. Each sub-directory has its own components and **a local data hook** (e.g. `useDepartments.js`). Features import from `commands/`, `stores/`, `hooks/`, and `components/`, but **never from other features** (prevents cross-feature coupling).
- **`pages/`** — Thin composers: import one feature and set page-level props (title, window background color). They receive `session` via Zustand, not props.
- **`stores/`** — Zustand stores for **synchronous, cross-session global UI state**: session tokens, active cart, open shift. **Not for server data** — use React Query for that.
- **`hooks/`** — App-wide custom hooks. Encapsulate common multi-step sequences or repeated store reads. Keeps feature components clean.
- **`components/`** — Presentational only — no business logic, no direct `rpc()` calls.
- **`lib/`** — Pure JS utilities safe to import anywhere.

#### Feature Data Hooks (e.g. `features/departments/useDepartments.js`)

Each feature module that fetches data should expose a **data hook** alongside its components. This hook:
- Wraps `useQuery` + `useMutation` from React Query
- Resolves `storeId` from `useBranchStore` automatically (accepts an optional override)
- Returns stable `departments`, `isLoading`, `error`, `create`, `update`, `remove`, `getDeptById`
- Is importable by **any other feature** that needs the same data (e.g. a product form needing a department picker)

```js
// Any feature can consume department data — shares the same React Query cache:
import { useDepartments } from "@/features/departments/useDepartments";

const { activeDepartments, isLoading } = useDepartments();
```

**Why React Query in the hook instead of a Zustand store?**
Departments (and similar catalog data) are *server state*. React Query caches them by query key — all components using `useDepartments()` with the same `storeId` share one in-memory cache with automatic stale/refetch handling. A Zustand store would duplicate this caching and require manual invalidation logic. Zustand is reserved for synchronous global UI state (`sessionStore`, `shiftStore`, `cartStore`).

#### Key Frontend Rules

- **Token**: always read from `sessionStore.token` — the Axios client sends it automatically via the `Authorization` header after `setAuthToken()` is called on login.
- **Financial values**: backend returns `Decimal` as strings (`"1500.0000"`). Use `parseFloat()` to convert, then `formatCurrency()` from `lib/format.js` for display. Never do arithmetic on raw strings.
- **Permissions**: call `usePermission("resource.action")` before rendering admin controls. Five built-in roles: `super_admin`, `admin`, `manager`, `cashier`, `stock_keeper`. Global roles (`is_global = true`) bypass all permission checks on the backend.
- **Shift requirement**: `add_cash_movement`, `create_transaction`, and `close_shift` all require an active open shift. Check `shiftStore.activeShift` before showing those actions.
- **setup/ feature**: existing screens (`ModeSelector`, `SetupWizard`, `ServerSetup`, `ClientSetup`) move from `src/screens/setup/` to `src/features/setup/` when the full structure is built.

#### Store Initialization Chain

Store-to-store initialization is orchestrated **inside async store actions**, never from React `useEffect`. The chain is:

```
auth.store.login()  ──▶  useBranchStore.getState().initForUser(user)
or                              │
auth.store.restoreSession()     └──▶  useShiftStore.getState().initForStore(storeId)
```

Calling `initForUser` from `App.jsx` `useEffect` was the **root cause** of the `forceStoreRerender` crash. The first line of `initForUser` is a synchronous `set()`. When called from a `useEffect`, that `set()` fires during React's commit phase. `useSyncExternalStore` (which Zustand uses internally) calls `forceStoreRerender` to prevent tearing — but React is already committing, so it enters an infinite re-render loop. Calling from a store action (already in the microtask queue after an `await`) avoids the commit phase entirely.

`branch.store.setActiveStore` (called from the StorePicker) also calls `useShiftStore.getState().initForStore()` so the shift is always in sync when the user switches stores.

#### ⚠️ Zustand Selector Anti-Pattern (Infinite Loop)

NEVER return a new object or array literal from a Zustand selector — it creates a new reference every render, Zustand sees it as changed, schedules a re-render, and loops forever (`Maximum update depth exceeded`).

```js
// ❌ WRONG — `?? []` creates a new [] reference on every render:
const permissions = useAuthStore((s) => s.user?.permissions ?? []);

// ✅ CORRECT — read the raw value; handle undefined outside the selector:
const permissions = useAuthStore((s) => s.user?.permissions);
const hasPerm = Array.isArray(permissions) && permissions.includes(slug);

// ✅ ALSO CORRECT — return a primitive, never an object/array:
const storeId    = useBranchStore((s) => s.activeStore?.id);   // number
const isGlobal   = useAuthStore((s) => s.user?.is_global ?? false); // bool
```

Same rule applies to `useMemo`: `data ?? []` inside a component body creates a new array on every render. Memoize it:

```js
// ❌ Inline — new [] each render:
const rows = data ?? [];

// ✅ Stable reference:
const rows = useMemo(() => data ?? [], [data]);
```

## Adding a New Command

1. Add the model to `src-tauri/src/models/<module>.rs`
2. Add the command function to `src-tauri/src/commands/<module>.rs`
3. Register it in `src-tauri/src/lib.rs` inside `generate_handler![...]`
4. Call it from the frontend with `invoke("command_name", { arg1, arg2 })`

## Migration Notes

SQLx tracks a SHA checksum per migration. **Never edit an applied migration** — create a new one instead. If a migration file is accidentally modified, the app will error with "migration N was previously applied but has been modified". Fix by reverting the file to its original content and adding a new migration for the change.

---

## Build Roadmap

Work top-to-bottom. Each phase depends on the one above. Do not start Phase N+1 until every item in Phase N has a ✅.

### Phase 0 — Foundation (invisible infrastructure)

Every feature screen depends on these. Build and test them before touching any feature page.

- [x] `lib/format.js` — formatCurrency (₦), formatDate, formatDateTime, formatDuration, formatRef, formatStatus
- [x] `lib/constants.js` — ROLES, PAYMENT_METHODS, TRANSACTION_STATUS, SHIFT_STATUS, PO_STATUS, EXPENSE_STATUS, PERMISSIONS, PAGE_SIZE
- [x] `stores/shift.store.js` — activeShift, openShift, closeShift, initForStore, isShiftOpen
- [x] `stores/cart.store.js` — cartItems, addItem, removeItem, setQuantity, clearCart, holdCurrentCart, getTotals
- [x] `hooks/usePermission.js` — usePermission(slug), usePermissions([slugs]), useAnyPermission([slugs])
- [x] `hooks/useShift.js` — wraps shiftStore + branchStore into ergonomic openShift/closeShift actions
- [x] `stores/ui.store.js` — sidebarOpen, activeModal (string|null), openModal(name), closeModal(), openSheet/closeSheet
- [x] `commands/` — 24 thin `rpc()` wrapper files (one per backend module)
- [x] Wire `shift.store.initForStore` into `App.jsx` after login + branch selection (alongside `initForUser`)

#### commands/ files to create

Each file exports named async functions that call `rpc("command_name", params)`. No UI logic.

```
commands/app.js            db_connect, get_api_port, get_local_ip, app_version
commands/auth.js           login, logout, refresh_token, change_password
commands/users.js          get_users, get_user, create_user, update_user, delete_user, get_roles
commands/stores.js         get_stores, get_store, create_store, update_store
commands/departments.js    get_departments, create_department, update_department, delete_department
commands/categories.js     get_categories, create_category, update_category, delete_category
commands/items.js          get_items, get_item, create_item, update_item, delete_item, adjust_stock, get_item_history
commands/inventory.js      get_inventory, get_low_stock, start_stock_count, get_stock_counts
commands/transactions.js   create_transaction, get_transactions, get_transaction, void_transaction,
                           hold_transaction, get_held_transactions, delete_held_transaction
commands/customers.js      get_customers, get_customer, create_customer, update_customer, delete_customer
commands/suppliers.js      get_suppliers, get_supplier, create_supplier, update_supplier, delete_supplier
commands/purchase_orders.js get_purchase_orders, get_purchase_order, create_purchase_order,
                            receive_purchase_order, cancel_purchase_order
commands/payments.js       get_payments
commands/shifts.js         open_shift, close_shift, get_active_shift, get_shifts, get_shift
commands/credit_sales.js   get_credit_sales, get_credit_sale, record_credit_payment, get_credit_payments
commands/expenses.js       get_expenses, get_expense, create_expense, approve_expense
commands/returns.js        create_return, get_returns, get_return
commands/receipts.js       get_receipt, generate_receipt_html
commands/cash_movements.js add_cash_movement, get_cash_movements, log_drawer_event, get_shift_summary
commands/price_management.js get_price_lists, create_price_list, add_price_list_item,
                              get_price_list_items, request_price_change, approve_price_change, get_price_changes
commands/tax.js            get_tax_categories, create_tax_category, update_tax_category
commands/excel.js          import_items, import_customers, export_items, export_transactions
commands/audit.js          get_audit_logs
commands/analytics.js      get_dashboard_summary, get_sales_by_period, get_top_items, get_top_categories
```

---

### Phase 1 — Shared UI Components

Built once, used everywhere. Keep these presentational — no `rpc()` calls.

- [x] `components/shared/PageHeader.jsx` — title, description, back link, action slot, sub-row slot for filters/tabs
- [x] `components/shared/DataTable.jsx` — columns config, client sort, skeleton shimmer, pagination bar, row click, empty state
- [x] `components/shared/EmptyState.jsx` — icon + heading + description + CTA, compact variant
- [x] `components/shared/ConfirmDialog.jsx` — destructive/warning variants, accent strip, async confirm, loading state
- [x] `components/shared/StatusBadge.jsx` — status dot + label, covers all domain status values
- [x] `components/shared/CurrencyDisplay.jsx` — tabular-nums mono, size/color variants, negative value auto-color
- [x] `components/shared/Spinner.jsx` — page / inline / overlay variants, glow ring on page variant
- [x] `components/app-sidebar.jsx` — role-based nav filtering + shift status banner ✅

---

### Phase 2 — Shifts ⚠️ MUST COMPLETE BEFORE POS

Cashiers must open a shift before `create_transaction` or `add_cash_movement` will succeed.

- [x] `features/shifts/OpenShiftModal.jsx` — opening float, notes, success-variant submit
- [x] `features/shifts/CloseShiftModal.jsx` — live summary fetch, expected cash, variance indicator (green/red), closing float
- [x] `features/shifts/CashMovementModal.jsx` — 3-way type toggle (Cash In / Cash Out / Float In), dynamic accent strip
- [x] `features/shifts/ShiftSummaryCards.jsx` — 4 KPI tiles: Sales, Transactions, Expected Cash, Live Duration
- [x] `features/shifts/CashMovementsList.jsx` — timeline with colored dots, type badges, amounts, timestamps
- [x] `features/shifts/ShiftHistoryTable.jsx` — paginated via DataTable, all shift fields
- [x] `pages/ShiftsPage.jsx` — no-shift CTA state, active shift panel with green accent strip, wired to router

---

### Phase 3 — Point of Sale (core revenue screen)

The highest-priority customer-facing feature.

- [ ] `features/pos/ItemSearchPanel.jsx` — barcode scan input + keyword search + grid/list results
- [ ] `features/pos/CartPanel.jsx` — line items, quantity controls, line discounts, totals
- [ ] `features/pos/CartItem.jsx` — single line item row with edit/remove
- [ ] `features/pos/CustomerSearchBar.jsx` — attach a customer to the sale
- [ ] `features/pos/PaymentModal.jsx` — payment method selector, amount input, change calculation
- [ ] `features/pos/ReceiptModal.jsx` — post-payment receipt preview + print
- [ ] `features/pos/HoldDrawer.jsx` — hold current cart / recall held transactions
- [ ] `pages/PosPage.jsx` — assembles the two-column POS layout

---

### Phase 4 — Transactions & Returns

- [ ] `features/transactions/TransactionFilters.jsx` — date range, status, cashier filters
- [ ] `features/transactions/TransactionTable.jsx`
- [ ] `features/transactions/TransactionDetailSheet.jsx` — slide-out with full receipt + void/refund actions
- [ ] `features/transactions/VoidModal.jsx`
- [ ] `pages/TransactionsPage.jsx`
- [ ] `features/returns/ReturnTable.jsx`
- [ ] `features/returns/InitiateReturnModal.jsx` — select items from transaction, quantity, reason
- [ ] `features/returns/ReturnDetailSheet.jsx`
- [ ] `pages/ReturnsPage.jsx`

---

### Phase 5 — Product Catalog

- [ ] `features/products/ItemTable.jsx` — with stock level badges
- [ ] `features/products/ItemForm.jsx` — create/edit (name, SKU, price, tax category, department, category, reorder level)
- [ ] `features/products/CategoryManager.jsx` — inline CRUD
- [ ] `features/products/DepartmentManager.jsx` — inline CRUD
- [ ] `pages/ProductsPage.jsx`
- [ ] `features/inventory/StockTable.jsx` — current stock per item per store
- [ ] `features/inventory/AdjustStockModal.jsx`
- [ ] `features/inventory/LowStockAlert.jsx` — banner when items below reorder level
- [ ] `features/inventory/StockCountFlow.jsx` — start count → enter actuals → submit
- [ ] `pages/InventoryPage.jsx`

---

### Phase 6 — Customers & Credit

- [ ] `features/customers/CustomerTable.jsx`
- [ ] `features/customers/CustomerForm.jsx` — name, phone, email, address, credit limit
- [ ] `features/customers/CustomerDetailSheet.jsx` — profile + credit history
- [ ] `pages/CustomersPage.jsx`
- [ ] `features/credit_sales/CreditSaleTable.jsx` — with status badges (outstanding/partial/paid)
- [ ] `features/credit_sales/RecordPaymentModal.jsx`
- [ ] `pages/CreditSalesPage.jsx`

---

### Phase 7 — Procurement

- [ ] `features/suppliers/SupplierTable.jsx`
- [ ] `features/suppliers/SupplierForm.jsx`
- [ ] `pages/SuppliersPage.jsx`
- [ ] `features/purchase_orders/POTable.jsx`
- [ ] `features/purchase_orders/CreatePOForm.jsx` — supplier, items + quantities
- [ ] `features/purchase_orders/ReceiveGoodsModal.jsx` — mark items received, update stock
- [ ] `pages/PurchaseOrdersPage.jsx`

---

### Phase 8 — Finance

- [ ] `features/expenses/ExpenseTable.jsx`
- [ ] `features/expenses/CreateExpenseForm.jsx`
- [ ] `features/expenses/ApproveExpenseModal.jsx`
- [ ] `pages/ExpensesPage.jsx`
- [ ] `features/analytics/SalesSummaryCards.jsx` — today/week/month KPI cards
- [ ] `features/analytics/RevenueChart.jsx` — Recharts line/bar chart
- [ ] `features/analytics/TopItemsTable.jsx`
- [ ] `features/analytics/TopCategoriesChart.jsx`
- [ ] `pages/AnalyticsPage.jsx`
- [ ] `features/price_management/PriceListTable.jsx`
- [ ] `features/price_management/PriceChangeRequestModal.jsx`
- [ ] `features/price_management/ApproveChangesPanel.jsx`
- [ ] `pages/PriceManagementPage.jsx`

---

### Phase 9 — Admin

- [ ] `features/users/UserTable.jsx`
- [ ] `features/users/UserForm.jsx` — name, username, role, store assignment
- [ ] `pages/UsersPage.jsx`
- [ ] `features/settings/StoreConfigForm.jsx`
- [ ] `features/settings/TaxCategoryManager.jsx`
- [ ] `features/settings/ReceiptSettingsForm.jsx`
- [ ] `pages/SettingsPage.jsx`

---

## Standard Management Page Design Pattern

> **Apply this pattern to every list/management page** (Departments, Categories, Products, Customers, Suppliers, Users, etc.).
> Reference implementation: `src/features/categories/CategoriesPanel.jsx` + `src/pages/ShiftsPage.jsx`

### File checklist for a new management page

```
src/commands/widgets.js             ← rpc() wrappers, one file per domain
src/features/widgets/
  useWidgets.js                     ← React Query data hook + all mutations
  WidgetsPanel.jsx                  ← all UI: header, stats, table, dialogs
src/pages/WidgetsPage.jsx           ← thin composer (6 lines)
src/router.jsx                      ← add route entry
src-tauri/src/commands/widgets.rs   ← _inner fns + hard_delete
src-tauri/src/http_server.rs        ← register every method in dispatch()
src-tauri/src/lib.rs                ← register hard_delete in generate_handler![]
```

### 1. Page layout shell

Every page wraps in this shell (matches `ShiftsPage`):

```jsx
// pages/WidgetsPage.jsx
export default function WidgetsPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <WidgetsPanel />
    </div>
  );
}

// Inside WidgetsPanel — outer structure
return (
  <>
    <PageHeader title="..." description="..." action={<Button>New Widget</Button>} />
    <div className="flex-1 overflow-auto">
      <div className="mx-auto max-w-5xl px-6 py-5 space-y-5">
        {/* stats row */}
        {/* section(s) */}
        {/* legend */}
      </div>
    </div>
    {/* dialogs */}
  </>
);
```

### 2. Section wrapper (copy verbatim)

```jsx
function Section({ title, action, children, className }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card overflow-hidden", className)}>
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/20">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        {action && <div className="flex items-center gap-2">{action}</div>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}
```

### 3. KPI stat cards row

Always 4 cards directly above the main table. Pick accent colours by meaning:

```jsx
// accent options: "primary" | "success" | "warning" | "muted" | "default"
function StatCard({ label, value, sub, accent = "default" }) {
  const ring = {
    default: "border-border/60   bg-card",
    primary: "border-primary/25  bg-primary/[0.06]",
    success: "border-success/25  bg-success/[0.06]",
    warning: "border-warning/25  bg-warning/[0.06]",
    muted:   "border-border/60   bg-muted/30",
  }[accent];
  const val = {
    default: "text-foreground",
    primary: "text-primary",
    success: "text-success",
    warning: "text-warning",
    muted:   "text-muted-foreground",
  }[accent];
  return (
    <div className={cn("flex flex-col gap-1.5 rounded-xl border px-4 py-3.5", ring)}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("text-2xl font-bold tabular-nums leading-none", val)}>{value}</span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

// Usage — always 4 columns:
<div className="grid grid-cols-4 gap-3">
  <StatCard label="Total"    value={items.length}        sub="in this store"     accent="primary" />
  <StatCard label="Active"   value={activeList.length}   sub="shown in forms"    accent="success" />
  <StatCard label="Inactive" value={inactiveList.length} sub="hidden from forms" accent={inactiveList.length > 0 ? "warning" : "muted"} />
  <StatCard label="Other"    value={otherCount}          sub="context text"      accent="default" />
</div>
```

### 4. Status tab filter (All / Active / Inactive)

```jsx
const STATUS_TABS = [
  { key: "all",      label: "All"      },
  { key: "active",   label: "Active"   },
  { key: "inactive", label: "Inactive" },
];

function StatusTabs({ active, onChange, counts }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-1 border border-border/60">
      {STATUS_TABS.map((tab) => (
        <button key={tab.key} onClick={() => onChange(tab.key)}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold transition-all duration-150",
            active === tab.key
              ? "bg-card text-foreground shadow-sm border border-border/60"
              : "text-muted-foreground hover:text-foreground",
          )}>
          {tab.label}
          <span className={cn(
            "flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums",
            active === tab.key ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
          )}>
            {counts[tab.key]}
          </span>
        </button>
      ))}
    </div>
  );
}
```

### 5. Three row actions — Edit / Toggle / Hard-delete

Every management table has exactly these three icon buttons per row:

```jsx
// In the actions column render fn:
<div className="flex items-center justify-end gap-1">
  {/* Edit — always pencil, muted colour */}
  <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit"
    onClick={(e) => { e.stopPropagation(); openEdit(row); }}>
    <Edit3 className="h-3.5 w-3.5 text-muted-foreground" />
  </Button>

  {/* Toggle active state — colour signals direction */}
  <Button variant="ghost" size="icon" className="h-7 w-7"
    title={row.is_active ? "Deactivate" : "Activate"}
    onClick={(e) => { e.stopPropagation(); openToggle(row); }}>
    {row.is_active
      ? <PowerOff className="h-3.5 w-3.5 text-warning" />   /* amber = danger */
      : <Power    className="h-3.5 w-3.5 text-success" />}  /* green = safe */
  </Button>

  {/* Hard delete — always red trash */}
  <Button variant="ghost" size="icon" className="h-7 w-7" title="Delete permanently"
    onClick={(e) => { e.stopPropagation(); openHardDelete(row); }}>
    <Trash2 className="h-3.5 w-3.5 text-destructive" />
  </Button>
</div>
```

Inactive rows render their name with strikethrough:
```jsx
<span className={cn(
  "text-xs font-semibold",
  row.is_active ? "text-foreground" : "text-muted-foreground line-through decoration-muted-foreground/40"
)}>
  {row.name}
</span>
```

### 6. Three standard dialogs

#### Form dialog (create + edit, same component)

```
max-w-md  ·  coloured top bar (bg-primary for create, bg-primary for edit)
Icon header (10×10 icon box with primary/10 bg + primary/25 border)
DialogTitle + DialogDescription
form fields → Cancel / Save buttons
```

Top-bar colour convention:
- Create / Edit  → `bg-primary`
- Activate       → `bg-success`
- Deactivate     → `bg-warning`
- Hard delete    → `bg-destructive`

#### Toggle status dialog

```jsx
// Context-aware: colour + icon + copy all flip based on isActivating
<div className={cn("h-[3px] w-full", isActivating ? "bg-success" : "bg-warning")} />
// Icon box:
<div className={cn(
  "flex h-9 w-9 items-center justify-center rounded-lg border",
  isActivating ? "border-success/25 bg-success/10" : "border-warning/25 bg-warning/10",
)}>
  {isActivating ? <Power className="text-success" /> : <PowerOff className="text-warning" />}
</div>
// Confirm button:
<Button className={cn("flex-1 text-white",
  isActivating ? "bg-success hover:bg-success/90" : "bg-warning/90 hover:bg-warning"
)}>
  {isActivating ? "Activate" : "Deactivate"}
</Button>
```

#### Hard-delete dialog (type-to-confirm)

```jsx
// Always max-w-sm · bg-destructive top bar
// Warning banner:
<div className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2.5">
  <AlertTriangle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
  <p className="text-[11px] text-destructive leading-relaxed">
    This permanently removes <span className="font-bold">{item?.name}</span> ...
    This <span className="font-bold">cannot be undone</span>.
  </p>
</div>
// Type-to-confirm input:
<p className="text-[11px] text-muted-foreground mb-1.5">
  Type <span className="font-mono font-semibold text-foreground">{item?.name}</span> to confirm:
</p>
<Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
// Confirm button disabled until name matches (case-insensitive):
const nameMatches = confirmText.trim().toLowerCase() === item?.name?.toLowerCase();
<Button variant="destructive" disabled={!nameMatches}>Delete Permanently</Button>
```

### 7. React Query data hook pattern

```js
// features/widgets/useWidgets.js
export function useWidgets(storeIdOverride) {
  const qc            = useQueryClient();
  const branchStoreId = useBranchStore((s) => s.activeStore?.id); // read primitive — no new ref
  const storeId       = storeIdOverride ?? branchStoreId;
  const queryKey      = ["widgets", storeId];

  const { data, isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn:   () => getWidgets(storeId),
    enabled:   !!storeId,
    staleTime: 5 * 60 * 1000,  // 5 min — correct for slow-changing catalog data
  });

  // CRITICAL: never return `data ?? []` inline — that creates a new [] ref every render
  const items = useMemo(() => data ?? [], [data]);

  const invalidate    = useCallback(() => qc.invalidateQueries({ queryKey }),              [qc, queryKey]);
  const invalidateAll = useCallback(() => qc.invalidateQueries({ queryKey: ["widgets"] }), [qc]);

  const create     = useMutation({ mutationFn: (p) => createWidget({ store_id: storeId, ...p }), onSuccess: invalidate    });
  const update     = useMutation({ mutationFn: ({ id, ...p }) => updateWidget(id, p),            onSuccess: invalidate    });
  const activate   = useMutation({ mutationFn: (id) => updateWidget(id, { is_active: true }),    onSuccess: invalidateAll });
  const deactivate = useMutation({ mutationFn: (id) => deleteWidget(id),                         onSuccess: invalidateAll });
  const hardDelete = useMutation({ mutationFn: (id) => hardDeleteWidget(id),                     onSuccess: invalidateAll });

  return { storeId, items, isLoading, error: error ?? null, refetch,
           create, update, activate, deactivate, hardDelete };
}
```

### 8. Rust backend checklist for each domain

For every new domain that needs HTTP exposure:

```rust
// 1. commands/widgets.rs — convert all pub fns to _inner + pub(crate)
pub(crate) async fn get_widgets_inner(state: &AppState, token: String, ...) -> AppResult<Vec<Widget>> { ... }
pub(crate) async fn create_widget_inner(state: &AppState, token: String, payload: CreateWidgetDto) -> AppResult<Widget> { ... }
pub(crate) async fn update_widget_inner(state: &AppState, token: String, id: i32, payload: UpdateWidgetDto) -> AppResult<Widget> { ... }
pub(crate) async fn delete_widget_inner(state: &AppState, token: String, id: i32) -> AppResult<()> { /* soft-delete: SET is_active = FALSE */ }
pub(crate) async fn hard_delete_widget_inner(state: &AppState, token: String, id: i32) -> AppResult<()> { /* DELETE FROM widgets */ }

// 2. lib.rs — add hard_delete to generate_handler![]
commands::widgets::hard_delete_widget,

// 3. http_server.rs — add imports + match arms for every method
use crate::commands::widgets;
use crate::models::widget::{CreateWidgetDto, UpdateWidgetDto};
// ... match arms: "get_widgets", "create_widget", "update_widget", "delete_widget", "hard_delete_widget"
```

### 9. Derived state pattern inside the panel

Batch ALL derived values into **one** `useMemo` to prevent cascading re-renders:

```js
const { activeList, inactiveList, filtered, counts } = useMemo(() => {
  const activeList   = items.filter((i) =>  i.is_active);
  const inactiveList = items.filter((i) => !i.is_active);
  const byStatus =
    statusTab === "active"   ? activeList
    : statusTab === "inactive" ? inactiveList
    : items;
  const filtered = filterFn ? byStatus.filter(filterFn) : byStatus;
  return {
    activeList, inactiveList, filtered,
    counts: { all: items.length, active: activeList.length, inactive: inactiveList.length },
  };
}, [items, statusTab, /* filterFn deps */]);
```

### 10. Column array memoisation rule

Columns must be inside `useMemo`, **not** computed inline — they contain `render` functions that would
create new closures on every render, causing DataTable to think props changed:

```js
// ✅ Correct
const columns = useMemo(() => [
  { key: "name", header: "Name", render: (row) => <span>{row.name}</span> },
  // ...
], [deps]);  // deps = anything the render fns close over (deptMap, canManage, openEdit...)

// ❌ Wrong — new array + new function refs every render
const columns = [
  { key: "name", render: (row) => <span>{row.name}</span> },
];
```

### 11. Icon legend (always at page bottom)

Shows what the three action icons do. Render only when `items.length > 0 && canManage`:

```jsx
<div className="flex flex-wrap items-center gap-5 px-1 text-[11px] text-muted-foreground">
  <div className="flex items-center gap-1.5"><Edit3 className="h-3 w-3" /><span>Edit</span></div>
  <div className="flex items-center gap-1.5"><Power className="h-3 w-3 text-success" /><span>Activate</span></div>
  <div className="flex items-center gap-1.5"><PowerOff className="h-3 w-3 text-warning" /><span>Deactivate</span></div>
  <div className="flex items-center gap-1.5"><Trash2 className="h-3 w-3 text-destructive" /><span>Delete permanently</span></div>
</div>
```

### 12. Two-letter avatar for table rows

Every name column shows a coloured 2-letter avatar that reflects active state:

```jsx
<div className={cn(
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-[11px] font-bold uppercase",
  row.is_active
    ? "border-primary/30 bg-primary/10 text-primary"
    : "border-muted/40 bg-muted/30 text-muted-foreground"
)}>
  {row.name.slice(0, 2).toUpperCase()}
</div>
```

---

## Shared Components — Quick Reference

Import from `@/components/shared/` — never re-implement these.

```jsx
import { PageHeader }      from "@/components/shared/PageHeader";
import { DataTable }       from "@/components/shared/DataTable";
import { EmptyState }      from "@/components/shared/EmptyState";
import { ConfirmDialog }   from "@/components/shared/ConfirmDialog";
import { StatusBadge }     from "@/components/shared/StatusBadge";
import { CurrencyDisplay } from "@/components/shared/CurrencyDisplay";
import { Spinner }         from "@/components/shared/Spinner";

// PageHeader
<PageHeader
  title="Transactions"
  description="View and manage all sales."
  action={<Button>Export</Button>}
  badge={<StatusBadge status="open" />}
>
  {/* filter bar goes here */}
</PageHeader>

// DataTable — column definition
const columns = [
  { key: "ref",    header: "Ref #",   sortable: true },
  { key: "total",  header: "Total",   align: "right",
    render: (row) => <CurrencyDisplay value={row.total} /> },
  { key: "status", header: "Status",
    render: (row) => <StatusBadge status={row.status} /> },
];
<DataTable
  columns={columns}
  data={transactions}
  isLoading={isLoading}
  onRowClick={(row) => openSheet("transaction-detail", row)}
  pagination={{ page, pageSize: 25, total, onPageChange: setPage }}
  emptyState={
    <EmptyState icon={Receipt} title="No transactions yet"
      description="Completed sales will appear here." />
  }
/>

// ConfirmDialog
<ConfirmDialog
  open={showConfirm}
  onOpenChange={setShowConfirm}
  title="Void transaction?"
  description="This cannot be undone. Stock will be restocked."
  confirmLabel="Void Transaction"
  variant="destructive"
  onConfirm={() => voidTransaction(selectedId)}
/>

// Spinner variants
<Spinner />                              // full page
<Spinner variant="inline" message="Saving..." />
<div className="relative"><Spinner variant="overlay" /></div>
```

---

## Frontend Build Rules (summary)

1. **Always build in phase order.** Foundation → Shared UI → Shifts → POS → everything else.
2. **Every feature page gets a `commands/` file first.** Never call `rpc()` directly from a component.
3. **All financial values from the backend are strings.** Call `parseFloat()` immediately, display with `formatCurrency()`.
4. **Charge/Pay button is always `variant="success" size="xl"`** — never primary blue.
5. **Token comes from `useAuthStore(s => s.token)`** — never hardcoded, never from localStorage directly.
6. **Check `isShiftOpen` before showing POS charge button and cash movement actions.**
7. **Never import from another feature** — features are self-contained.
8. **Shared presentational components live in `components/shared/`.** If two features need the same UI widget, it goes there.
9. **Page components are thin composers** — one feature import, layout props, no business logic.
10. **`usePermission(slug)` before rendering admin-only controls** — backend always re-validates, this is UI-layer gating only.
