# Quantum POS — Production Audit: Stores & Multi-Store Module

**Audited:** 2026-04-30  
**Scope:** `src-tauri/src/commands/stores.rs`, `src/features/stores/useStores.js`, `src/pages/StoresPage.jsx`, `src/pages/StoreDetailPage.jsx`, `src/pages/StoreCreationPage.jsx`, `src/commands/stores.js`.

---

## BACKEND FAULTS (must fix before production)

### 1. `create_store` sync payload is empty — Supabase never receives the full store record
**Where:** `src-tauri/src/commands/stores.rs` — `create_store()`, the `queue_row` call  
**What:**
```rust
crate::database::sync::queue_row(
    &pool, "stores", "INSERT", &id.to_string(),
    serde_json::json!({ "id": id, "is_active": true }),   // ← only 2 fields
    Some(id),
).await;
```
The sync payload contains only `id` and `is_active`. All other fields — `store_name`, `address`, `city`, `state`, `country`, `phone`, `email`, `currency`, `timezone`, `tax_rate`, `receipt_footer` — are missing. Supabase receives an incomplete row that cannot be upserted as a meaningful store record. The Supabase replica will have a store with only its ID and active status, with every other column NULL, breaking any cloud-based reporting or multi-device store lookup.  
**Fix:** Include the complete store data:
```rust
serde_json::json!({
    "id": id,
    "store_name": payload.store_name,
    "address": payload.address,
    "city": payload.city,
    "state": payload.state,
    "country": payload.country,
    "phone": payload.phone,
    "email": payload.email,
    "currency": payload.currency,
    "timezone": payload.timezone,
    "tax_rate": tax,
    "receipt_footer": payload.receipt_footer,
    "is_active": true,
})
```

### 2. `update_store` sync payload is also nearly empty — only name and `is_active` are replicated
**Where:** `src-tauri/src/commands/stores.rs` — `update_store()`, the `queue_row` call  
**What:**
```rust
serde_json::json!({
    "id": id,
    "store_name": payload.store_name,   // Option<String> — may be None
    "is_active": payload.is_active,     // Option<bool> — may be None
})
```
If a store's phone, email, address, currency, or tax rate is updated, none of those changes are replicated to Supabase. Additionally, both `store_name` and `is_active` are `Option` types — when a phone-only update is sent, `store_name: null` is queued to Supabase, which a naive upsert would use to NULL out the store name in the cloud.  
**Fix:** Build the sync payload from the existing store row (fetch it before the UPDATE) so only actually-changed fields are present and unchanged fields retain their current values. Or always include all fields using the full post-update store row returned by `get_store_inner`.

### 3. `create_store` passes `tax_rate` through `Decimal::try_from(r).unwrap_or_default()` — invalid float values silently become 0
**Where:** `src-tauri/src/commands/stores.rs` — `create_store()`, tax conversion  
**What:**
```rust
let tax = payload.tax_rate
    .map(|r| rust_decimal::Decimal::try_from(r).unwrap_or_default())
    .unwrap_or_default();
```
`Decimal::try_from(f64)` fails for `NaN`, `Infinity`, or values outside Decimal range. `.unwrap_or_default()` silently converts these to `Decimal::ZERO`. A user who accidentally enters `-1` or `NaN` in the tax field (possible via browser devtools or a buggy client) would have their store created with 0% tax and no error. The same pattern exists in `update_store` via `payload.tax_rate.map(|r| Decimal::try_from(r).unwrap_or_default())`.  
**Fix:** Validate the tax rate before the conversion:
```rust
if let Some(rate) = payload.tax_rate {
    if !rate.is_finite() || rate < 0.0 || rate > 100.0 {
        return Err(AppError::Validation(
            "Tax rate must be a number between 0 and 100.".into()
        ));
    }
}
let tax = payload.tax_rate
    .map(|r| rust_decimal::Decimal::try_from(r).map_err(|_| AppError::Validation("Invalid tax rate.".into())))
    .transpose()?
    .unwrap_or_default();
```

### 4. `update_store` uses `COALESCE` for all fields — there is no way to explicitly clear optional fields like `phone`, `email`, `address`, or `logo_data`
**Where:** `src-tauri/src/commands/stores.rs` — `update_store()`, the UPDATE query  
**What:**
```sql
phone = COALESCE($6, phone),
email = COALESCE($7, email),
```
`COALESCE(NULL, current_value)` always preserves the current value. If a store owner wants to clear their phone number (perhaps the store phone was decommissioned), they cannot do so through this API — sending `phone: null` is treated as "no change." The same applies to `address`, `email`, `receipt_footer`, and `logo_data`. Once set, these fields can only be changed to another non-null value, never cleared.  
**Fix:** Use explicit `Option<Option<T>>` in `UpdateStoreDto` to distinguish "no change" from "clear," or add a `clear_fields: Vec<String>` parameter. As a pragmatic minimum fix, accept an empty string as a clear signal:
```sql
phone = CASE WHEN $6 = '' THEN NULL WHEN $6 IS NULL THEN phone ELSE $6 END
```

### 5. `get_stores_inner` returns all stores including `logo_data` — full base64 logo blobs in every list response
**Where:** `src-tauri/src/commands/stores.rs` — `get_stores_inner()`, the SELECT  
**What:** Every `get_stores` call (list view in `StoresPage`, `useBranchStore.initForUser`, and any component using `getStores`) fetches the full `logo_data` column for every store. A logo stored as a base64 data URI is up to 500 KB per store. With 10 stores each having a logo, a single `get_stores` response can be 5 MB. This is transmitted every 2 minutes (the `staleTime`), sent over the Axum HTTP connection, and serialized/deserialized for every store list render.  
**Fix:** Exclude `logo_data` from list queries. Return a boolean flag `has_logo: bool` instead. Only return `logo_data` in `get_store` (single store detail) and `get_my_store`:
```sql
-- In get_stores_inner:
SELECT id, store_name, ..., (logo_data IS NOT NULL) AS has_logo, is_active, ...
FROM stores
-- Without logo_data

-- In get_store_inner (detail only):
SELECT id, store_name, ..., logo_data, is_active, ...
FROM stores WHERE id = $1
```

### 6. `get_store_inner` permission logic is inverted for the "own store" check — a non-global cashier can read ANY store's full detail
**Where:** `src-tauri/src/commands/stores.rs` — `get_store_inner()`  
**What:**
```rust
let is_own_store = !claims.is_global && claims.store_id == Some(id);
if !is_own_store {
    guard_permission(state, &token, "stores.read").await?;
}
```
This reads: "If this is NOT the user's own store, require `stores.read` permission." This is backwards from what's needed. The intention was: "If it IS your own store, you can read it without special permission." But the logic means any non-global user whose `claims.store_id == Some(id)` bypasses the permission check — so cashiers and stock keepers can call `get_store(their_store_id)` without `stores.read`. This is probably the intended behavior (cashiers reading their own store settings). But separately, a cashier from Store A calling `get_store(store_b_id)` where `claims.store_id != Some(store_b_id)` WILL require `stores.read` — so other stores are protected. The logic is not backwards after all — but it's also not a bug. The risk is that the "own store" branch has no check that the store is still active. A cashier whose store was deactivated can still call `get_store` on it and receive the full store record including `logo_data`. Add an `is_active` check or at least document this as intended behavior.

### 7. `update_store` has no validation that `store_name` is non-empty — an empty string can replace the current name via COALESCE bypass
**Where:** `src-tauri/src/commands/stores.rs` — `update_store()`  
**What:** `COALESCE($1, store_name)` uses `$1 = Some("")` (empty string) as a valid non-null value that will replace the current store name. A client sending `store_name: ""` will update the store's name to an empty string. The `StoreFormPanel` in the frontend validates `!form.store_name.trim()` before submit, but the backend has no corresponding guard.  
**Fix:**
```rust
if let Some(name) = &payload.store_name {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("Store name cannot be empty.".into()));
    }
    if trimmed.len() > 120 {
        return Err(AppError::Validation("Store name cannot exceed 120 characters.".into()));
    }
}
```

### 8. `update_store` is also used for `activateStore` / `deactivateStore` with no audit distinction — all store updates share one audit log event type
**Where:** `src-tauri/src/commands/stores.rs` — `update_store()`, `write_audit_log` call  
**What:**
```rust
write_audit_log(&pool, claims.user_id, Some(id), "update", "store",
    &format!("Updated store id {id}"), "info").await;
```
Activating or deactivating a store — which can lock out an entire branch's cashiers from logging in — is logged as the same generic `"Updated store id 1"` event as changing the receipt footer. There is no distinction between a benign configuration change and a business-critical status change in the audit trail.  
**Fix:** Check `payload.is_active` and emit a distinct audit entry:
```rust
let action = match payload.is_active {
    Some(true)  => "activate",
    Some(false) => "deactivate",
    None        => "update",
};
let message = match payload.is_active {
    Some(true)  => format!("Activated store '{}'", id),
    Some(false) => format!("Deactivated store '{}'", id),
    None        => format!("Updated configuration for store {id}"),
};
write_audit_log(&pool, claims.user_id, Some(id), action, "store", &message,
    if payload.is_active.is_some() { "warning" } else { "info" }
).await;
```

### 9. `get_stores_inner` has no `store_id` scope for non-global users — any authenticated user with `stores.read` can enumerate ALL stores
**Where:** `src-tauri/src/commands/stores.rs` — `get_stores_inner()`  
**What:** `get_stores_inner` has no clause to scope results by `claims.store_id` for non-global users. A manager with `stores.read` at Store A calls `get_stores` and receives the full list of all stores — names, addresses, phone numbers, emails, currencies, tax rates, and logo blobs — for every store in the system. In a franchise context, Store A's manager should not be able to enumerate all other franchisee locations.  
**Fix:** Add scope enforcement for non-global callers:
```rust
let claims = guard_permission(state, &token, "stores.read").await?;
// Non-global users can only see their own store
if !claims.is_global {
    let store_id = claims.store_id.ok_or(AppError::Forbidden)?;
    return get_store_inner(state, token, store_id).await.map(|s| vec![s]);
}
// Global users see all stores (with optional is_active filter)
```

### 10. `create_store` does not validate `store_name` length or content — a 10,000-character name can be inserted
**Where:** `src-tauri/src/commands/stores.rs` — `create_store()`  
**What:** There is no length check on `payload.store_name` before the INSERT. A name that exceeds the DB column's character limit will produce a raw PostgreSQL truncation error. If the column has no length constraint, unbounded names can bloat the table and break any display that assumes reasonable length. No validation exists for any text field in `CreateStoreDto`.  
**Fix:** Add a `validate_create_store` function before the INSERT:
```rust
let name = payload.store_name.trim();
if name.is_empty()   { return Err(AppError::Validation("Store name is required.".into())); }
if name.len() > 120  { return Err(AppError::Validation("Store name max 120 characters.".into())); }
if let Some(e) = &payload.email {
    if !e.contains('@') { return Err(AppError::Validation("Invalid email address.".into())); }
}
if let Some(r) = payload.tax_rate {
    if !(0.0..=100.0).contains(&r) { return Err(AppError::Validation("Tax rate must be 0–100.".into())); }
}
```

---

## BACKEND UPGRADES (should improve)

### 1. `get_stores` returns all stores in one unbounded fetch — no pagination for large franchises
`get_stores_inner` uses `fetch_all` with no LIMIT. For a system with 500 store locations, the entire `stores` table is returned on every call. `StoresPage` then paginates client-side (page size 20). With `logo_data` included (Fault #5), this can be hundreds of MB. Add server-side pagination matching other modules:
```rust
pub struct StoreFilters {
    pub search:    Option<String>,
    pub is_active: Option<bool>,
    pub page:      Option<i64>,
    pub limit:     Option<i64>,
}
```
And use `LIMIT $2 OFFSET $3` in the query.

### 2. Missing database index on `stores.is_active` and `stores.store_name`
`get_stores_inner` filters `WHERE is_active = $1` and the frontend searches by name/city/email client-side. For a large multi-store deployment, add:
```sql
CREATE INDEX IF NOT EXISTS idx_stores_is_active ON stores(is_active);
CREATE INDEX IF NOT EXISTS idx_stores_name ON stores(store_name);
```

### 3. `get_store_users_inner` has no `is_active` filter — returns deactivated users mixed with active team members
`get_store_users_inner` returns all users assigned to a store regardless of their `is_active` status. The `TeamTab` in `StoreDetailPage` shows a mix of active and deactivated employees. A store owner viewing the "Team" tab sees dismissed employees listed alongside current staff. Add an optional `include_inactive: bool` parameter (default false) and filter `WHERE u.is_active = TRUE` in the default case.

### 4. `update_store` calls `get_store(state, token, id)` after the UPDATE — re-runs the full permission check unnecessarily
After the UPDATE, `update_store` calls `get_store(state, token, id)`, which internally calls `get_store_inner`, which re-runs `guard_permission` or `guard`. The permission was already verified at the top of `update_store`. Use a direct DB fetch instead:
```rust
get_store_inner(&state, token, id).await
// OR call the pool query directly without the auth guard
```
This eliminates a redundant permission check and an extra DB round-trip for token validation on every update.

### 5. `create_store` calls `get_store(state, token, id)` after INSERT with the same redundancy as upgrade #4
Same pattern: after the INSERT, `create_store` calls `get_store(state, token, id)` which re-validates the token. Since the store was just created by the validated `claims`, use a direct pool fetch for the return value.

### 6. `update_store` `theme` and `accent_color` validation is done with an inline closure and array lookup — should be a dedicated `validate_theme`/`validate_accent` function
```rust
let theme = payload.theme.as_deref().and_then(|t| {
    if t == "light" || t == "dark" { Some(t.to_string()) } else { None }
});
```
Invalid values are silently dropped (set to None, which becomes COALESCE(None, current_theme)). A client sending `accent_color: "invalid_color"` gets a 200 response with no indication that the color was rejected. Return a validation error instead of silently ignoring the value:
```rust
if let Some(a) = &payload.accent_color {
    if !ACCENT_ALLOWED.contains(&a.as_str()) {
        return Err(AppError::Validation(format!(
            "Invalid accent_color '{}'. Allowed: {}", a, ACCENT_ALLOWED.join(", ")
        )));
    }
}
```

### 7. `useStores` in `StoresPage` has `staleTime: 2 * 60_000` — the store list can be 2 minutes stale when another admin creates a store from a different terminal
Two admins working simultaneously (admin A creates a store on Terminal 1, admin B is viewing `StoresPage` on Terminal 2) will not see the new store for up to 2 minutes. Given how infrequently stores are created/deleted, this is acceptable — but the `Refresh` button is already provided. Document the staleTime as intentional in the code comments. More critically: after creating a store via `StoreCreationPage`, the `useStores` cache on other open `StoresPage` tabs is not invalidated (the `create.mutateAsync` in `StoreCreationPage` calls `invalidate()` via the `create` mutation's `onSuccess`, but this only invalidates the cache for the `StoreCreationPage` instance's `useStores` hook, not other instances on other tabs). This is a React Query cache broadcast limitation — document it.

### 8. `get_store_users` returns all user fields except `password_hash` — `avatar` field is included and may contain 400 KB base64 blobs
`StoreUser` struct in `get_store_users_inner` does not include `avatar` (the `SELECT` only fetches specific columns). This is correct and good. However, the frontend's `TeamTab` attempts to render initials from `first_name`/`last_name` rather than `UserAvatar` — which is fine. Verify that the `StoreUser` model remains this way and does not accidentally grow an `avatar` column in future migrations.

### 9. `get_stores` ORDER BY `store_name ASC` is not locale-aware — Nigerian store names with accented characters sort incorrectly
`ORDER BY store_name ASC` uses PostgreSQL's default locale collation (typically `C` or `POSIX` for performance). Store names with names like "Àbeòkúta Branch" will sort before "Abeokuta Branch" due to byte ordering rather than alphabetical order. Use `COLLATE "en_US.UTF-8"` or `ICU` collation:
```sql
ORDER BY store_name COLLATE "en-US-x-icu" ASC
```
Or, since this is a Nigeria-focused app, `COLLATE "yo_NG.UTF-8"` for Yoruba-aware sorting if the PostgreSQL instance supports it.

### 10. `activateStore` / `deactivateStore` in `commands/stores.js` both call `rpc("update_store", { id, is_active: true/false })` — but `update_store` also queues a sync row with `is_active` which is correct. However, re-activating a store does not re-synchronize any data that was missed during downtime
When a store is deactivated (goes offline) and reactivated, no mechanism exists to trigger a full resync of data that changed in other stores during the outage period. The `force_resync_table` function used in the sync module handles individual FK failures, but there's no `on_store_reactivate` hook that schedules a full pull for the now-active store. Add a post-reactivation sync trigger.

---

## BACKEND FEATURES (add for completeness)

### 1. No `delete_store` capability — deactivated stores accumulate forever
There is no command to permanently delete a store. Once created (even accidentally), it exists indefinitely in the `stores` table. A "Delete Store" operation should verify no active transactions, open shifts, or assigned users before proceeding, then cascade-soft-delete or archive the store. For compliance, hard-delete should be off by default with a `force: bool` flag for admins.

### 2. No `store_settings` table — all per-store configuration is crammed into the `stores` row
`stores` holds `tax_rate`, `receipt_footer`, `logo_data`, `theme`, `accent_color`. As the POS grows, business rules like `allow_negative_stock`, `require_shift_open`, `max_discount_pct`, `return_window_days`, `loyalty_enabled`, `require_customer_for_credit` are stored in `app_config` or `store_settings` — but there's no unified `store_settings` table for per-store overrides. Add a `store_settings` table with FK to `stores` and move all per-store behavioural flags there.

### 3. No store-level operating hours definition
There is no `store_hours` table or `operating_hours` JSON column on `stores`. A store open from 8 AM to 10 PM has no way to configure this, meaning time-gated login enforcement (Users Audit Feature #4) cannot be implemented. Add a `store_hours` table or `operating_hours JSONB` column with days-of-week and open/close times.

### 4. No cascade behavior when a store is deactivated — assigned users remain active
When `update_store` sets `is_active = false`, no event hook runs. Users assigned to that store (`users.store_id = deactivated_store_id`) remain `is_active = true` and can still log in (the login command checks `u.is_active` but not `s.is_active`). A cashier from a deactivated store can still authenticate and make API calls that pass `store_id` checks. Add a post-deactivation hook:
```rust
if payload.is_active == Some(false) {
    // Expire all active sessions for users of this store
    sqlx::query!(
        "UPDATE active_sessions SET expires_at = NOW()
         WHERE user_id IN (SELECT id FROM users WHERE store_id = $1)
         AND expires_at > NOW()",
        id
    ).execute(&pool).await.ok();
}
```

### 5. No inter-store stock transfer permissions or transfer audit by store
`stock_transfers` exist but there's no backend command on the stores module to retrieve all transfers affecting a given store (both incoming and outgoing). A store owner needs to see "what left my store" and "what came into my store" as a unified view. Add `get_store_transfers(store_id, direction, date_range)`.

### 6. No store-level revenue summary command
There is no `get_store_summary(store_id, date_from, date_to)` command returning: total transactions, total revenue, total returns, total expenses, gross profit, top items, for a given period. The analytics module may cover some of this but it's scoped to the active store via `app_config`, not by an arbitrary `store_id` parameter. Global admins need cross-store comparable summaries.

### 7. No store code / branch code field
Stores have a `store_name` but no short unique `store_code` (e.g., "IKJ" for Ikeja Branch). Transaction reference numbers, transfer identifiers, and receipt numbers use a slug derived from the store name — but there is no dedicated, user-editable `store_code` column. Add `store_code VARCHAR(10) UNIQUE NOT NULL` with a migration that auto-populates from the first 3 characters of `store_name` uppercased.

### 8. No `get_store_shifts` command on the stores module
There is no way to list all shifts for a specific store from the stores module's API surface. A store owner viewing Store A's detail page cannot see its shift history. Shifts are managed via the `shifts` module but there's no cross-store shift summary accessible to global admins without switching active stores.

### 9. No store duplication / clone capability
Creating a second branch with similar settings (same currency, tax rate, timezone, receipt footer) requires manually re-entering all fields. Add a `clone_store(source_id, new_name)` command that copies all settings (except logo_data, which should be re-uploaded) to a new store record.

### 10. No `store_changelog` or settings history
When the tax rate changes from 7.5% to 10%, there is no record of the old value, when it changed, or who changed it. The audit log records `"Updated store id 1"` but does not capture what changed. Add a `store_settings_history` table that records the before/after values for key fields (tax_rate, currency, is_active) on each update.

---

## FRONTEND FAULTS (must fix before production)

### 1. `StoreFormPanel` and `OverviewTab` have no client-side validation beyond `store_name.trim()` — invalid emails and out-of-range tax rates reach the backend unchecked
**Where:** `src/pages/StoresPage.jsx` — `StoreFormPanel.handleSubmit()` and `src/pages/StoreDetailPage.jsx` — `OverviewTab.handleSave()`  
**What:** Both the create panel and the edit form call the backend with no input validation beyond checking that `store_name` is non-empty. An email field with "not-an-email", a tax rate of `999`, or a store name of 2,000 characters all reach the backend. Until Backend Fault #10 and #3 are fixed, the backend accepts these silently or returns a cryptic DB error.  
**Fix:** Add a shared `validateStoreForm(form)` function:
```js
function validateStoreForm(form) {
  const errors = {};
  if (!form.store_name.trim()) errors.store_name = "Required";
  if (form.store_name.trim().length > 120) errors.store_name = "Max 120 characters";
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
    errors.email = "Invalid email";
  if (form.tax_rate !== "" && (isNaN(parseFloat(form.tax_rate)) ||
      parseFloat(form.tax_rate) < 0 || parseFloat(form.tax_rate) > 100))
    errors.tax_rate = "Must be 0–100";
  return errors;
}
```

### 2. `StoreCreationPage` `handleCreate` catches errors silently with `catch {}` — error toasts may not appear if the backend error format is unexpected
**Where:** `src/pages/StoreCreationPage.jsx` — `handleCreate()`  
**What:**
```js
try {
    const newStore = await create.mutateAsync(payload);
    ...
} catch {
    /* error toast handled by mutation onError */
}
```
The comment says "error toast handled by mutation onError" — but if `create.mutateAsync` throws before the mutation's `onError` fires (e.g., a network error at the `rpc()` level), the catch block silently swallows it. The `onError` in `useStores.create` calls `onMutationError`. For `mutateAsync`, errors propagate through both `onError` AND the try-catch — so the error is handled. However, if `create.onError` calls `onMutationError` AND then the catch block runs, no double-toast occurs because the catch block is empty. This is safe but fragile — any future code added to the catch block may conflict. Add a comment:
```js
} catch {
    // Handled by useStores.create.onError → onMutationError toast
    // Do not add error handling here without removing it from onError
}
```

### 3. `StoreCreationPage` sets `activeStore` to the newly created store immediately after creation — but `useBranchStore.setActiveStore` does not trigger `initForUser` or re-fetch store-dependent data
**Where:** `src/pages/StoreCreationPage.jsx` — `handleCreate()`, `setActiveStore(newStore)`  
**What:**
```js
setActiveStore(newStore);
setSuccess(newStore);
setTimeout(() => navigate("/analytics", { replace: true }), 3100);
```
`setActiveStore(newStore)` updates the Zustand store's `activeStore`. However, `useBranchStore.initForUser` (called during normal startup) also sets up `needsPicker`, `stores` list, and other branch state. Setting `activeStore` directly bypasses this initialization. The user is redirected to `/analytics` but the full branch state may not be in sync — for example, `stores` list may not include the newly created store (it was fetched before creation). After `navigate("/analytics")`, components that read `useBranchStore(s => s.stores)` will not show the new store.  
**Fix:**
```js
const newStore = await create.mutateAsync(payload);
if (newStore?.id) {
    // Re-initialize the branch store to pick up the new store in the stores list
    await useBranchStore.getState().initForUser(useAuthStore.getState().user);
    setSuccess(newStore);
    setTimeout(() => navigate("/analytics", { replace: true }), 3100);
}
```

### 4. `StoresPage` `StoreRow` `onEdit` handler passes a stale `store` object from the list — if the store was recently updated, the form pre-fills with old data
**Where:** `src/pages/StoresPage.jsx` — `StoreRow` `onEdit` prop and `openEdit(store, e)`  
**What:** `openEdit(store, e)` captures the `store` object from the `allStores` list fetched at mount time (or up to 2 minutes stale). If another admin updated the store's address in the last 2 minutes on another terminal, the edit form pre-fills with the old address. The admin saves without noticing, overwriting the recent change.  
**Fix:** Either fetch the fresh store detail before opening the edit panel:
```js
const openEdit = async (store, e) => {
    e?.stopPropagation();
    const fresh = await getStore(store.id); // single RPC call
    setEditTarget(fresh);
    setPanelMode("edit");
};
```
Or at minimum, force a refetch when `editTarget` is set.

### 5. `ConfigTab` in `StoreDetailPage` does not sync form state when `store` prop updates — stale `useState` initial values persist after a save
**Where:** `src/pages/StoreDetailPage.jsx` — `ConfigTab`  
**What:**
```js
const [form, setForm] = useState({
    tax_rate:       store.tax_rate != null ? String(store.tax_rate) : "",
    receipt_footer: store.receipt_footer ?? "",
    logo_data:      store.logo_data ?? "",
});
```
`useState` initializes once when the component mounts. If `store` changes (e.g., a save in `OverviewTab` updates the React Query cache which re-renders `StoreDetailPage`), `ConfigTab` does not reinitialize its form. An admin who saves a new tax rate in `OverviewTab`, then switches to `ConfigTab`, sees the old tax rate in the configuration form. Saving from `ConfigTab` would revert the tax rate to the pre-save value.  
**Fix:** Add a `useEffect` to sync form state when `store` changes:
```js
useEffect(() => {
    setForm({
        tax_rate:       store.tax_rate != null ? String(store.tax_rate) : "",
        receipt_footer: store.receipt_footer ?? "",
        logo_data:      store.logo_data ?? "",
    });
}, [store.id, store.tax_rate, store.receipt_footer, store.logo_data]);
```

### 6. `OverviewTab` editing state does not persist across tab switches — `editing` state is lost if the user clicks "Team" then returns to "Overview"
**Where:** `src/pages/StoreDetailPage.jsx` — `OverviewTab`, local `editing` state  
**What:** `OverviewTab` is remounted when switching tabs (because of conditional rendering in `StoreDetailPage`). A user who starts editing a store's name, switches to the "Team" tab to check something, then returns to "Overview" finds the edit form gone and their unsaved changes lost. There is no warning.  
**Fix:** Either lift the `editing` state to `StoreDetailPage` level so it survives tab switches, or show a "You have unsaved changes" banner warning when switching tabs during an edit:
```js
const handleTabChange = (newTab) => {
    if (editing && newTab !== "overview") {
        if (!confirm("You have unsaved changes. Leave without saving?")) return;
    }
    setActiveTab(newTab);
};
```

### 7. `StoresPage` pagination buttons always show pages 1–7 regardless of current page — pages 8+ are unreachable via the page buttons for large multi-store deployments
**Where:** `src/pages/StoresPage.jsx` — pagination `Array.from({ length: Math.min(totalPages, 7) })`  
**What:** Identical to the bug found in `UsersPanel` (Users Audit Fault #7). With 200 stores and PAGE_SIZE 20, there are 10 pages. Only pages 1–7 are reachable via buttons. Pages 8, 9, 10 require clicking "Next" repeatedly.  
**Fix:** Implement a sliding window pagination (e.g., first, `...`, current-1, current, current+1, `...`, last).

### 8. `StoreFormPanel` email field uses `type="email"` which triggers browser-native validation but there is no server-side or JS validation — browser validation can be bypassed
**Where:** `src/pages/StoresPage.jsx` — `StoreFormPanel`, email `<Input type="email" />`  
**What:** The `<Input type="email">` field relies on browser-native validation (which prevents submit from HTML forms). However, `StoreFormPanel` uses `onClick={handleSubmit}` on the footer button instead of `form.onSubmit` — the form's submit event is not triggered, so browser validation is bypassed. A user can click "Create Store" with `email = "not-an-email"` and it will be sent to the backend.  
**Fix:** Either move submit to the form's `onSubmit` handler (keeping the `<form onSubmit={handleSubmit}>` tag already present) and change the footer button to `type="submit"`, OR add JS email validation in `handleSubmit`.

### 9. `ConfigTab` `handleLogoFile` uses `alert()` for the file size error — inconsistent with the rest of the app's toast notification system
**Where:** `src/pages/StoreDetailPage.jsx` — `ConfigTab.handleLogoFile()`  
**What:**
```js
if (file.size > 500 * 1024) {
    alert("Logo must be under 500 KB.");
    return;
}
```
All other error notifications use `toast.error()` from the Sonner toast library. Using `alert()` creates a blocking browser dialog that breaks the app's visual consistency and interrupts the user's workflow with a system-level modal.  
**Fix:**
```js
import { toast } from "sonner";
// ...
if (file.size > 500 * 1024) {
    toast.error("Logo too large", { description: "Please choose an image under 500 KB." });
    return;
}
```

### 10. `useStore` in `StoreDetailPage` has no error boundary — an unhandled fetch error leaves the page in a broken state with no recovery path after the initial error guard
**Where:** `src/pages/StoreDetailPage.jsx` — `useStore(storeId)` usage  
**What:** The `if (error || !store)` guard handles the first error correctly, showing a "Store not found" UI. But after passing the guard, if a background refetch throws an unhandled exception (e.g., a JSON parse error on a malformed response), there is no `ErrorBoundary` to catch it. The component tree crashes with a blank screen.  
**Fix:** Wrap `StoreDetailPage` in an `ErrorBoundary` component.

---

## FRONTEND UPGRADES (should improve)

### 1. `StoresPage` performs all filtering and pagination client-side — no server-side search
`StoresPage` calls `getStores()` to fetch the complete list, then applies `search`, `statusFilter`, and pagination in JS. With large deployments this will be a problem (see Backend Fault #5 with logos). Move filtering to server-side once the backend supports `StoreFilters`.

### 2. `StoresPage` stat cards show 0 during initial load, then flash to real values — no skeleton state
During `isLoading`, `allStores = []`, so `activeCount = 0` and `inactiveCount = 0`. The stat cards flash "Active: 0" before data arrives. Use skeleton loaders in the stat cards during `isLoading`.

### 3. `StoreDetailPage` `ConfigTab` and `OverviewTab` both independently fetch/maintain `tax_rate` edit state — two separate forms that can conflict
Both tabs expose `tax_rate` editing (OverviewTab in the main edit form, ConfigTab in the "Sales Configuration" section). An admin can save different tax rates from both tabs. The last save wins, but the other tab will silently show the stale value until the store data is refetched. Remove `tax_rate` from one tab (preferably `OverviewTab`, since `ConfigTab` is explicitly named "Configuration") and have it managed only in one place.

### 4. `useStores` hook bundles both list queries and mutations — it's doing too much and causing unnecessary re-renders
`useStores` is called in `StoresPage` and also in `StoreCreationPage`. The hook returns `{ stores, create, update, activate, deactivate, ... }`. When `StoreCreationPage` only needs `create`, calling `useStores()` also triggers a `getStores` fetch (subscription). Split into `useStoreList` (just the query) and `useStoreMutations` (create/update/activate/deactivate).

### 5. `TeamTab` in `StoreDetailPage` has no pagination — all users for a store are shown in one unbounded list
`useStoreUsers(storeId)` returns all users for a store with no pagination. A store with 100 employees renders all 100 rows in one table. Add pagination or a `LIMIT 50` with a "Show more" button.

### 6. `StoresPage` `StoreRow` "Deactivate" action has no confirmation dialog — one click deactivates a live operational store
**Where:** `src/pages/StoresPage.jsx` — `StoreRow` `onDeactivate` → `deactivate.mutate(store.id)`  
**What:** Clicking "Deactivate" in the dropdown triggers `deactivate.mutate(store.id)` immediately with no confirmation. Deactivating a live store can lock out all cashiers mid-shift. This is the most impactful single-click action in the entire stores module.  
**Fix:** Add a confirmation dialog:
```js
const handleDeactivate = (store) => {
    setConfirmDeactivate(store);
};
// Render a <ConfirmDialog> that shows store name and user count, requires clicking "Confirm Deactivate"
```

### 7. `StoreDetailPage` breadcrumb is a `<button>` instead of a `<Link>` — keyboard navigation and right-click "Open in new tab" don't work
**Where:** `src/pages/StoreDetailPage.jsx` — the `<button onClick={() => navigate("/stores")}` breadcrumb  
**What:** Using `<button onClick={() => navigate("/stores")}>` prevents keyboard-accessible "Open in new tab" (right-click → Open in new tab shows no option since it's not an anchor). Replace with:
```jsx
import { Link } from "react-router-dom";
<Link to="/stores" className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground ...">
    <ArrowLeft className="h-3 w-3" />
    All Stores
</Link>
```

### 8. `StoreCreationPage` `SuccessScreen` countdown uses `requestAnimationFrame` for progress but `countDown` rounds toward ceiling — shows "3s" for almost 2 full seconds
The countdown shows `Math.ceil((3000 - elapsed) / 1000)`. At elapsed=0ms, `ceil(3000/1000) = 3`. At elapsed=1999ms, `ceil(1001/1000) = 2`. The display shows "3" for 2 full seconds and "2" for only ~1 second. This feels jarring. Use `Math.round` or display in half-second increments for smoother feedback.

### 9. `useStoreUsers` cache key is `["store-users", storeId]` but invalidation in `useStores` only invalidates `["stores"]` — the team list is never auto-refreshed after a user update
When a user is assigned to a store (via `updateUser` in the Users module), the `["store-users", storeId]` cache is not invalidated. A store owner who assigns a new cashier on the Users page and then views the store's Team tab will see the old user list for up to 60 seconds (the `staleTime` for `useStoreUsers`). Add cross-module cache invalidation or reduce `staleTime` for store users.

### 10. `StoreFormPanel` `receipt_footer` textarea has no character counter despite having a finite meaningful length
A receipt footer that is 2,000 characters long will be cut off or overflow on printed receipts (thermal printers typically support 40–48 chars per line, ~5-10 lines total). Add a character counter:
```jsx
<textarea ... maxLength={300} />
<span className="text-[10px] text-muted-foreground">
  {form.receipt_footer.length}/300
</span>
```

---

## FRONTEND FEATURES (add for completeness)

### 1. No store-level KPI cards on `StoreDetailPage` — owners cannot see revenue, transaction count, or staff count at a glance
The store detail page (Overview tab) shows only metadata (address, phone, currency). There are no KPI cards showing: "Revenue this month", "Transactions today", "Active staff", or "Open shift". These are the most important pieces of information a store owner needs when checking on a branch. Add a "Performance" sub-section in OverviewTab using data from `getTransactionStats(store_id)`.

### 2. No "Switch to this store" action on `StoresPage` or `StoreDetailPage`
A global admin browsing the stores list cannot switch their active store from the Stores page. They must navigate to the StorePicker or use the sidebar store switcher. Add a "Switch to Store" button (visible only to `is_global` users) directly in the `StoreRow` actions dropdown and in the `StoreDetailPage` header.

### 3. No bulk export of store list (CSV/PDF)
Franchise owners managing 20+ stores need to export store data for accounting, audits, or investor reporting. Add a "Export CSV" button to `StoresPage` that downloads the current filtered store list.

### 4. No store-level analytics tab on `StoreDetailPage`
The three tabs (Overview, Team, Configuration) have no "Analytics" or "Performance" tab showing charts of sales, returns, and expenses over time for this specific store. A store owner should be able to see their branch's performance without switching their active store.

### 5. No store map view — locations cannot be visualized geographically
For franchise owners with many stores, a pin-on-map view (using Mapbox or OpenStreetMap) showing all store locations would be more useful than a flat table. Add a map view toggle in `StoresPage` (list | map) that renders pins for each store with a `city`/`address`.

### 6. No "Activity Log" tab on `StoreDetailPage`
There is no way to see a history of changes to the store record from the UI. When was the last time the tax rate changed? Who deactivated the store last month? Add an "Activity" tab reading from `audit_logs WHERE entity_type = 'store' AND entity_id = storeId`.

### 7. No store duplication ("Clone Store") action
Covered in Backend Features #9. The frontend should expose a "Duplicate Store" action in the `StoreRow` dropdown that navigates to `StoreCreationPage` with all fields pre-filled from the source store (except store name, which prompts for a new name).

### 8. No inline store status toggle from the list — only reachable via the dropdown
Activating or deactivating a store requires three clicks: click "..." → find "Activate"/"Deactivate" in the dropdown → click. Given the severity of deactivation (locks out cashiers), the action should be prominent but protected. However, for activation (bringing a store back online quickly during an outage), an inline toggle would reduce emergency response time.

### 9. No store health indicator — no way to see if a store's POS is currently online or offline
`StoresPage` shows Active/Inactive status (set by admins) but not whether the store's POS application is currently connected (heartbeat). Add a last-seen indicator: `StoreRow` could show a green "Online" badge if a session for that store's users was active in the last 5 minutes.

### 10. No "Assign User to Store" quick action on `StoreDetailPage` Team tab
The Team tab shows users but provides no direct action to add a user to the store. The note says "Manage users from the Users page." Add a "Assign User" button that opens a user search modal (using `searchUsers`) to quickly assign an existing user to this store, then calls `updateUser(id, { store_id })`.

---

## CROSS-CUTTING RISKS

### 1. Sync safety — `create_store` and `update_store` sync payloads are critically incomplete (Backend Faults #1 and #2)
The most severe cross-cutting sync risk. New store records replicated to Supabase have only `id` and `is_active`. Every other column is NULL in the cloud. Updates only replicate `store_name` and `is_active`. Supabase's `stores` table is essentially useless for cross-device lookups, cloud dashboards, or recovery scenarios. All cross-store reporting built on Supabase data will be operating on empty store records.

### 2. Sync safety — `logo_data` (up to 500 KB base64 blob) would be included in sync payloads if sync were fixed — Supabase has 1 MB default max row size
If the sync payload for `update_store` is fixed to include all fields (resolving Faults #1/#2), `logo_data` — stored as a base64 data URI — can approach 500 KB. Supabase's default row size limit in PostgreSQL is 1 MB for unTOASTed data. A 500 KB logo plus other columns in a single sync payload row could exceed limits. Additionally, syncing binary data as base64 over the sync queue adds enormous overhead. Store logos should be synced via Supabase Storage (file upload) rather than as base64 in the row payload.

### 3. Multi-store isolation — `get_stores_inner` returns all stores to any user with `stores.read` permission (Backend Fault #9)
A manager with `stores.read` at Store A can enumerate all stores — name, address, phone, email, currency, tax rate, and logo data — of every other franchise location. In a real franchise model, inter-store data leakage (e.g., seeing competitors' tax rates or locations) is a business and legal risk. Non-global users should only receive their own store's data from `get_stores`.

### 4. Security — `update_store` requires `stores.manage` but `stores.js` `activateStore` and `deactivateStore` both call `rpc("update_store", { id, is_active })` — the same permission guards all levels of store mutation
Changing a receipt footer text and deactivating an entire store branch both require `stores.manage`. There is no finer-grained permission like `stores.deactivate` that could be restricted to `super_admin` only while allowing `admin` to update configuration. A rogue `admin` can deactivate any store with no additional permission gate beyond `stores.manage`. Add a `stores.deactivate` permission and check it in `update_store` when `payload.is_active == Some(false)`.

### 5. Offline resilience — deactivating a store while offline is silently queued for sync but does not immediately affect users of that store on other terminals
If a store is deactivated from Terminal A (offline), the change is written to the local DB and queued for sync. Cashiers on Terminal B (a different Tauri instance connected to the same DB or a network DB) will see the store as `is_active = false` immediately if they share the same PostgreSQL instance. But if they have a cached copy of the store (e.g., via `getMyStore` with `staleTime: 2 minutes`), they continue operating for up to 2 minutes after deactivation. This is acceptable for single-terminal setups but is a risk in multi-terminal shared-DB environments.

### 6. Data consistency — `useBranchStore.stores` list (the global React state holding all stores) is populated at startup via `initForUser` and updated only when `useStores` invalidates the `["stores"]` cache — but `StoreCreationPage` updates `activeStore` directly without refreshing the `stores` list
After creating a new store via `StoreCreationPage`, `setActiveStore(newStore)` updates `useBranchStore.activeStore` but the `stores` list (`useBranchStore.stores`) still doesn't include the new store. The StoreSwitcher dropdown (sidebar) will not show the new store until the user refreshes or the next `initForUser` runs. This creates a silent UI inconsistency where the new store is active but doesn't appear in the store picker.

### 7. Data consistency — `tax_rate` is stored as `NUMERIC` in the DB but transmitted as `f64` in the sync payload — floating-point precision loss in Supabase
When `tax_rate = 7.5` is stored as `rust_decimal::Decimal`, it is exact. When serialized to the sync JSON as `serde_json::json!({ "tax_rate": tax })` (which calls `Decimal::to_f64()` internally), it may become `7.499999999999999` or `7.500000000000001`. The Supabase `NUMERIC` column receives this imprecise float. Over time, small rounding errors accumulate in the cloud replica's tax rates. Serialize tax rates as strings in sync payloads: `"tax_rate": tax.to_string()`.

### 8. Offline resilience — `StoreCreationPage` auto-redirects to `/analytics` after 3.1 seconds even if the store creation sync fails silently
`StoreCreationPage` navigates to `/analytics` 3.1 seconds after `create.mutateAsync` resolves. If `create_store` succeeded locally (INSERT committed to local PG) but the sync queue write failed silently (the `queue_row` call uses `.await` with no error propagation — it's fire-and-forget), the user is redirected to the dashboard on a store that may never reach Supabase. This is acceptable for offline-first operation but should be surfaced: "Store created locally. Sync to cloud pending." after navigation.

### 9. Security — `get_store` bypasses `stores.read` for a user's own store but provides no `is_active` check — a cashier at a deactivated store can still fetch their store's full record including `logo_data` and `tax_rate`
`get_store_inner` allows any authenticated user to fetch their own store (`claims.store_id == Some(id)`) without permission check, even if `store.is_active = false`. A deactivated store's cashiers should not be able to query store data (their login should fail first via the login guard), but if they have a valid JWT that hasn't expired yet, they can still call `get_store` on the deactivated store. Add an active check in the "own store" branch:
```rust
let is_own_store = !claims.is_global && claims.store_id == Some(id);
if is_own_store {
    // Verify store is still active before granting access
    let is_active: bool = sqlx::query_scalar!(
        "SELECT is_active FROM stores WHERE id = $1", id
    ).fetch_optional(&pool).await?.unwrap_or(false);
    if !is_active {
        return Err(AppError::Forbidden);
    }
} else {
    guard_permission(state, &token, "stores.read").await?;
}
```

### 10. Data consistency — `useBranchStore.activeStore` in Zustand persists to `localStorage` via `qpos_config` — if a store is deactivated externally (another terminal), the client still has the stale `activeStore` in localStorage and continues using it as active on next launch
On app startup, `initForUser` re-fetches stores from the backend and re-validates the active store. If `activeStore.is_active` is now `false` (deactivated externally), `initForUser` should detect this and clear `activeStore`, triggering the StorePicker. Verify that `initForUser` in `branch.store.js` validates `is_active` after fetching:
```js
const freshStore = stores.find(s => s.id === savedActiveStore?.id && s.is_active);
if (!freshStore) {
    state.activeStore = null;
    state.needsPicker = true;
    return;
}
```
If this check is missing, a cashier at a deactivated store will be shown the POS for a deactivated branch on every app launch until they manually switch stores.

---

## PRIORITY ORDER

These are the top 5 items that MUST be addressed before this module is production-ready, ordered by severity:

1. **[BACKEND FAULT #1 + #2] `create_store` and `update_store` sync payloads are critically incomplete — Supabase receives empty store records** — Every store created on the system replicates to Supabase with only its `id` and `is_active`. All store updates replicate only `store_name` and `is_active`. Every other column (address, phone, currency, tax_rate, timezone, etc.) is missing. The Supabase cloud replica's `stores` table is effectively empty for all meaningful business data. Any cross-device store lookup, cloud dashboard, or disaster-recovery restore from Supabase is broken for this module. This affects every store from the first day of production and silently worsens with every create/update.

2. **[BACKEND FAULT #9] `get_stores_inner` returns all stores to any user with `stores.read` — full cross-store data leak** — A manager at Store A can enumerate every other store in the system: names, addresses, contact details, currencies, tax rates, and if Fault #5 is not fixed, 500 KB logo blobs per store. In a real franchise environment, this is a business data confidentiality breach and potentially a contractual violation between franchisees. Non-global users must only receive data for their own store. This is a one-condition fix (`WHERE id = claims.store_id`) for non-global callers.

3. **[BACKEND FAULT #5] `get_stores_inner` always returns `logo_data` — up to 500 KB per store in every list response** — Every `get_stores` call (list view, `initForUser` startup, `StoresPage`, any hook using `getStores`) returns full base64 logo blobs. With 10 stores each having a 400 KB logo, each `get_stores` call is 4 MB. This is fetched on startup, every 2 minutes, and on every `invalidate()` after mutations. In a long-running POS session, this amounts to hundreds of MB of logo data transmitted unnecessarily. This will cause performance degradation measurable from the first week of production use.

4. **[FRONTEND FAULT #5 + BACKEND FEATURE #4] `ConfigTab` form state does not sync with updated store props, AND deactivating a store does not expire cashier sessions** — These two combine into an operational crisis: (A) `ConfigTab.tax_rate` can silently revert to an old value if the admin uses both OverviewTab and ConfigTab for different edits — a silent data regression in a financial setting. (B) When a store is deactivated, its cashiers continue operating (their sessions are not expired, and the login guard only checks `u.is_active`, not `s.is_active`). Together, these mean a deactivated store's cashiers can continue processing transactions with a potentially incorrect tax rate. Both require immediate fixes.

5. **[FRONTEND FAULT #3] `StoreCreationPage` bypasses `useBranchStore.initForUser` — new store appears active in app but is not in the store picker or stores list** — After creating a new store, `setActiveStore(newStore)` updates the active store in Zustand, but the `stores` list in `useBranchStore` does not include the new store. The sidebar StoreSwitcher, any component reading `useBranchStore(s => s.stores)`, and the `StoresPage` will not show the new store until a manual refresh or app restart. A user creating their very first store via `StoreCreationPage` (the `needsStoreCreation` flow) will be redirected to `/analytics` with an `activeStore` that is not in the `stores` list — this can cause the StorePicker to reappear on next app focus, creating an infinite loop between store creation and store picker.
