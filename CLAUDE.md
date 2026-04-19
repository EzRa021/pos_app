# Quantum POS — CLAUDE.md

## Project
Desktop POS app. **Tauri v2** (Rust backend) + **React 19** (frontend).  
Converting from: `quantum-pos-app` (Electron + Fastify).

---

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, Vite 7, React Router v7, Zustand 5, TanStack Query v5 |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`), shadcn/ui, `src/index.css` |
| Backend | Tauri 2, Rust, Axum HTTP server |
| Database | PostgreSQL via sqlx 0.8, 79 migrations |
| Auth | JWT (jsonwebtoken) + bcrypt |
| Sync | Bidirectional cloud sync → Supabase |
| Package manager | **pnpm** |

---

## Commands

```bash
pnpm dev              # Vite dev server only
pnpm tauri dev        # Full Tauri app (frontend + Rust)
pnpm build            # Vite production build
pnpm tauri build      # Full release build
pnpm test             # Vitest
pnpm lint             # ESLint
```

**Rust check:**
```bash
cd src-tauri && SQLX_OFFLINE=true cargo check
```

> SQLx requires `DATABASE_URL=postgres://...` OR `SQLX_OFFLINE=true` + `.sqlx/` cache.

---

## Architecture

### API Flow
- **All screens** use `rpc(method, params)` from `src/lib/apiClient.js` → `POST /api/rpc`
- Never call `invoke()` directly from screens — only from `App.jsx` startup
- Auth token set via `apiClient.defaults.headers.common["Authorization"]`

### Server modes
| Mode | How |
|------|-----|
| Server | `invoke("db_connect")` → `invoke("get_api_port")` → Axios base URL = `http://localhost:{port}` |
| Client | Axios base URL = `http://{host}:{apiPort}` (default 4000), health-check `/health` |

### App startup (App.jsx)
1. `isChecking` → Splash
2. `!config` → SetupWizard
3. `connectFailed` → ConnectionError
4. `!apiReady \|\| !isInitialized` → Splash
5. `onboardingComplete === false` → OnboardingFlow
6. Ready → `<RouterProvider>`  
   - `/login` (PublicOnlyRoute) — unauthenticated users  
   - ProtectedRoute → redirects to `/login`, branch splash, StorePicker  

### Auth storage
- `access_token` — in-memory (Zustand) only
- `refresh_token` — `localStorage` (`qpos_refresh`)
- `user` — `localStorage` (`qpos_user`)
- `config` — `localStorage` (`qpos_config`)

---

## File Structure

```
src/
  pages/          # 50 page components
  features/       # Feature-scoped components (auth, onboarding, pos, …)
  components/
    ui/           # shadcn/ui primitives
    shared/       # PageHeader, Spinner, EmptyState, DataTable, …
    layout/       # AppShell, TitleBar, AppSidebar
  stores/         # Zustand: auth, branch, cart, shift, ui
  hooks/          # use-auth, use-branch, usePermission, useShift, …
  lib/
    apiClient.js  # Axios instance + rpc() helper
    queryClient.js
    format.js
    utils.js

src-tauri/
  src/
    commands/     # ~40 Rust command modules
    database/     # pool.rs, sync.rs
    models/       # ~25 model files
    http_server.rs
    state.rs
    lib.rs
  migrations/     # 0001–0079 SQL files
```

---

## Backend Patterns

- All commands: `guard_permission(&state, &token, "resource.action")`
- Financial amounts: `f64` in DTOs → `Decimal::try_from(v)` → `NUMERIC(15,4)` in DB
- Items use UUID PK; all other entities use SERIAL INT
- Soft deletes: `is_active = FALSE`
- Inner function pattern: `*_inner(&AppState, …)` called by both Tauri commands and HTTP RPC dispatcher
- Tax: per-item via `tax_categories`, fallback to `stores.tax_rate`

---

## Database / Sync

- **Push** (local → Supabase): `sync_queue` table, tier-ordered by FK deps, 5s poll
- **Pull** (Supabase → local): cursor-based, `cloud_pull_cursor` in `app_config`
- Sync gated by `cloud_sync_enabled = 'true'` in `app_config`
- FK failures trigger `force_resync_table()` on the parent table (deduped per cycle)

**Default credentials (seeded migration 0003):**  
`admin` / `Admin@123` — role: `super_admin`

---

## Styling Rules

> **Never hardcode hex/rgb/hsl. Always use Tailwind utility classes.**

### Color tokens (dark theme — default)
| Class | Hex | Use |
|-------|-----|-----|
| `bg-background` | `#09090b` | Page background |
| `bg-card` | `#111113` | Panels, modals, sidebar |
| `bg-muted` | `#27272a` | Disabled, inactive, skeleton |
| `bg-primary` | `#3b82f6` | Active items, primary buttons |
| `bg-success` | `#16a34a` | Charge/Pay button ONLY |
| `bg-destructive` | `#ef4444` | Delete, void, cancel |
| `bg-warning` | `#f59e0b` | Low-stock, unpaid, pending |
| `text-foreground` | `#fafafa` | Primary text |
| `text-muted-foreground` | `#a1a1aa` | Labels, hints only |
| `border-border` | `#27272a` | All borders |

- Opacity modifiers are fine: `bg-primary/15`, `border-primary/30`
- Theme: dark-only by default (`class="dark"` on `<html>`); store `theme` column can override
- Pre-auth screens (Login, StorePicker) must force `document.documentElement.classList.add("dark")`

### Design conventions (match StoresPage / LoginPage)
- Labels: `text-[10px] font-semibold uppercase tracking-wider text-muted-foreground`
- Card: `rounded-xl border border-border bg-card`
- Input height: `h-9`; small buttons: `h-8`; form buttons: `h-9`
- Two-column auth layout: `w-[380px] bg-card/40 border-r` left + flex-1 right
- Accent dots motif: `h-[3px] w-6 rounded-full bg-primary` + 2 smaller fading dots

---

## Key Stores

| Store | File | Responsibility |
|-------|------|----------------|
| `useAuthStore` | `auth.store.js` | login, logout, restoreSession, token, isPosLocked |
| `useBranchStore` | `branch.store.js` | activeStore, stores list, needsPicker, theme |
| `useCartStore` | `cart.store.js` | POS cart items, totals |
| `useShiftStore` | `shift.store.js` | active shift state |
| `useUiStore` | `ui.store.js` | sidebar collapse, global UI flags |

- After login/restoreSession → `useBranchStore.getState().initForUser(user)` called directly (not via useEffect)

---

## Roles
`super_admin` → `admin` → `gm` → `manager` → `cashier` → `stock_keeper`

- `is_global = true` (super_admin, admin): can access all stores → shown StorePicker  
- `is_global = false`: locked to `user.store_id`

---

## React Query

- All data fetching uses React Query hooks in `src/features/<feature>/use<Feature>.js`
- `queryClient` from `src/lib/queryClient.js`
- Wrap queries with `enabled: isApiReady()` to prevent firing before API is set up

---

## Do / Don't

| Do | Don't |
|----|-------|
| Use `rpc(method, params)` for all API calls | Call `invoke()` outside App.jsx startup |
| Use design token classes | Hardcode colors |
| Soft-delete (`is_active = false`) | Hard-delete records (except where explicitly required) |
| `rust_decimal` for all money | Use `f64` directly in DB |
| Use `pnpm` | Use `npm` or `yarn` |
