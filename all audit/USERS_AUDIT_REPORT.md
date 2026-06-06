# Quantum POS — Production Audit: Users & Permissions Module

**Audited:** 2026-04-29  
**Scope:** `src-tauri/src/commands/users.rs`, `src/features/users/useUsers.js`, `src/features/users/UsersPanel.jsx`, `src/features/users/UserDetailPanel.jsx`, `src/features/users/UserFormDialog.jsx`, `src/features/users/RolePermissionsDialog.jsx`, `src/features/users/roleConfig.js`, `src/features/users/useActiveSessions.js`, `src/features/users/ActiveSessionsSection.jsx`, `src/features/users/AvatarUploader.jsx`, `src/commands/users.js`.

---

## BACKEND FAULTS (must fix before production)

### 1. `create_user` queues `password_hash` in plain text to `sync_queue` — cloud receives bcrypt hash which can be brute-forced offline
**Where:** `src-tauri/src/commands/users.rs` — `create_user()`, the `queue_row` call  
**What:**
```rust
crate::database::sync::queue_row(
    &pool, "users", "INSERT", &id.to_string(),
    serde_json::json!({
        "id": id, "username": payload.username,
        "password_hash": hash,   // ← full bcrypt hash goes to Supabase
        ...
    }),
    payload.store_id,
).await;
```
The full `password_hash` (bcrypt hash) is stored in the Supabase `sync_queue` table as part of the JSON payload. Anyone with read access to Supabase (service role key, Supabase dashboard, or a breach) receives every user's bcrypt hash. While bcrypt is one-way, offline brute-force attacks against weak passwords become possible. Supabase is an external third-party service — password hashes must never leave the local POS instance.  
**Fix:** Strip `password_hash` from the sync payload entirely. Supabase should store a sanitised user record without credentials:
```rust
serde_json::json!({
    "id": id, "username": payload.username, "email": payload.email,
    "first_name": payload.first_name, "last_name": payload.last_name,
    "phone": payload.phone, "role_id": payload.role_id,
    "store_id": payload.store_id, "is_active": true,
    // NO password_hash
})
```

### 2. `create_user` has no uniqueness check before INSERT — duplicate usernames and emails produce a raw DB constraint error
**Where:** `src-tauri/src/commands/users.rs` — `create_user()`  
**What:** The only uniqueness enforcement is the PostgreSQL UNIQUE constraint on `users.username` and `users.email`. When violated, SQLx propagates `sqlx::Error::Database` with the PG error message `duplicate key value violates unique constraint "users_username_key"`. The HTTP RPC dispatcher surfaces this as a generic 500 or a stringified constraint error. The frontend `onMutationError` toast shows the raw Postgres message to the cashier: `"duplicate key value violates unique constraint 'users_username_key'"`.  
**Fix:** Check before inserting:
```rust
let exists: bool = sqlx::query_scalar!(
    "SELECT EXISTS(SELECT 1 FROM users WHERE username = $1 OR email = $2)",
    payload.username.trim(), payload.email.trim().to_lowercase(),
).fetch_one(&pool).await?;
if exists {
    // determine which field conflicts for a targeted error
    let username_taken: bool = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM users WHERE username = $1)", payload.username
    ).fetch_one(&pool).await?;
    return Err(AppError::Validation(if username_taken {
        format!("Username '{}' is already taken.", payload.username)
    } else {
        format!("Email '{}' is already registered.", payload.email)
    }));
}
```

### 3. `update_user` sets `store_id = $6` unconditionally — passing `store_id: null` clears a user's store assignment silently
**Where:** `src-tauri/src/commands/users.rs` — `update_user()`  
**What:**
```sql
UPDATE users SET
  ...
  store_id = $6,       -- NOT COALESCE, always overwrites
  ...
WHERE id = $8
```
All other fields use `COALESCE($n, current_value)` so `null` means "no change." But `store_id` is assigned directly. If the frontend sends `store_id: null` (which `UserFormDialog` does when "All stores (global)" is selected: `form.store_id ? parseInt(form.store_id) : null`), the user's store assignment is silently cleared to `NULL`. A cashier who was assigned to Store A and whose profile is edited for any reason (e.g., updating their phone number) could lose their store assignment if the editor accidentally sends `store_id: null`. This is a silent data-corrupting behavior.  
**Fix:** Decide explicitly between "no-change" and "clear":
- Add a separate `clear_store_id: bool` field to `UpdateUserDto`, OR
- Distinguish `Some(None)` (clear) from `None` (no change) in the DTO using `Option<Option<i32>>`:
```rust
// In UpdateUserDto:
pub store_id: Option<Option<i32>>,  // None = no change, Some(None) = clear, Some(Some(n)) = set

// In query:
store_id = CASE WHEN $6::bool THEN $7 ELSE store_id END
//         $6 = payload.store_id.is_some(), $7 = payload.store_id.flatten()
```

### 4. `activate_user` and `deactivate_user` have no guard against acting on the currently authenticated user
**Where:** `src-tauri/src/commands/users.rs` — `activate_user()`, `deactivate_user()`  
**What:** Neither command checks whether `id == claims.user_id`. A bug in the frontend (or a malicious RPC call) could result in `deactivate_user` being called with the current admin's own `id`, immediately expiring their session and locking them out. While the frontend `UserRow` correctly hides the "Deactivate" button for `isSelf`, this is enforced only in the UI — the backend has no matching guard.  
**Fix:**
```rust
let claims = guard_permission(&state, &token, "users.update").await?;
if id == claims.user_id {
    return Err(AppError::Validation(
        "You cannot activate or deactivate your own account.".into()
    ));
}
```
Apply to both `activate_user` and `deactivate_user`.

### 5. `reset_user_password` does not invalidate existing sessions — the user can continue using the old password's tokens until natural expiry
**Where:** `src-tauri/src/commands/users.rs` — `reset_user_password()`  
**What:** After a password reset, `user_sessions` (refresh tokens) and `active_sessions` are not expired. A user whose password was just reset by an admin can still use their existing refresh token to silently obtain a new access token — effectively ignoring the password reset for up to the token's natural TTL (typically hours). If the password was reset due to a suspected breach, the attacker retains access for the full token lifetime.  
**Fix:** Mirror the session invalidation logic from `deactivate_user`:
```rust
// After updating password_hash:
sqlx::query!(
    "UPDATE active_sessions SET expires_at = NOW()
     WHERE user_id = $1 AND expires_at > NOW()", id
).execute(&pool).await.ok();
sqlx::query!(
    "UPDATE user_sessions SET expires_at = NOW()
     WHERE user_id = $1 AND expires_at > NOW()", id
).execute(&pool).await.ok();
state.sessions.write().await.retain(|_, s| s.user_id != id);
```

### 6. `set_role_permissions` inserts permissions one-by-one in a loop — N round-trips inside an open write transaction
**Where:** `src-tauri/src/commands/users.rs` — `set_role_permissions()`  
**What:**
```rust
for perm_id in &permission_ids {
    sqlx::query!(
        "INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        role_id, perm_id
    )
    .execute(&mut *tx)
    .await?;
}
```
A role with 40 permissions runs 40 separate INSERTs inside an open transaction. This is slow and holds locks on `role_permissions` longer than necessary.  
**Fix:** Use a batch insert with `UNNEST`:
```rust
let perm_ids_slice: Vec<i32> = permission_ids;
sqlx::query!(
    r#"INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, UNNEST($2::int[])
       ON CONFLICT DO NOTHING"#,
    role_id,
    &perm_ids_slice as &[i32],
)
.execute(&mut *tx).await?;
```

### 7. `get_users` WHERE clause is duplicated verbatim between COUNT query and data query — four-condition duplication
**Where:** `src-tauri/src/commands/users.rs` — `get_users()`  
**What:** The 4-condition WHERE clause (`store_id`, `role_id`, `is_active`, `search`) is copy-pasted identically in both the `COUNT(*)` query and the paginated data query. Any future filter change (e.g., adding `is_global` filter) must be applied in two places and is prone to drift.  
**Fix:** Use a CTE:
```sql
WITH filtered AS (
    SELECT u.*, r.role_slug, r.role_name, r.is_global, s.store_name
    FROM users u
    JOIN roles r ON r.id = u.role_id
    LEFT JOIN stores s ON s.id = u.store_id
    WHERE <shared conditions>
)
SELECT COUNT(*) FROM filtered;
-- then:
SELECT * FROM filtered ORDER BY created_at DESC LIMIT $5 OFFSET $6;
```

### 8. `upload_user_avatar` stores a raw base64 data URI (up to 400 KB) in the `users` table — bloats every `get_user` and `get_users` response with the full image blob
**Where:** `src-tauri/src/commands/users.rs` — `upload_user_avatar()` and `get_users()` / `get_user()`  
**What:** Every `SELECT` on `users` returns the full `avatar` column, which can be up to 400 KB of base64 data. `get_users` returns a paginated list of 15–200 users — each response could be 15 × 400 KB = 6 MB for a full page of users who all have avatars. This is sent over the HTTP RPC connection on every list render, sidebar render, and session check.  
**Fix:** Store avatars outside the `users` row — either as a file path on disk (in Tauri's `AppDataDir`) or in a separate `user_avatars` table. Return only a URL or file path in the `User` model. For the list view, exclude `avatar` entirely and fetch it only on detail view:
```sql
-- In get_users (list): omit avatar column
-- In get_user (detail): include avatar column
```
As a minimum fix before the above refactor: add `LEFT(u.avatar, 0) AS avatar` to `get_users` list query to return `NULL` avatars in list view, and only include the full avatar in `get_user`.

### 9. `create_user` and `update_user` do not validate that the provided `role_id` and `store_id` actually exist before INSERT/UPDATE
**Where:** `src-tauri/src/commands/users.rs` — `create_user()`, `update_user()`  
**What:** If the frontend sends an invalid `role_id` (e.g., `999`) or `store_id` (e.g., `-1`), the FK constraint on the `users` table will reject the insert with a raw Postgres FK violation error, which surfaces as a generic 500. There is no pre-flight check that gives the user a meaningful error message.  
**Fix:** Validate before the INSERT/UPDATE:
```rust
let role_exists: bool = sqlx::query_scalar!(
    "SELECT EXISTS(SELECT 1 FROM roles WHERE id = $1)", payload.role_id
).fetch_one(&pool).await?;
if !role_exists {
    return Err(AppError::Validation(format!("Role {} does not exist.", payload.role_id)));
}
if let Some(sid) = payload.store_id {
    let store_exists: bool = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM stores WHERE id = $1 AND is_active = TRUE)", sid
    ).fetch_one(&pool).await?;
    if !store_exists {
        return Err(AppError::Validation(format!("Store {} does not exist or is inactive.", sid)));
    }
}
```

### 10. `get_user` has no store-scope check — any authenticated user with `users.read` can fetch any user by ID from any store
**Where:** `src-tauri/src/commands/users.rs` — `get_user()`  
**What:** `guard_permission("users.read")` passes for any authenticated user with that permission. There is no check that the requested user belongs to the caller's store. A cashier from Store A who knows a user ID from Store B can call `get_user(store_b_user_id)` and receive that user's full profile: email, phone, role, store assignment, avatar. `get_users` correctly applies `store_id` filtering for non-global users, but `get_user` (used by the detail panel) has no such guard.  
**Fix:**
```rust
let claims = guard_permission(&state, &token, "users.read").await?;
let user = fetch_user(&pool, id).await?;
if !claims.is_global {
    let caller_store = claims.store_id.ok_or(AppError::Forbidden)?;
    if user.store_id != Some(caller_store) {
        return Err(AppError::Forbidden);
    }
}
Ok(user)
```

---

## BACKEND UPGRADES (should improve)

### 1. `get_users` KPI query in the frontend fires a second `useUsers(kpiFilters)` call fetching up to 200 users just to count active/inactive
In `UsersPanel`, a separate unfiltered `useUsers({ limit: 200, page: 1 })` query runs to derive `activeAll` and `inactiveAll` counts:
```js
const { data: allData } = useUsers(kpiFilters); // fetches up to 200 full User records
const activeAll = allUsers.filter((u) => u.is_active).length;
```
This fetches up to 200 full user rows (including avatar blobs, once Fault #8 exists) just to count two numbers. Add a dedicated backend command `get_user_stats(store_id?)` returning `{ total, active, inactive }` counts via a single aggregate query, eliminating the second full-list fetch.

### 2. Missing database indexes on `users` table filter columns
`get_users` filters on `store_id`, `role_id`, `is_active`, and text-search across `username`, `email`, `first_name`, `last_name`. For an installation with hundreds of users across multiple stores, these are full table scans:
```sql
CREATE INDEX IF NOT EXISTS idx_users_store_id   ON users(store_id);
CREATE INDEX IF NOT EXISTS idx_users_role_id    ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_users_is_active  ON users(is_active, store_id);
-- For ILIKE text search, add a GIN trigram index:
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_users_search_trgm
    ON users USING GIN ((username || ' ' || email || ' ' || first_name || ' ' || last_name) gin_trgm_ops);
```

### 3. `set_role_permissions` does not audit which permissions were added or removed
The `write_audit_log` call for `set_role_permissions` is missing entirely — there is no audit entry when a role's permissions change. Permission changes are among the most security-sensitive operations in the system (granting `transactions.void` to `cashier` role, for example). Every permission change must be audited with a before/after diff:
```rust
// Before the DELETE, fetch current permissions
let old_perms: Vec<i32> = sqlx::query_scalar!(
    "SELECT permission_id FROM role_permissions WHERE role_id = $1", role_id
).fetch_all(&pool).await?;

// After commit:
write_audit_log(&pool, claims.user_id, None, "update", "role_permissions",
    &format!(
        "Role {} permissions changed. Added: {:?}. Removed: {:?}",
        role_id,
        permission_ids.iter().filter(|p| !old_perms.contains(p)).collect::<Vec<_>>(),
        old_perms.iter().filter(|p| !permission_ids.contains(p)).collect::<Vec<_>>(),
    ),
    "warning",
).await;
```

### 4. `activate_user` and `deactivate_user` do not produce audit log entries
`delete_user` calls `write_audit_log`. `activate_user` and `deactivate_user` do not. A manager activating a previously suspended user, or deactivating a rogue employee, produces no audit trail. These are security-relevant events that must be logged:
```rust
// In activate_user:
write_audit_log(&pool, claims.user_id, claims.store_id,
    "activate", "user", &format!("Activated user id {id}"), "info").await;

// In deactivate_user:
write_audit_log(&pool, claims.user_id, claims.store_id,
    "deactivate", "user", &format!("Deactivated user id {id}"), "warning").await;
```

### 5. `reset_user_password` does not produce an audit log entry
A password reset is a highly security-sensitive action. There is no `write_audit_log` call in `reset_user_password`. If a rogue admin resets a user's password, there is no record of it in the audit trail.  
**Fix:**
```rust
write_audit_log(&pool, claims.user_id, claims.store_id,
    "reset_password", "user",
    &format!("Password reset for user id {id}"),
    "warning",
).await;
```

### 6. `get_roles` returns all roles without `store_id` scope — global admins can enumerate all roles but there is no per-role user count in the response
`get_roles` returns the raw role list but no user count per role. `UsersPanel` does a `allUsers.filter(u => u.role_id === role.id).length` client-side (from its already-fetched 200-user list) to compute user counts per `RoleCard`. This computation is incorrect when `allUsers` only has 200 of potentially 500+ users. Add `user_count` to the role query:
```sql
SELECT r.*, COUNT(u.id) FILTER (WHERE u.is_active) AS active_user_count,
       COUNT(u.id) AS total_user_count
FROM roles r
LEFT JOIN users u ON u.role_id = r.id
GROUP BY r.id
ORDER BY r.hierarchy_level
```

### 7. `search_users` has no `store_id` scope filter — searches all users across all stores regardless of caller's scope
`search_users` accepts a `query` string and a `limit` but no `store_id` parameter. A non-global cashier calling `search_users("john")` will receive matching users from all stores in the system. This is used by the command palette and any user-picker components. Add an optional `store_id` filter:
```rust
pub async fn search_users(
    state: State<'_, AppState>,
    token: String,
    query: String,
    store_id: Option<i32>,
    limit: Option<i64>,
) -> AppResult<Vec<User>> {
    let claims = guard_permission(&state, &token, "users.read").await?;
    let effective_store_id = if claims.is_global { store_id } else { claims.store_id };
    // ... add ($5::int IS NULL OR u.store_id = $5) to WHERE
}
```

### 8. `upload_user_avatar` calls `get_user(state, token, id)` after uploading — re-runs the full permission check and SELECT unnecessarily
After updating `avatar`, the command calls:
```rust
get_user(state, token, id).await
```
This repeats the `guard_permission("users.read")` check and the full JOIN select. Since the avatar was just set, the updated user can be fetched with a simpler targeted query that only reads the user row (not a full permission-guarded command chain). Use a direct DB fetch instead:
```rust
fetch_user_by_id(&pool, id).await
```
Where `fetch_user_by_id` is a shared helper that does the JOIN without a permission gate.

### 9. `UsersPanel` KPI stat cards compute `activeAll`/`inactiveAll` from a local `.filter()` that is capped at 200 users and never reflects total counts
The frontend's `kpiFilters` uses `limit: 200`. If a store has 300 users, `allUsers.filter(u => u.is_active).length` only counts the first 200 (by `created_at DESC`). The "Active: 187" and "Inactive: 13" cards would be wrong. Move the count to the backend (Upgrade #1 above) or at minimum use `allData?.total` instead of `allUsers.filter().length` for the "Total Users" card (this is already done correctly but active/inactive derives from the fetched array, not the total).

### 10. `delete_user` (soft-delete) does not queue a sync event to Supabase
`delete_user` updates `is_active = FALSE` locally but never calls `queue_row`. The Supabase replica continues to show the user as active. Compare with `create_user` and `update_user` which both call `queue_row`. Add a sync entry after the soft-delete:
```rust
crate::database::sync::queue_row(
    &pool, "users", "UPDATE", &id.to_string(),
    serde_json::json!({ "id": id, "is_active": false }),
    None,
).await;
```

---

## BACKEND FEATURES (add for completeness)

### 1. No role hierarchy enforcement — a `manager` can promote another user to `super_admin`
`create_user` and `update_user` accept any `role_id` without validating that the caller has a sufficiently high `hierarchy_level` to assign that role. A `manager` (hierarchy 4) could call `update_user(id, { role_id: super_admin_id })` and promote themselves or another user to `super_admin` (hierarchy 1).  
**Fix:** Add a hierarchy check:
```rust
let caller_role_level: i32 = sqlx::query_scalar!(
    "SELECT hierarchy_level FROM roles WHERE id = (SELECT role_id FROM users WHERE id = $1)",
    claims.user_id
).fetch_one(&pool).await?;
let target_role_level: i32 = sqlx::query_scalar!(
    "SELECT hierarchy_level FROM roles WHERE id = $1", payload.role_id
).fetch_one(&pool).await?;
if target_role_level <= caller_role_level {
    return Err(AppError::Forbidden);
}
```

### 2. No PIN management on the backend for admin-initiated PIN reset
`set_pos_pin` exists in `security` commands, but there is no `reset_user_pin(user_id)` admin command. A store manager cannot reset a forgotten cashier PIN without direct DB access. Add an admin-gated `reset_user_pin(id)` command (guarded by `users.update`) that sets the cashier's POS PIN to `null` (forcing them to set a new one on next POS lock screen).

### 3. No `get_user_activity` summary — no way to see what a given user has done
There is no backend command returning activity summary for a specific user: how many transactions they processed today, their last shift, their most recent sales. A manager investigating a cashier's actions must query `audit_logs` manually. Add `get_user_activity(user_id, date_from, date_to)` returning key metrics.

### 4. No time-based access control (working hours / shift restrictions)
There is no mechanism to restrict a user's login to certain hours (e.g., a cashier should only be able to log in between 7 AM and 9 PM). Cashiers logging in outside their shift hours is a theft risk. Add a `login_start_time` / `login_end_time` columns to users or a `user_schedule` table, and enforce in the `login` command.

### 5. No user invitation / onboarding flow
New users are created with a password set by the admin and communicated out-of-band. There is no email invitation or first-login forced password change. A user whose password was verbally communicated poses a security risk — admins may never know if the user changed it. Add a `must_change_password: bool` column to `users` and enforce a redirect to a change-password screen after first login.

### 6. No bulk user operations — no `bulk_activate`, `bulk_deactivate`, or `bulk_role_change`
Managing 50 users whose store is being restructured requires individual API calls. Add `bulk_update_users(ids: Vec<i32>, patch: BulkUserPatch)` for activation, deactivation, and role reassignment, gated on `users.update`.

### 7. No `get_role_by_slug` command — role config is entirely frontend-defined
`roleConfig.js` hard-codes 5 role slugs and their UI styling. If a new role is added via migration, the frontend has no way to learn about it. The backend returns roles via `get_roles` (good), but there is no command to fetch a role's full configuration (description, `is_global`, hierarchy level) by slug. This is minor but becomes a maintenance issue as the role set grows.

### 8. No failed-login tracking per user — impossible to detect brute force or locked accounts
`users.last_login` is updated on success but failed login attempts are not recorded. There is no `failed_login_count` or `locked_until` column. A brute-force attack on a cashier's account will never trigger a lockout. Add failed login tracking and an account lockout after N consecutive failures.

### 9. No cascade behavior when a `store` is deactivated — users assigned to that store remain active with broken `store_id` references
When a store is soft-deleted (`is_active = FALSE`), its assigned users remain with `store_id` pointing to the now-inactive store. These users can still log in and operate as if the store exists. Add an event hook in the stores deactivation command that either reassigns or deactivates all users assigned to the deactivated store.

### 10. No `get_session_history` for a specific user — only current active sessions are visible
`get_active_sessions` shows only live sessions. There is no way to see historical login history for a user: when they logged in, from where, how long sessions lasted. Add a `session_history` table (or query `user_sessions` with `expires_at < NOW()`) and a `get_user_session_history(user_id, limit)` command for forensic investigation.

---

## FRONTEND FAULTS (must fix before production)

### 1. `UserFormDialog` username field is disabled on edit but the backend's `update_user` uses `COALESCE(email, current)` — username is never sent on update, so renaming is silently ignored
**Where:** `src/features/users/UserFormDialog.jsx` — `handleSubmit()` and field `disabled={isEdit}`  
**What:** The `username` input is disabled on edit (`disabled={isEdit}`). The payload built in `handleSubmit` includes `username: form.username.trim()` unconditionally regardless of `isEdit`. However, `UpdateUserDto` in the backend likely has no `username` field (or ignores it), meaning username changes are silently discarded if the field were enabled. More critically: the `username` field is disabled, but it's still included in the payload — wasting bandwidth. More seriously, if the disabled-input value is stale (user's username changed in another tab, UI shows old value), the payload sends an old username that is harmlessly ignored — but this creates a confusing discrepancy.  
**Fix:** Explicitly exclude `username` from the update payload:
```js
const payload = {
    email:      form.email.trim(),
    first_name: form.first_name.trim(),
    last_name:  form.last_name.trim(),
    phone:      form.phone.trim() || null,
    role_id:    parseInt(form.role_id),
    store_id:   form.store_id ? parseInt(form.store_id) : null,
};
if (!isEdit || form.password) payload.password = form.password;
// username NOT included on edit
```

### 2. `UsersPanel` KPI stat cards use a stale second query that silently under-counts when total > 200
**Where:** `src/features/users/UsersPanel.jsx` — `kpiFilters` and derived `activeAll`/`inactiveAll`  
**What:**
```js
const kpiFilters = useMemo(() => ({ ..., limit: 200, page: 1 }), [...]);
const { data: allData } = useUsers(kpiFilters);
const allUsers = useMemo(() => allData?.data ?? [], [allData]);
const activeAll = allUsers.filter((u) => u.is_active).length;
```
If there are 350 users, `allData.data` contains only 200. `activeAll` may show "200" when the true count is higher, or "170" when the true count is 250. The "Active" and "Inactive" stat cards are numerically wrong for any store with > 200 users — a production system with 3 years of history.  
**Fix:** Use `allData?.total` for "Total Users" (already correct). For active/inactive counts, either add a dedicated backend stats endpoint, or derive from the backend's response metadata if the backend adds `active_count`/`inactive_count` to the paginated response.

### 3. `RolePermissionsDialog` `isDirty` check compares `checked.size !== grantedIds.length` — passes if a user swaps one permission for another of same count
**Where:** `src/features/users/RolePermissionsDialog.jsx` — `isDirty` useMemo  
**What:**
```js
const isDirty = useMemo(() => {
    if (checked.size !== grantedIds.length) return true;
    return grantedIds.some((id) => !checked.has(id));
}, [checked, grantedIds, isLoading]);
```
This logic is actually correct — if sizes match AND all old IDs are in `checked`, then nothing changed. However, if `grantedIds` contains duplicates (possible if the DB query returns duplicates), `checked` (a `Set`) deduplicates them, making `checked.size !== grantedIds.length` always true. The dialog will always show "Save Permissions" as enabled even when nothing has changed. This causes unnecessary API calls and permission cache invalidation.  
**Fix:** Deduplicate `grantedIds` when initializing `checked`:
```js
useEffect(() => {
    if (open && !isLoading) {
        setChecked(new Set(grantedIds));  // Set deduplicates automatically
    }
}, [open, isLoading, grantedIds]);

// Also deduplicate for the dirty check:
const grantedSet = useMemo(() => new Set(grantedIds), [grantedIds]);
const isDirty = useMemo(() => {
    if (isLoading) return false;
    if (checked.size !== grantedSet.size) return true;
    return [...checked].some((id) => !grantedSet.has(id));
}, [checked, grantedSet, isLoading]);
```

### 4. `ActiveSessionsSection` filters sessions client-side by `expires_at > now` but this filters AFTER fetching — expired sessions transit the network unnecessarily
**Where:** `src/features/users/ActiveSessionsSection.jsx` — `activeSessions` derivation  
**What:**
```js
const activeSessions = sessions.filter((s) => new Date(s.expires_at) > now);
```
All sessions (including expired ones) are fetched from the backend, then filtered client-side. In a system with many old expired sessions that haven't been cleaned up, this causes unnecessary data transfer. The backend `get_active_sessions` command should filter `WHERE expires_at > NOW()` in SQL. If it already does, this client-side filter is a no-op (correct but redundant). If it doesn't, data is wasted.  
**Fix:** Verify the backend query and ensure it filters `WHERE expires_at > NOW()`. Remove the client-side filter as defensive-but-redundant code, and add a comment noting it.

### 5. `AvatarUploader` `processImage` has no max dimension validation before canvas resize — enormous images (e.g., 10000×10000 px) will freeze the browser tab during canvas operations
**Where:** `src/features/users/AvatarUploader.jsx` — `processImage(file)` function  
**What:** The function reads the entire image file into memory, decodes it, draws it to a canvas — all synchronously in the browser's main thread. A malformed or deliberately large image (e.g., a 50 MB PNG at 10,000×10,000 px) will cause the browser to allocate hundreds of MB of memory and block the Tauri webview's UI thread for several seconds, potentially causing the app to appear frozen or crash the renderer.  
**Fix:** Add an early size check before processing:
```js
async function processImage(file) {
    if (!file.type.startsWith("image/")) throw new Error("Please select an image file.");
    const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
    if (file.size > MAX_FILE_SIZE_BYTES) throw new Error("Image too large. Please select a file under 10 MB.");
    // ... rest of processing
}
```

### 6. `UserDetailPanel` resets `localUser` state using a ref-comparison pattern inside the render function — this is a React anti-pattern that can cause extra renders and inconsistent state
**Where:** `src/features/users/UserDetailPanel.jsx` — `prevUserIdRef` and the `if (user?.id !== prevUserIdRef.current)` block  
**What:**
```js
const prevUserIdRef = useRef(user?.id);
if (user?.id !== prevUserIdRef.current) {
    prevUserIdRef.current = user?.id;
    setLocalUser(null);  // state update DURING render
}
```
Calling `setLocalUser(null)` unconditionally inside the render body (not inside a `useEffect`) is a React anti-pattern. It causes an immediate synchronous re-render, doubling the render work. React may emit a warning about this in strict mode.  
**Fix:** Use `useEffect` for the reset:
```js
useEffect(() => {
    setLocalUser(null);
}, [user?.id]);
```

### 7. `UsersPanel` pagination renders at most 7 page buttons with `Math.min(totalPages, 7)` — for page 8+ the user cannot navigate there from the pagination control
**Where:** `src/features/users/UsersPanel.jsx` — the pagination `Array.from({ length: Math.min(totalPages, 7) })` block  
**What:**
```jsx
{Array.from({ length: Math.min(totalPages, 7) }).map((_, i) => {
    const p = i + 1;
    return <button key={p} onClick={() => setPage(p)}>{p}</button>;
})}
```
This always renders pages 1–7. If there are 12 pages and the user is on page 1, they can reach page 7 using the buttons. But there is no "..." ellipsis or "last page" button — page 8 through 12 are only reachable by clicking "next" one at a time. For a store with 180+ users at page size 15, this is 12 pages. A manager jumping to page 10 must click "Next" 9 times.  
**Fix:** Implement a sliding window pagination that shows: first page, `...`, (current-1), current, (current+1), `...`, last page — the standard pattern used by the shared `DataTable` component.

### 8. `UserFormDialog` allows creation of a user with `store_id: null` for any role, including `cashier` — cashiers without a store will break the POS
**Where:** `src/features/users/UserFormDialog.jsx` — store field and `handleSubmit()`  
**What:** The store select has "All stores (global)" as the first option and allows any role to have `store_id: null`. Creating a `cashier` with no store assignment means `claims.store_id` will be `null` in every backend guard, breaking any command that calls `claims.store_id.ok_or(AppError::Forbidden)`. The cashier will see 403 errors on nearly every POS operation.  
**Fix:** Add client-side validation in `validate()`:
```js
const selectedRole = roles.find((r) => String(r.id) === form.role_id);
if (!selectedRole?.is_global && !form.store_id) {
    e.store_id = "Required for store-scoped roles (cashier, stock keeper, manager)";
}
```

### 9. `ActiveSessionsSection` "Revoke" button is visible and clickable for the current user's own session — `isCurrentUser` only styles it, doesn't truly disable it
**Where:** `src/features/users/ActiveSessionsSection.jsx` — the Revoke button for `isCurrentUser`  
**What:**
```jsx
className={cn(
    "h-7 gap-1 text-[10px] px-2 transition-colors",
    isCurrentUser
        ? "text-muted-foreground/40 cursor-not-allowed"
        : "...",
)}
```
The button has `cursor-not-allowed` styling when `isCurrentUser`, but it is NOT actually disabled. `onClick={() => setConfirmSession(s)}` still fires when clicked (despite the cursor style). A user can open the confirm dialog for their own session and revoke themselves. The backend would need to validate this, but there is no guard there either (Fault #4-adjacent).  
**Fix:**
```jsx
<Button
    disabled={revoke.isPending || isCurrentUser}  // ← add isCurrentUser
    onClick={() => !isCurrentUser && setConfirmSession(s)}
    ...
/>
```

### 10. `RolePermissionsDialog` has no confirmation dialog before saving permissions — one click applies permissions to all users of that role with no undo
**Where:** `src/features/users/RolePermissionsDialog.jsx` — `handleSave()`  
**What:** Clicking "Save Permissions" immediately calls `setPerms.mutateAsync(...)` with no confirmation step. Accidentally granting `transactions.void` to the `cashier` role affects every cashier in the store instantly and permanently (until manually reversed). A production POS system must require confirmation for this sensitive operation.  
**Fix:** Show a confirmation dialog before `handleSave`:
```jsx
const [confirmOpen, setConfirmOpen] = useState(false);
// Replace onClick={handleSave} with onClick={() => setConfirmOpen(true)}
// Then render a ConfirmDialog that summarizes changes and calls handleSave on confirm
```

---

## FRONTEND UPGRADES (should improve)

### 1. `UsersPanel` search input does not debounce — every keystroke triggers a query
**Where:** `src/features/users/UsersPanel.jsx` — the `Input` `onChange` handler  
**What:** `onChange={(e) => setSearch(e.target.value)}` directly updates the URL param via `usePaginationParams`, which immediately changes the `filters` memo, immediately triggering a new `useUsers(filters)` query. Typing "john doe" fires 8 network requests. The `ReturnsPanel` and `TransactionsPanel` debounce at 300 ms.  
**Fix:** Add a debounce (300 ms) before applying `search` to the query key, matching the other panels' pattern.

### 2. `RoleCard` user count is computed from a stale 200-user client-side list — inaccurate for large stores
Already noted in Backend Upgrade #6. The frontend computes `usersInRole.length` by filtering `allUsers` (max 200). Move role user counts to the backend query.

### 3. `UserDetailPanel` shows `User ID: #42` but the ID is a raw integer with no context — showing it as "ID: 42" looks like internal data exposed accidentally
Change to show the formatted display without implying it's user-facing: either remove it or label it "Internal ID" and hide it from non-admin roles.

### 4. `UsersPanel` "Roles & Permissions" section `RoleCard` user count shows 0 for all roles when `allUsers` is empty (e.g., on first load or error)
When the KPI `useUsers(kpiFilters)` query is loading or errored, `allUsers` is `[]`, making every role show "0 users." The real count only appears once the 200-user fetch completes. During the loading flash, all role cards show "0 users" which is confusing.  
**Fix:** Show a loading skeleton for the user count while `kpiFilters` query is in `isLoading` state, rather than showing "0 users."

### 5. `AvatarUploader` displays `"Max ~200 KB"` hint but the backend enforces `400_000` bytes (400 KB) — limit is inconsistent
The hint says "Max ~200 KB" but the backend max is `400_000` bytes ≈ 390 KB. When the canvas produces a WebP output between 200–390 KB, the upload succeeds but the hint told the user it would fail. Change the hint to match the backend: "Max ~400 KB after resize."

### 6. `UserDetailPanel` "Edit Profile" button in the actions section triggers `onEdit(user)` but `user` at this point may be stale — it uses the prop, not `effectiveUser`
```js
onClick={() => onEdit(user)}  // ← uses prop, not effectiveUser
```
`effectiveUser` is `localUser ?? user`. If the avatar was just changed (localUser is set), clicking "Edit Profile" passes the old `user` object (without the new avatar URL) to the edit form. The edit form would then overwrite the new avatar with the old one if the form pre-fills avatar data.  
**Fix:** `onClick={() => onEdit(effectiveUser)}`.

### 7. `UsersPanel` page-number rendering is `Array.from({ length: Math.min(totalPages, 7) }).map((_, i) => i + 1)` — always shows pages 1–7 regardless of current page (see Fault #7)
Addressed in Fault #7 above. This is also a UX upgrade concern — use a proper sliding window component.

### 8. `ActiveSessionsSection` `uniqueUsers` count includes expired sessions that will be filtered out — the "N unique users" count in the header is wrong
```js
const uniqueUsers = new Set(activeSessions.map((s) => s.user_id)).size;
```
Wait — `activeSessions` is already filtered to `expires_at > now`. But `uniqueUsers` is computed from the post-filter `activeSessions` array. This is actually correct. The issue is that the `uniqueUsers` display in the header runs before `activeSessions` is computed (the count is in the header, computed from `activeSessions`). If `sessions` comes back as `[]`, `uniqueUsers = 0` immediately, which is correct. No bug here — but the count should include a "total users logged in" label more prominently.

### 9. `RolePermissionsDialog` does not show which users are currently in the role being edited — a manager editing "Cashier" permissions has no idea how many people will be affected
Add a `"{N} users will be affected"` note in the dialog footer or header, fetched from the already-loaded `allUsers.filter(u => u.role_id === role.id).length`.

### 10. `UsersPanel` `hasFilters` check omits `page > 1` — the "Clear" button doesn't appear when the user navigated to a later page through pagination alone
```js
const hasFilters = search || roleFilter !== "all" || statusFilter !== "all" || storeFilter !== "all";
```
`page > 1` is not included. This is intentional (page is a navigation state, not a filter), but a user on page 4 of a filtered result set cannot see that they're on page 4 from the Clear button. Minor but worth noting — at minimum, the filter bar should show the current page number in a subtle way.

---

## FRONTEND FEATURES (add for completeness)

### 1. No bulk actions on the users table
There is no multi-select or "Select All" capability. Bulk deactivating 30 users when restructuring a store requires 30 individual dropdown clicks. Add checkboxes and a "Bulk Deactivate / Activate / Change Role" toolbar visible when rows are selected.

### 2. No user activity timeline on `UserDetailPanel`
The detail drawer shows static profile data (email, phone, role, last login). There is no activity summary: how many transactions today, which shift is active, last items sold. A manager investigating a cashier needs this context immediately. Add an "Activity" tab or expandable section in the drawer.

### 3. No CSV export for the users list
Managers sometimes need to export user data for HR records, payroll cross-reference, or compliance. Add a "Export CSV" button (with `users.read` permission) that downloads current filtered results.

### 4. No user profile "last activity" beyond `last_login` timestamp
`last_login` shows when the user last authenticated, but not when they last did something. A cashier who logged in 3 weeks ago and has done nothing should be visible to a manager. Add a `last_activity_at` column (updated on API call) and show it in the detail panel.

### 5. No inline role change from the users table
Changing a user's role requires: click "..." → Edit → change role → Save. For a manager onboarding 10 users, this is 10 × 4 clicks. Add an inline role picker directly in the `UserRow` table for `canUpdate` users (similar to how status is toggled via the dropdown).

### 6. No global search across users in the command palette integration
The command palette (`Ctrl+K`) uses `searchUsers` for user lookups. But there is no dedicated search experience on the Users page itself — the search input in the filter bar only works within the paginated list. The full-text search result from the command palette should navigate directly to the user's detail panel.

### 7. No "Sessions" tab or view per user — `UserDetailPanel` does not show that user's active sessions
A manager viewing a specific user's profile cannot see which devices that user is currently logged in on. Add a "Sessions" section in `UserDetailPanel` showing active sessions for `user.id` only (a filtered `useActiveSessions` scoped to that user).

### 8. No "Audit Log" tab per user in `UserDetailPanel`
The detail drawer has no link to the audit log filtered for that user's actions. A manager investigating suspicious activity must navigate to the full audit log and manually filter by user. Add an "Audit" section or link in the detail drawer.

### 9. No two-factor authentication (TOTP/PIN) enforcement option per role
There is no way to require higher-privileged roles (e.g., `admin`, `super_admin`) to use a second factor. The `Set POS PIN` section exists for `isSelf`, but it's optional and not enforced. Add a `requires_pin` flag to roles and enforce it at the POS lock screen.

### 10. `RolePermissionsDialog` has no "Copy permissions from another role" shortcut
When creating a new role or tweaking an existing one, there is no way to start from another role's permissions as a baseline. A manager setting up a "Senior Cashier" role (cashier + some manager perms) must manually toggle each permission. Add a "Copy from role…" dropdown in the dialog that pre-fills the `checked` state from another role's current permissions.

---

## CROSS-CUTTING RISKS

### 1. Sync safety — `password_hash` is sent to Supabase in plaintext JSON (Critical)
Covered in Backend Fault #1. This is the most severe cross-cutting risk. Every user created in the system has their bcrypt password hash transmitted to and stored in Supabase. A Supabase breach, leaked service role key, or dashboard access by an unauthorized third party exposes all password hashes. Strip `password_hash` from all sync payloads immediately.

### 2. Sync safety — `update_user` sync payload contains `is_active: payload.is_active` which can be `null`
```rust
serde_json::json!({
    "id": id, "email": payload.email, ..., "is_active": payload.is_active,
})
```
`payload.is_active` is `Option<bool>` in `UpdateUserDto`. When `is_active` is not being changed in an update (e.g., only email is updated), `payload.is_active` is `None`, which serializes as `null` in JSON. The Supabase sync processor receives `"is_active": null` and may either reject the row or set the cloud user's `is_active` to `NULL`. Use `serde_json::json!({ "is_active": payload.is_active.unwrap_or(true) })` or omit the field when `None`.

### 3. Multi-store isolation — `get_users` correctly scopes by `store_id` for non-global callers, but `search_users` does not (Backend Upgrade #7)
A cashier or stock keeper using the command palette's user search (`Ctrl+K → search user`) will receive results from all stores because `search_users` has no `store_id` parameter. This exposes employee names and usernames from other stores. Apply the same scope check in `search_users` as in `get_users`.

### 4. Security — `set_role_permissions` requires only `users.update` but modifying role permissions is fundamentally a higher-privilege operation than updating a user's profile
A `manager` role with `users.update` permission (realistic) can modify the `cashier` role's permissions — including granting themselves (via `cashier` role) more capabilities. This is a privilege escalation path. `set_role_permissions` should require a dedicated `roles.manage` permission (or be restricted to `admin`/`super_admin` roles via `hierarchy_level` check), separate from the general `users.update` grant.

### 5. Security — `RolePermissionsDialog` shows the "Save Permissions" button to anyone who can open it (canUpdate), but the button should be gated on a finer-grained `roles.manage` permission
The frontend renders:
```jsx
{canEdit && (
    <Button onClick={handleSave}>Save Permissions</Button>
)}
```
Where `canEdit = canUpdate = usePermission("users.update")`. Any role with `users.update` can save role permissions via the UI. This should use a separate, more restricted permission check matching the intended backend restriction.

### 6. Offline resilience — permission changes (`set_role_permissions`) update the in-memory `permissions_cache` but the cache is process-scoped; if the Tauri process restarts between the permission change and the next API call, the cache reloads from DB correctly — no issue. However, if two Tauri instances are running (not supported but possible in dev), one instance's cache is not invalidated when the other changes permissions
This is a development/testing concern: two running Tauri instances share the same DB but separate in-memory caches. Permission changes in one instance are not reflected in the other until the second instance restarts or its cache TTL expires. Document this as an unsupported configuration.

### 7. Data consistency — `users.store_name` is a `store_name?` (nullable join) that reflects the store name at query time — if the store is renamed, all historical user records look correct in real time (JOIN, not denormalized) — this is actually correct. But `sync_queue` payloads for users contain `store_id` but not `store_name`, meaning the Supabase replica must JOIN to get store names — this is fine if Supabase also has the `stores` table synced. Verify the sync order: `stores` must be synced before `users` in Supabase for FK relationships to hold.

### 8. Offline resilience — deactivating a user while offline stores the change locally but cannot expire their Supabase-based sessions (if any) or notify other terminals
When the admin deactivates a user offline, the local DB is updated and in-memory sessions are cleared (for this Tauri instance). But if the deactivated user is connected to a different terminal (different Tauri instance on the same local network), their session is still alive on that instance. The sync_queue update will eventually propagate to Supabase, but the other local instance won't know to invalidate its session cache until it restarts or the token expires naturally.

### 9. Security — avatar data is stored as a base64 data URI in the PostgreSQL `text` column and is returned in every `get_user` call — this column is included in sync payloads to Supabase, sending up to 400 KB of image data per user to the cloud
Avatar base64 data (up to 400 KB per user) is synced to Supabase as part of the user record. For a store with 50 users, this is 20 MB of avatar data in the sync queue. Supabase `sync_queue` rows accumulate this data. Strip avatar from sync payloads and handle avatar storage separately (either Supabase Storage or local file system with a path reference).

### 10. Data consistency — `gm` role slug is listed in the CLAUDE.md role hierarchy (`super_admin → admin → gm → manager → cashier → stock_keeper`) but `roleConfig.js` does not define a config for `gm`
`getRoleConfig("gm")` falls through to the default:
```js
return ROLE_CONFIG[slug] ?? {
    label: slug ?? "Unknown",
    dot:   "bg-muted-foreground",
    badge: "bg-muted text-muted-foreground border-border",
    ...
};
```
If a `gm` user exists in the system (created via migration or direct DB insert), their role badge, dot, and avatar color in `UsersPanel` and all other role-display components will be the generic grey default. Add `gm` to `ROLE_CONFIG`:
```js
gm: {
    label:  "General Manager",
    dot:    "bg-indigo-500",
    badge:  "bg-indigo-500/15 text-indigo-400 border-indigo-500/25",
    ring:   "ring-indigo-500/30",
    avatar: "bg-indigo-500/20 text-indigo-400",
},
```

---

## PRIORITY ORDER

These are the top 5 items that MUST be addressed before this module is production-ready, ordered by severity:

1. **[BACKEND FAULT #1] `create_user` sends `password_hash` to Supabase sync queue** — Every user created in the system has their bcrypt password hash stored in the cloud. A Supabase service role key leak, a misconfigured Supabase RLS policy, or a Supabase breach exposes all user password hashes for offline brute-force attacks. This is a critical credential exposure risk that violates security best practices and potentially Nigerian data protection regulations (NDPR). The fix is a one-line removal of `"password_hash": hash` from the `queue_row` payload. This must be fixed before the first production user is created.

2. **[BACKEND FAULT #5] `reset_user_password` does not invalidate existing sessions** — An admin resets a suspected-compromised account's password, but the attacker still has a valid refresh token. The attacker can silently obtain a new access token and continue operating for the full token TTL. If the password was reset specifically because of a breach, this makes the reset completely ineffective. The fix replicates three lines already present in `deactivate_user` (expire `active_sessions`, expire `user_sessions`, evict in-memory cache).

3. **[BACKEND FEATURE #1] No role hierarchy enforcement — lower-privilege users can promote accounts to `super_admin`** — A `manager` with `users.update` permission (which is granted in the default permission set) can call `update_user(id, { role_id: super_admin_role_id })` and elevate any user to super admin. This is an unchecked privilege escalation path. Any user with `users.update` is effectively a super admin. This must be gated by comparing `caller.hierarchy_level < target_role.hierarchy_level` before allowing a role change.

4. **[BACKEND FAULT #3] `update_user` unconditionally sets `store_id = $6` — passing `null` clears store assignment silently** — The `UserFormDialog` sends `store_id: null` when "All stores (global)" is selected (the first and default option). Any manager who edits a cashier's profile without explicitly selecting a store will null-out the cashier's `store_id`. On next login, the cashier's `claims.store_id` is `None`, causing 403 errors on every store-scoped backend operation. The cashier is effectively locked out of all POS operations without any error message explaining why. This will affect the first production edit of any cashier whose form editor selects the default store dropdown value.

5. **[CROSS-CUTTING RISK #4 + FRONTEND FAULT #10] `set_role_permissions` is gated only on `users.update` with no confirmation dialog** — Any role with `users.update` permission (managers in the default setup) can silently modify any other role's permissions with one click. A manager can grant themselves (via their subordinate roles) additional capabilities, or accidentally grant `transactions.void` to all cashiers in the system. The backend needs a higher-privilege gate (`roles.manage` permission or hierarchy check), and the frontend needs a confirmation dialog summarizing the changes before they are applied. These two gaps together make permission management both insecure and accident-prone.
