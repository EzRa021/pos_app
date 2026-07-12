# Backend Reference

## Layout

```
src-tauri/src/
  commands/       # ~40 domain modules — Tauri + HTTP entry points
  models/         # DTOs and DB row types
  database/
    pool.rs       # Local + cloud pool creation, migrations
    sync.rs       # Cloud sync workers
  http_server.rs  # Axum RPC dispatcher (~2600 lines)
  state.rs        # AppState (pools, sessions, config)
  error.rs        # AppError, AppResult
  lib.rs          # Tauri setup, command registration, worker spawn
  migrations/     # Sequential SQL (check highest NNNN)
```

## AppState

Shared between Tauri commands and HTTP server via `Arc`. Holds:
- Local `PgPool`
- Optional cloud `PgPool` + `SupabaseConfig`
- In-memory JWT sessions
- `business_id` cache

## Error handling

Commands return `AppResult<T>` → `Result<T, AppError>`.  
HTTP layer maps errors to JSON `{ "error": "message" }`.

Common variants: Validation, NotFound, Forbidden, Conflict, Internal.

## Permission pattern

```rust
guard_permission(&state, &token, "items.create").await?;
// or guard() for authenticated-only (no specific permission)
```

Permission slugs seeded in migrations (0001+). Match existing `resource.action` naming.

## Inner function pattern

```rust
#[tauri::command]
pub async fn create_item(state: State<'_, AppState>, token: String, dto: CreateItemDto) -> AppResult<Item> {
    guard_permission(&state, &token, "items.create").await?;
    create_item_inner(&state, dto).await
}

pub async fn create_item_inner(state: &AppState, dto: CreateItemDto) -> AppResult<Item> {
    // shared logic — called from http_server dispatch too
}
```

## Audit

Sensitive mutations use `write_audit_log()` from `commands/audit.rs`.

## Financial amounts

```rust
let amount = Decimal::try_from(dto.amount)
    .map_err(|_| AppError::Validation("Invalid amount".into()))?;
```

Never bind f64 directly to NUMERIC columns.

## Migrations

- Local: run on `db_connect`
- Cloud: run via `create_cloud_pool_with_migrations` on Supabase connect
- Both must stay in sync — same migration files

## Startup workers (`lib.rs`)

- HTTP server on port 4000
- Push sync loop (2s delay)
- Pull sync loop (3s delay)
- Startup: reset stuck sync rows, FK-failed rows, backfill sync_queue
- Hourly session cleanup
