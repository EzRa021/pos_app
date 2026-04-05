# Claude Code Prompt — Real-Time Cloud Sync for Quantum POS

---

## Context: What This App Is

This is **Quantum POS** — a Tauri 2 desktop application with:

- **Backend**: Rust (`src-tauri/src/`) using `sqlx 0.8` with a **PostgreSQL** `PgPool`
- **Frontend**: React + Vite (`src/`)
- **Database**: PostgreSQL (NOT SQLite) — the user sets a connection string via a setup wizard, stored in `tauri-plugin-store` (`settings.json`, key: `db_config`)
- **State**: Single `AppState` struct in `src-tauri/src/state.rs` holding `Arc<Mutex<Option<PgPool>>>`
- **Migrations**: 72 custom `.sql` files in `src-tauri/migrations/`, run by `src-tauri/src/database/pool.rs` using a custom SHA-256 content-hash runner (NOT sqlx built-in migrate!)
- **Commands**: ~120 Tauri commands in `src-tauri/src/commands/` covering transactions, inventory, customers, shifts, expenses, analytics, etc.
- **HTTP layer**: Axum HTTP server (`src-tauri/src/http_server.rs`) running on port 4000 alongside the Tauri app

---

## The Goal

**Real-time multi-location sync**: A cashier in Lagos (or Abuja, or anywhere) opens the app, processes a sale, and every other connected instance — on any laptop, anywhere with internet — sees that transaction appear in real time without refreshing.

**Specific requirements**:
1. Data writes to cloud automatically whenever the app is online
2. A person in a different city sees new transactions, stock changes, etc. in real time
3. No manual sync button — it should be invisible and automatic
4. Must not break any existing Tauri commands or SQLx queries
5. Must handle the case where the internet goes down gracefully

---

## Your Task

### Step 1 — Read and understand the full codebase

Before writing a single line of code, read and understand:

```
src-tauri/Cargo.toml                          # current Rust dependencies
src-tauri/src/state.rs                        # AppState — the central shared state
src-tauri/src/lib.rs                          # app setup, plugin registration, command registry
src-tauri/src/database/pool.rs                # how the PgPool is created and migrations run
src-tauri/src/commands/transactions.rs        # the most critical command — understand the full write path
src-tauri/src/commands/inventory.rs           # stock mutations
src-tauri/src/commands/items.rs               # item CRUD
src-tauri/src/http_server.rs                  # Axum HTTP layer
src-tauri/migrations/0001_roles_permissions.sql   # first migration — understand the schema pattern
src-tauri/migrations/0007_transactions.sql        # transactions table schema
src-tauri/migrations/0005_items.sql               # items table schema
src/features/transactions/TransactionsPanel.jsx   # main list page — where real-time matters most
src/features/transactions/useTransactions.js      # data fetching hooks
src/stores/                                       # Zustand stores
src/App.jsx                                       # root component
package.json                                      # frontend dependencies
```

### Step 2 — Evaluate and choose the best sync strategy

Analyse these options against the existing architecture and recommend the **single best approach**:

**Option A — Supabase as primary cloud database** *(recommended path to evaluate first)*
- Point the existing `PgPool` at a Supabase PostgreSQL instance (connection string swap only)
- All instances everywhere connect to the same Supabase PostgreSQL — no local-to-cloud replication needed
- Add `@supabase/supabase-js` to the React frontend **only** for real-time subscriptions (WebSocket channels on top of PostgreSQL logical replication)
- The Rust backend stays 100% unchanged — it just talks to Supabase's PostgreSQL instead of a local one
- Real-time in the frontend: `supabase.channel('transactions').on('postgres_changes', ...)` triggers a React Query `invalidateQueries` — no new backend code at all

**Option B — Dual-write (local PostgreSQL + cloud PostgreSQL)**
- Keep the local PostgreSQL as primary
- After every successful write in Rust, also write to cloud (second `PgPool` in `AppState`)
- Queue failed cloud writes in a local `sync_queue` table for retry when online
- Heavier backend changes, but enables true offline-first

**Option C — PostgreSQL logical replication**
- Set up streaming replication from local PostgreSQL to a cloud replica
- Cloud replica is read-only for Abuja users; Lagos writes to local primary
- Complex infrastructure, not suitable for a desktop app

After reading the codebase, decide which option fits best. **Your evaluation criteria**:
- Minimum changes to the working Rust backend
- Works with the existing SQLx `query_as!` macros (no ORM swap)
- Real-time latency under 2 seconds
- Graceful degradation when offline
- Easy for a small team to maintain

### Step 3 — Implement the chosen strategy end-to-end

Implement everything. Do not leave TODOs or stubs. Every file you create or modify must compile and work.

#### If you choose Option A (Supabase-first), implement:

**Backend changes** (`src-tauri/`):
- `src-tauri/src/state.rs`: Add an optional `supabase_url` and `supabase_anon_key` to the state (for reference / future server-side use). Keep `AppState` backwards compatible.
- `src-tauri/src/commands/app.rs`: Add a `save_supabase_config` command that persists the Supabase URL and anon key to `settings.json` alongside `db_config`
- `src-tauri/src/lib.rs`: Load the Supabase config at startup alongside the existing DB config; expose it to the frontend via a new `get_supabase_config` Tauri command
- Ensure all existing migrations run cleanly against Supabase PostgreSQL (check for any `localhost`-only SQL or extensions that Supabase might not support)

**Frontend changes** (`src/`):
- Install `@supabase/supabase-js` (add to `package.json`)
- Create `src/lib/supabase.js` — initialise and export the Supabase client, reading URL and anon key from the Tauri `get_supabase_config` command at startup
- Create `src/hooks/useRealtimeInvalidation.js` — a hook that subscribes to Supabase Realtime channels for the tables that matter (`transactions`, `item_stock`, `items`, `expenses`, `shifts`, `credit_sales`, `notifications`) and calls `queryClient.invalidateQueries` on change. Make it store-scoped (only listen to the active store's changes using a `filter`)
- Create `src/providers/RealtimeProvider.jsx` — wraps the app and activates `useRealtimeInvalidation` after login; unsubscribes on logout
- Update `src/App.jsx` to wrap with `RealtimeProvider`
- Add a small `SyncStatusBadge` component (or update the existing one in `src/components/shared/`) showing a green dot when the real-time connection is `SUBSCRIBED`, yellow for `CONNECTING`, grey for offline
- Update `src/features/transactions/TransactionsPanel.jsx` to show the live indicator
- Update `src/features/transactions/useTransactions.js` so queries refetch when a real-time event fires (should be automatic via `invalidateQueries`)

**Setup / onboarding** (`src/features/onboarding/` or `src/features/settings/`):
- Add a "Cloud Sync" settings section where the user can enter their Supabase project URL and anon key
- Save these via the new Tauri command
- Show connection status (connected / disconnected)

**Migration compatibility check**:
- Read every migration file and flag any SQL that uses PostgreSQL extensions not available on Supabase (e.g., certain `pg_` extensions). Supabase supports `uuid-ossp`, `pgcrypto`, `pg_stat_statements` — flag anything else
- Verify no migration uses `COPY FROM` with local file paths

#### If you choose Option B (dual-write), implement:

**Backend changes** (`src-tauri/`):
- `src-tauri/src/state.rs`: Add `cloud_db: Arc<Mutex<Option<PgPool>>>` alongside the existing `db`
- `src-tauri/src/database/pool.rs`: Add `create_cloud_pool(cfg: &DbConfig) -> AppResult<PgPool>` — identical to `create_pool` but connecting to the cloud URL and skipping migrations (migrations run on local only)
- Create `src-tauri/src/database/sync.rs`: A background sync worker that:
  - Reads from a `sync_queue` table (add migration for it) containing `{id, table_name, operation, row_data: jsonb, store_id, created_at, retries}`
  - Polls every 5 seconds when online
  - Replays queued writes to the cloud pool
  - Marks rows as `synced` or increments `retries` (max 10, then marks `failed`)
- Update `src-tauri/src/commands/transactions.rs`: After every `db_tx.commit()` in `create_transaction`, also queue the transaction and its line items to `sync_queue` (non-fatal if queuing fails)
- Do the same for `void_transaction`, `partial_refund`, `full_refund`, `adjust_stock`, `restock_item`
- Add a `get_sync_status` Tauri command returning `{pending: i64, failed: i64, last_synced_at: Option<DateTime>}`
- Expose `SyncStatusBadge` data to the frontend

**Frontend changes** (`src/`):
- Create `src/hooks/useSyncStatus.js` polling `get_sync_status` every 10 seconds
- Create `src/components/shared/SyncStatusBadge.jsx` (green = synced, yellow = pending, red = failed)
- For real-time across locations, also add `@supabase/supabase-js` and subscribe to the cloud DB's Realtime channels — this requires the cloud DB to be Supabase, or alternatively use a polling strategy (refetch every 15 seconds when the window is focused)

### Step 4 — Handle edge cases

Make sure the implementation handles:

1. **First launch with no cloud config**: App works exactly as before (local PostgreSQL only), no errors
2. **Cloud connection drops mid-session**: Local writes continue; sync queues; reconnection retries automatically
3. **Schema mismatch** between local and cloud (different migration versions): Detect and warn in settings UI
4. **Concurrent updates** from two locations to the same row (e.g., two cashiers selling the same last item): The existing stock validation in `create_transaction` (Step 4–5 of that command) already handles this with PostgreSQL's ACID guarantees — document this clearly
5. **Supabase row-level security (RLS)**: Disable RLS on all tables or use the service-role key for backend writes (anon key is fine for frontend read-only realtime subscriptions)
6. **Large data sets**: Realtime `filter` must be scoped to `store_id=eq.{storeId}` to avoid receiving every change from every tenant

### Step 5 — Write the migration for sync infrastructure (if Option B)

Create `src-tauri/migrations/0073_sync_queue.sql`:

```sql
CREATE TABLE IF NOT EXISTS sync_queue (
    id           BIGSERIAL    PRIMARY KEY,
    table_name   TEXT         NOT NULL,
    operation    TEXT         NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
    row_id       TEXT         NOT NULL,
    row_data     JSONB        NOT NULL,
    store_id     INT,
    status       TEXT         NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'syncing', 'synced', 'failed')),
    retries      INT          NOT NULL DEFAULT 0,
    error        TEXT,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    synced_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_sync_queue_store   ON sync_queue(store_id, status);
```

### Step 6 — Update CLAUDE.md

At the end of the existing `CLAUDE.md`, add a section:

```markdown
## Cloud Sync Architecture

[Document the chosen approach, what tables are synced, how real-time works,
how to set up Supabase, and what the offline behaviour is]
```

---

## Constraints

- **Do not change any existing SQLx `query_as!` macros** — they are compile-time checked and must not be broken
- **Do not change the existing migration runner** in `database/pool.rs` — it uses SHA-256 content hashing and is not the standard `sqlx::migrate!()` macro
- **Do not remove any existing Tauri commands** from the `invoke_handler` in `lib.rs`
- **All new Rust code must compile** — run `cargo check` in `src-tauri/` after making changes
- **All new frontend code must use the existing design tokens** (see `src/index.css` for the full colour palette: `bg-primary #3b82f6`, `bg-success #16a34a`, `bg-warning #f59e0b`, `bg-destructive #ef4444`)
- **Do not use `localStorage` or `sessionStorage`** in any frontend artifact — use Zustand stores or React Query cache
- **Supabase anon key is safe to use in the frontend** — it is not a secret. The service-role key must stay in the Rust backend only and never be sent to the frontend

---

## Expected Deliverables

1. All modified/created Rust files in `src-tauri/src/`
2. Any new migration file(s) in `src-tauri/migrations/`
3. All modified/created frontend files in `src/`
4. Updated `package.json` with new dependency
5. Updated `CLAUDE.md` with the sync architecture documentation
6. A brief summary of: which option you chose and why, what changed, and how to set it up (Supabase project URL, anon key, where to enter them in the app)
