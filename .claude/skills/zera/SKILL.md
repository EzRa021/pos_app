---
name: zera
description: >-
  Zera desktop POS (Tauri 2 + React 19 + PostgreSQL). Use for any work in this
  repo — features, bugs, migrations, RPC commands, UI, cloud sync, permissions,
  inventory, transactions, or architecture changes. Read CLAUDE.md first for
  facts; follow this skill for procedures and conventions.
---

# Zera POS — Project Skill

## Start here

1. Read `CLAUDE.md` at the repo root (stack, architecture, styling, do/don't).
2. Read only the reference files you need (see bottom of this file).
3. Explore existing code in the same domain before writing new patterns.

## Architecture freedom

Patterns in this repo describe the **current baseline**, not a frozen design. If you find a clearly better approach — for sync, state, API shape, or UI — **implement it** when it improves reliability or maintainability without breaking:

- Offline-first local writes (cloud down must not block POS)
- `business_id` tenant scoping
- Permission checks on mutating operations
- No silent corruption of money, stock, or terminal records

Document non-obvious design choices in code comments or a short note in the PR. Minimize diff scope unless a rewrite is the root fix.

## Commands

```bash
pnpm dev                    # Vite only
pnpm tauri dev              # Full app
pnpm build && pnpm tauri build
pnpm test && pnpm lint
cd src-tauri && SQLX_OFFLINE=true cargo check
```

Package manager: **pnpm only**.

---

## Core rules (never break)

| Rule | Detail |
|------|--------|
| API from screens | `rpc(method, params)` via `src/lib/apiClient.js` → `POST /api/rpc` |
| `invoke()` | Only in `App.jsx` startup (db connect, port, Tauri-specific) |
| Money | f64 in DTOs → `Decimal::try_from(v)` → `NUMERIC(15,4)` in DB |
| PKs | Items = UUID; everything else = SERIAL INT |
| Deletes | Soft: `is_active = FALSE` unless domain requires hard delete |
| Permissions | `guard_permission(&state, &token, "resource.action")` on commands |
| Inner pattern | `*_inner(&AppState, …)` shared by Tauri command + HTTP dispatcher |
| Styling | Tailwind design tokens only — never hardcode hex/rgb/hsl |
| SQLx | New queries → update `.sqlx/` cache; verify with `SQLX_OFFLINE=true` |

---

## App startup flow (`App.jsx`)

```
isChecking → Splash
!config → SetupWizard
connectFailed → ConnectionError
!apiReady || !isInitialized → Splash
!onboardingComplete → OnboardingFlow
Ready → RouterProvider (/login, ProtectedRoute, StorePicker)
```

**Server mode:** `invoke("db_connect")` → local API on dynamic port.  
**Client mode:** Axios → `http://{host}:4000`, health-check `/health`.

**Auth storage:** `access_token` in Zustand (memory); `refresh_token` / `user` / `config` in localStorage (`qpos_*`).

After login → `useBranchStore.getState().initForUser(user)` directly (not useEffect).

---

## Adding a backend RPC method

Checklist — all steps required:

```
- [ ] models/<domain>.rs — DTOs with Serialize/Deserialize
- [ ] commands/<domain>.rs — guard_permission + *_inner logic
- [ ] queue_row() after commit if table is cloud-synced (see cloud-sync.md)
- [ ] commands/mod.rs — pub mod declaration
- [ ] lib.rs — tauri::command registration (if Tauri-exposed)
- [ ] http_server.rs — dispatch match arm calling *_inner
- [ ] Migration if schema changed (next sequential number in migrations/)
- [ ] SQLX_OFFLINE=true cargo check
```

HTTP RPC shape:
```json
POST /api/rpc
{ "method": "snake_case_name", "params": { ... } }
Authorization: Bearer <token>
```

---

## Adding a migration

1. Next file: `src-tauri/migrations/NNNN_description.sql` (check highest number).
2. Idempotent where possible: `IF NOT EXISTS`, `ON CONFLICT DO NOTHING`.
3. Runs on **both** local and cloud DB (cloud via `create_cloud_pool_with_migrations`).
4. If adding a synced table: include `created_at`, `updated_at`, `business_id` — see [cloud-sync.md](cloud-sync.md).
5. `SQLX_OFFLINE=true cargo check` after any new sqlx queries.

---

## Frontend feature pattern

```
src/features/<feature>/
  use<Feature>.js     # React Query hooks — all data fetching here
  *Panel.jsx          # Feature UI (optional)

src/pages/<Feature>Page.jsx   # Route target, thin wrapper
src/commands/<feature>.js     # rpc() wrappers (optional, or inline in hook)
```

Rules:
- Queries: `enabled: isApiReady()` from apiClient
- Mutations: invalidate related query keys on success
- Pages use `PageHeader`, `DataTable`, `EmptyState` from `components/shared/`
- Match design of `StoresPage` / `LoginPage` (see CLAUDE.md styling)

**Roles:** `super_admin` → `admin` → `gm` → `manager` → `cashier` → `stock_keeper`  
Global roles (`is_global`) see StorePicker; others locked to `user.store_id`.

---

## Key stores (Zustand)

| Store | File | Use |
|-------|------|-----|
| auth | `stores/auth.store.js` | login, token, isPosLocked |
| branch | `stores/branch.store.js` | activeStore, theme, needsPicker |
| cart | `stores/cart.store.js` | POS cart |
| shift | `stores/shift.store.js` | active shift |
| ui | `stores/ui.store.js` | sidebar, global UI |

---

## Cloud sync (summary)

Bidirectional local PostgreSQL ↔ Supabase. Gated by `cloud_sync_enabled` in `app_config`.

| Direction | Mechanism |
|-----------|-----------|
| Push | `sync_queue` → tier-ordered worker → Supabase UPSERT |
| Pull | Cursor `cloud_pull_cursor` → poll → local UPSERT |
| Realtime | `@supabase/supabase-js` — cache invalidation only; **no frontend writes** |

Core file: `src-tauri/src/database/sync.rs`

**Known gaps:** no conflict resolution yet; some tables queued but not allowlisted; `inventory`, `cash_movements`, `stock_transfers` missing `queue_row`. Full detail: [cloud-sync.md](cloud-sync.md).

When improving sync, entity-class conflict rules matter:
- Append-only (transactions, payments) → PK dedup
- Master data (items, customers) → LWW on `updated_at`
- Stock (`item_stock`) → never blind overwrite qty
- Soft deletes → sync as UPDATE

---

## Domain map (where to look)

| Domain | Rust command | Frontend hook |
|--------|-------------|---------------|
| POS / checkout | `transactions.rs` | `features/pos/usePos.js` |
| Items / catalog | `items.rs` | `features/items/useItems.js` |
| Inventory / stock | `inventory.rs` | `features/inventory/useInventory.js` |
| Shifts / EOD | `shifts.rs`, `eod.rs` | `features/shifts/` |
| Customers / wallet | `customers.rs`, `customer_wallet.rs` | `features/customers/`, `wallet/` |
| Purchase orders | `purchase_orders.rs` | `features/purchase_orders/` |
| Stock transfers | `stock_transfers.rs` | `features/stock_transfers/` |
| Returns | `returns.rs` | `features/returns/` |
| Cloud sync | `cloud_sync.rs`, `database/sync.rs` | `features/settings/CloudSyncPanel.jsx` |
| Auth / users | `auth.rs`, `users.rs` | `features/users/`, `stores/auth.store.js` |
| Analytics | `analytics.rs` | `features/analytics/` |

Full command list: `src-tauri/src/commands/mod.rs` + `http_server.rs` dispatch.

---

## Verification before done

```
- [ ] SQLX_OFFLINE=true cargo check (if Rust touched)
- [ ] pnpm lint (if JS touched)
- [ ] pnpm test (if tests exist for area)
- [ ] No invoke() added outside App.jsx
- [ ] No hardcoded colors
- [ ] Permission string matches existing resource.action pattern
- [ ] Sync allowlists updated if table added/changed (cloud-sync.md checklist)
```

Default login (seed): `admin` / `Admin@123` — `super_admin`.

---

## Do / Don't

| Do | Don't |
|----|-------|
| Match surrounding code style | Over-engineer helpers for one-off use |
| Minimal focused diffs | Change unrelated files |
| `rust_decimal` in DB | f64 in PostgreSQL NUMERIC |
| Propose better architecture when evidence supports it | Force-fit broken patterns |
| Comments only for non-obvious business logic | Narrate obvious code |
| Tests when they cover real behavior | Trivial assertion tests |

---

## Reference files (read when needed)

| File | Contents |
|------|----------|
| [cloud-sync.md](cloud-sync.md) | Sync allowlists, tiers, gaps, conflict strategy |
| [backend.md](backend.md) | Rust modules, error types, audit pattern |
| [frontend.md](frontend.md) | Routes, query keys, UI conventions |
| `CLAUDE.md` | Authoritative project facts (always read first) |
